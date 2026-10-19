import { describe, expect, it } from "vitest";
import { type ReceivedHours, addHours, emptyMailbox, mailboxFromJson, mailboxToJson } from "./mailbox";
import { hoursText, markPaid, paidByRun, payRulesFor, unpaidHours } from "./timecard_pay";
import { labelOvertime, overtimeSplit } from "./hours";

const AGREEMENT = "ab".repeat(32);
const OTHER = "cd".repeat(32);
const LOOKUP = "ef".repeat(32);
const stretch = (date: string, from: string, to: string, minutes: number) => ({ date, in: `${date}T${from}:00.000Z`, out: `${date}T${to}:00.000Z`, minutes });
const MON = stretch("2026-10-19", "19:48", "19:52", 4);
const MON2 = stretch("2026-10-19", "19:53", "20:35", 41);
const WED = stretch("2026-10-21", "15:00", "23:00", 480);
const NEXT = stretch("2026-10-26", "15:00", "19:00", 240);

const card = (seq: number, entries: ReceivedHours["entries"], over: Partial<ReceivedHours> = {}): ReceivedHours => ({
  agreementId: AGREEMENT,
  seq,
  lookup: LOOKUP,
  receivedAt: "2026-10-22T09:00:00.000Z",
  workerId: "wkr-1",
  weekStart: "2026-10-18",
  entries,
  totalMinutes: entries.reduce((t, e) => t + e.minutes, 0),
  sentAt: "2026-10-22T08:00:00.000Z",
  ...over,
});

describe("hours from timecards into a pay run", () => {
  const m = addHours(addHours(addHours(emptyMailbox(), card(0, [MON, MON2, WED])), card(1, [NEXT], { weekStart: "2026-10-25" })), card(0, [WED], { agreementId: OTHER, workerId: "wkr-2" }));

  it("gathers the unpaid stretches of one team member inside the period, oldest first", () => {
    const u = unpaidHours(m, "wkr-1", "2026-10-06", "2026-10-20");
    expect(u.minutes).toBe(45);
    expect(u.shifts.map((s) => [s.date, s.minutes, s.seq])).toEqual([["2026-10-19", 4, 0], ["2026-10-19", 41, 0]]);
    expect(u.weeks).toEqual(["2026-10-18"]);
    const all = unpaidHours(m, "wkr-1", "2026-10-01", "2026-10-31");
    expect(all.minutes).toBe(765);
    expect(all.weeks).toEqual(["2026-10-18", "2026-10-25"]);
    expect(unpaidHours(m, "wkr-2", "2026-10-01", "2026-10-31").minutes).toBe(480);
    expect(unpaidHours(m, "wkr-9", "2026-10-01", "2026-10-31")).toEqual({ minutes: 0, regularMinutes: 0, overtimeMinutes: 0, overtimeRate: 1.5, shifts: [], weeks: [] });
    expect(unpaidHours(null, "wkr-1", "2026-10-01", "2026-10-31").minutes).toBe(0);
  });

  it("writes the pay run on what it paid, which then stays out of the next run and survives a save", () => {
    const u = unpaidHours(m, "wkr-1", "2026-10-06", "2026-10-20");
    const paid = markPaid(m, u.shifts, "run-7", "2026-10-20");
    expect(unpaidHours(paid, "wkr-1", "2026-10-06", "2026-10-20").minutes).toBe(0);
    expect(unpaidHours(paid, "wkr-1", "2026-10-01", "2026-10-31").shifts.map((s) => s.date)).toEqual(["2026-10-21", "2026-10-26"]);
    const week = paid.hours.find((h) => h.agreementId === AGREEMENT && h.seq === 0)!;
    expect(week.entries.map((e) => e.paid?.runId)).toEqual(["run-7", "run-7", undefined]);
    expect(week.totalMinutes).toBe(525);
    expect(paidByRun(paid, "run-7").get("wkr-1")?.map((s) => s.minutes)).toEqual([4, 41]);
    expect(paidByRun(paid, "run-8").size).toBe(0);
    expect(mailboxFromJson(mailboxToJson(paid)).hours.find((h) => h.seq === 0 && h.agreementId === AGREEMENT)?.entries[0]?.paid).toEqual({ runId: "run-7", payDate: "2026-10-20" });
    // Paying again changes nothing; an unknown stretch is ignored.
    expect(markPaid(paid, u.shifts, "run-8", "2026-10-27")).toEqual(paid);
    expect(markPaid(paid, [{ ...u.shifts[0]!, in: "2026-10-19T00:00:00.000Z" }], "run-8", "2026-10-27")).toEqual(paid);
    expect(() => markPaid(paid, [], "", "2026-10-27")).toThrow(/needs an id/);
  });

  it("keeps a paid stretch when the week is sent again over it", () => {
    const paid = markPaid(m, unpaidHours(m, "wkr-1", "2026-10-19", "2026-10-19").shifts, "run-7", "2026-10-20");
    // The week sent again, the paid Monday stretches with a moved clock-out, plus Thursday.
    const moved = { ...MON2, out: "2026-10-19T21:00:00.000Z", minutes: 67 };
    const thu = stretch("2026-10-22", "15:00", "19:00", 240);
    const again = addHours(paid, card(2, [MON, moved, WED, thu]));
    const week = again.hours.find((h) => h.agreementId === AGREEMENT && h.weekStart === "2026-10-18")!;
    expect(week.entries.map((e) => [e.in, e.minutes, e.paid?.runId])).toEqual([
      [MON.in, 4, "run-7"],
      [MON2.in, 41, "run-7"],
      [WED.in, 480, undefined],
      [thu.in, 240, undefined],
    ]);
    expect(unpaidHours(again, "wkr-1", "2026-10-18", "2026-10-24").minutes).toBe(720);
  });

  it("writes minutes as the hours box takes them", () => {
    expect(hoursText(45)).toBe("0.75");
    expect(hoursText(2400)).toBe("40");
    expect(hoursText(2250)).toBe("37.5");
    expect(hoursText(1)).toBe("0.02");
    expect(hoursText(0)).toBe("0");
  });
});

describe("overtime from timecards", () => {
  const rules = { timeZone: "UTC", overtimeAfterHours: 40, dailyOvertimeAfterHours: 0, overtimeRate: 1.5 };
  const day = (date: string, hours: number) => stretch(date, "08:00", `${String(8 + hours).padStart(2, "0")}:00`, hours * 60);
  // Sunday the 18th to Saturday the 24th: five 9-hour days, then 4 hours Saturday = 49 hours.
  const week = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"].map((d) => day(d, 9));
  const sat = day("2026-10-24", 4);
  const m = addHours(emptyMailbox(), card(0, [...week, sat]));

  it("lands the week's overtime on the last hours worked, and pays it at the agreement's rate", () => {
    const u = unpaidHours(m, "wkr-1", "2026-10-18", "2026-10-24", rules);
    expect(u).toMatchObject({ minutes: 2940, regularMinutes: 2400, overtimeMinutes: 540, overtimeRate: 1.5 });
    expect(u.shifts.map((s) => [s.date, s.regular, s.overtime])).toEqual([
      ["2026-10-19", 540, 0],
      ["2026-10-20", 540, 0],
      ["2026-10-21", 540, 0],
      ["2026-10-22", 540, 0],
      ["2026-10-23", 240, 300], // the 40th hour falls on Friday afternoon
      ["2026-10-24", 0, 240],
    ]);
    expect(hoursText(u.regularMinutes)).toBe("40");
    expect(hoursText(u.overtimeMinutes)).toBe("9");
  });

  it("counts a day's overtime first under a daily rule, never an hour twice", () => {
    const daily = { ...rules, dailyOvertimeAfterHours: 8, overtimeRate: 2 };
    const u = unpaidHours(m, "wkr-1", "2026-10-18", "2026-10-24", daily);
    // 1 hour a day over 8 (5 hours), then 40 regular reached on Saturday: 4 more.
    expect(u).toMatchObject({ regularMinutes: 2400, overtimeMinutes: 540, overtimeRate: 2 });
    expect(u.shifts.map((s) => s.overtime)).toEqual([60, 60, 60, 60, 60, 240]);
    const totals = overtimeSplit([...week, sat], daily);
    expect(totals).toEqual({ regular: u.regularMinutes, overtime: u.overtimeMinutes });
  });

  it("pays the right share when a pay period ends inside the week", () => {
    // Paid through Thursday: 36 regular. Then Friday and Saturday: 4 regular, 9 overtime.
    const first = unpaidHours(m, "wkr-1", "2026-10-18", "2026-10-22", rules);
    expect(first).toMatchObject({ regularMinutes: 2160, overtimeMinutes: 0 });
    const paid = markPaid(m, first.shifts, "run-1", "2026-10-23");
    const second = unpaidHours(paid, "wkr-1", "2026-10-23", "2026-10-31", rules);
    expect(second).toMatchObject({ regularMinutes: 240, overtimeMinutes: 540 });
  });

  it("labels stretches in time order whatever order they're given, and the labels add up to the split", () => {
    const shuffled = [sat, ...week].reverse();
    const labels = labelOvertime(shuffled, rules);
    expect(labels.reduce((t, l) => t + l.overtime, 0)).toBe(540);
    expect(labels[shuffled.indexOf(sat)]).toEqual({ regular: 0, overtime: 240 });
  });

  it("takes the rules from the offer's work week, or the baseline without one", () => {
    expect(payRulesFor(null, "wkr-1").overtimeRate).toBe(1.5);
    expect(payRulesFor(null, "wkr-1").overtimeAfterHours).toBe(40);
  });
});
