import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Books,
  addAccount,
  applyTemplate,
  balanceOf,
  closeThrough,
  createBooks,
  systemAccount,
  trialBalance,
  verifyChain,
} from "@pnw/ledger";
import { computePayrollTax } from "@pnw/tax-engine/tax-engine";
import {
  type Payroll,
  type W4,
  type WorkerInput,
  addWorker,
  checkDoublePay,
  computePaycheck,
  emptyPayroll,
  ensurePayrollAccounts,
  grossFor,
  liabilitiesByQuarter,
  postPayRun,
  previewPayRun,
  recordTaxPayment,
  updateWorker,
  withheld,
  employerTaxes,
} from "./payroll";
import { payrollFromJson, payrollToJson } from "./serialize";

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };

function setup(template: "service" | "blank" = "service") {
  let books: Books = createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 });
  if (template !== "blank") books = applyTemplate(books, template);
  else books = addAccount(books, { name: "Checking", type: "bank" }).books;
  const bankId = books.accounts.find((a) => a.name === "Checking")!.id;
  let payroll: Payroll = emptyPayroll();
  const add = (w: Partial<WorkerInput> & { name: string }) => {
    const r = addWorker(payroll, { payType: "hourly", rate: 2500n, frequency: "biweekly", w4: W4_SINGLE, ...w });
    payroll = r.payroll;
    return r.worker;
  };
  const ana = add({ name: "Ana", payType: "salary", rate: 5_200_000n }); // $52,000/yr
  const ben = add({ name: "Ben", rate: 2550n }); // $25.50/hr
  const cy = add({
    name: "Cy",
    rate: 3000n,
    w4: { ...W4_SINGLE, filingStatus: "married_filing_jointly", dependentCredit: 400_000n, extraWithholding: 2500n },
  });
  return { books, payroll: () => payroll, bankId, ana, ben, cy };
}

const run = (s: ReturnType<typeof setup>, date = "2026-10-16") => ({
  payDate: date,
  periodStart: "2026-10-01",
  periodEnd: "2026-10-14",
  bankAccountId: s.bankId,
  lines: [{ workerId: s.ana.id }, { workerId: s.ben.id, hours: 80.25 }, { workerId: s.cy.id, hours: 72 }],
});

describe("gross pay", () => {
  it("salary is annual ÷ pay periods, to the cent", () => {
    const { ana } = setup();
    expect(grossFor(ana)).toBe(200_000n); // 52,000 / 26
  });

  it("hourly is rate × hours, rounded half-up", () => {
    const { ben } = setup();
    expect(grossFor(ben, 40.25)).toBe(102_638n); // 25.50 × 40.25 = 1,026.375 → 1,026.38
    expect(() => grossFor(ben)).toThrow(/Enter hours/);
    expect(() => grossFor(ben, -1)).toThrow(/Enter hours/);
  });

  it("pays overtime hours at the rate times the multiplier, rounded once", () => {
    const { ana, ben } = setup();
    // 40 h at 25.50 plus 2.5 h at 1.5 × 25.50 = 1,020 + 95.625 → 1,115.63
    expect(grossFor(ben, 40, { hours: 2.5, rate: 1.5 })).toBe(111_563n);
    expect(grossFor(ben, 40, { hours: 1, rate: 2 })).toBe(107_100n); // double time
    // No overtime, or none worth a cent of an hour, is the same as plain hours.
    expect(grossFor(ben, 40.25, { hours: 0, rate: 1.5 })).toBe(grossFor(ben, 40.25));
    expect(grossFor(ben, 40.25, undefined)).toBe(102_638n);
    // Salaried pay has no overtime part.
    expect(grossFor(ana, undefined, { hours: 5, rate: 1.5 })).toBe(200_000n);
    expect(() => grossFor(ben, 40, { hours: -1, rate: 1.5 })).toThrow(/zero or more/);
    expect(() => grossFor(ben, 40, { hours: 1, rate: 0.5 })).toThrow(/from 1 to 3/);
    expect(() => grossFor(ben, 40, { hours: 1, rate: 1.555 })).toThrow(/from 1 to 3/);
  });

  it("carries the overtime on the paycheck, and in a run", () => {
    const s = setup();
    const drafts = previewPayRun(s.payroll(), { ...run(s), lines: [{ workerId: s.ben.id, hours: 80, overtime: { hours: 3, rate: 1.5 } }, { workerId: s.cy.id, hours: 72 }] });
    expect(drafts[0]).toMatchObject({ hours: 80, overtimeHours: 3, overtimeRate: 1.5, gross: 215_475n }); // 2,040 + 114.75
    expect(drafts[1]).not.toHaveProperty("overtimeHours");
    const posted = postPayRun(s.books, s.payroll(), { ...run(s), lines: [{ workerId: s.ben.id, hours: 80, overtime: { hours: 3, rate: 1.5 } }] });
    expect(posted.run.paychecks[0]).toMatchObject({ overtimeHours: 3, overtimeRate: 1.5, gross: 215_475n });
    expect(payrollFromJson(payrollToJson(posted.payroll)).runs[0]!.paychecks[0]).toMatchObject({ overtimeHours: 3, overtimeRate: 1.5 });
    // The double-pay guard compares the whole gross, overtime included.
    expect(checkDoublePay(posted.payroll, { payDate: run(s).payDate, lines: [{ workerId: s.ben.id, hours: 80, overtime: { hours: 3, rate: 1.5 } }] }).blocked).toHaveLength(1);
    expect(checkDoublePay(posted.payroll, { payDate: run(s).payDate, lines: [{ workerId: s.ben.id, hours: 80 }] }).blocked).toHaveLength(0);
  });
});

describe("paychecks", () => {
  it("withholding matches the tax engine exactly, in cents", () => {
    const { ana } = setup();
    const p = computePaycheck(ana, 200_000n, { gross: 0n, socialSecurity: 0n });
    const t = computePayrollTax({ gross: 2000, filingStatus: "single", payPeriod: "biweekly" });
    expect(p.federalIncomeTax).toBe(BigInt(Math.round(t.federalIncomeTax * 100)));
    expect(p.socialSecurity).toBe(12_400n); // 6.2%
    expect(p.medicare).toBe(2_900n); // 1.45%
    expect(p.net).toBe(p.gross - withheld(p));
  });

  it("the employer matches Social Security and Medicare", () => {
    const { ana } = setup();
    const p = computePaycheck(ana, 200_000n, { gross: 0n, socialSecurity: 0n });
    expect(p.employerSocialSecurity).toBe(12_400n);
    expect(p.employerMedicare).toBe(2_900n);
  });

  it("stops Social Security at the wage base, for both sides", () => {
    const { ana } = setup();
    // $184,000 already paid; base is $184,500, so only $500 of this $1,000 is subject.
    const p = computePaycheck(ana, 100_000n, { gross: 18_400_000n, socialSecurity: 1_140_800n });
    expect(p.socialSecurity).toBe(3_100n);
    expect(p.employerSocialSecurity).toBe(3_100n);
  });

  it("withholds Additional Medicare above $200k, which the employer doesn't match", () => {
    const { ana } = setup();
    const p = computePaycheck(ana, 1_000_000n, { gross: 19_500_000n, socialSecurity: 0n });
    expect(p.additionalMedicare).toBe(4_500n); // 0.9% of the $5,000 over $200,000
    expect(p.employerMedicare).toBe(14_500n); // 1.45% only
  });

  it("refuses a paycheck where withholding exceeds gross", () => {
    const { ana } = setup();
    const greedy = { ...ana, w4: { ...W4_SINGLE, extraWithholding: 300_000n } };
    expect(() => computePaycheck(greedy, 200_000n, { gross: 0n, socialSecurity: 0n })).toThrow(/more than their gross/);
  });
});

describe("pay runs", () => {
  it("a 3-person run posts three balanced entries, one per paycheck, linked to the run", () => {
    const s = setup();
    const { books, payroll, run: posted, entries } = postPayRun(s.books, s.payroll(), run(s));
    expect(entries).toHaveLength(3);
    expect(posted.entryIds).toEqual(entries.map((e) => e.id));
    for (const [i, e] of entries.entries()) {
      expect(e.source).toEqual({ kind: "payroll", ref: posted.id, doc: posted.paychecks[i]!.paystubHash });
      const dr = e.lines.reduce((a, l) => a + l.debit, 0n);
      const cr = e.lines.reduce((a, l) => a + l.credit, 0n);
      expect(dr).toBe(cr);
      expect(e.lines.every((l) => l.name?.kind === "employee")).toBe(true);
    }
    expect(payroll.runs).toHaveLength(1);
    expect(verifyChain(books)).toEqual({ ok: true });
    const tb = trialBalance(books, "2026-10-31");
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("a tagged paycheck puts the project on its wage and employer-tax lines only", () => {
    const s = setup();
    const input = run(s);
    const tagged = { ...input, lines: input.lines.map((l, i) => (i === 1 ? { ...l, tags: { project: "proj-1", class: "" } } : l)) };
    const clock = { now: () => "2026-10-16T12:00:00.000Z" };
    const plain = postPayRun(s.books, s.payroll(), input, clock);
    const r = postPayRun(s.books, s.payroll(), tagged, clock);
    // Same amounts either way; only Ben's wage and employer-tax lines gain the tag.
    expect(r.run.paychecks.map(({ tags: _t, ...p }) => p)).toEqual(plain.run.paychecks);
    expect(r.run.paychecks[1]!.tags).toEqual({ project: "proj-1" });
    const wages = r.entries[1]!.lines.filter((l) => l.tags);
    expect(wages.map((l) => l.debit)).toEqual([r.run.paychecks[1]!.gross, employerTaxes(r.run.paychecks[1]!)]);
    expect(wages.every((l) => l.tags?.project === "proj-1")).toBe(true);
    expect(r.entries[1]!.lines.filter((l) => l.credit > 0n).some((l) => l.tags)).toBe(false);
    expect(r.entries[0]!.lines.some((l) => l.tags)).toBe(false);
    // Untagged runs hash exactly as before.
    expect(plain.entries.map((e) => e.lines.some((l) => "tags" in l))).toEqual([false, false, false]);
  });

  it("wages land in expense, withholding + employer taxes in Payroll Liabilities, net out of the bank", () => {
    const s = setup();
    const { books, run: posted } = postPayRun(s.books, s.payroll(), run(s));
    const { accounts } = ensurePayrollAccounts(books);
    const sum = (f: (p: (typeof posted.paychecks)[number]) => bigint) => posted.paychecks.reduce((a, p) => a + f(p), 0n);
    expect(balanceOf(books, accounts.wagesId)).toBe(sum((p) => p.gross));
    expect(balanceOf(books, accounts.employerTaxesId)).toBe(sum(employerTaxes));
    expect(-balanceOf(books, accounts.liabilitiesId)).toBe(sum((p) => withheld(p) + employerTaxes(p)));
    expect(-balanceOf(books, s.bankId)).toBe(sum((p) => p.net));
  });

  it("uses the template's Wages accounts, and creates them on a blank chart", () => {
    const s = setup("service");
    const before = s.books.accounts.length;
    expect(ensurePayrollAccounts(s.books).books.accounts).toHaveLength(before);
    const blank = setup("blank");
    const { books } = ensurePayrollAccounts(blank.books);
    expect(books.accounts.map((a) => a.name)).toEqual(expect.arrayContaining(["Wages", "Employer Payroll Taxes"]));
  });

  it("year-to-date carries across runs, so Social Security caps correctly over the year", () => {
    const s = setup();
    let payroll = updateWorker(s.payroll(), s.ana.id, { rate: 48_100_000n, frequency: "monthly" }); // $481k/yr ⇒ $40,083.33/mo
    let books = s.books;
    const ssPaid: bigint[] = [];
    const erPaid: bigint[] = [];
    for (let m = 1; m <= 6; m++) {
      const d = `2026-${String(m).padStart(2, "0")}-28`;
      const r = postPayRun(books, payroll, { payDate: d, periodStart: d, periodEnd: d, bankAccountId: s.bankId, lines: [{ workerId: s.ana.id }] });
      books = r.books;
      payroll = r.payroll;
      ssPaid.push(r.run.paychecks[0]!.socialSecurity);
      erPaid.push(r.run.paychecks[0]!.employerSocialSecurity);
    }
    // Exactly 6.2% of the $184,500 wage base for the year, on both sides; per-check rounding
    // would otherwise drift a cent over (found by this test).
    expect(ssPaid.reduce((a, b) => a + b, 0n)).toBe(1_143_900n);
    expect(erPaid.reduce((a, b) => a + b, 0n)).toBe(1_143_900n);
    expect(ssPaid.at(-1)).toBe(0n);
  });

  it("is refused whole in a closed month: nothing posts", () => {
    const s = setup();
    const closed = closeThrough(s.books, "2026-10");
    expect(() => postPayRun(closed, s.payroll(), run(s))).toThrow(expect.objectContaining({ code: "PERIOD_CLOSED" }));
    expect(closed.entries).toHaveLength(0);
  });

  it("rejects inactive or duplicate people, missing hours, a non-bank account and backwards periods", () => {
    const s = setup();
    const inactive = updateWorker(s.payroll(), s.ben.id, { active: false });
    expect(() => previewPayRun(inactive, run(s))).toThrow(/inactive/);
    expect(() => previewPayRun(s.payroll(), { ...run(s), lines: [{ workerId: s.ana.id }, { workerId: s.ana.id }] })).toThrow(/twice/);
    expect(() => previewPayRun(s.payroll(), { ...run(s), lines: [{ workerId: s.ben.id }] })).toThrow(/Enter hours/);
    expect(() => previewPayRun(s.payroll(), { ...run(s), lines: [] })).toThrow(/at least one/);
    const ar = systemAccount(s.books, "accounts_receivable").id;
    expect(() => postPayRun(s.books, s.payroll(), { ...run(s), bankAccountId: ar })).toThrow(/bank account/);
    expect(() => postPayRun(s.books, s.payroll(), { ...run(s), periodStart: "2026-10-15" })).toThrow(/ends before/);
  });
});

describe("withholding owed", () => {
  it("adds up by quarter and clears when paid to the IRS", () => {
    const s = setup();
    const r = postPayRun(s.books, s.payroll(), run(s));
    const [q] = liabilitiesByQuarter(r.payroll);
    const liabilities = systemAccount(r.books, "payroll_liabilities").id;
    expect(q!.quarter).toBe("2026-Q4");
    expect(q!.total).toBe(-balanceOf(r.books, liabilities));
    expect(q!.total).toBe(q!.federalIncomeTax + q!.employeeFica + q!.employerFica);
    const paid = recordTaxPayment(r.books, { date: "2026-10-20", amount: q!.total, bankAccountId: s.bankId });
    expect(balanceOf(paid.books, liabilities)).toBe(0n);
    expect(paid.entry.source.kind).toBe("tax_payment");
    expect(() => recordTaxPayment(r.books, { date: "2026-10-20", amount: 0n, bankAccountId: s.bankId })).toThrow(/amount/);
  });
});

describe("team", () => {
  it("validates names, rates and W-4 amounts", () => {
    const base: WorkerInput = { name: "X", payType: "hourly", rate: 1n, frequency: "weekly", w4: W4_SINGLE };
    expect(() => addWorker(emptyPayroll(), { ...base, name: " " })).toThrow(/name/);
    expect(() => addWorker(emptyPayroll(), { ...base, rate: 0n })).toThrow(/rate/);
    expect(() => addWorker(emptyPayroll(), { ...base, w4: { ...W4_SINGLE, extraWithholding: -1n } })).toThrow(/negative/);
  });
});

describe("serialization", () => {
  it("round-trips payroll exactly", () => {
    const s = setup();
    const { payroll } = postPayRun(s.books, s.payroll(), run(s));
    expect(payrollFromJson(payrollToJson(payroll))).toEqual(payroll);
    expect(() => payrollFromJson('{"format":"x"}')).toThrow();
  });
});

describe("invariants (property-based)", () => {
  it("any team and hours give balanced entries and non-negative net pay", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            hourly: fc.boolean(),
            rate: fc.bigInt({ min: 725n, max: 20_000n }), // $7.25–$200/hr
            salary: fc.bigInt({ min: 1_500_000n, max: 50_000_000n }), // $15k–$500k/yr
            hours: fc.integer({ min: 0, max: 16_000 }).map((h) => h / 100),
            status: fc.constantFrom("single", "married_filing_jointly", "head_of_household") as fc.Arbitrary<W4["filingStatus"]>,
            frequency: fc.constantFrom("weekly", "biweekly", "semimonthly", "monthly") as fc.Arbitrary<WorkerInput["frequency"]>,
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (team) => {
          const s = setup("blank");
          let payroll = emptyPayroll();
          const lines = team.map((t, i) => {
            const r = addWorker(payroll, {
              name: `W${i}`,
              payType: t.hourly ? "hourly" : "salary",
              rate: t.hourly ? t.rate : t.salary,
              frequency: t.frequency,
              w4: { ...W4_SINGLE, filingStatus: t.status },
            });
            payroll = r.payroll;
            return { workerId: r.worker.id, ...(t.hourly ? { hours: t.hours } : {}) };
          });
          const out = postPayRun(s.books, payroll, { payDate: "2026-10-16", periodStart: "2026-10-01", periodEnd: "2026-10-14", bankAccountId: s.bankId, lines });
          for (const p of out.run.paychecks) expect(p.net >= 0n).toBe(true);
          const tb = trialBalance(out.books, "2026-10-31");
          expect(tb.totalDebit).toBe(tb.totalCredit);
        },
      ),
      { numRuns: 200 },
    );
  });
});
