// ---------------------------------------------------------------------------
// The handshake's keys (books/key_ring.ts has how it goes): fresh P-256 key
// pairs in the browser's Web Crypto, and the pair's key made from this side's
// private half and the other's public half, which never travels:
//
//   key = HKDF-SHA256(ECDH(mine, theirs),
//                     salt = the agreement's parties key,
//                     info = "PNW::PAIR::v1" ‖ the two public halves, lower first)
//
// The salt ties the key to this one conversation. Nothing here logs a key.
// ---------------------------------------------------------------------------

import { type Half, type HalvesMade, type KeyRing, type Pair, addHalves, establishedPairs, halvesNeeded, pairId } from "../books/key_ring";

const subtle = () => globalThis.crypto.subtle;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const INFO = new TextEncoder().encode("PNW::PAIR::v1");
const hexToBytes = (h: string): Uint8Array<ArrayBuffer> => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** A fresh half: the private part stays in the vault, only the public part is sent. */
export async function newHalf(): Promise<Half> {
  const pair = await subtle().generateKey(ECDH, true, ["deriveBits"]);
  const publicKey = hex(await subtle().exportKey("raw", pair.publicKey));
  const jwk = await subtle().exportKey("jwk", pair.privateKey);
  return { publicKey, privateKey: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d } };
}

/** Keys already made in this tab, by the conversation and the two halves, so a read doesn't redo the exchange. */
const made = new Map<string, string>();

/** The pair's key, 64 hex characters, for a pair holding both halves. */
export async function pairKeyHex(partiesKey: string, pair: Pair): Promise<string> {
  if (!pair.theirs) throw new Error("That pair is still waiting for the other half");
  const memo = `${partiesKey}:${pair.mine.publicKey}:${pair.theirs}`;
  const known = made.get(memo);
  if (known) return known;
  const priv = await subtle().importKey("jwk", { ...pair.mine.privateKey, ext: true }, ECDH, false, ["deriveBits"]);
  const pub = await subtle().importKey("raw", hexToBytes(pair.theirs), ECDH, false, []);
  const shared = await subtle().deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const [lo, hi] = [pair.mine.publicKey, pair.theirs].sort();
  const material = await subtle().importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const info = new Uint8Array([...INFO, ...hexToBytes(lo!), ...hexToBytes(hi!)]);
  const bits = await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: hexToBytes(partiesKey), info }, material, 256);
  const key = hex(bits);
  made.set(memo, key);
  return key;
}

/** Every stream this side reads, newest pair first: each pair with both halves (its key and next slot). */
export async function pairStreams(partiesKey: string, ring: KeyRing | undefined): Promise<{ via: string; key: string; nextIn: number }[]> {
  const out: { via: string; key: string; nextIn: number }[] = [];
  for (const p of establishedPairs(ring)) out.push({ via: pairId(p), key: await pairKeyHex(partiesKey, p), nextIn: p.nextIn });
  return out;
}

/** The key a send seals with: the pair's for a stream, else the agreement's. */
export async function sendingKey(partiesKey: string, ring: KeyRing | undefined, via: string | undefined): Promise<{ key: string; nextOut?: number }> {
  if (!via) return { key: partiesKey };
  const pair = ring?.pairs.find((p) => pairId(p) === via);
  if (!pair?.theirs) throw new Error("This conversation's key isn't ready; check messages, then try again");
  return { key: await pairKeyHex(partiesKey, pair), nextOut: pair.nextOut };
}

/**
 * Makes the halves a conversation needs before its next send: one to start a handshake when it has
 * none, and one to answer each start of the other side's. Null when there is nothing to make. The
 * caller puts them into the latest copy of the thread (books/key_ring.ts `addHalves`), in the
 * vault, which is where the private halves live.
 */
export async function makeHalves(ring: KeyRing | undefined): Promise<HalvesMade | null> {
  const need = halvesNeeded(ring);
  if (!need.start && need.answer.length === 0) return null;
  const made: HalvesMade = { answers: [] };
  if (need.start) made.start = await newHalf();
  for (const to of need.answer) made.answers!.push({ to, half: await newHalf() });
  return made;
}

/**
 * After a conversation's check: makes the halves it needs and hands them to `keep`, which puts them
 * into the latest copy of the thread's ring in the vault (books/key_ring.ts `addHalves`).
 */
export async function keepHalvesReady(ring: KeyRing | undefined, keep: (change: (ring: KeyRing | undefined) => KeyRing) => Promise<unknown>): Promise<void> {
  const made = await makeHalves(ring);
  if (!made) return;
  const now = new Date().toISOString();
  await keep((latest) => addHalves(latest, made, now));
}
