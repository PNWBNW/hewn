// ---------------------------------------------------------------------------
// Hours from punches. Everything is in the person's own time zone: a day is
// a local calendar day, a week starts on Monday. A shift that crosses
// midnight is split between the two days. A shift still open counts up to
// now, or, when the day it started has ended, up to that midnight (a
// forgotten clock-out never bleeds into the next day).
//
// The timesheet payload built here is a contract shared with the employer's
// side of the app: keep the field names exactly.
// ---------------------------------------------------------------------------

import { type Punch, type Work, WorkError } from "./work";

export type DayDate = string; // YYYY-MM-DD, local

/** One worked stretch inside a single day. */
export type Shift = { date: DayDate; in: string; out: string; minutes: number; open: boolean; inId: string; outId?: string };

export type TimesheetPayload = {
  version: 1;
  kind: "timesheet";
  agreementId: string;
  weekStart: DayDate;
  entries: { date: DayDate; in: string; out: string; minutes: number }[];
  totalMinutes: number;
  sentAt: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** The local calendar day of a date. */
export function localDate(d: Date): DayDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight at the start of a calendar day. */
export function startOfDay(date: DayDate): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function addDays(date: DayDate, n: number): DayDate {
  const d = startOfDay(date);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

/** The Monday on or before a day. */
export function weekStartOf(date: DayDate): DayDate {
  const d = startOfDay(date);
  const back = (d.getDay() + 6) % 7; // Monday → 0, Sunday → 6
  return addDays(date, -back);
}

export const weekDays = (weekStart: DayDate): DayDate[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

const wholeMinutes = (fromMs: number, toMs: number) => Math.max(0, Math.floor((toMs - fromMs) / 60_000));

/**
 * The shifts for one agreement, split at midnight, in time order. `now`
 * closes an open shift (at now, or at the end of its first day if that has
 * passed). Assumes the punches keep the alternating rule (work.ts enforces it).
 */
export function shiftsOf(punches: readonly Punch[], agreementId: string, now: Date): Shift[] {
  const mine = punches.filter((p) => p.agreementId === agreementId).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const out: Shift[] = [];
  for (let i = 0; i < mine.length; i++) {
    const p = mine[i]!;
    if (p.kind !== "in") continue;
    const next = mine[i + 1];
    const start = new Date(p.at);
    const open = next?.kind !== "out";
    let end: Date;
    if (!open && next) end = new Date(next.at);
    else {
      const midnight = startOfDay(addDays(localDate(start), 1));
      end = now.getTime() < midnight.getTime() ? now : midnight;
      if (end.getTime() < start.getTime()) end = start;
    }
    // Split at each local midnight the shift crosses.
    let cursor = start;
    while (cursor.getTime() < end.getTime()) {
      const boundary = startOfDay(addDays(localDate(cursor), 1));
      const segmentEnd = boundary.getTime() < end.getTime() ? boundary : end;
      out.push({ date: localDate(cursor), in: cursor.toISOString(), out: segmentEnd.toISOString(), minutes: wholeMinutes(cursor.getTime(), segmentEnd.getTime()), open, inId: p.id, ...(open ? {} : { outId: next!.id }) });
      cursor = segmentEnd;
    }
    if (start.getTime() === end.getTime()) {
      out.push({ date: localDate(start), in: start.toISOString(), out: end.toISOString(), minutes: 0, open, inId: p.id, ...(open ? {} : { outId: next!.id }) });
    }
  }
  return out;
}

/** Minutes per local day for one agreement. */
export function minutesByDay(punches: readonly Punch[], agreementId: string, now: Date): Map<DayDate, number> {
  const by = new Map<DayDate, number>();
  for (const s of shiftsOf(punches, agreementId, now)) by.set(s.date, (by.get(s.date) ?? 0) + s.minutes);
  return by;
}

export function minutesOn(punches: readonly Punch[], agreementId: string, date: DayDate, now: Date): number {
  return minutesByDay(punches, agreementId, now).get(date) ?? 0;
}

/** Minutes in the week starting `weekStart` (a Monday) for one agreement. */
export function weekMinutes(punches: readonly Punch[], agreementId: string, weekStart: DayDate, now: Date): number {
  const days = new Set(weekDays(weekStart));
  let total = 0;
  for (const [date, m] of minutesByDay(punches, agreementId, now)) if (days.has(date)) total += m;
  return total;
}

/** The week's shifts for one agreement, as the employer will receive them. */
export function buildTimesheet(work: Work, agreementId: string, weekStart: DayDate, now: Date): TimesheetPayload {
  if (weekStartOf(weekStart) !== weekStart) throw new WorkError("A week starts on a Monday");
  if (!work.agreements.some((a) => a.agreementId === agreementId)) throw new WorkError("No agreement with that id");
  const days = new Set(weekDays(weekStart));
  const entries = shiftsOf(work.punches, agreementId, now)
    .filter((s) => days.has(s.date))
    .map(({ date, in: i, out, minutes }) => ({ date, in: i, out, minutes }));
  if (entries.length === 0) throw new WorkError("Nothing to send: no hours this week");
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

/** "7h 30m", "45m", "0m". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
}
