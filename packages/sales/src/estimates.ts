// ---------------------------------------------------------------------------
// Estimates: quotes for work not yet done.
//
// An estimate has the same lines and tax as an invoice but never posts to
// the ledger. Its life: draft → sent → accepted or declined, and accepted (or
// still pending) → converted, which makes a draft invoice with the same lines,
// tags and tax rate. The two point at each other, and an estimate converts
// once. "Expired" is shown, not stored: a draft or sent estimate past its
// expiry date.
// ---------------------------------------------------------------------------

import { type Books, type IsoDate, assertDate } from "@pnw/ledger";
import {
  type Estimate,
  type EstimateState,
  type Invoice,
  type InvoiceLine,
  type Sales,
  SalesError,
  addDays,
  cleanInvoiceLines,
  cleanTaxRate,
  createInvoice,
  findCustomer,
  invoiceTotals,
} from "./sales";

export type EstimateInput = {
  customerId: string;
  date: IsoDate;
  /** Defaults to 30 days after the date. */
  expiryDate?: IsoDate;
  lines: InvoiceLine[];
  taxRateBp?: number;
  memo?: string;
};

export type EstimateStatus = EstimateState | "expired";

export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  converted: "Converted",
  expired: "Expired",
};

export const DEFAULT_ESTIMATE_DAYS = 30;

const fail = (message: string): never => {
  throw new SalesError(message);
};

const findEstimate = (sales: Sales, id: string) => sales.estimates.find((e) => e.id === id) ?? fail("Estimate not found");

function cleanEstimate(books: Books, sales: Sales, input: EstimateInput): Omit<Estimate, "id" | "number" | "state"> {
  const customer = findCustomer(sales, input.customerId);
  const date = assertDate(input.date);
  const expiryDate = input.expiryDate ? assertDate(input.expiryDate) : addDays(date, DEFAULT_ESTIMATE_DAYS);
  if (expiryDate < date) fail("The expiry date is before the estimate date");
  const lines = cleanInvoiceLines(books, input.lines);
  const memo = input.memo?.trim();
  return { customerId: customer.id, date, expiryDate, lines, taxRateBp: cleanTaxRate(input.taxRateBp), ...(memo ? { memo } : {}) };
}

export const estimateTotals = (e: Pick<Estimate, "lines" | "taxRateBp">) => invoiceTotals(e);

export function createEstimate(books: Books, sales: Sales, input: EstimateInput): { sales: Sales; estimate: Estimate } {
  if (!findCustomer(sales, input.customerId).active) fail("That customer is inactive");
  const estimate: Estimate = {
    ...cleanEstimate(books, sales, input),
    id: `est-${sales.nextEstimate}`,
    number: `EST-${String(sales.nextEstimate).padStart(4, "0")}`,
    state: "draft",
  };
  return { sales: { ...sales, estimates: [...sales.estimates, estimate], nextEstimate: sales.nextEstimate + 1 }, estimate };
}

/** Drafts and sent estimates can still change; once answered or converted they're settled. */
export function updateEstimate(books: Books, sales: Sales, id: string, input: EstimateInput): Sales {
  const current = findEstimate(sales, id);
  if (current.state !== "draft" && current.state !== "sent") fail(`${current.number} is ${current.state}; it can't be changed`);
  const next: Estimate = { ...cleanEstimate(books, sales, input), id, number: current.number, state: current.state };
  return { ...sales, estimates: sales.estimates.map((e) => (e.id === id ? next : e)) };
}

export function deleteEstimate(sales: Sales, id: string): Sales {
  const current = findEstimate(sales, id);
  if (current.state === "converted") fail(`${current.number} became an invoice; it stays as the record of that quote`);
  return { ...sales, estimates: sales.estimates.filter((e) => e.id !== id) };
}

/** Marks an estimate sent, accepted or declined. Converted estimates are final. */
export function markEstimate(sales: Sales, id: string, state: "sent" | "accepted" | "declined"): Sales {
  const current = findEstimate(sales, id);
  if (!["sent", "accepted", "declined"].includes(state)) fail("An estimate can be marked sent, accepted or declined");
  if (current.state === "converted") fail(`${current.number} has already been converted to an invoice`);
  if (current.state === state) fail(`${current.number} is already ${state}`);
  return { ...sales, estimates: sales.estimates.map((e) => (e.id === id ? { ...e, state } : e)) };
}

export function estimateStatus(estimate: Estimate, today: IsoDate): EstimateStatus {
  if ((estimate.state === "draft" || estimate.state === "sent") && estimate.expiryDate < today) return "expired";
  return estimate.state;
}

/**
 * Makes a draft invoice from an estimate: same customer, lines, tags, tax rate
 * and memo, dated `date` (default: the estimate's date) with the customer's
 * terms. Nothing posts until that invoice is sent.
 */
export function convertEstimateToInvoice(
  books: Books,
  sales: Sales,
  id: string,
  options: { date?: IsoDate } = {},
): { sales: Sales; invoice: Invoice } {
  const estimate = findEstimate(sales, id);
  if (estimate.state === "converted") fail(`${estimate.number} has already been converted to an invoice`);
  if (estimate.state === "declined") fail(`${estimate.number} was declined; mark it accepted first`);
  const r = createInvoice(books, sales, {
    customerId: estimate.customerId,
    date: options.date ?? estimate.date,
    lines: estimate.lines,
    taxRateBp: estimate.taxRateBp,
    ...(estimate.memo ? { memo: estimate.memo } : {}),
  });
  const invoice: Invoice = { ...r.invoice, estimateId: estimate.id };
  const converted: Estimate = { ...estimate, state: "converted", invoiceId: invoice.id };
  return {
    sales: {
      ...r.sales,
      invoices: r.sales.invoices.map((i) => (i.id === invoice.id ? invoice : i)),
      estimates: r.sales.estimates.map((e) => (e.id === id ? converted : e)),
    },
    invoice,
  };
}
