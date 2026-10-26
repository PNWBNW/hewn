// ---------------------------------------------------------------------------
// The books, as pieces of a backup chain (docs/CHAIN_BACKUP.md): a snapshot of
// the whole company document, then changes, each naming the hash of the state
// it builds on. Applying them in order rebuilds the books exactly, and a piece
// that doesn't fit stops the rebuild at the last good state, saying so.
//
// The journal only grows, so a change carries the entries posted since the
// piece before as a plain list; every other section of the document travels
// whole when it changed (they are small next to the journal). Each entry's
// `hash` and `prevHash` are left out (they look random and don't compress) and
// computed again on the way back; the head hash travels with the piece and
// must match.
//
// Where the pieces go and how they're sealed is chain/books_backup.ts. This
// file is pure: no network, no React, no storage.
// ---------------------------------------------------------------------------

import { type Entry, GENESIS_HASH, hashEntry } from "@pnw/ledger";
import { sha256Hex } from "@pnw/vault";
import { type Company, companyFromJson, companyToJson } from "./company";

/** The whole books. `doc` is the company document with each entry's two hashes left out. */
export type SnapshotPiece = { v: 1; kind: "snapshot"; doc: string; head: string; state: string };

/** What changed since the piece before (`prev`, that state's hash), giving state `state`. */
export type ChangePiece = {
  v: 1;
  kind: "change";
  prev: string;
  state: string;
  /** Entries posted since, in order, without their hashes; `head` is the last one's hash once computed. */
  entries: Record<string, unknown>[];
  head: string;
  /** The books without their entries (settings, accounts, period marks…), when that changed. */
  books?: string;
  /** Other sections of the document that changed or appeared, whole. */
  sections: Record<string, string>;
  /** Sections that went away. */
  removed: string[];
};

export type BackupPiece = SnapshotPiece | ChangePiece;

/** Where a chain stands after its last piece: enough to work out the next change. Kept in the vault. */
export type BackupMark = {
  /** The hash of the state the last piece gave. */
  state: string;
  /** How many journal entries that state held. */
  entries: number;
  /** A hash of each section of that state's document (`books` without its entries). */
  sections: Record<string, string>;
};

/** Where this account's backup stands, kept in the vault after each one is sent in full. */
export type ChainState = {
  /** The chain being added to (0, 1, 2…: a new snapshot starts the next one). */
  chain: number;
  /** The last piece sent in it (the snapshot is 0). */
  seq: number;
  mark: BackupMark;
  /** Sealed sizes: the snapshot's, and the changes' since it. */
  snapshotBytes: number;
  changeBytes: number;
  changes: number;
};

const HEX64 = /^[0-9a-f]{64}$/;
const count = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** Checks a chain state read back from the vault. */
export function validateChainState(raw: unknown): ChainState {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const m = (s.mark && typeof s.mark === "object" ? s.mark : {}) as Record<string, unknown>;
  const sections = (m.sections && typeof m.sections === "object" ? m.sections : null) as Record<string, unknown> | null;
  if (
    !count(s.chain) || !count(s.seq) || !count(s.snapshotBytes) || !count(s.changeBytes) || !count(s.changes) ||
    typeof m.state !== "string" || !HEX64.test(m.state) || !count(m.entries) ||
    !sections || !Object.values(sections).every((v) => typeof v === "string" && HEX64.test(v))
  ) {
    throw new BackupFormatError("The backup's place isn't readable");
  }
  return {
    chain: s.chain as number,
    seq: s.seq as number,
    mark: { state: m.state, entries: m.entries as number, sections: { ...(sections as Record<string, string>) } },
    snapshotBytes: s.snapshotBytes as number,
    changeBytes: s.changeBytes as number,
    changes: s.changes as number,
  };
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFormatError";
  }
}

/** Changes a chain takes before a new snapshot starts the next one. */
export const MAX_CHANGES = 12;

/**
 * Whether the next backup should start a new chain with a snapshot (Joshua, 2026-10-26): once the
 * changes since the snapshot, this one included, would add up to more than half the snapshot, or
 * the chain already has `MAX_CHANGES` changes.
 */
export function wantsSnapshot(chain: { snapshotBytes: number; changeBytes: number; changes: number } | null, nextChangeBytes: number): boolean {
  if (!chain) return true;
  return chain.changes >= MAX_CHANGES || chain.changeBytes + nextChangeBytes > chain.snapshotBytes / 2;
}

// ---- the document ------------------------------------------------------------

type Doc = Record<string, unknown>;
type BooksDoc = { format: string; books: Record<string, unknown> & { entries: Record<string, unknown>[] } };

/** Amounts are bigints in the books and `{ $c: "…" }` in their JSON (@pnw/ledger serialize.ts). */
const UNBIG = (_key: string, value: unknown) => (typeof value === "bigint" ? { $c: value.toString() } : value);
const BIG = (_key: string, value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as { $c?: unknown }).$c === "string" && /^-?\d+$/.test((value as { $c: string }).$c)
    ? BigInt((value as { $c: string }).$c)
    : value;

/**
 * What a backup keeps about the backups themselves: nothing. When the last one was saved and where
 * the chain stands change with every backup, so they're left out of what is backed up and hashed (a
 * restore sets them afresh). The view key never goes out as letters (books/view_key.ts): after a
 * restore from them, the business enters it again in Settings.
 */
const NOT_BACKED_UP = ["backedUpAt", "chainBackup", "viewKey"] as const;

/** The company document as its sections (each a JSON string), normalised by a round trip. */
function docOf(company: Company): Doc {
  const doc = JSON.parse(companyToJson(companyFromJson(companyToJson(company)))) as Doc;
  for (const k of NOT_BACKED_UP) delete doc[k];
  return doc;
}

/** JSON with every object's keys sorted, nested section strings included, so equal states hash equal. */
function canonical(value: unknown): string {
  if (typeof value === "string" && /^[[{]/.test(value)) {
    try {
      return canonical(JSON.parse(value));
    } catch {
      return JSON.stringify(value);
    }
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Doc)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const hash = (text: string) => sha256Hex(new TextEncoder().encode(text));

/** The hash a piece names for a state: of the canonical document. */
export const stateHash = (company: Company): Promise<string> => hash(canonical(docOf(company)));

function booksDoc(doc: Doc): BooksDoc {
  if (typeof doc.books !== "string") throw new BackupFormatError("The books are missing");
  return JSON.parse(doc.books) as BooksDoc;
}

const strip = (e: Record<string, unknown>): Record<string, unknown> => {
  const { hash: _h, prevHash: _p, ...rest } = e;
  return rest;
};

/** The books without their entries, as JSON: what a change carries when it changed. */
const booksMeta = (b: BooksDoc): string => JSON.stringify({ ...b, books: { ...b.books, entries: [] } });

async function markOf(doc: Doc, state: string): Promise<BackupMark> {
  const b = booksDoc(doc);
  const sections: Record<string, string> = { books: await hash(canonical(booksMeta(b))) };
  for (const [k, v] of Object.entries(doc)) if (k !== "books" && typeof v === "string") sections[k] = await hash(canonical(v));
  return { state, entries: b.books.entries.length, sections };
}

const lastHash = (b: BooksDoc): string => (b.books.entries.at(-1)?.hash as string | undefined) ?? GENESIS_HASH;

// ---- making pieces -----------------------------------------------------------------

/** The snapshot of `company`, and the mark it leaves. */
export async function snapshotOf(company: Company): Promise<{ piece: SnapshotPiece; mark: BackupMark }> {
  const doc = docOf(company);
  const b = booksDoc(doc);
  const stripped = { ...doc, books: JSON.stringify({ ...b, books: { ...b.books, entries: b.books.entries.map(strip) } }) };
  const state = await stateHash(company);
  return { piece: { v: 1, kind: "snapshot", doc: JSON.stringify(stripped), head: lastHash(b), state }, mark: await markOf(doc, state) };
}

/**
 * What changed in `company` since `mark`, and the mark it leaves; null when nothing did. Refuses
 * when the journal has fewer entries than the mark (it only grows), which means the mark belongs to
 * other books: start a new chain.
 */
export async function changeOf(company: Company, mark: BackupMark): Promise<{ piece: ChangePiece; mark: BackupMark } | null> {
  const doc = docOf(company);
  const state = await stateHash(company);
  if (state === mark.state) return null;
  const b = booksDoc(doc);
  if (b.books.entries.length < mark.entries) throw new BackupFormatError("These books have fewer entries than the last backup: start a new one");
  const next = await markOf(doc, state);
  const sections: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === "books" || typeof v !== "string") continue;
    if (next.sections[k] !== mark.sections[k]) sections[k] = v;
  }
  const removed = Object.keys(mark.sections).filter((k) => k !== "books" && !(k in next.sections));
  const piece: ChangePiece = {
    v: 1,
    kind: "change",
    prev: mark.state,
    state,
    entries: b.books.entries.slice(mark.entries).map(strip),
    head: lastHash(b),
    sections,
    removed,
    ...(next.sections.books !== mark.sections.books ? { books: booksMeta(b) } : {}),
  };
  return { piece, mark: next };
}

// ---- applying pieces ---------------------------------------------------------------

/** Gives entries back their two hashes, continuing from `prev`; the last must come out as `head`. */
function rehash(entries: Record<string, unknown>[], prev: string, head: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const e of entries) {
    const revived = JSON.parse(JSON.stringify(e), BIG) as Omit<Entry, "hash" | "prevHash">;
    const withPrev = { ...revived, prevHash: prev } as Omit<Entry, "hash">;
    prev = hashEntry(withPrev);
    out.push(JSON.parse(JSON.stringify({ ...withPrev, hash: prev }, UNBIG)) as Record<string, unknown>);
  }
  if (prev !== head) throw new BackupFormatError("The journal doesn't come back the same");
  return out;
}

function validate(raw: unknown): BackupPiece {
  const p = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
  if (!p || p.v !== 1) throw new BackupFormatError("That isn't a backup piece");
  const hex = (x: unknown) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
  if (!hex(p.state) || !hex(p.head)) throw new BackupFormatError("A backup piece names its state");
  if (p.kind === "snapshot" && typeof p.doc === "string") return p as unknown as SnapshotPiece;
  const sections = p.sections as Record<string, unknown> | null;
  const isObject = (e: unknown) => !!e && typeof e === "object" && !Array.isArray(e);
  if (
    p.kind === "change" &&
    hex(p.prev) &&
    Array.isArray(p.entries) &&
    p.entries.every(isObject) &&
    isObject(sections) &&
    Object.values(sections!).every((v) => typeof v === "string") &&
    Array.isArray(p.removed) &&
    p.removed.every((k) => typeof k === "string") &&
    (p.books === undefined || typeof p.books === "string")
  )
    return p as unknown as ChangePiece;
  throw new BackupFormatError("That isn't a backup piece");
}

/** The state after `raw` on top of `doc` (null for a snapshot), checked against the hash it names. */
async function applyOne(doc: Doc | null, raw: unknown): Promise<Doc> {
  const piece = validate(raw);
  let next: Doc;
  if (piece.kind === "snapshot") {
    next = JSON.parse(piece.doc) as Doc;
    const b = booksDoc(next);
    next.books = JSON.stringify({ ...b, books: { ...b.books, entries: rehash(b.books.entries, GENESIS_HASH, piece.head) } });
  } else {
    if (!doc) throw new BackupFormatError("A change needs the snapshot before it");
    const base = booksDoc(doc);
    const meta = piece.books ? (JSON.parse(piece.books) as BooksDoc) : base;
    const entries = [...base.books.entries, ...rehash(piece.entries, lastHash(base), piece.head)];
    next = { ...doc, ...piece.sections, books: JSON.stringify({ ...meta, books: { ...meta.books, entries } }) };
    for (const k of piece.removed) delete next[k];
  }
  const company = companyFromJson(JSON.stringify(next));
  if ((await stateHash(company)) !== piece.state) throw new BackupFormatError("A piece doesn't give the state it names");
  return docOf(company);
}

export type Rebuilt = {
  company: Company;
  /** How many pieces were applied (the snapshot is one). */
  applied: number;
  /** Set when a piece didn't fit: its place in the chain, and why. The books are as of the piece before. */
  stopped?: { at: number; reason: string };
  /** The mark of the last piece applied, so backups can carry on from it. */
  mark: BackupMark;
};

/**
 * Rebuilds the books from a chain's pieces in order: the snapshot, then each change whose `prev`
 * is the state so far. Stops at the first piece that is missing (null), doesn't parse, doesn't
 * follow on, or doesn't give the state it names, keeping the books as of the piece before.
 */
export async function rebuild(pieces: readonly (unknown | null)[]): Promise<Rebuilt> {
  let doc: Doc | null = null;
  let state = "";
  let applied = 0;
  let stopped: Rebuilt["stopped"];
  for (const [i, raw] of pieces.entries()) {
    try {
      if (raw === null) throw new BackupFormatError("A piece is missing");
      const piece = validate(raw);
      if (i === 0 && piece.kind !== "snapshot") throw new BackupFormatError("A chain starts with a snapshot");
      if (i > 0 && (piece.kind !== "change" || piece.prev !== state)) throw new BackupFormatError("A piece doesn't follow the one before");
      doc = await applyOne(doc, piece);
      state = piece.state;
      applied++;
    } catch (e) {
      stopped = { at: i, reason: e instanceof Error ? e.message : String(e) };
      break;
    }
  }
  if (!doc) throw new BackupFormatError(stopped?.reason ?? "There is nothing to rebuild");
  const company = companyFromJson(JSON.stringify(doc));
  return { company, applied, ...(stopped ? { stopped } : {}), mark: await markOf(doc, state) };
}
