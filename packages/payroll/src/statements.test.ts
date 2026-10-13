// Phase 2 exit criterion, fiat mode: "P&L for the period shows the wage expense;
// balance sheet shows the tax liability". Runs a real pay run and reads both statements.
import { describe, expect, it } from "vitest";
import {
  type Books,
  type StatementRow,
  applyTemplate,
  balanceSheet,
  createBooks,
  postEntry,
  profitAndLoss,
  systemAccount,
} from "@pnw/ledger";
import { type W4, addWorker, emptyPayroll, employerTaxes, postPayRun, recordTaxPayment, withheld } from "./payroll";

const W4_SINGLE: W4 = { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n };
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
const flat = (rows: StatementRow[]): StatementRow[] => rows.flatMap((r) => [r, ...flat(r.children)]);

function company() {
  let books: Books = applyTemplate(createBooks({ businessName: "Day Construction", fiscalYearStartMonth: 1 }), "service");
  const id = (name: string) => books.accounts.find((a) => a.name === name)!.id;
  books = postEntry(books, {
    date: "2026-10-01",
    lines: [
      { accountId: id("Checking"), debit: 2_500_000n },
      { accountId: id("Owner's Investment"), credit: 2_500_000n },
    ],
  }).books;
  let payroll = emptyPayroll();
  const add = (name: string, extra: Partial<Parameters<typeof addWorker>[1]>) => {
    const r = addWorker(payroll, { name, payType: "hourly", rate: 2500n, frequency: "biweekly", w4: W4_SINGLE, ...extra });
    payroll = r.payroll;
    return r.worker.id;
  };
  const lines = [
    { workerId: add("Ana", { payType: "salary", rate: 5_200_000n }) },
    { workerId: add("Ben", { rate: 2550n }), hours: 80.25 },
    {
      workerId: add("Cy", { rate: 3000n, w4: { ...W4_SINGLE, filingStatus: "married_filing_jointly", dependentCredit: 400_000n, extraWithholding: 2500n } }),
      hours: 72,
    },
  ];
  const posted = postPayRun(books, payroll, {
    payDate: "2026-10-16",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-14",
    bankAccountId: id("Checking"),
    lines,
  });
  return { ...posted, id };
}

describe("payroll on the financial statements", () => {
  it("P&L for the period shows the wage expense; balance sheet shows the tax liability", () => {
    const { books, run, id } = company();
    const gross = sum(run.paychecks.map((p) => p.gross));
    const taxes = sum(run.paychecks.map(employerTaxes));
    const owed = sum(run.paychecks.map((p) => withheld(p) + employerTaxes(p)));
    expect(gross).toBe(620_638n); // the 3-person run from the payroll browser check

    const pl = profitAndLoss(books, { from: "2026-10-01", to: "2026-10-31" });
    const payrollExpenses = pl.expenses.rows.find((r) => r.name === "Payroll Expenses")!;
    expect(payrollExpenses.children.find((c) => c.accountId === id("Wages"))?.total).toEqual([gross]);
    expect(payrollExpenses.children.find((c) => c.accountId === id("Employer Payroll Taxes"))?.total).toEqual([taxes]);
    expect(payrollExpenses.total).toEqual([gross + taxes]);
    expect(pl.netIncome).toEqual([-(gross + taxes)]);

    const bs = balanceSheet(books, "2026-10-31");
    const current = bs.liabilities.groups.find((g) => g.id === "current_liabilities")!;
    const other = current.groups.find((g) => g.id === "other_current_liabilities")!;
    const liabilities = flat(other.rows).find((r) => r.accountId === systemAccount(books, "payroll_liabilities").id);
    expect(liabilities?.total).toEqual([owed]);
    expect(bs.assets.total).toEqual(bs.liabilitiesAndEquity);
    expect(bs.netIncome).toEqual(pl.netIncome);
    // Cash went down by net pay only; the rest is still owed to the IRS.
    expect(bs.assets.total).toEqual([2_500_000n - (gross - sum(run.paychecks.map(withheld)))]);
  });

  it("paying the IRS clears the liability without touching the P&L", () => {
    const { books, run, id } = company();
    const owed = sum(run.paychecks.map((p) => withheld(p) + employerTaxes(p)));
    const paid = recordTaxPayment(books, { date: "2026-10-20", amount: owed, bankAccountId: id("Checking") }).books;
    const bs = balanceSheet(paid, "2026-10-31", "2026-10-16");
    expect(bs.liabilities.total).toEqual([0n, owed]);
    expect(bs.assets.total).toEqual(bs.liabilitiesAndEquity);
    expect(profitAndLoss(paid, { from: "2026-10-01", to: "2026-10-31" }).netIncome).toEqual(
      profitAndLoss(books, { from: "2026-10-01", to: "2026-10-31" }).netIncome,
    );
  });
});
