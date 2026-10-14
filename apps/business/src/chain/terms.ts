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

export type Terms = {
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

/** The keys of a terms document, in canonical order. */
export const TERMS_KEYS = ["version", "kind", "agreementId", "termsText", "payType", "rate", "frequency", "startDate", "businessName", "offeredAt"] as const;

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
  if (t.version !== 1) throw new TermsError("Unknown terms version");
  if (t.kind !== "terms") throw new TermsError("Not a terms document");
  if (typeof t.agreementId !== "string" || !HEX64.test(t.agreementId)) throw new TermsError("The terms need the offer time hash, 64 hex characters");
  if (typeof t.termsText !== "string" || !t.termsText.trim()) throw new TermsError("Write the terms of the offer");
  if (!PAY_TYPES.includes(t.payType as Terms["payType"])) throw new TermsError("Pay type must be hourly or salary");
  if (typeof t.rate !== "string" || !CENTS.test(t.rate)) throw new TermsError("The rate must be whole cents");
  if (!FREQUENCIES.includes(t.frequency as Terms["frequency"])) throw new TermsError("Choose how often they're paid");
  if (typeof t.startDate !== "string" || !DATE.test(t.startDate) || Number.isNaN(Date.parse(`${t.startDate}T00:00:00Z`))) throw new TermsError("The start date must be YYYY-MM-DD");
  if (typeof t.businessName !== "string" || !t.businessName.trim()) throw new TermsError("The terms need the business name");
  if (typeof t.offeredAt !== "string" || Number.isNaN(Date.parse(t.offeredAt))) throw new TermsError("The terms need the time of the offer");
  return {
    version: 1,
    kind: "terms",
    agreementId: t.agreementId,
    termsText: t.termsText,
    payType: t.payType as Terms["payType"],
    rate: t.rate,
    frequency: t.frequency as Terms["frequency"],
    startDate: t.startDate,
    businessName: t.businessName,
    offeredAt: t.offeredAt,
  };
}

/** The one byte-for-byte form of a terms document: the keys above, in that order, through `JSON.stringify`. */
export function canonicalTerms(terms: Terms): string {
  return JSON.stringify(validateTerms(terms));
}

/** A terms document back from its canonical (or any JSON) form. */
export function parseTerms(text: string): Terms {
  return validateTerms(JSON.parse(text));
}
