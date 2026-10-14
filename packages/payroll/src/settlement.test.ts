// The pieces the pay queue leans on: the fee on a settlement, the in-flight
// reference, the double-pay check, the rail account, and year-to-date across
// two runs posted the same day.
import { describe, expect, it } from "vitest";
import { type Books, addAccount, applyTemplate, createBooks } from "@pnw/ledger";
import {
  type Payroll,
  type W4,
  RAIL_ACCOUNT_NAME,
  addWorker,
  checkDoublePay,
  emptyPayroll,
  ensureRailAccount,
  markPaycheckSettlement,
  postPayRun,
  withheld,
  yearToDate,
} from "./payroll";
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
});

describe("checkDoublePay", () => {
  it("is clean when nobody has been paid that day", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, { ...s.input, payDate: "2026-10-02" }, clock);
    expect(checkDoublePay(r.payroll, s.input)).toEqual({ blocked: [], sameDay: [] });
    expect(checkDoublePay(s.payroll, s.input)).toEqual({ blocked: [], sameDay: [] });
  });

  it("blocks an exact repeat (same person, date, gross) that is settled or pending", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, s.input, clock);
    expect(checkDoublePay(r.payroll, s.input)).toEqual({
      blocked: [
        { workerId: s.ana.id, runId: "run-1" },
        { workerId: s.ben.id, runId: "run-1" },
      ],
      sameDay: [],
    });
    const pending = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail" }, clock);
    expect(checkDoublePay(pending.payroll, s.input).blocked).toHaveLength(2);
  });

  it("asks (same day) when the amount differs, the earlier payment failed, or hours are missing", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, s.input, clock);
    // Ben with different hours: different gross → a question, not a block. Ana unchanged → blocked.
    expect(checkDoublePay(r.payroll, { ...s.input, lines: [{ workerId: s.ana.id }, { workerId: s.ben.id, hours: 10 }] })).toEqual({
      blocked: [{ workerId: s.ana.id, runId: "run-1" }],
      sameDay: [{ workerId: s.ben.id, runId: "run-1" }],
    });
    // A failed rail payment doesn't block a re-run.
    const rail = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail" }, clock);
    const failed = markPaycheckSettlement(rail.payroll, rail.run.id, s.ana.id, { status: "failed", failure: "rejected" });
    expect(checkDoublePay(failed, { ...s.input, lines: [{ workerId: s.ana.id }] })).toEqual({ blocked: [], sameDay: [{ workerId: s.ana.id, runId: "run-1" }] });
    // Hours not entered yet: nothing to compare, so same day only.
    expect(checkDoublePay(r.payroll, { ...s.input, lines: [{ workerId: s.ben.id }] })).toEqual({ blocked: [], sameDay: [{ workerId: s.ben.id, runId: "run-1" }] });
    // Unknown people are skipped here (previewPayRun refuses them).
    expect(checkDoublePay(r.payroll, { ...s.input, lines: [{ workerId: "wkr-99" }] })).toEqual({ blocked: [], sameDay: [] });
  });
});

describe("year to date on the same day", () => {
  it("a second run on the same day counts the first, and each paystub rebuilds to its own hash", () => {
    const s = setup();
    const first = postPayRun(s.books, s.payroll, s.input, clock);
    const second = postPayRun(first.books, first.payroll, { ...s.input, lines: [{ workerId: s.ben.id, hours: 10 }] }, clock);
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
    // A user's own "rail balance" account, any case, is reused rather than duplicated.
    const own = addAccount(books, { name: "rail Balance", type: "bank" });
    expect(ensureRailAccount(own.books).accountId).toBe(own.account.id);
    // A non-bank account with the name doesn't count.
    const wrong = addAccount(books, { name: RAIL_ACCOUNT_NAME, type: "expense" });
    expect(() => ensureRailAccount(wrong.books)).toThrow(/already exists/);
  });
});
