import { describe, expect, it } from "vitest";
import { addAccount, applyTemplate, balanceSheet, cashFlow, createBooks, displayBalance, postEntry, profitAndLoss, systemAccount, trialBalance } from "@pnw/ledger";
import { addCustomer, arAging, createInvoice, emptySales, invoiceBalance, sendInvoice } from "@pnw/sales";
import { addMonths, compareDate, compareRange, presetRange, rangeLabel } from "./dates";
import {
  AGING_COLUMNS,
  agingLines,
  balanceSheetLines,
  cashFlowLines,
  formatMargin,
  isEmptyReport,
  profitAndLossLines,
  projectSummaryLines,
  reportCsv,
  salesTaxLines,
  trialBalanceLines,
} from "./lines";

describe("report dates", () => {
  it("builds the presets around today and the fiscal year", () => {
    expect(presetRange("this_month", "2026-10-13", 1)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("last_month", "2026-03-13", 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetRange("last_month", "2026-01-05", 1)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("this_quarter", "2026-10-13", 1)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(presetRange("year_to_date", "2026-10-13", 1)).toEqual({ from: "2026-01-01", to: "2026-10-13" });
    expect(presetRange("last_year", "2026-10-13", 1)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    // Fiscal year from July: Q2 is Oct–Dec, and the year runs Jul–Jun.
    expect(presetRange("this_quarter", "2026-11-02", 7)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(presetRange("this_quarter", "2026-02-02", 2)).toEqual({ from: "2026-02-01", to: "2026-04-30" });
    expect(presetRange("year_to_date", "2026-03-01", 7)).toEqual({ from: "2025-07-01", to: "2026-03-01" });
    expect(presetRange("last_year", "2026-03-01", 7)).toEqual({ from: "2024-07-01", to: "2025-06-30" });
  });

  it("finds the comparison period", () => {
    expect(compareRange({ from: "2026-10-01", to: "2026-10-31" }, "previous_period")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(compareRange({ from: "2026-01-01", to: "2026-03-31" }, "previous_period")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(compareRange({ from: "2026-10-05", to: "2026-10-14" }, "previous_period")).toEqual({ from: "2026-09-25", to: "2026-10-04" });
    expect(compareRange({ from: "2026-01-01", to: "2026-10-13" }, "previous_year")).toEqual({ from: "2025-01-01", to: "2025-10-13" });
    expect(compareRange({ from: "2028-02-01", to: "2028-02-29" }, "previous_year")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(compareRange({ from: "2026-10-01", to: "2026-10-31" }, "none")).toBeUndefined();
    expect(compareDate("2026-10-13", "previous_period")).toBe("2026-09-30");
    expect(compareDate("2026-03-31", "previous_year")).toBe("2025-03-31");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-30", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("labels columns briefly", () => {
    expect(rangeLabel({ from: "2026-10-01", to: "2026-10-31" })).toBe("Oct 2026");
    expect(rangeLabel({ from: "2026-01-01", to: "2026-03-31" })).toBe("Jan – Mar 2026");
    expect(rangeLabel({ from: "2025-07-01", to: "2026-06-30" })).toBe("Jul 2025 – Jun 2026");
    expect(rangeLabel({ from: "2026-01-01", to: "2026-10-13" })).toBe("Jan 1, 2026 – Oct 13, 2026");
  });
});

function sample() {
  let books = applyTemplate(createBooks({ businessName: "T", fiscalYearStartMonth: 1 }), "service");
  books = addAccount(books, { name: "=HYPERLINK(\"x\")", type: "expense" }).books;
  const id = (name: string) => books.accounts.find((a) => a.name === name)!.id;
  const post = (date: string, dr: string, cr: string, cents: bigint) => {
    books = postEntry(books, { date, lines: [{ accountId: id(dr), debit: cents }, { accountId: id(cr), credit: cents }] }).books;
  };
  post("2026-10-01", "Checking", "Owner's Investment", 1_000_000n);
  post("2026-10-02", "Checking", "Service Income", 250_000n);
  post("2026-10-03", "Wages", "Checking", 120_000n);
  post("2026-10-04", "=HYPERLINK(\"x\")", "Business Credit Card", 1_050n);
  return books;
}

describe("statement lines", () => {
  const books = sample();

  it("lays out the P&L with sub-account totals and net income", () => {
    const lines = profitAndLossLines(profitAndLoss(books, { from: "2026-10-01", to: "2026-10-31" }));
    const pick = (label: string) => lines.find((l) => l.label === label);
    expect(pick("Income")).toMatchObject({ kind: "heading", amounts: null });
    expect(pick("4000 Service Income")).toMatchObject({ kind: "account", depth: 1, amounts: [250_000n] });
    expect(pick("6500 Payroll Expenses")).toMatchObject({ amounts: [0n], blankZero: true });
    expect(pick("6510 Wages")).toMatchObject({ depth: 2, amounts: [120_000n] });
    expect(pick("Total 6500 Payroll Expenses")).toMatchObject({ kind: "subtotal", depth: 1, amounts: [120_000n] });
    expect(pick("Total expenses")).toMatchObject({ kind: "total", amounts: [121_050n] });
    expect(lines.at(-1)).toMatchObject({ kind: "grand", label: "Net income", amounts: [128_950n] });
    // No cost of goods sold or other items in this sample, so those sections stay out.
    expect(pick("Gross profit")).toBeUndefined();
    expect(pick("Net other income")).toBeUndefined();
  });

  it("lays out the balance sheet down to account groups, ending in the balancing total", () => {
    const bs = balanceSheet(books, "2026-10-31");
    const lines = balanceSheetLines(bs);
    expect(lines.map((l) => l.label).slice(0, 4)).toEqual(["Assets", "Current assets", "Bank accounts", "1000 Checking"]);
    expect(lines.find((l) => l.label === "Total assets")).toMatchObject({ kind: "grand", amounts: [1_130_000n] });
    expect(lines.at(-1)).toMatchObject({ label: "Total liabilities and equity", amounts: [1_130_000n] });
  });

  it("lays out the cash flow from net income down to the cash on hand", () => {
    const lines = cashFlowLines(cashFlow(books, { from: "2026-10-01", to: "2026-10-31" }));
    expect(lines.map((l) => l.label)).toEqual([
      "Operating activities",
      "Net income",
      "Adjustments to reconcile net income to net cash",
      "2100 Business Credit Card",
      "Total adjustments",
      "Net cash from operating activities",
      "Financing activities",
      "3000 Owner's Investment",
      "Net cash from financing activities",
      "Net change in cash",
      "Cash at start of period",
      "Cash at end of period",
    ]);
    const pick = (label: string) => lines.find((l) => l.label === label);
    expect(pick("Net income")).toMatchObject({ kind: "account", depth: 1, amounts: [128_950n] });
    expect(pick("2100 Business Credit Card")).toMatchObject({ depth: 2, amounts: [1_050n] });
    expect(pick("Net cash from operating activities")).toMatchObject({ kind: "total", amounts: [130_000n] });
    expect(pick("Net cash from financing activities")).toMatchObject({ amounts: [1_000_000n] });
    expect(pick("Net change in cash")).toMatchObject({ kind: "grand", amounts: [1_130_000n] });
    expect(pick("Cash at start of period")).toMatchObject({ amounts: [0n] });
    expect(lines.at(-1)).toMatchObject({ kind: "grand", label: "Cash at end of period", amounts: [1_130_000n] });
  });

  it("lays out an aging by party with a column per bucket, and its total is the open invoices and the A/R account", () => {
    let books = applyTemplate(createBooks({ businessName: "T", fiscalYearStartMonth: 1 }), "service");
    let sales = emptySales();
    const income = books.accounts.find((a) => a.name === "Service Income")!.id;
    const acme = addCustomer(sales, { name: "Acme", terms: "net_30" });
    sales = acme.sales;
    const zed = addCustomer(sales, { name: "Zed Co", terms: "net_15" });
    sales = zed.sales;
    const issue = (customerId: string, date: string, cents: bigint) => {
      const c = createInvoice(books, sales, { customerId, date, lines: [{ description: "Work", quantity: "1", unitPrice: cents, accountId: income }] });
      const sent = sendInvoice(books, c.sales, c.invoice.id);
      books = sent.books;
      sales = sent.sales;
    };
    issue(zed.customer.id, "2026-10-01", 50_000n); // due Oct 16: 15 days past due on Oct 31
    issue(acme.customer.id, "2026-07-01", 20_000n); // due Jul 31: 92 days past due
    issue(acme.customer.id, "2026-10-20", 10_000n); // due Nov 19: current

    const asOf = "2026-10-31";
    const aging = arAging(sales, asOf);
    const lines = agingLines(aging, new Map(sales.customers.map((c) => [c.id, c.name])));
    expect(AGING_COLUMNS).toEqual(["Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days", "Total"]);
    expect(lines.map((l) => l.label)).toEqual(["Acme", "Zed Co", "Total"]);
    expect(lines[0]).toMatchObject({ kind: "account", amounts: [10_000n, 0n, 0n, 0n, 20_000n, 30_000n], blankZero: true });
    expect(lines[1]).toMatchObject({ amounts: [0n, 50_000n, 0n, 0n, 0n, 50_000n] });
    expect(lines.at(-1)).toMatchObject({ kind: "grand", label: "Total", amounts: [10_000n, 50_000n, 0n, 0n, 20_000n, 80_000n] });

    // The criterion: the report agrees with the open-invoice list and with the books.
    const openList = sales.invoices.reduce((t, i) => t + invoiceBalance(sales, i, asOf), 0n);
    expect(lines.at(-1)!.amounts!.at(-1)).toBe(openList);
    expect(lines.at(-1)!.amounts!.at(-1)).toBe(displayBalance(books, systemAccount(books, "accounts_receivable").id, asOf));
  });

  it("writes a CSV a spreadsheet opens safely", () => {
    const report = {
      title: "Profit and loss",
      subtitle: "Oct 2026",
      columns: ["Oct 2026"],
      lines: profitAndLossLines(profitAndLoss(books, { from: "2026-10-01", to: "2026-10-31" })),
    };
    const csv = reportCsv(report, "Day, Inc.");
    const rows = csv.split("\r\n");
    expect(rows.slice(0, 5)).toEqual(["Profit and loss", '"Day, Inc."', "Oct 2026", "", "Account,Oct 2026"]);
    expect(rows).toContain('"  4000 Service Income",2500.00');
    expect(rows).toContain('"  6500 Payroll Expenses",'); // zero own amount left blank
    expect(rows).toContain("Net income,1289.50");
    // A formula-looking account name is quoted and defused.
    expect(rows).toContain(`"'  =HYPERLINK(""x"")",10.50`);
  });

  it("lists the trial balance in the order given, with blank zero columns", () => {
    const chart = [...books.accounts].reverse();
    const lines = trialBalanceLines(chart, trialBalance(books, "2026-10-31"));
    expect(lines.at(-1)).toMatchObject({ label: "Total", amounts: [1_251_050n, 1_251_050n] });
    expect(lines[0]!.label).toBe("=HYPERLINK(\"x\")");
    expect(lines.find((l) => l.label === "1000 Checking")).toMatchObject({ amounts: [1_130_000n, 0n], blankZero: true });
  });

  it("knows when a report has nothing to show", () => {
    const empty = createBooks({ businessName: "T", fiscalYearStartMonth: 1 });
    const lines = profitAndLossLines(profitAndLoss(empty, { from: "2026-10-01", to: "2026-10-31" }));
    expect(isEmptyReport({ title: "", subtitle: "", columns: [""], lines })).toBe(true);
    expect(isEmptyReport({ title: "", subtitle: "", columns: [""], lines: balanceSheetLines(balanceSheet(books, "2026-10-31")) })).toBe(false);
  });
});

describe("project and sales tax lines", () => {
  it("formats margins to a tenth of a percent", () => {
    expect(formatMargin(3764)).toBe("37.6%");
    expect(formatMargin(3765)).toBe("37.7%");
    expect(formatMargin(-1250)).toBe("-12.5%");
    expect(formatMargin(0)).toBe("0.0%");
    expect(formatMargin(null)).toBe("n/a");
  });

  it("summarises projects with costs = job costs + expenses", () => {
    const row = { tagId: "proj-1", income: 600_000n, costOfGoodsSold: 245_000n, expenses: 129_180n, profit: 225_820n, marginBp: 3764 };
    const lines = projectSummaryLines({ rows: [row], total: { ...row, tagId: "" } }, new Map([["proj-1", "Kitchen"]]));
    expect(lines.map((l) => [l.label, l.amounts])).toEqual([
      ["Kitchen · 37.6% margin", [600_000n, 374_180n, 225_820n]],
      ["All projects · 37.6% margin", [600_000n, 374_180n, 225_820n]],
    ]);
  });

  it("lays out the sales tax liability so it adds down to what's owed", () => {
    const lines = salesTaxLines(
      {
        from: "2026-10-01",
        to: "2026-10-31",
        opening: 8_250n,
        invoices: [
          { invoiceId: "inv-2", number: "INV-0002", customerId: "cust-1", date: "2026-10-02", totalSales: 0n, taxableSales: 0n, tax: 10_313n, void: false },
          { invoiceId: "inv-3", number: "INV-0003", customerId: "cust-1", date: "2026-10-20", totalSales: 0n, taxableSales: 0n, tax: 2_000n, void: true },
        ],
        collected: 12_313n,
        totalSales: 0n,
        taxableSales: 0n,
        voided: 2_000n,
        payments: [{ entryId: "je-9", date: "2026-10-12", amount: 8_250n, memo: "Sales tax payment" }],
        paid: 8_250n,
        adjustments: 0n,
        owed: 10_313n,
      },
      new Map([["cust-1", "Acme Co"]]),
    );
    const leaves = lines.filter((l) => l.kind === "account");
    expect(leaves.reduce((t, l) => t + l.amounts![0]!, 0n)).toBe(10_313n);
    expect(lines.at(-1)).toMatchObject({ kind: "grand", label: "Owed at the end", amounts: [10_313n] });
    expect(lines.map((l) => l.label)).toContain("INV-0003 · Acme Co · 2026-10-20 (void)");
  });
});
