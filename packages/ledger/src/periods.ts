// ---------------------------------------------------------------------------
// Dates and accounting periods.
//
// Periods are calendar months ("2026-10"). The books keep two marks:
//   closedThrough — every period up to and including this one is closed:
//                   no new postings dated in it. Can be moved back (reopened)
//                   as a deliberate, logged action.
//   lockedThrough — closed for good: can't be reopened, and entries dated in
//                   it can't be reversed either. Never moves back.
// lockedThrough ≤ closedThrough always.
// ---------------------------------------------------------------------------

import { fail } from "./errors";

/** "YYYY-MM-DD" */
export type IsoDate = string;
/** "YYYY-MM" */
export type PeriodId = string;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD = /^(\d{4})-(\d{2})$/;

export function assertDate(date: string): IsoDate {
  const m = DATE.exec(date);
  if (!m) fail("BAD_DATE", `Not a date (YYYY-MM-DD): "${date}"`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    fail("BAD_DATE", `No such date: "${date}"`);
  }
  return date;
}

export function assertPeriod(period: string): PeriodId {
  const m = PERIOD.exec(period);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) fail("BAD_PERIOD", `Not a period (YYYY-MM): "${period}"`);
  return period;
}

export function periodOf(date: IsoDate): PeriodId {
  return assertDate(date).slice(0, 7);
}

/** Last day of a period, e.g. "2026-02" → "2026-02-28". */
export function periodEnd(period: PeriodId): IsoDate {
  const [y, m] = assertPeriod(period).split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, "0")}`;
}

export function previousPeriod(period: PeriodId): PeriodId {
  const [y, m] = assertPeriod(period).split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** First day of the fiscal year containing `date`. */
export function fiscalYearStart(date: IsoDate, startMonth: number): IsoDate {
  const [y, m] = assertDate(date).split("-").map(Number) as [number, number];
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, "0")}-01`;
}

// ISO strings of the same shape compare correctly as plain strings.

export type PeriodMarks = { closedThrough?: PeriodId; lockedThrough?: PeriodId };

export type PeriodStatus = "open" | "closed" | "locked";

export function statusOf(marks: PeriodMarks, period: PeriodId): PeriodStatus {
  if (marks.lockedThrough && period <= marks.lockedThrough) return "locked";
  if (marks.closedThrough && period <= marks.closedThrough) return "closed";
  return "open";
}

/** Throws unless entries may be dated on `date`. */
export function assertOpen(marks: PeriodMarks, date: IsoDate): void {
  const period = periodOf(date);
  const status = statusOf(marks, period);
  if (status === "locked") fail("PERIOD_LOCKED", `${period} is locked; nothing can be posted to it`);
  if (status === "closed") fail("PERIOD_CLOSED", `${period} is closed; date the entry in an open period or reopen ${period}`);
}
