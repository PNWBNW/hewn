// A paycheck with nothing to pay. On the rail, a paycheck whose net pay is zero has no transfer to
// wait for, so it is settled as it posts, with no payment id; every other rail paycheck still waits
// for its own transfer. `awaitsPayment` says which paychecks still have money to move.
import { describe, expect, it } from "vitest";
import { type Books, applyTemplate, createBooks } from "@pnw/ledger";
import { type Paycheck, type Payroll, type W4, addWorker, awaitsPayment, emptyPayroll, ensureRailAccount, markPaycheckSettlement, postPayRun, previewPayRun, yearToDate } from "./payroll";
import { paystubDocument, paystubHash } from "./paystub";
import { payrollFromJson, payrollToJson } from "./serialize";

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const clock = { now: () => "2026-10-16T12:00:00.000Z" };
const WEEK = { payDate: "2026-10-16", periodStart: "2026-10-10", periodEnd: "2026-10-16" };

function setup() {
  let books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
  const rail = ensureRailAccount(books);
  books = rail.books;
  const checkingId = books.accounts.find((a) => a.name === "Checking")!.id;
  let payroll: Payroll = emptyPayroll();
  const add = (name: string, w4: W4 = W4_SINGLE) => {
    const r = addWorker(payroll, { name, payType: "hourly", rate: 3000n, frequency: "weekly", w4 });
    payroll = r.payroll;
    return r.worker;
  };
  const ana = add("Ana");
  const cy = add("Cy");
  return { books, payroll: () => payroll, railId: rail.accountId, checkingId, ana, cy, add };
}

describe("a rail paycheck with nothing to pay", () => {
  it("settles as it posts, with no payment id, and posts no entry when it has no gross either", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll(), { ...WEEK, bankAccountId: s.railId, mode: "rail", lines: [{ workerId: s.cy.id, hours: 0 }, { workerId: s.ana.id, hours: 40 }] }, clock);
    const [cy, ana] = r.run.paychecks as [Paycheck, Paycheck];
    expect([cy.gross, cy.net]).toEqual([0n, 0n]);
    expect(cy.settlement).toEqual({ status: "settled", settledAt: clock.now() });
    expect(ana.settlement).toEqual({ status: "pending" });
    // Only Ana's paycheck has an entry, and it commits to her paystub.
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.source).toEqual({ kind: "payroll", ref: r.run.id, doc: ana.paystubHash });
    // The paystub doesn't carry the payment's state: Cy's hash is the one its document gives.
    const doc = paystubDocument(r.run, cy, s.cy, s.books.settings, yearToDate(s.payroll(), s.cy.id, WEEK.payDate));
    expect(cy.paystubHash).toBe(paystubHash(doc));
    expect(r.run.paychecks.filter(awaitsPayment).map((p) => p.workerId)).toEqual([s.ana.id]);
  });

  it("settles as it posts when withholding takes all of its gross, and still posts its entry, with nothing from the Shield account", () => {
    const s = setup();
    // Extra withholding equal to what would have been paid leaves a net of zero.
    const plain = previewPayRun(s.payroll(), { ...WEEK, bankAccountId: s.railId, lines: [{ workerId: s.ana.id, hours: 10 }] })[0]!;
    const dee = s.add("Dee", { ...W4_SINGLE, extraWithholding: plain.net });
    const r = postPayRun(s.books, s.payroll(), { ...WEEK, bankAccountId: s.railId, mode: "rail", lines: [{ workerId: dee.id, hours: 10 }] }, clock);
    const p = r.run.paychecks[0]!;
    expect(p.gross).toBe(plain.gross);
    expect(p.net).toBe(0n);
    expect(p.settlement).toEqual({ status: "settled", settledAt: clock.now() });
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.source.doc).toBe(p.paystubHash);
    expect(r.entries[0]!.lines.some((l) => l.accountId === s.railId)).toBe(false);
  });

  it("leaves every rail paycheck with something to pay pending, so each waits for its transfer", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll(), { ...WEEK, bankAccountId: s.railId, mode: "rail", lines: [{ workerId: s.ana.id, hours: 40 }, { workerId: s.cy.id, hours: 0.01 }] }, clock);
    expect(r.run.paychecks.map((p) => [p.net > 0n, p.settlement])).toEqual([
      [true, { status: "pending" }],
      [true, { status: "pending" }],
    ]);
  });

  it("changes nothing for a run paid outside the app: every paycheck settles as it posts, with the reference", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll(), { ...WEEK, bankAccountId: s.checkingId, reference: "BATCH-7", lines: [{ workerId: s.cy.id, hours: 0 }, { workerId: s.ana.id, hours: 40 }] }, clock);
    expect(r.run.paychecks.map((p) => p.settlement)).toEqual([
      { status: "settled", settledAt: clock.now(), reference: "BATCH-7" },
      { status: "settled", settledAt: clock.now(), reference: "BATCH-7" },
    ]);
  });

  it("refuses to move it afterwards: a settled paycheck never changes", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll(), { ...WEEK, bankAccountId: s.railId, mode: "rail", lines: [{ workerId: s.cy.id, hours: 0 }] }, clock);
    expect(() => markPaycheckSettlement(r.payroll, r.run.id, s.cy.id, { status: "pending" })).toThrow(/settled paycheck can't become pending/);
    expect(() => markPaycheckSettlement(r.payroll, r.run.id, s.cy.id, { status: "failed", failure: "rejected" })).toThrow(/settled paycheck can't become failed/);
    expect(() => markPaycheckSettlement(r.payroll, r.run.id, s.cy.id, { status: "settled", reference: "at1x" })).toThrow(/settled paycheck can't become settled/);
  });

  it("opens as it was saved when an older build posted it pending: it isn't rewritten, and nothing waits on it", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll(), { ...WEEK, bankAccountId: s.railId, mode: "rail", lines: [{ workerId: s.cy.id, hours: 0 }, { workerId: s.ana.id, hours: 40 }] }, clock);
    const older: Payroll = { ...r.payroll, runs: r.payroll.runs.map((run) => ({ ...run, paychecks: run.paychecks.map((p) => ({ ...p, settlement: { status: "pending" as const } })) })) };
    const back = payrollFromJson(payrollToJson(older));
    expect(back).toEqual(older);
    expect(back.runs[0]!.paychecks[0]!.settlement).toEqual({ status: "pending" });
    expect(back.runs[0]!.paychecks.filter(awaitsPayment).map((p) => p.workerId)).toEqual([s.ana.id]);
  });
});

describe("awaitsPayment", () => {
  const p = (net: bigint, settlement: Paycheck["settlement"]) => ({ net, settlement });

  it("is true while a paycheck with something to pay isn't settled: sent or not, or failed", () => {
    expect(awaitsPayment(p(100n, { status: "pending" }))).toBe(true);
    expect(awaitsPayment(p(100n, { status: "pending", reference: "shield_1" }))).toBe(true);
    expect(awaitsPayment(p(1n, { status: "failed", failure: "rejected" }))).toBe(true);
  });

  it("is false once it settled, and for a paycheck with nothing to pay in any state", () => {
    expect(awaitsPayment(p(100n, { status: "settled", reference: "at1x" }))).toBe(false);
    expect(awaitsPayment(p(0n, { status: "settled" }))).toBe(false);
    expect(awaitsPayment(p(0n, { status: "pending" }))).toBe(false);
    expect(awaitsPayment(p(0n, { status: "failed" }))).toBe(false);
  });
});
