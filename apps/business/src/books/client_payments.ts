// ---------------------------------------------------------------------------
// A business taking a customer's payment from Shield into its books
// (docs/CUSTOMERS.md, Step 1). The customer's message says which invoice it
// paid, or that it paid without one and what for (decision 24), and with
// which transfer; the business records it only once its own
// Shield account shows that transfer coming in for that amount: in its For
// review list, or, when For review hasn't listed it (the books weren't
// started from Shield, say), in the account's own stablecoin records, read on the
// spot (`arrived`), and, when it names who sent it, from that customer's own
// account (not another account's, not the business's own, not a move within
// it). A transfer two customers both name is left to For review. The
// customer's word alone moves nothing. Recording it
// posts a payment against the invoice (receivable to the Shield account); one
// without an invoice goes to the customer's open invoices, oldest due first,
// the rest kept as their credit, as a payment received by hand would; and
// marks the transfer recorded in For review, adding it there if it wasn't,
// so the money is never counted twice. Pure.
// ---------------------------------------------------------------------------

import type { IsoDate } from "@pnw/ledger";
import { ensureRailAccount } from "@pnw/payroll";
import { type Sales, invoiceBalance, receivePayment, suggestApplications } from "@pnw/sales";
import type { Company } from "./company";
import { type Connection, itemsOf } from "./connections";
import { minorToCents } from "./opening";
import { type ReviewItem, emptyReview, validateReview } from "./review";
import type { ThreadBody } from "./thread";

type PaymentBody = Extract<ThreadBody, { type: "payment" }>;

export type ClientPayment = {
  /** The customer's account. */
  address: string;
  customerId: string;
  messageId: string;
  /** The invoice it paid; none when the customer paid without one. */
  invoiceId?: string;
  number?: string;
  /** What the customer said it's for, when they paid without an invoice. */
  note?: string;
  /** Cents, as the customer said. */
  cents: bigint;
  transactionId: string;
  /** Without an invoice: what recording it applies it to, oldest due first; the rest stays as the customer's credit. */
  applies?: { invoiceId: string; number: string; amount: bigint }[];
  /** The transfer as the business's own account shows it, when it does and the amount matches: its id there, day and six-decimal amount. */
  seen?: { txId: string; date: string; minor: string; inReview: boolean };
  /** Who sent the transfer, as the business's own account shows it; none when Shield doesn't say. */
  sender?: string;
  /** Why it can't be recorded yet, or at all. */
  problem?: string;
};

/** A transfer into the business's account as its own records show it (chain/review_feed.ts `receivedRecords`): who sent it, when Shield says. */
export type Arrived = { id: string; date: string; minor: string; from?: string | null };

/** A payment without an invoice, spread over the customer's open invoices, oldest due first. */
function applyToOpen(sales: Sales, customerId: string, cents: bigint): { invoiceId: string; number: string; amount: bigint }[] {
  const open = sales.invoices
    .filter((i) => i.customerId === customerId && i.state === "sent")
    .map((i) => ({ id: i.id, number: i.number, dueDate: i.dueDate, balance: invoiceBalance(sales, i) }))
    .filter((i) => i.balance > 0n);
  const split = suggestApplications(open, cents);
  return open.flatMap((i) => {
    const amount = split.get(i.id) ?? 0n;
    return amount > 0n ? [{ invoiceId: i.id, number: i.number, amount }] : [];
  });
}

/** Why a transfer shown with this sender can't be this customer's payment; null when it can, or when the sender isn't named. */
function senderProblem(sender: string | null | undefined, customer: string, own: string | undefined): string | null {
  if (!sender) return null;
  if (sender === own) return "Your Shield account shows that transfer came from your own account, not from this customer. Look at it under For review.";
  if (sender !== customer) return "Your Shield account shows that transfer came from another account, not from this customer. Look at it under For review.";
  return null;
}

/** Payments customers told the business about that aren't in its books yet, each with what its own account shows. */
export function paymentsToRecord(company: Pick<Company, "clients" | "sales" | "review" | "rail">, arrived?: ReadonlyMap<string, Arrived>): ClientPayment[] {
  // A voided payment no longer holds its transfer: it can be recorded again.
  const recorded = new Set(company.sales.payments.flatMap((p) => (p.reference && !p.voidEntryId ? [p.reference] : [])));
  // Transfers already in the books: never matched to a second payment.
  const claimed = new Set([...recorded, ...(company.review?.items ?? []).filter((i) => i.status !== "new").map((i) => i.id)]);
  const own = company.rail?.address;
  // Each customer's word, by the transfer it names: a customer's first message for it, and every customer naming it.
  const claims = new Map<string, { c: Connection; id: string; b: PaymentBody }[]>();
  for (const c of Object.values(company.clients ?? {})) {
    if (!c.customerId) continue;
    for (const item of itemsOf(c)) {
      if (item.mine || item.body.type !== "payment") continue;
      const b = item.body;
      if (recorded.has(b.transactionId)) continue;
      const named = claims.get(b.transactionId) ?? [];
      if (named.some((n) => n.c.address === c.address)) continue;
      claims.set(b.transactionId, [...named, { c, id: item.id, b }]);
    }
  }
  const out: ClientPayment[] = [];
  for (const named of claims.values()) {
    for (const { c, id, b } of named) {
      const customerId = c.customerId!;
      const inv = b.invoiceId ? company.sales.invoices.find((i) => i.id === b.invoiceId) : undefined;
      const theirs = inv && inv.customerId === customerId ? inv : undefined;
      // The invoice's number as the books have it; the customer's words only when the books don't have that invoice for them.
      const number = theirs?.number ?? b.number;
      const p: ClientPayment = {
        address: c.address,
        customerId,
        messageId: id,
        ...(b.invoiceId ? { invoiceId: b.invoiceId, ...(number ? { number } : {}) } : {}),
        ...(b.note ? { note: b.note } : {}),
        cents: BigInt(b.amount),
        transactionId: b.transactionId,
      };
      // The transfer by its id; or, should Shield file the record under another id, the one transfer from this customer for exactly this amount.
      const byId = arrived?.get(b.transactionId);
      const bySender = [...(arrived?.values() ?? [])].filter((a) => a.from === c.address && minorToCents(BigInt(a.minor)) === p.cents && !claimed.has(a.id) && !out.some((o) => o.seen?.txId === a.id));
      const found = byId ?? (bySender.length === 1 ? bySender[0] : undefined);
      const listed = company.review?.items.find((r) => r.id === b.transactionId || r.id === found?.id);
      // Who sent it, as this account shows it: recorded for a customer only when it was that customer.
      const sender = listed?.counterparty ?? found?.from ?? undefined;
      if (sender) p.sender = sender;
      const notFrom = listed?.within
        ? "Your Shield account shows that transfer as a move within your own account, not a payment from this customer. Look at it under For review."
        : (senderProblem(listed?.counterparty, c.address, own) ?? senderProblem(found?.from, c.address, own));
      const start = company.rail?.start?.date;
      if (b.invoiceId && !theirs) p.problem = `${b.number ?? "That invoice"} isn't one of this customer's invoices`;
      else if (named.length > 1) p.problem = "More than one customer named this transfer; record it by hand under For review.";
      else if (notFrom) p.problem = notFrom;
      else if (listed) {
        if (listed.direction !== "in" || minorToCents(BigInt(listed.minor)) !== p.cents) p.problem = "Your Shield account shows that transfer with a different amount. Look at it under For review.";
        else if (listed.status !== "new") p.problem = "That transfer was already handled under For review. Undo it there to record it here.";
        else p.seen = { txId: listed.id, date: listed.date, minor: listed.minor, inReview: true };
      } else if (!found) p.problem = "Not found in your Shield account yet. Tap Check in a minute; a transfer can take a little while to show.";
      else if (minorToCents(BigInt(found.minor)) !== p.cents) p.problem = "Your Shield account shows that transfer with a different amount.";
      else if (start && found.date < start) p.problem = `That transfer came in before your books started from Shield (${start}), so it's already in your opening balance. Record it by hand if you need to.`;
      else p.seen = { txId: found.id, date: found.date, minor: found.minor, inReview: false };
      if (!b.invoiceId) p.applies = applyToOpen(company.sales, customerId, p.cents);
      out.push(p);
    }
  }
  return out;
}

/**
 * Records one: a payment against its invoice (or, without one, against the customer's open
 * invoices, oldest due first), into the Shield account, dated when the transfer landed, referenced
 * by the transfer; the review item is marked recorded with that entry. Anything over what's owed
 * stays unapplied, as a credit, the way a payment received by hand does.
 */
export function recordClientPayment(company: Company, transactionId: string, arrived?: ReadonlyMap<string, Arrived>): Company {
  const p = paymentsToRecord(company, arrived).find((x) => x.transactionId === transactionId);
  if (!p) throw new Error("That payment is already in your books, or isn't waiting");
  if (!p.seen) throw new Error(p.problem ?? "That payment can't be recorded yet");
  const { books: withShield, accountId } = ensureRailAccount(company.books);
  const inv = p.invoiceId ? company.sales.invoices.find((i) => i.id === p.invoiceId) : undefined;
  const apply = inv ? [invoiceBalance(company.sales, inv), p.cents].reduce((a, b) => (a < b ? a : b)) : 0n;
  const applications = inv ? (apply > 0n ? [{ invoiceId: inv.id, amount: apply }] : []) : (p.applies ?? []).map((a) => ({ invoiceId: a.invoiceId, amount: a.amount }));
  const r = receivePayment(withShield, company.sales, {
    date: p.seen.date as IsoDate,
    customerId: p.customerId,
    amount: p.cents,
    depositAccountId: accountId,
    reference: p.transactionId,
    applications,
  });
  const review = company.review ?? emptyReview();
  const recorded: ReviewItem = { id: p.seen.txId, date: p.seen.date, direction: "in", minor: p.seen.minor, counterparty: p.address, kind: "transfer_private", status: "recorded", entryId: r.entry.id };
  return {
    ...company,
    books: r.books,
    sales: r.sales,
    // Marked recorded in For review, or added there as recorded, so a later check never lists it as new.
    review: validateReview({
      ...review,
      items: p.seen.inReview ? review.items.map((i) => (i.id === p.seen!.txId ? { ...i, status: "recorded" as const, entryId: r.entry.id } : i)) : [...review.items, recorded],
    }),
  };
}
