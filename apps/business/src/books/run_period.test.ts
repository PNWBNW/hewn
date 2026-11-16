// Run payroll's pay period before anyone changes it: from the day after the last run's period, to
// today. On those defaults a weekly business's next run shares no day with the run before it, so
// the overlap check in postPayRun has nothing to refuse or ask about.

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
import { defaultPeriod } from "./run_period";

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
    expect(checkDoublePay(week1.payroll, week2)).toEqual({ blocked: [], overlap: [] });
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
      expect(checkDoublePay(payroll, week2)).toEqual({ blocked: [], overlap: [] });
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
    expect(checkDoublePay(second.payroll, week3)).toEqual({ blocked: [], overlap: [] });
    expect(postPayRun(second.books, second.payroll, week3, clock).run.id).toBe("run-3");
  });
});
