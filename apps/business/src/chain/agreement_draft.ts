// ---------------------------------------------------------------------------
// A first draft of an employment agreement's terms, built from what the
// books already know (name, pay, dates) plus a few plain fields the business
// fills in. The draft is only text: the business edits it freely before
// sending, and what the worker reads is exactly what was sent. It states
// facts and asks nothing legal of anyone; it is not legal advice.
//
// Pure: no network, no React, no storage.
// ---------------------------------------------------------------------------

import { formatCents } from "@pnw/ledger";
import { PAY_FREQUENCIES, type PayFrequency, type Worker } from "@pnw/payroll";

type PayType = Worker["payType"];

export type DraftInput = {
  businessName: string;
  workerName: string;
  payType: PayType;
  /** Cents: per hour when hourly, per year when salaried. */
  rate: bigint;
  frequency: PayFrequency;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  reviewDate: string;
  /** YYYY-MM-DD; blank or missing means open-ended. */
  endDate?: string;
  jobTitle?: string;
  duties?: string;
  /** Blank or missing leaves the line out. */
  hoursPerWeek?: string;
  /** Whole days; blank or missing leaves the line out. */
  noticeDays?: string;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `2026-11-02` as `November 2, 2026`; anything else comes back as typed. */
export function longDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : date;
}

/** What each paycheck is for, in a few words: "$30.00 an hour, paid every two weeks". */
export function payLine(payType: PayType, rate: bigint, frequency: PayFrequency): string {
  const label = PAY_FREQUENCIES.find((f) => f.id === frequency)?.label.toLowerCase() ?? frequency;
  const amount = `$${formatCents(rate)}`;
  return payType === "hourly" ? `${amount} an hour, paid ${label}` : `${amount} a year, paid ${label}`;
}

const clean = (s: string | undefined) => s?.trim() ?? "";

/** Why a field can't go into a draft, or null. */
export function draftProblem(i: Pick<DraftInput, "hoursPerWeek" | "noticeDays">): string | null {
  const hours = clean(i.hoursPerWeek);
  if (hours && !(Number(hours) > 0 && Number(hours) <= 168)) return "Hours a week must be a number between 1 and 168";
  const notice = clean(i.noticeDays);
  if (notice && !/^\d{1,3}$/.test(notice)) return "Notice must be a whole number of days";
  return null;
}

/** The draft terms, one short paragraph per fact. Throws on a field `draftProblem` names. */
export function draftTerms(i: DraftInput): string {
  const problem = draftProblem(i);
  if (problem) throw new Error(problem);
  const title = clean(i.jobTitle);
  const duties = clean(i.duties);
  const hours = clean(i.hoursPerWeek);
  const notice = clean(i.noticeDays);
  const end = clean(i.endDate);

  const lines: string[] = [`Offer of employment from ${clean(i.businessName) || "the business"} to ${clean(i.workerName)}.`];
  if (title) lines.push(`Role: ${title}.`);
  if (duties) lines.push(`Duties: ${duties}`);
  lines.push(`Pay: ${payLine(i.payType, i.rate, i.frequency)}.`);
  if (hours) lines.push(`Hours: about ${Number(hours)} a week.`);
  lines.push(end ? `Dates: starts ${longDate(i.startDate)} and ends ${longDate(end)}.` : `Dates: starts ${longDate(i.startDate)}; open-ended.`);
  lines.push(`Pay review: ${longDate(i.reviewDate)}.`);
  if (notice) lines.push(`Notice: either of us can end this agreement by giving ${Number(notice)} ${Number(notice) === 1 ? "day's" : "days'"} notice.`);
  lines.push("Accepting this offer means you agree to these terms.");
  return lines.join("\n\n");
}
