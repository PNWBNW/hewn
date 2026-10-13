import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Books,
  addAccount,
  applyTemplate,
  balanceOf,
  booksToJson,
  closeThrough,
  createBooks,
  deactivateAccount,
  systemAccount,
  trialBalance,
  verifyChain,
} from "@pnw/ledger";
import {
  type InvoiceLine,
  type Sales,
  addCustomer,
  addDays,
  addVendor,
  apAging,
  arAging,
  billBalance,
  billStatus,
  bucketFor,
  createInvoice,
  customerBalance,
  deleteDraftInvoice,
  emptySales,
  enterBill,
  formatRateBp,
  invoiceBalance,
  invoiceStatus,
  invoiceTotals,
  lineAmount,
  parseQuantity,
  parseRateBp,
  payBills,
  receivePayment,
  salesTaxCollected,
  sendInvoice,
  suggestApplications,
  updateCustomer,
  updateDraftInvoice,
  updateVendor,
  vendorBalance,
  voidBill,
  voidBillPayment,
  voidInvoice,
  voidPayment,
} from "./sales";
import { salesFromJson, salesToJson } from "./serialize";

const clock = { now: () => "2026-10-13T12:00:00.000Z" };

function setup() {
  let books: Books = applyTemplate(createBooks({ businessName: "Day Consulting", fiscalYearStartMonth: 1 }), "service");
  const id = (name: string) => books.accounts.find((a) => a.name === name)!.id;
  let sales: Sales = emptySales();
  const acme = addCustomer(sales, { name: "Acme Co", email: "ap@acme.test" });
  sales = acme.sales;
  const beta = addCustomer(sales, { name: "Beta LLC", terms: "net_15" });
  sales = beta.sales;
  const paper = addVendor(sales, { name: "Paper Supply", tracks1099: true });
  sales = paper.sales;
  const ar = systemAccount(books, "accounts_receivable").id;
  const ap = systemAccount(books, "accounts_payable").id;
  const tax = systemAccount(books, "sales_tax_payable").id;
  return {
    books,
    sales,
    acme: acme.customer,
    beta: beta.customer,
    paper: paper.vendor,
    bank: id("Checking"),
    income: id("Service Income"),
    reimbursed: id("Reimbursed Expenses"),
    supplies: id("Office Supplies & Software"),
    rent: id("Rent"),
    ar,
    ap,
    tax,
    /** Debit-positive A/R, credit-positive A/P and tax: the way a bookkeeper reads them. */
    arBal: (b: Books) => balanceOf(b, ar),
    apBal: (b: Books) => -balanceOf(b, ap),
    taxBal: (b: Books) => -balanceOf(b, tax),
    setBooks: (b: Books) => (books = b),
  };
}

type S = ReturnType<typeof setup>;

const line = (s: S, quantity: string, unitPrice: bigint, extra: Partial<InvoiceLine> = {}): InvoiceLine => ({
  description: "Consulting",
  accountId: s.income,
  quantity,
  unitPrice,
  ...extra,
});

/** Creates and sends an invoice; returns the new books and sales. */
function issue(s: S, books: Books, sales: Sales, customerId: string, lines: InvoiceLine[], taxRateBp = 0, date = "2026-10-01") {
  const c = createInvoice(books, sales, { customerId, date, lines, taxRateBp });
  const r = sendInvoice(books, c.sales, c.invoice.id, clock);
  return { books: r.books, sales: r.sales, invoice: r.sales.invoices.find((i) => i.id === c.invoice.id)! };
}

function pay(s: S, books: Books, sales: Sales, customerId: string, amount: bigint, apps: [string, bigint][], date = "2026-10-20") {
  return receivePayment(
    books,
    sales,
    { date, customerId, amount, depositAccountId: s.bank, applications: apps.map(([invoiceId, a]) => ({ invoiceId, amount: a })) },
    clock,
  );
}

describe("quantities, rates and line amounts", () => {
  it("parses quantities to hundredths and rejects junk", () => {
    expect(parseQuantity("2")).toBe(200n);
    expect(parseQuantity("2.5")).toBe(250n);
    expect(parseQuantity("0.25")).toBe(25n);
    for (const bad of ["", "-1", "1.234", "1e3", "abc"]) expect(() => parseQuantity(bad)).toThrow(/Quantity/);
  });

  it("multiplies with integer math, rounded half-up", () => {
    expect(lineAmount({ quantity: "1.5", unitPrice: 3333n })).toBe(5000n); // 49.995 → 50.00
    expect(lineAmount({ quantity: "0.33", unitPrice: 1001n })).toBe(330n); // 3.3033 → 3.30
    expect(lineAmount({ quantity: "3", unitPrice: 12_500n })).toBe(37_500n);
  });

  it("reads and writes tax rates as basis points", () => {
    expect(parseRateBp("8.25")).toBe(825);
    expect(parseRateBp("10%")).toBe(1000);
    expect(parseRateBp("")).toBe(0);
    expect(formatRateBp(825)).toBe("8.25");
    expect(formatRateBp(650)).toBe("6.5");
    expect(formatRateBp(1000)).toBe("10");
    expect(() => parseRateBp("8.255")).toThrow();
    expect(() => parseRateBp("101")).toThrow(/100%/);
  });
});

describe("customers and vendors", () => {
  it("default to net 30, reject blanks, duplicates and bad emails", () => {
    const s = setup();
    expect(s.acme.terms).toBe("net_30");
    expect(s.beta.terms).toBe("net_15");
    expect(s.paper.tracks1099).toBe(true);
    expect(() => addCustomer(s.sales, { name: "  " })).toThrow(/name/);
    expect(() => addCustomer(s.sales, { name: "acme co" })).toThrow(/already/);
    expect(() => addCustomer(s.sales, { name: "Gamma", email: "nope" })).toThrow(/email/);
    // The same name may be both a customer and a vendor.
    expect(() => addVendor(s.sales, { name: "Acme Co" })).not.toThrow();
  });

  it("edit and deactivate", () => {
    const s = setup();
    let sales = updateCustomer(s.sales, s.acme.id, { name: "Acme Corp", active: false });
    expect(sales.customers[0]).toMatchObject({ name: "Acme Corp", active: false, email: "ap@acme.test" });
    sales = updateVendor(sales, s.paper.id, { tracks1099: false });
    expect(sales.vendors[0]!.tracks1099).toBeUndefined();
    expect(() => createInvoice(s.books, sales, { customerId: s.acme.id, date: "2026-10-01", lines: [line(s, "1", 100n)] })).toThrow(/inactive/);
  });
});

describe("invoices", () => {
  it("numbers drafts INV-0001…, sets the due date from terms, and posts nothing until sent", () => {
    const s = setup();
    const a = createInvoice(s.books, s.sales, { customerId: s.acme.id, date: "2026-10-01", lines: [line(s, "1", 100n)] });
    const b = createInvoice(s.books, a.sales, { customerId: s.beta.id, date: "2026-10-01", lines: [line(s, "1", 100n)] });
    expect(a.invoice.number).toBe("INV-0001");
    expect(b.invoice.number).toBe("INV-0002");
    expect(a.invoice.dueDate).toBe("2026-10-31");
    expect(b.invoice.dueDate).toBe("2026-10-16");
    expect(invoiceStatus(b.sales, a.invoice, "2026-10-01")).toBe("draft");
    expect(invoiceBalance(b.sales, a.invoice)).toBe(0n);
    expect(s.books.entries).toHaveLength(0);
  });

  it("drafts can be edited and deleted; sent invoices can't", () => {
    const s = setup();
    const a = createInvoice(s.books, s.sales, { customerId: s.acme.id, date: "2026-10-01", lines: [line(s, "1", 100n)] });
    const edited = updateDraftInvoice(s.books, a.sales, a.invoice.id, {
      customerId: s.beta.id,
      date: "2026-10-02",
      lines: [line(s, "2", 5000n)],
    });
    expect(edited.invoices[0]).toMatchObject({ number: "INV-0001", customerId: s.beta.id, dueDate: "2026-10-17" });
    expect(deleteDraftInvoice(edited, a.invoice.id).invoices).toHaveLength(0);
    const sent = sendInvoice(s.books, edited, a.invoice.id, clock);
    expect(() => updateDraftInvoice(sent.books, sent.sales, a.invoice.id, { customerId: s.acme.id, date: "2026-10-02", lines: [line(s, "1", 1n)] })).toThrow(/void it/);
    expect(() => deleteDraftInvoice(sent.sales, a.invoice.id)).toThrow(/void it/);
    expect(() => sendInvoice(sent.books, sent.sales, a.invoice.id)).toThrow(/already/);
  });

  it("validates lines: income accounts only, positive quantities, no negative rates", () => {
    const s = setup();
    const go = (l: InvoiceLine) => createInvoice(s.books, s.sales, { customerId: s.acme.id, date: "2026-10-01", lines: [l] });
    expect(() => go(line(s, "1", 100n, { accountId: s.rent }))).toThrow(/income account/);
    expect(() => go(line(s, "0", 100n))).toThrow(/more than zero/);
    expect(() => go(line(s, "1", -1n))).toThrow(/negative/);
    expect(() => createInvoice(s.books, s.sales, { customerId: s.acme.id, date: "2026-10-01", lines: [] })).toThrow(/at least one/);
    expect(() =>
      createInvoice(s.books, s.sales, { customerId: s.acme.id, date: "2026-10-05", dueDate: "2026-10-01", lines: [line(s, "1", 1n)] }),
    ).toThrow(/before/);
  });

  it("sending posts Dr A/R, Cr each income line and Cr Sales Tax Payable, tagged with the customer", () => {
    const s = setup();
    const r = issue(
      s,
      s.books,
      s.sales,
      s.acme.id,
      [line(s, "10", 12_500n, { taxable: true }), line(s, "1", 4_000n, { accountId: s.reimbursed })],
      825,
    );
    const entry = r.books.entries[0]!;
    expect(entry.source).toEqual({ kind: "invoice", ref: r.invoice.id });
    expect(entry.memo).toBe("Invoice INV-0001");
    // 1,250.00 taxable at 8.25% = 103.125 → 103.13
    expect(entry.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [s.ar, 139_313n, 0n],
      [s.income, 0n, 125_000n],
      [s.reimbursed, 0n, 4_000n],
      [s.tax, 0n, 10_313n],
    ]);
    expect(entry.lines.every((l) => l.name?.kind === "customer" && l.name.id === s.acme.id)).toBe(true);
    expect(r.invoice.entryId).toBe(entry.id);
    expect(s.arBal(r.books)).toBe(139_313n);
    expect(invoiceStatus(r.sales, r.invoice, "2026-10-13")).toBe("open");
  });

  it("refuses to send a zero invoice", () => {
    const s = setup();
    const c = createInvoice(s.books, s.sales, { customerId: s.acme.id, date: "2026-10-01", lines: [line(s, "1", 0n)] });
    expect(() => sendInvoice(s.books, c.sales, c.invoice.id)).toThrow(/more than zero/);
  });
});

describe("sales tax", () => {
  it("is computed on taxable lines only and rounded half-up once per invoice, not per line", () => {
    // Three taxable lines of 0.10 at 5%: per-line rounding would give 3 × 0.01 = 0.03; per invoice 0.015 → 0.02.
    const t = invoiceTotals({
      taxRateBp: 500,
      lines: [
        { description: "", accountId: "x", quantity: "1", unitPrice: 10n, taxable: true },
        { description: "", accountId: "x", quantity: "1", unitPrice: 10n, taxable: true },
        { description: "", accountId: "x", quantity: "1", unitPrice: 10n, taxable: true },
        { description: "", accountId: "x", quantity: "1", unitPrice: 1_000n },
      ],
    });
    expect(t).toEqual({ subtotal: 1_030n, taxable: 30n, tax: 2n, total: 1_032n });
    // Exactly half a cent rounds up; just under rounds down.
    expect(invoiceTotals({ taxRateBp: 1000, lines: [{ description: "", accountId: "x", quantity: "1", unitPrice: 5n, taxable: true }] }).tax).toBe(1n);
    expect(invoiceTotals({ taxRateBp: 1000, lines: [{ description: "", accountId: "x", quantity: "1", unitPrice: 4n, taxable: true }] }).tax).toBe(0n);
  });

  it("salesTaxCollected sums sent, non-void invoices in the range and ties to Sales Tax Payable", () => {
    const s = setup();
    let r = issue(s, s.books, s.sales, s.acme.id, [line(s, "1", 10_000n, { taxable: true })], 1000, "2026-09-30");
    r = issue(s, r.books, r.sales, s.acme.id, [line(s, "1", 20_000n, { taxable: true }), line(s, "1", 5_000n)], 1000, "2026-10-01");
    const v = issue(s, r.books, r.sales, s.beta.id, [line(s, "1", 30_000n, { taxable: true })], 1000, "2026-10-15");
    const voided = voidInvoice(v.books, v.sales, v.invoice.id, {}, clock);
    const draft = createInvoice(voided.books, voided.sales, { customerId: s.acme.id, date: "2026-10-20", taxRateBp: 1000, lines: [line(s, "1", 99_900n, { taxable: true })] });
    const oct = salesTaxCollected(draft.sales, "2026-10-01", "2026-10-31");
    expect(oct).toEqual({ invoices: 1, totalSales: 25_000n, taxableSales: 20_000n, tax: 2_000n });
    const all = salesTaxCollected(draft.sales, "2026-01-01", "2026-12-31");
    expect(all.tax).toBe(3_000n);
    expect(s.taxBal(voided.books)).toBe(all.tax);
  });
});

describe("payments received", () => {
  it("invoice → partial payment → final payment → paid, with A/R correct at each step", () => {
    const s = setup();
    const inv = issue(s, s.books, s.sales, s.acme.id, [line(s, "8", 15_000n, { taxable: true })], 825); // 1,200.00 + 99.00 tax
    expect(invoiceTotals(inv.invoice).total).toBe(129_900n);
    expect(s.arBal(inv.books)).toBe(129_900n);
    expect(invoiceStatus(inv.sales, inv.invoice, "2026-10-13")).toBe("open");

    const p1 = pay(s, inv.books, inv.sales, s.acme.id, 50_000n, [[inv.invoice.id, 50_000n]]);
    expect(p1.entry.source).toEqual({ kind: "payment", ref: p1.payment.id });
    expect(p1.entry.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [s.bank, 50_000n, 0n],
      [s.ar, 0n, 50_000n],
    ]);
    expect(s.arBal(p1.books)).toBe(79_900n);
    expect(invoiceBalance(p1.sales, inv.invoice)).toBe(79_900n);
    expect(invoiceStatus(p1.sales, inv.invoice, "2026-10-21")).toBe("partially_paid");
    expect(balanceOf(p1.books, s.bank)).toBe(50_000n);

    const p2 = pay(s, p1.books, p1.sales, s.acme.id, 79_900n, [[inv.invoice.id, 79_900n]], "2026-10-25");
    expect(s.arBal(p2.books)).toBe(0n);
    expect(invoiceBalance(p2.sales, inv.invoice)).toBe(0n);
    expect(invoiceStatus(p2.sales, inv.invoice, "2027-01-01")).toBe("paid"); // paid is never overdue
    expect(customerBalance(p2.sales, s.acme.id)).toBe(0n);
    expect(balanceOf(p2.books, s.bank)).toBe(129_900n);
    expect(verifyChain(p2.books)).toEqual({ ok: true });
  });

  it("one payment can pay two invoices", () => {
    const s = setup();
    let r = issue(s, s.books, s.sales, s.acme.id, [line(s, "1", 30_000n)]);
    const first = r.invoice;
    r = issue(s, r.books, r.sales, s.acme.id, [line(s, "1", 20_000n)]);
    const second = r.invoice;
    const p = pay(s, r.books, r.sales, s.acme.id, 45_000n, [[first.id, 30_000n], [second.id, 15_000n]]);
    expect(p.entry.memo).toBe("Payment for INV-0001, INV-0002");
    expect(invoiceStatus(p.sales, first, "2026-10-21")).toBe("paid");
    expect(invoiceBalance(p.sales, second)).toBe(5_000n);
    expect(s.arBal(p.books)).toBe(5_000n);
  });

  it("rejects over-application, overpayment of an invoice, and the wrong customer's invoice", () => {
    const s = setup();
    const r = issue(s, s.books, s.sales, s.acme.id, [line(s, "1", 10_000n)]);
    // Applying more than the invoice's balance.
    expect(() => pay(s, r.books, r.sales, s.acme.id, 20_000n, [[r.invoice.id, 10_001n]])).toThrow(/balance of 100.00/);
    // The same invoice listed twice still counts as one application.
    expect(() => pay(s, r.books, r.sales, s.acme.id, 20_000n, [[r.invoice.id, 6_000n], [r.invoice.id, 6_000n]])).toThrow(/balance/);
    // Applying more than was received.
    expect(() => pay(s, r.books, r.sales, s.acme.id, 5_000n, [[r.invoice.id, 6_000n]])).toThrow(/more than the 50.00 received/);
    expect(() => pay(s, r.books, r.sales, s.beta.id, 5_000n, [[r.invoice.id, 5_000n]])).toThrow(/different customer/);
    expect(() => pay(s, r.books, r.sales, s.acme.id, 0n, [])).toThrow(/amount/);
    // Second payment can't take the balance below zero either.
    const p = pay(s, r.books, r.sales, s.acme.id, 10_000n, [[r.invoice.id, 10_000n]]);
    expect(() => pay(s, p.books, p.sales, s.acme.id, 1n, [[r.invoice.id, 1n]])).toThrow(/balance of 0.00/);
  });

  it("refuses drafts and void invoices, and non-bank deposit accounts", () => {
    const s = setup();
    const d = createInvoice(s.books, s.sales, { customerId: s.acme.id, date: "2026-10-01", lines: [line(s, "1", 100n)] });
    expect(() => pay(s, s.books, d.sales, s.acme.id, 100n, [[d.invoice.id, 100n]])).toThrow(/draft/);
    expect(() =>
      receivePayment(s.books, d.sales, { date: "2026-10-02", customerId: s.acme.id, amount: 100n, depositAccountId: s.rent, applications: [] }),
    ).toThrow(/bank account/);
  });

  it("an unapplied remainder stays as a customer credit, and A/R still ties", () => {
    const s = setup();
    const r = issue(s, s.books, s.sales, s.acme.id, [line(s, "1", 10_000n)]);
    const p = pay(s, r.books, r.sales, s.acme.id, 12_500n, [[r.invoice.id, 10_000n]]);
    expect(customerBalance(p.sales, s.acme.id)).toBe(-2_500n);
    expect(s.arBal(p.books)).toBe(-2_500n);
  });

  it("voiding a payment reopens what it paid", () => {
    const s = setup();
    const r = issue(s, s.books, s.sales, s.acme.id, [line(s, "1", 10_000n)]);
    const p = pay(s, r.books, r.sales, s.acme.id, 10_000n, [[r.invoice.id, 10_000n]]);
    const v = voidPayment(p.books, p.sales, p.payment.id, {}, clock);
    expect(invoiceBalance(v.sales, r.invoice)).toBe(10_000n);
    expect(s.arBal(v.books)).toBe(10_000n);
    expect(v.books.entries.at(-1)!.reverses).toBe(p.entry.id);
    expect(() => voidPayment(v.books, v.sales, p.payment.id)).toThrow(/already void/);
  });

  it("suggests oldest-due-first splits", () => {
    const open = [
      { id: "b", dueDate: "2026-11-01", balance: 300n },
      { id: "a", dueDate: "2026-10-01", balance: 200n },
    ];
    expect([...suggestApplications(open, 350n)]).toEqual([["a", 200n], ["b", 150n]]);
    expect([...suggestApplications(open, 1_000n)]).toEqual([["a", 200n], ["b", 300n]]);
  });
});

describe("voiding invoices", () => {
  it("a draft is just marked void; a sent one is reversed", () => {
    const s = setup();
    const d = createInvoice(s.books, s.sales, { customerId: s.acme.id, date: "2026-10-01", lines: [line(s, "1", 100n)] });
    const vd = voidInvoice(s.books, d.sales, d.invoice.id);
    expect(vd.books).toBe(s.books);
    expect(invoiceStatus(vd.sales, vd.sales.invoices[0]!, "2026-10-01")).toBe("void");

    const r = issue(s, s.books, s.sales, s.acme.id, [line(s, "1", 10_000n, { taxable: true })], 500);
    const v = voidInvoice(r.books, r.sales, r.invoice.id, {}, clock);
    const inv = v.sales.invoices[0]!;
    expect(inv.state).toBe("void");
    expect(v.books.entries.at(-1)!.reverses).toBe(r.invoice.entryId);
    expect(inv.voidEntryId).toBe(v.books.entries.at(-1)!.id);
    expect(s.arBal(v.books)).toBe(0n);
    expect(s.taxBal(v.books)).toBe(0n);
    expect(() => voidInvoice(v.books, v.sales, inv.id)).toThrow(/already void/);
  });

  it("is refused while a payment is applied, and allowed once that payment is voided", () => {
    const s = setup();
    const r = issue(s, s.books, s.sales, s.acme.id, [line(s, "1", 10_000n)]);
    const p = pay(s, r.books, r.sales, s.acme.id, 4_000n, [[r.invoice.id, 4_000n]]);
    expect(() => voidInvoice(p.books, p.sales, r.invoice.id)).toThrow(/payments applied/);
    const vp = voidPayment(p.books, p.sales, p.payment.id, {}, clock);
    const v = voidInvoice(vp.books, vp.sales, r.invoice.id, {}, clock);
    expect(s.arBal(v.books)).toBe(0n);
  });

  it("in a closed month needs a date in an open month", () => {
    const s = setup();
    const r = issue(s, s.books, s.sales, s.acme.id, [line(s, "1", 10_000n)], 0, "2026-09-15");
    const closed = closeThrough(r.books, "2026-09");
    expect(() => voidInvoice(closed, r.sales, r.invoice.id)).toThrow(/closed/);
    const v = voidInvoice(closed, r.sales, r.invoice.id, { date: "2026-10-01" }, clock);
    expect(v.books.entries.at(-1)!.date).toBe("2026-10-01");
  });
});

describe("bills and bill payments", () => {
  it("bill → payment, with A/P correct", () => {
    const s = setup();
    const b = enterBill(
      s.books,
      s.sales,
      {
        vendorId: s.paper.id,
        number: "PS-1001",
        date: "2026-10-02",
        lines: [
          { description: "Paper", accountId: s.supplies, amount: 12_345n },
          { description: "October", accountId: s.rent, amount: 150_000n },
        ],
      },
      clock,
    );
    expect(b.bill.dueDate).toBe("2026-11-01");
    expect(b.entry.source).toEqual({ kind: "bill", ref: b.bill.id });
    expect(b.entry.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [s.supplies, 12_345n, 0n],
      [s.rent, 150_000n, 0n],
      [s.ap, 0n, 162_345n],
    ]);
    expect(b.entry.lines.every((l) => l.name?.kind === "vendor" && l.name.id === s.paper.id)).toBe(true);
    expect(s.apBal(b.books)).toBe(162_345n);
    expect(billStatus(b.sales, b.bill, "2026-10-13")).toBe("open");
    expect(billStatus(b.sales, b.bill, "2026-11-02")).toBe("overdue");

    const p1 = payBills(b.books, b.sales, { date: "2026-10-10", vendorId: s.paper.id, bankAccountId: s.bank, reference: "Check 101", applications: [{ billId: b.bill.id, amount: 62_345n }] }, clock);
    expect(p1.entry.source).toEqual({ kind: "bill_payment", ref: p1.billPayment.id });
    expect(p1.entry.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [s.ap, 62_345n, 0n],
      [s.bank, 0n, 62_345n],
    ]);
    expect(s.apBal(p1.books)).toBe(100_000n);
    expect(billStatus(p1.sales, b.bill, "2026-10-13")).toBe("partially_paid");

    const p2 = payBills(p1.books, p1.sales, { date: "2026-10-12", vendorId: s.paper.id, bankAccountId: s.bank, applications: [{ billId: b.bill.id, amount: 100_000n }] }, clock);
    expect(s.apBal(p2.books)).toBe(0n);
    expect(billBalance(p2.sales, b.bill)).toBe(0n);
    expect(billStatus(p2.sales, b.bill, "2027-01-01")).toBe("paid");
    expect(vendorBalance(p2.sales, s.paper.id)).toBe(0n);
    expect(balanceOf(p2.books, s.bank)).toBe(-162_345n);
  });

  it("validates bills: vendor, accounts, amounts, duplicates", () => {
    const s = setup();
    const go = (over: Partial<Parameters<typeof enterBill>[2]> = {}) =>
      enterBill(s.books, s.sales, { vendorId: s.paper.id, date: "2026-10-02", lines: [{ description: "", accountId: s.supplies, amount: 100n }], ...over });
    expect(() => go({ lines: [{ description: "", accountId: s.income, amount: 100n }] })).toThrow(/expense or asset/);
    expect(() => go({ lines: [{ description: "", accountId: s.bank, amount: 100n }] })).toThrow(/expense or asset/);
    expect(() => go({ lines: [{ description: "", accountId: s.supplies, amount: 0n }] })).toThrow(/more than zero/);
    expect(() => go({ lines: [] })).toThrow(/at least one/);
    expect(() => go({ vendorId: "vend-99" })).toThrow(/not found/);
    const first = go({ number: "A-1" });
    expect(() => enterBill(first.books, first.sales, { vendorId: s.paper.id, number: "a-1", date: "2026-10-03", lines: [{ description: "", accountId: s.supplies, amount: 1n }] })).toThrow(/already entered/);
  });

  it("pays two bills at once; rejects over-payment and another vendor's bill", () => {
    const s = setup();
    const other = addVendor(s.sales, { name: "Landlord" });
    let r = enterBill(s.books, other.sales, { vendorId: s.paper.id, date: "2026-10-01", lines: [{ description: "", accountId: s.supplies, amount: 1_000n }] });
    const b1 = r.bill;
    r = enterBill(r.books, r.sales, { vendorId: s.paper.id, date: "2026-10-02", lines: [{ description: "", accountId: s.supplies, amount: 2_000n }] });
    const b2 = r.bill;
    r = enterBill(r.books, r.sales, { vendorId: other.vendor.id, date: "2026-10-02", lines: [{ description: "", accountId: s.rent, amount: 5_000n }] });
    const rentBill = r.bill;
    const base = { date: "2026-10-05", vendorId: s.paper.id, bankAccountId: s.bank };
    expect(() => payBills(r.books, r.sales, { ...base, applications: [{ billId: b1.id, amount: 1_001n }] })).toThrow(/balance of 10.00/);
    expect(() => payBills(r.books, r.sales, { ...base, applications: [{ billId: rentBill.id, amount: 1n }] })).toThrow(/different vendor/);
    expect(() => payBills(r.books, r.sales, { ...base, applications: [] })).toThrow(/at least one/);
    expect(() => payBills(r.books, r.sales, { ...base, bankAccountId: s.rent, applications: [{ billId: b1.id, amount: 1n }] })).toThrow(/bank account/);
    const p = payBills(r.books, r.sales, { ...base, applications: [{ billId: b1.id, amount: 1_000n }, { billId: b2.id, amount: 500n }] });
    expect(p.entry.lines[0]!.debit).toBe(1_500n);
    expect(s.apBal(p.books)).toBe(6_500n);
    expect(vendorBalance(p.sales, s.paper.id)).toBe(1_500n);
  });

  it("voiding: refused while paid, allowed after the payment is voided", () => {
    const s = setup();
    const b = enterBill(s.books, s.sales, { vendorId: s.paper.id, date: "2026-10-01", lines: [{ description: "", accountId: s.supplies, amount: 1_000n }] });
    const p = payBills(b.books, b.sales, { date: "2026-10-05", vendorId: s.paper.id, bankAccountId: s.bank, applications: [{ billId: b.bill.id, amount: 400n }] });
    expect(() => voidBill(p.books, p.sales, b.bill.id)).toThrow(/payments applied/);
    const vp = voidBillPayment(p.books, p.sales, p.billPayment.id, {}, clock);
    expect(billBalance(vp.sales, b.bill)).toBe(1_000n);
    const v = voidBill(vp.books, vp.sales, b.bill.id, {}, clock);
    expect(billStatus(v.sales, v.sales.bills[0]!, "2026-10-13")).toBe("void");
    expect(s.apBal(v.books)).toBe(0n);
    expect(balanceOf(v.books, s.bank)).toBe(0n);
    expect(() => voidBill(v.books, v.sales, b.bill.id)).toThrow(/already void/);
  });
});

describe("aging", () => {
  it("buckets by days past due", () => {
    expect([0, 1, 30, 31, 60, 61, 90, 91, -5].map(bucketFor)).toEqual([
      "current", "days1to30", "days1to30", "days31to60", "days31to60", "days61to90", "days61to90", "over90", "current",
    ]);
  });

  it("A/R aging as of a date uses balances on that date", () => {
    const s = setup();
    const asOf = "2026-12-31";
    let books = s.books;
    let sales = s.sales;
    // Due dates (net 30) at 0, 15, 45, 75 and 120 days before the as-of date.
    const ages = [0, 15, 45, 75, 120];
    for (const [i, age] of ages.entries()) {
      const r = issue(s, books, sales, i % 2 ? s.beta.id : s.acme.id, [line(s, "1", BigInt((i + 1) * 1000))], 0, addDays(asOf, -age - (i % 2 ? 15 : 30)));
      books = r.books;
      sales = r.sales;
    }
    const a = arAging(sales, asOf);
    expect(a.totals).toEqual({ current: 1000n, days1to30: 2000n, days31to60: 3000n, days61to90: 4000n, over90: 5000n, total: 15_000n });
    expect(a.totals.total).toBe(s.arBal(books));
    expect(a.byParty.find((p) => p.partyId === s.beta.id)!.total).toBe(6000n);

    // A payment after the as-of date doesn't change that day's aging; one before it does.
    const oldest = sales.invoices[4]!;
    const later = pay(s, books, sales, s.acme.id, 5000n, [[oldest.id, 5000n]], "2027-01-05");
    expect(arAging(later.sales, asOf).totals.over90).toBe(5000n);
    expect(arAging(later.sales, "2027-01-05").totals.over90).toBe(0n);
    // Invoices dated after the as-of date aren't in it.
    expect(arAging(sales, "2026-01-01").totals.total).toBe(0n);
  });

  it("A/P aging ties to A/P", () => {
    const s = setup();
    let r = enterBill(s.books, s.sales, { vendorId: s.paper.id, date: "2026-08-01", terms: "net_15", lines: [{ description: "", accountId: s.supplies, amount: 700n }] });
    r = enterBill(r.books, r.sales, { vendorId: s.paper.id, date: "2026-10-01", lines: [{ description: "", accountId: s.supplies, amount: 300n }] });
    const a = apAging(r.sales, "2026-10-13");
    expect(a.totals).toMatchObject({ current: 300n, days31to60: 700n, total: 1000n });
    expect(a.totals.total).toBe(s.apBal(r.books));
  });
});

describe("ledger rules reject the whole operation", () => {
  it("a closed month leaves books and sales unchanged", () => {
    const s = setup();
    const books = closeThrough(s.books, "2026-09");
    const d = createInvoice(books, s.sales, { customerId: s.acme.id, date: "2026-09-15", lines: [line(s, "1", 10_000n)] });
    const beforeBooks = booksToJson(books);
    const beforeSales = salesToJson(d.sales);
    expect(() => sendInvoice(books, d.sales, d.invoice.id)).toThrow(/closed/);
    expect(() => enterBill(books, d.sales, { vendorId: s.paper.id, date: "2026-09-15", lines: [{ description: "", accountId: s.supplies, amount: 1n }] })).toThrow(/closed/);
    const open = issue(s, books, s.sales, s.acme.id, [line(s, "1", 10_000n)], 0, "2026-10-01");
    expect(() => pay(s, open.books, open.sales, s.acme.id, 100n, [[open.invoice.id, 100n]], "2026-09-30")).toThrow(/closed/);
    // Pure functions: the inputs are untouched.
    expect(booksToJson(books)).toBe(beforeBooks);
    expect(salesToJson(d.sales)).toBe(beforeSales);
    expect(d.sales.invoices[0]!.state).toBe("draft");
  });

  it("an inactive account blocks sending", () => {
    const s = setup();
    const extra = addAccount(s.books, { name: "Workshop Income", type: "income" });
    const d = createInvoice(extra.books, s.sales, { customerId: s.acme.id, date: "2026-10-01", lines: [line(s, "1", 100n, { accountId: extra.account.id })] });
    const books = deactivateAccount(extra.books, extra.account.id);
    expect(() => sendInvoice(books, d.sales, d.invoice.id)).toThrow(/inactive/);
  });
});

describe("serialization", () => {
  it("round-trips sales exactly", () => {
    const s = setup();
    const r = issue(s, s.books, s.sales, s.acme.id, [line(s, "2.5", 12_345n, { taxable: true })], 825);
    const p = pay(s, r.books, r.sales, s.acme.id, 1_000n, [[r.invoice.id, 1_000n]]);
    const b = enterBill(p.books, p.sales, { vendorId: s.paper.id, date: "2026-10-01", lines: [{ description: "x", accountId: s.supplies, amount: 99n }] });
    expect(salesFromJson(salesToJson(b.sales))).toEqual(b.sales);
    expect(() => salesFromJson(JSON.stringify({ format: "other" }))).toThrow(/Not sales data/);
  });
});

describe("invariants (property-based)", () => {
  it("A/R equals open invoice balances less credits, and the trial balance balances", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            customer: fc.integer({ min: 0, max: 2 }),
            lines: fc.array(
              fc.record({
                centiQty: fc.integer({ min: 1, max: 100_000 }),
                unitPrice: fc.bigInt({ min: 0n, max: 1_000_000n }),
                taxable: fc.boolean(),
              }),
              { minLength: 1, maxLength: 4 },
            ),
            taxRateBp: fc.integer({ min: 0, max: 1500 }),
            send: fc.boolean(),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        fc.array(
          fc.record({
            customer: fc.integer({ min: 0, max: 2 }),
            amount: fc.bigInt({ min: 1n, max: 5_000_000n }),
            extra: fc.bigInt({ min: 0n, max: 10_000n }),
            voidIt: fc.boolean(),
          }),
          { maxLength: 6 },
        ),
        (invoices, payments) => {
          const s = setup();
          let { books, sales } = s;
          sales = addCustomer(sales, { name: "Gamma" }).sales;
          const customers = sales.customers.map((c) => c.id);
          for (const spec of invoices) {
            const lines = spec.lines.map((l) => ({
              description: "",
              accountId: s.income,
              quantity: `${Math.floor(l.centiQty / 100)}.${String(l.centiQty % 100).padStart(2, "0")}`,
              unitPrice: l.unitPrice,
              taxable: l.taxable,
            }));
            const c = createInvoice(books, sales, { customerId: customers[spec.customer]!, date: "2026-10-01", lines, taxRateBp: spec.taxRateBp });
            sales = c.sales;
            if (spec.send && invoiceTotals(c.invoice).total > 0n) {
              const r = sendInvoice(books, sales, c.invoice.id);
              books = r.books;
              sales = r.sales;
            }
          }
          for (const spec of payments) {
            const customerId = customers[spec.customer]!;
            const open = sales.invoices
              .filter((i) => i.customerId === customerId && invoiceBalance(sales, i) > 0n)
              .map((i) => ({ id: i.id, dueDate: i.dueDate, balance: invoiceBalance(sales, i) }));
            const split = suggestApplications(open, spec.amount);
            const applied = [...split.values()].reduce((a, b) => a + b, 0n);
            const r = receivePayment(books, sales, {
              date: "2026-10-15",
              customerId,
              amount: applied + spec.extra > 0n ? applied + spec.extra : 1n,
              depositAccountId: s.bank,
              applications: [...split].map(([invoiceId, amount]) => ({ invoiceId, amount })),
            });
            books = r.books;
            sales = r.sales;
            if (spec.voidIt) ({ books, sales } = voidPayment(books, sales, r.payment.id));
          }
          const open = sales.invoices.reduce((t, i) => t + invoiceBalance(sales, i), 0n);
          const credits = sales.payments.reduce((t, p) => t + (p.voidEntryId ? 0n : p.amount - p.applications.reduce((a, x) => a + x.amount, 0n)), 0n);
          for (const i of sales.invoices) expect(invoiceBalance(sales, i) >= 0n).toBe(true);
          expect(s.arBal(books)).toBe(open - credits);
          expect(customers.reduce((t, id) => t + customerBalance(sales, id), 0n)).toBe(s.arBal(books));
          expect(arAging(sales, "2026-12-31").totals.total).toBe(open);
          const tb = trialBalance(books, "2026-12-31");
          expect(tb.totalDebit).toBe(tb.totalCredit);
          expect(verifyChain(books)).toEqual({ ok: true });
        },
      ),
      { numRuns: 200 },
    );
  });
});
