// Run payroll's pay period before anyone changes it. A run's period is typed on the page, and the
// overlap check in postPayRun holds back any paycheck for a day an earlier run already pays. So
// the default starts where the books' runs stop: the day after the latest period any of them
// covers, through today. A weekly business's next run is then the week since its last one, with
// nothing shared to ask about.
//
// One period for the whole team means some work can sit before it: a shift held on the last run
// for an answer about its hours, a timecard that came in after the run for its week, or someone
// left out of the last run. `unpaidBeforePeriod` names that work on the person's row, so moving
// Period starts back to pay it is the business's choice, not something the default hides.

import { type IsoDate, assertDate, nextDay, previousDay } from "@pnw/ledger";
import type { PayRun } from "@pnw/payroll";
import { addDays, formatMinutes } from "./hours";
import type { Mailbox } from "./mailbox";
import type { ScheduleSources } from "./team_schedule";
import { unpaidOnCallDates } from "./team_schedule";
import type { Thread } from "./thread";
import { unpaidHours } from "./timecard_pay";
import type { PayRules } from "./work_week";

/** The two weeks to today: the default when there's no earlier period to follow on from. */
const FALLBACK_DAYS = 14;

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
  const twoWeeks = addDays(today, -(FALLBACK_DAYS - 1));
  const fallback = { periodStart: twoWeeks, periodEnd: today };
  if (runs.length === 0 || !runs.every((r) => isDate(r.periodEnd))) return fallback;
  // ISO dates compare as text.
  const latest = runs.reduce((a, r) => (r.periodEnd > a ? r.periodEnd : a), runs[0]!.periodEnd);
  if (latest >= today) return fallback;
  const after = nextDay(latest);
  return { periodStart: after > twoWeeks ? after : twoWeeks, periodEnd: today };
}

/** Unpaid work dated before a run's period: from the earliest day of it, timecard minutes and on-call days. */
export type UnpaidBefore = { from: IsoDate; minutes: number; onCallDays: number };

/**
 * One person's work in the two weeks to the period's end, dated before the period starts, that no
 * pay run has paid: unpaid stretches on their timecards (`hourly`: what their pay is made of) and
 * confirmed on-call days not yet paid (`onCall`: given when their terms pay for being on call).
 * The two weeks to the period's end are what the page's period was before it followed on from
 * the last run, so every unpaid day that period reached is either in this one or named here.
 * Null when there is none, when the period already reaches that far back, or when its dates
 * aren't whole dates yet (the page asks on every keystroke).
 */
export function unpaidBeforePeriod(args: {
  mailbox: Mailbox | null | undefined;
  workerId: string;
  hourly: boolean;
  rules: PayRules;
  onCall?: { src: ScheduleSources | Thread | undefined; paid: Record<string, Record<string, string>> | undefined } | undefined;
  periodStart: string;
  periodEnd: string;
}): UnpaidBefore | null {
  const { periodStart, periodEnd } = args;
  if (!isDate(periodStart) || !isDate(periodEnd) || periodStart > periodEnd) return null;
  const from = addDays(periodEnd, -(FALLBACK_DAYS - 1));
  const to = previousDay(periodStart);
  if (from > to) return null;
  const shifts = args.hourly ? unpaidHours(args.mailbox, args.workerId, from, to, args.rules).shifts : [];
  const onCallDates = args.onCall ? unpaidOnCallDates(args.onCall.src, args.onCall.paid, args.workerId, from, to) : [];
  if (shifts.length === 0 && onCallDates.length === 0) return null;
  const first = [...shifts.map((s) => s.date), ...onCallDates].sort()[0]!;
  return { from: first, minutes: shifts.reduce((t, s) => t + s.minutes, 0), onCallDays: onCallDates.length };
}

/** The row's sentence for that work; `day` writes a date the way the page does. */
export function unpaidBeforeText(before: UnpaidBefore, day: (date: IsoDate) => string): string {
  const what = [
    ...(before.minutes > 0 ? [`${formatMinutes(before.minutes)} on their timecards`] : []),
    ...(before.onCallDays > 0 ? [`${before.onCallDays} on-call ${before.onCallDays === 1 ? "day" : "days"}`] : []),
  ].join(" and ");
  return `Before this period and not paid yet: ${what}, from ${day(before.from)}. To pay for that work in this run, move Period starts back to ${day(before.from)}.`;
}
