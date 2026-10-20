// ---------------------------------------------------------------------------
// The schedule (Joshua, 2026-10-20): two layers on every day. Shift blocks,
// each with its own hours, and, independently, an on-call layer covering the
// whole 24 hours. A day can hold shifts, on-call, both, or neither.
//
// The business drafts a week per team member here (`Schedule`, in its
// vault), then publishes it: the week travels as a `schedule` message in the
// conversation with that person (books/thread.ts), sealed to the two of them.
// The person confirms it or asks for a change with a `schedule_answer` that
// names the message. Nothing counts until it's confirmed. What was published
// and how it was answered are read back from the conversation each side
// already keeps, so neither side holds a second copy that could drift.
//
// Times are wall-clock "HH:MM" at the workplace. A shift whose end is at or
// before its start ends the next day (a night shift). Pure; no zone maths.
// A person's schedule is private like their wages: the vault and sealed
// letters only.
// ---------------------------------------------------------------------------

import type { Thread, ThreadItem } from "./thread";

export type ShiftBlock = { start: string; end: string };

/** One day: its shift blocks, and whether the person is on call for the whole of it. */
export type ScheduleDay = { date: string; shifts: ShiftBlock[]; onCall: boolean };

/** One person's week: only the days with something on them, in date order. */
export type ScheduleWeek = { weekStart: string; days: ScheduleDay[] };

/** The business's working copies, per team member and week. */
export type Schedule = { version: 1; drafts: Record<string, Record<string, ScheduleWeek>> };

export const MAX_SHIFTS_A_DAY = 6;
export const MAX_SCHEDULE_NOTE = 500;

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** `n` days on from a date (plain calendar arithmetic). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The Sunday on or before a date: schedules are drawn Sunday to Saturday. */
export function scheduleWeekOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return addDays(date, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

export const scheduleDays = (weekStart: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

/** How long a block runs, in minutes; a block ending at or before its start runs into the next day. */
export function blockMinutes(b: ShiftBlock): number {
  const start = minutesOf(b.start);
  const end = minutesOf(b.end);
  return end > start ? end - start : end + 24 * 60 - start;
}

/** True when a block runs past midnight. */
export const overnight = (b: ShiftBlock): boolean => minutesOf(b.end) <= minutesOf(b.start);

function validateBlock(raw: unknown): ShiftBlock {
  const b = raw as Partial<ShiftBlock> | null;
  if (!b || typeof b !== "object") throw new ScheduleError("A shift must have a start and an end");
  if (typeof b.start !== "string" || !TIME.test(b.start) || typeof b.end !== "string" || !TIME.test(b.end)) throw new ScheduleError("A shift's times are HH:MM, like 07:00");
  if (b.start === b.end) throw new ScheduleError("A shift can't start and end at the same time");
  return { start: b.start, end: b.end };
}

function validateDay(raw: unknown, weekStart: string): ScheduleDay {
  const d = raw as Partial<ScheduleDay> | null;
  if (!d || typeof d !== "object") throw new ScheduleError("Each day must be an object");
  if (!isDate(d.date) || !scheduleDays(weekStart).includes(d.date)) throw new ScheduleError("Each day must fall in its week");
  if (!Array.isArray(d.shifts) || d.shifts.length > MAX_SHIFTS_A_DAY) throw new ScheduleError(`A day holds at most ${MAX_SHIFTS_A_DAY} shifts`);
  if (typeof d.onCall !== "boolean") throw new ScheduleError("On call is yes or no");
  const shifts = d.shifts.map(validateBlock).sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  // Blocks on one day may not overlap (a night shift reaches past midnight, so its end counts as the next day's).
  for (let i = 1; i < shifts.length; i++) {
    const before = shifts[i - 1]!;
    if (minutesOf(before.start) + blockMinutes(before) > minutesOf(shifts[i]!.start)) throw new ScheduleError(`Two shifts on ${d.date} overlap`);
  }
  return { date: d.date, shifts, onCall: d.onCall };
}

/** Checks a week and returns a clean copy: empty days dropped, days in order, shifts in order. */
export function validateScheduleWeek(raw: unknown): ScheduleWeek {
  const w = raw as Partial<ScheduleWeek> | null;
  if (!w || typeof w !== "object") throw new ScheduleError("A schedule week must be an object");
  if (!isDate(w.weekStart) || scheduleWeekOf(w.weekStart) !== w.weekStart) throw new ScheduleError("A schedule week starts on a Sunday");
  if (!Array.isArray(w.days) || w.days.length > 7) throw new ScheduleError("A week has at most seven days");
  const days = w.days.map((d) => validateDay(d, w.weekStart!)).filter((d) => d.shifts.length > 0 || d.onCall);
  if (new Set(days.map((d) => d.date)).size !== days.length) throw new ScheduleError("A day is in the week twice");
  return { weekStart: w.weekStart, days: days.sort((a, b) => (a.date < b.date ? -1 : 1)) };
}

export const emptyWeek = (weekStart: string): ScheduleWeek => ({ weekStart, days: [] });

/** The day as the week holds it, or an empty one. */
export const dayOf = (week: ScheduleWeek, date: string): ScheduleDay => week.days.find((d) => d.date === date) ?? { date, shifts: [], onCall: false };

/** The week with one day replaced (checked as a whole). */
export function withDay(week: ScheduleWeek, day: ScheduleDay): ScheduleWeek {
  return validateScheduleWeek({ ...week, days: [...week.days.filter((d) => d.date !== day.date), day] });
}

/** The same days and blocks moved to another week. */
export function shiftWeek(week: ScheduleWeek, toWeekStart: string): ScheduleWeek {
  const offset = Math.round((Date.parse(`${toWeekStart}T00:00:00Z`) - Date.parse(`${week.weekStart}T00:00:00Z`)) / 86_400_000);
  return validateScheduleWeek({ weekStart: toWeekStart, days: week.days.map((d) => ({ ...d, date: addDays(d.date, offset) })) });
}

/** Scheduled minutes in a week (shift blocks only; on-call is its own layer). */
export const weekShiftMinutes = (week: ScheduleWeek): number => week.days.reduce((t, d) => t + d.shifts.reduce((s, b) => s + blockMinutes(b), 0), 0);
export const onCallDays = (week: ScheduleWeek): number => week.days.filter((d) => d.onCall).length;

/** True when two weeks hold the same days and blocks. */
export const sameWeek = (a: ScheduleWeek, b: ScheduleWeek): boolean => JSON.stringify(validateScheduleWeek(a)) === JSON.stringify(validateScheduleWeek(b));

// ---- The business's drafts ------------------------------------------------------------------

export const emptySchedule = (): Schedule => ({ version: 1, drafts: {} });

export const draftOf = (s: Schedule | null | undefined, workerId: string, weekStart: string): ScheduleWeek | undefined => s?.drafts[workerId]?.[weekStart];

/** Saves one person's draft of one week (an empty week is removed). */
export function setDraft(s: Schedule, workerId: string, week: ScheduleWeek): Schedule {
  const clean = validateScheduleWeek(week);
  const mine = { ...(s.drafts[workerId] ?? {}) };
  if (clean.days.length === 0) delete mine[clean.weekStart];
  else mine[clean.weekStart] = clean;
  const drafts = { ...s.drafts };
  if (Object.keys(mine).length === 0) delete drafts[workerId];
  else drafts[workerId] = mine;
  return { version: 1, drafts };
}

export function validateSchedule(raw: unknown): Schedule {
  const s = raw as Partial<Schedule> | null;
  if (!s || typeof s !== "object" || s.version !== 1) throw new ScheduleError("Unknown schedule version");
  if (!s.drafts || typeof s.drafts !== "object" || Array.isArray(s.drafts)) throw new ScheduleError("The schedule's drafts must be an object");
  let out = emptySchedule();
  for (const [workerId, weeks] of Object.entries(s.drafts)) {
    if (!workerId || !weeks || typeof weeks !== "object" || Array.isArray(weeks)) throw new ScheduleError("Each person's weeks must be an object");
    for (const [weekStart, week] of Object.entries(weeks)) {
      const clean = validateScheduleWeek(week);
      if (clean.weekStart !== weekStart) throw new ScheduleError("A week is filed under the wrong date");
      out = setDraft(out, workerId, clean);
    }
  }
  return out;
}

const FORMAT = "pnw-schedule";
export const scheduleToJson = (s: Schedule): string => JSON.stringify({ format: FORMAT, schedule: validateSchedule(s) });
export function scheduleFromJson(text: string): Schedule {
  const doc = JSON.parse(text) as { format?: string; schedule?: unknown };
  if (doc.format !== FORMAT) throw new ScheduleError("Not a schedule from this app");
  return validateSchedule(doc.schedule);
}

// ---- What was published, and how it was answered (read from the conversation) ----------------

export type ScheduleAnswer = { answer: "confirmed" | "change"; note: string; at: string; mine: boolean };

export type PublishedWeek = {
  /** The `schedule` message's id: what an answer names. */
  id: string;
  week: ScheduleWeek;
  note: string;
  sentAt: string;
  /** The latest answer to this very message, if any. */
  answer?: ScheduleAnswer;
  /** The business sent it from this device (business side) or it arrived (person's side). */
  mine: boolean;
};

type ScheduleItem = ThreadItem & { body: { type: "schedule"; week: ScheduleWeek; note: string } };
type AnswerItem = ThreadItem & { body: { type: "schedule_answer"; scheduleId: string; weekStart: string; answer: "confirmed" | "change"; note: string } };

const byTime = (a: ThreadItem, b: ThreadItem) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : a.seq - b.seq);

/** The latest week published for `weekStart` in a conversation, with its answer. */
export function publishedWeek(thread: Thread | undefined, weekStart: string): PublishedWeek | undefined {
  const items = [...(thread?.items ?? [])].sort(byTime);
  const sent = items.filter((i): i is ScheduleItem => i.body.type === "schedule" && i.body.week.weekStart === weekStart);
  const last = sent.at(-1);
  if (!last) return undefined;
  const answers = items.filter((i): i is AnswerItem => i.body.type === "schedule_answer" && i.body.scheduleId === last.id);
  const answer = answers.at(-1);
  return {
    id: last.id,
    week: last.body.week,
    note: last.body.note,
    sentAt: last.sentAt,
    mine: last.mine,
    ...(answer ? { answer: { answer: answer.body.answer, note: answer.body.note, at: answer.sentAt, mine: answer.mine } } : {}),
  };
}

export type WeekStatus = "none" | "draft" | "changed" | "waiting" | "confirmed" | "change_asked";

/**
 * Where one person's week stands for the business: nothing yet, a draft never
 * published, a draft that differs from what was published, published and
 * waiting, confirmed, or a change asked for.
 */
export function weekStatus(draft: ScheduleWeek | undefined, published: PublishedWeek | undefined): WeekStatus {
  if (!published) return draft && draft.days.length > 0 ? "draft" : "none";
  if (draft && !sameWeek(draft, published.week)) return "changed";
  if (!published.answer) return "waiting";
  return published.answer.answer === "confirmed" ? "confirmed" : "change_asked";
}

export const STATUS_LABEL: Record<WeekStatus, string> = {
  none: "Nothing scheduled",
  draft: "Not published",
  changed: "Changed since it was published",
  waiting: "Published · waiting for them to confirm",
  confirmed: "Confirmed",
  change_asked: "They asked for a change",
};

/** "7:00 AM", from "07:00". */
export function timeLabel(t: string): string {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** "7:00 AM – 3:30 PM", "10:00 PM – 6:00 AM (next day)". */
export const blockLabel = (b: ShiftBlock): string => `${timeLabel(b.start)} – ${timeLabel(b.end)}${overnight(b) ? " (next day)" : ""}`;
