// ---------------------------------------------------------------------------
// An offer letter's attached files through the mailbox. One sealed document
// carries at most 256 KB, so each file is cut into pieces of exactly that size
// (the last one shorter) and the pieces of all the offer's files are numbered
// one after another: file 1's pieces first, then file 2's, and so on
// (`firstPieces` in books/offer_letter.ts).
//
// The pieces live under a kind of their own per offer, `offer_` and the
// start of the offer time hash, so a second offer to the same person never
// lands on the first one's slots. They are sealed with the agreement's parties
// key like every other document between the two.
//
// The receiver puts each file back together, checks its size and SHA-256
// against the terms (which the agreement record commits to), and only then
// keeps it. Nothing here logs a key or a lookup.
// ---------------------------------------------------------------------------

import { MAX_PAYLOAD_BYTES, MailboxError, type MailboxClient, lookupId, open, partiesKeyFromHex, seal } from "@pnw/mailbox";
import { sha256Hex } from "@pnw/vault";
import { OFFER_CHUNK_BYTES, type OfferFile, chunkCount, cleanFileName, checkOfferFile, firstPieces } from "../books/offer_letter";

if (OFFER_CHUNK_BYTES > MAX_PAYLOAD_BYTES) throw new Error("An offer file piece must fit in one mailbox document");

export class OfferFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfferFileError";
  }
}

/** The mailbox kind an offer's file pieces live under: unique per offer. */
export function offerFileKind(offerTimeHash: string): string {
  const hex = offerTimeHash.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new OfferFileError("The offer time hash must be 64 hex characters");
  return `offer_${hex.slice(0, 24)}`;
}

/**
 * The mailbox kind an offer's terms live under (slot 0): unique per offer,
 * from the start of its agreement id, which both sides know before reading
 * the terms. Offers sent before this existed used kind `terms`, slot 0,
 * shared by every offer between the two; readers fall back to it.
 */
export function offerTermsKind(agreementId: string): string {
  const hex = agreementId.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new OfferFileError("The agreement id must be 64 hex characters");
  return `terms_${hex.slice(0, 24)}`;
}

/** A file picked for an offer: its bytes, and how the terms will describe it. */
export type PickedFile = { file: OfferFile; bytes: Uint8Array<ArrayBuffer> };

/** Reads a picked file, checks it and fingerprints it, ready to go into the terms. */
export async function pickFile(name: string, type: string, bytes: Uint8Array<ArrayBuffer>): Promise<PickedFile> {
  const clean = cleanFileName(name);
  checkOfferFile(clean, type, bytes.length);
  return { file: { name: clean, type, size: bytes.length, sha256: await sha256Hex(bytes), chunks: chunkCount(bytes.length) }, bytes };
}

/** Every lookup the offer's file pieces use, in order: to drop them once they're safe in the receiver's vault. */
export function offerFileLookups(partiesKeyHex: string, offerTimeHash: string, files: readonly OfferFile[]): string[] {
  const kind = offerFileKind(offerTimeHash);
  const total = files.reduce((n, f) => n + f.chunks, 0);
  const key = partiesKeyFromHex(partiesKeyHex);
  try {
    return Array.from({ length: total }, (_, seq) => lookupId(key, kind, seq));
  } finally {
    key.fill(0);
  }
}

/**
 * Seals every piece of every file and puts them in the mailbox, in order.
 * Throws on the first failure, before the offer itself is signed, so nothing
 * is offered with files the person can't get.
 */
export async function sendOfferFiles(
  client: Pick<MailboxClient, "put">,
  partiesKeyHex: string,
  offerTimeHash: string,
  picked: readonly PickedFile[],
  onPiece?: (done: number, total: number) => void,
  /** The offer's keep-until day, so pieces nobody collects are swept with it. */
  keepUntil?: string,
): Promise<void> {
  const kind = offerFileKind(offerTimeHash);
  const total = picked.reduce((n, p) => n + p.file.chunks, 0);
  const starts = firstPieces(picked.map((p) => p.file));
  const key = partiesKeyFromHex(partiesKeyHex);
  let done = 0;
  try {
    for (const [i, { file, bytes }] of picked.entries()) {
      if (bytes.length !== file.size || chunkCount(bytes.length) !== file.chunks) throw new OfferFileError(`${file.name} changed after it was picked`);
      for (let c = 0; c < file.chunks; c++) {
        const piece = bytes.subarray(c * OFFER_CHUNK_BYTES, Math.min(bytes.length, (c + 1) * OFFER_CHUNK_BYTES));
        const sealed = await seal(key, kind, starts[i]! + c, piece);
        try {
          await client.put(sealed.lookup, sealed.envelope, keepUntil === undefined ? undefined : { keepUntil });
        } catch (e) {
          // The slots are this offer's own: a taken one can only be a retry of the same piece.
          if (!(e instanceof MailboxError && e.code === "CONFLICT")) throw e;
        }
        onPiece?.(++done, total);
      }
    }
  } finally {
    key.fill(0);
  }
}

export type FetchedFile = { file: OfferFile; bytes: Uint8Array<ArrayBuffer> };

/**
 * Collects one file's pieces, puts it back together and checks it against
 * the terms: every piece present, the right size, the right SHA-256. Throws a
 * plain message when any of that fails.
 */
export async function fetchOfferFile(
  client: Pick<MailboxClient, "get">,
  partiesKeyHex: string,
  offerTimeHash: string,
  files: readonly OfferFile[],
  index: number,
): Promise<FetchedFile> {
  const file = files[index];
  if (!file) throw new OfferFileError("That file isn't in the offer");
  const kind = offerFileKind(offerTimeHash);
  const start = firstPieces(files)[index]!;
  const out = new Uint8Array(file.size);
  let at = 0;
  const key = partiesKeyFromHex(partiesKeyHex);
  try {
    for (let c = 0; c < file.chunks; c++) {
      const seq = start + c;
      const envelope = await client.get(lookupId(key, kind, seq));
      if (!envelope) throw new OfferFileError(`${file.name} hasn't fully arrived yet`);
      let piece: Uint8Array;
      try {
        piece = await open(key, kind, seq, envelope);
      } catch {
        throw new OfferFileError(`${file.name} couldn't be opened`);
      }
      const expected = c < file.chunks - 1 ? OFFER_CHUNK_BYTES : file.size - c * OFFER_CHUNK_BYTES;
      if (piece.length !== expected || at + piece.length > file.size) throw new OfferFileError(`${file.name} doesn't match the offer`);
      out.set(piece, at);
      at += piece.length;
    }
  } finally {
    key.fill(0);
  }
  if (at !== file.size || (await sha256Hex(out)) !== file.sha256) throw new OfferFileError(`${file.name} doesn't match the offer`);
  return { file, bytes: out };
}
