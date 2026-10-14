// Local-time maths, so the tests pin a time zone with a real offset.
process.env.TZ = "America/Los_Angeles";

import { describe, expect, it } from "vitest";
import { addDays, buildTimesheet, formatMinutes, localDate, minutesByDay, shiftsOf, weekDays, weekMinutes, weekStartOf } from "./hours";
import { type Punch, emptyWork, punch, upsertAgreement } from "./work";

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
    expect(weekMinutes(punches, "ff", "2026-10-12", now)).toBe(13 * 60); // open since 11:00, closed at that midnight
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
