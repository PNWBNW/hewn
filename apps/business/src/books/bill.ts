// ---------------------------------------------------------------------------
// An invoice as it reaches a customer (docs/CUSTOMERS.md, Step 1): what the
// customer needs to see it and pay it, and nothing of the business's books
// (no accounts, no tags, no entry). Sent in the conversation the two share
// once connected (books/connections.ts), as an `invoice` message; a voided
// invoice follows as `invoice_void`. On the customer's side, the bills are
// worked out from those messages.
//
// Amounts are cents, as decimal strings, as everywhere in a message. Pure.
// ---------------------------------------------------------------------------

import { type Invoice, type Sales, invoiceTotals } from "@pnw/sales";
import type { Connections } from "./connections";
import { type BillPayment, billKey } from "./customer";
import type { ThreadItem } from "./thread";

export type BillLine = { description: string; quantity: string; unitPrice: string; taxable?: true };

export type Bill = {
  v: 1;
  /** The business's id for the invoice: how a void or a payment names it. */
  id: string;
  number: string;
  /** YYYY-MM-DD */
  date: string;
  dueDate: string;
  lines: BillLine[];
  /** Sales tax in basis points (825 = 8.25%). */
  taxRateBp: number;
  subtotal: string;
  tax: string;
  total: string;
  memo?: string;
};

export const MAX_BILL_LINES = 60;
export const MAX_BILL_TEXT = 300;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CENTS = /^\d{1,15}$/;
const QUANTITY = /^\d{1,9}(\.\d{1,2})?$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export class BillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillError";
  }
}

const text = (v: unknown, what: string, max = MAX_BILL_TEXT): string => {
  if (typeof v !== "string" || [...v].length > max) throw new BillError(`${what} is at most ${max} characters`);
  return v;
};

/** A bill as it arrived; throws when anything in it is off, including totals that don't add up. */
export function validateBill(raw: unknown): Bill {
  const r = raw as Record<string, unknown> | null;
  if (!r || r.v !== 1) throw new BillError("That isn't an invoice this app knows");
  if (typeof r.id !== "string" || !ID.test(r.id)) throw new BillError("An invoice needs its id");
  const number = text(r.number, "An invoice number", 40);
  if (!number.trim()) throw new BillError("An invoice needs its number");
  if (typeof r.date !== "string" || !DATE.test(r.date) || typeof r.dueDate !== "string" || !DATE.test(r.dueDate)) throw new BillError("An invoice needs its dates");
  if (!Array.isArray(r.lines) || r.lines.length === 0 || r.lines.length > MAX_BILL_LINES) throw new BillError(`An invoice has 1 to ${MAX_BILL_LINES} lines`);
  const lines = r.lines.map((l: unknown): BillLine => {
    const x = l as Record<string, unknown> | null;
    if (!x || typeof x.quantity !== "string" || !QUANTITY.test(x.quantity) || typeof x.unitPrice !== "string" || !CENTS.test(x.unitPrice)) throw new BillError("An invoice line is damaged");
    return { description: text(x.description, "A line's description"), quantity: x.quantity, unitPrice: x.unitPrice, ...(x.taxable === true ? { taxable: true as const } : {}) };
  });
  if (typeof r.taxRateBp !== "number" || !Number.isInteger(r.taxRateBp) || r.taxRateBp < 0 || r.taxRateBp > 10_000) throw new BillError("An invoice's tax rate is damaged");
  for (const k of ["subtotal", "tax", "total"] as const) if (typeof r[k] !== "string" || !CENTS.test(r[k] as string)) throw new BillError("An invoice's totals are damaged");
  const bill: Bill = { v: 1, id: r.id, number, date: r.date, dueDate: r.dueDate, lines, taxRateBp: r.taxRateBp, subtotal: r.subtotal as string, tax: r.tax as string, total: r.total as string };
  if (r.memo !== undefined) bill.memo = text(r.memo, "A memo", 1000);
  if (BigInt(bill.subtotal) + BigInt(bill.tax) !== BigInt(bill.total)) throw new BillError("An invoice's totals don't add up");
  return bill;
}

/** What a customer gets for one of the business's invoices. */
export function billOf(invoice: Invoice): Bill {
  const t = invoiceTotals(invoice);
  return validateBill({
    v: 1,
    id: invoice.id,
    number: invoice.number,
    date: invoice.date,
    dueDate: invoice.dueDate,
    lines: invoice.lines.map((l) => ({ description: l.description.slice(0, MAX_BILL_TEXT), quantity: l.quantity, unitPrice: l.unitPrice.toString(), ...(l.taxable ? { taxable: true } : {}) })),
    taxRateBp: invoice.taxRateBp,
    subtotal: t.subtotal.toString(),
    tax: t.tax.toString(),
    total: t.total.toString(),
    ...(invoice.memo ? { memo: invoice.memo.slice(0, 1000) } : {}),
  });
}

// ---- The business's side ------------------------------------------------------

/** Where an invoice stands with a connected customer, from what the business sent them. */
export type Delivery = "not_sent" | "sent" | "void_sent";

export function deliveryOf(items: readonly ThreadItem[] | undefined, invoiceId: string): Delivery {
  let state: Delivery = "not_sent";
  for (const i of items ?? []) {
    if (!i.mine) continue;
    if (i.body.type === "invoice" && i.body.bill.id === invoiceId && state === "not_sent") state = "sent";
    if (i.body.type === "invoice_void" && i.body.id === invoiceId) state = "void_sent";
  }
  return state;
}

/** The business's invoices a connected customer should hear about: sent ones not delivered yet, and delivered ones voided since. */
export function invoicesToDeliver(sales: Pick<Sales, "invoices">, conns: Connections | undefined): { invoice: Invoice; address: string; send: "invoice" | "void" }[] {
  const byCustomer = new Map(Object.values(conns ?? {}).filter((c) => c.customerId && c.mine && c.theirs).map((c) => [c.customerId!, c]));
  const out: { invoice: Invoice; address: string; send: "invoice" | "void" }[] = [];
  for (const inv of sales.invoices) {
    const conn = byCustomer.get(inv.customerId);
    if (!conn) continue;
    const delivered = deliveryOf(conn.thread?.items, inv.id);
    if (inv.state === "sent" && delivered === "not_sent") out.push({ invoice: inv, address: conn.address, send: "invoice" });
    if (inv.state === "void" && delivered === "sent") out.push({ invoice: inv, address: conn.address, send: "void" });
  }
  return out;
}

// ---- The customer's side ------------------------------------------------------

export type BillStatus = "open" | "paying" | "paid" | "void";

/** A bill as the customer's portal shows it: from which business, where it stands, and its payment from Shield, if any. */
export type BillView = { address: string; business: string; bill: Bill; receivedAt?: string; status: BillStatus; payment?: BillPayment };

/** Where a bill stands once its payment is taken into account: paid once the transfer settled, paying while it's on its way or unknown. */
function withPayment(view: BillView, payment: BillPayment | undefined): BillView {
  if (!payment) return view;
  const status: BillStatus = payment.settlement.status === "settled" ? "paid" : payment.settlement.status === "pending" ? "paying" : view.status;
  return { ...view, payment, status: view.status === "void" && status !== "paid" ? "void" : status };
}

/** Every bill from every connected business: the latest copy of each, voided when the business said so, paid when it was. Newest first. */
export function billsIn(conns: Connections | undefined, payments?: Record<string, BillPayment>): BillView[] {
  const out: BillView[] = [];
  for (const c of Object.values(conns ?? {})) {
    const bills = new Map<string, BillView>();
    for (const i of c.thread?.items ?? []) {
      if (i.mine) continue;
      if (i.body.type === "invoice") {
        const before = bills.get(i.body.bill.id);
        bills.set(i.body.bill.id, { address: c.address, business: c.name, bill: i.body.bill, ...(i.receivedAt ? { receivedAt: i.receivedAt } : {}), status: before?.status === "void" ? "void" : "open" });
      }
      if (i.body.type === "invoice_void") {
        const before = bills.get(i.body.id);
        if (before) bills.set(i.body.id, { ...before, status: "void" });
      }
    }
    out.push(...[...bills.values()].map((v) => withPayment(v, payments?.[billKey(v.address, v.bill.id)])));
  }
  return out.sort((a, b) => b.bill.date.localeCompare(a.bill.date) || b.bill.number.localeCompare(a.bill.number));
}
