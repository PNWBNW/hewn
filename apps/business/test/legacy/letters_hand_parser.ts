// ---------------------------------------------------------------------------
// The hand-written letter parser, exactly as it was before the generated
// bindings (src/chain/generated, docs/VEIL.md step 2), kept for one purpose:
// the side-by-side tests read the same records with both and expect the same
// answer. Test-only (test/ is outside the app's build); delete it with the
// tests once the generated decoders have run in the app for a while.
// ---------------------------------------------------------------------------

import { LETTER_FIELDS, type LetterRecord, PAGE_FIELDS, lookupOf, unpackParcel } from "@/chain/letters";

const ADDRESS = /^aleo1[02-9ac-hj-np-z]{58}$/;
const RECORD_KINDS: Record<string, LetterRecord["kind"]> = { Letter: "letter", Page: "page", SentLetter: "sent" };

const arrayOf = (plaintext: string, name: string): string | null => new RegExp(`\\b${name}\\s*:\\s*\\[([^\\]]*)\\]`).exec(plaintext)?.[1] ?? null;
const numbersOf = (list: string, suffix: string): bigint[] => [...list.matchAll(new RegExp(`(\\d+)${suffix}\\b`, "g"))].map((m) => BigInt(m[1]!));

/** One record from Shield's `requestRecords` as a letter, or null when it isn't one this app can read. */
export function handParseLetterRecord(raw: unknown): LetterRecord | null {
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
