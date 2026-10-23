// ---------------------------------------------------------------------------
// Letters on chain (docs/LETTERS.md): the chain is the mailbox. A sealed
// envelope (the same bytes the mailbox carried, AES-256-GCM under the pair's
// parties key) goes into a record owned by its recipient through
// hewn_letters_v2 (v1 letters, sent before it, are still read):
//
//   send       up to LETTER_BYTES: a Letter to them and a SentLetter back
//   send_page  up to PAGE_BYTES: a Page to them (a long document: an
//              offer's terms); the sender keeps its own copy in its books
//   send_many  up to LETTER_BYTES, to up to eight accounts at once (an
//              announcement, sealed under the channel's key): a Letter to
//              each and one SentLetter back; places left over go to the
//              sender's own account
//
// Every parcel is padded to its call's fixed size (a 2-byte length, the
// envelope, zeros), so nothing on the chain shows how long a message is.
// The bytes travel as field elements, 31 bytes each, little-endian (always
// below the field's modulus). `lookup` is the mailbox's own slot id, so a
// conversation finds its next letter without opening the others.
//
// `LetterBox` has the mailbox client's shape: `put` sends a letter (one
// Shield approval, then waits for the network), `get` finds a received one
// among the wallet's records, `drop` does nothing (a record can't be
// unsent). It never sends receipts: a letter in a block has arrived. A slot
// this account already sent a letter under (from another device, or an
// earlier try) is refused as taken, as the mailbox did, so a thread steps
// over it instead of sending two letters under one lookup.
//
// Nothing here logs a key, a lookup, an address or a letter.
// ---------------------------------------------------------------------------

import { PROGRAMS } from "@pnw/config/programs";
import { MailboxError } from "@pnw/mailbox";
import type { FeeMode } from "@pnw/wallet/fee-mode";
import { type ExecuteOptions, type WorkWallet, executeAndWait } from "./work/execute";

/** The program letters are sent with. */
export const LETTERS_PROGRAM = PROGRAMS.letters.hewn_letters;
/** Every program letters are read from: the current one, then the one before it. */
export const LETTER_PROGRAMS: readonly string[] = [LETTERS_PROGRAM, PROGRAMS.letters.hewn_letters_v1];
export const SEND_FUNCTION = "send";
export const SEND_PAGE_FUNCTION = "send_page";
export const SEND_MANY_FUNCTION = "send_many";
/** How many accounts one `send_many` reaches. */
export const MANY = 8;

/** Bytes per field element: 248 bits, always below the field's modulus. */
export const FIELD_BYTES = 31;
export const LETTER_FIELDS = 34;
export const PAGE_FIELDS = 256;
/** The longest envelope each call carries (its fields, less the 2-byte length). */
export const LETTER_BYTES = LETTER_FIELDS * FIELD_BYTES - 2;
export const PAGE_BYTES = PAGE_FIELDS * FIELD_BYTES - 2;

const LOOKUP = /^[0-9a-f]{64}$/;
const ADDRESS = /^aleo1[02-9ac-hj-np-z]{58}$/;

export class LetterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LetterError";
  }
}

// ---- The codec -------------------------------------------------------------

/** An envelope padded into `count` field elements, each as a decimal bigint. */
export function packParcel(envelope: Uint8Array, count: number): bigint[] {
  if (envelope.length > count * FIELD_BYTES - 2) throw new LetterError("That is too long for one letter");
  const bytes = new Uint8Array(count * FIELD_BYTES);
  bytes[0] = envelope.length >> 8;
  bytes[1] = envelope.length & 0xff;
  bytes.set(envelope, 2);
  const out: bigint[] = [];
  for (let i = 0; i < count; i++) {
    let v = 0n;
    for (let b = FIELD_BYTES - 1; b >= 0; b--) v = (v << 8n) | BigInt(bytes[i * FIELD_BYTES + b]!);
    out.push(v);
  }
  return out;
}

/** The envelope back out of a parcel's field elements. Throws on anything `packParcel` couldn't have made. */
export function unpackParcel(fields: readonly bigint[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(fields.length * FIELD_BYTES);
  fields.forEach((f, i) => {
    if (f < 0n || f >= 1n << BigInt(8 * FIELD_BYTES)) throw new LetterError("A letter's field is out of range");
    let v = f;
    for (let b = 0; b < FIELD_BYTES; b++) {
      bytes[i * FIELD_BYTES + b] = Number(v & 0xffn);
      v >>= 8n;
    }
  });
  const length = (bytes[0]! << 8) | bytes[1]!;
  if (length > bytes.length - 2) throw new LetterError("A letter says it is longer than it is");
  if (bytes.subarray(2 + length).some((b) => b !== 0)) throw new LetterError("A letter's padding isn't empty");
  return bytes.slice(2, 2 + length);
}

/** A 64-hex lookup as the two u128 halves the program takes (high, then low). */
export function lookupHalves(lookup: string): [bigint, bigint] {
  if (!LOOKUP.test(lookup)) throw new LetterError("A lookup is 64 hex characters");
  const n = BigInt(`0x${lookup}`);
  return [n >> 128n, n & ((1n << 128n) - 1n)];
}

/** The two halves back as the lookup. */
export const lookupOf = (hi: bigint, lo: bigint): string => ((hi << 128n) | lo).toString(16).padStart(64, "0");

/** The call that carries one envelope to `to`: a letter when it fits, else a page. */
export function letterCall(to: string, lookup: string, envelope: Uint8Array): { program: string; function: string; inputs: string[] } {
  if (!ADDRESS.test(to)) throw new LetterError("A letter needs the account it goes to");
  const [hi, lo] = lookupHalves(lookup);
  if (hi === 0n && lo === 0n) throw new LetterError("A lookup can't be all zeros");
  const page = envelope.length > LETTER_BYTES;
  if (envelope.length > PAGE_BYTES) throw new LetterError("That is too long to send");
  const fields = packParcel(envelope, page ? PAGE_FIELDS : LETTER_FIELDS);
  return {
    program: LETTERS_PROGRAM,
    function: page ? SEND_PAGE_FUNCTION : SEND_FUNCTION,
    inputs: [to, `[${hi}u128, ${lo}u128]`, `[${fields.map((f) => `${f}field`).join(", ")}]`],
  };
}

/**
 * The calls that carry one announcement to `to` (any number of accounts):
 * `send_many` for each eight, the last one's empty places filled with
 * `self` (the sender's own account). An announcement is one letter's size.
 */
export function manyCalls(to: readonly string[], self: string, lookup: string, envelope: Uint8Array): { program: string; function: string; inputs: string[] }[] {
  if (to.length === 0) throw new LetterError("An announcement needs someone to go to");
  for (const a of [...to, self]) if (!ADDRESS.test(a)) throw new LetterError("An announcement needs the accounts it goes to");
  const [hi, lo] = lookupHalves(lookup);
  if (hi === 0n && lo === 0n) throw new LetterError("A lookup can't be all zeros");
  if (envelope.length > LETTER_BYTES) throw new LetterError("That is too long for one announcement; shorten it");
  const parcel = `[${packParcel(envelope, LETTER_FIELDS).map((f) => `${f}field`).join(", ")}]`;
  const calls = [];
  for (let i = 0; i < to.length; i += MANY) {
    const group = to.slice(i, i + MANY);
    while (group.length < MANY) group.push(self);
    calls.push({ program: LETTERS_PROGRAM, function: SEND_MANY_FUNCTION, inputs: [`[${group.join(", ")}]`, `[${hi}u128, ${lo}u128]`, parcel] });
  }
  return calls;
}

// ---- Reading the wallet's records ------------------------------------------

export type LetterRecord = {
  /** A letter or page received, or this account's own copy of one it sent. */
  kind: "letter" | "page" | "sent";
  lookup: string;
  envelope: Uint8Array<ArrayBuffer>;
  /** What Shield says about it, when it says. */
  blockHeight?: number;
  transactionId?: string;
  /** Who sent it: the record's sender, which only its owner can read, when Shield gives it. */
  sender?: string;
};

const RECORD_KINDS: Record<string, LetterRecord["kind"]> = { Letter: "letter", Page: "page", SentLetter: "sent" };

const arrayOf = (plaintext: string, name: string): string | null => new RegExp(`\\b${name}\\s*:\\s*\\[([^\\]]*)\\]`).exec(plaintext)?.[1] ?? null;
const numbersOf = (list: string, suffix: string): bigint[] => [...list.matchAll(new RegExp(`(\\d+)${suffix}\\b`, "g"))].map((m) => BigInt(m[1]!));

/** One record from Shield's `requestRecords` as a letter, or null when it isn't one this app can read. */
export function parseLetterRecord(raw: unknown): LetterRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = typeof r.recordName === "string" ? RECORD_KINDS[r.recordName] : undefined;
  const plaintext = typeof r.recordPlaintext === "string" ? r.recordPlaintext : null;
  if (!kind || !plaintext) return null;
  try {
    const lookupList = arrayOf(plaintext, "lookup");
    const parcelList = arrayOf(plaintext, kind === "page" ? "page" : "parcel");
    if (lookupList === null || parcelList === null) return null;
    const halves = numbersOf(lookupList, "u128");
    const fields = numbersOf(parcelList, "field");
    if (halves.length !== 2 || fields.length !== (kind === "page" ? PAGE_FIELDS : LETTER_FIELDS)) return null;
    const out: LetterRecord = { kind, lookup: lookupOf(halves[0]!, halves[1]!), envelope: unpackParcel(fields) };
    const height = r.blockHeight ?? r.block_height;
    if (typeof height === "number" && Number.isInteger(height)) out.blockHeight = height;
    if (typeof r.transactionId === "string") out.transactionId = r.transactionId;
    if (typeof r.sender === "string" && ADDRESS.test(r.sender)) out.sender = r.sender;
    return out;
  } catch {
    return null; // not a letter this app wrote
  }
}

// ---- The mailbox's shape, on chain ----------------------------------------------

export type LetterWallet = WorkWallet & { requestRecords(program: string, includePlaintext?: boolean): Promise<unknown[]> };

export type LetterBoxOptions = {
  wallet: LetterWallet;
  /** Who `put` sends to. Leave out for a box that only reads. */
  to?: string;
  execute?: ExecuteOptions;
};

/**
 * The mailbox client's `put` / `get` / `drop` over letters on chain. Reads
 * come from one fetch of the wallet's letters, kept until `refresh`.
 */
export class LetterBox {
  private readonly wallet: LetterWallet;
  private readonly to: string | undefined;
  private readonly execute: ExecuteOptions;
  private letters: Promise<Letters> | null = null;

  constructor({ wallet, to, execute }: LetterBoxOptions) {
    this.wallet = wallet;
    this.to = to;
    this.execute = execute ?? {};
  }

  /**
   * Sends one envelope as a letter (one Shield approval) and waits until the
   * network has it. Throws the mailbox's CONFLICT when this account already
   * sent a letter under `lookup`.
   */
  async put(lookup: string, envelope: Uint8Array, options?: { keepUntil?: string; feeMode?: FeeMode }): Promise<void> {
    if (!this.to) throw new LetterError("This letter box only reads");
    const call = letterCall(this.to, lookup, envelope);
    // What this account has sent, as of now.
    if (await this.hasSent(lookup)) throw new MailboxError("CONFLICT", "That slot is taken");
    await executeAndWait(this.wallet, { ...call, ...(options?.feeMode ? { feeMode: options.feeMode } : {}) }, this.execute);
    (await this.read()).sent.add(lookup);
  }

  /** The envelope received under `lookup`, or null when no letter has it (yet). */
  async get(lookup: string): Promise<Uint8Array<ArrayBuffer> | null> {
    return (await this.read()).received.get(lookup)?.envelope ?? null;
  }

  /** Every letter received under `lookup`: a slot many people write to (applications to a posting), oldest first. */
  async getAll(lookup: string): Promise<LetterRecord[]> {
    return (await this.read()).all.get(lookup) ?? [];
  }

  /** The copy of a letter this account sent under `lookup` (its SentLetter), or null: how a restore gets this side's own messages back. */
  async getSent(lookup: string): Promise<Uint8Array<ArrayBuffer> | null> {
    return (await this.read()).sentCopies.get(lookup) ?? null;
  }

  /** Whether this account has sent a letter under `lookup` (read afresh). */
  async hasSent(lookup: string): Promise<boolean> {
    this.refresh();
    return (await this.read()).sent.has(lookup);
  }

  /** A record can't be unsent or deleted; reading it is enough. */
  async drop(_lookup: string): Promise<void> {}

  /** Reads the wallet's letters again on the next `get`. */
  refresh(): void {
    this.letters = null;
  }

  private async read(): Promise<Letters> {
    if (!this.letters) this.letters = this.load();
    try {
      return await this.letters;
    } catch (e) {
      this.letters = null; // try again next time
      throw e;
    }
  }

  private async load(): Promise<Letters> {
    const out: Letters = { received: new Map(), all: new Map(), sent: new Set(), sentCopies: new Map() };
    const raw = (await Promise.all(LETTER_PROGRAMS.map((p) => this.wallet.requestRecords(p, true)))).flatMap((r) => (Array.isArray(r) ? r : []));
    for (const r of raw) {
      const letter = parseLetterRecord(r);
      if (!letter) continue;
      if (letter.kind === "sent") {
        out.sent.add(letter.lookup);
        if (!out.sentCopies.has(letter.lookup)) out.sentCopies.set(letter.lookup, letter.envelope);
      }
      else {
        if (!out.received.has(letter.lookup)) out.received.set(letter.lookup, letter);
        out.all.set(letter.lookup, [...(out.all.get(letter.lookup) ?? []), letter]);
      }
    }
    for (const list of out.all.values()) list.sort((a, b) => (a.blockHeight ?? 0) - (b.blockHeight ?? 0));
    return out;
  }
}

type Letters = { received: Map<string, LetterRecord>; all: Map<string, LetterRecord[]>; sent: Set<string>; sentCopies: Map<string, Uint8Array<ArrayBuffer>> };

/**
 * Sends one announcement to many accounts: one Shield approval for each
 * eight (manyCalls). Refuses a slot this account already sent under, as
 * `LetterBox.put` does. Reading is `LetterBox`'s: every copy is a Letter.
 */
export class ManyLetterBox {
  private readonly own: LetterBox;

  constructor(
    private readonly options: { wallet: LetterWallet; to: readonly string[]; self: string; execute?: ExecuteOptions },
  ) {
    this.own = new LetterBox({ wallet: options.wallet });
  }

  async put(lookup: string, envelope: Uint8Array, options?: { keepUntil?: string; feeMode?: FeeMode }): Promise<void> {
    const calls = manyCalls(this.options.to, this.options.self, lookup, envelope);
    if (await this.own.hasSent(lookup)) throw new MailboxError("CONFLICT", "That slot is taken");
    for (const call of calls) await executeAndWait(this.options.wallet, { ...call, ...(options?.feeMode ? { feeMode: options.feeMode } : {}) }, this.options.execute ?? {});
  }
}

/** Letters were under a slot but Shield didn't say who sent any of them, so none can be trusted. */
export class SenderUnknown extends LetterError {
  constructor() {
    super("Shield didn't say who sent a letter, so it can't be trusted. Update Shield, then check again.");
    this.name = "SenderUnknown";
  }
}

/**
 * The reading side of a conversation with `from`, over letters: a slot's letter from that
 * account, or null when none has come yet. Whoever else holds the slot's key (anyone given a
 * channel's key, an auditor shown a view key) could seal a letter into it too, so a letter counts
 * only when its sender, which only its owner can see, is `from` (the security review,
 * 2026-10-22). A record can't be unsent, so `drop` does nothing, and there is no `put`, so no
 * receipts go out: a letter in a block has arrived.
 */
export const letterReader = (letters: Pick<LetterBox, "getAll">, from: string) => ({
  get: async (lookup: string): Promise<Uint8Array<ArrayBuffer> | null> => {
    const all = await letters.getAll(lookup);
    const theirs = all.find((r) => r.sender === from);
    if (theirs) return theirs.envelope;
    if (all.length > 0 && all.every((r) => r.sender === undefined)) throw new SenderUnknown();
    return null;
  },
  drop: async (_lookup: string) => {},
});

/**
 * A conversation between two accounts, over letters (chain/thread.ts takes these two): `writer`
 * sends each message as a letter to `to`; `reader` finds the letters `to` sent. Pass one
 * `letters` box for every thread on a screen, so the wallet is read once.
 */
export function letterThread(
  wallet: LetterWallet,
  to: string,
  { letters = new LetterBox({ wallet }), execute }: { letters?: LetterBox; execute?: ExecuteOptions } = {},
) {
  const writer = new LetterBox({ wallet, to, ...(execute ? { execute } : {}) });
  return { writer, reader: letterReader(letters, to), refresh: () => letters.refresh() };
}
