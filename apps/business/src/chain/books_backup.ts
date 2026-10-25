// ---------------------------------------------------------------------------
// The books backed up as letters to this account's own account
// (docs/CHAIN_BACKUP.md; the pieces themselves are books/books_backup.ts).
//
//   piece   compressed (chain/compress.ts), then sealed with the books' own data
//           key the way a receipt file is (`VaultSession.sealAttachment`, bound
//           to the vault and to `bb-<chain>-<seq>`). A snapshot also carries the
//           vault's key slots in the clear (@pnw/vault `keySlotsOf`: the data key
//           wrapped under the passphrase, and under the recovery key once there
//           is one), so either opens the backup and a restore rebuilds the vault
//           with the same keys. The slots are as safe as in a backup file: they
//           yield nothing without the passphrase or the recovery key.
//   pages   a piece is cut into pages that each fit one letter or one page of
//           `hewn_letters_v2` (chain/letters.ts), each with a short header:
//           "HB", version, chain, seq, page, pages.
//   lookup  each page's slot: a hash of the finder key (from the username and
//           the account's address, never the passphrase, so a recovery-key
//           restore finds them too), the chain, the seq and the page. Nothing in
//           a lookup links two backups for anyone without both.
//
// Restoring finds the newest chain whose snapshot is all there, reads its
// pieces in order until one is missing, and rebuilds from what it has.
//
// Pure apart from the injected reads: no wallet here (writing is the caller's
// letter box), nothing logged.
// ---------------------------------------------------------------------------

import { type KeySlots, type VaultSession, keySlotsOf, sha256Hex } from "@pnw/vault";
import { type BackupMark, type BackupPiece, type Rebuilt, changeOf, rebuild, snapshotOf, wantsSnapshot } from "../books/books_backup";
import type { Company } from "../books/company";
import { packPayload, unpackPayload } from "./compress";
import { LETTER_BYTES, PAGE_BYTES } from "./letters";

/** Where this account's backup stands, kept in the vault after each one is sent. */
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

export class ChainBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainBackupError";
  }
}

const VERSION = 1;
/** "HB", version, chain (2), seq (2), page (2), pages (2). */
const PAGE_HEADER = 11;
const CHUNK = PAGE_BYTES - PAGE_HEADER;
const MAX_CHAINS = 1000;
const MAX_PIECES = 256;
const MAX_PAGES = 512;

/** What one letter and one page cost, measured at deploy (docs/LETTERS.md), in ALEO. */
export const LETTER_FEE = 0.006578;
export const PAGE_FEE = 0.086886;

const enc = new TextEncoder();
const dec = new TextDecoder();
const u16 = (n: number) => [n >> 8, n & 0xff];
const readU16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;

/** Base64 a chunk at a time (spreading a large array into one call overflows the stack). */
function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** The secret the lookups come from: the username and the account, never the passphrase. */
export const finderKey = (username: string, address: string): Promise<string> => sha256Hex(enc.encode(`hewn:books-backup:v1\n${username}\n${address}`));

/** One page's slot. */
export const pageLookup = (finder: string, chain: number, seq: number, page: number): Promise<string> => sha256Hex(enc.encode(`${finder}:${chain}:${seq}:${page}`));

const attachmentId = (chain: number, seq: number) => `bb-${chain}-${seq}`;

// ---- a piece on the wire ----------------------------------------------------------

/** [version][header length (2)][header JSON][iv (12)][ciphertext]: the header holds the key slots on a snapshot. */
async function sealPiece(session: VaultSession, chain: number, seq: number, piece: BackupPiece): Promise<Uint8Array> {
  const body = await packPayload(enc.encode(JSON.stringify(piece)));
  const sealed = await session.sealAttachment(attachmentId(chain, seq), body as Uint8Array<ArrayBuffer>);
  const header = enc.encode(JSON.stringify(piece.kind === "snapshot" ? { slots: keySlotsOf(session.record) } : {}));
  const iv = unb64(sealed.iv);
  const data = unb64(sealed.data);
  const out = new Uint8Array(3 + header.length + iv.length + data.length);
  out.set([VERSION, ...u16(header.length)], 0);
  out.set(header, 3);
  out.set(iv, 3 + header.length);
  out.set(data, 3 + header.length + iv.length);
  return out;
}

function pieceHeader(bytes: Uint8Array): { slots?: KeySlots; sealedAt: number } {
  if (bytes.length < 3 || bytes[0] !== VERSION) throw new ChainBackupError("That isn't a backup piece from this app");
  const length = readU16(bytes, 1);
  if (3 + length + 12 > bytes.length) throw new ChainBackupError("A backup piece is cut short");
  const header = JSON.parse(dec.decode(bytes.subarray(3, 3 + length))) as { slots?: KeySlots };
  return { ...(header.slots ? { slots: header.slots } : {}), sealedAt: 3 + length };
}

async function openPiece(session: VaultSession, chain: number, seq: number, bytes: Uint8Array): Promise<unknown> {
  const { sealedAt } = pieceHeader(bytes);
  const opened = await session.openAttachment({
    id: attachmentId(chain, seq),
    iv: b64(bytes.subarray(sealedAt, sealedAt + 12)),
    data: b64(bytes.subarray(sealedAt + 12)),
  });
  return JSON.parse(dec.decode(await unpackPayload(opened)));
}

// ---- pages ----------------------------------------------------------------------

export type Page = { lookup: string; envelope: Uint8Array };

async function pagesOf(finder: string, chain: number, seq: number, bytes: Uint8Array): Promise<Page[]> {
  const count = Math.max(1, Math.ceil(bytes.length / CHUNK));
  if (count > MAX_PAGES) throw new ChainBackupError("These books are too big to back up this way");
  const pages: Page[] = [];
  for (let p = 0; p < count; p++) {
    const chunk = bytes.subarray(p * CHUNK, (p + 1) * CHUNK);
    const envelope = new Uint8Array(PAGE_HEADER + chunk.length);
    envelope.set([0x48, 0x42, VERSION, ...u16(chain), ...u16(seq), ...u16(p), ...u16(count)], 0);
    envelope.set(chunk, PAGE_HEADER);
    pages.push({ lookup: await pageLookup(finder, chain, seq, p), envelope });
  }
  return pages;
}

function pageHeader(envelope: Uint8Array, chain: number, seq: number, page: number): number {
  if (envelope.length < PAGE_HEADER || envelope[0] !== 0x48 || envelope[1] !== 0x42 || envelope[2] !== VERSION) throw new ChainBackupError("That isn't a backup page");
  if (readU16(envelope, 3) !== chain || readU16(envelope, 5) !== seq || readU16(envelope, 7) !== page) throw new ChainBackupError("A backup page is out of place");
  const pages = readU16(envelope, 9);
  if (pages < 1 || pages > MAX_PAGES || page >= pages) throw new ChainBackupError("A backup page is out of place");
  return pages;
}

/** Reads one of this account's letters to itself by its slot: its envelope, or null when there is none. */
export type ReadOwn = (lookup: string) => Promise<Uint8Array | null>;

/** A whole piece's bytes, page by page; null when any page is missing or out of place. */
async function readPiece(read: ReadOwn, finder: string, chain: number, seq: number): Promise<Uint8Array | null> {
  const first = await read(await pageLookup(finder, chain, seq, 0));
  if (!first) return null;
  let count: number;
  try {
    count = pageHeader(first, chain, seq, 0);
  } catch {
    return null;
  }
  const parts = [first.subarray(PAGE_HEADER)];
  for (let p = 1; p < count; p++) {
    const env = await read(await pageLookup(finder, chain, seq, p));
    if (!env) return null;
    try {
      pageHeader(env, chain, seq, p);
    } catch {
      return null;
    }
    parts.push(env.subarray(PAGE_HEADER));
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---- backing up -------------------------------------------------------------------

export type BackupPlan = {
  kind: "snapshot" | "change";
  chain: number;
  seq: number;
  pages: Page[];
  /** What it costs: how many letters and pages, and about how much ALEO when the account pays the fee. */
  letters: number;
  fullPages: number;
  fee: number;
  /** The state to keep once every page has been sent. */
  next: ChainState;
};

const cost = (pages: Page[]) => {
  const letters = pages.filter((p) => p.envelope.length <= LETTER_BYTES).length;
  const fullPages = pages.length - letters;
  return { letters, fullPages, fee: Math.round((letters * LETTER_FEE + fullPages * PAGE_FEE) * 1e4) / 1e4 };
};

/**
 * The next backup of `company`: a change on the current chain, or a snapshot starting the next one
 * (`wantsSnapshot`); null when nothing changed since the last. Nothing is sent: the caller shows the
 * cost, sends each page as a letter to the account's own account, and keeps `next` once all are in.
 */
export async function planBackup(input: { session: VaultSession; company: Company; username: string; address: string; state: ChainState | null }): Promise<BackupPlan | null> {
  const { session, company, state } = input;
  const finder = await finderKey(input.username, input.address);

  if (state) {
    const change = await changeOf(company, state.mark).catch(() => undefined); // a mark from other books: start over
    if (change === null) return null;
    if (change) {
      const seq = state.seq + 1;
      const bytes = await sealPiece(session, state.chain, seq, change.piece);
      if (!wantsSnapshot(state, bytes.length)) {
        const pages = await pagesOf(finder, state.chain, seq, bytes);
        const next: ChainState = { ...state, seq, mark: change.mark, changeBytes: state.changeBytes + bytes.length, changes: state.changes + 1 };
        return { kind: "change", chain: state.chain, seq, pages, ...cost(pages), next };
      }
    }
  }

  const chain = state ? state.chain + 1 : 0;
  const snap = await snapshotOf(company);
  const bytes = await sealPiece(session, chain, 0, snap.piece);
  const pages = await pagesOf(finder, chain, 0, bytes);
  const next: ChainState = { chain, seq: 0, mark: snap.mark, snapshotBytes: bytes.length, changeBytes: 0, changes: 0 };
  return { kind: "snapshot", chain, seq: 0, pages, ...cost(pages), next };
}

// ---- restoring ---------------------------------------------------------------------

export type Restored = Rebuilt & {
  /** The session the books were opened with: write the books into it to rebuild the vault. */
  session: VaultSession;
  /** Where to carry on backing up from. */
  state: ChainState;
  /** How many pieces the chain had that could be read (a missing one ends it). */
  found: number;
};

/**
 * Finds this account's backup and rebuilds the books: the newest chain whose snapshot can be read
 * and opened (`openSlots` turns its key slots into a session with the passphrase or recovery key the
 * person gave, throwing the vault's error when it's wrong), then its changes in order. Null when
 * there is no backup at all.
 */
export async function restoreBackup(input: {
  read: ReadOwn;
  username: string;
  address: string;
  openSlots: (slots: KeySlots) => Promise<VaultSession>;
}): Promise<Restored | null> {
  const finder = await finderKey(input.username, input.address);
  let newest = -1;
  while (newest + 1 < MAX_CHAINS && (await input.read(await pageLookup(finder, newest + 1, 0, 0)))) newest++;

  let lastError: unknown = null;
  for (let chain = newest; chain >= 0; chain--) {
    const snapshot = await readPiece(input.read, finder, chain, 0);
    if (!snapshot) continue; // a snapshot cut short: the chain before it
    let session: VaultSession;
    try {
      const { slots } = pieceHeader(snapshot);
      if (!slots) continue;
      session = await input.openSlots(slots);
    } catch (e) {
      lastError = e;
      if (e instanceof ChainBackupError) continue;
      throw e; // the wrong passphrase or recovery key: say so, don't fall back
    }
    const pieces: (unknown | null)[] = [];
    try {
      pieces.push(await openPiece(session, chain, 0, snapshot));
    } catch (e) {
      lastError = e;
      continue;
    }
    for (let seq = 1; seq < MAX_PIECES; seq++) {
      const bytes = await readPiece(input.read, finder, chain, seq);
      if (!bytes) break;
      pieces.push(await openPiece(session, chain, seq, bytes).catch(() => null));
    }
    const rebuilt = await rebuild(pieces);
    const seq = rebuilt.applied - 1;
    return {
      ...rebuilt,
      session,
      found: pieces.length,
      state: { chain, seq, mark: rebuilt.mark, snapshotBytes: snapshot.length, changeBytes: 0, changes: seq },
    };
  }
  if (lastError && !(lastError instanceof ChainBackupError)) throw lastError;
  return null;
}
