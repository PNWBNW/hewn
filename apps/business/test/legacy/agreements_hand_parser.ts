// ---------------------------------------------------------------------------
// The hand-written agreement-record readers, exactly as they were before the
// generated bindings (src/chain/agreement_records.ts, docs/VEIL.md step 2),
// kept for one purpose: the side-by-side tests read the same records with
// both and expect the same answers. Test-only; delete with those tests once
// the generated path has run in the app for a while.
// ---------------------------------------------------------------------------

import { arrayFieldHex } from "@pnw/records/packed";
import { carriesHalves, halfOf } from "@/chain/agreement_programs";
import type { AgreementRecord } from "@/chain/work/agreements";
import { AGREEMENT_V4 } from "@/chain/agreement_programs";

const bareHex = (hex: string): string => (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();
const byteArrayHex = (plaintext: string, field: string, length?: number): string | null => arrayFieldHex(plaintext, field, length);

const ADDRESS = (field: string) => new RegExp(`${field}:\\s*(aleo1[a-z0-9]{58})`);
const FIELD = (field: string) => new RegExp(`${field}:\\s*(\\d+)field`);

/** One record, or null if it isn't an unspent agreement record owned by this person. */
export function handParseAgreementRecord(raw: unknown, workerAddress: string, program: string = AGREEMENT_V4): AgreementRecord | null {
  const rec = raw as Record<string, unknown> | null;
  if (!rec || typeof rec !== "object") return null;
  if (rec.spent === true) return null;
  const kind = rec.recordName === "PendingAgreement" ? "pending" : rec.recordName === "FinalAgreement" ? "final" : null;
  if (!kind) return null;
  const plaintext = typeof rec.recordPlaintext === "string" ? rec.recordPlaintext : "";
  const worker = plaintext.match(ADDRESS("worker_address"))?.[1];
  const employer = plaintext.match(ADDRESS("employer_address"))?.[1];
  if (!worker || !employer || worker !== workerAddress) return null;
  const agreementId = byteArrayHex(plaintext, "agreement_id");
  const partiesKey = byteArrayHex(plaintext, "parties_key", 32);
  const termsDocHash = byteArrayHex(plaintext, "terms_doc_hash", 32);
  const employerNameHash = plaintext.match(FIELD("employer_name_hash"))?.[1];
  const workerNameHash = plaintext.match(FIELD("worker_name_hash"))?.[1];
  if (!agreementId || !partiesKey || !termsDocHash || !employerNameHash || !workerNameHash) return null;
  const record: AgreementRecord = { kind, agreementId, partiesKey, employerAddress: employer, workerAddress: worker, employerNameHash, workerNameHash, termsDocHash, plaintext, program };
  if (carriesHalves(program)) {
    const employerHalf = halfOf(plaintext, "employer_half");
    const workerHalf = halfOf(plaintext, "worker_half");
    if (employerHalf) record.employerHalf = employerHalf;
    if (workerHalf) record.workerHalf = workerHalf;
  }
  return record;
}


/** Every unspent FinalAgreement by agreement id, with the worker's public half when the record carries one (v5). */
export function handFinalAgreements(records: unknown[]): Map<string, { workerHalf?: string }> {
  const out = new Map<string, { workerHalf?: string }>();
  for (const raw of records) {
    const rec = raw as Record<string, unknown> | null;
    if (!rec || typeof rec !== "object" || rec.spent === true || rec.recordName !== "FinalAgreement") continue;
    const plaintext = typeof rec.recordPlaintext === "string" ? rec.recordPlaintext : "";
    const id = byteArrayHex(plaintext, "agreement_id");
    if (!id) continue;
    const workerHalf = halfOf(plaintext, "worker_half");
    out.set(id, workerHalf ? { workerHalf } : {});
  }
  return out;
}

/** The employer's unspent SentOffer (v5) for an agreement, as Shield gave it: the one input of `withdraw_offer`. */
export function handSentOfferPlaintext(records: unknown[], agreementId: string): string | null {
  for (const raw of records) {
    const rec = raw as Record<string, unknown> | null;
    if (!rec || typeof rec !== "object" || rec.spent === true || rec.recordName !== "SentOffer") continue;
    const plaintext = typeof rec.recordPlaintext === "string" ? rec.recordPlaintext : "";
    if (byteArrayHex(plaintext, "agreement_id") === bareHex(agreementId)) return plaintext;
  }
  return null;
}


/** agreement id (hex) → parties key (64 hex) for every unspent agreement record, pending or final. */
export function handPartiesKeysOf(records: unknown[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const raw of records) {
    const rec = raw as Record<string, unknown> | null;
    if (!rec || typeof rec !== "object") continue;
    if (rec.spent === true) continue;
    // v5's SentOffer is the employer's copy of a pending offer (chain/agreement_programs.ts).
    if (rec.recordName !== "FinalAgreement" && rec.recordName !== "PendingAgreement" && rec.recordName !== "SentOffer") continue;
    const plaintext = typeof rec.recordPlaintext === "string" ? rec.recordPlaintext : "";
    const agreementId = byteArrayHex(plaintext, "agreement_id");
    const partiesKey = byteArrayHex(plaintext, "parties_key", 32);
    if (agreementId && partiesKey && !keys.has(agreementId)) keys.set(agreementId, partiesKey);
  }
  return keys;
}
