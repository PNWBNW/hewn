// ---------------------------------------------------------------------------
// A first draft of an employment agreement's terms, built from what the
// books already know (name, pay, dates) plus a few plain fields the business
// fills in. The draft is only text: the business edits it freely before
// sending, and what the worker reads is exactly what was sent. It states
// facts and asks nothing legal of anyone; it is not legal advice.
//
// Pure: no network, no React, no storage.
// ---------------------------------------------------------------------------

import type { PayFrequency, Worker } from "@pnw/payroll";
import { type EmploymentType, cleanHours, employmentLabel, hoursLine, longDate, payLine } from "../books/terms_words";

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
  /** Missing leaves the line out. */
  employmentType?: EmploymentType;
  duties?: string;
  /** Blank or missing leaves the line out. */
  hoursPerWeek?: string;
  /** Whole days; blank or missing leaves the line out. */
  noticeDays?: string;
};

export { longDate, payLine } from "../books/terms_words";

const clean = (s: string | undefined) => s?.trim() ?? "";

/** Why a field can't go into a draft, or null. */
export function draftProblem(i: Pick<DraftInput, "hoursPerWeek" | "noticeDays">): string | null {
  const hours = clean(i.hoursPerWeek);
  if (hours && !cleanHours(hours)) return "Hours a week must be a number up to 168, like 40 or 37.5";
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
  if (i.employmentType) lines.push(`Employment: ${employmentLabel(i.employmentType)}.`);
  if (duties) lines.push(`Duties: ${duties}`);
  lines.push(`Pay: ${payLine(i.payType, i.rate, i.frequency)}.`);
  if (hours) lines.push(`Hours: ${hoursLine(cleanHours(hours)!)}.`);
  lines.push(end ? `Dates: starts ${longDate(i.startDate)} and ends ${longDate(end)}.` : `Dates: starts ${longDate(i.startDate)}; open-ended.`);
  lines.push(`Pay review: ${longDate(i.reviewDate)}.`);
  if (notice) lines.push(`Notice: either of us can end this agreement by giving ${Number(notice)} ${Number(notice) === 1 ? "day's" : "days'"} notice.`);
  lines.push("Accepting this offer means you agree to these terms.");
  return lines.join("\n\n");
}
