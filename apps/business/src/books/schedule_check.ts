// ---------------------------------------------------------------------------
// A worked shift laid against the schedule (Phase 9, "schedule against the
// clock"): started late or early, left early or stayed late, or not on the
// schedule at all, for the business's timecards.
//
// Only a week the person confirmed counts, as for on-call pay
// (books/team_schedule.ts `personWeek`): nothing counts until it's
// confirmed, and a week never scheduled flags nothing. A callout is never
// compared (it's unscheduled by nature). Both sides are compared as wall
// clocks at the workplace (the work week's zone), so a clock change doesn't
// move anything. Differences of GRACE_MINUTES or less aren't flagged. Pure.
// ---------------------------------------------------------------------------

import { wallAsUtc } from "./hours";
import { type ScheduleWeek, type ShiftBlock, addDays, blockMinutes, dayOf, scheduleWeekOf } from "./schedule";
import { type ScheduleSources, personWeek } from "./team_schedule";

/** Up to this many minutes either way is on time. */
export const GRACE_MINUTES = 5;

export type ShiftCheck =
  /** No confirmed week covers the day, or it's a callout: nothing to compare with. */
  | { kind: "not_compared" }
  /** A confirmed week covers the day, and no scheduled shift overlaps this one. */
  | { kind: "unscheduled"; onCall: boolean }
  /** The scheduled shift it overlaps most; minutes after the scheduled start and end (negative: before). */
  | { kind: "scheduled"; date: string; block: ShiftBlock; startLate: number; endLate: number };

const MINUTE = 60_000;
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const midnight = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** The confirmed week starting `weekStart` for one person, from their schedule's sources. */
export const confirmedWeekFrom =
  (sources: ScheduleSources) =>
  (weekStart: string): ScheduleWeek | undefined => {
    const p = personWeek(sources, weekStart);
    return p?.answer?.answer === "confirmed" ? p.week : undefined;
  };

/** Lays one worked shift (absolute times) against the confirmed schedule, in the workplace's zone. */
export function checkShift(
  shift: { in: string; out: string; callout?: boolean },
  confirmedWeek: (weekStart: string) => ScheduleWeek | undefined,
  timeZone: string,
): ShiftCheck {
  if (shift.callout) return { kind: "not_compared" };
  const start = wallAsUtc(new Date(shift.in), timeZone);
  const end = wallAsUtc(new Date(shift.out), timeZone);
  const date = new Date(start).toISOString().slice(0, 10);
  const today = confirmedWeek(scheduleWeekOf(date));
  // The day before (a night shift running into this one) and after (clocked in just before midnight).
  let best: { date: string; block: ShiftBlock; from: number; to: number; overlap: number } | undefined;
  for (const d of [addDays(date, -1), date, addDays(date, 1)]) {
    const week = confirmedWeek(scheduleWeekOf(d));
    if (!week) continue;
    for (const block of dayOf(week, d).shifts) {
      const from = midnight(d) + minutesOf(block.start) * MINUTE;
      const to = from + blockMinutes(block) * MINUTE;
      const overlap = Math.min(to, end) - Math.max(from, start);
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { date: d, block, from, to, overlap };
    }
  }
  if (best) return { kind: "scheduled", date: best.date, block: best.block, startLate: Math.round((start - best.from) / MINUTE), endLate: Math.round((end - best.to) / MINUTE) };
  if (!today) return { kind: "not_compared" };
  return { kind: "unscheduled", onCall: dayOf(today, date).onCall };
}

/** One line per difference past the grace, in the order they happened. Empty when on time. */
export function checkLabels(check: ShiftCheck): { text: string; warn: boolean }[] {
  if (check.kind === "not_compared") return [];
  if (check.kind === "unscheduled") return [{ text: check.onCall ? "Not on the schedule (an on-call day, not clocked as a callout)" : "Not on the schedule", warn: true }];
  const out: { text: string; warn: boolean }[] = [];
  const min = (n: number) => `${Math.abs(n)} min`;
  if (check.startLate > GRACE_MINUTES) out.push({ text: `Started ${min(check.startLate)} late`, warn: true });
  else if (check.startLate < -GRACE_MINUTES) out.push({ text: `Started ${min(check.startLate)} early`, warn: false });
  if (check.endLate < -GRACE_MINUTES) out.push({ text: `Left ${min(check.endLate)} early`, warn: true });
  else if (check.endLate > GRACE_MINUTES) out.push({ text: `Stayed ${min(check.endLate)} late`, warn: false });
  return out;
}
