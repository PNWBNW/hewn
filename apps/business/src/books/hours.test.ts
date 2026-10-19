// Local-time maths, so the tests pin a time zone with a real offset.
process.env.TZ = "America/Los_Angeles";

import { describe, expect, it } from "vitest";
import { addDays, buildTimesheet, calendarOf, formatMinutes, localDate, longestMinutesOf, minutesByDay, overtimeSplit, sendProblem, shiftsOf, startOfDay, weekDays, weekMinutes, weekStartOf } from "./hours";
import { emptyLetter } from "./offer_letter";
import { type Punch, type TermsV2, confirmShift, emptyWork, punch, updatePunch, upsertAgreement } from "./work";
import { defaultWorkWeek } from "./work_week";

const AID = "01".repeat(32);
const base = upsertAgreement(emptyWork("Ana"), { agreementId: AID, partiesKey: "ab".repeat(32), employerAddress: "aleo1" + "k".repeat(58), employerNameHash: "1", status: "active" });

// 2026-10-14 is a Wednesday. Pacific daylight time is UTC−7, so 09:00 local = 16:00Z.
const P = (id: string, kind: Punch["kind"], at: string): Punch => ({ id, agreementId: AID, kind, at });
const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`).toISOString();

describe("calendar", () => {
  it("uses local dates and starts the week on Monday", () => {
    expect(localDate(new Date("2026-10-14T06:30:00.000Z"))).toBe("2026-10-13"); // still Tuesday evening in LA
    expect(weekStartOf("2026-10-14")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-12")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-18")).toBe("2026-10-12"); // Sunday belongs to the week before
    expect(weekStartOf("2026-10-19")).toBe("2026-10-19");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(weekDays("2026-10-12")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  });

  it("formats minutes", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(450)).toBe("7h 30m");
    expect(formatMinutes(125)).toBe("2h 05m");
  });
});

describe("shifts", () => {
  const now = new Date(local("2026-10-16", "12:00"));

  it("adds up closed shifts per local day", () => {
    const punches = [P("a", "in", local("2026-10-14", "09:00")), P("b", "out", local("2026-10-14", "12:30")), P("c", "in", local("2026-10-14", "13:00")), P("d", "out", local("2026-10-14", "17:00"))];
    expect(minutesByDay(punches, AID, now).get("2026-10-14")).toBe(210 + 240);
    expect(weekMinutes(punches, AID, "2026-10-12", now)).toBe(450);
    expect(weekMinutes(punches, AID, "2026-10-19", now)).toBe(0);
  });

  it("splits a shift that crosses midnight between the two days", () => {
    const punches = [P("a", "in", local("2026-10-14", "22:00")), P("b", "out", local("2026-10-15", "02:00"))];
    const by = minutesByDay(punches, AID, now);
    expect(by.get("2026-10-14")).toBe(120);
    expect(by.get("2026-10-15")).toBe(120);
    expect(shiftsOf(punches, AID, now).map((s) => [s.date, s.minutes, s.open])).toEqual([["2026-10-14", 120, false], ["2026-10-15", 120, false]]);
  });

  it("counts an open shift up to now, or to midnight if its day has ended", () => {
    const today = [P("a", "in", local("2026-10-16", "09:15"))];
    expect(minutesByDay(today, AID, now).get("2026-10-16")).toBe(165);
    const forgotten = [P("a", "in", local("2026-10-14", "20:00"))];
    const by = minutesByDay(forgotten, AID, now);
    expect(by.get("2026-10-14")).toBe(240);
    expect(by.get("2026-10-15")).toBeUndefined();
    expect(shiftsOf(forgotten, AID, now)[0]).toMatchObject({ open: true, out: new Date(local("2026-10-15", "00:00")).toISOString() });
  });

  it("ignores other agreements", () => {
    const punches = [P("a", "in", local("2026-10-14", "09:00")), P("b", "out", local("2026-10-14", "10:00")), { ...P("c", "in", local("2026-10-14", "11:00")), agreementId: "ff" }];
    expect(minutesByDay(punches, AID, now).get("2026-10-14")).toBe(60);
    expect(shiftsOf(punches, AID, now)).toHaveLength(1);
    expect(weekMinutes(punches, "ff", "2026-10-12", now)).toBe(12 * 60); // open since 11:00: the longest shift (12h) comes before that midnight
    expect(weekMinutes(punches, "ff", "2026-10-12", now, undefined, 24 * 60)).toBe(13 * 60); // with a longer longest shift, closed at that midnight
  });
});

describe("timesheet payload", () => {
  it("carries the week's shifts with the shared field names", () => {
    let w = base;
    w = punch(w, AID, local("2026-10-13", "08:00"), "a").work;
    w = punch(w, AID, local("2026-10-13", "16:30"), "b").work;
    w = punch(w, AID, local("2026-10-15", "09:00"), "c").work;
    w = punch(w, AID, local("2026-10-15", "12:00"), "d").work;
    const now = new Date(local("2026-10-17", "18:00"));
    const sheet = buildTimesheet(w, AID, "2026-10-12", now);
    expect(sheet).toEqual({
      version: 1,
      kind: "timesheet",
      agreementId: AID,
      weekStart: "2026-10-12",
      entries: [
        { date: "2026-10-13", in: local("2026-10-13", "08:00"), out: local("2026-10-13", "16:30"), minutes: 510 },
        { date: "2026-10-15", in: local("2026-10-15", "09:00"), out: local("2026-10-15", "12:00"), minutes: 180 },
      ],
      totalMinutes: 690,
      sentAt: now.toISOString(),
    });
    expect(Object.keys(sheet)).toEqual(["version", "kind", "agreementId", "weekStart", "entries", "totalMinutes", "sentAt"]);
  });

  it("refuses a non-Monday, an unknown agreement and an empty week", () => {
    const now = new Date();
    expect(() => buildTimesheet(base, AID, "2026-10-14", now)).toThrow(/Monday/);
    expect(() => buildTimesheet(base, "ff", "2026-10-12", now)).toThrow(/No agreement/);
    expect(() => buildTimesheet(base, AID, "2026-10-12", now)).toThrow(/Nothing to send/);
  });
});

// ---- The calendar the terms set ------------------------------------------------------------

const V2: TermsV2 = {
  version: 2,
  kind: "terms",
  agreementId: "a".repeat(64),
  termsText: "Framing.",
  payType: "hourly",
  rate: "3000",
  frequency: "weekly",
  startDate: "2026-10-05",
  businessName: "Brothers",
  offeredAt: "2026-10-01T15:00:00.000Z",
  expiresAt: "2026-10-08T15:00:00.000Z",
  letter: emptyLetter(),
  files: [],
};
const AGREEMENT = { agreementId: AID, partiesKey: "ab".repeat(32), employerAddress: "aleo1" + "k".repeat(58), employerNameHash: "1", status: "active" as const };

describe("the calendar from the terms", () => {
  it("draws days in the work week's zone and starts the week on its day", () => {
    const t = new Date("2026-10-14T06:30:00.000Z"); // Tuesday evening in Los Angeles, Wednesday afternoon in Tokyo
    expect(localDate(t, "America/Los_Angeles")).toBe("2026-10-13");
    expect(localDate(t, "Asia/Tokyo")).toBe("2026-10-14");
    expect(localDate(t, "UTC")).toBe("2026-10-14");
    expect(startOfDay("2026-10-14", "Asia/Tokyo").toISOString()).toBe("2026-10-13T15:00:00.000Z");
    expect(startOfDay("2026-10-14", "America/Los_Angeles").toISOString()).toBe("2026-10-14T07:00:00.000Z");
    expect(startOfDay("2026-11-01", "America/Los_Angeles").toISOString()).toBe("2026-11-01T07:00:00.000Z"); // the clocks go back that morning
    expect(startOfDay("2026-11-02", "America/Los_Angeles").toISOString()).toBe("2026-11-02T08:00:00.000Z");
    expect(startOfDay("2026-10-14", "Asia/Kolkata").toISOString()).toBe("2026-10-13T18:30:00.000Z"); // a half-hour zone
    expect(weekStartOf("2026-10-14", { startsOn: "sunday" })).toBe("2026-10-11");
    expect(weekStartOf("2026-10-11", { startsOn: "sunday" })).toBe("2026-10-11");
    expect(weekStartOf("2026-10-17", { startsOn: "sunday" })).toBe("2026-10-11");
    expect(weekStartOf("2026-10-18", { startsOn: "sunday" })).toBe("2026-10-18");
    expect(weekStartOf("2026-10-14", { startsOn: "wednesday" })).toBe("2026-10-14");
    expect(weekStartOf("2026-10-13", { startsOn: "wednesday" })).toBe("2026-10-07");
    expect(calendarOf(undefined)).toEqual({ startsOn: "monday", timeZone: expect.any(String) });
    expect(calendarOf({ terms: V2 })).toEqual({ startsOn: "monday", timeZone: expect.any(String) });
    expect(calendarOf({ terms: { ...V2, workWeek: { ...defaultWorkWeek("Asia/Tokyo"), startsOn: "sunday" } } })).toEqual({ startsOn: "sunday", timeZone: "Asia/Tokyo" });
  });

  it("splits a shift at the work week's midnight, not the device's", () => {
    // 22:00 to 02:00 in Tokyo is 06:00 to 10:00 the same day in Los Angeles.
    const punches = [P("a", "in", "2026-10-14T13:00:00.000Z"), P("b", "out", "2026-10-14T17:00:00.000Z")];
    const now = new Date("2026-10-16T00:00:00.000Z");
    expect([...minutesByDay(punches, AID, now, "Asia/Tokyo")]).toEqual([["2026-10-14", 120], ["2026-10-15", 120]]);
    expect([...minutesByDay(punches, AID, now, "America/Los_Angeles")]).toEqual([["2026-10-14", 240]]);
    expect(shiftsOf(punches, AID, now, "Asia/Tokyo")[0]).toMatchObject({ date: "2026-10-14", out: "2026-10-14T15:00:00.000Z", minutes: 120 });
  });

  it("builds the sheet for the agreement's own week, starting on its day", () => {
    let w = upsertAgreement(emptyWork("Ana"), { ...AGREEMENT, terms: { ...V2, workWeek: { ...defaultWorkWeek("America/Los_Angeles"), startsOn: "sunday" } } });
    w = punch(w, AID, local("2026-10-11", "09:00"), "a").work; // a Sunday
    w = punch(w, AID, local("2026-10-11", "12:00"), "b").work;
    const now = new Date(local("2026-10-17", "18:00"));
    expect(buildTimesheet(w, AID, "2026-10-11", now)).toMatchObject({ weekStart: "2026-10-11", totalMinutes: 180 });
    expect(() => buildTimesheet(w, AID, "2026-10-12", now)).toThrow(/starts on a Sunday/);
    // Without a work week in the terms, Monday as before.
    expect(() => buildTimesheet(upsertAgreement(emptyWork("Bo"), AGREEMENT), AID, "2026-10-11", now)).toThrow(/starts on a Monday/);
  });
});

describe("overtime", () => {
  const week = { timeZone: "America/Los_Angeles", overtimeAfterHours: 40, dailyOvertimeAfterHours: 0 };
  const day = (date: string, hours: number) => ({ in: local(date, "08:00"), minutes: hours * 60 });
  const five = (hours: number) => ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"].map((d) => day(d, hours));

  it("is what passes the week's threshold", () => {
    expect(overtimeSplit(five(8), week)).toEqual({ regular: 2400, overtime: 0 });
    expect(overtimeSplit(five(9), week)).toEqual({ regular: 2400, overtime: 300 });
    expect(overtimeSplit([day("2026-10-12", 10), day("2026-10-12", 2)], week)).toEqual({ regular: 720, overtime: 0 });
  });

  it("takes the day's overtime first, and never counts an hour twice", () => {
    const daily = { ...week, dailyOvertimeAfterHours: 8 };
    expect(overtimeSplit(five(10), daily)).toEqual({ regular: 2400, overtime: 600 }); // 2 a day over 8, and the 40 regular are not over
    expect(overtimeSplit([...five(8).slice(0, 4), day("2026-10-16", 10)], daily)).toEqual({ regular: 2400, overtime: 120 });
    expect(overtimeSplit([...five(9), day("2026-10-17", 4)], daily)).toEqual({ regular: 2400, overtime: 540 }); // 5 daily + 4 weekly
    // Two stretches of one day add up before the day's threshold applies.
    expect(overtimeSplit([day("2026-10-12", 5), day("2026-10-12", 5)], daily)).toEqual({ regular: 480, overtime: 120 });
  });

  it("is none when the week says none, and the day is drawn in the week's zone", () => {
    expect(overtimeSplit(five(12), { ...week, overtimeAfterHours: 0 })).toEqual({ regular: 3600, overtime: 0 });
    expect(overtimeSplit(five(12), { ...week, overtimeAfterHours: 0, dailyOvertimeAfterHours: 10 })).toEqual({ regular: 3000, overtime: 600 });
    // 23:00 Monday and 02:00 Tuesday in Los Angeles are both Tuesday in Tokyo: there the two stretches are one day of 10 hours.
    const late = [{ in: local("2026-10-12", "23:00"), minutes: 300 }, { in: local("2026-10-13", "02:00"), minutes: 300 }];
    expect(overtimeSplit(late, { ...week, overtimeAfterHours: 0, dailyOvertimeAfterHours: 8 })).toEqual({ regular: 600, overtime: 0 });
    expect(overtimeSplit(late, { timeZone: "Asia/Tokyo", overtimeAfterHours: 0, dailyOvertimeAfterHours: 8 })).toEqual({ regular: 480, overtime: 120 });
  });
});

describe("a forgotten clock-out (the longest shift)", () => {
  const now = new Date(local("2026-10-16", "12:00"));

  it("marks a closed shift longer than the longest shift, and keeps the person's confirmation", () => {
    const punches: Punch[] = [P("a", "in", local("2026-10-14", "06:00")), P("b", "out", local("2026-10-14", "20:00"))];
    const [day] = shiftsOf(punches, AID, now, "America/Los_Angeles", 12 * 60);
    expect(day).toMatchObject({ minutes: 14 * 60, long: true, confirmed: false });
    const fine = shiftsOf(punches, AID, now, "America/Los_Angeles", 14 * 60);
    expect(fine[0]).toMatchObject({ long: false, confirmed: false });
    const confirmed = [punches[0]!, { ...punches[1]!, confirmed: true as const }];
    expect(shiftsOf(confirmed, AID, now, "America/Los_Angeles", 12 * 60)[0]).toMatchObject({ long: true, confirmed: true });
    // Both halves of a shift that crosses midnight carry the mark.
    const night: Punch[] = [P("a", "in", local("2026-10-14", "18:00")), P("b", "out", local("2026-10-15", "08:00"))];
    expect(shiftsOf(night, AID, now, "America/Los_Angeles", 12 * 60).map((s) => [s.date, s.long])).toEqual([["2026-10-14", true], ["2026-10-15", true]]);
    expect(longestMinutesOf(undefined)).toBe(720);
    expect(longestMinutesOf({ terms: { ...V2, workWeek: { ...defaultWorkWeek("America/Los_Angeles"), longestShiftHours: 10.5 } } })).toBe(630);
  });

  it("stops counting an open shift at the longest shift, and says it is long once that passes", () => {
    const open = [P("a", "in", local("2026-10-16", "02:00"))];
    expect(shiftsOf(open, AID, new Date(local("2026-10-16", "09:00")), "America/Los_Angeles", 12 * 60)[0]).toMatchObject({ minutes: 7 * 60, long: false, open: true });
    const late = shiftsOf(open, AID, new Date(local("2026-10-16", "15:00")), "America/Los_Angeles", 12 * 60)[0]!;
    expect(late).toMatchObject({ minutes: 12 * 60, long: true, open: true, out: local("2026-10-16", "14:00") });
    // Midnight still comes first when it is earlier than the longest shift.
    const evening = [P("a", "in", local("2026-10-15", "20:00"))];
    expect(shiftsOf(evening, AID, now, "America/Los_Angeles", 12 * 60)[0]).toMatchObject({ minutes: 4 * 60, long: true, out: local("2026-10-16", "00:00") });
    expect(weekMinutes(open, AID, "2026-10-12", new Date(local("2026-10-16", "15:00")), "America/Los_Angeles", 12 * 60)).toBe(720);
  });

  it("holds the week back until a long shift is confirmed or fixed, then sends it marked", () => {
    const ten = upsertAgreement(emptyWork("Ana"), { ...AGREEMENT, terms: { ...V2, workWeek: { ...defaultWorkWeek("America/Los_Angeles"), longestShiftHours: 10 } } });
    let w = punch(ten, AID, local("2026-10-13", "07:00"), "a").work;
    w = punch(w, AID, local("2026-10-13", "18:30"), "b").work; // 11h 30m
    w = punch(w, AID, local("2026-10-14", "09:00"), "c").work;
    w = punch(w, AID, local("2026-10-14", "12:00"), "d").work;
    const later = new Date(local("2026-10-17", "18:00"));
    expect(sendProblem(w, AID, "2026-10-12", later)).toMatch(/2026-10-13 is longer than 10h.*fix its clock-out time or confirm/);
    expect(() => buildTimesheet(w, AID, "2026-10-12", later)).toThrow(/longer than 10h/);
    // Fixing the clock-out clears it.
    const fixed = updatePunch(w, "b", { at: local("2026-10-13", "16:00") });
    expect(sendProblem(fixed, AID, "2026-10-12", later)).toBeNull();
    expect(buildTimesheet(fixed, AID, "2026-10-12", later).entries.map((e) => e.long)).toEqual([undefined, undefined]);
    // Confirming it sends it, marked.
    const confirmed = confirmShift(w, "b");
    expect(sendProblem(confirmed, AID, "2026-10-12", later)).toBeNull();
    const sheet = buildTimesheet(confirmed, AID, "2026-10-12", later);
    expect(sheet.entries).toEqual([
      { date: "2026-10-13", in: local("2026-10-13", "07:00"), out: local("2026-10-13", "18:30"), minutes: 690, long: true },
      { date: "2026-10-14", in: local("2026-10-14", "09:00"), out: local("2026-10-14", "12:00"), minutes: 180 },
    ]);
    expect(sheet.totalMinutes).toBe(870);
    // A confirmation doesn't survive the clock-out moving.
    expect(sendProblem(updatePunch(confirmed, "b", { at: local("2026-10-13", "19:00") }), AID, "2026-10-12", later)).toMatch(/confirm/);
    expect(sendProblem(updatePunch(confirmed, "a", { at: local("2026-10-13", "06:00") }), AID, "2026-10-12", later)).toMatch(/confirm/);
    // Still clocked in past the longest shift: set the time you left.
    const open = punch(ten, AID, local("2026-10-15", "06:00"), "e").work;
    expect(sendProblem(open, AID, "2026-10-12", later)).toMatch(/clocked in since 2026-10-15, longer than 10h.*Set the time you left/);
    expect(() => buildTimesheet(open, AID, "2026-10-12", later)).toThrow(/Set the time you left/);
    expect(sendProblem(open, AID, "2026-10-12", new Date(local("2026-10-15", "10:00")))).toBeNull(); // not yet
  });
});
