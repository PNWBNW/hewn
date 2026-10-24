// A worked shift against the confirmed schedule (books/schedule_check.ts): late, early, unscheduled,
// and nothing flagged where nothing was confirmed.

import { describe, expect, it } from "vitest";
import type { ScheduleWeek } from "./schedule";
import { GRACE_MINUTES, checkLabels, checkShift, confirmedWeekFrom } from "./schedule_check";
import { type TeamPost, whoOf } from "./team_schedule";
import { addToThread, emptyThread, validateMessage } from "./thread";

const ZONE = "America/Los_Angeles";
const SUN = "2026-10-25";
// Monday Oct 26: 7:00–15:30 at the workplace. Tuesday: on call. Saturday: a night shift 22:00–06:00.
const WEEK: ScheduleWeek = {
  weekStart: SUN,
  days: [
    { date: "2026-10-26", shifts: [{ start: "07:00", end: "15:30" }], onCall: false },
    { date: "2026-10-27", shifts: [], onCall: true },
    { date: "2026-10-31", shifts: [{ start: "22:00", end: "06:00" }], onCall: false },
  ],
};
const confirmed = (ws: string) => (ws === SUN ? WEEK : undefined);
// Pacific daylight time is UTC-7 through Nov 1, 2026; standard (UTC-8) after.
const at = (date: string, hhmm: string, offset = 7) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return new Date(Date.parse(`${date}T00:00:00Z`) + ((h + offset) * 60 + m) * 60_000).toISOString();
};

describe("a shift against the confirmed schedule", () => {
  it("flags a clock-in 20 minutes late on the business's timecard (the Phase 9 exit criterion)", () => {
    const check = checkShift({ in: at("2026-10-26", "07:20"), out: at("2026-10-26", "15:30") }, confirmed, ZONE);
    expect(check).toEqual({ kind: "scheduled", date: "2026-10-26", block: { start: "07:00", end: "15:30" }, startLate: 20, endLate: 0 });
    expect(checkLabels(check)).toEqual([{ text: "Started 20 min late", warn: true }]);
  });

  it("calls on time anything within the grace, and says early, left early and stayed late past it", () => {
    const grace = checkShift({ in: at("2026-10-26", "07:05"), out: at("2026-10-26", "15:26") }, confirmed, ZONE);
    expect(GRACE_MINUTES).toBe(5);
    expect(checkLabels(grace)).toEqual([]);
    expect(checkLabels(checkShift({ in: at("2026-10-26", "06:40"), out: at("2026-10-26", "15:00") }, confirmed, ZONE))).toEqual([
      { text: "Started 20 min early", warn: false },
      { text: "Left 30 min early", warn: true },
    ]);
    expect(checkLabels(checkShift({ in: at("2026-10-26", "07:00"), out: at("2026-10-26", "16:15") }, confirmed, ZONE))).toEqual([{ text: "Stayed 45 min late", warn: false }]);
  });

  it("matches a night shift across midnight, and a clock change doesn't move it", () => {
    // Sat 22:10 PDT to Sun 06:00 PST: the clocks go back at 2:00 on Nov 1.
    const check = checkShift({ in: at("2026-10-31", "22:10"), out: at("2026-11-01", "06:00", 8) }, confirmed, ZONE);
    expect(check).toMatchObject({ kind: "scheduled", date: "2026-10-31", startLate: 10, endLate: 0 });
  });

  it("says a shift on a confirmed week with no scheduled shift under it is not on the schedule, and names an on-call day", () => {
    expect(checkLabels(checkShift({ in: at("2026-10-28", "09:00"), out: at("2026-10-28", "12:00") }, confirmed, ZONE))).toEqual([{ text: "Not on the schedule", warn: true }]);
    expect(checkShift({ in: at("2026-10-27", "09:00"), out: at("2026-10-27", "12:00") }, confirmed, ZONE)).toEqual({ kind: "unscheduled", onCall: true });
    // Earlier the same day as a scheduled shift, without touching it.
    expect(checkShift({ in: at("2026-10-26", "03:00"), out: at("2026-10-26", "05:00") }, confirmed, ZONE)).toEqual({ kind: "unscheduled", onCall: false });
  });

  it("flags nothing without a confirmed week, or for a callout", () => {
    expect(checkShift({ in: at("2026-11-02", "09:20"), out: at("2026-11-02", "17:00", 8) }, confirmed, ZONE)).toEqual({ kind: "not_compared" });
    expect(checkShift({ in: at("2026-10-27", "02:00"), out: at("2026-10-27", "04:00"), callout: true }, confirmed, ZONE)).toEqual({ kind: "not_compared" });
    expect(checkLabels({ kind: "not_compared" })).toEqual([]);
  });
});

describe("the confirmed week", () => {
  const KEY = "ab".repeat(32);
  const id = (n: number) => n.toString(16).padStart(32, "0");
  const post = (sentAt: string, publishId: string, days: ScheduleWeek["days"]): TeamPost => ({
    sentAt,
    schedule: { weekStart: SUN, publishId, part: 0, parts: 1, people: [{ who: whoOf(KEY), name: "Ana", days }] },
  });
  const answered = (scheduleId: string, a: "confirmed" | "change") =>
    addToThread(emptyThread(), {
      ...validateMessage({ version: 1, id: id(9), from: "worker", sentAt: "2026-10-22T10:00:00.000Z", body: { type: "schedule_answer", scheduleId, weekStart: SUN, answer: a, note: a === "change" ? "Can't do Monday." : "" } }, "worker"),
      mine: false,
      seq: 1,
    });

  it("is the published week once the person confirmed it, and nothing before, after a change asked, or once their days change", () => {
    const team = [post("2026-10-21T10:00:00.000Z", id(1), WEEK.days)];
    expect(confirmedWeekFrom({ team, who: whoOf(KEY) })(SUN)).toBeUndefined();
    expect(confirmedWeekFrom({ thread: answered(id(1), "change"), team, who: whoOf(KEY) })(SUN)).toBeUndefined();
    expect(confirmedWeekFrom({ thread: answered(id(1), "confirmed"), team, who: whoOf(KEY) })(SUN)?.days).toEqual(WEEK.days);
    const moved = [...team, post("2026-10-23T10:00:00.000Z", id(2), WEEK.days.slice(1))];
    expect(confirmedWeekFrom({ thread: answered(id(1), "confirmed"), team: moved, who: whoOf(KEY) })(SUN)).toBeUndefined();
  });
});
