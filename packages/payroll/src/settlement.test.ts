// The pieces the pay queue leans on: the fee on a settlement, the in-flight
// reference, the double-pay check, the rail account, and year-to-date across
// two runs posted the same day.
import { describe, expect, it } from "vitest";
import { type Books, addAccount, applyTemplate, createBooks } from "@pnw/ledger";
import {
  type Payroll,
  type W4,
  RAIL_ACCOUNT_NAME,
  findRailAccount,
  addWorker,
  checkDoublePay,
  doublePayRefusal,
  emptyPayroll,
  ensureRailAccount,
  markPaycheckSettlement,
  paidPeriods,
  postPayRun,
  withheld,
  yearToDate,
} from "./payroll";
import { PayrollError } from "./errors";
import { paystubDocument, paystubHash } from "./paystub";
import { payrollFromJson, payrollToJson } from "./serialize";

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const clock = { now: () => "2026-10-16T12:00:00.000Z" };

function setup() {
  const books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
  const bankId = books.accounts.find((a) => a.name === "Checking")!.id;
  let payroll: Payroll = emptyPayroll();
  const ana = addWorker(payroll, { name: "Ana", payType: "salary", rate: 5_200_000n, frequency: "biweekly", w4: W4_SINGLE });
  payroll = ana.payroll;
  const ben = addWorker(payroll, { name: "Ben", payType: "hourly", rate: 2550n, frequency: "biweekly", w4: W4_SINGLE });
  payroll = ben.payroll;
  const input = {
    payDate: "2026-10-16",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-14",
    bankAccountId: bankId,
    lines: [{ workerId: ana.worker.id }, { workerId: ben.worker.id, hours: 80 }],
  };
  return { books, payroll, bankId, ana: ana.worker, ben: ben.worker, input };
}

describe("settlement fee and in-flight reference", () => {
  it("keeps the network fee on a settled paycheck and round-trips it as a string", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail" }, clock);
    const payroll = markPaycheckSettlement(r.payroll, r.run.id, s.ana.id, {
      status: "settled",
      reference: "at1transfer",
      height: 4_210_000,
      settledAt: clock.now(),
      feeMicrocredits: 51_580n,
    });
    const json = payrollToJson(payroll);
    expect(json).toContain('"feeMicrocredits":"51580"');
    expect(json).not.toContain('"feeMicrocredits":{');
    const back = payrollFromJson(json);
    expect(back).toEqual(payroll);
    expect(back.runs[0]!.paychecks[0]!.settlement.feeMicrocredits).toBe(51_580n);
    expect(() => markPaycheckSettlement(r.payroll, r.run.id, s.ana.id, { status: "settled", feeMicrocredits: -1n })).toThrow(/can't be negative/);
    expect(() => markPaycheckSettlement(r.payroll, r.run.id, s.ana.id, { status: "settled", feeMicrocredits: 5 as unknown as bigint })).toThrow(/can't be negative/);
  });

  it("a pending paycheck can note the id of its sent transfer, and nothing else", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail" }, clock);
    const sent = markPaycheckSettlement(r.payroll, r.run.id, s.ana.id, { status: "pending", reference: "shield_1" });
    expect(sent.runs[0]!.paychecks[0]!.settlement).toEqual({ status: "pending", reference: "shield_1" });
    expect(() => markPaycheckSettlement(r.payroll, r.run.id, s.ana.id, { status: "pending" })).toThrow(/can't become pending/);
    // Then settles like any other.
    const done = markPaycheckSettlement(sent, r.run.id, s.ana.id, { status: "settled", reference: "at1x", settledAt: clock.now() });
    expect(done.runs[0]!.paychecks[0]!.settlement.status).toBe("settled");
    expect(() => markPaycheckSettlement(done, r.run.id, s.ana.id, { status: "pending", reference: "again" })).toThrow(/settled paycheck can't/);
  });

  it("a pending paycheck notes the record a transfer is about to spend, and why an outcome isn't known", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail" }, clock);
    const tag = "ab".repeat(16);
    const trying = markPaycheckSettlement(r.payroll, r.run.id, s.ana.id, { status: "pending", attempt: tag });
    expect(trying.runs[0]!.paychecks[0]!.settlement).toEqual({ status: "pending", attempt: tag });
    const unknown = markPaycheckSettlement(trying, r.run.id, s.ana.id, { status: "pending", attempt: tag, failure: "Check Shield's activity before paying again" });
    expect(unknown.runs[0]!.paychecks[0]!.settlement.failure).toMatch(/Check Shield/);
    expect(payrollFromJson(payrollToJson(unknown))).toEqual(unknown);
    expect(() => markPaycheckSettlement(r.payroll, r.run.id, s.ana.id, { status: "pending", attempt: "nope" })).toThrow(/32 hex/);
  });

  it("a pending paycheck keeps the height it was first asked at and when its last try ended, and they survive the vault", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail" }, clock);
    const tag = "ab".repeat(16);
    const trying = markPaycheckSettlement(r.payroll, r.run.id, s.ana.id, { status: "pending", attempt: tag, since: 4_210_000 });
    const unknown = markPaycheckSettlement(trying, r.run.id, s.ana.id, { status: "pending", attempt: tag, since: 4_210_000, failure: "Check Shield's activity before paying again", endedAt: "2026-11-14T12:00:00.000Z" });
    expect(unknown.runs[0]!.paychecks[0]!.settlement).toEqual({ status: "pending", attempt: tag, since: 4_210_000, failure: "Check Shield's activity before paying again", endedAt: "2026-11-14T12:00:00.000Z" });
    expect(payrollFromJson(payrollToJson(unknown))).toEqual(unknown);
    expect(() => markPaycheckSettlement(r.payroll, r.run.id, s.ana.id, { status: "pending", attempt: tag, since: -1 })).toThrow(/whole number/);
    expect(() => markPaycheckSettlement(r.payroll, r.run.id, s.ana.id, { status: "pending", attempt: tag, since: 1.5 })).toThrow(/whole number/);
    expect(() => markPaycheckSettlement(r.payroll, r.run.id, s.ana.id, { status: "pending", attempt: tag, endedAt: "soon" })).toThrow(/must be a time/);
  });
});

describe("checkDoublePay", () => {
  const CLEAN = { blocked: [], overlap: [], failed: [] };
  /** The period after the fixture's, paid two weeks later. */
  const next = { payDate: "2026-10-30", periodStart: "2026-10-15", periodEnd: "2026-10-28" };

  it("is clean when nobody has been paid that day or for any of that period", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, { ...s.input, payDate: "2026-10-02", periodStart: "2026-09-17", periodEnd: "2026-09-30" }, clock);
    expect(checkDoublePay(r.payroll, s.input)).toEqual(CLEAN);
    expect(checkDoublePay(s.payroll, s.input)).toEqual(CLEAN);
  });

  it("blocks an exact repeat (same person, date, gross) that is settled or pending", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, s.input, clock);
    expect(checkDoublePay(r.payroll, s.input)).toEqual({
      blocked: [
        { workerId: s.ana.id, runId: "run-1", by: "period" },
        { workerId: s.ben.id, runId: "run-1", by: "period" },
      ],
      overlap: [],
      failed: [],
    });
    const pending = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail" }, clock);
    expect(checkDoublePay(pending.payroll, s.input).blocked).toHaveLength(2);
  });

  it("blocks the same person, period and gross whatever the pay date", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, s.input, clock);
    for (const payDate of ["2026-10-17", "2026-10-15", "2027-01-04"]) {
      expect(checkDoublePay(r.payroll, { ...s.input, payDate }).blocked, payDate).toEqual([
        { workerId: s.ana.id, runId: "run-1", by: "period" },
        { workerId: s.ben.id, runId: "run-1", by: "period" },
      ]);
    }
  });

  it("counts a period that overlaps by a day at either end, and not the one that follows or comes before", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, s.input, clock); // 2026-10-01 to 2026-10-14
    const ana = { lines: [{ workerId: s.ana.id }] };
    const at = (periodStart: string, periodEnd: string) => checkDoublePay(r.payroll, { ...s.input, ...ana, payDate: "2026-10-30", periodStart, periodEnd });
    const hit = { blocked: [{ workerId: s.ana.id, runId: "run-1", by: "period" }], overlap: [], failed: [] };
    expect(at("2026-10-10", "2026-10-23")).toEqual(hit); // half of it
    expect(at("2026-10-14", "2026-10-27")).toEqual(hit); // its last day
    expect(at("2026-09-17", "2026-10-01")).toEqual(hit); // its first day
    expect(at("2026-10-05", "2026-10-06")).toEqual(hit); // inside it
    expect(at("2026-09-01", "2026-12-31")).toEqual(hit); // around it
    expect(at("2026-10-15", "2026-10-28")).toEqual(CLEAN); // the next period
    expect(at("2026-09-17", "2026-09-30")).toEqual(CLEAN); // the one before
  });

  it("still blocks the same pay date and gross for another period, and says it is by the date", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, s.input, clock);
    expect(checkDoublePay(r.payroll, { ...s.input, periodStart: "2026-10-15", periodEnd: "2026-10-28", lines: [{ workerId: s.ana.id }] })).toEqual({
      blocked: [{ workerId: s.ana.id, runId: "run-1", by: "date" }],
      overlap: [],
      failed: [],
    });
  });

  it("asks when the amount differs or hours are missing", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, s.input, clock);
    // Ben with different hours: different gross → a question, not a block. Ana unchanged → blocked.
    expect(checkDoublePay(r.payroll, { ...s.input, lines: [{ workerId: s.ana.id }, { workerId: s.ben.id, hours: 10 }] })).toEqual({
      blocked: [{ workerId: s.ana.id, runId: "run-1", by: "period" }],
      overlap: [{ workerId: s.ben.id, runId: "run-1", by: "period" }],
      failed: [],
    });
    // The same question a day later, and for a period that only shares some days.
    expect(checkDoublePay(r.payroll, { ...s.input, payDate: "2026-10-17", lines: [{ workerId: s.ben.id, hours: 10 }] }).overlap).toHaveLength(1);
    expect(checkDoublePay(r.payroll, { ...s.input, payDate: "2026-10-30", periodStart: "2026-10-10", periodEnd: "2026-10-23", lines: [{ workerId: s.ben.id, hours: 10 }] }).overlap).toHaveLength(1);
    // Hours not entered yet: nothing to compare, so a question only.
    expect(checkDoublePay(r.payroll, { ...s.input, lines: [{ workerId: s.ben.id }] })).toEqual({ blocked: [], overlap: [{ workerId: s.ben.id, runId: "run-1", by: "period" }], failed: [] });
    // Unknown people are skipped here (previewPayRun refuses them).
    expect(checkDoublePay(r.payroll, { ...s.input, lines: [{ workerId: "wkr-99" }] })).toEqual(CLEAN);
  });

  it("leaves the next period alone", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, s.input, clock);
    expect(checkDoublePay(r.payroll, { ...s.input, ...next })).toEqual(CLEAN);
    expect(postPayRun(r.books, r.payroll, { ...s.input, ...next }, clock).run.id).toBe("run-2");
  });
});

describe("posting a run someone was already paid in", () => {
  it("postPayRun refuses the same worker and period paid a day later", () => {
    const s = setup();
    const first = postPayRun(s.books, s.payroll, s.input, clock);
    const later = { ...s.input, payDate: "2026-10-17" };
    expect(() => postPayRun(first.books, first.payroll, later, clock)).toThrow(PayrollError);
    expect(() => postPayRun(first.books, first.payroll, later, clock)).toThrow("Already paid the same amount for 2026-10-01 to 2026-10-14: Ana, Ben. Check this run's pay period (2026-10-01 to 2026-10-14), or change the amount to pay again.");
    // Saying it was confirmed doesn't let an exact repeat through.
    expect(() => postPayRun(first.books, first.payroll, { ...later, confirmedOverlaps: [s.ana.id, s.ben.id] }, clock)).toThrow(/Already paid the same amount for 2026-10-01 to 2026-10-14/);
    expect(first.payroll.runs).toHaveLength(1); // pure: nothing was added
    // Nor does a period that only shares some of its days, or a rail run still on its way.
    expect(() => postPayRun(first.books, first.payroll, { ...s.input, payDate: "2026-10-30", periodStart: "2026-10-10", periodEnd: "2026-10-23" }, clock)).toThrow(/Already paid the same amount for 2026-10-01 to 2026-10-14: Ana, Ben\. Check this run's pay period \(2026-10-10 to 2026-10-23\)/);
    const rail = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail" }, clock);
    expect(() => postPayRun(rail.books, rail.payroll, { ...later, mode: "rail" }, clock)).toThrow(/Already paid the same amount for/);
  });

  // A run's period is entered by hand and starts as the two weeks to today, so a weekly run, or a
  // semimonthly one in February, reaches back into the days the last run paid unless it is changed.
  it("names the period already paid and says to check this run's, when the period reaches back into the last run", () => {
    const s = setup();
    const daysBefore = (date: string, n: number) => new Date(Date.parse(date) - n * 86_400_000).toISOString().slice(0, 10);
    const run = (payDate: string, periodStart = daysBefore(payDate, 13)) => ({ payDate, periodStart, periodEnd: payDate, bankAccountId: s.bankId, lines: [{ workerId: s.ana.id }] });
    // Weekly, on salary: the same gross every time.
    const week1 = postPayRun(s.books, s.payroll, run("2026-11-06"), clock);
    expect(() => postPayRun(week1.books, week1.payroll, run("2026-11-13"), clock)).toThrow(
      "Already paid the same amount for 2026-10-24 to 2026-11-06: Ana. Check this run's pay period (2026-10-31 to 2026-11-13), or change the amount to pay again.",
    );
    // With the period starting the day after the last one ended, the same run posts and nothing is asked.
    const week2 = run("2026-11-13", "2026-11-07");
    expect(checkDoublePay(week1.payroll, week2)).toEqual({ blocked: [], overlap: [], failed: [] });
    expect(postPayRun(week1.books, week1.payroll, week2, clock).run.id).toBe("run-2");
    // Semimonthly, the 15th and the last day of February: 13 days apart.
    const half1 = postPayRun(s.books, s.payroll, run("2027-02-15"), clock);
    expect(() => postPayRun(half1.books, half1.payroll, run("2027-02-28"), clock)).toThrow(/Already paid the same amount for 2027-02-02 to 2027-02-15: Ana\. Check this run's pay period \(2027-02-15 to 2027-02-28\)/);
    expect(postPayRun(half1.books, half1.payroll, run("2027-02-28", "2027-02-16"), clock).run.id).toBe("run-2");
  });

  it("lists each earlier period once, oldest first, when a run reaches back into more than one", () => {
    const s = setup();
    const only = (workerId: string, hours?: number) => [{ workerId, ...(hours === undefined ? {} : { hours }) }];
    const first = postPayRun(s.books, s.payroll, { ...s.input, lines: only(s.ana.id) }, clock);
    const second = postPayRun(first.books, first.payroll, { ...s.input, payDate: "2026-10-30", periodStart: "2026-10-15", periodEnd: "2026-10-28", lines: only(s.ben.id, 80) }, clock);
    const wide = { ...s.input, payDate: "2026-11-02", periodStart: "2026-10-01", periodEnd: "2026-10-28" };
    const check = checkDoublePay(second.payroll, wide);
    expect(paidPeriods(second.payroll, check.blocked)).toEqual(["2026-10-01 to 2026-10-14", "2026-10-15 to 2026-10-28"]);
    expect(paidPeriods(second.payroll, [...check.blocked].reverse())).toEqual(["2026-10-01 to 2026-10-14", "2026-10-15 to 2026-10-28"]);
    expect(paidPeriods(second.payroll, [])).toEqual([]);
    expect(doublePayRefusal(second.payroll, wide)).toBe(
      "Already paid the same amount for 2026-10-01 to 2026-10-14 and 2026-10-15 to 2026-10-28: Ana, Ben. Check this run's pay period (2026-10-01 to 2026-10-28), or change the amount to pay again.",
    );
    // The question for another amount carries the earlier period the same way.
    const hours = checkDoublePay(second.payroll, { ...wide, lines: only(s.ben.id, 10) });
    expect(hours.blocked).toEqual([]);
    expect(paidPeriods(second.payroll, hours.overlap)).toEqual(["2026-10-15 to 2026-10-28"]);
  });

  it("refuses the same pay date and amount for another period, as the check did before posting", () => {
    const s = setup();
    const first = postPayRun(s.books, s.payroll, s.input, clock);
    const other = { ...s.input, periodStart: "2026-10-15", periodEnd: "2026-10-28", lines: [{ workerId: s.ana.id }] };
    expect(() => postPayRun(first.books, first.payroll, other, clock)).toThrow("Already paid on 2026-10-16 for the same amount: Ana. Change the amount or the pay date to pay again.");
    expect(postPayRun(first.books, first.payroll, { ...other, payDate: "2026-10-30" }, clock).run.id).toBe("run-2");
  });

  it("posts another amount for an overlapping period only when that person was confirmed", () => {
    const s = setup();
    const first = postPayRun(s.books, s.payroll, s.input, clock);
    const more = { ...s.input, payDate: "2026-10-17", lines: [{ workerId: s.ben.id, hours: 10 }] };
    expect(() => postPayRun(first.books, first.payroll, more, clock)).toThrow(PayrollError);
    expect(() => postPayRun(first.books, first.payroll, more, clock)).toThrow("Ben has another paycheck for this pay date or pay period. Confirm it before posting this one.");
    expect(() => postPayRun(first.books, first.payroll, { ...more, confirmedOverlaps: [s.ana.id] }, clock)).toThrow(/Ben has another paycheck/);
    expect(() => postPayRun(first.books, first.payroll, { ...more, confirmedOverlaps: "wkr-2" as unknown as string[] }, clock)).toThrow(/confirmed/);
    const second = postPayRun(first.books, first.payroll, { ...more, confirmedOverlaps: [s.ben.id] }, clock);
    expect(second.run.id).toBe("run-2");
    expect(second.run).not.toHaveProperty("confirmedOverlaps");
    expect(payrollFromJson(payrollToJson(second.payroll))).toEqual(second.payroll);
  });
});

// A rail paycheck whose payment failed keeps the record it set aside, and its own Retry spends that
// same record, so only one of the two can ever go out. A new paycheck for any of its days would be
// paid from another record, so none is posted while the failed one can still be paid, whatever the
// amount and whatever was confirmed.
describe("a failed paycheck is paid only by its own Retry", () => {
  const CLEAN = { blocked: [], overlap: [], failed: [] };
  const RETRY_ANA =
    "Ana's paycheck for 2026-10-01 to 2026-10-14 (run of 2026-10-16) failed. Retry it from that run in Pay runs: a new paycheck for those days isn't posted while that one can still be paid.";
  const tag = "ab".repeat(16);
  /** The last sentence of each refusal: this run's own period may be the thing to change. */
  const thisPeriod = (start: string, end: string) => ` If this run's pay period (${start} to ${end}) shouldn't include those days, change it.`;

  /** The fixture's run, on the rail, with the payments of `who` failed and the rest still on their way. */
  function withFailed(...who: ("ana" | "ben")[]) {
    const s = setup();
    const rail = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail" }, clock);
    let payroll = rail.payroll;
    for (const w of who) payroll = markPaycheckSettlement(payroll, rail.run.id, s[w].id, { status: "failed", failure: "rejected", attempt: tag });
    return { ...s, books: rail.books, payroll };
  }

  it("checkDoublePay lists it on its own, for any day of its period and any amount, and never as a question", () => {
    const f = withFailed("ana", "ben");
    const ana = (more: object = {}) => checkDoublePay(f.payroll, { ...f.input, lines: [{ workerId: f.ana.id }], ...more });
    const anaFailed = { blocked: [], overlap: [], failed: [{ workerId: f.ana.id, runId: "run-1", by: "period" }] };
    expect(ana()).toEqual(anaFailed); // the same days and pay date
    expect(ana({ payDate: "2026-10-17" })).toEqual(anaFailed); // a day later
    expect(ana({ payDate: "2026-10-30", periodStart: "2026-10-14", periodEnd: "2026-10-27" })).toEqual(anaFailed); // its last day
    expect(ana({ payDate: "2026-10-30", periodStart: "2026-09-17", periodEnd: "2026-10-01" })).toEqual(anaFailed); // its first day
    expect(ana({ payDate: "2026-10-30", periodStart: "2026-10-05", periodEnd: "2026-10-06" })).toEqual(anaFailed); // inside it
    expect(ana({ payDate: "2026-10-30", periodStart: "2026-10-15", periodEnd: "2026-10-28" })).toEqual(CLEAN); // the next period
    expect(ana({ payDate: "2026-10-02", periodStart: "2026-09-17", periodEnd: "2026-09-30" })).toEqual(CLEAN); // the one before
    // Only the pay date in common covers none of its days: asked about, as before.
    expect(ana({ periodStart: "2026-10-15", periodEnd: "2026-10-28" })).toEqual({ blocked: [], overlap: [{ workerId: f.ana.id, runId: "run-1", by: "date" }], failed: [] });
    // Hourly: the same hours, other hours, or none entered yet.
    const benFailed = { blocked: [], overlap: [], failed: [{ workerId: f.ben.id, runId: "run-1", by: "period" }] };
    for (const hours of [80, 10, undefined]) {
      expect(checkDoublePay(f.payroll, { ...f.input, payDate: "2026-10-17", lines: [{ workerId: f.ben.id, ...(hours === undefined ? {} : { hours }) }] }), `${hours}`).toEqual(benFailed);
    }
  });

  it("postPayRun refuses a new run over the same days, and naming the person as confirmed doesn't let it through", () => {
    const f = withFailed("ana");
    const again = { ...f.input, mode: "rail" as const, payDate: "2026-10-17", lines: [{ workerId: f.ana.id }] };
    expect(() => postPayRun(f.books, f.payroll, again, clock)).toThrow(PayrollError);
    expect(() => postPayRun(f.books, f.payroll, again, clock)).toThrow(RETRY_ANA);
    expect(() => postPayRun(f.books, f.payroll, { ...again, confirmedOverlaps: [f.ana.id] }, clock)).toThrow(RETRY_ANA);
    expect(() => postPayRun(f.books, f.payroll, { ...again, confirmedOverlaps: [f.ana.id, f.ben.id] }, clock)).toThrow(RETRY_ANA);
    // On the same pay date, too.
    expect(() => postPayRun(f.books, f.payroll, { ...again, payDate: "2026-10-16", confirmedOverlaps: [f.ana.id] }, clock)).toThrow(RETRY_ANA);
    expect(doublePayRefusal(f.payroll, again)).toBe(RETRY_ANA + thisPeriod("2026-10-01", "2026-10-14"));
    // Pure: nothing was added.
    expect(f.payroll.runs).toHaveLength(1);
    expect(f.books.entries).toHaveLength(2);
  });

  it("refuses a run that shares a single day with it, at another amount, after confirming", () => {
    const f = withFailed("ben");
    const oneDay = { ...f.input, mode: "rail" as const, payDate: "2026-10-30", periodStart: "2026-10-14", periodEnd: "2026-10-27", lines: [{ workerId: f.ben.id, hours: 10 }] };
    const retryBen =
      "Ben's paycheck for 2026-10-01 to 2026-10-14 (run of 2026-10-16) failed. Retry it from that run in Pay runs: a new paycheck for those days isn't posted while that one can still be paid.";
    expect(() => postPayRun(f.books, f.payroll, oneDay, clock)).toThrow(retryBen + thisPeriod("2026-10-14", "2026-10-27"));
    expect(() => postPayRun(f.books, f.payroll, { ...oneDay, confirmedOverlaps: [f.ben.id] }, clock)).toThrow(retryBen);
    // The first day at the other end, as an external run.
    const before = { ...f.input, payDate: "2026-10-02", periodStart: "2026-09-18", periodEnd: "2026-10-01", lines: [{ workerId: f.ben.id, hours: 80 }] };
    expect(() => postPayRun(f.books, f.payroll, { ...before, confirmedOverlaps: [f.ben.id] }, clock)).toThrow(retryBen);
    // The day after its period ends is the next period: that posts.
    expect(postPayRun(f.books, f.payroll, { ...oneDay, periodStart: "2026-10-15", periodEnd: "2026-10-28" }, clock).run.id).toBe("run-2");
  });

  // Run payroll shows this refusal and opens its confirm box only when there is none, listing only
  // `overlap`: so the box never offers to post over a failed paycheck.
  it("is reported before any other paycheck the run would pay again, and isn't one of the questions", () => {
    const f = withFailed("ana"); // Ben's payment is still on its way
    const both = { ...f.input, payDate: "2026-10-17", lines: [{ workerId: f.ana.id }, { workerId: f.ben.id, hours: 80 }] };
    expect(checkDoublePay(f.payroll, both)).toEqual({
      blocked: [{ workerId: f.ben.id, runId: "run-1", by: "period" }],
      overlap: [],
      failed: [{ workerId: f.ana.id, runId: "run-1", by: "period" }],
    });
    expect(doublePayRefusal(f.payroll, both)).toBe(RETRY_ANA + thisPeriod("2026-10-01", "2026-10-14"));
    expect(() => postPayRun(f.books, f.payroll, both, clock)).toThrow(RETRY_ANA);
    // Ben at another amount is a question; Ana's failed paycheck still comes first, confirmed or not.
    const asked = { ...both, lines: [{ workerId: f.ana.id }, { workerId: f.ben.id, hours: 10 }] };
    const check = checkDoublePay(f.payroll, asked);
    expect(check.overlap).toEqual([{ workerId: f.ben.id, runId: "run-1", by: "period" }]);
    expect(check.failed).toEqual([{ workerId: f.ana.id, runId: "run-1", by: "period" }]);
    expect(doublePayRefusal(f.payroll, asked, check)).toBe(RETRY_ANA + thisPeriod("2026-10-01", "2026-10-14"));
    expect(() => postPayRun(f.books, f.payroll, { ...asked, confirmedOverlaps: [f.ana.id, f.ben.id] }, clock)).toThrow(RETRY_ANA);
  });

  it("names each failed paycheck, oldest period first, when a run reaches over more than one", () => {
    const s = setup();
    const ana = [{ workerId: s.ana.id }];
    // The later period is posted first.
    const late = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail", payDate: "2026-10-30", periodStart: "2026-10-15", periodEnd: "2026-10-28", lines: ana }, clock);
    const early = postPayRun(late.books, late.payroll, { ...s.input, mode: "rail", lines: ana }, clock);
    let payroll = markPaycheckSettlement(early.payroll, "run-1", s.ana.id, { status: "failed", failure: "rejected" });
    payroll = markPaycheckSettlement(payroll, "run-2", s.ana.id, { status: "failed", failure: "rejected" });
    const wide = { ...s.input, payDate: "2026-11-02", periodStart: "2026-10-01", periodEnd: "2026-10-28", lines: ana };
    const words =
      "These paychecks failed: Ana's for 2026-10-01 to 2026-10-14 (run of 2026-10-16), Ana's for 2026-10-15 to 2026-10-28 (run of 2026-10-30). Retry each from its run in Pay runs: a new paycheck for those days isn't posted while they can still be paid.";
    expect(doublePayRefusal(payroll, wide)).toBe(words + thisPeriod("2026-10-01", "2026-10-28"));
    expect(() => postPayRun(early.books, payroll, { ...wide, confirmedOverlaps: [s.ana.id] }, clock)).toThrow(words);
  });

  // A run posted over a paycheck still on its way (another amount, confirmed) can later sit beside
  // it when that payment fails, and books from earlier builds may hold such a run already. Retrying
  // the failed one would then pay days the other run covers, so the words say to check that run first.
  it("says to check first, not to retry, when another run also has a paycheck for some of its days", () => {
    const s = setup();
    const ben = (hours: number) => [{ workerId: s.ben.id, hours }];
    const first = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail", lines: ben(80) }, clock); // on its way
    const byBank = postPayRun(first.books, first.payroll, { ...s.input, payDate: "2026-10-20", lines: ben(82), confirmedOverlaps: [s.ben.id] }, clock);
    const failed = markPaycheckSettlement(byBank.payroll, "run-1", s.ben.id, { status: "failed", failure: "rejected", attempt: tag });
    const next = { ...s.input, mode: "rail" as const, payDate: "2026-10-30", periodStart: "2026-10-14", periodEnd: "2026-10-27", lines: ben(80) };
    const check = checkDoublePay(failed, next);
    expect(check.failed).toEqual([{ workerId: s.ben.id, runId: "run-1", by: "period" }]);
    expect(check.overlap).toEqual([{ workerId: s.ben.id, runId: "run-2", by: "period" }]);
    const words =
      "Ben's paycheck for 2026-10-01 to 2026-10-14 (run of 2026-10-16) failed, and the run of 2026-10-20 also has a paycheck for Ben for some of those days. Check whether that run paid them before you retry this one in Pay runs: a new paycheck for those days isn't posted while the failed one can still be paid." +
      thisPeriod("2026-10-14", "2026-10-27");
    expect(doublePayRefusal(failed, next)).toBe(words);
    expect(doublePayRefusal(failed, next)).not.toMatch(/Retry it/);
    expect(() => postPayRun(byBank.books, failed, { ...next, confirmedOverlaps: [s.ben.id] }, clock)).toThrow(words);
    // It looks at the failed paycheck's own days, not this run's: a run for only its first three days counts too.
    const early = postPayRun(first.books, first.payroll, { ...s.input, payDate: "2026-10-05", periodStart: "2026-09-28", periodEnd: "2026-10-03", lines: ben(24), confirmedOverlaps: [s.ben.id] }, clock);
    const earlyFailed = markPaycheckSettlement(early.payroll, "run-1", s.ben.id, { status: "failed", failure: "rejected", attempt: tag });
    expect(doublePayRefusal(earlyFailed, next)).toMatch(/^Ben's paycheck for 2026-10-01 to 2026-10-14 \(run of 2026-10-16\) failed, and the run of 2026-10-05 also has a paycheck for Ben /);
    // Two such runs are both named.
    const third = postPayRun(byBank.books, byBank.payroll, { ...s.input, payDate: "2026-10-23", periodStart: "2026-10-10", periodEnd: "2026-10-12", lines: ben(16), confirmedOverlaps: [s.ben.id] }, clock);
    const twoOthers = markPaycheckSettlement(third.payroll, "run-1", s.ben.id, { status: "failed", failure: "rejected", attempt: tag });
    expect(doublePayRefusal(twoOthers, next)).toMatch(
      /failed, and the runs of 2026-10-20 and 2026-10-23 also have a paycheck for Ben for some of those days\. Check whether those runs paid them before you retry this one in Pay runs:/,
    );
  });

  it("names the other run beside each failed paycheck when both payments failed, so only one is retried", () => {
    const s = setup();
    const ben = (hours: number) => [{ workerId: s.ben.id, hours }];
    const first = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail", lines: ben(80) }, clock);
    const second = postPayRun(first.books, first.payroll, { ...s.input, mode: "rail", payDate: "2026-10-20", lines: ben(82), confirmedOverlaps: [s.ben.id] }, clock);
    let payroll = markPaycheckSettlement(second.payroll, "run-1", s.ben.id, { status: "failed", failure: "rejected", attempt: tag });
    payroll = markPaycheckSettlement(payroll, "run-2", s.ben.id, { status: "failed", failure: "rejected", attempt: "cd".repeat(16) });
    const next = { ...s.input, mode: "rail" as const, payDate: "2026-10-30", periodStart: "2026-10-14", periodEnd: "2026-10-27", lines: ben(80) };
    const words =
      "These paychecks failed: Ben's for 2026-10-01 to 2026-10-14 (run of 2026-10-16; the run of 2026-10-20 also has one for Ben for some of those days), Ben's for 2026-10-01 to 2026-10-14 (run of 2026-10-20; the run of 2026-10-16 also has one for Ben for some of those days). Retry each from its run in Pay runs, but first check whether a run named beside it paid those days: a new paycheck for those days isn't posted while they can still be paid." +
      thisPeriod("2026-10-14", "2026-10-27");
    expect(doublePayRefusal(payroll, next)).toBe(words);
    expect(() => postPayRun(second.books, payroll, { ...next, confirmedOverlaps: [s.ben.id] }, clock)).toThrow(words);
  });

  it("still says to retry when the other paychecks are someone else's, or for days the failed one doesn't cover", () => {
    const s = setup();
    const ben = (hours: number) => [{ workerId: s.ben.id, hours }];
    const first = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail", lines: ben(80) }, clock);
    // Ana is paid for the same days in another run, and Ben for the next period.
    const ana = postPayRun(first.books, first.payroll, { ...s.input, payDate: "2026-10-20", lines: [{ workerId: s.ana.id }] }, clock);
    const later = postPayRun(ana.books, ana.payroll, { ...s.input, payDate: "2026-10-30", periodStart: "2026-10-15", periodEnd: "2026-10-28", lines: ben(80) }, clock);
    const payroll = markPaycheckSettlement(later.payroll, "run-1", s.ben.id, { status: "failed", failure: "rejected", attempt: tag });
    const reachesBack = { ...s.input, mode: "rail" as const, payDate: "2026-11-13", periodStart: "2026-10-14", periodEnd: "2026-11-10", lines: ben(80) };
    expect(checkDoublePay(payroll, reachesBack).failed).toEqual([{ workerId: s.ben.id, runId: "run-1", by: "period" }]);
    expect(doublePayRefusal(payroll, reachesBack)).toBe(
      "Ben's paycheck for 2026-10-01 to 2026-10-14 (run of 2026-10-16) failed. Retry it from that run in Pay runs: a new paycheck for those days isn't posted while that one can still be paid." +
        thisPeriod("2026-10-14", "2026-11-10"),
    );
  });

  it("doesn't stand in the way of anyone else's pay for the same days", () => {
    const s = setup();
    const rail = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail", lines: [{ workerId: s.ana.id }] }, clock);
    const failed = markPaycheckSettlement(rail.payroll, rail.run.id, s.ana.id, { status: "failed", failure: "rejected", attempt: tag });
    const ben = { ...s.input, mode: "rail" as const, payDate: "2026-10-17", lines: [{ workerId: s.ben.id, hours: 80 }] };
    expect(checkDoublePay(failed, ben)).toEqual(CLEAN);
    expect(postPayRun(rail.books, failed, ben, clock).run.id).toBe("run-2");
    // Someone in the same run whose payment is on its way keeps the rules for that.
    const f = withFailed("ana");
    expect(() => postPayRun(f.books, f.payroll, { ...ben }, clock)).toThrow(/Already paid the same amount for 2026-10-01 to 2026-10-14: Ben\./);
    const more = { ...ben, lines: [{ workerId: s.ben.id, hours: 10 }] };
    expect(() => postPayRun(f.books, f.payroll, more, clock)).toThrow("Ben has another paycheck for this pay date or pay period. Confirm it before posting this one.");
    expect(postPayRun(f.books, f.payroll, { ...more, confirmedOverlaps: [s.ben.id] }, clock).run.id).toBe("run-2");
  });

  it("once its Retry is on its way, and once it has settled, the usual rules apply again", () => {
    const f = withFailed("ben");
    const same = { ...f.input, mode: "rail" as const, payDate: "2026-10-17", lines: [{ workerId: f.ben.id, hours: 80 }] };
    const other = { ...same, lines: [{ workerId: f.ben.id, hours: 10 }] };
    // Retry: the failed paycheck goes back to pending in its own run, to spend the record it set aside.
    const retrying = markPaycheckSettlement(f.payroll, "run-1", f.ben.id, { status: "pending", attempt: tag });
    const settled = markPaycheckSettlement(retrying, "run-1", f.ben.id, { status: "settled", reference: "at1retry", settledAt: clock.now() });
    for (const payroll of [retrying, settled]) {
      const status = payroll.runs[0]!.paychecks[1]!.settlement.status;
      expect(checkDoublePay(payroll, same), status).toEqual({ blocked: [{ workerId: f.ben.id, runId: "run-1", by: "period" }], overlap: [], failed: [] });
      expect(() => postPayRun(f.books, payroll, same, clock), status).toThrow(/Already paid the same amount for 2026-10-01 to 2026-10-14: Ben\./);
      expect(() => postPayRun(f.books, payroll, other, clock), status).toThrow(/Ben has another paycheck/);
      expect(postPayRun(f.books, payroll, { ...other, confirmedOverlaps: [f.ben.id] }, clock).run.id, status).toBe("run-2");
    }
    // Paid once: the settled paycheck never changes again.
    expect(() => markPaycheckSettlement(settled, "run-1", f.ben.id, { status: "failed", failure: "rejected" })).toThrow(/settled paycheck can't/);
    expect(() => markPaycheckSettlement(settled, "run-1", f.ben.id, { status: "pending", attempt: tag })).toThrow(/settled paycheck can't/);
  });

  it("external runs: one over its days is refused the same way, and an external paycheck never fails", () => {
    const f = withFailed("ana");
    const external = { ...f.input, payDate: "2026-10-17", reference: "Batch 7", lines: [{ workerId: f.ana.id }] };
    expect(() => postPayRun(f.books, f.payroll, external, clock)).toThrow(RETRY_ANA);
    expect(() => postPayRun(f.books, f.payroll, { ...external, mode: "external", confirmedOverlaps: [f.ana.id] }, clock)).toThrow(RETRY_ANA);
    // An external run is settled as it posts, so its paychecks can't fail and keep the rules for a paid one.
    const s = setup();
    const paid = postPayRun(s.books, s.payroll, s.input, clock);
    expect(() => markPaycheckSettlement(paid.payroll, "run-1", s.ana.id, { status: "failed", failure: "rejected" })).toThrow(/settled paycheck can't become failed/);
    expect(checkDoublePay(paid.payroll, { ...s.input, payDate: "2026-10-17" }).failed).toEqual([]);
    expect(() => postPayRun(paid.books, paid.payroll, { ...s.input, payDate: "2026-10-17", confirmedOverlaps: [s.ana.id, s.ben.id] }, clock)).toThrow(/Already paid the same amount/);
  });
});

describe("year to date on the same day", () => {
  it("a second run on the same day counts the first, and each paystub rebuilds to its own hash", () => {
    const s = setup();
    const first = postPayRun(s.books, s.payroll, s.input, clock);
    const second = postPayRun(first.books, first.payroll, { ...s.input, lines: [{ workerId: s.ben.id, hours: 10 }], confirmedOverlaps: [s.ben.id] }, clock);
    const ben1 = first.run.paychecks[1]!;
    const ben2 = second.run.paychecks[0]!;
    // The next run (no run id) sees everything posted so far, including today.
    expect(yearToDate(second.payroll, s.ben.id, "2026-10-16")).toEqual({
      gross: ben1.gross + ben2.gross,
      socialSecurity: ben1.socialSecurity + ben2.socialSecurity,
      employerSocialSecurity: ben1.employerSocialSecurity + ben2.employerSocialSecurity,
      withheld: withheld(ben1) + withheld(ben2),
    });
    // Rebuilding each paystub from the vault gives the hash it was posted with.
    const doc1 = paystubDocument(first.run, ben1, s.ben, s.books.settings, yearToDate(second.payroll, s.ben.id, first.run.payDate, first.run.id));
    const doc2 = paystubDocument(second.run, ben2, s.ben, s.books.settings, yearToDate(second.payroll, s.ben.id, second.run.payDate, second.run.id));
    expect(paystubHash(doc1)).toBe(ben1.paystubHash);
    expect(paystubHash(doc2)).toBe(ben2.paystubHash);
    expect(doc1.ytdGross).toBe(ben1.gross);
    expect(doc2.ytdGross).toBe(ben1.gross + ben2.gross);
    expect(() => yearToDate(second.payroll, s.ben.id, "2026-10-16", "run-9")).toThrow(/not found/);
  });

  it("a run posted later but dated earlier is not seen by a run posted before it", () => {
    const s = setup();
    const first = postPayRun(s.books, s.payroll, s.input, clock); // 10-16
    const backdated = postPayRun(first.books, first.payroll, { ...s.input, payDate: "2026-10-09", periodStart: "2026-09-17", periodEnd: "2026-09-30" }, clock);
    const ana1 = first.run.paychecks[0]!;
    const doc = paystubDocument(first.run, ana1, s.ana, s.books.settings, yearToDate(backdated.payroll, s.ana.id, first.run.payDate, first.run.id));
    expect(paystubHash(doc)).toBe(ana1.paystubHash);
    expect(doc.ytdGross).toBe(ana1.gross);
  });
});

describe("ensureRailAccount", () => {
  it("creates the rail balance account once, as a bank account, and finds it by name afterwards", () => {
    const books = createBooks({ businessName: "x", fiscalYearStartMonth: 1 });
    const a = ensureRailAccount(books);
    const account = a.books.accounts.find((x) => x.id === a.accountId)!;
    expect(account).toMatchObject({ name: RAIL_ACCOUNT_NAME, type: "bank", active: true });
    const b = ensureRailAccount(a.books);
    expect(b.accountId).toBe(a.accountId);
    expect(b.books).toBe(a.books);
    // A user's own account under the name, any case, is reused rather than duplicated.
    const own = addAccount(books, { name: "shield Account", type: "bank" });
    expect(ensureRailAccount(own.books).accountId).toBe(own.account.id);
    // So is one under the name it had before.
    const legacy = addAccount(books, { name: "Rail balance", type: "bank" });
    expect(ensureRailAccount(legacy.books).accountId).toBe(legacy.account.id);
    expect(findRailAccount(legacy.books)?.id).toBe(legacy.account.id);
    expect(findRailAccount(books)).toBeUndefined();
    // A non-bank account with the name doesn't count.
    const wrong = addAccount(books, { name: RAIL_ACCOUNT_NAME, type: "expense" });
    expect(() => ensureRailAccount(wrong.books)).toThrow(/already exists/);
  });
});
