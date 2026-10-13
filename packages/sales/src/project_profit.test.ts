// Phase 3 exit criterion: project profitability for a job with labour (a
// payroll run, Phase 2), materials (a bill) and an invoice, all tagged to
// the project. Lives here because the ledger may not depend on sales or
// payroll; payroll is a test-only dependency of this package.
import { type Books, addProject, emptyDimensions, profitAndLossForTag, profitByTag, systemAccount, trialBalance } from "@pnw/ledger";
import { type Payroll, addWorker, emptyPayroll, employerTaxes, postPayRun } from "@pnw/payroll";
import { describe, expect, it } from "vitest";
import { type Sales, createInvoice, enterBill, invoiceTotals, sendInvoice } from "./sales";
import { clock, contractor, invLine } from "./test_helpers";

const OCT = { from: "2026-10-01", to: "2026-10-31" };

describe("project profitability (exit criterion)", () => {
  it("shows the job's income, materials and labour; profit = income − materials − labour incl. employer taxes", () => {
    const s = contractor();
    let books: Books = s.books;
    let sales: Sales = s.sales;
    let dims = addProject(emptyDimensions(), { name: "Kitchen remodel", customerId: s.acme.id }).dims;
    const other = addProject(dims, { name: "Garage" });
    dims = other.dims;
    const job = { project: "proj-1" };

    // Labour: one hourly person, 40 h at $30 on the job, plus 8 h on the garage.
    let payroll: Payroll = emptyPayroll();
    const w = addWorker(payroll, {
      name: "Ana",
      payType: "hourly",
      rate: 3000n,
      frequency: "weekly",
      w4: { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n },
    });
    payroll = w.payroll;
    const run = postPayRun(books, payroll, {
      payDate: "2026-10-09",
      periodStart: "2026-10-03",
      periodEnd: "2026-10-09",
      bankAccountId: s.bank,
      lines: [{ workerId: w.worker.id, hours: 40, tags: job }],
    });
    books = run.books;
    payroll = run.payroll;
    const garage = postPayRun(books, payroll, {
      payDate: "2026-10-16",
      periodStart: "2026-10-10",
      periodEnd: "2026-10-16",
      bankAccountId: s.bank,
      lines: [{ workerId: w.worker.id, hours: 8, tags: { project: other.project.id } }],
    });
    books = garage.books;
    const paycheck = run.run.paychecks[0]!;
    const labour = paycheck.gross + employerTaxes(paycheck);
    expect(paycheck.gross).toBe(120_000n);
    expect(employerTaxes(paycheck)).toBe(9_180n); // 6.2% + 1.45% of 1,200.00

    // Materials: a lumber bill, one line on the job and one for the shop.
    const bill = enterBill(books, sales, {
      vendorId: s.lumber.id,
      date: "2026-10-05",
      lines: [
        { description: "Cabinets and lumber", accountId: s.materials, amount: 245_000n, tags: job },
        { description: "Shop stock", accountId: s.materials, amount: 12_000n },
      ],
    }, clock);
    ({ books, sales } = bill);

    // Invoice: taxable work on the job (the tax is a liability, not job income) and an untagged line.
    const inv = createInvoice(books, sales, {
      customerId: s.acme.id,
      date: "2026-10-20",
      taxRateBp: 825,
      lines: [
        invLine(s.income, "1", 600_000n, { description: "Kitchen", taxable: true, tags: job }),
        invLine(s.income, "2", 15_000n, { description: "Unrelated repair" }),
      ],
    });
    const sent = sendInvoice(books, inv.sales, inv.invoice.id, clock);
    ({ books, sales } = sent);
    expect(invoiceTotals(inv.invoice).tax).toBe(49_500n);

    // The job's P&L.
    const pl = profitAndLossForTag(books, "project", "proj-1", OCT);
    expect(pl.income.total).toEqual([600_000n]);
    expect(pl.costOfGoodsSold.total).toEqual([245_000n]);
    expect(pl.expenses.total).toEqual([labour]);
    const wages = pl.expenses.rows.flatMap((r) => [r, ...r.children]).find((r) => r.name === "Wages")!;
    expect(wages.own).toEqual([120_000n]);
    expect(pl.netIncome).toEqual([600_000n - 245_000n - labour]);

    // The all-projects summary agrees, and keeps the garage's labour separate.
    const summary = profitByTag(books, "project", OCT, dims.projects.map((p) => p.id));
    const kitchen = summary.rows.find((r) => r.tagId === "proj-1")!;
    expect(kitchen).toEqual({
      tagId: "proj-1",
      income: 600_000n,
      costOfGoodsSold: 245_000n,
      expenses: 129_180n,
      profit: 225_820n,
      marginBp: 3764, // 2,258.20 / 6,000.00 = 37.64%
    });
    const g = summary.rows.find((r) => r.tagId === "proj-2")!;
    expect(g.expenses).toBe(garage.run.paychecks[0]!.gross + employerTaxes(garage.run.paychecks[0]!));
    expect(summary.total.profit).toBe(kitchen.profit + g.profit);

    // The books themselves still balance, tags or not.
    const tb = trialBalance(books, "2026-10-31");
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(systemAccount(books, "sales_tax_payable")).toBeTruthy();
  });
});
