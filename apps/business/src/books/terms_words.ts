// ---------------------------------------------------------------------------
// How an offer's terms put pay and dates into words. One definition for the
// draft the business starts from (chain/agreement_draft.ts) and for keeping
// those words in step when a counter-offer changes the pay or the start
// date (books/thread.ts). Pure.
// ---------------------------------------------------------------------------

import { formatCents } from "@pnw/ledger";
import { PAY_FREQUENCIES, type PayFrequency, type Worker } from "@pnw/payroll";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `2026-11-02` as `November 2, 2026`; anything else comes back as typed. */
export function longDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : date;
}

/** What each paycheck is for, in a few words: "$30.00 an hour, paid every two weeks". */
export function payLine(payType: Worker["payType"], rate: bigint, frequency: PayFrequency): string {
  const label = PAY_FREQUENCIES.find((f) => f.id === frequency)?.label.toLowerCase() ?? frequency;
  const amount = `$${formatCents(rate)}`;
  return payType === "hourly" ? `${amount} an hour, paid ${label}` : `${amount} a year, paid ${label}`;
}

// ---- Employment type and hours (Joshua, 2026-10-16: their own boxes in the offer) ----

export const EMPLOYMENT_TYPES = [
  { id: "full_time", label: "Full-time" },
  { id: "part_time", label: "Part-time" },
  { id: "seasonal", label: "Seasonal" },
  { id: "temporary", label: "Temporary" },
  { id: "contract", label: "Contract (fixed term)" },
] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number]["id"];

export const isEmploymentType = (v: unknown): v is EmploymentType => EMPLOYMENT_TYPES.some((t) => t.id === v);

/** "Full-time", "Contract (fixed term)". */
export const employmentLabel = (t: EmploymentType): string => EMPLOYMENT_TYPES.find((e) => e.id === t)!.label;

/**
 * Hours a week as an offer keeps them: more than 0 and at most 168, at most two
 * decimals, written the one way ("40", "37.5"). Null when it isn't that.
 */
export function cleanHours(v: string): string | null {
  const s = v.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 168 ? String(n) : null;
}

/** "about 40 a week". */
export const hoursLine = (hours: string): string => `about ${hours} a week`;

/** An offer's optional job fields: absent on offers made before they had their own boxes. */
export type JobFields = { employmentType?: EmploymentType; hoursPerWeek?: string };

/**
 * Checks the job fields of an offer's terms or of a counter-offer, and returns
 * them in their fixed order (employment type, then hours); a field that's
 * absent stays absent, so an older document keeps its exact bytes.
 */
export function validateJobFields(raw: Record<string, unknown>): JobFields {
  const out: JobFields = {};
  if (raw.employmentType !== undefined) {
    if (!isEmploymentType(raw.employmentType)) throw new Error("The employment type isn't one this app knows");
    out.employmentType = raw.employmentType;
  }
  if (raw.hoursPerWeek !== undefined) {
    if (typeof raw.hoursPerWeek !== "string" || cleanHours(raw.hoursPerWeek) !== raw.hoursPerWeek) throw new Error("Hours a week must be a number up to 168, written like 40 or 37.5");
    out.hoursPerWeek = raw.hoursPerWeek;
  }
  return out;
}
