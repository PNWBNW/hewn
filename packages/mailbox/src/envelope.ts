// ---------------------------------------------------------------------------
// The mailbox envelope: one document, sealed between the two parties of an
// agreement, addressed by a hash only they can compute.
//
// Both sides already share a 32-byte secret, the agreement's `parties_key`
// (drawn at random by the business's app, private on the agreement record;
// never computed from the addresses, or anyone could compute it). Every
// mailbox value is derived from it and nothing else, so neither party has
// to talk to the other, or to anyone, before reading or writing:
//
//   key(kind)          = HKDF-SHA256(ikm = parties_key,
//                                    salt = "PNW::MAILBOX::v1",
//                                    info = kind)              → AES-256-GCM
//   lookup(kind, seq)  = BLAKE3("PNW::MAILBOX::LOOKUP::v1" ‖ 0x00 ‖ parties_key
//                               ‖ kind ‖ u32be(seq))         → 64 hex chars
//   envelope           = 0x01 ‖ iv(12) ‖ AES-GCM(payload, aad = lookup)
//
// The lookup is the only thing the server, the pinning service or a network
// observer ever sees of an address: a hash they cannot invert or relate to a
// party, a kind or another lookup. The receiver scans seq from its last seen
// + 1 until a miss. The kind is in the key and the sequence number is in the
// associated data, so a document can't be replayed as another kind or in
// another slot.
//
// All crypto is WebCrypto apart from BLAKE3 (the ledger's hash, from
// @noble/hashes). Nothing here talks to the network: that is client.ts.
// ---------------------------------------------------------------------------

import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/** The documents the mailbox carries. The kind is part of the key. */
export const KINDS = {
  terms: "terms",
  w4: "w4",
  paystub: "paystub",
  payment_note: "payment_note",
} as const;

export type Kind = (typeof KINDS)[keyof typeof KINDS];

export const ENVELOPE_VERSION = 0x01;
/** Version byte, 12-byte IV and the 16-byte GCM tag. */
export const ENVELOPE_OVERHEAD = 1 + 12 + 16;
/** The largest payload the mailbox accepts: a paystub or W-4 is a few KB. */
export const MAX_PAYLOAD_BYTES = 256 * 1024;
/** What the function accepts on the wire: the payload plus a little slack for the overhead. */
export const MAX_ENVELOPE_BYTES = MAX_PAYLOAD_BYTES + 64;
/** A lookup id: hex BLAKE3, always 64 lower-case characters. */
export const LOOKUP_PATTERN = /^[0-9a-f]{64}$/;

const PARTIES_KEY_BYTES = 32;
const KEY_SALT = "PNW::MAILBOX::v1";
const LOOKUP_DOMAIN = "PNW::MAILBOX::LOOKUP::v1";
const KIND_PATTERN = /^[a-z0-9_]{1,32}$/;
const MAX_SEQ = 0xffff_ffff;

export type MailboxErrorCode =
  | "BAD_KEY"
  | "BAD_KIND"
  | "BAD_SEQ"
  | "BAD_LOOKUP"
  | "TOO_LARGE"
  | "BAD_ENVELOPE"
  | "BAD_VERSION"
  | "TAMPERED"
  | "BAD_KEEP_UNTIL"
  | "NOT_CONFIGURED"
  | "CONFLICT"
  | "REQUEST_FAILED";

export class MailboxError extends Error {
  readonly code: MailboxErrorCode;
  constructor(code: MailboxErrorCode, message: string) {
    super(message);
    this.name = "MailboxError";
    this.code = code;
  }
}

export type Sealed = { lookup: string; envelope: Uint8Array<ArrayBuffer> };

// ---- helpers ---------------------------------------------------------------

const subtle = () => globalThis.crypto.subtle;
const utf8 = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** A private copy of the bytes, typed over a plain ArrayBuffer (what WebCrypto accepts). */
function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function checkPartiesKey(partiesKey: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!(partiesKey instanceof Uint8Array) || partiesKey.length !== PARTIES_KEY_BYTES) {
    throw new MailboxError("BAD_KEY", `The parties key must be ${PARTIES_KEY_BYTES} bytes`);
  }
  return copy(partiesKey);
}

function checkKind(kind: string): string {
  if (typeof kind !== "string" || !KIND_PATTERN.test(kind)) {
    throw new MailboxError("BAD_KIND", "The document kind must be 1–32 lower-case letters, digits or underscores");
  }
  return kind;
}

function checkSeq(seq: number): number {
  if (!Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) {
    throw new MailboxError("BAD_SEQ", "The sequence number must be a whole number from 0 to 4294967295");
  }
  return seq;
}

/** The agreement's `parties_key` as bytes, from its hex form (with or without `0x`). */
export function partiesKeyFromHex(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new MailboxError("BAD_KEY", `The parties key must be ${PARTIES_KEY_BYTES} bytes of hex`);
  }
  return copy(hexToBytes(clean.toLowerCase()));
}

// ---- derivations -----------------------------------------------------------

/**
 * The AES-256-GCM key for one kind of document between two parties.
 * Non-extractable: the caller can seal and open, never read the key out.
 */
export async function deriveMailboxKey(partiesKey: Uint8Array, kind: string): Promise<CryptoKey> {
  const ikm = checkPartiesKey(partiesKey);
  const info = utf8(checkKind(kind));
  const material = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  try {
    return await subtle().deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: utf8(KEY_SALT), info },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    ikm.fill(0);
  }
}

/** BLAKE3(domain ‖ 0x00 ‖ parties_key ‖ kind ‖ u32be(seq)): a slot address only the two parties can compute. */
function address(domain: string, partiesKey: Uint8Array, kind: string, seq: number): string {
  const key = checkPartiesKey(partiesKey);
  const kindBytes = utf8(checkKind(kind));
  const seqBytes = new Uint8Array(4);
  new DataView(seqBytes.buffer).setUint32(0, checkSeq(seq), false);
  const domainBytes = utf8(domain);
  const input = new Uint8Array(domainBytes.length + 1 + key.length + kindBytes.length + seqBytes.length);
  let at = 0;
  for (const part of [domainBytes, new Uint8Array([0x00]), key, kindBytes, seqBytes]) {
    input.set(part, at);
    at += part.length;
  }
  try {
    return bytesToHex(blake3(input));
  } finally {
    key.fill(0);
    input.fill(0);
  }
}

/**
 * Where the `seq`-th document of `kind` between the two parties lives.
 * Both sides compute it alone; nobody else can.
 */
export function lookupId(partiesKey: Uint8Array, kind: string, seq: number): string {
  return address(LOOKUP_DOMAIN, partiesKey, kind, seq);
}

// ---- seal / open -----------------------------------------------------------

/** A document's kind: never one starting with an underscore, which the mailbox keeps for its own keys. */
function documentKind(kind: string): string {
  if (checkKind(kind).startsWith("_")) throw new MailboxError("BAD_KIND", "A document kind can't start with an underscore");
  return kind;
}

async function sealAt(partiesKey: Uint8Array, keyKind: string, lookup: string, payload: Uint8Array): Promise<Sealed> {
  if (!(payload instanceof Uint8Array)) throw new MailboxError("BAD_ENVELOPE", "The payload must be bytes");
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new MailboxError("TOO_LARGE", `A document can be at most ${MAX_PAYLOAD_BYTES} bytes`);
  }
  const key = await deriveMailboxKey(partiesKey, keyKind);
  const iv = random(12);
  const ciphertext = new Uint8Array(
    await subtle().encrypt({ name: "AES-GCM", iv, additionalData: utf8(lookup) }, key, copy(payload)),
  );
  const envelope = new Uint8Array(1 + iv.length + ciphertext.length);
  envelope[0] = ENVELOPE_VERSION;
  envelope.set(iv, 1);
  envelope.set(ciphertext, 1 + iv.length);
  return { lookup, envelope };
}

async function openAt(partiesKey: Uint8Array, keyKind: string, lookup: string, envelope: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (!(envelope instanceof Uint8Array) || envelope.length < ENVELOPE_OVERHEAD) {
    throw new MailboxError("BAD_ENVELOPE", "That isn't a mailbox envelope");
  }
  if (envelope.length > MAX_PAYLOAD_BYTES + ENVELOPE_OVERHEAD) {
    throw new MailboxError("BAD_ENVELOPE", `An envelope can be at most ${MAX_PAYLOAD_BYTES + ENVELOPE_OVERHEAD} bytes`);
  }
  if (envelope[0] !== ENVELOPE_VERSION) {
    throw new MailboxError("BAD_VERSION", "That envelope is from a different version of the mailbox");
  }
  const key = await deriveMailboxKey(partiesKey, keyKind);
  const iv = copy(envelope.subarray(1, 13));
  const ciphertext = copy(envelope.subarray(13));
  try {
    return new Uint8Array(
      await subtle().decrypt({ name: "AES-GCM", iv, additionalData: utf8(lookup) }, key, ciphertext),
    );
  } catch {
    throw new MailboxError("TAMPERED", "That envelope isn't for this agreement, kind and slot, or was changed in transit");
  }
}

/** Seals `payload` as the `seq`-th document of `kind`. Fresh IV every time. */
export async function seal(partiesKey: Uint8Array, kind: string, seq: number, payload: Uint8Array): Promise<Sealed> {
  if (!(payload instanceof Uint8Array)) throw new MailboxError("BAD_ENVELOPE", "The payload must be bytes");
  documentKind(kind);
  return sealAt(partiesKey, kind, lookupId(partiesKey, kind, seq), payload);
}

/**
 * Opens an envelope as the `seq`-th document of `kind`. Fails with
 * `BAD_ENVELOPE` (too short or too long), `BAD_VERSION` (not a version this
 * code knows) or `TAMPERED` (wrong key, kind or seq, or any changed byte).
 */
export async function open(partiesKey: Uint8Array, kind: string, seq: number, envelope: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (!(envelope instanceof Uint8Array) || envelope.length < ENVELOPE_OVERHEAD) {
    throw new MailboxError("BAD_ENVELOPE", "That isn't a mailbox envelope");
  }
  documentKind(kind);
  return openAt(partiesKey, kind, lookupId(partiesKey, kind, seq), envelope);
}

// ---- receipts --------------------------------------------------------------
// A receipt tells the sender that the receiver's app has the `seq`-th
// document of `kind`: the receiver seals one when it collects the document,
// the sender reads it, keeps the time and drops it. It lives at its own
// address (another domain, so it can never land on a document's slot) and
// is sealed under its own key; the server sees one more small envelope
// behind one more hash. Receipts are best effort: a missing one means "not
// known yet", never "not received".

const RECEIPT_DOMAIN = "PNW::MAILBOX::RECEIPT::v1";
/** The HKDF info for receipt keys. No document kind starts with an underscore. */
const RECEIPT_KEY_KIND = "_receipt";

/** What a receipt says. */
export type Receipt = { version: 1; receivedAt: string };

/** Where the receipt for the `seq`-th document of `kind` lives. */
export function receiptLookup(partiesKey: Uint8Array, kind: string, seq: number): string {
  return address(RECEIPT_DOMAIN, partiesKey, kind, seq);
}

/** Seals the receipt for the `seq`-th document of `kind`, received at `receivedAt` (ISO). */
export async function sealReceipt(partiesKey: Uint8Array, kind: string, seq: number, receivedAt: string): Promise<Sealed> {
  if (typeof receivedAt !== "string" || Number.isNaN(Date.parse(receivedAt))) {
    throw new MailboxError("BAD_ENVELOPE", "A receipt needs the time it was received");
  }
  const receipt: Receipt = { version: 1, receivedAt: new Date(receivedAt).toISOString() };
  return sealAt(partiesKey, RECEIPT_KEY_KIND, receiptLookup(partiesKey, kind, seq), utf8(JSON.stringify(receipt)));
}

/** Opens the receipt for the `seq`-th document of `kind`. Fails like `open`, or with `BAD_ENVELOPE` when it isn't a receipt. */
export async function openReceipt(partiesKey: Uint8Array, kind: string, seq: number, envelope: Uint8Array): Promise<Receipt> {
  const bytes = await openAt(partiesKey, RECEIPT_KEY_KIND, receiptLookup(partiesKey, kind, seq), envelope);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new MailboxError("BAD_ENVELOPE", "That isn't a receipt");
  }
  const r = raw as Partial<Receipt> | null;
  if (!r || r.version !== 1 || typeof r.receivedAt !== "string" || Number.isNaN(Date.parse(r.receivedAt))) {
    throw new MailboxError("BAD_ENVELOPE", "That isn't a receipt");
  }
  return { version: 1, receivedAt: new Date(r.receivedAt).toISOString() };
}
