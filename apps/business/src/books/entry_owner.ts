// ---------------------------------------------------------------------------
// Who owns an entry, and voiding one from Transactions.
//
// An entry posted by a form or a list is undone where it was made, so the
// record and the books stay in step: an invoice, a customer's payment, a bill
// or a bill payment (each record's `entryId`, @pnw/sales) is voided from its
// form; a movement accepted or matched in For review (`entryId`, review.ts) is
// undone there. A pay run's entries (`entryIds`, @pnw/payroll) and the entry
// that opened the books from Shield (`rail.start.entryId`) have no undo at all:
// a correcting entry fixes them. Owners are found from the records, never from
// the entry's own `source.kind`, so an entry that names a kind with no record
// behind it voids like any other. Payroll and sales tax payments have no record
// pointing at them and stay voidable here: nothing else can correct one.
//
// Pure: no React, no storage, no network.
// ---------------------------------------------------------------------------

import { type IsoDate, reverseEntry } from "@pnw/ledger";
import type { Company } from "./company";

export type EntryOwner = {
  /** What owns it. */
  kind: "sales" | "expenses" | "review" | "payroll" | "opening";
  /** Where it is undone, or where to post a correcting entry. */
  href: string;
  /** What to do instead of voiding it here. */
  label: string;
};

export class EntryOwnedError extends Error {
  readonly owner: EntryOwner;
  constructor(owner: EntryOwner) {
    super(owner.label);
    this.name = "EntryOwnedError";
    this.owner = owner;
  }
}

type Owned = Pick<Company, "sales" | "payroll" | "review" | "rail">;

const SALES: EntryOwner = { kind: "sales", href: "/sales", label: "Void it from Sales" };
const EXPENSES: EntryOwner = { kind: "expenses", href: "/expenses", label: "Void it from Expenses" };
const REVIEW: EntryOwner = { kind: "review", href: "/transactions?tab=review", label: "Undo it from For review" };
const PAY_RUN: EntryOwner = { kind: "payroll", href: "/transactions/new", label: "A pay run can't be voided; post a correcting entry" };
const OPENING: EntryOwner = { kind: "opening", href: "/transactions/new", label: "The opening balance from Shield can't be voided; post a correcting entry" };

/** Every entry a record points at, by entry id, with where it is undone. Build it once for a list. */
export function entryOwners(company: Owned): Map<string, EntryOwner> {
  const owners = new Map<string, EntryOwner>();
  const own = (id: string | undefined, owner: EntryOwner) => {
    if (id && !owners.has(id)) owners.set(id, owner);
  };
  for (const i of company.sales.invoices) own(i.entryId, SALES);
  for (const p of company.sales.payments) own(p.entryId, SALES);
  for (const b of company.sales.bills) own(b.entryId, EXPENSES);
  for (const p of company.sales.billPayments) own(p.entryId, EXPENSES);
  for (const run of company.payroll.runs) for (const id of run.entryIds) own(id, PAY_RUN);
  for (const item of company.review?.items ?? []) if (item.status === "accepted" || item.status === "recorded") own(item.entryId, REVIEW);
  own(company.rail?.start?.entryId, OPENING);
  return owners;
}

/** What owns one entry, or undefined when nothing does and it can be voided from Transactions. */
export const entryOwner = (company: Owned, entryId: string): EntryOwner | undefined => entryOwners(company).get(entryId);

/**
 * Voids an entry from Transactions with a reversing entry (the ledger's `reverseEntry`), dated
 * `options.date` or the original's date. Refuses an entry a record owns, saying where it is undone.
 * A closed period's refusal comes through as the ledger's, so the caller can offer another date.
 */
export function voidEntry(company: Company, entryId: string, options: { date?: IsoDate } = {}): Company {
  const owner = entryOwner(company, entryId);
  if (owner) throw new EntryOwnedError(owner);
  const { books } = reverseEntry(company.books, entryId, options.date ? { date: options.date } : {});
  return { ...company, books };
}
