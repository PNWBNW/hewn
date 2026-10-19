// ---------------------------------------------------------------------------
// A paystub document as it arrives: the canonical form the books hashed
// (keys in hash order, amounts as decimal strings, absent fields null),
// read back into a typed document so it can be hashed again and shown.
// ---------------------------------------------------------------------------

import { type PaystubDocument, paystubHash } from "@pnw/payroll";

export class PaystubDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaystubDocumentError";
  }
}

const MONEY = ["rate", "gross", "federalIncomeTax", "socialSecurity", "medicare", "additionalMedicare", "employerSocialSecurity", "employerMedicare", "net", "ytdGross", "ytdWithheld"] as const;
const TEXT = ["businessName", "workerId", "workerName", "payDate", "periodStart", "periodEnd", "runId"] as const;

/** Reads a received document; throws if any field is missing or of the wrong shape. */
export function paystubFromCanonical(raw: unknown): PaystubDocument {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PaystubDocumentError("The paystub isn't a document");
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) throw new PaystubDocumentError("Unknown paystub version");
  if (r.payType !== "hourly" && r.payType !== "salary") throw new PaystubDocumentError("Unknown pay type");
  if (typeof r.position !== "number" || !Number.isInteger(r.position) || r.position < 1) throw new PaystubDocumentError("The paystub's position must be a whole number");
  if (r.hours !== null && r.hours !== undefined && (typeof r.hours !== "number" || !Number.isFinite(r.hours))) throw new PaystubDocumentError("Hours must be a number");
  const hasOvertime = r.overtimeHours !== undefined || r.overtimeRate !== undefined;
  if (hasOvertime && (typeof r.overtimeHours !== "number" || !Number.isFinite(r.overtimeHours) || typeof r.overtimeRate !== "number" || !Number.isFinite(r.overtimeRate))) {
    throw new PaystubDocumentError("Overtime needs its hours and its rate, as numbers");
  }
  const doc = { version: 1, payType: r.payType, position: r.position } as PaystubDocument;
  for (const k of TEXT) {
    if (typeof r[k] !== "string") throw new PaystubDocumentError(`The paystub's ${k} is missing`);
    doc[k] = r[k];
  }
  for (const k of MONEY) {
    if (typeof r[k] !== "string" || !/^-?\d+$/.test(r[k])) throw new PaystubDocumentError(`The paystub's ${k} must be a whole number of cents`);
    doc[k] = BigInt(r[k]);
  }
  if (typeof r.hours === "number") doc.hours = r.hours;
  if (hasOvertime) {
    doc.overtimeHours = r.overtimeHours as number;
    doc.overtimeRate = r.overtimeRate as number;
  }
  return doc;
}

/** The hash the books committed to, recomputed from what arrived. */
export function receivedPaystubHash(raw: unknown): { document: PaystubDocument; hash: string } {
  const document = paystubFromCanonical(raw);
  // paystubHash canonicalises the typed document, so extra or reordered keys in what arrived change nothing.
  return { document, hash: paystubHash(document) };
}
