// ---------------------------------------------------------------------------
// Sales tax: what was charged, what was paid to the agency, what's still owed.
//
// Sending an invoice credits Sales Tax Payable; paying the state debits it:
//
//   Sales tax payment  Dr Sales Tax Payable   amount
//                         Cr <bank>
//
// The liability report for a date range walks those same postings, so it
// ties by construction: owed at the start + tax on the period's invoices −
// voided invoices − payments ± any other adjustment = Sales Tax Payable at
// the end of the range. We compute and track it; you file it.
// ---------------------------------------------------------------------------

import {
  type Books,
  type Cents,
  type Entry,
  type IsoDate,
  accountMap,
  assertDate,
  postEntry,
  systemAccount,
} from "@pnw/ledger";
import { type Sales, SalesError, invoiceTotals } from "./sales";

const fail = (message: string): never => {
  throw new SalesError(message);
};

export type SalesTaxInvoiceRow = {
  invoiceId: string;
  number: string;
  customerId: string;
  date: IsoDate;
  totalSales: Cents;
  taxableSales: Cents;
  tax: Cents;
  /** Voided since; its reversal shows under `voided` when dated in the range. */
  void: boolean;
};

export type SalesTaxPaymentRow = { entryId: string; date: IsoDate; amount: Cents; memo?: string };

export type SalesTaxReport = {
  from: IsoDate;
  to: IsoDate;
  /** Sales Tax Payable the day before `from`. */
  opening: Cents;
  /** Every invoice posted in the range (sent, dated from..to), in date order. */
  invoices: SalesTaxInvoiceRow[];
  collected: Cents;
  totalSales: Cents;
  taxableSales: Cents;
  /** Tax taken back by invoices voided in the range. */
  voided: Cents;
  /** Payments to the agency in the range (a voided payment counts negative). */
  payments: SalesTaxPaymentRow[];
  paid: Cents;
  /** Anything else posted to Sales Tax Payable in the range (journal entries). */
  adjustments: Cents;
  /** Sales Tax Payable at the end of `to`: what's owed. */
  owed: Cents;
};

/** Sales tax charged, voided and paid between `from` and `to` (inclusive), and what's owed at the end. */
export function salesTaxReport(books: Books, sales: Sales, from: IsoDate, to: IsoDate): SalesTaxReport {
  assertDate(from);
  assertDate(to);
  if (from > to) fail("The end date is before the start date");
  const stp = systemAccount(books, "sales_tax_payable").id;
  const credit = (e: Entry) => e.lines.reduce((t, l) => (l.accountId === stp ? t + l.credit - l.debit : t), 0n);
  const byEntry = new Map(books.entries.map((e) => [e.id, e]));
  const invoiceEntries = new Set(sales.invoices.flatMap((i) => (i.entryId ? [i.entryId] : [])));

  let opening = 0n;
  let movement = 0n;
  let voided = 0n;
  const payments: SalesTaxPaymentRow[] = [];
  for (const e of books.entries) {
    if (e.date < from) {
      opening += credit(e);
      continue;
    }
    if (e.date > to) continue;
    const c = credit(e);
    movement += c;
    const original = e.reverses ? byEntry.get(e.reverses) : undefined;
    if (original && invoiceEntries.has(original.id)) voided -= c;
    const payment = e.source.kind === "sales_tax_payment" ? e : original?.source.kind === "sales_tax_payment" ? original : null;
    if (payment) payments.push({ entryId: e.id, date: e.date, amount: -c, ...(e.memo ? { memo: e.memo } : {}) });
  }

  const invoices: SalesTaxInvoiceRow[] = sales.invoices
    .filter((i) => i.entryId && i.date >= from && i.date <= to)
    .map((i) => {
      const t = invoiceTotals(i);
      return {
        invoiceId: i.id,
        number: i.number,
        customerId: i.customerId,
        date: i.date,
        totalSales: t.subtotal,
        taxableSales: t.taxable,
        tax: t.tax,
        void: i.state === "void",
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  const total = (f: (r: SalesTaxInvoiceRow) => Cents) => invoices.reduce((t, r) => t + f(r), 0n);
  const collected = total((r) => r.tax);
  const paid = payments.reduce((t, p) => t + p.amount, 0n);
  return {
    from,
    to,
    opening,
    invoices,
    collected,
    totalSales: total((r) => r.totalSales),
    taxableSales: total((r) => r.taxableSales),
    voided,
    payments,
    paid,
    adjustments: movement - collected + voided + paid,
    owed: opening + movement,
  };
}

/** Sales Tax Payable now, credit-positive: what you owe the agency today. */
export function salesTaxOwed(books: Books): Cents {
  const stp = systemAccount(books, "sales_tax_payable").id;
  let owed = 0n;
  for (const e of books.entries) for (const l of e.lines) if (l.accountId === stp) owed += l.credit - l.debit;
  return owed;
}

/** Pays collected sales tax to the agency: Dr Sales Tax Payable, Cr bank. */
export function recordSalesTaxPayment(
  books: Books,
  input: { date: IsoDate; amount: Cents; bankAccountId: string; agency?: string; reference?: string },
): { books: Books; entry: Entry } {
  if (typeof input.amount !== "bigint" || input.amount <= 0n) fail("Enter the amount paid");
  const bank = accountMap(books).get(input.bankAccountId);
  if (!bank || bank.type !== "bank") fail("Choose the bank account the payment came from");
  if (!bank!.active) fail(`"${bank!.name}" is inactive`);
  const agency = input.agency?.trim();
  const reference = input.reference?.trim();
  return postEntry(books, {
    date: assertDate(input.date),
    memo: agency ? `Sales tax payment to ${agency}` : "Sales tax payment",
    source: { kind: "sales_tax_payment" },
    lines: [
      { accountId: systemAccount(books, "sales_tax_payable").id, debit: input.amount },
      { accountId: input.bankAccountId, credit: input.amount, ...(reference ? { memo: reference } : {}) },
    ],
  });
}
