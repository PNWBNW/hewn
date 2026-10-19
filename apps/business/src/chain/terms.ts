// ---------------------------------------------------------------------------
// The terms document an offer carries: what the employer proposes, in a form
// both apps hash the same way. The agreement record on the rail holds only
// `terms_doc_hash` (and a root over it); the document itself travels through
// the mailbox, sealed with the agreement's parties key, and lives in each
// side's vault.
//
// A CONTRACT SHARED WITH THE WORKER'S APP (src/chain/work/terms.ts there is
// the same helper): exactly these keys, in exactly this order, and
// `canonicalTerms` is `JSON.stringify` of that object. The receiver checks
// `computeTermsDocHash(canonicalTerms(received)) === record.terms_doc_hash`
// and nothing else; change the shape and every offer in flight fails that
// check, so bump `version` instead.
//
// `agreementId` here is NOT the agreement id on the record: that id depends
// on this document's hash, so it cannot be inside the document. It holds the
// offer time hash (64 lower-case hex characters, no `0x`), which the
// agreement id is derived from. The receiver matches agreements by the
// record's own `agreement_id`.
// ---------------------------------------------------------------------------

import { type Letter, type OfferFile, LetterError, validateExpiry, validateLetter, validateOfferFiles } from "../books/offer_letter";
import { type JobFields, validateJobFields } from "../books/terms_words";
import { type WorkWeek, validateWorkWeek } from "../books/work_week";

/** Version 1: pay, dates and the agreement's own terms text. */
export type TermsV1 = {
  version: 1;
  kind: "terms";
  /** The offer time hash, hex, no `0x` (see above). */
  agreementId: string;
  /** Free text, as typed. */
  termsText: string;
  payType: "hourly" | "salary";
  /** Cents, as a decimal string: per hour (hourly) or per year (salary). */
  rate: string;
  frequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
  /** YYYY-MM-DD. */
  startDate: string;
  businessName: string;
  /** ISO timestamp of the offer. */
  offeredAt: string;
};

/**
 * Version 2, the offer letter (Joshua, 2026-10-16): everything in version 1,
 * then the letter's sections and the attached files, in that order. The
 * files' fingerprints are inside the document, so the terms hash covers them.
 * Then, on offers made since the job fields had their own boxes, the
 * employment type and the hours a week (each only when given: an offer
 * without them keeps its exact bytes); then, on offers made since the work
 * week was part of an offer (2026-10-19), the work week (books/work_week.ts).
 */
export type TermsV2 = Omit<TermsV1, "version"> &
  JobFields & {
    version: 2;
    /** ISO time the offer stops being open (every offer has one; at most 30 days after it's made). */
    expiresAt: string;
    letter: Letter;
    files: OfferFile[];
    /** The work week both sides draw hours on; absent on offers from before it existed. */
    workWeek?: WorkWeek;
  };

export type Terms = TermsV1 | TermsV2;

/** The keys of a terms document, in canonical order (version 2 adds `expiresAt`, `letter` and `files` at the end, then the job fields and the work week when given). */
export const TERMS_KEYS = ["version", "kind", "agreementId", "termsText", "payType", "rate", "frequency", "startDate", "businessName", "offeredAt"] as const;
export const TERMS_V2_KEYS = [...TERMS_KEYS, "expiresAt", "letter", "files", "employmentType", "hoursPerWeek", "workWeek"] as const;

const PAY_TYPES = ["hourly", "salary"] as const;
const FREQUENCIES = ["weekly", "biweekly", "semimonthly", "monthly"] as const;
const HEX64 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CENTS = /^\d+$/;

export class TermsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TermsError";
  }
}

/** Checks every field of a terms document and returns a clean copy (no extra keys). */
export function validateTerms(raw: unknown): Terms {
  const t = raw as Partial<Terms> | null;
  if (!t || typeof t !== "object") throw new TermsError("The terms must be an object");
  if (t.version !== 1 && t.version !== 2) throw new TermsError("Unknown terms version");
  if (t.kind !== "terms") throw new TermsError("Not a terms document");
  if (typeof t.agreementId !== "string" || !HEX64.test(t.agreementId)) throw new TermsError("The terms need the offer time hash, 64 hex characters");
  if (typeof t.termsText !== "string" || !t.termsText.trim()) throw new TermsError("Write the terms of the offer");
  if (!PAY_TYPES.includes(t.payType as Terms["payType"])) throw new TermsError("Pay type must be hourly or salary");
  if (typeof t.rate !== "string" || !CENTS.test(t.rate)) throw new TermsError("The rate must be whole cents");
  if (!FREQUENCIES.includes(t.frequency as Terms["frequency"])) throw new TermsError("Choose how often they're paid");
  if (typeof t.startDate !== "string" || !DATE.test(t.startDate) || Number.isNaN(Date.parse(`${t.startDate}T00:00:00Z`))) throw new TermsError("The start date must be YYYY-MM-DD");
  if (typeof t.businessName !== "string" || !t.businessName.trim()) throw new TermsError("The terms need the business name");
  if (typeof t.offeredAt !== "string" || Number.isNaN(Date.parse(t.offeredAt))) throw new TermsError("The terms need the time of the offer");
  const common = {
    kind: "terms" as const,
    agreementId: t.agreementId,
    termsText: t.termsText,
    payType: t.payType as Terms["payType"],
    rate: t.rate,
    frequency: t.frequency as Terms["frequency"],
    startDate: t.startDate,
    businessName: t.businessName,
    offeredAt: t.offeredAt,
  };
  if (t.version === 1) return { version: 1, ...common };
  const v2 = raw as Partial<TermsV2>;
  let job: JobFields;
  let workWeek: { workWeek: WorkWeek } | Record<string, never> = {};
  try {
    job = validateJobFields(v2 as Record<string, unknown>);
    if (v2.workWeek !== undefined) workWeek = { workWeek: validateWorkWeek(v2.workWeek) };
  } catch (e) {
    throw new TermsError(e instanceof Error ? e.message : "The job fields aren't valid");
  }
  try {
    return { version: 2, ...common, expiresAt: validateExpiry(common.offeredAt, v2.expiresAt), letter: validateLetter(v2.letter), files: validateOfferFiles(v2.files), ...job, ...workWeek };
  } catch (e) {
    throw e instanceof LetterError ? new TermsError(e.message) : e;
  }
}

/** The one byte-for-byte form of a terms document: the keys above, in that order, through `JSON.stringify`. */
export function canonicalTerms(terms: Terms): string {
  return JSON.stringify(validateTerms(terms));
}

/** A terms document back from its canonical (or any JSON) form. */
export function parseTerms(text: string): Terms {
  return validateTerms(JSON.parse(text));
}
