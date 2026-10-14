// ---------------------------------------------------------------------------
// Entry hashing for the tamper-evident journal.
//
// hash = BLAKE3("PNW::GL::ENTRY::v1" || 0x00 || canonical(entry))
//
// canonical() is a JSON array with every field in a fixed position (absent
// optional fields are null) and amounts as decimal strings, so the same entry
// always produces the same bytes. The 0x00 separator follows the decision to
// put the delimiter fix into new versioned domains rather than retrofit the
// portal's live hashes (PROGRESS.md, 2026-10-13).
//
// The array's first element is its layout version. Layout 1 is the original.
// Layout 2 is layout 1 with the entry's document hash (`source.doc`, the
// paystub or other document the entry commits to) appended as the last
// element. An entry without a document still hashes in layout 1, so every
// books file written before documents existed verifies unchanged.
// ---------------------------------------------------------------------------

import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Entry } from "./books";

export const ENTRY_DOMAIN = "PNW::GL::ENTRY::v1";
export const GENESIS_HASH = "0".repeat(64);

const opt = (v: string | undefined) => v ?? null;

export function canonicalEntry(entry: Omit<Entry, "hash">): string {
  const doc = entry.source.doc;
  return JSON.stringify([
    doc === undefined ? 1 : 2,
    entry.seq,
    entry.id,
    entry.date,
    opt(entry.memo),
    entry.source.kind,
    opt(entry.source.ref),
    entry.postedAt,
    opt(entry.reverses),
    opt(entry.replaces),
    entry.prevHash,
    entry.lines.map((l) => [
      l.accountId,
      l.debit.toString(),
      l.credit.toString(),
      opt(l.memo),
      opt(l.name?.kind),
      opt(l.name?.id),
      opt(l.tags?.class),
      opt(l.tags?.location),
      opt(l.tags?.project),
    ]),
    ...(doc === undefined ? [] : [doc]),
  ]);
}

export function hashEntry(entry: Omit<Entry, "hash">): string {
  const domain = utf8ToBytes(ENTRY_DOMAIN);
  const body = utf8ToBytes(canonicalEntry(entry));
  const input = new Uint8Array(domain.length + 1 + body.length);
  input.set(domain, 0);
  input.set(body, domain.length + 1); // byte at domain.length stays 0x00
  return bytesToHex(blake3(input));
}
