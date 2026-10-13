// ---------------------------------------------------------------------------
// Sales and purchases: customers, vendors, invoices, bills and the payments
// that settle them, posted into the books.
//
// Everything here is private: names, emails, line items and amounts live
// only inside the encrypted vault, next to the books. Amounts are bigint
// cents; quantities are decimal strings with at most two places, multiplied
// as whole hundredths so no float ever touches a total.
//
// What posts, and when (one balanced journal entry each):
//
//   Invoice sent       Dr Accounts Receivable (customer)   total
//                         Cr <income account>              each line
//                         Cr Sales Tax Payable             tax
//   Payment received   Dr <bank>                           amount
//                         Cr Accounts Receivable (customer)
//   Bill entered       Dr <expense or asset account>       each line
//                         Cr Accounts Payable (vendor)     total
//   Bill payment       Dr Accounts Payable (vendor)        amount
//                         Cr <bank>
//
// Invoice and bill lines may carry tags (project, class, location); the
// income or expense line they post carries the same tags, which is how a
// project's profit adds itself up. Estimates (estimates.ts) never post.
//
// Voiding reverses the entry; nothing is edited or deleted in the journal.
// Every operation is a pure function of (books, sales): if any ledger rule
// fails (closed month, inactive account...), it throws and the caller's
// books and sales are left exactly as they were.
// ---------------------------------------------------------------------------

import {
  type Account,
  type Books,
  type Cents,
  type Clock,
  type Entry,
  type IsoDate,
  type NameRef,
  type Tags,
  accountMap,
  assertDate,
  baseOf,
  cleanTags,
  formatCents,
  postEntry,
  reverseEntry,
  systemAccount,
} from "@pnw/ledger";

// ---- Types -----------------------------------------------------------------

export type TermsId = "due_on_receipt" | "net_15" | "net_30" | "net_45" | "net_60";

export const TERMS: { id: TermsId; label: string; days: number }[] = [
  { id: "due_on_receipt", label: "Due on receipt", days: 0 },
  { id: "net_15", label: "Net 15", days: 15 },
  { id: "net_30", label: "Net 30", days: 30 },
  { id: "net_45", label: "Net 45", days: 45 },
  { id: "net_60", label: "Net 60", days: 60 },
];

export const DEFAULT_TERMS: TermsId = "net_30";

export type Customer = { id: string; name: string; email?: string; terms: TermsId; active: boolean };
export type Vendor = Customer & { tracks1099?: boolean };

export type PartyInput = { name: string; email?: string; terms?: TermsId };
export type VendorInput = PartyInput & { tracks1099?: boolean };

export type InvoiceLine = {
  description: string;
  /** An income account. */
  accountId: string;
  /** Decimal, at most two places: "1", "2.5", "0.25". */
  quantity: string;
  unitPrice: Cents;
  taxable?: boolean;
  tags?: Tags;
};

/** Stored state. What the user sees (open, paid, overdue...) is derived; see invoiceStatus. */
export type InvoiceState = "draft" | "sent" | "void";

export type Invoice = {
  id: string;
  number: string;
  customerId: string;
  date: IsoDate;
  dueDate: IsoDate;
  terms: TermsId;
  lines: InvoiceLine[];
  /** Sales tax rate for this invoice, in basis points (825 = 8.25%). */
  taxRateBp: number;
  memo?: string;
  state: InvoiceState;
  /** The entry posted when the invoice was sent. */
  entryId?: string;
  /** The reversal posted when a sent invoice was voided. */
  voidEntryId?: string;
  /** The estimate this invoice was made from. */
  estimateId?: string;
};

export type InvoiceInput = {
  customerId: string;
  date: IsoDate;
  /** Defaults to the date plus the terms. */
  dueDate?: IsoDate;
  /** Defaults to the customer's terms. */
  terms?: TermsId;
  lines: InvoiceLine[];
  taxRateBp?: number;
  memo?: string;
};

export type Application = { targetId: string; amount: Cents };

export type Payment = {
  id: string;
  date: IsoDate;
  customerId: string;
  amount: Cents;
  /** A bank account, or Payments to Deposit. */
  depositAccountId: string;
  reference?: string;
  /** Invoices this payment pays. What's left over stays as a credit on the customer. */
  applications: { invoiceId: string; amount: Cents }[];
  entryId: string;
  voidEntryId?: string;
};

export type PaymentInput = Omit<Payment, "id" | "entryId" | "voidEntryId">;

export type BillLine = {
  description: string;
  /** An expense or (non-bank) asset account. */
  accountId: string;
  amount: Cents;
  tags?: Tags;
};

/**
 * A receipt or other file kept with a bill. The bytes are sealed separately
 * in the vault (never in the company file); the bill holds only this.
 */
export type AttachmentRef = {
  attachmentId: string;
  /** SHA-256 of the plaintext bytes, hex: checked every time the file is opened. */
  sha256: string;
  type: string;
  size: number;
  name: string;
};

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type Bill = {
  id: string;
  vendorId: string;
  /** The vendor's own bill or reference number, if any. */
  number?: string;
  date: IsoDate;
  dueDate: IsoDate;
  terms: TermsId;
  lines: BillLine[];
  memo?: string;
  attachments?: AttachmentRef[];
  entryId: string;
  voidEntryId?: string;
};

export type BillInput = {
  vendorId: string;
  number?: string;
  date: IsoDate;
  dueDate?: IsoDate;
  terms?: TermsId;
  lines: BillLine[];
  memo?: string;
  attachments?: AttachmentRef[];
};

export type BillPayment = {
  id: string;
  date: IsoDate;
  vendorId: string;
  bankAccountId: string;
  reference?: string;
  applications: { billId: string; amount: Cents }[];
  entryId: string;
  voidEntryId?: string;
};

export type BillPaymentInput = Omit<BillPayment, "id" | "entryId" | "voidEntryId">;

/** Stored state of an estimate. "Expired" is derived from the expiry date; see estimateStatus. */
export type EstimateState = "draft" | "sent" | "accepted" | "declined" | "converted";

export type Estimate = {
  id: string;
  number: string;
  customerId: string;
  date: IsoDate;
  expiryDate: IsoDate;
  lines: InvoiceLine[];
  taxRateBp: number;
  memo?: string;
  state: EstimateState;
  /** The invoice it became. */
  invoiceId?: string;
};

export type Sales = {
  version: 1;
  customers: Customer[];
  vendors: Vendor[];
  invoices: Invoice[];
  estimates: Estimate[];
  bills: Bill[];
  payments: Payment[];
  billPayments: BillPayment[];
  nextCustomer: number;
  nextVendor: number;
  nextInvoice: number;
  nextEstimate: number;
  nextBill: number;
  nextPayment: number;
  nextBillPayment: number;
};

export const emptySales = (): Sales => ({
  version: 1,
  customers: [],
  vendors: [],
  invoices: [],
  estimates: [],
  bills: [],
  payments: [],
  billPayments: [],
  nextCustomer: 1,
  nextVendor: 1,
  nextInvoice: 1,
  nextEstimate: 1,
  nextBill: 1,
  nextPayment: 1,
  nextBillPayment: 1,
});

export class SalesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesError";
  }
}

const fail = (message: string): never => {
  throw new SalesError(message);
};

const sum = (xs: Iterable<Cents>): Cents => {
  let t = 0n;
  for (const x of xs) t += x;
  return t;
};

// ---- Dates, quantities and rates --------------------------------------------

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = assertDate(date).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = (iso: IsoDate) => {
    const [y, m, d] = assertDate(iso).split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

export function termsDays(terms: TermsId): number {
  return TERMS.find((t) => t.id === terms)?.days ?? fail("Choose payment terms");
}

export const dueDateFor = (date: IsoDate, terms: TermsId): IsoDate => addDays(date, termsDays(terms));

const QUANTITY = /^(\d{1,9})(?:\.(\d{1,2}))?$/;

/** "2.5" → 250n hundredths. At most two decimal places; never negative. */
export function parseQuantity(text: string): bigint {
  const m = QUANTITY.exec(text.trim());
  if (!m) fail(`Quantity "${text}" must be a number with at most two decimals`);
  return BigInt(m![1]!) * 100n + BigInt((m![2] ?? "").padEnd(2, "0"));
}

/** Quantity × unit price, rounded half-up to the cent. */
export function lineAmount(line: Pick<InvoiceLine, "quantity" | "unitPrice">): Cents {
  return (parseQuantity(line.quantity) * line.unitPrice + 50n) / 100n;
}

const RATE = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/** "8.25" (percent) → 825 basis points. */
export function parseRateBp(text: string): number {
  const t = text.trim().replace(/%$/, "") || "0";
  const m = RATE.exec(t);
  if (!m) fail("Tax rate must be a percentage with at most two decimals, like 8.25");
  const bp = Number(m![1]) * 100 + Number((m![2] ?? "").padEnd(2, "0"));
  if (bp > 10_000) fail("Tax rate can't be more than 100%");
  return bp;
}

/** 825 → "8.25". */
export function formatRateBp(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

// ---- Customers and vendors ---------------------------------------------------

function cleanParty(input: PartyInput, others: Customer[], selfId?: string): Omit<Customer, "id" | "active"> {
  const name = input.name.trim();
  if (!name) fail("Every customer and vendor needs a name");
  if (others.some((o) => o.id !== selfId && o.name.toLowerCase() === name.toLowerCase())) {
    fail(`"${name}" is already on your list`);
  }
  const email = input.email?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`"${email}" doesn't look like an email address`);
  const terms = input.terms ?? DEFAULT_TERMS;
  termsDays(terms);
  return { name, ...(email ? { email } : {}), terms };
}

export function addCustomer(sales: Sales, input: PartyInput): { sales: Sales; customer: Customer } {
  const customer: Customer = { ...cleanParty(input, sales.customers), id: `cust-${sales.nextCustomer}`, active: true };
  return { sales: { ...sales, customers: [...sales.customers, customer], nextCustomer: sales.nextCustomer + 1 }, customer };
}

export function updateCustomer(sales: Sales, id: string, changes: Partial<PartyInput & { active: boolean }>): Sales {
  const current = sales.customers.find((c) => c.id === id) ?? fail("Customer not found");
  const merged = { ...current, ...changes };
  const next: Customer = { ...cleanParty(merged, sales.customers, id), id, active: merged.active };
  return { ...sales, customers: sales.customers.map((c) => (c.id === id ? next : c)) };
}

export function addVendor(sales: Sales, input: VendorInput): { sales: Sales; vendor: Vendor } {
  const vendor: Vendor = {
    ...cleanParty(input, sales.vendors),
    ...(input.tracks1099 ? { tracks1099: true } : {}),
    id: `vend-${sales.nextVendor}`,
    active: true,
  };
  return { sales: { ...sales, vendors: [...sales.vendors, vendor], nextVendor: sales.nextVendor + 1 }, vendor };
}

export function updateVendor(sales: Sales, id: string, changes: Partial<VendorInput & { active: boolean }>): Sales {
  const current = sales.vendors.find((v) => v.id === id) ?? fail("Vendor not found");
  const merged = { ...current, ...changes };
  const next: Vendor = {
    ...cleanParty(merged, sales.vendors, id),
    ...(merged.tracks1099 ? { tracks1099: true } : {}),
    id,
    active: merged.active,
  };
  return { ...sales, vendors: sales.vendors.map((v) => (v.id === id ? next : v)) };
}

export const findCustomer = (sales: Sales, id: string) => sales.customers.find((c) => c.id === id) ?? fail("Customer not found");
const findVendor = (sales: Sales, id: string) => sales.vendors.find((v) => v.id === id) ?? fail("Vendor not found");

// ---- Invoices ----------------------------------------------------------------

export type InvoiceTotals = { subtotal: Cents; taxable: Cents; tax: Cents; total: Cents };

/** Subtotal, taxable amount, tax (rounded half-up once per invoice) and total. */
export function invoiceTotals(invoice: Pick<Invoice, "lines" | "taxRateBp">): InvoiceTotals {
  const amounts = invoice.lines.map(lineAmount);
  const subtotal = sum(amounts);
  const taxable = sum(invoice.lines.flatMap((l, i) => (l.taxable ? [amounts[i]!] : [])));
  const tax = (taxable * BigInt(invoice.taxRateBp) + 5000n) / 10000n;
  return { subtotal, taxable, tax, total: subtotal + tax };
}

function account(books: Books, id: string, where: string): Account {
  const acct = accountMap(books).get(id) ?? fail(`${where}: choose an account`);
  if (!acct.active) fail(`${where}: "${acct.name}" is inactive`);
  return acct;
}

export function cleanTaxRate(taxRateBp: number | undefined): number {
  const bp = taxRateBp ?? 0;
  if (!Number.isInteger(bp) || bp < 0 || bp > 10_000) fail("Tax rate must be between 0% and 100%");
  return bp;
}

/** Checks invoice (and estimate) lines against the chart: income accounts, sane amounts, clean tags. */
export function cleanInvoiceLines(books: Books, input: InvoiceLine[]): InvoiceLine[] {
  if (input.length === 0) fail("Add at least one line");
  return input.map((l, i): InvoiceLine => {
    const where = `Line ${i + 1}`;
    if (baseOf(account(books, l.accountId, where)) !== "income") fail(`${where}: choose an income account`);
    if (typeof l.unitPrice !== "bigint" || l.unitPrice < 0n) fail(`${where}: the rate can't be negative`);
    if (parseQuantity(l.quantity) === 0n) fail(`${where}: quantity must be more than zero`);
    const description = l.description.trim();
    const tags = cleanTags(l.tags);
    return {
      description,
      accountId: l.accountId,
      quantity: l.quantity.trim(),
      unitPrice: l.unitPrice,
      ...(l.taxable ? { taxable: true } : {}),
      ...(tags ? { tags } : {}),
    };
  });
}

function cleanInvoice(books: Books, sales: Sales, input: InvoiceInput): Omit<Invoice, "id" | "number" | "state"> {
  const customer = findCustomer(sales, input.customerId);
  const date = assertDate(input.date);
  const terms = input.terms ?? customer.terms;
  const dueDate = input.dueDate ? assertDate(input.dueDate) : dueDateFor(date, terms);
  if (dueDate < date) fail("The due date is before the invoice date");
  const taxRateBp = cleanTaxRate(input.taxRateBp);
  const lines = cleanInvoiceLines(books, input.lines);
  const memo = input.memo?.trim();
  return { customerId: customer.id, date, dueDate, terms, lines, taxRateBp, ...(memo ? { memo } : {}) };
}

export const findInvoice = (sales: Sales, id: string) => sales.invoices.find((i) => i.id === id) ?? fail("Invoice not found");

/** Saves a draft. Nothing posts until it's sent. */
export function createInvoice(books: Books, sales: Sales, input: InvoiceInput): { sales: Sales; invoice: Invoice } {
  if (!findCustomer(sales, input.customerId).active) fail("That customer is inactive");
  const invoice: Invoice = {
    ...cleanInvoice(books, sales, input),
    id: `inv-${sales.nextInvoice}`,
    number: `INV-${String(sales.nextInvoice).padStart(4, "0")}`,
    state: "draft",
  };
  return { sales: { ...sales, invoices: [...sales.invoices, invoice], nextInvoice: sales.nextInvoice + 1 }, invoice };
}

export function updateDraftInvoice(books: Books, sales: Sales, id: string, input: InvoiceInput): Sales {
  const current = findInvoice(sales, id);
  if (current.state !== "draft") fail(`${current.number} has been sent; void it and issue a new one instead`);
  const next: Invoice = {
    ...cleanInvoice(books, sales, input),
    id,
    number: current.number,
    state: "draft",
    ...(current.estimateId ? { estimateId: current.estimateId } : {}),
  };
  return { ...sales, invoices: sales.invoices.map((i) => (i.id === id ? next : i)) };
}

/**
 * Drafts were never posted, so they can simply go. One made from an estimate
 * hands the estimate back as accepted, so it can be converted again.
 */
export function deleteDraftInvoice(sales: Sales, id: string): Sales {
  const current = findInvoice(sales, id);
  if (current.state !== "draft") fail(`${current.number} has been sent; void it instead`);
  const estimates = sales.estimates.map((e): Estimate => {
    if (e.id !== current.estimateId || e.invoiceId !== id) return e;
    const { invoiceId: _gone, ...rest } = e;
    return { ...rest, state: "accepted" };
  });
  return { ...sales, invoices: sales.invoices.filter((i) => i.id !== id), estimates };
}

/** Draft → open: posts the receivable, the income and the sales tax. */
export function sendInvoice(
  books: Books,
  sales: Sales,
  id: string,
  clock?: Clock,
): { books: Books; sales: Sales; entry: Entry } {
  const invoice = findInvoice(sales, id);
  if (invoice.state !== "draft") fail(`${invoice.number} has already been sent`);
  // Re-check against the books as they are now (an account may have gone inactive since).
  cleanInvoice(books, sales, invoice);
  const { tax, total } = invoiceTotals(invoice);
  if (total <= 0n) fail("The invoice total must be more than zero");
  const customer: NameRef = { kind: "customer", id: invoice.customerId };
  const r = postEntry(
    books,
    {
      date: invoice.date,
      memo: `Invoice ${invoice.number}`,
      source: { kind: "invoice", ref: invoice.id },
      lines: [
        { accountId: systemAccount(books, "accounts_receivable").id, debit: total, name: customer },
        ...invoice.lines.flatMap((l) => {
          const amount = lineAmount(l);
          return amount > 0n
            ? [
                {
                  accountId: l.accountId,
                  credit: amount,
                  name: customer,
                  ...(l.description ? { memo: l.description } : {}),
                  ...(l.tags ? { tags: l.tags } : {}),
                },
              ]
            : [];
        }),
        ...(tax > 0n ? [{ accountId: systemAccount(books, "sales_tax_payable").id, credit: tax, name: customer }] : []),
      ],
    },
    clock,
  );
  const sent: Invoice = { ...invoice, state: "sent", entryId: r.entry.id };
  return { books: r.books, sales: { ...sales, invoices: sales.invoices.map((i) => (i.id === id ? sent : i)) }, entry: r.entry };
}

const livePayments = (sales: Sales) => sales.payments.filter((p) => !p.voidEntryId);
const liveBillPayments = (sales: Sales) => sales.billPayments.filter((p) => !p.voidEntryId);

/** What's been paid against an invoice (optionally, by payments dated on or before `asOf`). */
export function invoicePaid(sales: Sales, invoiceId: string, asOf?: IsoDate): Cents {
  return sum(
    livePayments(sales)
      .filter((p) => !asOf || p.date <= asOf)
      .flatMap((p) => p.applications.filter((a) => a.invoiceId === invoiceId).map((a) => a.amount)),
  );
}

/** Total less payments applied. Drafts and void invoices owe nothing. */
export function invoiceBalance(sales: Sales, invoice: Invoice, asOf?: IsoDate): Cents {
  if (invoice.state !== "sent") return 0n;
  return invoiceTotals(invoice).total - invoicePaid(sales, invoice.id, asOf);
}

export type InvoiceStatus = "draft" | "open" | "partially_paid" | "paid" | "overdue" | "void";

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  open: "Open",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

function derivedStatus(total: Cents, balance: Cents, dueDate: IsoDate, today: IsoDate): InvoiceStatus {
  if (balance <= 0n) return "paid";
  if (dueDate < today) return "overdue";
  return balance < total ? "partially_paid" : "open";
}

export function invoiceStatus(sales: Sales, invoice: Invoice, today: IsoDate): InvoiceStatus {
  if (invoice.state === "draft" || invoice.state === "void") return invoice.state;
  return derivedStatus(invoiceTotals(invoice).total, invoiceBalance(sales, invoice), invoice.dueDate, today);
}

/**
 * Cancels an invoice. A draft is just marked void; a sent invoice has its
 * entry reversed, which is only allowed while no payment is applied to it.
 */
export function voidInvoice(
  books: Books,
  sales: Sales,
  id: string,
  options: { date?: IsoDate } = {},
  clock?: Clock,
): { books: Books; sales: Sales } {
  const invoice = findInvoice(sales, id);
  if (invoice.state === "void") fail(`${invoice.number} is already void`);
  const replace = (next: Invoice) => sales.invoices.map((i) => (i.id === id ? next : i));
  if (invoice.state === "draft") return { books, sales: { ...sales, invoices: replace({ ...invoice, state: "void" }) } };
  if (invoicePaid(sales, id) > 0n) fail(`${invoice.number} has payments applied; void those payments first`);
  const r = reverseEntry(books, invoice.entryId!, { ...options, memo: `Void invoice ${invoice.number}` }, clock);
  return { books: r.books, sales: { ...sales, invoices: replace({ ...invoice, state: "void", voidEntryId: r.entry.id }) } };
}

// ---- Payments received ---------------------------------------------------------

function depositAccount(books: Books, id: string): Account {
  const acct = account(books, id, "Deposit to");
  if (acct.type !== "bank" && acct.system !== "payments_to_deposit") fail("Deposit to a bank account or Payments to Deposit");
  return acct;
}

function bankAccount(books: Books, id: string): Account {
  const acct = account(books, id, "Paid from");
  if (acct.type !== "bank") fail("Choose the bank account the payment came from");
  return acct;
}

/** Combines repeated targets and checks each against what it still owes. */
function cleanApplications(
  apps: Application[],
  balanceOf: (id: string) => Cents,
  label: (id: string) => string,
): Application[] {
  const merged = new Map<string, Cents>();
  for (const a of apps) {
    if (typeof a.amount !== "bigint" || a.amount < 0n) fail("Amounts applied can't be negative");
    if (a.amount === 0n) continue;
    merged.set(a.targetId, (merged.get(a.targetId) ?? 0n) + a.amount);
  }
  for (const [id, amount] of merged) {
    const balance = balanceOf(id);
    if (amount > balance) fail(`${label(id)} has a balance of ${formatCents(balance)}; can't apply ${formatCents(amount)}`);
  }
  return [...merged].map(([targetId, amount]) => ({ targetId, amount }));
}

export function receivePayment(
  books: Books,
  sales: Sales,
  input: PaymentInput,
  clock?: Clock,
): { books: Books; sales: Sales; payment: Payment; entry: Entry } {
  const date = assertDate(input.date);
  findCustomer(sales, input.customerId);
  if (typeof input.amount !== "bigint" || input.amount <= 0n) fail("Enter the amount received");
  depositAccount(books, input.depositAccountId);
  const applications = cleanApplications(
    input.applications.map((a) => ({ targetId: a.invoiceId, amount: a.amount })),
    (id) => {
      const inv = findInvoice(sales, id);
      if (inv.customerId !== input.customerId) fail(`${inv.number} belongs to a different customer`);
      if (inv.state !== "sent") fail(`${inv.number} is ${inv.state === "draft" ? "a draft; send it first" : "void"}`);
      return invoiceBalance(sales, inv);
    },
    (id) => findInvoice(sales, id).number,
  ).map((a) => ({ invoiceId: a.targetId, amount: a.amount }));
  const applied = sum(applications.map((a) => a.amount));
  if (applied > input.amount) fail(`${formatCents(applied)} applied is more than the ${formatCents(input.amount)} received`);

  const id = `pmt-${sales.nextPayment}`;
  const customer: NameRef = { kind: "customer", id: input.customerId };
  const numbers = applications.map((a) => findInvoice(sales, a.invoiceId).number);
  const reference = input.reference?.trim();
  const r = postEntry(
    books,
    {
      date,
      memo: numbers.length ? `Payment for ${numbers.join(", ")}` : "Payment received",
      source: { kind: "payment", ref: id },
      lines: [
        { accountId: input.depositAccountId, debit: input.amount, name: customer, ...(reference ? { memo: reference } : {}) },
        { accountId: systemAccount(books, "accounts_receivable").id, credit: input.amount, name: customer },
      ],
    },
    clock,
  );
  const payment: Payment = {
    id,
    date,
    customerId: input.customerId,
    amount: input.amount,
    depositAccountId: input.depositAccountId,
    ...(reference ? { reference } : {}),
    applications,
    entryId: r.entry.id,
  };
  return {
    books: r.books,
    sales: { ...sales, payments: [...sales.payments, payment], nextPayment: sales.nextPayment + 1 },
    payment,
    entry: r.entry,
  };
}

/** Undoes a payment: reverses its entry, and the invoices it paid are owed again. */
export function voidPayment(
  books: Books,
  sales: Sales,
  id: string,
  options: { date?: IsoDate } = {},
  clock?: Clock,
): { books: Books; sales: Sales } {
  const payment = sales.payments.find((p) => p.id === id) ?? fail("Payment not found");
  if (payment.voidEntryId) fail("That payment is already void");
  const r = reverseEntry(books, payment.entryId, { ...options, memo: "Void payment received" }, clock);
  const next = { ...payment, voidEntryId: r.entry.id };
  return { books: r.books, sales: { ...sales, payments: sales.payments.map((p) => (p.id === id ? next : p)) } };
}

/** Received but not applied to any invoice: a credit the customer holds. */
export function unappliedAmount(payment: Payment): Cents {
  return payment.voidEntryId ? 0n : payment.amount - sum(payment.applications.map((a) => a.amount));
}

/** What a customer owes now: open invoice balances less unapplied credits. Matches their A/R. */
export function customerBalance(sales: Sales, customerId: string): Cents {
  const owed = sum(sales.invoices.filter((i) => i.customerId === customerId).map((i) => invoiceBalance(sales, i)));
  const credit = sum(sales.payments.filter((p) => p.customerId === customerId).map(unappliedAmount));
  return owed - credit;
}

/**
 * Suggested split of a payment across a customer's open invoices: oldest due
 * first, each up to its balance, until the amount runs out.
 */
export function suggestApplications(
  open: { id: string; dueDate: IsoDate; balance: Cents }[],
  amount: Cents,
): Map<string, Cents> {
  const out = new Map<string, Cents>();
  let left = amount;
  for (const o of [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))) {
    const take = left < o.balance ? left : o.balance;
    out.set(o.id, take > 0n ? take : 0n);
    left -= take > 0n ? take : 0n;
  }
  return out;
}

// ---- Bills -----------------------------------------------------------------------

/** Bill lines may hit any expense, or an asset that isn't cash or a receivable. */
export const isBillAccount = (a: Account): boolean =>
  baseOf(a) === "expense" || (baseOf(a) === "asset" && a.type !== "bank" && a.type !== "accounts_receivable");

export const billTotal = (bill: Pick<Bill, "lines">): Cents => sum(bill.lines.map((l) => l.amount));

const findBill = (sales: Sales, id: string) => sales.bills.find((b) => b.id === id) ?? fail("Bill not found");

const billLabel = (bill: Bill) => (bill.number ? `Bill ${bill.number}` : `Bill of ${bill.date}`);

/** Bills have no draft: entering one posts it. */
export function enterBill(
  books: Books,
  sales: Sales,
  input: BillInput,
  clock?: Clock,
): { books: Books; sales: Sales; bill: Bill; entry: Entry } {
  const vendor = findVendor(sales, input.vendorId);
  if (!vendor.active) fail("That vendor is inactive");
  const date = assertDate(input.date);
  const terms = input.terms ?? vendor.terms;
  const dueDate = input.dueDate ? assertDate(input.dueDate) : dueDateFor(date, terms);
  if (dueDate < date) fail("The due date is before the bill date");
  const number = input.number?.trim();
  if (
    number &&
    sales.bills.some((b) => !b.voidEntryId && b.vendorId === vendor.id && b.number?.toLowerCase() === number.toLowerCase())
  ) {
    fail(`You already entered bill ${number} from ${vendor.name}`);
  }
  if (input.lines.length === 0) fail("Add at least one line");
  const lines = input.lines.map((l, i): BillLine => {
    const where = `Line ${i + 1}`;
    if (!isBillAccount(account(books, l.accountId, where))) fail(`${where}: choose an expense or asset account`);
    if (typeof l.amount !== "bigint" || l.amount <= 0n) fail(`${where}: enter an amount more than zero`);
    const tags = cleanTags(l.tags);
    return { description: l.description.trim(), accountId: l.accountId, amount: l.amount, ...(tags ? { tags } : {}) };
  });
  const attachments = (input.attachments ?? []).map(cleanAttachment);

  const id = `bill-${sales.nextBill}`;
  const name: NameRef = { kind: "vendor", id: vendor.id };
  const memo = input.memo?.trim();
  const label = number ? `Bill ${number}` : "Bill";
  const r = postEntry(
    books,
    {
      date,
      memo: memo ? `${label}: ${memo}` : label,
      source: { kind: "bill", ref: id },
      lines: [
        ...lines.map((l) => ({
          accountId: l.accountId,
          debit: l.amount,
          name,
          ...(l.description ? { memo: l.description } : {}),
          ...(l.tags ? { tags: l.tags } : {}),
        })),
        { accountId: systemAccount(books, "accounts_payable").id, credit: billTotal({ lines }), name },
      ],
    },
    clock,
  );
  const bill: Bill = {
    id,
    vendorId: vendor.id,
    ...(number ? { number } : {}),
    date,
    dueDate,
    terms,
    lines,
    ...(memo ? { memo } : {}),
    ...(attachments.length ? { attachments } : {}),
    entryId: r.entry.id,
  };
  return { books: r.books, sales: { ...sales, bills: [...sales.bills, bill], nextBill: sales.nextBill + 1 }, bill, entry: r.entry };
}

// ---- Bill attachments --------------------------------------------------------------

const ATTACHMENT_TYPES = /^(image\/[a-z0-9.+-]+|application\/pdf)$/;

function cleanAttachment(ref: AttachmentRef): AttachmentRef {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(ref.attachmentId)) fail("That attachment id isn't valid");
  if (!/^[0-9a-f]{64}$/.test(ref.sha256)) fail("That attachment's fingerprint isn't valid");
  if (!ATTACHMENT_TYPES.test(ref.type)) fail("Attach a photo or a PDF");
  if (!Number.isInteger(ref.size) || ref.size <= 0) fail("That file is empty");
  if (ref.size > MAX_ATTACHMENT_BYTES) fail("Files can be at most 10 MB");
  const name = ref.name.trim().slice(0, 200) || "receipt";
  return { attachmentId: ref.attachmentId, sha256: ref.sha256, type: ref.type, size: ref.size, name };
}

/** Adds a receipt to a bill. Nothing posts: the file isn't part of the entry. */
export function attachToBill(sales: Sales, billId: string, ref: AttachmentRef): Sales {
  const bill = findBill(sales, billId);
  const clean = cleanAttachment(ref);
  if (bill.attachments?.some((a) => a.attachmentId === clean.attachmentId)) fail("That file is already attached");
  const next: Bill = { ...bill, attachments: [...(bill.attachments ?? []), clean] };
  return { ...sales, bills: sales.bills.map((b) => (b.id === billId ? next : b)) };
}

export function detachFromBill(sales: Sales, billId: string, attachmentId: string): Sales {
  const bill = findBill(sales, billId);
  const left = (bill.attachments ?? []).filter((a) => a.attachmentId !== attachmentId);
  if (left.length === (bill.attachments ?? []).length) fail("That file isn't attached to this bill");
  const { attachments: _old, ...rest } = bill;
  const next: Bill = left.length ? { ...rest, attachments: left } : rest;
  return { ...sales, bills: sales.bills.map((b) => (b.id === billId ? next : b)) };
}

/** Every attachment any bill refers to (what a backup must carry). */
export const attachmentIds = (sales: Sales): string[] => sales.bills.flatMap((b) => (b.attachments ?? []).map((a) => a.attachmentId));

export function billPaid(sales: Sales, billId: string, asOf?: IsoDate): Cents {
  return sum(
    liveBillPayments(sales)
      .filter((p) => !asOf || p.date <= asOf)
      .flatMap((p) => p.applications.filter((a) => a.billId === billId).map((a) => a.amount)),
  );
}

export function billBalance(sales: Sales, bill: Bill, asOf?: IsoDate): Cents {
  if (bill.voidEntryId) return 0n;
  return billTotal(bill) - billPaid(sales, bill.id, asOf);
}

export type BillStatus = Exclude<InvoiceStatus, "draft">;

export function billStatus(sales: Sales, bill: Bill, today: IsoDate): BillStatus {
  if (bill.voidEntryId) return "void";
  return derivedStatus(billTotal(bill), billBalance(sales, bill), bill.dueDate, today) as BillStatus;
}

export function voidBill(
  books: Books,
  sales: Sales,
  id: string,
  options: { date?: IsoDate } = {},
  clock?: Clock,
): { books: Books; sales: Sales } {
  const bill = findBill(sales, id);
  if (bill.voidEntryId) fail(`${billLabel(bill)} is already void`);
  if (billPaid(sales, id) > 0n) fail(`${billLabel(bill)} has payments applied; void those payments first`);
  const r = reverseEntry(books, bill.entryId, { ...options, memo: `Void ${billLabel(bill).toLowerCase()}` }, clock);
  const next = { ...bill, voidEntryId: r.entry.id };
  return { books: r.books, sales: { ...sales, bills: sales.bills.map((b) => (b.id === id ? next : b)) } };
}

// ---- Bill payments -----------------------------------------------------------------

export const billPaymentAmount = (p: Pick<BillPayment, "applications">): Cents => sum(p.applications.map((a) => a.amount));

/** Pays one or more of a vendor's bills from a bank account. The amount is what's applied. */
export function payBills(
  books: Books,
  sales: Sales,
  input: BillPaymentInput,
  clock?: Clock,
): { books: Books; sales: Sales; billPayment: BillPayment; entry: Entry } {
  const date = assertDate(input.date);
  findVendor(sales, input.vendorId);
  bankAccount(books, input.bankAccountId);
  const applications = cleanApplications(
    input.applications.map((a) => ({ targetId: a.billId, amount: a.amount })),
    (id) => {
      const bill = findBill(sales, id);
      if (bill.vendorId !== input.vendorId) fail(`${billLabel(bill)} is from a different vendor`);
      if (bill.voidEntryId) fail(`${billLabel(bill)} is void`);
      return billBalance(sales, bill);
    },
    (id) => billLabel(findBill(sales, id)),
  ).map((a) => ({ billId: a.targetId, amount: a.amount }));
  const amount = billPaymentAmount({ applications });
  if (amount <= 0n) fail("Choose at least one bill and an amount to pay");

  const id = `bpmt-${sales.nextBillPayment}`;
  const name: NameRef = { kind: "vendor", id: input.vendorId };
  const reference = input.reference?.trim();
  const r = postEntry(
    books,
    {
      date,
      memo: `Bill payment${applications.length === 1 ? "" : `, ${applications.length} bills`}`,
      source: { kind: "bill_payment", ref: id },
      lines: [
        { accountId: systemAccount(books, "accounts_payable").id, debit: amount, name },
        { accountId: input.bankAccountId, credit: amount, name, ...(reference ? { memo: reference } : {}) },
      ],
    },
    clock,
  );
  const billPayment: BillPayment = {
    id,
    date,
    vendorId: input.vendorId,
    bankAccountId: input.bankAccountId,
    ...(reference ? { reference } : {}),
    applications,
    entryId: r.entry.id,
  };
  return {
    books: r.books,
    sales: { ...sales, billPayments: [...sales.billPayments, billPayment], nextBillPayment: sales.nextBillPayment + 1 },
    billPayment,
    entry: r.entry,
  };
}

export function voidBillPayment(
  books: Books,
  sales: Sales,
  id: string,
  options: { date?: IsoDate } = {},
  clock?: Clock,
): { books: Books; sales: Sales } {
  const payment = sales.billPayments.find((p) => p.id === id) ?? fail("Bill payment not found");
  if (payment.voidEntryId) fail("That bill payment is already void");
  const r = reverseEntry(books, payment.entryId, { ...options, memo: "Void bill payment" }, clock);
  const next = { ...payment, voidEntryId: r.entry.id };
  return { books: r.books, sales: { ...sales, billPayments: sales.billPayments.map((p) => (p.id === id ? next : p)) } };
}

/** Paid to a vendor by bill payments dated in the range (inclusive); voided payments don't count. For 1099s. */
export function paidToVendor(sales: Sales, vendorId: string, from: IsoDate, to: IsoDate): Cents {
  assertDate(from);
  assertDate(to);
  return sum(
    liveBillPayments(sales)
      .filter((p) => p.vendorId === vendorId && p.date >= from && p.date <= to)
      .map(billPaymentAmount),
  );
}

/** What you owe a vendor now. Matches their A/P. */
export function vendorBalance(sales: Sales, vendorId: string): Cents {
  return sum(sales.bills.filter((b) => b.vendorId === vendorId).map((b) => billBalance(sales, b)));
}

// ---- Aging and sales tax ---------------------------------------------------------------

export type AgingBucket = "current" | "days1to30" | "days31to60" | "days61to90" | "over90";

export const AGING_BUCKETS: { id: AgingBucket; label: string }[] = [
  { id: "current", label: "Current" },
  { id: "days1to30", label: "1–30 days" },
  { id: "days31to60", label: "31–60 days" },
  { id: "days61to90", label: "61–90 days" },
  { id: "over90", label: "Over 90 days" },
];

export type AgingRow = Record<AgingBucket, Cents> & { total: Cents };
export type Aging = { asOf: IsoDate; totals: AgingRow; byParty: (AgingRow & { partyId: string })[] };

const emptyRow = (): AgingRow => ({ current: 0n, days1to30: 0n, days31to60: 0n, days61to90: 0n, over90: 0n, total: 0n });

export function bucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return "current";
  if (daysPastDue <= 30) return "days1to30";
  if (daysPastDue <= 60) return "days31to60";
  if (daysPastDue <= 90) return "days61to90";
  return "over90";
}

function aging(asOf: IsoDate, items: { partyId: string; dueDate: IsoDate; balance: Cents }[]): Aging {
  const totals = emptyRow();
  const byParty = new Map<string, AgingRow & { partyId: string }>();
  for (const item of items) {
    if (item.balance === 0n) continue;
    const bucket = bucketFor(daysBetween(item.dueDate, asOf));
    const row = byParty.get(item.partyId) ?? { ...emptyRow(), partyId: item.partyId };
    row[bucket] += item.balance;
    row.total += item.balance;
    totals[bucket] += item.balance;
    totals.total += item.balance;
    byParty.set(item.partyId, row);
  }
  return { asOf, totals, byParty: [...byParty.values()] };
}

/** Open invoice balances as of a date, by how far past due they are. */
export function arAging(sales: Sales, asOf: IsoDate): Aging {
  assertDate(asOf);
  return aging(
    asOf,
    sales.invoices
      .filter((i) => i.state === "sent" && i.date <= asOf)
      .map((i) => ({ partyId: i.customerId, dueDate: i.dueDate, balance: invoiceBalance(sales, i, asOf) })),
  );
}

/** Open bill balances as of a date, by how far past due they are. */
export function apAging(sales: Sales, asOf: IsoDate): Aging {
  assertDate(asOf);
  return aging(
    asOf,
    sales.bills
      .filter((b) => !b.voidEntryId && b.date <= asOf)
      .map((b) => ({ partyId: b.vendorId, dueDate: b.dueDate, balance: billBalance(sales, b, asOf) })),
  );
}

export type SalesTaxSummary = { invoices: number; totalSales: Cents; taxableSales: Cents; tax: Cents };

/** Sales tax charged on invoices sent and dated in the range (inclusive). Void invoices don't count. */
export function salesTaxCollected(sales: Sales, from: IsoDate, to: IsoDate): SalesTaxSummary {
  assertDate(from);
  assertDate(to);
  const out: SalesTaxSummary = { invoices: 0, totalSales: 0n, taxableSales: 0n, tax: 0n };
  for (const inv of sales.invoices) {
    if (inv.state !== "sent" || inv.date < from || inv.date > to) continue;
    const t = invoiceTotals(inv);
    out.invoices += 1;
    out.totalSales += t.subtotal;
    out.taxableSales += t.taxable;
    out.tax += t.tax;
  }
  return out;
}
