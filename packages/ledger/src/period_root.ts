// ---------------------------------------------------------------------------
// The period root: one 32-byte hash that commits to everything a closed range
// of the books holds (docs/AUDIT_DESIGN.md §1, docs/CLOSE_PERIOD.md). It is
// what a close anchors on chain, and what an audit pack recomputes.
//
//   salt(x)        = HMAC-SHA256(anchor_secret, x)
//   entry_leaf     = H("HEWN::LEAF::v1",      salt(entry.hash), entry.hash)
//   recipient_tag  = H("HEWN::RECIPIENT::v1", salt(entry.hash), recipient)
//   settle_leaf    = H("HEWN::SETTLE::v1",    salt(entry.hash ":" tx_id), entry.hash, tx_id, recipient_tag)
//   node           = H("HEWN::NODE::v1", left, right)   (an odd layer repeats its last node)
//   empty tree     = H("HEWN::EMPTY::v1")
//   business_tag   = HMAC-SHA256(anchor_secret, "HEWN::BUSINESS::v1")
//   root           = H("HEWN::PERIOD::v1", business_tag, period_id, n, m, prev_root,
//                      chain_head, entries.root, settlements.root)
//
// H(domain, ...fields) = BLAKE3(domain ‖ 0x00 ‖ for each field: u32 length ‖ bytes), so no two
// different field lists hash the same. period_id is the range, "2026-10-25..2026-10-31". n and
// m, the leaf counts, are in the root, so a repeated last leaf can't pass for a real one.
// prev_root chains each close to the one before (32 zero bytes for the first); chain_head is
// the hash of the range's last entry in journal order (the journal's genesis hash when the
// range has none), which ties the root to the journal's own hash chain.
//
// Salts come from one random anchor_secret, kept in the books, so a proof reveals only the salt
// it needs and a revealed leaf names nobody. A verifier never holds the secret: it gets the salts,
// and recomputes the same leaves and root from them (`entryLeafFromSalt`, `settlementLeafFromSalts`,
// `rootFromParts`), which is what the secret-based functions here call too. Pure: no storage, no
// network, no randomness.
// ---------------------------------------------------------------------------

import { blake3 } from "@noble/hashes/blake3.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Books, Entry } from "./books";
import { fail } from "./errors";
import { GENESIS_HASH } from "./hash";
import { type IsoDate, assertDate } from "./periods";

const HASH = /^[0-9a-f]{64}$/;
const ZERO = "0".repeat(64);

/** One paycheck's transfer, tied to its entry: which transfer paid it, and to whom. */
export type SettlementLink = { entryHash: string; txId: string; recipient: string };

export type PeriodRootInput = {
  /** 32 random bytes kept in the books; never leaves them except as the salts a proof needs. */
  anchorSecret: Uint8Array;
  start: IsoDate;
  end: IsoDate;
  /** The range's entries, in journal order (`entriesInRange`). */
  entries: readonly Entry[];
  /** The range's settlements, in paycheck order: those whose transfer confirmed in the range. */
  settlements: readonly SettlementLink[];
  /** The previous close's root, as hex; none for the first close. */
  prevRoot?: string;
};

export type PeriodRoot = {
  root: string;
  periodId: string;
  n: number;
  m: number;
  chainHead: string;
  entriesRoot: string;
  settlementsRoot: string;
  /** The leaves, in order, for building inclusion proofs. */
  entryLeaves: string[];
  settlementLeaves: string[];
};

export type ProofStep = { sibling: string; side: "left" | "right" };

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}

function h(domain: string, ...fields: Uint8Array<ArrayBufferLike>[]): string {
  const parts: Uint8Array<ArrayBufferLike>[] = [utf8ToBytes(domain), new Uint8Array([0])];
  for (const f of fields) parts.push(u32(f.length), f);
  const total = parts.reduce((t, p) => t + p.length, 0);
  const buf = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    buf.set(p, at);
    at += p.length;
  }
  return bytesToHex(blake3(buf));
}

const hashBytes = (hex: string, what: string): Uint8Array => {
  if (!HASH.test(hex)) fail("BAD_ROOT", `${what} must be 64 lower-case hex characters`);
  return hexToBytes(hex);
};

function checkSecret(secret: Uint8Array): void {
  if (!(secret instanceof Uint8Array) || secret.length !== 32) fail("BAD_ROOT", "The anchor secret must be 32 bytes");
}

const salt = (secret: Uint8Array, x: string): Uint8Array => hmac(sha256, secret, utf8ToBytes(x));

/** An entry's salt, as hex: what a proof reveals so its leaf can be recomputed. */
export function entrySalt(anchorSecret: Uint8Array, entryHash: string): string {
  checkSecret(anchorSecret);
  return bytesToHex(salt(anchorSecret, entryHash));
}

/** A settlement's own salt, as hex (its recipient tag uses the entry's salt). */
export function settlementSalt(anchorSecret: Uint8Array, entryHash: string, txId: string): string {
  checkSecret(anchorSecret);
  return bytesToHex(salt(anchorSecret, `${entryHash}:${txId}`));
}

/** The entry leaf from a revealed salt (64 hex). */
export function entryLeafFromSalt(saltHex: string, entryHash: string): string {
  return h("HEWN::LEAF::v1", hashBytes(saltHex, "An entry's salt"), hashBytes(entryHash, "An entry hash"));
}

/** The settlement leaf from its two revealed salts: the entry's (for the recipient tag) and its own. */
export function settlementLeafFromSalts(entrySaltHex: string, settleSaltHex: string, s: SettlementLink): string {
  const entry = hashBytes(s.entryHash, "A settlement's entry hash");
  if (typeof s.txId !== "string" || !s.txId.trim()) fail("BAD_ROOT", "A settlement needs its transaction id");
  if (typeof s.recipient !== "string" || !s.recipient.trim()) fail("BAD_ROOT", "A settlement needs its recipient");
  const recipientTag = h("HEWN::RECIPIENT::v1", hashBytes(entrySaltHex, "A settlement's entry salt"), utf8ToBytes(s.recipient));
  return h("HEWN::SETTLE::v1", hashBytes(settleSaltHex, "A settlement's salt"), entry, utf8ToBytes(s.txId), hexToBytes(recipientTag));
}

/** Everything the root commits to, besides the leaves themselves. */
export type RootParts = {
  businessTag: string;
  periodId: string;
  n: number;
  m: number;
  prevRoot: string;
  chainHead: string;
  entriesRoot: string;
  settlementsRoot: string;
};

/** The root from its parts: what a verifier recomputes without the secret. */
export function rootFromParts(p: RootParts): string {
  if (!Number.isInteger(p.n) || p.n < 0 || !Number.isInteger(p.m) || p.m < 0) fail("BAD_ROOT", "The counts must be whole numbers");
  return h(
    "HEWN::PERIOD::v1",
    hashBytes(p.businessTag, "The business tag"),
    utf8ToBytes(p.periodId),
    u32(p.n),
    u32(p.m),
    hashBytes(p.prevRoot, "The previous root"),
    hashBytes(p.chainHead, "The chain head"),
    hashBytes(p.entriesRoot, "The entries' root"),
    hashBytes(p.settlementsRoot, "The settlements' root"),
  );
}

/** The business's salted tag: the same for every close, naming nobody. */
export function businessTag(anchorSecret: Uint8Array): string {
  checkSecret(anchorSecret);
  return bytesToHex(hmac(sha256, anchorSecret, utf8ToBytes("HEWN::BUSINESS::v1")));
}

export function entryLeaf(anchorSecret: Uint8Array, entryHash: string): string {
  hashBytes(entryHash, "An entry hash");
  return entryLeafFromSalt(entrySalt(anchorSecret, entryHash), entryHash);
}

export function settlementLeaf(anchorSecret: Uint8Array, s: SettlementLink): string {
  hashBytes(s.entryHash, "A settlement's entry hash");
  return settlementLeafFromSalts(entrySalt(anchorSecret, s.entryHash), settlementSalt(anchorSecret, s.entryHash, s.txId), s);
}

const EMPTY = h("HEWN::EMPTY::v1");
const node = (l: string, r: string) => h("HEWN::NODE::v1", hexToBytes(l), hexToBytes(r));

/** Every layer of the tree, leaves first; an empty list has the fixed empty root. */
function layers(leaves: readonly string[]): string[][] {
  if (leaves.length === 0) return [[EMPTY]];
  const out = [[...leaves]];
  while (out[out.length - 1]!.length > 1) {
    const layer = out[out.length - 1]!;
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) next.push(node(layer[i]!, layer[i + 1] ?? layer[i]!));
    out.push(next);
  }
  return out;
}

export const merkleRoot = (leaves: readonly string[]): string => layers(leaves).at(-1)![0]!;

/** The path from leaf `index` to the root. */
export function merkleProof(leaves: readonly string[], index: number): ProofStep[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) fail("BAD_ROOT", "No such leaf");
  const path: ProofStep[] = [];
  const all = layers(leaves);
  let i = index;
  for (const layer of all.slice(0, -1)) {
    const right = i % 2 === 1;
    path.push(right ? { sibling: layer[i - 1]!, side: "left" } : { sibling: layer[i + 1] ?? layer[i]!, side: "right" });
    i = Math.floor(i / 2);
  }
  return path;
}

/** Whether `leaf` sits under `root` along `path`. */
export function verifyMerkleProof(leaf: string, path: readonly ProofStep[], root: string): boolean {
  let at = leaf;
  for (const step of path) at = step.side === "left" ? node(step.sibling, at) : node(at, step.sibling);
  return at === root;
}

/** The entries dated in `start`..`end`, in journal order. */
export function entriesInRange(books: Pick<Books, "entries">, start: IsoDate, end: IsoDate): Entry[] {
  assertDate(start);
  assertDate(end);
  if (start > end) fail("BAD_ROOT", "A range ends on or after its start");
  return books.entries.filter((e) => e.date >= start && e.date <= end);
}

/** The root of a range: what a close anchors (docs/AUDIT_DESIGN.md §1). */
export function periodRoot(input: PeriodRootInput): PeriodRoot {
  checkSecret(input.anchorSecret);
  const start = assertDate(input.start);
  const end = assertDate(input.end);
  if (start > end) fail("BAD_ROOT", "A range ends on or after its start");
  for (const e of input.entries) {
    if (e.date < start || e.date > end) fail("BAD_ROOT", `Entry ${e.id} is dated ${e.date}, outside ${start}..${end}`);
  }
  const seqs = input.entries.map((e) => e.seq);
  if (seqs.some((s, i) => i > 0 && s <= seqs[i - 1]!)) fail("BAD_ROOT", "Entries go in journal order, each once");
  const prevRoot = input.prevRoot ?? ZERO;
  hashBytes(prevRoot, "The previous root");
  const periodId = `${start}..${end}`;
  const entryLeaves = input.entries.map((e) => entryLeaf(input.anchorSecret, e.hash));
  const settlementLeaves = input.settlements.map((s) => settlementLeaf(input.anchorSecret, s));
  const entriesRoot = merkleRoot(entryLeaves);
  const settlementsRoot = merkleRoot(settlementLeaves);
  const chainHead = input.entries.at(-1)?.hash ?? GENESIS_HASH;
  const root = rootFromParts({
    businessTag: businessTag(input.anchorSecret),
    periodId,
    n: entryLeaves.length,
    m: settlementLeaves.length,
    prevRoot,
    chainHead,
    entriesRoot,
    settlementsRoot,
  });
  return { root, periodId, n: entryLeaves.length, m: settlementLeaves.length, chainHead, entriesRoot, settlementsRoot, entryLeaves, settlementLeaves };
}
