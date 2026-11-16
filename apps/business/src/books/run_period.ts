// Run payroll's pay period before anyone changes it. A run's period is typed on the page, and the
// overlap check in postPayRun holds back any paycheck for a day an earlier run already pays. So
// the default starts where the books' runs stop: the day after the latest period any of them
// covers, through today. A weekly business's next run is then the week since its last one, with
// nothing shared to ask about.

import { type IsoDate, assertDate, nextDay } from "@pnw/ledger";
import type { PayRun } from "@pnw/payroll";

/** The two weeks to today: the default when there's no earlier period to follow on from. */
const FALLBACK_DAYS = 14;

function daysBefore(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

function isDate(date: unknown): date is IsoDate {
  if (typeof date !== "string") return false;
  try {
    assertDate(date);
    return true;
  } catch {
    return false;
  }
}

/**
 * The period Run payroll starts with on `today`: from the day after the latest period end among
 * the posted runs (any mode, any payment status: a paycheck on its way or failed still pays its
 * own days), through today. It is never longer than the two weeks to today, so after a long gap
 * it is that, as it is on a first run. When the latest period ends today or later, or a run's end
 * can't be read, there is no day to follow on from and it is the two weeks to today too; the
 * overlap check then says what is already paid. Throws if `today` isn't a date.
 */
export function defaultPeriod(runs: readonly Pick<PayRun, "periodEnd">[], today: IsoDate): { periodStart: IsoDate; periodEnd: IsoDate } {
  assertDate(today);
  const twoWeeks = daysBefore(today, FALLBACK_DAYS - 1);
  const fallback = { periodStart: twoWeeks, periodEnd: today };
  if (runs.length === 0 || !runs.every((r) => isDate(r.periodEnd))) return fallback;
  // ISO dates compare as text.
  const latest = runs.reduce((a, r) => (r.periodEnd > a ? r.periodEnd : a), runs[0]!.periodEnd);
  if (latest >= today) return fallback;
  const after = nextDay(latest);
  return { periodStart: after > twoWeeks ? after : twoWeeks, periodEnd: today };
}
