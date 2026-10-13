import { type Books, balanceOf, closeThrough, postEntry, reverseEntry } from "@pnw/ledger";
import { describe, expect, it } from "vitest";
import { type Sales, createInvoice, invoiceTotals, salesTaxCollected, sendInvoice, voidInvoice } from "./sales";
import { recordSalesTaxPayment, salesTaxOwed, salesTaxReport } from "./salestax";
import { clock, contractor, invLine } from "./test_helpers";

/** Sends invoices for the tax tests: amounts in cents, all taxable at the given rate. */
function books3() {
  const s = contractor();
  let books: Books = s.books;
  let sales: Sales = s.sales;
  const send = (date: string, lines: ReturnType<typeof invLine>[], taxRateBp: number) => {
    const c = createInvoice(books, sales, { customerId: s.acme.id, date, lines, taxRateBp });
    const r = sendInvoice(books, c.sales, c.invoice.id, clock);
    books = r.books;
    sales = r.sales;
    return r.sales.invoices.find((i) => i.id === c.invoice.id)!;
  };
  // September: one invoice. October: three (one voided in October), one untaxed.
  const sep = send("2026-09-20", [invLine(s.income, "1", 100_000n, { taxable: true })], 825);
  const oct1 = send("2026-10-02", [invLine(s.income, "10", 12_500n, { taxable: true }), invLine(s.income, "1", 4_000n)], 825);
  const oct2 = send("2026-10-09", [invLine(s.income, "3", 3_333n, { taxable: true })], 650);
  const oct3 = send("2026-10-15", [invLine(s.income, "1", 50_000n)], 825);
  const oct4 = send("2026-10-20", [invLine(s.income, "2", 10_000n, { taxable: true })], 1000);
  ({ books, sales } = voidInvoice(books, sales, oct4.id, { date: "2026-10-25" }, clock));
  return { s, books: () => books, sales: () => sales, setBooks: (b: Books) => (books = b), sep, oct1, oct2, oct3, oct4 };
}

describe("sales tax payments", () => {
  it("post Dr Sales Tax Payable, Cr bank", () => {
    const t = books3();
    const before = salesTaxOwed(t.books());
    const r = recordSalesTaxPayment(t.books(), { date: "2026-10-31", amount: 8_250n, bankAccountId: t.s.bank, agency: "State DOR", reference: "Conf 991" });
    expect(r.entry.source).toEqual({ kind: "sales_tax_payment" });
    expect(r.entry.memo).toBe("Sales tax payment to State DOR");
    expect(r.entry.lines).toEqual([
      { accountId: t.s.stp, debit: 8_250n, credit: 0n },
      { accountId: t.s.bank, debit: 0n, credit: 8_250n, memo: "Conf 991" },
    ]);
    expect(salesTaxOwed(r.books)).toBe(before - 8_250n);
    expect(balanceOf(r.books, t.s.bank)).toBe(balanceOf(t.books(), t.s.bank) - 8_250n);
  });

  it("refuse a zero amount, a non-bank account and a closed month", () => {
    const t = books3();
    const ok = { date: "2026-10-31", amount: 100n, bankAccountId: t.s.bank };
    expect(() => recordSalesTaxPayment(t.books(), { ...ok, amount: 0n })).toThrow(/amount/);
    expect(() => recordSalesTaxPayment(t.books(), { ...ok, bankAccountId: t.s.income })).toThrow(/bank account/);
    expect(() => recordSalesTaxPayment(closeThrough(t.books(), "2026-10"), ok)).toThrow(expect.objectContaining({ code: "PERIOD_CLOSED" }));
  });
});

describe("sales tax liability report", () => {
  it("ties to the period's invoices and to the Sales Tax Payable account (exit criterion)", () => {
    const t = books3();
    // Pay September's tax in October, then a payment that's voided again.
    let books = recordSalesTaxPayment(t.books(), { date: "2026-10-12", amount: 8_250n, bankAccountId: t.s.bank }).books;
    const wrong = recordSalesTaxPayment(books, { date: "2026-10-13", amount: 999n, bankAccountId: t.s.bank });
    books = reverseEntry(wrong.books, wrong.entry.id, {}, clock).books;
    // A journal-entry adjustment straight to Sales Tax Payable.
    books = postEntry(books, { date: "2026-10-30", lines: [{ accountId: t.s.stp, debit: 1n }, { accountId: t.s.income, credit: 1n }] }, clock).books;
    // November activity must not leak in.
    books = recordSalesTaxPayment(books, { date: "2026-11-02", amount: 500n, bankAccountId: t.s.bank }).books;

    const r = salesTaxReport(books, t.sales(), "2026-10-01", "2026-10-31");
    const octInvoices = [t.oct1, t.oct2, t.oct3, t.oct4];
    expect(r.invoices.map((i) => i.number)).toEqual(octInvoices.map((i) => i.number));
    expect(r.invoices.map((i) => i.void)).toEqual([false, false, false, true]);
    // Tax per invoice is the invoice's own tax, and the total is their sum.
    expect(r.invoices.map((i) => i.tax)).toEqual([10_313n, 650n, 0n, 2_000n]);
    expect(r.invoices.map((i) => i.tax)).toEqual(octInvoices.map((i) => invoiceTotals(i).tax));
    expect(r.collected).toBe(12_963n);
    expect(r.taxableSales).toBe(125_000n + 9_999n + 20_000n);
    expect(r.totalSales).toBe(129_000n + 9_999n + 50_000n + 20_000n);
    expect(r.voided).toBe(2_000n);
    // Non-void invoices agree with the older summary.
    expect(r.collected - r.voided).toBe(salesTaxCollected(t.sales(), "2026-10-01", "2026-10-31").tax);
    expect(r.payments.map((p) => p.amount)).toEqual([8_250n, 999n, -999n]);
    expect(r.paid).toBe(8_250n);
    expect(r.adjustments).toBe(-1n);
    expect(r.opening).toBe(8_250n);
    // Owed = opening + collected − voided − paid + adjustments = Sales Tax Payable on Oct 31.
    expect(r.owed).toBe(r.opening + r.collected - r.voided - r.paid + r.adjustments);
    const octBooks = { ...books, entries: books.entries.filter((e) => e.date <= "2026-10-31") };
    expect(r.owed).toBe(-balanceOf(octBooks, t.s.stp));
    expect(r.owed).toBe(10_313n + 650n - 1n);
    // And today's balance includes the November payment.
    expect(salesTaxOwed(books)).toBe(r.owed - 500n);
  });

  it("starts from zero with nothing before the range, and refuses a backwards range", () => {
    const t = books3();
    const r = salesTaxReport(t.books(), t.sales(), "2026-01-01", "2026-12-31");
    expect(r.opening).toBe(0n);
    expect(r.invoices).toHaveLength(5);
    expect(r.owed).toBe(salesTaxOwed(t.books()));
    expect(() => salesTaxReport(t.books(), t.sales(), "2026-10-31", "2026-10-01")).toThrow(/before the start/);
  });
});
