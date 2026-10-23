// ---------------------------------------------------------------------------
// The key ring of a business ↔ team member conversation (Joshua, 2026-10-23;
// docs/TWIN_CURVE_CONVERSATIONS.md). The agreement's parties key is still the
// first lock: a conversation starts under it. Then each side makes a P-256
// key pair in its own vault and sends only the public half, riding on a
// message it sends anyway. Once a side holds its own private half and the
// other's public half, it can make the pair's key (chain/key_ring.ts), which
// never travels. A view key opens the agreement record and so the parties
// key, but never a private half.
//
// How a handshake goes:
//   - The side that starts makes a half and attaches it to what it sends
//     (`half: { publicKey }`), on whatever stream it is writing, until the
//     answer comes.
//   - The other side, reading it, makes its own half and answers on the
//     stream the first arrived on (`half: { publicKey, answers }`); having
//     sent that, it writes under the new pair's key from then on.
//   - The side that started, reading the answer, writes under the new key
//     too.
// Each pair's key has its own slots (a stream), so a side that lost its keys
// still reads the agreement's stream to the end and can start again: the
// other side answers there.
//
// Making key pairs is asynchronous, so it happens before a send (the
// conversation's checks call chain/key_ring.ts `prepareRing`); everything
// here is pure: it decides what to attach, which stream to write, and keeps
// track of what was sent and read. Nothing here logs a key.
// ---------------------------------------------------------------------------

/** A side's half: the public half travels, the private half stays in this vault. */
export type Half = { publicKey: string; privateKey: JsonWebKey };

/** What a message carries for the handshake. `answers` names the half it answers. */
export type HalfOnWire = { publicKey: string; answers?: string };

/** The agreement's own stream, as opposed to a pair's. */
export const AGREEMENT_STREAM = "agreement";

export type Pair = {
  /** This side's half. */
  mine: Half;
  /** Theirs, once known: the pair's key can be made. */
  theirs?: string;
  /** This side's half has gone out (as a start, or as the answer). */
  sent?: true;
  /**
   * Made again from this side's start, answered a second time with a new half: the other side lost
   * its keys and started over. Its own stream, beside the first.
   */
  again?: true;
  /** Answering their start: the stream it came on, where the answer goes. */
  answerOn?: string;
  /** This pair's own slots. */
  nextIn: number;
  nextOut: number;
  createdAt: string;
};

export type KeyRing = {
  pairs: Pair[];
  /** The pair this side writes under; none means the agreement's key. */
  out?: string;
  /** Starts from the other side, waiting for a half to answer with. */
  toAnswer?: { publicKey: string; on: string }[];
  /** After a backup: start a fresh handshake, so the backup covers the conversation only up to here. */
  refresh?: true;
  /** Backups this side made of the conversation, by the request both agreed to (books/conversation_backup.ts). */
  backups?: { requestId: string; at: string }[];
};

/** How many pairs a ring keeps; each backup (later) adds one. */
export const MAX_PAIRS = 32;
const MAX_TO_ANSWER = 4;
const MAX_BACKUPS = 64;
const PUBLIC_KEY = /^04[0-9a-f]{128}$/;
const MAX_SEQ = 0xffff_ffff;

export class KeyRingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyRingError";
  }
}

/** A pair's stream id, from its own half (and theirs, for a pair made again): never the key. */
export const pairId = (p: Pick<Pair, "mine" | "theirs" | "again">): string => (p.again && p.theirs ? p.mine.publicKey.slice(2, 12) + p.theirs.slice(2, 8) : p.mine.publicKey.slice(2, 18));

export const emptyRing = (): KeyRing => ({ pairs: [] });

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isSeq = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_SEQ;
const isStamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const isStream = (v: unknown): v is string => v === AGREEMENT_STREAM || (typeof v === "string" && /^[0-9a-f]{16}$/.test(v));

export function validateHalfOnWire(raw: unknown): HalfOnWire {
  if (!isObject(raw) || typeof raw.publicKey !== "string" || !PUBLIC_KEY.test(raw.publicKey)) throw new KeyRingError("A key half must be a public key");
  if (raw.answers === undefined) return { publicKey: raw.publicKey };
  if (typeof raw.answers !== "string" || !PUBLIC_KEY.test(raw.answers) || raw.answers === raw.publicKey) throw new KeyRingError("A key half answers another public key");
  return { publicKey: raw.publicKey, answers: raw.answers };
}

function validateHalf(raw: unknown): Half {
  if (!isObject(raw) || typeof raw.publicKey !== "string" || !PUBLIC_KEY.test(raw.publicKey)) throw new KeyRingError("A key half needs its public key");
  const jwk = raw.privateKey;
  if (!isObject(jwk) || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.d !== "string" || typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new KeyRingError("A key half needs its private key");
  }
  return { publicKey: raw.publicKey, privateKey: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d } };
}

function validatePair(raw: unknown): Pair {
  if (!isObject(raw)) throw new KeyRingError("A key pair must be an object");
  const pair: Pair = { mine: validateHalf(raw.mine), nextIn: 0, nextOut: 0, createdAt: "" };
  if (!isSeq(raw.nextIn) || !isSeq(raw.nextOut)) throw new KeyRingError("A key pair's slots must be whole numbers");
  if (!isStamp(raw.createdAt)) throw new KeyRingError("A key pair needs the time it was made");
  pair.nextIn = raw.nextIn;
  pair.nextOut = raw.nextOut;
  pair.createdAt = raw.createdAt;
  if (raw.theirs !== undefined) {
    if (typeof raw.theirs !== "string" || !PUBLIC_KEY.test(raw.theirs) || raw.theirs === pair.mine.publicKey) throw new KeyRingError("Their half must be another public key");
    pair.theirs = raw.theirs;
  }
  if (raw.sent !== undefined) {
    if (raw.sent !== true) throw new KeyRingError("Sent is true or missing");
    pair.sent = true;
  }
  if (raw.answerOn !== undefined) {
    if (!isStream(raw.answerOn)) throw new KeyRingError("An answer goes on a stream");
    pair.answerOn = raw.answerOn;
  }
  if (raw.again !== undefined) {
    if (raw.again !== true || !pair.theirs) throw new KeyRingError("A pair made again has both halves");
    pair.again = true;
  }
  return pair;
}

export function validateKeyRing(raw: unknown): KeyRing {
  if (!isObject(raw) || !Array.isArray(raw.pairs)) throw new KeyRingError("A key ring needs its pairs");
  const pairs = raw.pairs.map(validatePair);
  if (pairs.length > MAX_PAIRS) throw new KeyRingError("Too many key pairs in one conversation");
  if (new Set(pairs.map(pairId)).size !== pairs.length) throw new KeyRingError("Two key pairs share a half");
  const ring: KeyRing = { pairs };
  if (raw.out !== undefined) {
    if (typeof raw.out !== "string" || !pairs.some((p) => pairId(p) === raw.out && p.theirs)) throw new KeyRingError("A conversation writes under a pair it holds both halves of");
    ring.out = raw.out;
  }
  if (raw.toAnswer !== undefined) {
    if (!Array.isArray(raw.toAnswer) || raw.toAnswer.length > MAX_TO_ANSWER) throw new KeyRingError("Too many halves waiting for an answer");
    ring.toAnswer = raw.toAnswer.map((t: unknown) => {
      if (!isObject(t) || typeof t.publicKey !== "string" || !PUBLIC_KEY.test(t.publicKey) || !isStream(t.on)) throw new KeyRingError("A half waiting for an answer needs its key and stream");
      return { publicKey: t.publicKey, on: t.on };
    });
    if (ring.toAnswer.length === 0) delete ring.toAnswer;
  }
  if (raw.refresh !== undefined) {
    if (raw.refresh !== true) throw new KeyRingError("Refresh is true or missing");
    ring.refresh = true;
  }
  if (raw.backups !== undefined) {
    if (!Array.isArray(raw.backups) || raw.backups.length > MAX_BACKUPS) throw new KeyRingError("Too many backups in one conversation");
    ring.backups = raw.backups.map((b: unknown) => {
      if (!isObject(b) || typeof b.requestId !== "string" || !/^[0-9a-f]{32}$/.test(b.requestId) || !isStamp(b.at)) throw new KeyRingError("A backup needs its request and time");
      return { requestId: b.requestId, at: b.at };
    });
    if (ring.backups.length === 0) delete ring.backups;
  }
  return ring;
}

/** Pairs whose key can be made: this side's half and theirs. Newest first. */
export const establishedPairs = (ring: KeyRing | undefined): Pair[] => [...(ring?.pairs ?? [])].filter((p) => p.theirs).reverse();

/** Whether this conversation is sealed with a key only the two sides hold. */
export const isTwinSealed = (ring: KeyRing | undefined): boolean => !!ring?.out;

/** What a send does: the stream it goes on (none: the agreement's), and the half it carries, if any. */
export type SendPlan = { via?: string; half?: HalfOnWire };

export function sendPlan(ring: KeyRing | undefined): SendPlan {
  if (!ring) return {};
  // An answer owed goes first, on the stream their start came on, so they can read it.
  const answering = ring.pairs.find((p) => p.theirs && p.answerOn && !p.sent);
  if (answering) {
    const plan: SendPlan = { half: { publicKey: answering.mine.publicKey, answers: answering.theirs! } };
    if (answering.answerOn !== AGREEMENT_STREAM) plan.via = answering.answerOn;
    return plan;
  }
  const plan: SendPlan = {};
  if (ring.out) plan.via = ring.out;
  // A start of this side's still waiting for its answer rides along.
  const waiting = [...ring.pairs].reverse().find((p) => !p.theirs);
  if (waiting) plan.half = { publicKey: waiting.mine.publicKey };
  return plan;
}

const update = (ring: KeyRing, id: string, change: (p: Pair) => Pair): KeyRing => ({ ...ring, pairs: ring.pairs.map((p) => (pairId(p) === id ? change(p) : p)) });

/** After this side sent `item` (on stream `via`, carrying `half`): its slot is used, and a half it carried has gone out. */
export function noteSent(ring: KeyRing, item: { seq: number; via?: string; half?: HalfOnWire }): KeyRing {
  let next = ring;
  if (item.via) next = update(next, item.via, (p) => ({ ...p, nextOut: Math.max(p.nextOut, item.seq + 1) }));
  if (item.half) {
    const pair = next.pairs.find((p) => p.mine.publicKey === item.half!.publicKey);
    if (pair) {
      next = update(next, pairId(pair), (p) => ({ ...p, sent: true }));
      // Having answered, this side writes under the new key.
      if (pair.theirs) next = { ...next, out: pairId(pair) };
    }
  }
  return next;
}

/** After reading the other side's `item` (on stream `via`): its slot is read, and a half it carried is kept. */
export function noteReceived(ring: KeyRing, item: { seq: number; via?: string; half?: HalfOnWire; receivedAt?: string; sentAt?: string }): KeyRing {
  let next = ring;
  if (item.via) next = update(next, item.via, (p) => ({ ...p, nextIn: Math.max(p.nextIn, item.seq + 1) }));
  const half = item.half;
  if (!half) return next;
  if (half.answers) {
    if (next.pairs.some((p) => p.theirs === half.publicKey)) return next; // already taken in
    // Their answer to one of this side's starts: the pair is made, and this side writes under it.
    const waiting = next.pairs.find((p) => p.mine.publicKey === half.answers && !p.theirs);
    if (waiting) {
      const made: Pair = { ...waiting, theirs: half.publicKey, sent: true };
      return { ...next, pairs: next.pairs.map((p) => (p === waiting ? made : p)), out: pairId(made) };
    }
    // A second answer to a start already answered: the other side lost its keys and answered it
    // again from scratch. This side still holds that start's private half, so the two can make a
    // fresh key from it; it gets its own stream and this side writes under it.
    const answered = next.pairs.find((p) => p.mine.publicKey === half.answers && p.theirs);
    if (!answered) return next;
    const again: Pair = { mine: answered.mine, theirs: half.publicKey, sent: true, again: true, nextIn: 0, nextOut: 0, createdAt: item.receivedAt ?? item.sentAt ?? answered.createdAt };
    const pairs = [...next.pairs, again].slice(-MAX_PAIRS);
    return { ...next, pairs, out: pairId(again) };
  }
  // Their start: answered once, whichever copy of it arrives.
  if (next.pairs.some((p) => p.theirs === half.publicKey) || next.toAnswer?.some((t) => t.publicKey === half.publicKey)) return next;
  const toAnswer = [...(next.toAnswer ?? []), { publicKey: half.publicKey, on: item.via ?? AGREEMENT_STREAM }].slice(-MAX_TO_ANSWER);
  return { ...next, toAnswer };
}

/** What `prepareRing` has to make: a half to start with (a ring with nothing in it), and one for each start to answer. */
export function halvesNeeded(ring: KeyRing | undefined): { start: boolean; answer: { publicKey: string; on: string }[] } {
  const answer = ring?.toAnswer ?? [];
  const fresh = (ring?.pairs.length ?? 0) === 0 && answer.length === 0;
  // A refresh after a backup starts again, unless a start of this side's is already waiting.
  const refresh = !!ring?.refresh && !ring.pairs.some((p) => !p.theirs);
  return { start: fresh || refresh, answer };
}

/**
 * After a backup both sides agreed to: this side made its copy. The side that allowed it starts the
 * fresh keys (`refresh`), its half riding on the Allow; the side that asked answers that start.
 */
export function noteBackup(ring: KeyRing | undefined, requestId: string, at: string, refresh: boolean): KeyRing {
  const base = ring ?? emptyRing();
  if (base.backups?.some((b) => b.requestId === requestId)) return base;
  return validateKeyRing({ ...base, ...(refresh ? { refresh: true as const } : {}), backups: [...(base.backups ?? []), { requestId, at }].slice(-MAX_BACKUPS) });
}

/** Whether this side made its copy for that request. */
export const backedUp = (ring: KeyRing | undefined, requestId: string): boolean => !!ring?.backups?.some((b) => b.requestId === requestId);

/** The pairs a backup made now covers: those with both halves, made before `before` (the moment both agreed). Newest first. */
export const pairsBefore = (ring: KeyRing | undefined, before: string): Pair[] => establishedPairs(ring).filter((p) => p.createdAt < before);

/** Halves made for a ring (chain/key_ring.ts `makeHalves`): a start of this side's, and answers to theirs. */
export type HalvesMade = { start?: Half; answers?: { to: { publicKey: string; on: string }; half: Half }[] };

/**
 * Puts freshly made halves into the latest ring. Made from an older copy, they are put in only where
 * still wanted: a start only into a ring with nothing in it, an answer only to a start still waiting.
 */
export function addHalves(ring: KeyRing | undefined, made: HalvesMade, now: string): KeyRing {
  let pairs = [...(ring?.pairs ?? [])];
  const need = halvesNeeded(ring);
  if (made.start && need.start) pairs.push({ mine: made.start, nextIn: 0, nextOut: 0, createdAt: now });
  const answered = new Set<string>();
  for (const a of made.answers ?? []) {
    if (!need.answer.some((t) => t.publicKey === a.to.publicKey)) continue;
    pairs.push({ mine: a.half, theirs: a.to.publicKey, answerOn: a.to.on, nextIn: 0, nextOut: 0, createdAt: now });
    answered.add(a.to.publicKey);
  }
  // Past the cap, the oldest pair this side never writes under goes first.
  while (pairs.length > MAX_PAIRS) {
    const drop = pairs.findIndex((p) => pairId(p) !== ring?.out);
    pairs = pairs.filter((_, i) => i !== drop);
  }
  const toAnswer = (ring?.toAnswer ?? []).filter((t) => !answered.has(t.publicKey));
  const next: KeyRing = { pairs };
  if (ring?.out) next.out = ring.out;
  if (toAnswer.length > 0) next.toAnswer = toAnswer;
  // A refresh is done once its start is in.
  if (ring?.refresh && !(made.start && need.start)) next.refresh = true;
  if (ring?.backups) next.backups = ring.backups;
  return validateKeyRing(next);
}
