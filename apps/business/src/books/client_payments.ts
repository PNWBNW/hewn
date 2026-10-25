// ---------------------------------------------------------------------------
// A business taking a customer's payment from Shield into its books
// (docs/CUSTOMERS.md, Step 1). The customer's message says which invoice it
// paid and with which transfer; the business records it only once its own
// Shield account shows that transfer coming in for that amount: in its For
// review list, or, when For review hasn't listed it (the books weren't
// started from Shield, say), in the account's own stablecoin records, read on the
// spot (`arrived`). The customer's word alone moves nothing. Recording it
// posts a payment against the invoice (receivable to the Shield account) and
// marks the transfer recorded in For review, adding it there if it wasn't,
// so the money is never counted twice. Pure.
// ---------------------------------------------------------------------------

import type { IsoDate } from "@pnw/ledger";
import { ensureRailAccount } from "@pnw/payroll";
import { invoiceBalance, receivePayment } from "@pnw/sales";
import type { Company } from "./company";
import { itemsOf } from "./connections";
import { minorToCents } from "./opening";
import { type ReviewItem, emptyReview, validateReview } from "./review";

export type ClientPayment = {
  /** The customer's account. */
  address: string;
  customerId: string;
  messageId: string;
  invoiceId: string;
  number: string;
  /** Cents, as the customer said. */
  cents: bigint;
  transactionId: string;
  /** The transfer as the business's own account shows it, when it does and the amount matches: its day and six-decimal amount. */
  seen?: { date: string; minor: string; inReview: boolean };
  /** Why it can't be recorded yet, or at all. */
  problem?: string;
};

/** A transfer into the business's account as its own records show it (chain/review_feed.ts `receivedRecords`). */
export type Arrived = { date: string; minor: string };

/** Payments customers told the business about that aren't in its books yet, each with what its own account shows. */
export function paymentsToRecord(company: Pick<Company, "clients" | "sales" | "review" | "rail">, arrived?: ReadonlyMap<string, Arrived>): ClientPayment[] {
  const recorded = new Set(company.sales.payments.flatMap((p) => (p.reference ? [p.reference] : [])));
  const out: ClientPayment[] = [];
  for (const c of Object.values(company.clients ?? {})) {
    if (!c.customerId) continue;
    for (const item of itemsOf(c)) {
      if (item.mine || item.body.type !== "payment") continue;
      const b = item.body;
      if (recorded.has(b.transactionId) || out.some((o) => o.transactionId === b.transactionId)) continue;
      const p: ClientPayment = { address: c.address, customerId: c.customerId, messageId: item.id, invoiceId: b.invoiceId, number: b.number, cents: BigInt(b.amount), transactionId: b.transactionId };
      const inv = company.sales.invoices.find((i) => i.id === b.invoiceId);
      const listed = company.review?.items.find((r) => r.id === b.transactionId);
      const found = arrived?.get(b.transactionId);
      const start = company.rail?.start?.date;
      if (!inv || inv.customerId !== c.customerId) p.problem = `${b.number} isn't one of this customer's invoices`;
      else if (listed) {
        if (listed.direction !== "in" || minorToCents(BigInt(listed.minor)) !== p.cents) p.problem = "Your Shield account shows that transfer with a different amount. Look at it under For review.";
        else if (listed.status !== "new") p.problem = "That transfer was already handled under For review. Undo it there to record it here.";
        else p.seen = { date: listed.date, minor: listed.minor, inReview: true };
      } else if (!found) p.problem = "Not found in your Shield account yet. Tap Check in a minute; a transfer can take a little while to show.";
      else if (minorToCents(BigInt(found.minor)) !== p.cents) p.problem = "Your Shield account shows that transfer with a different amount.";
      else if (start && found.date < start) p.problem = `That transfer came in before your books started from Shield (${start}), so it's already in your opening balance. Record it by hand if you need to.`;
      else p.seen = { date: found.date, minor: found.minor, inReview: false };
      out.push(p);
    }
  }
  return out;
}

/**
 * Records one: a payment against its invoice, into the Shield account, dated when the transfer
 * landed, referenced by the transfer; the review item is marked recorded with that entry. Anything
 * over the invoice's balance stays unapplied, as a credit, the way a payment received by hand does.
 */
export function recordClientPayment(company: Company, transactionId: string, arrived?: ReadonlyMap<string, Arrived>): Company {
  const p = paymentsToRecord(company, arrived).find((x) => x.transactionId === transactionId);
  if (!p) throw new Error("That payment is already in your books, or isn't waiting");
  if (!p.seen) throw new Error(p.problem ?? "That payment can't be recorded yet");
  const { books: withShield, accountId } = ensureRailAccount(company.books);
  const inv = company.sales.invoices.find((i) => i.id === p.invoiceId)!;
  const apply = [invoiceBalance(company.sales, inv), p.cents].reduce((a, b) => (a < b ? a : b));
  const r = receivePayment(withShield, company.sales, {
    date: p.seen.date as IsoDate,
    customerId: p.customerId,
    amount: p.cents,
    depositAccountId: accountId,
    reference: p.transactionId,
    applications: apply > 0n ? [{ invoiceId: p.invoiceId, amount: apply }] : [],
  });
  const review = company.review ?? emptyReview();
  const recorded: ReviewItem = { id: transactionId, date: p.seen.date, direction: "in", minor: p.seen.minor, counterparty: p.address, kind: "transfer_private", status: "recorded", entryId: r.entry.id };
  return {
    ...company,
    books: r.books,
    sales: r.sales,
    // Marked recorded in For review, or added there as recorded, so a later check never lists it as new.
    review: validateReview({
      ...review,
      items: p.seen.inReview ? review.items.map((i) => (i.id === transactionId ? { ...i, status: "recorded" as const, entryId: r.entry.id } : i)) : [...review.items, recorded],
    }),
  };
}
