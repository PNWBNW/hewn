// ---------------------------------------------------------------------------
// A paystub document as it arrives: the canonical form the books hashed
// (keys in hash order, amounts as decimal strings, absent fields null),
// read back into a typed document so it can be hashed again and shown.
// ---------------------------------------------------------------------------

import { formatCents } from "@pnw/ledger";
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
  if (r.calloutHours !== undefined || r.calloutRate !== undefined) {
    if (typeof r.calloutHours !== "number" || !Number.isFinite(r.calloutHours) || typeof r.calloutRate !== "number" || !Number.isFinite(r.calloutRate)) {
      throw new PaystubDocumentError("Callouts need their hours and their rate, as numbers");
    }
    doc.calloutHours = r.calloutHours;
    doc.calloutRate = r.calloutRate;
  }
  if (r.onCallDays !== undefined || r.onCallPay !== undefined) {
    if (typeof r.onCallDays !== "number" || !Number.isInteger(r.onCallDays) || typeof r.onCallPay !== "string" || !/^\d+$/.test(r.onCallPay)) {
      throw new PaystubDocumentError("On call needs its days and what they paid");
    }
    doc.onCallDays = r.onCallDays;
    doc.onCallPay = BigInt(r.onCallPay);
  }
  return doc;
}

/** The hash the books committed to, recomputed from what arrived. */
export function receivedPaystubHash(raw: unknown): { document: PaystubDocument; hash: string } {
  const document = paystubFromCanonical(raw);
  // paystubHash canonicalises the typed document, so extra or reordered keys in what arrived change nothing.
  return { document, hash: paystubHash(document) };
}

/**
 * What the paycheck paid for, one line each (Joshua, 2026-10-20: callouts and on call are lines of
 * their own): regular hours or salary, overtime, callouts, days on call. Hourly lines say the rate
 * and hours; gross pay is rounded once over all of them.
 */
export function payLines(doc: PaystubDocument): { label: string; value: string }[] {
  const at = (mult: number) => formatCents((doc.rate * BigInt(Math.round(mult * 100)) + 50n) / 100n);
  const lines: { label: string; value: string }[] = [];
  if (doc.payType === "salary") lines.push({ label: "Salary", value: `${formatCents(doc.rate)} a year, for ${doc.periodStart} to ${doc.periodEnd}` });
  else lines.push({ label: "Regular hours", value: `${doc.hours ?? 0} h × ${formatCents(doc.rate)}` });
  if (doc.overtimeHours !== undefined && doc.overtimeRate !== undefined) lines.push({ label: `Overtime (${doc.overtimeRate}×)`, value: `${doc.overtimeHours} h × ${at(doc.overtimeRate)}` });
  if (doc.calloutHours !== undefined && doc.calloutRate !== undefined) lines.push({ label: `Callouts (${doc.calloutRate}×)`, value: `${doc.calloutHours} h × ${at(doc.calloutRate)}` });
  if (doc.onCallDays !== undefined && doc.onCallPay !== undefined) {
    lines.push({ label: "On call", value: `${doc.onCallDays} ${doc.onCallDays === 1 ? "day" : "days"}, ${formatCents(doc.onCallPay)}` });
  }
  return lines;
}
