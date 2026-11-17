// Each person's own pay period: where their next period starts, how long it is for each pay
// frequency, which periods are due on a pay date, and what a new hire joins. The worked examples
// are those of docs/PAY_PERIODS.md, posted through postPayRun so the history is the real thing.
// Weekly periods here run Sunday to Saturday: Nov 7, 14 and 21, 2026 are Saturdays.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Books, applyTemplate, createBooks } from "@pnw/ledger";
import {
  type DuePeriod,
  type DuePeriods,
  LONGEST_PERIOD_DAYS,
  duePeriods,
  paidThrough,
  periodFrom,
  teamRhythm,
} from "./pay_periods";
import {
  type PayFrequency,
  type PayRun,
  type Paycheck,
  type Payroll,
  type Settlement,
  type SettlementMode,
  type W4,
  PayrollError,
  addWorker,
  emptyPayroll,
  ensureRailAccount,
  markPaycheckSettlement,
  postPayRun,
  updateWorker,
} from "./payroll";

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const clock = { now: () => "2026-11-21T12:00:00.000Z" };
const FREQUENCIES: PayFrequency[] = ["weekly", "biweekly", "semimonthly", "monthly"];

type Person = { name: string; frequency: PayFrequency; payType?: "hourly" | "salary"; rate?: bigint };

/** A business with a team, posting real pay runs; `id` maps each name to its team member id. */
function business(...people: Person[]) {
  let books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
  const bankId = books.accounts.find((a) => a.name === "Checking")!.id;
  const rail = ensureRailAccount(books);
  books = rail.books;
  let payroll: Payroll = emptyPayroll();
  const id: Record<string, string> = {};
  for (const p of people) {
    const payType = p.payType ?? "hourly";
    const r = addWorker(payroll, { name: p.name, payType, rate: p.rate ?? (payType === "hourly" ? 2500n : 5_200_000n), frequency: p.frequency, w4: W4_SINGLE });
    payroll = r.payroll;
    id[p.name] = r.worker.id;
  }
  const biz = {
    id,
    get payroll() {
      return payroll;
    },
    set payroll(next: Payroll) {
      payroll = next;
    },
    /**
     * Posts one run for one period; hourly people get 40 hours unless `hours` says otherwise.
     * `confirmOverlap` confirms another paycheck over the same days, as the run screen asks to.
     */
    post(payDate: string, periodStart: string, periodEnd: string, names: string[], mode: SettlementMode = "external", hours = 40, confirmOverlap = false): string {
      const lines = names.map((n) => {
        const w = payroll.workers.find((x) => x.id === id[n])!;
        return w.payType === "hourly" ? { workerId: w.id, hours } : { workerId: w.id };
      });
      const confirmedOverlaps = confirmOverlap ? names.map((n) => id[n]!) : undefined;
      const r = postPayRun(books, payroll, { payDate, periodStart, periodEnd, bankAccountId: mode === "rail" ? rail.accountId : bankId, mode, lines, confirmedOverlaps }, clock);
      books = r.books;
      payroll = r.payroll;
      return r.run.id;
    },
    due(name: string, payDate: string, options?: Parameters<typeof duePeriods>[3]): DuePeriods {
      return duePeriods(payroll, id[name]!, payDate, options);
    },
  };
  return biz;
}

/** One expected line: due and ticked unless the flags say otherwise. */
function line(periodStart: string, periodEnd: string, flags: Partial<Omit<DuePeriod, "periodStart" | "periodEnd">> = {}): DuePeriod {
  return { periodStart, periodEnd, due: true, ticked: true, missed: false, folded: false, bridge: false, longAgo: false, ...flags };
}
const notDue = (periodStart: string, periodEnd: string, flags: Partial<DuePeriod> = {}) => line(periodStart, periodEnd, { due: false, ticked: false, ...flags });

/** A payroll built by hand, for shapes postPayRun wouldn't make (corrupt runs, statuses set directly). */
function handRun(id: string, payDate: string, periodStart: string, periodEnd: string, workerIds: string[], settlement: Settlement = { status: "settled" }): PayRun {
  const paychecks: Paycheck[] = workerIds.map((workerId) => ({
    workerId,
    gross: 0n,
    federalIncomeTax: 0n,
    socialSecurity: 0n,
    medicare: 0n,
    additionalMedicare: 0n,
    employerSocialSecurity: 0n,
    employerMedicare: 0n,
    net: 0n,
    settlement: { ...settlement },
  }));
  return { id, payDate, periodStart, periodEnd, bankAccountId: "acct-1", mode: "external", paychecks, entryIds: [] };
}

/** Day arithmetic for the property tests. */
const plus = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const length = (p: { periodStart: string; periodEnd: string }) => Math.round((Date.parse(p.periodEnd) - Date.parse(p.periodStart)) / 86_400_000) + 1;

describe("periodFrom: one period of a frequency from its first day", () => {
  it("is seven days for weekly and fourteen for every two weeks, from any day, across a year end", () => {
    expect(periodFrom("weekly", "2026-11-15")).toEqual({ periodStart: "2026-11-15", periodEnd: "2026-11-21", folded: false });
    expect(periodFrom("weekly", "2026-11-18")).toEqual({ periodStart: "2026-11-18", periodEnd: "2026-11-24", folded: false });
    expect(periodFrom("weekly", "2026-12-27")).toEqual({ periodStart: "2026-12-27", periodEnd: "2027-01-02", folded: false });
    expect(periodFrom("weekly", "2028-02-26")).toEqual({ periodStart: "2028-02-26", periodEnd: "2028-03-03", folded: false });
    expect(periodFrom("biweekly", "2026-11-15")).toEqual({ periodStart: "2026-11-15", periodEnd: "2026-11-28", folded: false });
    expect(periodFrom("biweekly", "2026-12-20")).toEqual({ periodStart: "2026-12-20", periodEnd: "2027-01-02", folded: false });
  });

  it("is the 1st to the 15th or the 16th to the month's end, twice a month, February included", () => {
    expect(periodFrom("semimonthly", "2026-11-01")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-15", folded: false });
    expect(periodFrom("semimonthly", "2026-11-16")).toEqual({ periodStart: "2026-11-16", periodEnd: "2026-11-30", folded: false });
    expect(periodFrom("semimonthly", "2026-12-16")).toEqual({ periodStart: "2026-12-16", periodEnd: "2026-12-31", folded: false });
    expect(periodFrom("semimonthly", "2027-02-16")).toEqual({ periodStart: "2027-02-16", periodEnd: "2027-02-28", folded: false });
    expect(periodFrom("semimonthly", "2028-02-16")).toEqual({ periodStart: "2028-02-16", periodEnd: "2028-02-29", folded: false });
  });

  it("twice a month, runs from an odd day to the half's end, and folds a leftover under seven days into the next half", () => {
    // Seven days or more: its own (short) period.
    expect(periodFrom("semimonthly", "2026-11-09")).toEqual({ periodStart: "2026-11-09", periodEnd: "2026-11-15", folded: false });
    expect(periodFrom("semimonthly", "2026-11-24")).toEqual({ periodStart: "2026-11-24", periodEnd: "2026-11-30", folded: false });
    expect(periodFrom("semimonthly", "2028-02-23")).toEqual({ periodStart: "2028-02-23", periodEnd: "2028-02-29", folded: false });
    // Under seven: joins the next half.
    expect(periodFrom("semimonthly", "2027-02-15")).toEqual({ periodStart: "2027-02-15", periodEnd: "2027-02-28", folded: true });
    expect(periodFrom("semimonthly", "2026-11-15")).toEqual({ periodStart: "2026-11-15", periodEnd: "2026-11-30", folded: true });
    expect(periodFrom("semimonthly", "2026-11-10")).toEqual({ periodStart: "2026-11-10", periodEnd: "2026-11-30", folded: true });
    expect(periodFrom("semimonthly", "2026-11-25")).toEqual({ periodStart: "2026-11-25", periodEnd: "2026-12-15", folded: true });
    expect(periodFrom("semimonthly", "2026-12-26")).toEqual({ periodStart: "2026-12-26", periodEnd: "2027-01-15", folded: true });
    expect(periodFrom("semimonthly", "2027-02-23")).toEqual({ periodStart: "2027-02-23", periodEnd: "2027-03-15", folded: true });
    // The longest a fold makes: 22 days.
    expect(periodFrom("semimonthly", "2026-01-10")).toEqual({ periodStart: "2026-01-10", periodEnd: "2026-01-31", folded: true });
  });

  it("is the calendar month for monthly, and folds a leftover under fourteen days into the next month", () => {
    expect(periodFrom("monthly", "2026-11-01")).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-30", folded: false });
    expect(periodFrom("monthly", "2027-02-01")).toEqual({ periodStart: "2027-02-01", periodEnd: "2027-02-28", folded: false });
    expect(periodFrom("monthly", "2028-02-01")).toEqual({ periodStart: "2028-02-01", periodEnd: "2028-02-29", folded: false });
    expect(periodFrom("monthly", "2026-10-18")).toEqual({ periodStart: "2026-10-18", periodEnd: "2026-10-31", folded: false });
    expect(periodFrom("monthly", "2026-11-15")).toEqual({ periodStart: "2026-11-15", periodEnd: "2026-11-30", folded: false });
    expect(periodFrom("monthly", "2028-02-16")).toEqual({ periodStart: "2028-02-16", periodEnd: "2028-02-29", folded: false });
    expect(periodFrom("monthly", "2026-10-31")).toEqual({ periodStart: "2026-10-31", periodEnd: "2026-11-30", folded: true });
    expect(periodFrom("monthly", "2026-10-19")).toEqual({ periodStart: "2026-10-19", periodEnd: "2026-11-30", folded: true });
    expect(periodFrom("monthly", "2026-12-20")).toEqual({ periodStart: "2026-12-20", periodEnd: "2027-01-31", folded: true });
    expect(periodFrom("monthly", "2027-02-16")).toEqual({ periodStart: "2027-02-16", periodEnd: "2027-03-31", folded: true });
    // The longest a fold makes: 44 days.
    expect(periodFrom("monthly", "2026-07-19")).toEqual({ periodStart: "2026-07-19", periodEnd: "2026-08-31", folded: true });
  });

  it("for every frequency and every first day of 2026 to 2028: starts on that day, is never longer than the longest, and then follows the calendar", () => {
    for (const f of FREQUENCIES) {
      let longest = 0;
      for (let day = "2026-01-01"; day <= "2028-12-31"; day = plus(day, 1)) {
        const p = periodFrom(f, day);
        expect(p.periodStart).toBe(day);
        expect(p.periodEnd >= p.periodStart).toBe(true);
        expect(length(p)).toBeLessThanOrEqual(LONGEST_PERIOD_DAYS[f]);
        longest = Math.max(longest, length(p));
        // The period after it starts on the calendar, twice a month and monthly.
        const next = periodFrom(f, plus(p.periodEnd, 1));
        if (f === "semimonthly") expect(["01", "16"]).toContain(next.periodStart.slice(8));
        if (f === "monthly") expect(next.periodStart.slice(8)).toBe("01");
        if (f === "weekly" || f === "biweekly") expect(p.folded).toBe(false);
      }
      expect(longest).toBe(LONGEST_PERIOD_DAYS[f]);
    }
    expect(LONGEST_PERIOD_DAYS).toEqual({ weekly: 7, biweekly: 14, semimonthly: 22, monthly: 44 });
  });

  it("refuses a day that isn't one and a frequency it doesn't know, as a payroll error", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "2026-11-00", "11/15/2026", "2026-1-5", "", "soon"]) {
      expect(() => periodFrom("weekly", bad)).toThrow(PayrollError);
    }
    expect(() => periodFrom("weekly", undefined as unknown as string)).toThrow(PayrollError);
    expect(() => periodFrom("semimonthly", "2026-02-29")).toThrow(/2026-02-29/);
    for (const bad of ["fortnightly", "daily", "", undefined, "toString"]) {
      expect(() => periodFrom(bad as PayFrequency, "2026-11-15")).toThrow(PayrollError);
      expect(() => periodFrom(bad as PayFrequency, "2026-11-15")).toThrow(/pay frequency/);
    }
  });
});

describe("paidThrough: the last day any of a person's paychecks covers", () => {
  it("is nothing for someone never paid, and the latest period end otherwise, whoever else was paid", () => {
    const biz = business({ name: "Ana", frequency: "weekly" }, { name: "Ben", frequency: "weekly" });
    expect(paidThrough(biz.payroll, biz.id.Ana!)).toBeUndefined();
    biz.post("2026-11-07", "2026-11-01", "2026-11-07", ["Ana", "Ben"]);
    biz.post("2026-11-14", "2026-11-08", "2026-11-14", ["Ben"]);
    expect(paidThrough(biz.payroll, biz.id.Ana!)).toBe("2026-11-07");
    expect(paidThrough(biz.payroll, biz.id.Ben!)).toBe("2026-11-14");
    expect(paidThrough(biz.payroll, "wkr-99")).toBeUndefined();
  });

  it("counts a paycheck whatever its payment status: settled, pending in every form, failed, or nothing to pay", () => {
    const variants: Settlement[] = [
      { status: "settled", reference: "at1paid", settledAt: clock.now() },
      { status: "pending" },
      { status: "pending", attempt: "0123456789abcdef0123456789abcdef" },
      { status: "pending", reference: "at1sent" },
      { status: "pending", failure: "Shield didn't answer; check before paying again" },
      { status: "failed", failure: "Shield turned the transfer down" },
    ];
    for (const settlement of variants) {
      const biz = business({ name: "Ana", frequency: "weekly" });
      biz.post("2026-11-07", "2026-11-01", "2026-11-07", ["Ana"]);
      const runId = biz.post("2026-11-14", "2026-11-08", "2026-11-14", ["Ana"], "rail");
      biz.payroll = { ...biz.payroll, runs: biz.payroll.runs.map((r) => (r.id === runId ? { ...r, paychecks: r.paychecks.map((p) => ({ ...p, settlement })) } : r)) };
      expect(paidThrough(biz.payroll, biz.id.Ana!), settlement.status).toBe("2026-11-14");
    }
    // A paycheck with nothing to pay still covers its days.
    const zero = business({ name: "Ana", frequency: "weekly" });
    zero.post("2026-11-14", "2026-11-08", "2026-11-14", ["Ana"], "external", 0);
    expect(zero.payroll.runs[0]!.paychecks[0]!.gross).toBe(0n);
    expect(paidThrough(zero.payroll, zero.id.Ana!)).toBe("2026-11-14");
  });

  it("takes the union of overlapping periods from the old two-week default, and runs posted out of order", () => {
    const biz = business({ name: "Ana", frequency: "weekly" });
    biz.post("2026-11-07", "2026-10-25", "2026-11-07", ["Ana"]);
    // Old books paid the same amount again over the shared week; that repeat is refused now, so
    // the second window pays other hours, confirmed. Which days are covered is what counts here.
    biz.post("2026-11-14", "2026-11-01", "2026-11-14", ["Ana"], "external", 32, true);
    expect(paidThrough(biz.payroll, biz.id.Ana!)).toBe("2026-11-14");
    // A catch-up for an earlier week posted after the latest week.
    biz.post("2026-11-21", "2026-10-18", "2026-10-24", ["Ana"]);
    expect(paidThrough(biz.payroll, biz.id.Ana!)).toBe("2026-11-14");
  });

  it("refuses a history whose pay period isn't readable, rather than guess where pay stops", () => {
    for (const [start, end] of [
      ["2026-11-08", "2026-11-31"],
      ["2026-11-08", "soon"],
      ["2026-11-08", undefined],
      ["2026-11-14", "2026-11-08"],
    ] as const) {
      const payroll: Payroll = {
        ...emptyPayroll(),
        runs: [handRun("run-1", "2026-11-07", "2026-11-01", "2026-11-07", ["wkr-1"]), handRun("run-2", "2026-11-14", start, end as string, ["wkr-1"])],
      };
      expect(() => paidThrough(payroll, "wkr-1"), `${start} ${end}`).toThrow(PayrollError);
      // Someone else's unreadable run doesn't stand in the way of this person's.
      expect(paidThrough(payroll, "wkr-2")).toBeUndefined();
    }
    const backwards: Payroll = { ...emptyPayroll(), runs: [handRun("run-1", "2026-11-14", "2026-11-14", "2026-11-08", ["wkr-1"])] };
    expect(() => paidThrough(backwards, "wkr-1")).toThrow(/ends before it starts/);
  });
});

describe("teamRhythm: the weekly or two-weekly periods a new hire joins", () => {
  it("follows the period end most of the active team on that frequency shares, ties to the latest", () => {
    const biz = business(
      { name: "Ana", frequency: "weekly" },
      { name: "Ben", frequency: "weekly" },
      { name: "Cal", frequency: "weekly" },
      { name: "Dot", frequency: "biweekly" },
      { name: "Eve", frequency: "weekly" },
    );
    expect(teamRhythm(biz.payroll, "weekly")).toBeUndefined();
    // Ana paid through Saturday Nov 7, Ben through Saturday Nov 14: one Sunday-to-Saturday rhythm.
    biz.post("2026-11-07", "2026-11-01", "2026-11-07", ["Ana"]);
    biz.post("2026-11-14", "2026-11-08", "2026-11-14", ["Ben"]);
    // Cal on his own Wednesday-to-Tuesday weeks, through Nov 17: the latest, but one against two.
    biz.post("2026-11-17", "2026-11-11", "2026-11-17", ["Cal"]);
    expect(teamRhythm(biz.payroll, "weekly")).toBe("2026-11-14");
    // Dot's two weeks are another frequency's rhythm.
    biz.post("2026-11-10", "2026-10-28", "2026-11-10", ["Dot"]);
    expect(teamRhythm(biz.payroll, "biweekly")).toBe("2026-11-10");
    // Ana deactivated: one Saturday against one Tuesday, and the Tuesday is later.
    biz.payroll = updateWorker(biz.payroll, biz.id.Ana!, { active: false });
    expect(teamRhythm(biz.payroll, "weekly")).toBe("2026-11-17");
    // The person being placed doesn't count towards their own team.
    expect(teamRhythm(biz.payroll, "weekly", biz.id.Cal!)).toBe("2026-11-14");
  });

  it("is the calendar, not a rhythm, twice a month and monthly", () => {
    const biz = business({ name: "Dee", frequency: "semimonthly", payType: "salary" }, { name: "Mo", frequency: "monthly", payType: "salary" });
    biz.post("2026-11-15", "2026-11-01", "2026-11-15", ["Dee"]);
    biz.post("2026-10-31", "2026-10-01", "2026-10-31", ["Mo"]);
    expect(teamRhythm(biz.payroll, "semimonthly")).toBeUndefined();
    expect(teamRhythm(biz.payroll, "monthly")).toBeUndefined();
    expect(() => teamRhythm(biz.payroll, "fortnightly" as PayFrequency)).toThrow(PayrollError);
  });
});

describe("duePeriods: the worked examples", () => {
  it("A. a weekly payer who missed one week is owed that week and this one, each its own period", () => {
    const biz = business({ name: "Ana", frequency: "weekly" }, { name: "Ben", frequency: "weekly" });
    biz.post("2026-11-07", "2026-11-01", "2026-11-07", ["Ana", "Ben"]);
    biz.post("2026-11-14", "2026-11-08", "2026-11-14", ["Ben"]);
    expect(biz.due("Ana", "2026-11-21")).toEqual({
      workerId: biz.id.Ana,
      frequency: "weekly",
      paidThrough: "2026-11-07",
      basis: "paid",
      frequencyChanged: false,
      periods: [line("2026-11-08", "2026-11-14", { missed: true }), line("2026-11-15", "2026-11-21")],
      earlier: 0,
      unsettled: [],
    });
    expect(biz.due("Ben", "2026-11-21").periods).toEqual([line("2026-11-15", "2026-11-21")]);
  });

  it("A. books from the old two-week default: overlapping windows, and the next week follows the last", () => {
    const biz = business({ name: "Ana", frequency: "weekly" }, { name: "Ben", frequency: "weekly" });
    biz.post("2026-11-07", "2026-10-25", "2026-11-07", ["Ana", "Ben"]);
    // The overlapping second window at other hours, confirmed (an exact repeat is refused now).
    biz.post("2026-11-14", "2026-11-01", "2026-11-14", ["Ana", "Ben"], "external", 32, true);
    for (const name of ["Ana", "Ben"]) {
      const r = biz.due(name, "2026-11-21");
      expect(r.paidThrough).toBe("2026-11-14");
      expect(r.periods).toEqual([line("2026-11-15", "2026-11-21")]);
    }
  });

  it("B. every two weeks: nothing due mid-period, so the next period is offered unticked; then due; then two after a miss", () => {
    const biz = business({ name: "Cal", frequency: "biweekly", payType: "salary", rate: 5_200_000n }, { name: "Ana", frequency: "weekly" });
    biz.post("2026-11-14", "2026-11-01", "2026-11-14", ["Cal"]);
    biz.post("2026-11-21", "2026-11-15", "2026-11-21", ["Ana"]);
    const mid = biz.due("Cal", "2026-11-21");
    expect(mid.paidThrough).toBe("2026-11-14");
    expect(mid.periods).toEqual([notDue("2026-11-15", "2026-11-28")]);
    expect(biz.due("Cal", "2026-11-28").periods).toEqual([line("2026-11-15", "2026-11-28")]);
    // Ana's week ends the same day as Cal's two weeks: two periods, so two runs on Nov 28.
    expect(biz.due("Ana", "2026-11-28").periods).toEqual([line("2026-11-22", "2026-11-28")]);
    // Cal left out on Nov 28: on Dec 12 he is owed both, one paycheck each.
    expect(biz.due("Cal", "2026-12-12").periods).toEqual([line("2026-11-15", "2026-11-28", { missed: true }), line("2026-11-29", "2026-12-12")]);
  });

  it("C. twice a month across February 2027 and 2028, a missed half, and a half from the old default folded in", () => {
    const dee = { name: "Dee", frequency: "semimonthly" as const, payType: "salary" as const, rate: 6_000_000n };
    const y2027 = business(dee);
    y2027.post("2027-01-31", "2027-01-16", "2027-01-31", ["Dee"]);
    expect(y2027.due("Dee", "2027-02-15").periods).toEqual([line("2027-02-01", "2027-02-15")]);
    // Missed Feb 15: both halves on Feb 28.
    expect(y2027.due("Dee", "2027-02-28").periods).toEqual([line("2027-02-01", "2027-02-15", { missed: true }), line("2027-02-16", "2027-02-28")]);
    y2027.post("2027-02-15", "2027-02-01", "2027-02-15", ["Dee"]);
    expect(y2027.due("Dee", "2027-02-28").periods).toEqual([line("2027-02-16", "2027-02-28")]);

    const y2028 = business(dee);
    y2028.post("2028-02-15", "2028-02-01", "2028-02-15", ["Dee"]);
    expect(y2028.due("Dee", "2028-02-28").periods).toEqual([notDue("2028-02-16", "2028-02-29")]);
    expect(y2028.due("Dee", "2028-02-29").periods).toEqual([line("2028-02-16", "2028-02-29")]);

    // From the old default: Feb 1 to 14 paid a full half. Feb 15 alone folds into the next half, no question.
    const legacy = business(dee);
    legacy.post("2027-02-14", "2027-02-01", "2027-02-14", ["Dee"]);
    expect(legacy.due("Dee", "2027-02-28").periods).toEqual([line("2027-02-15", "2027-02-28", { folded: true })]);
  });

  it("C. monthly from the old default: the sixteen days left are a bridge, unticked for salary, ticked for hourly pay", () => {
    const biz = business({ name: "Mo", frequency: "monthly", payType: "salary", rate: 6_000_000n }, { name: "Hal", frequency: "monthly" });
    biz.post("2026-11-14", "2026-11-01", "2026-11-14", ["Mo", "Hal"]);
    expect(biz.due("Mo", "2026-11-30").periods).toEqual([line("2026-11-15", "2026-11-30", { bridge: true, ticked: false })]);
    expect(biz.due("Hal", "2026-11-30").periods).toEqual([line("2026-11-15", "2026-11-30", { bridge: true })]);
    expect(biz.due("Mo", "2026-12-31").periods).toEqual([
      line("2026-11-15", "2026-11-30", { bridge: true, ticked: false, missed: true }),
      line("2026-12-01", "2026-12-31"),
    ]);
    // Paying December leaves the bridge behind: the next payroll starts after December.
    biz.post("2026-12-31", "2026-12-01", "2026-12-31", ["Mo"]);
    expect(biz.due("Mo", "2027-01-31").periods).toEqual([line("2027-01-01", "2027-01-31")]);
  });

  it("D. a new hire mid-period joins their teammates' week, with pay counted from their start date", () => {
    const biz = business(
      { name: "Ana", frequency: "weekly" },
      { name: "Ben", frequency: "weekly" },
      { name: "Eve", frequency: "weekly" },
      { name: "Fay", frequency: "weekly", payType: "salary", rate: 5_200_000n },
      { name: "Gil", frequency: "semimonthly", payType: "salary", rate: 6_000_000n },
    );
    biz.post("2026-11-14", "2026-11-08", "2026-11-14", ["Ana", "Ben"]);
    const eve = biz.due("Eve", "2026-11-21", { startDate: "2026-11-18" });
    expect(eve).toEqual({
      workerId: biz.id.Eve,
      frequency: "weekly",
      basis: "team",
      frequencyChanged: false,
      periods: [line("2026-11-15", "2026-11-21", { paysFrom: "2026-11-18" })],
      earlier: 0,
      unsettled: [],
    });
    expect(eve.paidThrough).toBeUndefined();
    // The same period as Ana and Ben: one run, not two.
    expect(biz.due("Ana", "2026-11-21").periods).toEqual([line("2026-11-15", "2026-11-21")]);
    expect(biz.due("Fay", "2026-11-21", { startDate: "2026-11-18" }).periods).toEqual([line("2026-11-15", "2026-11-21", { paysFrom: "2026-11-18" })]);
    // Starting on the period's first day counts from the period's start: no separate day.
    expect(biz.due("Eve", "2026-11-21", { startDate: "2026-11-15" }).periods).toEqual([line("2026-11-15", "2026-11-21")]);
    // Twice a month: the calendar half that holds the start date.
    const gil = biz.due("Gil", "2026-11-30", { startDate: "2026-11-18" });
    expect(gil.basis).toBe("start");
    expect(gil.periods).toEqual([line("2026-11-16", "2026-11-30", { paysFrom: "2026-11-18" })]);
    expect(biz.due("Gil", "2026-11-21", { startDate: "2026-11-18" }).periods).toEqual([notDue("2026-11-16", "2026-11-30", { paysFrom: "2026-11-18" })]);
    // No start date known: the team's latest week ending on or before the pay date.
    const unknown = biz.due("Eve", "2026-11-21");
    expect(unknown.basis).toBe("team");
    expect(unknown.periods).toEqual([line("2026-11-15", "2026-11-21")]);
    expect(biz.due("Eve", "2026-11-20").periods).toEqual([line("2026-11-08", "2026-11-14")]);
    // A team paid ahead (Friday Nov 20, for the week to Saturday Nov 21): a new hire with no start
    // date gets the latest week already ended; with one, the week that holds it, offered ahead.
    biz.post("2026-11-20", "2026-11-15", "2026-11-21", ["Ana", "Ben"]);
    expect(biz.due("Eve", "2026-11-20")).toMatchObject({ basis: "team", periods: [line("2026-11-08", "2026-11-14")] });
    expect(biz.due("Eve", "2026-11-20", { startDate: "2026-11-18" }).periods).toEqual([notDue("2026-11-15", "2026-11-21", { paysFrom: "2026-11-18" })]);
  });

  it("D. a new hire with nobody else on their frequency starts their own rhythm on their start date", () => {
    const biz = business({ name: "Eve", frequency: "weekly" }, { name: "Dot", frequency: "biweekly" });
    biz.post("2026-11-14", "2026-11-01", "2026-11-14", ["Dot"]);
    const first = biz.due("Eve", "2026-11-21", { startDate: "2026-11-18" });
    expect(first.basis).toBe("start");
    expect(first.periods).toEqual([notDue("2026-11-18", "2026-11-24")]);
    expect(biz.due("Eve", "2026-11-24", { startDate: "2026-11-18" }).periods).toEqual([line("2026-11-18", "2026-11-24")]);
    biz.post("2026-11-24", "2026-11-18", "2026-11-24", ["Eve"]);
    expect(biz.due("Eve", "2026-12-01", { startDate: "2026-11-18" }).periods).toEqual([line("2026-11-25", "2026-12-01")]);
    // Without a start date: the latest whole period ending on the pay date.
    const fresh = business({ name: "Eve", frequency: "weekly" }, { name: "Mo", frequency: "monthly" }, { name: "Dee", frequency: "semimonthly" });
    expect(fresh.due("Eve", "2026-11-20")).toMatchObject({ basis: "payDate", periods: [line("2026-11-14", "2026-11-20")] });
    expect(fresh.due("Mo", "2026-11-20").periods).toEqual([line("2026-10-01", "2026-10-31")]);
    expect(fresh.due("Mo", "2026-11-30").periods).toEqual([line("2026-11-01", "2026-11-30")]);
    expect(fresh.due("Dee", "2026-11-20").periods).toEqual([line("2026-11-01", "2026-11-15")]);
    expect(fresh.due("Dee", "2026-11-15").periods).toEqual([line("2026-11-01", "2026-11-15")]);
    expect(fresh.due("Dee", "2026-11-14").periods).toEqual([line("2026-10-16", "2026-10-31")]);
  });

  it("E. a rail paycheck that failed last week still covers its days: this week is offered, and its own Retry pays that one", () => {
    const biz = business({ name: "Gus", frequency: "weekly" });
    const first = biz.post("2026-11-07", "2026-11-01", "2026-11-07", ["Gus"], "rail");
    biz.payroll = markPaycheckSettlement(biz.payroll, first, biz.id.Gus!, { status: "settled", reference: "at1first", settledAt: clock.now() });
    const failed = biz.post("2026-11-14", "2026-11-08", "2026-11-14", ["Gus"], "rail");
    biz.payroll = markPaycheckSettlement(biz.payroll, failed, biz.id.Gus!, { status: "failed", failure: "Shield turned the transfer down" });
    expect(biz.due("Gus", "2026-11-21")).toEqual({
      workerId: biz.id.Gus,
      frequency: "weekly",
      paidThrough: "2026-11-14",
      basis: "paid",
      frequencyChanged: false,
      periods: [line("2026-11-15", "2026-11-21")],
      earlier: 0,
      unsettled: [{ runId: failed, payDate: "2026-11-14", periodStart: "2026-11-08", periodEnd: "2026-11-14", status: "failed" }],
    });
    // Moving Owed from back over the failed paycheck's days is refused.
    for (const owedFrom of ["2026-11-08", "2026-11-01", "2026-11-12", "2026-11-14"]) {
      expect(() => biz.due("Gus", "2026-11-21", { owedFrom }), owedFrom).toThrow(PayrollError);
      expect(() => biz.due("Gus", "2026-11-21", { owedFrom }), owedFrom).toThrow(
        "Gus's paycheck for 2026-11-08 to 2026-11-14 (run of 2026-11-14) failed. Retry it from that run in Pay runs: a new paycheck for those days isn't posted while that one can still be paid.",
      );
    }
    // Past those days is fine.
    expect(biz.due("Gus", "2026-11-21", { owedFrom: "2026-11-15" }).periods).toEqual([line("2026-11-15", "2026-11-21")]);
    // To the day: a period that ends on the failed paycheck's first day is refused, whether it is
    // due or offered ahead; one that ends the day before isn't.
    for (const payDate of ["2026-11-08", "2026-11-05"]) {
      expect(() => biz.due("Gus", payDate, { owedFrom: "2026-11-02" }), payDate).toThrow(
        "Gus's paycheck for 2026-11-08 to 2026-11-14 (run of 2026-11-14) failed.",
      );
    }
    expect(biz.due("Gus", "2026-11-07", { owedFrom: "2026-11-01" }).periods).toEqual([line("2026-11-01", "2026-11-07")]);
    expect(biz.due("Gus", "2026-11-05", { owedFrom: "2026-11-01" }).periods).toEqual([notDue("2026-11-01", "2026-11-07")]);
    // Once the Retry is under way again (pending), those days still count as paid.
    biz.payroll = markPaycheckSettlement(biz.payroll, failed, biz.id.Gus!, { status: "pending" });
    const retried = biz.due("Gus", "2026-11-21");
    expect(retried.periods).toEqual([line("2026-11-15", "2026-11-21")]);
    expect(retried.unsettled).toEqual([{ runId: failed, payDate: "2026-11-14", periodStart: "2026-11-08", periodEnd: "2026-11-14", status: "pending" }]);
    // A pending paycheck doesn't refuse Owed from: the overlap is asked about before posting.
    expect(biz.due("Gus", "2026-11-21", { owedFrom: "2026-11-08" }).periods).toEqual([line("2026-11-08", "2026-11-14", { missed: true }), line("2026-11-15", "2026-11-21")]);
  });

  it("E. several paychecks not settled: listed oldest period first, and Owed from names the oldest that failed", () => {
    const biz = business({ name: "Ana", frequency: "weekly" });
    const ana = biz.id.Ana!;
    // Posted out of order on purpose; two share a first day.
    const runs = [
      handRun("run-1", "2026-11-21", "2026-11-15", "2026-11-21", [ana], { status: "failed", failure: "Shield turned the transfer down" }),
      handRun("run-2", "2026-11-14", "2026-11-01", "2026-11-14", [ana], { status: "pending" }),
      handRun("run-3", "2026-10-31", "2026-10-25", "2026-10-31", [ana]),
      handRun("run-4", "2026-11-07", "2026-11-01", "2026-11-07", [ana], { status: "failed", failure: "Shield turned the transfer down" }),
    ];
    const payroll: Payroll = { ...biz.payroll, runs };
    const r = duePeriods(payroll, ana, "2026-11-28");
    expect(r.paidThrough).toBe("2026-11-21");
    expect(r.periods).toEqual([line("2026-11-22", "2026-11-28")]);
    expect(r.unsettled).toEqual([
      { runId: "run-4", payDate: "2026-11-07", periodStart: "2026-11-01", periodEnd: "2026-11-07", status: "failed" },
      { runId: "run-2", payDate: "2026-11-14", periodStart: "2026-11-01", periodEnd: "2026-11-14", status: "pending" },
      { runId: "run-1", payDate: "2026-11-21", periodStart: "2026-11-15", periodEnd: "2026-11-21", status: "failed" },
    ]);
    expect(() => duePeriods(payroll, ana, "2026-11-28", { owedFrom: "2026-10-25" })).toThrow(
      "Ana's paycheck for 2026-11-01 to 2026-11-07 (run of 2026-11-07) failed.",
    );
    expect(() => duePeriods(payroll, ana, "2026-11-28", { owedFrom: "2026-11-08" })).toThrow(
      "Ana's paycheck for 2026-11-15 to 2026-11-21 (run of 2026-11-21) failed.",
    );
  });
});

describe("duePeriods: how far back, what starts unticked, and the next period", () => {
  it("lists the 12 most recent missed periods, counts the earlier ones, and leaves those that ended over 31 days ago unticked", () => {
    const biz = business({ name: "Ana", frequency: "weekly" });
    biz.post("2026-06-06", "2026-05-31", "2026-06-06", ["Ana"]);
    const r = biz.due("Ana", "2026-11-21");
    expect(r.earlier).toBe(12);
    expect(r.earlierFrom).toBe("2026-06-07");
    expect(r.periods).toHaveLength(12);
    expect(r.periods[0]).toEqual(line("2026-08-30", "2026-09-05", { missed: true, longAgo: true, ticked: false }));
    // Oct 11 to 17 ended 35 days before the pay date; Oct 18 to 24, 28 days.
    expect(r.periods.slice(6)).toEqual([
      line("2026-10-11", "2026-10-17", { missed: true, longAgo: true, ticked: false }),
      line("2026-10-18", "2026-10-24", { missed: true }),
      line("2026-10-25", "2026-10-31", { missed: true }),
      line("2026-11-01", "2026-11-07", { missed: true }),
      line("2026-11-08", "2026-11-14", { missed: true }),
      line("2026-11-15", "2026-11-21"),
    ]);
    // Twelve due and no more: nothing earlier.
    const twelve = biz.due("Ana", "2026-08-29");
    expect([twelve.earlier, twelve.earlierFrom, twelve.periods.length, twelve.periods[0]!.periodStart]).toEqual([0, undefined, 12, "2026-06-07"]);
    const thirteen = biz.due("Ana", "2026-09-05");
    expect([thirteen.earlier, thirteen.earlierFrom, thirteen.periods.length, thirteen.periods[0]!.periodStart]).toEqual([1, "2026-06-07", 12, "2026-06-14"]);
  });

  it("starts unticked a period that ended more than 31 days before the pay date, and ticked at 31", () => {
    const biz = business({ name: "Ana", frequency: "weekly" });
    biz.post("2026-10-14", "2026-10-08", "2026-10-14", ["Ana"]);
    expect(biz.due("Ana", "2026-11-21").periods[0]).toEqual(line("2026-10-15", "2026-10-21", { missed: true }));
    expect(biz.due("Ana", "2026-11-22").periods[0]).toEqual(line("2026-10-15", "2026-10-21", { missed: true, longAgo: true, ticked: false }));
  });

  it("offers only the next period, unticked, when nothing is due, and none when something is", () => {
    const biz = business({ name: "Ana", frequency: "weekly" }, { name: "Mo", frequency: "monthly", payType: "salary" });
    biz.post("2026-11-14", "2026-11-08", "2026-11-14", ["Ana"]);
    biz.post("2026-10-31", "2026-10-01", "2026-10-31", ["Mo"]);
    // Paying ahead: on Sunday Nov 15 the week just begun isn't due.
    expect(biz.due("Ana", "2026-11-15").periods).toEqual([notDue("2026-11-15", "2026-11-21")]);
    expect(biz.due("Ana", "2026-11-14").periods).toEqual([notDue("2026-11-15", "2026-11-21")]);
    expect(biz.due("Ana", "2026-11-21").periods).toEqual([line("2026-11-15", "2026-11-21")]);
    expect(biz.due("Mo", "2026-11-29").periods).toEqual([notDue("2026-11-01", "2026-11-30")]);
    expect(biz.due("Mo", "2026-11-30").periods).toEqual([line("2026-11-01", "2026-11-30")]);
    // A pay date before the last one paid: still only what follows it.
    expect(biz.due("Ana", "2026-11-01").periods).toEqual([notDue("2026-11-15", "2026-11-21")]);
  });

  it("continues one period of the new frequency when a revised offer changed it, with no bridge", () => {
    const biz = business({ name: "Ana", frequency: "weekly", payType: "salary", rate: 6_000_000n });
    biz.post("2026-11-21", "2026-11-15", "2026-11-21", ["Ana"]);
    biz.payroll = updateWorker(biz.payroll, biz.id.Ana!, { frequency: "semimonthly" });
    const changed = biz.due("Ana", "2026-11-30", { frequencyChanged: true });
    expect(changed.frequencyChanged).toBe(true);
    expect(changed.periods).toEqual([line("2026-11-22", "2026-11-30")]);
    // Without knowing the frequency changed, a salaried half that starts off the calendar is a bridge.
    expect(biz.due("Ana", "2026-11-30").periods).toEqual([line("2026-11-22", "2026-11-30", { bridge: true, ticked: false })]);
    // Monthly from Nov 22: nine days fold into December.
    biz.payroll = updateWorker(biz.payroll, biz.id.Ana!, { frequency: "monthly" });
    expect(biz.due("Ana", "2026-12-31", { frequencyChanged: true }).periods).toEqual([line("2026-11-22", "2026-12-31", { folded: true })]);
    // Every two weeks, and back to weekly: from the day after, in the new length.
    biz.payroll = updateWorker(biz.payroll, biz.id.Ana!, { frequency: "biweekly" });
    expect(biz.due("Ana", "2026-12-05", { frequencyChanged: true }).periods).toEqual([line("2026-11-22", "2026-12-05")]);
    const half = business({ name: "Dee", frequency: "semimonthly", payType: "salary" });
    half.post("2026-11-30", "2026-11-16", "2026-11-30", ["Dee"]);
    half.payroll = updateWorker(half.payroll, half.id.Dee!, { frequency: "weekly" });
    expect(half.due("Dee", "2026-12-07", { frequencyChanged: true }).periods).toEqual([line("2026-12-01", "2026-12-07")]);
  });

  it("follows Owed from when the business moves it, back over settled days or forward past a week", () => {
    const biz = business({ name: "Ana", frequency: "weekly" }, { name: "Dee", frequency: "semimonthly", payType: "salary" });
    biz.post("2026-11-07", "2026-11-01", "2026-11-07", ["Ana"]);
    const forward = biz.due("Ana", "2026-11-21", { owedFrom: "2026-11-15" });
    expect(forward).toMatchObject({ basis: "owedFrom", paidThrough: "2026-11-07", periods: [line("2026-11-15", "2026-11-21")] });
    // Back over settled days: offered (posting asks about the overlap), weeks following from it.
    expect(biz.due("Ana", "2026-11-21", { owedFrom: "2026-11-04" }).periods).toEqual([line("2026-11-04", "2026-11-10", { missed: true }), line("2026-11-11", "2026-11-17")]);
    // Owed from chosen off the calendar is never a bridge: the business chose the day.
    biz.post("2026-11-15", "2026-11-01", "2026-11-15", ["Dee"]);
    expect(biz.due("Dee", "2026-11-30", { owedFrom: "2026-11-20" }).periods).toEqual([line("2026-11-20", "2026-11-30")]);
  });

  it("offers nothing before Pay starts, and counts pay from it inside its period", () => {
    const biz = business({ name: "Ana", frequency: "weekly" }, { name: "Ben", frequency: "weekly" }, { name: "Eve", frequency: "weekly" });
    biz.post("2026-06-06", "2026-05-31", "2026-06-06", ["Ana"]);
    biz.post("2026-11-14", "2026-11-08", "2026-11-14", ["Ben"]);
    // Back from leave on Wednesday Nov 18: only the week that holds it, from that day.
    expect(biz.due("Ana", "2026-11-21", { floor: "2026-11-18" })).toMatchObject({ earlier: 0, periods: [line("2026-11-15", "2026-11-21", { paysFrom: "2026-11-18" })] });
    // On a period's first day: the whole period.
    expect(biz.due("Ana", "2026-11-21", { floor: "2026-11-15" }).periods).toEqual([line("2026-11-15", "2026-11-21")]);
    // On a period's last day: that period still, for its one day, so the day isn't left behind.
    expect(biz.due("Ana", "2026-11-21", { floor: "2026-11-14" })).toMatchObject({
      earlier: 0,
      periods: [line("2026-11-08", "2026-11-14", { missed: true, paysFrom: "2026-11-14" }), line("2026-11-15", "2026-11-21")],
    });
    // After the pay date: nothing due, the period that holds it offered unticked.
    expect(biz.due("Ana", "2026-11-21", { floor: "2026-11-25" }).periods).toEqual([notDue("2026-11-22", "2026-11-28", { paysFrom: "2026-11-25" })]);
    // Before what was paid: no effect.
    expect(biz.due("Ben", "2026-11-21", { floor: "2026-01-01" }).periods).toEqual([line("2026-11-15", "2026-11-21")]);
    // Never paid: Pay starts places the first period, ahead of the offer's start date.
    expect(biz.due("Eve", "2026-11-21", { startDate: "2026-11-02", floor: "2026-11-18" }).periods).toEqual([line("2026-11-15", "2026-11-21", { paysFrom: "2026-11-18" })]);
    expect(biz.due("Eve", "2026-11-21", { startDate: "2026-11-18", floor: "2026-11-10" }).periods).toEqual([
      line("2026-11-08", "2026-11-14", { missed: true, paysFrom: "2026-11-10" }),
      line("2026-11-15", "2026-11-21"),
    ]);
  });

  it("starts a never-paid person's periods at their start date, however long ago, and ignores it once they've been paid", () => {
    const biz = business({ name: "Ana", frequency: "weekly" }, { name: "Eve", frequency: "weekly" });
    biz.post("2026-11-14", "2026-11-08", "2026-11-14", ["Ana"]);
    const eve = biz.due("Eve", "2026-11-21", { startDate: "2026-10-28" });
    expect(eve.periods).toEqual([
      line("2026-10-25", "2026-10-31", { missed: true, paysFrom: "2026-10-28" }),
      line("2026-11-01", "2026-11-07", { missed: true }),
      line("2026-11-08", "2026-11-14", { missed: true }),
      line("2026-11-15", "2026-11-21"),
    ]);
    expect(biz.due("Ana", "2026-11-21", { startDate: "2026-11-18" }).periods).toEqual([line("2026-11-15", "2026-11-21")]);
  });
});

describe("duePeriods: refused inputs", () => {
  it("refuses a pay date or an option date that isn't a day, as a payroll error naming it", () => {
    const biz = business({ name: "Ana", frequency: "weekly" });
    for (const bad of ["2026-11-31", "11/21/2026", "2026-11-1", "", undefined]) {
      expect(() => biz.due("Ana", bad as string)).toThrow(PayrollError);
      expect(() => biz.due("Ana", bad as string)).toThrow(/pay date/);
    }
    expect(() => biz.due("Ana", "2026-11-21", { owedFrom: "2026-02-30" })).toThrow(/Owed from/);
    expect(() => biz.due("Ana", "2026-11-21", { startDate: "next week" })).toThrow(/start date/);
    expect(() => biz.due("Ana", "2026-11-21", { floor: "2026-13-01" })).toThrow(/Pay starts/);
    expect(() => biz.due("Ana", "2026-11-21", { frequencyChanged: "yes" as unknown as boolean })).toThrow(PayrollError);
  });

  it("refuses a period before the year 100, which the books can't hold, rather than move it to another century", () => {
    const biz = business({ name: "Dee", frequency: "semimonthly" }, { name: "Mo", frequency: "monthly" }, { name: "Eve", frequency: "weekly" });
    for (const name of ["Dee", "Mo", "Eve"]) {
      expect(() => biz.due(name, "0100-01-03"), name).toThrow(PayrollError);
      expect(() => biz.due(name, "0100-01-03"), name).toThrow("Those pay periods run past the dates the books can hold");
    }
    // The year 100 itself is on the calendar like any other.
    expect(biz.due("Dee", "0100-01-20").periods).toEqual([line("0100-01-01", "0100-01-15")]);
    expect(biz.due("Mo", "0100-02-03").periods).toEqual([line("0100-01-01", "0100-01-31")]);
    expect(periodFrom("monthly", "0100-12-20")).toEqual({ periodStart: "0100-12-20", periodEnd: "0101-01-31", folded: true });
  });

  it("refuses someone it doesn't know, and a frequency it doesn't know, as payroll errors", () => {
    const biz = business({ name: "Ana", frequency: "weekly" });
    expect(() => duePeriods(biz.payroll, "wkr-99", "2026-11-21")).toThrow(/Team member not found/);
    const odd: Payroll = { ...biz.payroll, workers: biz.payroll.workers.map((w) => ({ ...w, frequency: "fortnightly" as PayFrequency })) };
    expect(() => duePeriods(odd, biz.id.Ana!, "2026-11-21")).toThrow(PayrollError);
    expect(() => duePeriods(odd, biz.id.Ana!, "2026-11-21")).toThrow(/pay frequency/);
  });

  it("refuses a history whose period ends before it starts or isn't a date, rather than guess where pay stops", () => {
    const base = business({ name: "Ana", frequency: "weekly" }, { name: "Eve", frequency: "weekly" });
    const corrupt = (start: string, end: string): Payroll => ({
      ...base.payroll,
      runs: [handRun("run-1", "2026-11-14", start, end, [base.id.Ana!])],
    });
    expect(() => duePeriods(corrupt("2026-11-14", "2026-11-08"), base.id.Ana!, "2026-11-21")).toThrow(/ends before it starts/);
    expect(() => duePeriods(corrupt("2026-11-08", "2026-11-31"), base.id.Ana!, "2026-11-21")).toThrow(PayrollError);
    // A teammate's unreadable run is part of the rhythm a new hire would join: refused too.
    expect(() => duePeriods(corrupt("2026-11-08", "later"), base.id.Eve!, "2026-11-21")).toThrow(PayrollError);
  });

  it("never offers a day already paid, whatever overlapping periods the history holds", () => {
    // Overlapping windows, nested ones, one ending in the future: the next period starts after all of them.
    const runs = [
      handRun("run-1", "2026-11-07", "2026-10-25", "2026-11-07", ["wkr-1"]),
      handRun("run-2", "2026-11-14", "2026-11-01", "2026-11-14", ["wkr-1"]),
      handRun("run-3", "2026-11-14", "2026-11-03", "2026-11-05", ["wkr-1"]),
      handRun("run-4", "2026-11-14", "2026-11-10", "2026-11-25", ["wkr-1"], { status: "pending" }),
    ];
    const biz = business({ name: "Ana", frequency: "weekly" });
    const payroll: Payroll = { ...biz.payroll, runs };
    const r = duePeriods(payroll, biz.id.Ana!, "2026-11-21");
    expect(r.paidThrough).toBe("2026-11-25");
    expect(r.periods).toEqual([notDue("2026-11-26", "2026-12-02")]);
  });
});

describe("duePeriods: paying what it offers, payday after payday", () => {
  it("never pays a day twice, keeps every period within its frequency's length, and follows the calendar where it should", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...FREQUENCIES),
        fc.constantFrom<"hourly" | "salary">("hourly", "salary"),
        fc.integer({ min: 0, max: 400 }),
        fc.option(fc.integer({ min: 0, max: 400 }), { nil: undefined }),
        fc.array(fc.record({ gap: fc.integer({ min: 0, max: 70 }), payAll: fc.boolean(), skip: fc.boolean() }), { minLength: 1, maxLength: 14 }),
        (frequency, payType, startOffset, historyOffset, paydays) => {
          const biz = business({ name: "Ana", frequency, payType });
          let payroll = biz.payroll;
          const id = biz.id.Ana!;
          // Some books start with an odd old period (the old two-week default), some with none.
          if (historyOffset !== undefined) {
            const end = plus("2026-01-01", historyOffset);
            payroll = { ...payroll, runs: [handRun("run-1", end, plus(end, -13), end, [id])] };
          }
          const startDate = plus("2026-01-01", startOffset);
          let payDate = plus(startDate, 0);
          const paid: { periodStart: string; periodEnd: string }[] = payroll.runs.map((r) => r);
          for (const day of paydays) {
            payDate = plus(payDate, day.gap);
            const r = duePeriods(payroll, id, payDate, { startDate });
            const through = paidThrough(payroll, id);
            expect(r.periods.length).toBeGreaterThan(0);
            expect(r.periods.length).toBeLessThanOrEqual(12);
            r.periods.forEach((p, i) => {
              expect(length(p)).toBeLessThanOrEqual(LONGEST_PERIOD_DAYS[frequency]);
              if (through !== undefined) expect(p.periodStart > through).toBe(true);
              if (i > 0) expect(p.periodStart).toBe(plus(r.periods[i - 1]!.periodEnd, 1));
              if (i > 0 && frequency === "semimonthly") expect(["01", "16"]).toContain(p.periodStart.slice(8));
              if (i > 0 && frequency === "monthly") expect(p.periodStart.slice(8)).toBe("01");
              expect(p.due).toBe(p.periodEnd <= payDate);
              if (!p.due) expect(p.ticked).toBe(false);
              expect(p.missed).toBe(p.due && i < r.periods.length - 1);
            });
            if (r.periods.some((p) => !p.due)) expect(r.periods).toHaveLength(1);
            if (day.skip) continue;
            // Pay what's ticked (or every due line), each period its own run.
            for (const p of r.periods.filter((x) => (day.payAll ? x.due : x.ticked))) {
              for (const q of paid) expect(p.periodEnd < q.periodStart || q.periodEnd < p.periodStart, `${p.periodStart} ${q.periodStart}`).toBe(true);
              paid.push(p);
              payroll = { ...payroll, runs: [...payroll.runs, handRun(`run-${payroll.runs.length + 1}`, payDate, p.periodStart, p.periodEnd, [id])] };
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
