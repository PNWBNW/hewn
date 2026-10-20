import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { type Books, applyTemplate, createBooks, verifyChain } from "@pnw/ledger";
import {
  type Payroll,
  type W4,
  addWorker,
  emptyPayroll,
  markPaycheckSettlement,
  postPayRun,
  withheld,
  yearToDate,
} from "./payroll";
import { PAYSTUB_DOMAIN, canonicalPaystub, paystubDocument, paystubHash } from "./paystub";
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
    lines: [{ workerId: ana.worker.id }, { workerId: ben.worker.id, hours: 80.25 }],
  };
  return { books, payroll, bankId, ana: ana.worker, ben: ben.worker, input };
}

describe("paystub document", () => {
  it("carries the whole paycheck in plain fields, with year-to-date after this check", () => {
    const s = setup();
    const first = postPayRun(s.books, s.payroll, { ...s.input, payDate: "2026-10-02" }, clock);
    const second = postPayRun(first.books, first.payroll, s.input, clock);
    const run = second.run;
    const ben = run.paychecks[1]!;
    const doc = paystubDocument(run, ben, s.ben, second.books.settings, yearToDate(second.payroll, s.ben.id, run.payDate, run.id));
    const earlier = first.run.paychecks[1]!;
    expect(doc).toEqual({
      version: 1,
      businessName: "Day Construction",
      workerId: s.ben.id,
      workerName: "Ben",
      payDate: "2026-10-16",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-14",
      payType: "hourly",
      rate: 2550n,
      hours: 80.25,
      gross: ben.gross,
      federalIncomeTax: ben.federalIncomeTax,
      socialSecurity: ben.socialSecurity,
      medicare: ben.medicare,
      additionalMedicare: ben.additionalMedicare,
      employerSocialSecurity: ben.employerSocialSecurity,
      employerMedicare: ben.employerMedicare,
      net: ben.net,
      ytdGross: earlier.gross + ben.gross,
      ytdWithheld: withheld(earlier) + withheld(ben),
      runId: "run-2",
      position: 2,
    });
    // What was committed at posting is exactly what rebuilding from the vault gives.
    expect(paystubHash(doc)).toBe(ben.paystubHash);
    expect(ben.paystubHash).toMatch(/^[0-9a-f]{64}$/);
    // Salaried: no hours, position 1.
    const ana = run.paychecks[0]!;
    const anaDoc = paystubDocument(run, ana, s.ana, second.books.settings, yearToDate(second.payroll, s.ana.id, run.payDate, run.id));
    expect(anaDoc).toMatchObject({ payType: "salary", rate: 5_200_000n, position: 1 });
    expect("hours" in anaDoc).toBe(false);
    expect(() => paystubDocument(run, ana, s.ben, second.books.settings, { gross: 0n, withheld: 0n })).toThrow(/isn't in this run/);
  });

  it("hashes deterministically: same inputs, same hash; one cent off, a different hash", () => {
    const s = setup();
    const a = postPayRun(s.books, s.payroll, s.input, clock);
    const b = postPayRun(s.books, s.payroll, s.input, clock);
    expect(a.run.paychecks.map((p) => p.paystubHash)).toEqual(b.run.paychecks.map((p) => p.paystubHash));
    const ytd = { gross: 0n, withheld: 0n };
    const ben = a.run.paychecks[1]!;
    const doc = paystubDocument(a.run, ben, s.ben, s.books.settings, ytd);
    expect(paystubHash(doc)).toBe(paystubHash({ ...doc }));
    expect(paystubHash({ ...doc, gross: doc.gross + 1n })).not.toBe(paystubHash(doc));
    expect(paystubHash({ ...doc, net: doc.net - 1n })).not.toBe(paystubHash(doc));
    expect(paystubHash({ ...doc, workerName: "Benjamin" })).not.toBe(paystubHash(doc));
    expect(paystubHash({ ...doc, position: 1 })).not.toBe(paystubHash(doc));
  });

  it("is BLAKE3 over the domain, a zero byte and canonical JSON with fixed keys and string amounts", () => {
    const s = setup();
    const { run } = postPayRun(s.books, s.payroll, s.input, clock);
    const doc = paystubDocument(run, run.paychecks[0]!, s.ana, s.books.settings, { gross: 0n, withheld: 0n });
    const canonical = canonicalPaystub(doc);
    expect(canonical.startsWith('{"version":1,"businessName":"Day Construction","workerId":"wkr-1","workerName":"Ana",')).toBe(true);
    expect(canonical).toContain('"rate":"5200000"');
    expect(canonical).toContain('"hours":null');
    expect(canonical.endsWith('"runId":"run-1","position":1}')).toBe(true);
    expect(Object.keys(JSON.parse(canonical))).toEqual(Object.keys(JSON.parse(canonicalPaystub({ ...doc, hours: 1 }))));
    const domain = utf8ToBytes(PAYSTUB_DOMAIN);
    const body = utf8ToBytes(canonical);
    const input = new Uint8Array([...domain, 0, ...body]);
    expect(paystubHash(doc)).toBe(bytesToHex(blake3(input)));
    expect(paystubHash(doc)).not.toBe(bytesToHex(blake3(body)));
  });
});

describe("paystub document, overtime", () => {
  it("carries the overtime hours and rate last, only when there are any, so older paystubs keep their hash", () => {
    const s = setup();
    const posted = postPayRun(s.books, s.payroll, { ...s.input, lines: [{ workerId: s.ben.id, hours: 80, overtime: { hours: 3, rate: 1.5 } }] }, clock);
    const ben = posted.run.paychecks[0]!;
    const doc = paystubDocument(posted.run, ben, s.ben, posted.books.settings, yearToDate(posted.payroll, s.ben.id, posted.run.payDate, posted.run.id));
    expect(doc).toMatchObject({ hours: 80, overtimeHours: 3, overtimeRate: 1.5 });
    expect(paystubHash(doc)).toBe(ben.paystubHash);
    const keys = Object.keys(JSON.parse(canonicalPaystub(doc)));
    expect(keys.slice(-4)).toEqual(["runId", "position", "overtimeHours", "overtimeRate"]);
    // Without overtime the document has no such keys at all: the bytes from before.
    const { overtimeHours: _h, overtimeRate: _r, ...plain } = doc;
    expect(Object.keys(JSON.parse(canonicalPaystub(plain))).at(-1)).toBe("position");
    expect(canonicalPaystub(plain)).not.toContain("overtime");
  });
});

describe("settlement on pay runs", () => {
  it("an external run is settled as it posts, with the reference on every paycheck", () => {
    const s = setup();
    const { run, entries, books } = postPayRun(s.books, s.payroll, { ...s.input, reference: "  ACH batch 4471 " }, clock);
    expect(run.mode).toBe("external");
    for (const p of run.paychecks) {
      expect(p.settlement).toEqual({ status: "settled", settledAt: "2026-10-16T12:00:00.000Z", reference: "ACH batch 4471" });
    }
    expect(entries.map((e) => e.source.doc)).toEqual(run.paychecks.map((p) => p.paystubHash));
    expect(verifyChain(books)).toEqual({ ok: true });
    // No reference given, or a blank one: none recorded.
    const plain = postPayRun(s.books, s.payroll, { ...s.input, reference: "  " }, clock).run;
    expect(plain.paychecks[0]!.settlement).toEqual({ status: "settled", settledAt: "2026-10-16T12:00:00.000Z" });
  });

  it("a rail run posts pending with no reference", () => {
    const s = setup();
    const { run } = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail" }, clock);
    expect(run.mode).toBe("rail");
    for (const p of run.paychecks) expect(p.settlement).toEqual({ status: "pending" });
    expect(() => postPayRun(s.books, s.payroll, { ...s.input, mode: "rail", reference: "x" })).toThrow(/outside the app/);
    expect(() => postPayRun(s.books, s.payroll, { ...s.input, mode: "later" as "rail" })).toThrow(/how this run is paid/);
    expect(() => postPayRun(s.books, s.payroll, { ...s.input, reference: 7 as unknown as string })).toThrow(/must be text/);
  });

  it("marks paychecks pending → settled or failed, and failed → pending for a retry", () => {
    const s = setup();
    const { run, payroll, books } = postPayRun(s.books, s.payroll, { ...s.input, mode: "rail" }, clock);
    const settled = markPaycheckSettlement(payroll, run.id, s.ana.id, { status: "settled", reference: "at1abc", height: 4_210_000, settledAt: "2026-10-16T12:05:00.000Z" });
    expect(settled.runs[0]!.paychecks[0]!.settlement).toEqual({ status: "settled", reference: "at1abc", height: 4_210_000, settledAt: "2026-10-16T12:05:00.000Z" });
    expect(settled.runs[0]!.paychecks[1]!.settlement).toEqual({ status: "pending" });
    expect(payroll.runs[0]!.paychecks[0]!.settlement).toEqual({ status: "pending" }); // input untouched
    // The paystub and the books don't change when the payment lands: the entry was posted first.
    expect(settled.runs[0]!.paychecks[0]!.paystubHash).toBe(run.paychecks[0]!.paystubHash);
    expect(verifyChain(books)).toEqual({ ok: true });

    const failed = markPaycheckSettlement(payroll, run.id, s.ben.id, { status: "failed", failure: "not enough balance" });
    expect(failed.runs[0]!.paychecks[1]!.settlement).toEqual({ status: "failed", failure: "not enough balance" });
    const retry = markPaycheckSettlement(failed, run.id, s.ben.id, { status: "pending" });
    expect(retry.runs[0]!.paychecks[1]!.settlement).toEqual({ status: "pending" });

    expect(() => markPaycheckSettlement(settled, run.id, s.ana.id, { status: "pending" })).toThrow(/settled paycheck can't become pending/);
    expect(() => markPaycheckSettlement(settled, run.id, s.ana.id, { status: "failed" })).toThrow(/can't become/);
    expect(() => markPaycheckSettlement(failed, run.id, s.ben.id, { status: "settled" })).toThrow(/failed paycheck can't become settled/);
    expect(() => markPaycheckSettlement(payroll, run.id, s.ana.id, { status: "pending" })).toThrow(/can't become/);
    expect(() => markPaycheckSettlement(payroll, "run-9", s.ana.id, { status: "settled" })).toThrow(/not found/);
    expect(() => markPaycheckSettlement(payroll, run.id, "wkr-9", { status: "settled" })).toThrow(/isn't in this pay run/);
    expect(() => markPaycheckSettlement(payroll, run.id, s.ana.id, { status: "done" as "settled" })).toThrow(/Unknown payment status/);
    expect(() => markPaycheckSettlement(payroll, run.id, s.ana.id, { status: "settled", height: 1.5 })).toThrow(/whole number/);
    // An external run was settled at posting, so nothing can move it.
    const ext = postPayRun(s.books, s.payroll, s.input, clock);
    expect(() => markPaycheckSettlement(ext.payroll, ext.run.id, s.ana.id, { status: "failed" })).toThrow(/settled paycheck/);
  });

  it("year to date now includes total withholding", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll, { ...s.input, payDate: "2026-10-02" }, clock);
    const ytd = yearToDate(r.payroll, s.ana.id, "2026-10-16");
    expect(ytd.withheld).toBe(withheld(r.run.paychecks[0]!));
    expect(ytd.gross).toBe(r.run.paychecks[0]!.gross);
    // Rebuilding that run's own paystub stops before it, even on its own day.
    expect(yearToDate(r.payroll, s.ana.id, "2026-10-02", r.run.id).withheld).toBe(0n);
    expect(yearToDate(r.payroll, s.ana.id, "2026-10-01").withheld).toBe(0n);
  });
});

describe("payroll files", () => {
  it("round-trip runs with settlement and paystub hashes exactly", () => {
    const s = setup();
    const ext = postPayRun(s.books, s.payroll, { ...s.input, reference: "ACH 1" }, clock);
    const rail = postPayRun(ext.books, ext.payroll, { ...s.input, payDate: "2026-10-30", mode: "rail" }, clock);
    const marked = markPaycheckSettlement(rail.payroll, rail.run.id, s.ana.id, { status: "settled", reference: "at1x", height: 12 });
    expect(payrollFromJson(payrollToJson(marked))).toEqual(marked);
  });

  it("still open runs saved before settlement existed, as external and settled with no reference", () => {
    const s = setup();
    const { payroll } = postPayRun(s.books, s.payroll, s.input, clock);
    // Strip the new fields the way an older save never had them.
    const legacy = JSON.parse(payrollToJson(payroll));
    for (const run of legacy.payroll.runs) {
      delete run.mode;
      for (const p of run.paychecks) {
        delete p.settlement;
        delete p.paystubHash;
      }
    }
    const loaded = payrollFromJson(JSON.stringify(legacy));
    expect(loaded.runs[0]!.mode).toBe("external");
    for (const p of loaded.runs[0]!.paychecks) {
      expect(p.settlement).toEqual({ status: "settled" });
      expect(p.paystubHash).toBeUndefined();
    }
    const { runs: _r, ...rest } = loaded;
    const { runs: _r2, ...expected } = payroll;
    expect(rest).toEqual(expected);
    expect(loaded.runs[0]!.paychecks.map((p) => p.gross)).toEqual(payroll.runs[0]!.paychecks.map((p) => p.gross));
    // A legacy run can't be re-marked: it's already settled.
    expect(() => markPaycheckSettlement(loaded, "run-1", s.ana.id, { status: "pending" })).toThrow(/settled paycheck/);
  });
});
