// ---------------------------------------------------------------------------
// Agreement records, read through the bindings generated from each agreement
// program's ABI (src/chain/generated, docs/VEIL.md step 2). One decode for
// every reader: the worker's (work/agreements.ts), the employer's import and
// withdrawal (offer.ts), the parties keys (parties_key.ts).
//
// Veil's `parseRecord` turns Shield's record text into fields, and the
// generated decoders name and shape them: v5 packs 32 bytes as two u128
// words and a key half as four; v4 carries `[u8; N]` bytes. Which program a
// record came from shows in its agreement id: two words (v5) or 32 bytes
// (v4), the way the hand parser told them apart.
//
// The decoders turn a missing field into an empty list, a 0 or "", so what
// Hewn needs is checked here: every byte value is a byte and every word a
// u128, the lengths are right, an address is an address, a name hash is a
// field. Pure; nothing logged.
// ---------------------------------------------------------------------------

import { parseRecord } from "@provablehq/veil-core";
import { toFinalAgreement as v4Final, toPendingAgreement as v4Pending } from "./generated/employer_agreement_v4";
import { toFinalAgreement as v5Final, toPendingAgreement as v5Pending, toSentOffer as v5Sent } from "./generated/employer_agreement_v5";

export type AgreementRecordName = "PendingAgreement" | "SentOffer" | "FinalAgreement";

/** What the app reads from an agreement record, decoded; a field is null when the record doesn't carry it well formed. */
export type AgreementFields = {
  name: AgreementRecordName;
  /** 4 or 5: which agreement program the record's shape belongs to. */
  version: 4 | 5;
  /** Lower-case hex, no `0x`. */
  agreementId: string;
  partiesKey: string | null;
  termsDocHash: string | null;
  employerAddress: string | null;
  workerAddress: string | null;
  /** Decimal field elements, without `field`. */
  employerNameHash: string | null;
  workerNameHash: string | null;
  /** v5: a public key half as the record carries it, x then y, 128 hex characters. */
  employerHalfHex: string | null;
  workerHalfHex: string | null;
  /** The record exactly as Shield gave it: what a transition takes as the input. */
  plaintext: string;
};

const NAMES: readonly string[] = ["PendingAgreement", "SentOffer", "FinalAgreement"];
const WORD = 1n << 128n;
const ADDRESS = /^aleo1[a-z0-9]{58}$/;
const FIELD = /^(\d+)field$/;

/** Packed u128 words (high word first) as hex; null if any isn't a u128, or the total isn't `bytes` when given. */
export function wordsHex(words: readonly unknown[], bytes?: number): string | null {
  if (words.length === 0 || (bytes !== undefined && words.length * 16 !== bytes)) return null;
  let out = "";
  for (const w of words) {
    if (typeof w !== "bigint" || w < 0n || w >= WORD) return null;
    out += w.toString(16).padStart(32, "0");
  }
  return out;
}

/** `[u8; N]` values as hex; null if any isn't a byte, or there aren't `bytes` of them when given. */
export function bytesHex(values: readonly unknown[], bytes?: number): string | null {
  if (values.length === 0 || (bytes !== undefined && values.length !== bytes)) return null;
  let out = "";
  for (const v of values) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255) return null;
    out += v.toString(16).padStart(2, "0");
  }
  return out;
}

const address = (v: unknown): string | null => (typeof v === "string" && ADDRESS.test(v) ? v : null);
const fieldDigits = (v: unknown): string | null => (typeof v === "string" ? (FIELD.exec(v)?.[1] ?? null) : null);

/** An agreement record from Shield's `requestRecords`, decoded; null when it isn't one, or its id can't be read. */
export function decodeAgreementRecord(raw: unknown): AgreementFields | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.recordName === "string" && NAMES.includes(r.recordName) ? (r.recordName as AgreementRecordName) : null;
  const plaintext = typeof r.recordPlaintext === "string" ? r.recordPlaintext : null;
  if (!name || !plaintext) return null;
  let record;
  try {
    record = parseRecord(plaintext);
  } catch {
    return null; // not a record's text
  }
  const idLength = (record.fields.agreement_id?.value as unknown[] | undefined)?.length;
  if (idLength === 2) {
    const d = name === "PendingAgreement" ? v5Pending(record) : name === "SentOffer" ? v5Sent(record) : v5Final(record);
    const agreementId = wordsHex(d.agreement_id);
    if (!agreementId) return null;
    return {
      name,
      version: 5,
      agreementId,
      partiesKey: wordsHex(d.parties_key, 32),
      termsDocHash: wordsHex(d.terms_doc_hash, 32),
      employerAddress: address(d.employer_address),
      workerAddress: address(d.worker_address),
      employerNameHash: fieldDigits(d.employer_name_hash),
      workerNameHash: fieldDigits(d.worker_name_hash),
      employerHalfHex: wordsHex(d.employer_half, 64),
      workerHalfHex: name === "FinalAgreement" ? wordsHex((d as ReturnType<typeof v5Final>).worker_half, 64) : null,
      plaintext,
    };
  }
  if (idLength === 32 && name !== "SentOffer") {
    const d = name === "PendingAgreement" ? v4Pending(record) : v4Final(record);
    const agreementId = bytesHex(d.agreement_id);
    if (!agreementId) return null;
    return {
      name,
      version: 4,
      agreementId,
      partiesKey: bytesHex(d.parties_key, 32),
      termsDocHash: bytesHex(d.terms_doc_hash, 32),
      employerAddress: address(d.employer_address),
      workerAddress: address(d.worker_address),
      employerNameHash: fieldDigits(d.employer_name_hash),
      workerNameHash: fieldDigits(d.worker_name_hash),
      employerHalfHex: null,
      workerHalfHex: null,
      plaintext,
    };
  }
  return null;
}
