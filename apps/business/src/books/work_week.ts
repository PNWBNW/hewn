// ---------------------------------------------------------------------------
// The work week an offer sets (Joshua, 2026-10-19): which day it starts on,
// the time zone its days are drawn in, when overtime starts (after so many
// hours in a week, and, where the state says so, in a day) and the longest
// shift before a clock-out is questioned. It travels inside the offer's
// terms, so both sides draw the same calendar from the same words, and the
// chain never has to know what day it is: every stamp is a full instant, and
// this is the ruler both apps lay against it.
//
// A CONTRACT SHARED WITH THE PERSON'S SIDE: exactly these keys, in this
// order, through `validateWorkWeek`; the terms hash covers them. Pure.
// ---------------------------------------------------------------------------

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type WorkWeek = {
  startsOn: Weekday;
  /** An IANA time zone, like America/Los_Angeles: the days and weeks are drawn in it. */
  timeZone: string;
  /** Overtime after this many hours in a work week; 0 means none. Whole or half hours. */
  overtimeAfterHours: number;
  /** Overtime after this many hours in a day (some states); 0 means none. Whole or half hours. */
  dailyOvertimeAfterHours: number;
  /** A shift longer than this is questioned before it is sent. Whole or half hours, at least 1. */
  longestShiftHours: number;
  /**
   * What an overtime hour pays, as a multiple of the hourly rate: 1.5 for time and a half
   * (Joshua, 2026-10-19), 1 to 3 to the hundredth. Absent on work weeks from before it was asked,
   * which pay time and a half.
   */
  overtimeRate?: number;
};

export const WORK_WEEK_KEYS = ["startsOn", "timeZone", "overtimeAfterHours", "dailyOvertimeAfterHours", "longestShiftHours", "overtimeRate"] as const;

/** Time and a half: the overtime rate when the terms don't say. */
export const DEFAULT_OVERTIME_RATE = 1.5;

/** The rules hours are paid by: the agreement's work week, or the baseline (40 hours a week, time and a half) without one. */
export type PayRules = Pick<WorkWeek, "timeZone" | "overtimeAfterHours" | "dailyOvertimeAfterHours"> & { overtimeRate: number };
export function payRulesOf(w: WorkWeek | undefined, timeZone: string = deviceTimeZone()): PayRules {
  if (!w) return { timeZone, overtimeAfterHours: 40, dailyOvertimeAfterHours: 0, overtimeRate: DEFAULT_OVERTIME_RATE };
  return { timeZone: w.timeZone, overtimeAfterHours: w.overtimeAfterHours, dailyOvertimeAfterHours: w.dailyOvertimeAfterHours, overtimeRate: w.overtimeRate ?? DEFAULT_OVERTIME_RATE };
}

/** 1.5 → "1.5×". */
export const rateText = (r: number): string => `${r}×`;

const isRate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 3 && Math.round(v * 100) === v * 100;

/** JavaScript's day numbers (Sunday 0) for each weekday. */
export const WEEKDAY_INDEX: Record<Weekday, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

export const isWeekday = (v: unknown): v is Weekday => WEEKDAYS.includes(v as Weekday);

/** "Monday". */
export const weekdayLabel = (d: Weekday): string => d.charAt(0).toUpperCase() + d.slice(1);

/** The zone this device is set to, or UTC when it can't say. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** True for a time zone name this runtime knows. */
export function isTimeZone(v: unknown): v is string {
  if (typeof v !== "string" || !v || v.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(v)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** Sunday to Saturday (Joshua, 2026-10-19) in the given zone, overtime after 40 hours, a 12-hour shift at most: the usual starting point. */
export function defaultWorkWeek(timeZone: string = deviceTimeZone()): WorkWeek {
  return { startsOn: "sunday", timeZone, overtimeAfterHours: 40, dailyOvertimeAfterHours: 0, longestShiftHours: 12, overtimeRate: DEFAULT_OVERTIME_RATE };
}

const isHalfHours = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max && Number.isInteger(v * 2);

/** Checks a work week and returns a clean copy with the keys in the contract's order. */
export function validateWorkWeek(raw: unknown): WorkWeek {
  const w = raw as Partial<WorkWeek> | null;
  if (!w || typeof w !== "object") throw new Error("The work week must be an object");
  if (!isWeekday(w.startsOn)) throw new Error("The work week must start on a day of the week");
  if (!isTimeZone(w.timeZone)) throw new Error("The work week needs a time zone this app knows");
  if (!isHalfHours(w.overtimeAfterHours, 0, 168)) throw new Error("Overtime after must be whole or half hours in a week, up to 168 (0 for none)");
  if (!isHalfHours(w.dailyOvertimeAfterHours, 0, 24)) throw new Error("Daily overtime after must be whole or half hours in a day, up to 24 (0 for none)");
  if (!isHalfHours(w.longestShiftHours, 1, 24)) throw new Error("The longest shift must be whole or half hours, from 1 to 24");
  if (w.overtimeRate !== undefined && !isRate(w.overtimeRate)) throw new Error("Overtime pay must be 1 to 3 times the hourly rate, like 1.5");
  return {
    startsOn: w.startsOn,
    timeZone: w.timeZone,
    overtimeAfterHours: w.overtimeAfterHours,
    dailyOvertimeAfterHours: w.dailyOvertimeAfterHours,
    longestShiftHours: w.longestShiftHours,
    // Last, and only when given: a work week from before it was asked keeps its exact bytes.
    ...(w.overtimeRate !== undefined ? { overtimeRate: w.overtimeRate } : {}),
  };
}

/** "40", "37.5": whole or half hours as a number, or null when the text isn't that. */
export function cleanHalfHours(text: string, min: number, max: number): number | null {
  const s = text.trim();
  if (!/^\d{1,3}(\.5)?$/.test(s)) return null;
  const n = Number(s);
  return isHalfHours(n, min, max) ? n : null;
}

/** "12" or "7.5". */
export const hoursText = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** "Pacific Time" where the runtime can say it, else the zone's own name. */
export function timeZoneLabel(timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    return part?.value && !/^GMT/.test(part.value) ? part.value : timeZone;
  } catch {
    return timeZone;
  }
}

/** The day before the week starts: "Sunday" for a week that starts Monday. */
export const weekEndsOn = (startsOn: Weekday): Weekday => WEEKDAYS[(WEEKDAYS.indexOf(startsOn) + 6) % 7]!;

/** The sentences an offer's terms say about the work week, one fact each. */
export function workWeekLines(w: WorkWeek): string[] {
  const lines = [`Work week: ${weekdayLabel(w.startsOn)} to ${weekdayLabel(weekEndsOn(w.startsOn))}, ${timeZoneLabel(w.timeZone)} (${w.timeZone}).`];
  const paid = `, paid at ${w.overtimeRate ?? DEFAULT_OVERTIME_RATE} times the hourly rate`;
  if (w.overtimeAfterHours > 0 && w.dailyOvertimeAfterHours > 0) lines.push(`Overtime: after ${hoursText(w.dailyOvertimeAfterHours)} hours in a day or ${hoursText(w.overtimeAfterHours)} hours in a week${paid}.`);
  else if (w.overtimeAfterHours > 0) lines.push(`Overtime: after ${hoursText(w.overtimeAfterHours)} hours in a week${paid}.`);
  else if (w.dailyOvertimeAfterHours > 0) lines.push(`Overtime: after ${hoursText(w.dailyOvertimeAfterHours)} hours in a day${paid}.`);
  else lines.push("Overtime: none.");
  lines.push(`Shifts: a shift longer than ${hoursText(w.longestShiftHours)} hours is reviewed before it is paid.`);
  return lines;
}

/** "Monday to Sunday · overtime after 40 hours a week · shifts up to 12 hours". */
export function workWeekSummary(w: WorkWeek): string {
  const overtime =
    w.overtimeAfterHours > 0 && w.dailyOvertimeAfterHours > 0
      ? `overtime after ${hoursText(w.dailyOvertimeAfterHours)} hours a day or ${hoursText(w.overtimeAfterHours)} a week`
      : w.overtimeAfterHours > 0
        ? `overtime after ${hoursText(w.overtimeAfterHours)} hours a week`
        : w.dailyOvertimeAfterHours > 0
          ? `overtime after ${hoursText(w.dailyOvertimeAfterHours)} hours a day`
          : "no overtime";
  const rate = overtime === "no overtime" ? "" : ` at ${rateText(w.overtimeRate ?? DEFAULT_OVERTIME_RATE)}`;
  return `${weekdayLabel(w.startsOn)} to ${weekdayLabel(weekEndsOn(w.startsOn))} · ${overtime}${rate} · shifts up to ${hoursText(w.longestShiftHours)} hours`;
}

// ---- The form's view of it --------------------------------------------------------------------

export type WorkWeekDraft = { startsOn: Weekday; timeZone: string; overtimeText: string; dailyText: string; longestText: string; rateText: string };

export const draftOfWorkWeek = (w: WorkWeek): WorkWeekDraft => ({
  startsOn: w.startsOn,
  timeZone: w.timeZone,
  overtimeText: hoursText(w.overtimeAfterHours),
  dailyText: hoursText(w.dailyOvertimeAfterHours),
  longestText: hoursText(w.longestShiftHours),
  rateText: String(w.overtimeRate ?? DEFAULT_OVERTIME_RATE),
});

/** The work week the form describes, or why it can't be one. */
export function workWeekFromDraft(d: WorkWeekDraft): { workWeek: WorkWeek } | { problem: string } {
  const overtime = cleanHalfHours(d.overtimeText || "0", 0, 168);
  if (overtime === null) return { problem: "Overtime after must be whole or half hours in a week, like 40 (0 for none)" };
  const daily = cleanHalfHours(d.dailyText || "0", 0, 24);
  if (daily === null) return { problem: "Daily overtime after must be whole or half hours, like 8 (0 for none)" };
  const longest = cleanHalfHours(d.longestText, 1, 24);
  if (longest === null) return { problem: "The longest shift must be whole or half hours, from 1 to 24" };
  const rateIn = (d.rateText ?? "").trim() || String(DEFAULT_OVERTIME_RATE);
  const rate = /^\d(\.\d{1,2})?$/.test(rateIn) ? Number(rateIn) : NaN;
  if (!isRate(rate)) return { problem: "Overtime pay must be 1 to 3 times the hourly rate, like 1.5" };
  try {
    return {
      workWeek: validateWorkWeek({ startsOn: d.startsOn, timeZone: d.timeZone, overtimeAfterHours: overtime, dailyOvertimeAfterHours: daily, longestShiftHours: longest, overtimeRate: rate }),
    };
  } catch (e) {
    return { problem: e instanceof Error ? e.message : "The work week isn't valid" };
  }
}
