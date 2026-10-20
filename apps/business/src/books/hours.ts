// ---------------------------------------------------------------------------
// Hours from punches, laid against a calendar. A punch is a full instant; a
// calendar (books/work_week.ts: the day a week starts on and the time zone
// its days are drawn in) decides which day and which week it falls in. The
// calendar comes from the agreement's terms, so both sides draw the same
// one; an agreement from before the terms said so uses the baseline, Sunday
// to Saturday (Joshua, 2026-10-19), in this device's zone. A shift that crosses midnight is split between
// the two days. A shift still open counts up to now, or, when the day it
// started has ended, up to that midnight (a forgotten clock-out never bleeds
// into the next day).
//
// Overtime is split the same way on both sides from the same entries
// (`overtimeSplit`): hours past the day's threshold first, then hours past
// the week's, so a day's overtime never counts twice.
//
// A forgotten clock-out (Joshua, 2026-10-19): a shift longer than the work
// week's longest shift (12 hours without one) is `long`. Open, it counts up
// to that length and no further; closed, it goes into a week only once the
// person has confirmed it (work.ts `confirmShift`), and the entry says so.
//
// The timesheet payload built here is a contract shared with the employer's
// side of the app: keep the field names exactly.
// ---------------------------------------------------------------------------

import { type Punch, type Work, type WorkAgreement, WorkError, sentPunchIds } from "./work";
import { WEEKDAY_INDEX, type Weekday, type WorkWeek, deviceTimeZone, weekdayLabel } from "./work_week";

export type DayDate = string; // YYYY-MM-DD, in the calendar's zone

/** The ruler a week is drawn with: which day it starts on, and the zone its days are in. */
export type Calendar = { startsOn: Weekday; timeZone: string };

/**
 * One worked stretch inside a single day. `long`: the whole shift it belongs to runs past the
 * longest shift (open: it has already); `confirmed`: the person confirmed that long shift;
 * `sent`: the shift has gone to the employer in a timecard and is theirs to change now.
 */
export type Shift = {
  date: DayDate;
  in: string;
  out: string;
  minutes: number;
  open: boolean;
  inId: string;
  outId?: string;
  long: boolean;
  confirmed: boolean;
  sent: boolean;
  /** Clocked in as a callout (work.ts `punch` with `callout`). */
  callout: boolean;
  /** The whole shift as it was before its clock-in or clock-out moved, if either did. */
  was?: { in: string; out: string };
  /** How it moved: the person's own edit, or a change both sides agreed to (books/hours_change.ts). */
  change?: "edited" | "agreed";
};

/**
 * One stretch on a timecard. `long`: past the longest shift, confirmed. `callout`: clocked in as a
 * callout. `was` and `change`: the whole shift's times before they moved, and whether the person
 * edited them before sending (the employer sees it) or both sides agreed to the change.
 */
export type TimesheetEntry = { date: DayDate; in: string; out: string; minutes: number; long?: true; callout?: true; was?: { in: string; out: string }; change?: "edited" | "agreed" };

export type TimesheetPayload = {
  version: 1;
  kind: "timesheet";
  agreementId: string;
  weekStart: DayDate;
  entries: TimesheetEntry[];
  totalMinutes: number;
  sentAt: string;
};

/** The longest shift before a clock-out is questioned, in minutes: the work week's, or 12 hours. */
export const DEFAULT_LONGEST_MINUTES = 12 * 60;
export function longestMinutesOf(agreement: Pick<WorkAgreement, "terms"> | undefined): number {
  const w = agreement?.terms?.version === 2 ? agreement.terms.workWeek : undefined;
  return w ? Math.round(w.longestShiftHours * 60) : DEFAULT_LONGEST_MINUTES;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Sunday to Saturday, this device's zone: the calendar of an agreement whose terms don't set one. */
export const deviceCalendar = (): Calendar => ({ startsOn: "sunday", timeZone: deviceTimeZone() });

/** The calendar an agreement's terms set, or the device's when they don't. */
export function calendarOf(agreement: Pick<WorkAgreement, "terms"> | undefined): Calendar {
  const w = agreement?.terms?.version === 2 ? agreement.terms.workWeek : undefined;
  return w ? { startsOn: w.startsOn, timeZone: w.timeZone } : deviceCalendar();
}

// ---- Wall clocks in a zone ----------------------------------------------------------------

const formats = new Map<string, Intl.DateTimeFormat>();
function formatFor(timeZone: string): Intl.DateTimeFormat {
  let f = formats.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formats.set(timeZone, f);
  }
  return f;
}

/** The wall clock in a zone at an instant, as the UTC milliseconds of that same wall time. */
function wallAsUtc(d: Date, timeZone: string): number {
  const p: Record<string, number> = {};
  for (const part of formatFor(timeZone).formatToParts(d)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
}

/** The local calendar day of an instant, in a zone (this device's by default). */
export function localDate(d: Date, timeZone: string = deviceTimeZone()): DayDate {
  return new Date(wallAsUtc(d, timeZone)).toISOString().slice(0, 10);
}

/** Midnight at the start of a calendar day, in a zone (this device's by default). */
export function startOfDay(date: DayDate, timeZone: string = deviceTimeZone()): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d);
  // The zone's offset at that moment moves the wall time onto the instant; a second look catches a
  // change of offset (a clock change) between the guess and the answer.
  const seconds = (ms: number) => Math.floor(ms / 1000) * 1000;
  let at = wall - (wallAsUtc(new Date(wall), timeZone) - seconds(wall));
  const again = wall - (wallAsUtc(new Date(at), timeZone) - seconds(at));
  if (again !== at) at = again;
  return new Date(at);
}

/** `n` days on from a calendar day (plain date arithmetic; no zone needed). */
export function addDays(date: DayDate, n: number): DayDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The first day of the week a day falls in: the Sunday on or before it, unless the calendar starts elsewhere. */
export function weekStartOf(date: DayDate, calendar: Pick<Calendar, "startsOn"> = { startsOn: "sunday" }): DayDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() - WEEKDAY_INDEX[calendar.startsOn] + 7) % 7;
  return addDays(date, -back);
}

export const weekDays = (weekStart: DayDate): DayDate[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

const wholeMinutes = (fromMs: number, toMs: number) => Math.max(0, Math.floor((toMs - fromMs) / 60_000));

/**
 * The shifts for one agreement, split at midnight in the zone, in time order.
 * `now` closes an open shift (at now, at the end of its first day if that has
 * passed, or at the longest shift, whichever comes first). Assumes the punches
 * keep the alternating rule (work.ts enforces it).
 */
export function shiftsOf(punches: readonly Punch[], agreementId: string, now: Date, timeZone: string = deviceTimeZone(), longestMinutes: number = DEFAULT_LONGEST_MINUTES, sentIds: ReadonlySet<string> = new Set()): Shift[] {
  const mine = punches.filter((p) => p.agreementId === agreementId).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const out: Shift[] = [];
  for (let i = 0; i < mine.length; i++) {
    const p = mine[i]!;
    if (p.kind !== "in") continue;
    const next = mine[i + 1];
    const start = new Date(p.at);
    const open = next?.kind !== "out";
    const cap = start.getTime() + longestMinutes * 60_000;
    let end: Date;
    let long: boolean;
    if (!open && next) {
      end = new Date(next.at);
      long = end.getTime() > cap;
    } else {
      const midnight = startOfDay(addDays(localDate(start, timeZone), 1), timeZone);
      end = new Date(Math.min(now.getTime(), midnight.getTime(), cap));
      if (end.getTime() < start.getTime()) end = start;
      long = now.getTime() > cap;
    }
    const confirmed = !open && next?.confirmed === true;
    const sent = !open && sentIds.has(p.id);
    const callout = p.callout === true;
    // Moved since it was first clocked: what it was, and whether by the person's edit or by agreement.
    const outP = open ? undefined : next;
    const movedPunches = [p, outP].filter((x): x is Punch => !!x?.was);
    const history =
      movedPunches.length > 0 && outP
        ? { was: { in: p.was ?? p.at, out: outP.was ?? outP.at }, change: movedPunches.every((x) => x.agreed) ? ("agreed" as const) : ("edited" as const) }
        : {};
    // Split at each midnight the shift crosses.
    let cursor = start;
    while (cursor.getTime() < end.getTime()) {
      const boundary = startOfDay(addDays(localDate(cursor, timeZone), 1), timeZone);
      const segmentEnd = boundary.getTime() < end.getTime() ? boundary : end;
      out.push({ date: localDate(cursor, timeZone), in: cursor.toISOString(), out: segmentEnd.toISOString(), minutes: wholeMinutes(cursor.getTime(), segmentEnd.getTime()), open, inId: p.id, ...(open ? {} : { outId: next!.id }), long, confirmed, sent, callout, ...history });
      cursor = segmentEnd;
    }
    if (start.getTime() === end.getTime()) {
      out.push({ date: localDate(start, timeZone), in: start.toISOString(), out: end.toISOString(), minutes: 0, open, inId: p.id, ...(open ? {} : { outId: next!.id }), long, confirmed, sent, callout, ...history });
    }
  }
  return out;
}

/** A shift from `inAt` to `outAt` split into its days in the zone: what a timecard would carry for it. */
export function segmentsOf(inAt: string, outAt: string, timeZone: string): { date: DayDate; in: string; out: string; minutes: number }[] {
  const punches: Punch[] = [
    { id: "a", agreementId: "-", at: new Date(inAt).toISOString(), kind: "in" },
    { id: "b", agreementId: "-", at: new Date(outAt).toISOString(), kind: "out" },
  ];
  return shiftsOf(punches, "-", new Date(outAt), timeZone, Number.MAX_SAFE_INTEGER / 120_000).map(({ date, in: i, out, minutes }) => ({ date, in: i, out, minutes }));
}

/** Minutes per day for one agreement, in the zone. */
export function minutesByDay(punches: readonly Punch[], agreementId: string, now: Date, timeZone: string = deviceTimeZone(), longestMinutes: number = DEFAULT_LONGEST_MINUTES): Map<DayDate, number> {
  const by = new Map<DayDate, number>();
  for (const s of shiftsOf(punches, agreementId, now, timeZone, longestMinutes)) by.set(s.date, (by.get(s.date) ?? 0) + s.minutes);
  return by;
}

export function minutesOn(punches: readonly Punch[], agreementId: string, date: DayDate, now: Date, timeZone: string = deviceTimeZone(), longestMinutes: number = DEFAULT_LONGEST_MINUTES): number {
  return minutesByDay(punches, agreementId, now, timeZone, longestMinutes).get(date) ?? 0;
}

/** Minutes in the week starting `weekStart` for one agreement, in the zone. */
export function weekMinutes(punches: readonly Punch[], agreementId: string, weekStart: DayDate, now: Date, timeZone: string = deviceTimeZone(), longestMinutes: number = DEFAULT_LONGEST_MINUTES): number {
  const days = new Set(weekDays(weekStart));
  let total = 0;
  for (const [date, m] of minutesByDay(punches, agreementId, now, timeZone, longestMinutes)) if (days.has(date)) total += m;
  return total;
}

/** The shifts of one week for one agreement, on the agreement's own calendar and longest shift, each knowing whether it was sent. */
export function weekShifts(work: Work, agreementId: string, weekStart: DayDate, now: Date): Shift[] {
  const agreement = work.agreements.find((a) => a.agreementId === agreementId);
  const days = new Set(weekDays(weekStart));
  return shiftsOf(work.punches, agreementId, now, calendarOf(agreement).timeZone, longestMinutesOf(agreement), sentPunchIds(work, agreementId)).filter((s) => days.has(s.date));
}

/** The closed shifts of the week: what a timecard carries (an open shift goes once it's clocked out). */
export const sendableShifts = (work: Work, agreementId: string, weekStart: DayDate, now: Date): Shift[] => weekShifts(work, agreementId, weekStart, now).filter((s) => !s.open);

/** The minutes a timecard for the week would carry. */
export const sendableMinutes = (work: Work, agreementId: string, weekStart: DayDate, now: Date): number =>
  sendableShifts(work, agreementId, weekStart, now).reduce((t, s) => t + s.minutes, 0);

/**
 * Why the week's timecard can't go yet, or null: a long shift the person
 * hasn't confirmed. An open shift doesn't hold it back; it just isn't on it.
 */
export function sendProblem(work: Work, agreementId: string, weekStart: DayDate, now: Date): string | null {
  const agreement = work.agreements.find((a) => a.agreementId === agreementId);
  if (!agreement) return "No agreement with that id";
  const hours = formatMinutes(longestMinutesOf(agreement)).replace(/ 00m$/, "");
  for (const s of sendableShifts(work, agreementId, weekStart, now)) {
    if (s.long && !s.confirmed) return `A shift on ${s.date} is longer than ${hours}. Under Hours, fix its clock-out time or confirm it's right.`;
  }
  return null;
}

/** The punches of the shifts a timecard for the week carries now: what `recordTimesheet` locks once it has gone. */
export const timecardPunchIds = (work: Work, agreementId: string, weekStart: DayDate, now: Date): string[] =>
  sendableShifts(work, agreementId, weekStart, now).flatMap((s) => (s.outId ? [s.inId, s.outId] : [s.inId]));

/** The week's closed shifts for one agreement, as the employer will receive them, on the agreement's calendar. */
export function buildTimesheet(work: Work, agreementId: string, weekStart: DayDate, now: Date): TimesheetPayload {
  const agreement = work.agreements.find((a) => a.agreementId === agreementId);
  if (!agreement) throw new WorkError("No agreement with that id");
  const calendar = calendarOf(agreement);
  if (weekStartOf(weekStart, calendar) !== weekStart) throw new WorkError(`A week starts on a ${weekdayLabel(calendar.startsOn)}`);
  const problem = sendProblem(work, agreementId, weekStart, now);
  if (problem) throw new WorkError(problem);
  const entries: TimesheetEntry[] = sendableShifts(work, agreementId, weekStart, now).map(({ date, in: i, out, minutes, long, callout, was, change }) => ({
    date,
    in: i,
    out,
    minutes,
    ...(long ? { long: true as const } : {}),
    ...(callout ? { callout: true as const } : {}),
    ...(was && change ? { was, change } : {}),
  }));
  if (entries.length === 0) throw new WorkError("Nothing to send yet: a shift goes on the timecard once you've clocked out");
  return {
    version: 1,
    kind: "timesheet",
    agreementId,
    weekStart,
    entries,
    totalMinutes: entries.reduce((t, e) => t + e.minutes, 0),
    sentAt: now.toISOString(),
  };
}

// ---- Overtime -----------------------------------------------------------------------------

export type OvertimeSplit = { regular: number; overtime: number };

/**
 * One week's entries split into regular and overtime minutes under a work
 * week: past the day's threshold first (where there is one), then past the
 * week's, counted over the regular minutes only. The same function on both
 * sides, over the same entries, gives the same split.
 */
export function overtimeSplit(entries: readonly { in: string; minutes: number }[], week: Pick<WorkWeek, "timeZone" | "overtimeAfterHours" | "dailyOvertimeAfterHours">): OvertimeSplit {
  return labelOvertime(entries, week).reduce((t, l) => ({ regular: t.regular + l.regular, overtime: t.overtime + l.overtime }), { regular: 0, overtime: 0 });
}

/**
 * The same split, stretch by stretch: walking the week in time order, the
 * minutes past the day's threshold are overtime, then the regular minutes
 * past the week's. So the overtime lands on the last hours worked, and each
 * stretch knows its own share (what a pay run pays when a period ends inside
 * a week). Returned in the order the entries were given; the sums equal
 * `overtimeSplit`.
 */
export function labelOvertime(entries: readonly { in: string; minutes: number }[], week: Pick<WorkWeek, "timeZone" | "overtimeAfterHours" | "dailyOvertimeAfterHours">): OvertimeSplit[] {
  const dailyCap = week.dailyOvertimeAfterHours > 0 ? Math.round(week.dailyOvertimeAfterHours * 60) : Infinity;
  const weeklyCap = week.overtimeAfterHours > 0 ? Math.round(week.overtimeAfterHours * 60) : Infinity;
  const order = entries.map((_, i) => i).sort((a, b) => (entries[a]!.in < entries[b]!.in ? -1 : entries[a]!.in > entries[b]!.in ? 1 : a - b));
  const byDay = new Map<DayDate, number>();
  let weekRegular = 0;
  const out: OvertimeSplit[] = entries.map(() => ({ regular: 0, overtime: 0 }));
  const past = (total: number, cap: number) => Math.max(0, total - cap);
  for (const i of order) {
    const e = entries[i]!;
    const day = localDate(new Date(e.in), week.timeZone);
    const before = byDay.get(day) ?? 0;
    byDay.set(day, before + e.minutes);
    const daily = past(before + e.minutes, dailyCap) - past(before, dailyCap);
    const regular = e.minutes - daily;
    const weekly = past(weekRegular + regular, weeklyCap) - past(weekRegular, weeklyCap);
    weekRegular += regular;
    out[i] = { regular: regular - weekly, overtime: daily + weekly };
  }
  return out;
}

/** "7h 30m", "45m", "0m". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
}
