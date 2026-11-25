// Run payroll's pay period before anyone changes it: from the day after the last run's period, to
// today. On those defaults a weekly business's next run shares no day with the run before it, so
// the overlap check in postPayRun has nothing to refuse or ask about. Work dated before the period
// that no run has paid (a held shift, a late card, someone left out of the last run) is named on
// the person's row, so every unpaid day the two weeks to today held is in the period or named.

import { describe, expect, it } from "vitest";
import { type Books, applyTemplate, createBooks } from "@pnw/ledger";
import {
  type PayRunInput,
  type Payroll,
  addWorker,
  checkDoublePay,
  doublePayRefusal,
  emptyPayroll,
  ensureRailAccount,
  markPaycheckSettlement,
  postPayRun,
} from "@pnw/payroll";
import { type Mailbox, type ReceivedHours, addHours, emptyMailbox } from "./mailbox";
import { defaultPeriod, unpaidBeforePeriod, unpaidBeforeText } from "./run_period";
import type { ScheduleWeek } from "./schedule";
import { type Thread, addToThread, emptyThread, validateMessage } from "./thread";
import { markPaid, unpaidHours } from "./timecard_pay";
import { payRulesOf } from "./work_week";

const W4 = { filingStatus: "single" as const, dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const clock = { now: () => "2026-11-14T12:00:00.000Z" };
const ends = (...periodEnds: string[]) => periodEnds.map((periodEnd) => ({ periodEnd }));

describe("defaultPeriod", () => {
  it("starts a weekly business's next run the day after the last week it paid", () => {
    expect(defaultPeriod(ends("2026-11-07"), "2026-11-14")).toEqual({ periodStart: "2026-11-08", periodEnd: "2026-11-14" });
    // Run a day late or a day early, it still starts where the last one stopped and ends today.
    expect(defaultPeriod(ends("2026-11-07"), "2026-11-15")).toEqual({ periodStart: "2026-11-08", periodEnd: "2026-11-15" });
    expect(defaultPeriod(ends("2026-11-07"), "2026-11-13")).toEqual({ periodStart: "2026-11-08", periodEnd: "2026-11-13" });
    // The day after the last run ended is today: a one-day period.
    expect(defaultPeriod(ends("2026-11-13"), "2026-11-14")).toEqual({ periodStart: "2026-11-14", periodEnd: "2026-11-14" });
  });

  it("gives an every-two-weeks business the same two weeks as before when it runs on time", () => {
    expect(defaultPeriod(ends("2026-10-31"), "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
    // Two days early: the period still starts after the last one, so it is two days shorter.
    expect(defaultPeriod(ends("2026-10-31"), "2026-11-12")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-12" });
  });

  it("is the two weeks to today on a first run", () => {
    expect(defaultPeriod([], "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
    // Across a month and a year end.
    expect(defaultPeriod([], "2026-03-05")).toEqual({ periodStart: "2026-02-20", periodEnd: "2026-03-05" });
    expect(defaultPeriod([], "2027-01-06")).toEqual({ periodStart: "2026-12-24", periodEnd: "2027-01-06" });
  });

  it("is never longer than the two weeks to today, after a gap longer than that", () => {
    // Last paid six weeks ago: the default is as it was, not one paycheck for six weeks.
    expect(defaultPeriod(ends("2026-10-03"), "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
    // Exactly two weeks since: both rules give the same day.
    expect(defaultPeriod(ends("2026-10-31"), "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
    // One day more than that: still the two weeks to today.
    expect(defaultPeriod(ends("2026-10-30"), "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
  });

  it("is the two weeks to today when the last run's period ends today or later, and never starts after it ends", () => {
    expect(defaultPeriod(ends("2026-11-14"), "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
    expect(defaultPeriod(ends("2026-11-20"), "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
    expect(defaultPeriod(ends("2026-11-07", "2027-01-31"), "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
    // Every last end from six weeks back to a week ahead: a period that starts on or before it ends,
    // never more than two weeks long, and clear of the last run whenever one fits before today.
    for (let back = -7; back <= 42; back++) {
      const last = new Date(Date.UTC(2026, 10, 14 - back)).toISOString().slice(0, 10);
      const p = defaultPeriod(ends(last), "2026-11-14");
      expect(p.periodEnd, last).toBe("2026-11-14");
      expect(p.periodStart <= p.periodEnd, last).toBe(true);
      expect(p.periodStart >= "2026-11-01", last).toBe(true);
      if (last < "2026-11-14") expect(p.periodStart > last, last).toBe(true);
    }
  });

  it("follows the latest period any run covers, whatever order the runs were posted in", () => {
    // A catch-up for an earlier week posted after the latest week.
    expect(defaultPeriod(ends("2026-11-07", "2026-10-31"), "2026-11-14")).toEqual({ periodStart: "2026-11-08", periodEnd: "2026-11-14" });
    expect(defaultPeriod(ends("2026-10-24", "2026-11-07", "2026-10-31"), "2026-11-14")).toEqual({ periodStart: "2026-11-08", periodEnd: "2026-11-14" });
    // Runs from the two weeks to today, a week apart, overlap; the next one starts after the later.
    expect(defaultPeriod(ends("2026-11-07", "2026-11-14"), "2026-11-21")).toEqual({ periodStart: "2026-11-15", periodEnd: "2026-11-21" });
  });

  it("doesn't follow on from a run whose period end isn't a date, and refuses a today that isn't one", () => {
    // A run the books can't read the end of: the two weeks to today, as before, rather than a guess.
    expect(defaultPeriod(ends("2026-11-07", "2026-11-31"), "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
    expect(defaultPeriod(ends("2026-11-07", "soon"), "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
    expect(defaultPeriod(ends("2026-11-07", "2026-11-00"), "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
    expect(defaultPeriod(ends("2026-1-7"), "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
    expect(defaultPeriod([{ periodEnd: undefined as unknown as string }], "2026-11-14")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-14" });
    expect(() => defaultPeriod([], "2026-02-30")).toThrow(/No such date/);
    expect(() => defaultPeriod(ends("2026-11-07"), "11/14/2026")).toThrow(/Not a date/);
  });
});

describe("a weekly business's next run, on the page's defaults", () => {
  function setup() {
    const books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
    const bankId = books.accounts.find((a) => a.name === "Checking")!.id;
    let payroll: Payroll = emptyPayroll();
    const ana = addWorker(payroll, { name: "Ana", payType: "salary", rate: 5_200_000n, frequency: "weekly", w4: W4 });
    payroll = ana.payroll;
    const ben = addWorker(payroll, { name: "Ben", payType: "hourly", rate: 2550n, frequency: "weekly", w4: W4 });
    payroll = ben.payroll;
    const lines = [{ workerId: ana.worker.id }, { workerId: ben.worker.id, hours: 40 }];
    return { books, payroll, bankId, lines };
  }

  /** The run Run payroll posts when nobody changes its dates: paid on the day, for its default period. */
  const onDefaults = (payroll: Payroll, today: string, rest: Omit<PayRunInput, "payDate" | "periodStart" | "periodEnd">): PayRunInput => ({
    payDate: today,
    ...defaultPeriod(payroll.runs, today),
    ...rest,
  });

  it("posts the next week at the same amounts with nothing refused or asked, paid outside the app", () => {
    const s = setup();
    const week1 = postPayRun(s.books, s.payroll, onDefaults(s.payroll, "2026-11-07", { bankAccountId: s.bankId, lines: s.lines }), clock);
    expect([week1.run.periodStart, week1.run.periodEnd]).toEqual(["2026-10-25", "2026-11-07"]);
    const week2 = onDefaults(week1.payroll, "2026-11-14", { bankAccountId: s.bankId, lines: s.lines });
    expect([week2.periodStart, week2.periodEnd]).toEqual(["2026-11-08", "2026-11-14"]);
    expect(checkDoublePay(week1.payroll, week2)).toEqual({ blocked: [], overlap: [], failed: [] });
    expect(postPayRun(week1.books, week1.payroll, week2, clock).run.id).toBe("run-2");
    // The two weeks to today, the old default, reached back into the week already paid and was refused.
    const twoWeeks = { ...week2, periodStart: "2026-11-01" };
    expect(doublePayRefusal(week1.payroll, twoWeeks)).toMatch(/^Already paid the same amount for 2026-10-25 to 2026-11-07: Ana, Ben\./);
    expect(() => postPayRun(week1.books, week1.payroll, twoWeeks, clock)).toThrow(/Already paid the same amount/);
  });

  it("does the same on the rail, whether the last run's payments are on their way, landed or failed", () => {
    const s = setup();
    const rail = ensureRailAccount(s.books);
    const input = (payroll: Payroll, today: string) => onDefaults(payroll, today, { bankAccountId: rail.accountId, mode: "rail", lines: s.lines });
    const week1 = postPayRun(rail.books, s.payroll, input(s.payroll, "2026-11-07"), clock);
    const [ana, ben] = week1.run.paychecks.map((p) => p.workerId) as [string, string];
    const settled = markPaycheckSettlement(week1.payroll, week1.run.id, ana, { status: "settled", settledAt: clock.now() });
    const failed = markPaycheckSettlement(settled, week1.run.id, ben, { status: "failed", failure: "Shield turned the transfer down" });
    // Pending (as posted), one landed and one failed: the failed paycheck's days stay its own, so the next run starts after them too.
    for (const payroll of [week1.payroll, failed]) {
      const week2 = input(payroll, "2026-11-14");
      expect([week2.periodStart, week2.periodEnd]).toEqual(["2026-11-08", "2026-11-14"]);
      expect(checkDoublePay(payroll, week2)).toEqual({ blocked: [], overlap: [], failed: [] });
      expect(postPayRun(week1.books, payroll, week2, clock).run.id).toBe("run-2");
    }
  });

  it("follows on from runs posted the old way, two weeks to the day a week apart", () => {
    const s = setup();
    const old = (payroll: Payroll, books: Books, payDate: string, periodStart: string) =>
      postPayRun(books, payroll, { payDate, periodStart, periodEnd: payDate, bankAccountId: s.bankId, lines: s.lines, confirmedOverlaps: s.lines.map((l) => l.workerId) }, clock);
    const first = old(s.payroll, s.books, "2026-11-07", "2026-10-25");
    // The second one at other hours, asked about and posted anyway, as a business could before.
    const second = postPayRun(
      first.books,
      first.payroll,
      { payDate: "2026-11-14", periodStart: "2026-11-01", periodEnd: "2026-11-14", bankAccountId: s.bankId, lines: [{ workerId: s.lines[1]!.workerId, hours: 38 }], confirmedOverlaps: [s.lines[1]!.workerId] },
      clock,
    );
    const week3 = onDefaults(second.payroll, "2026-11-21", { bankAccountId: s.bankId, lines: s.lines });
    expect([week3.periodStart, week3.periodEnd]).toEqual(["2026-11-15", "2026-11-21"]);
    expect(checkDoublePay(second.payroll, week3)).toEqual({ blocked: [], overlap: [], failed: [] });
    expect(postPayRun(second.books, second.payroll, week3, clock).run.id).toBe("run-3");
  });
});

describe("work before the period that no paycheck has paid", () => {
  const A = "aa".repeat(32);
  const B = "bb".repeat(32);
  const shift = (date: string, minutes = 480) => ({ date, in: `${date}T15:00:00.000Z`, out: new Date(Date.parse(`${date}T15:00:00.000Z`) + minutes * 60_000).toISOString(), minutes });
  const card = (workerId: string, agreementId: string, seq: number, weekStart: string, dates: string[]): ReceivedHours => {
    const entries = dates.map((d) => shift(d));
    return { agreementId, seq, lookup: "ef".repeat(32), receivedAt: "2026-11-20T09:00:00.000Z", workerId, weekStart, entries, totalMinutes: entries.length * 480, sentAt: "2026-11-20T08:00:00.000Z" };
  };
  const rules = payRulesOf(undefined);
  function team() {
    const books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
    const bankId = books.accounts.find((a) => a.name === "Checking")!.id;
    const ana = addWorker(emptyPayroll(), { name: "Ana", payType: "hourly", rate: 2550n, frequency: "weekly", w4: W4 });
    const ben = addWorker(ana.payroll, { name: "Ben", payType: "hourly", rate: 2550n, frequency: "weekly", w4: W4 });
    return { books, bankId, payroll: ben.payroll, ana: ana.worker.id, ben: ben.worker.id };
  }
  const hourly = (mailbox: Mailbox, workerId: string, period: { periodStart: string; periodEnd: string }) =>
    unpaidBeforePeriod({ mailbox, workerId, hourly: true, rules, ...period });

  it("names a shift held on the last run, which the next run's period starts after", () => {
    const t = team();
    let mailbox = addHours(emptyMailbox(), card(t.ana, A, 1, "2026-11-08", ["2026-11-09", "2026-11-10", "2026-11-12"]));
    const r1 = postPayRun(t.books, t.payroll, { payDate: "2026-11-07", periodStart: "2026-11-01", periodEnd: "2026-11-07", bankAccountId: t.bankId, lines: [{ workerId: t.ana, hours: 40 }] }, clock);
    // The run of Nov 14 on the defaults: Nov 12 has a question about its hours open, so it waits.
    const p2 = defaultPeriod(r1.payroll.runs, "2026-11-14");
    const nov12 = mailbox.hours[0]!.entries[2]!;
    const paid = unpaidHours(mailbox, t.ana, p2.periodStart, p2.periodEnd, rules, [{ in: nov12.in, out: nov12.out }]);
    expect(paid.shifts.map((s) => s.date)).toEqual(["2026-11-09", "2026-11-10"]);
    const r2 = postPayRun(r1.books, r1.payroll, { payDate: "2026-11-14", ...p2, bankAccountId: t.bankId, lines: [{ workerId: t.ana, hours: 16 }] }, clock);
    mailbox = markPaid(mailbox, paid.shifts, r2.run.id, "2026-11-14");
    // The next week's defaults start after the run of Nov 14, so the held shift is outside them, and named.
    const p3 = defaultPeriod(r2.payroll.runs, "2026-11-21");
    expect(p3).toEqual({ periodStart: "2026-11-15", periodEnd: "2026-11-21" });
    expect(unpaidHours(mailbox, t.ana, p3.periodStart, p3.periodEnd, rules).minutes).toBe(0);
    expect(hourly(mailbox, t.ana, p3)).toEqual({ from: "2026-11-12", minutes: 480, onCallDays: 0 });
    // Moving Period starts back to that day reaches it.
    expect(unpaidHours(mailbox, t.ana, "2026-11-12", p3.periodEnd, rules).shifts.map((s) => s.date)).toEqual(["2026-11-12"]);
    expect(hourly(mailbox, t.ana, { ...p3, periodStart: "2026-11-12" })).toBeNull();
  });

  it("names the days of someone left out of the last run, and nothing for those it paid", () => {
    const t = team();
    const r1 = postPayRun(t.books, t.payroll, { payDate: "2026-11-07", periodStart: "2026-11-01", periodEnd: "2026-11-07", bankAccountId: t.bankId, lines: [{ workerId: t.ana, hours: 40 }, { workerId: t.ben, hours: 40 }] }, clock);
    // The run of Nov 14 paid Ben alone (Ana's card came in late).
    const r2 = postPayRun(r1.books, r1.payroll, { payDate: "2026-11-14", periodStart: "2026-11-08", periodEnd: "2026-11-14", bankAccountId: t.bankId, lines: [{ workerId: t.ben, hours: 8 }] }, clock);
    let mailbox = addHours(emptyMailbox(), card(t.ana, A, 1, "2026-11-08", ["2026-11-09", "2026-11-10", "2026-11-11"]));
    mailbox = addHours(mailbox, card(t.ana, A, 2, "2026-11-15", ["2026-11-16", "2026-11-17"]));
    mailbox = addHours(mailbox, card(t.ben, B, 1, "2026-11-08", ["2026-11-09"]));
    mailbox = markPaid(mailbox, unpaidHours(mailbox, t.ben, "2026-11-08", "2026-11-14", rules).shifts, r2.run.id, "2026-11-14");
    const p = defaultPeriod(r2.payroll.runs, "2026-11-21");
    expect(p).toEqual({ periodStart: "2026-11-15", periodEnd: "2026-11-21" });
    expect(unpaidHours(mailbox, t.ana, p.periodStart, p.periodEnd, rules).minutes).toBe(960);
    expect(hourly(mailbox, t.ana, p)).toEqual({ from: "2026-11-09", minutes: 1440, onCallDays: 0 });
    expect(hourly(mailbox, t.ben, p)).toBeNull();
  });

  it("names every unpaid stretch the two weeks to the period's end held that the period doesn't, wherever the period starts", () => {
    const t = team();
    // Unpaid shifts every day from Nov 2 to Nov 21; the old default on Nov 21 was Nov 8 to Nov 21.
    let mailbox = emptyMailbox();
    for (const [i, weekStart] of ["2026-11-01", "2026-11-08", "2026-11-15"].entries()) {
      const days = Array.from({ length: 7 }, (_, d) => new Date(Date.UTC(2026, 10, 1 + i * 7 + d)).toISOString().slice(0, 10)).filter((d) => d >= "2026-11-02");
      mailbox = addHours(mailbox, card(t.ana, A, i + 1, weekStart, days));
    }
    const oldWindow = unpaidHours(mailbox, t.ana, "2026-11-08", "2026-11-21", rules).minutes;
    expect(oldWindow).toBe(14 * 480);
    for (let day = 8; day <= 21; day++) {
      const periodStart = `2026-11-${String(day).padStart(2, "0")}`;
      const inPeriod = unpaidHours(mailbox, t.ana, periodStart, "2026-11-21", rules).minutes;
      const before = hourly(mailbox, t.ana, { periodStart, periodEnd: "2026-11-21" });
      expect((before?.minutes ?? 0) + inPeriod, periodStart).toBe(oldWindow);
      // Nothing from before the two weeks to the period's end: Nov 2 to Nov 7 aren't named.
      if (before) expect(before.from, periodStart).toBe("2026-11-08");
    }
  });

  it("names confirmed on-call days before the period that no run has paid, for anyone paid for them", () => {
    const week: ScheduleWeek = {
      weekStart: "2026-11-08",
      days: [
        { date: "2026-11-10", shifts: [], onCall: true },
        { date: "2026-11-11", shifts: [], onCall: true },
      ],
    };
    const id = (n: number) => n.toString(16).padStart(32, "0");
    const msg = (n: number, from: "business" | "worker", body: unknown, mine: boolean) => ({
      ...validateMessage({ version: 1, id: id(n), from, sentAt: `2026-11-0${n}T10:00:00.000Z`, body }, from),
      mine,
      seq: n,
    });
    let thread: Thread = addToThread(emptyThread(), msg(1, "business", { type: "schedule", week, note: "" }, true));
    thread = addToThread(thread, msg(2, "worker", { type: "schedule_answer", scheduleId: id(1), weekStart: week.weekStart, answer: "confirmed", note: "" }, false));
    const period = { periodStart: "2026-11-15", periodEnd: "2026-11-21" };
    // Salaried: their timecards aren't what they're paid for, but their on-call days are.
    const salaried = (paid?: Record<string, Record<string, string>>) =>
      unpaidBeforePeriod({ mailbox: emptyMailbox(), workerId: "w1", hourly: false, rules, onCall: { src: thread, paid }, ...period });
    expect(salaried()).toEqual({ from: "2026-11-10", minutes: 0, onCallDays: 2 });
    expect(salaried({ w1: { "2026-11-10": "run-2" } })).toEqual({ from: "2026-11-11", minutes: 0, onCallDays: 1 });
    expect(salaried({ w1: { "2026-11-10": "run-2", "2026-11-11": "run-2" } })).toBeNull();
    // Without on-call pay in their terms, the page passes no on-call, and nothing is named.
    expect(unpaidBeforePeriod({ mailbox: emptyMailbox(), workerId: "w1", hourly: false, rules, ...period })).toBeNull();
  });

  it("says what is unpaid and the day to move Period starts back to", () => {
    const day = (d: string) => `<${d}>`;
    expect(unpaidBeforeText({ from: "2026-11-12", minutes: 480, onCallDays: 0 }, day)).toBe(
      "Before this period and not paid yet: 8h 00m on their timecards, from <2026-11-12>. To pay for that work in this run, move Period starts back to <2026-11-12>.",
    );
    expect(unpaidBeforeText({ from: "2026-11-10", minutes: 0, onCallDays: 1 }, day)).toBe(
      "Before this period and not paid yet: 1 on-call day, from <2026-11-10>. To pay for that work in this run, move Period starts back to <2026-11-10>.",
    );
    expect(unpaidBeforeText({ from: "2026-11-09", minutes: 1470, onCallDays: 2 }, day)).toBe(
      "Before this period and not paid yet: 24h 30m on their timecards and 2 on-call days, from <2026-11-09>. To pay for that work in this run, move Period starts back to <2026-11-09>.",
    );
  });

  it("names nothing when there is no gap to fill, or the period can't be read yet", () => {
    const t = team();
    const mailbox = addHours(emptyMailbox(), card(t.ana, A, 1, "2026-11-08", ["2026-11-09", "2026-11-12"]));
    // A salaried person's timecards are never named.
    expect(unpaidBeforePeriod({ mailbox, workerId: t.ana, hourly: false, rules, periodStart: "2026-11-15", periodEnd: "2026-11-21" })).toBeNull();
    // The period already reaches two weeks back from its end, or further.
    expect(hourly(mailbox, t.ana, { periodStart: "2026-11-08", periodEnd: "2026-11-21" })).toBeNull();
    expect(hourly(mailbox, t.ana, { periodStart: "2026-11-01", periodEnd: "2026-11-21" })).toBeNull();
    // Dates half typed, or a start after the end: nothing to say yet, and nothing thrown.
    for (const [periodStart, periodEnd] of [["", "2026-11-21"], ["2026-11-15", ""], ["2026-11-1", "2026-11-21"], ["2026-11-31", "2026-12-07"], ["2026-11-22", "2026-11-21"]] as const) {
      expect(hourly(mailbox, t.ana, { periodStart, periodEnd }), `${periodStart}..${periodEnd}`).toBeNull();
    }
  });
});
