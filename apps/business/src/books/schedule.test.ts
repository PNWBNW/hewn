import { describe, expect, it } from "vitest";
import {
  type ScheduleWeek,
  blockLabel,
  blockMinutes,
  dayOf,
  draftOf,
  emptySchedule,
  emptyWeek,
  markOnCallPaid,
  onCallDays,
  publishedWeek,
  sameWeek,
  scheduleFromJson,
  scheduleToJson,
  scheduleWeekOf,
  setDraft,
  shiftWeek,
  validateScheduleWeek,
  weekShiftMinutes,
  weekStatus,
  withDay,
} from "./schedule";
import { type Thread, type ThreadItem, addToThread, emptyThread, validateMessage } from "./thread";
import { confirmedOnCallDates, unpaidOnCallDates } from "./team_schedule";

const SUN = "2026-10-25";
const WEEK: ScheduleWeek = {
  weekStart: SUN,
  days: [
    { date: "2026-10-26", shifts: [{ start: "07:00", end: "15:30" }], onCall: false },
    // Both layers on one day: a day shift and on call for the whole 24 hours.
    { date: "2026-10-27", shifts: [{ start: "07:00", end: "15:30" }], onCall: true },
    // On call with no shift.
    { date: "2026-10-31", shifts: [], onCall: true },
  ],
};

describe("a schedule week", () => {
  it("holds shifts and on-call as two layers, each day independently", () => {
    const w = validateScheduleWeek(WEEK);
    expect(w).toEqual(WEEK);
    expect(weekShiftMinutes(w)).toBe(2 * 510);
    expect(onCallDays(w)).toBe(2);
    expect(dayOf(w, "2026-10-27")).toEqual({ date: "2026-10-27", shifts: [{ start: "07:00", end: "15:30" }], onCall: true });
    expect(dayOf(w, "2026-10-28")).toEqual({ date: "2026-10-28", shifts: [], onCall: false });
  });

  it("starts on a Sunday, keeps days in their week, drops empty ones and sorts", () => {
    expect(scheduleWeekOf("2026-10-28")).toBe(SUN);
    expect(scheduleWeekOf(SUN)).toBe(SUN);
    expect(scheduleWeekOf("2026-10-31")).toBe(SUN);
    expect(() => validateScheduleWeek({ ...WEEK, weekStart: "2026-10-26" })).toThrow(/Sunday/);
    expect(() => validateScheduleWeek({ ...WEEK, days: [{ date: "2026-11-01", shifts: [], onCall: true }] })).toThrow(/in its week/);
    const messy = validateScheduleWeek({
      weekStart: SUN,
      days: [
        { date: "2026-10-28", shifts: [], onCall: false },
        { date: "2026-10-27", shifts: [{ start: "13:00", end: "17:00" }, { start: "06:00", end: "10:00" }], onCall: false },
      ],
    });
    expect(messy.days).toEqual([{ date: "2026-10-27", shifts: [{ start: "06:00", end: "10:00" }, { start: "13:00", end: "17:00" }], onCall: false }]);
  });

  it("allows a night shift into the next day, and refuses overlaps and nonsense", () => {
    const night = { start: "22:00", end: "06:00" };
    expect(blockMinutes(night)).toBe(480);
    expect(blockLabel(night)).toBe("10:00 PM – 6:00 AM (next day)");
    expect(blockLabel({ start: "07:00", end: "15:30" })).toBe("7:00 AM – 3:30 PM");
    expect(blockLabel({ start: "00:00", end: "12:00" })).toBe("12:00 AM – 12:00 PM");
    const day = (shifts: unknown[]) => ({ weekStart: SUN, days: [{ date: "2026-10-26", shifts, onCall: false }] });
    expect(() => validateScheduleWeek(day([{ start: "07:00", end: "12:00" }, { start: "11:00", end: "15:00" }]))).toThrow(/overlap/);
    expect(() => validateScheduleWeek(day([{ start: "07:00", end: "07:00" }]))).toThrow(/same time/);
    expect(() => validateScheduleWeek(day([{ start: "7:00", end: "15:00" }]))).toThrow(/HH:MM/);
    expect(() => validateScheduleWeek(day([{ start: "24:00", end: "15:00" }]))).toThrow(/HH:MM/);
    expect(() => validateScheduleWeek(day(Array.from({ length: 7 }, (_, i) => ({ start: `0${i}:00`, end: `0${i}:30` }))))).toThrow(/at most 6/);
    expect(() => validateScheduleWeek({ weekStart: SUN, days: [{ date: "2026-10-26", shifts: [], onCall: "yes" }] })).toThrow(/yes or no/);
    expect(() =>
      validateScheduleWeek({ weekStart: SUN, days: [{ date: "2026-10-26", shifts: [], onCall: true }, { date: "2026-10-26", shifts: [], onCall: true }] }),
    ).toThrow(/twice/);
    // A shift that starts once the night shift has ended is fine.
    expect(validateScheduleWeek(day([{ start: "00:00", end: "04:00" }, { start: "22:00", end: "06:00" }])).days[0]!.shifts).toHaveLength(2);
  });

  it("edits a day, copies a week forward, and compares weeks", () => {
    const w = withDay(WEEK, { date: "2026-10-28", shifts: [{ start: "09:00", end: "13:00" }], onCall: false });
    expect(w.days.map((d) => d.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-31"]);
    expect(withDay(w, { date: "2026-10-28", shifts: [], onCall: false }).days).toHaveLength(3);
    const next = shiftWeek(WEEK, "2026-11-01");
    expect(next.days.map((d) => [d.date, d.onCall])).toEqual([["2026-11-02", false], ["2026-11-03", true], ["2026-11-07", true]]);
    expect(sameWeek(WEEK, validateScheduleWeek(JSON.parse(JSON.stringify(WEEK))))).toBe(true);
    expect(sameWeek(WEEK, w)).toBe(false);
  });
});

describe("the business's drafts", () => {
  it("keep one week per person, drop an emptied week, and survive a save", () => {
    let s = setDraft(emptySchedule(), "wkr-1", WEEK);
    s = setDraft(s, "wkr-1", shiftWeek(WEEK, "2026-11-01"));
    expect(draftOf(s, "wkr-1", SUN)).toEqual(WEEK);
    expect(scheduleFromJson(scheduleToJson(s))).toEqual(s);
    s = setDraft(s, "wkr-1", emptyWeek(SUN));
    expect(draftOf(s, "wkr-1", SUN)).toBeUndefined();
    s = setDraft(s, "wkr-1", emptyWeek("2026-11-01"));
    expect(s.drafts).toEqual({});
    expect(() => scheduleFromJson(JSON.stringify({ format: "pnw-schedule", schedule: { version: 1, drafts: { "wkr-1": { "2026-11-01": WEEK } } } }))).toThrow(/wrong date/);
    expect(() => scheduleFromJson("{}")).toThrow(/Not a schedule/);
  });
});

// ---- Published and answered, through the conversation -------------------------------------
const id = (n: number) => n.toString(16).padStart(32, "0");
const item = (n: number, from: "business" | "worker", body: unknown, mine: boolean): ThreadItem => ({
  ...validateMessage({ version: 1, id: id(n), from, sentAt: `2026-10-2${n}T10:00:00.000Z`, body }, from),
  mine,
  seq: n,
});

describe("a published week", () => {
  it("is the latest schedule message for the week, with the answer that names it", () => {
    let t: Thread = emptyThread();
    expect(publishedWeek(t, SUN)).toBeUndefined();
    expect(weekStatus(undefined, undefined)).toBe("none");
    expect(weekStatus(WEEK, undefined)).toBe("draft");
    t = addToThread(t, item(1, "business", { type: "schedule", week: WEEK, note: "Tuesday on call." }, true));
    const p1 = publishedWeek(t, SUN)!;
    expect(p1).toMatchObject({ id: id(1), week: WEEK, note: "Tuesday on call.", mine: true });
    expect(p1.answer).toBeUndefined();
    expect(weekStatus(undefined, p1)).toBe("waiting");
    // A draft that differs from what was published.
    expect(weekStatus(withDay(WEEK, { date: "2026-10-29", shifts: [], onCall: true }), p1)).toBe("changed");
    expect(weekStatus(WEEK, p1)).toBe("waiting");
    // They ask for a change; a new week is published; they confirm that one.
    t = addToThread(t, item(2, "worker", { type: "schedule_answer", scheduleId: id(1), weekStart: SUN, answer: "change", note: "Can't do Saturday." }, false));
    expect(weekStatus(undefined, publishedWeek(t, SUN))).toBe("change_asked");
    expect(publishedWeek(t, SUN)!.answer).toMatchObject({ answer: "change", note: "Can't do Saturday.", mine: false });
    const fixed = withDay(WEEK, { date: "2026-10-31", shifts: [], onCall: false });
    t = addToThread(t, item(3, "business", { type: "schedule", week: fixed, note: "" }, true));
    expect(publishedWeek(t, SUN)).toMatchObject({ id: id(3), week: fixed });
    expect(publishedWeek(t, SUN)!.answer).toBeUndefined(); // the old answer was for the old week
    t = addToThread(t, item(4, "worker", { type: "schedule_answer", scheduleId: id(3), weekStart: SUN, answer: "confirmed", note: "" }, false));
    expect(weekStatus(undefined, publishedWeek(t, SUN))).toBe("confirmed");
    // Another week isn't touched.
    expect(publishedWeek(t, "2026-11-01")).toBeUndefined();
  });

  it("travels only from the side that may send it, and only when whole", () => {
    expect(() => validateMessage({ version: 1, id: id(1), from: "worker", sentAt: "2026-10-21T10:00:00.000Z", body: { type: "schedule", week: WEEK, note: "" } }, "worker")).toThrow(
      /can't send/,
    );
    expect(() =>
      validateMessage(
        { version: 1, id: id(1), from: "business", sentAt: "2026-10-21T10:00:00.000Z", body: { type: "schedule_answer", scheduleId: id(1), weekStart: SUN, answer: "confirmed", note: "" } },
        "business",
      ),
    ).toThrow(/can't send/);
    const bad = (body: unknown, from: "business" | "worker") => () => validateMessage({ version: 1, id: id(1), from, sentAt: "2026-10-21T10:00:00.000Z", body }, from);
    expect(bad({ type: "schedule", week: { ...WEEK, weekStart: "2026-10-26" }, note: "" }, "business")).toThrow(/Sunday/);
    expect(bad({ type: "schedule", week: WEEK, note: "x".repeat(501) }, "business")).toThrow(/at most 500/);
    expect(bad({ type: "schedule_answer", scheduleId: "nope", weekStart: SUN, answer: "confirmed", note: "" }, "worker")).toThrow(/names the schedule/);
    expect(bad({ type: "schedule_answer", scheduleId: id(1), weekStart: SUN, answer: "maybe", note: "" }, "worker")).toThrow(/confirms or asks/);
    expect(bad({ type: "schedule_answer", scheduleId: id(1), weekStart: SUN, answer: "change", note: "  " }, "worker")).toThrow(/what needs to change/);
  });
});

describe("on-call days for pay", () => {
  it("count only in weeks the person confirmed, inside the period, and are paid once", () => {
    let t: Thread = emptyThread();
    t = addToThread(t, item(1, "business", { type: "schedule", week: WEEK, note: "" }, true));
    // Published but not confirmed: nothing to pay yet.
    expect(confirmedOnCallDates(t, "2026-10-25", "2026-10-31")).toEqual([]);
    t = addToThread(t, item(2, "worker", { type: "schedule_answer", scheduleId: id(1), weekStart: SUN, answer: "confirmed", note: "" }, false));
    expect(confirmedOnCallDates(t, "2026-10-25", "2026-10-31")).toEqual(["2026-10-27", "2026-10-31"]);
    expect(confirmedOnCallDates(t, "2026-10-20", "2026-10-28")).toEqual(["2026-10-27"]); // a period across two weeks
    let s = setDraft(emptySchedule(), "wkr-1", shiftWeek(WEEK, "2026-11-01"));
    expect(unpaidOnCallDates(t, s.onCallPaid, "wkr-1", "2026-10-25", "2026-10-31")).toEqual(["2026-10-27", "2026-10-31"]);
    s = markOnCallPaid(s, "wkr-1", ["2026-10-27"], "run-1");
    expect(unpaidOnCallDates(t, s.onCallPaid, "wkr-1", "2026-10-25", "2026-10-31")).toEqual(["2026-10-31"]);
    expect(markOnCallPaid(s, "wkr-1", ["2026-10-27"], "run-2").onCallPaid).toEqual({ "wkr-1": { "2026-10-27": "run-1" } });
    // Drafts and paid days both survive a save, and a draft edit keeps the paid days.
    const saved = scheduleFromJson(scheduleToJson(setDraft(s, "wkr-1", WEEK)));
    expect(saved.onCallPaid).toEqual({ "wkr-1": { "2026-10-27": "run-1" } });
    expect(draftOf(saved, "wkr-1", "2026-11-01")).toBeDefined();
    // Republished with the same days: the confirmation stands.
    t = addToThread(t, item(3, "business", { type: "schedule", week: WEEK, note: "Same week, sent again." }, true));
    expect(confirmedOnCallDates(t, "2026-10-25", "2026-10-31")).toEqual(["2026-10-27", "2026-10-31"]);
    // Republished with their days changed: nothing pays until they confirm again.
    t = addToThread(t, item(4, "business", { type: "schedule", week: withDay(WEEK, { date: "2026-10-28", shifts: [], onCall: true }), note: "" }, true));
    expect(confirmedOnCallDates(t, "2026-10-25", "2026-10-31")).toEqual([]);
    expect(() => markOnCallPaid(s, "wkr-1", ["2026-10-31"], "")).toThrow(/needs an id/);
  });
});
