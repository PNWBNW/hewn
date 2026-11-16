// ---------------------------------------------------------------------------
// Posting a journal entry typed by hand (Transactions → New journal entry).
//
// The books' other modules post through the ledger's `postEntry` with their
// own source kinds (an invoice, a bill, a pay run). A journal entry is always
// `manual`: its input has no source, and one that brings a source is refused.
// Every name a line carries must be a customer, vendor or team member these
// books already hold, by id. Screens and the chain side post through here, not
// the ledger (posting_boundary.test.ts).
//
// Pure: no React, no storage, no network.
// ---------------------------------------------------------------------------

import { type IsoDate, type LineInput, postEntry } from "@pnw/ledger";
import type { Company } from "./company";

export class PostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostingError";
  }
}

export type JournalInput = { date: IsoDate; memo?: string; lines: LineInput[] };

type Parties = Pick<Company, "sales" | "payroll">;

const LABEL = { customer: "customer", vendor: "vendor", employee: "team member" } as const;

const idsOf = (company: Parties, kind: "customer" | "vendor" | "employee"): Set<string> =>
  new Set((kind === "customer" ? company.sales.customers : kind === "vendor" ? company.sales.vendors : company.payroll.workers).map((p) => p.id));

/** Posts a journal entry as `manual`, after checking every name on its lines. */
export function postJournalEntry(company: Company, input: JournalInput): Company {
  if ("source" in input) throw new PostingError("A journal entry is always manual");
  for (const line of input.lines) {
    const name = line.name;
    if (!name || name.kind === "other") continue;
    if (!idsOf(company, name.kind).has(name.id)) throw new PostingError(`A line names a ${LABEL[name.kind]} these books don't have. Choose one that exists, or add them first.`);
  }
  const { books } = postEntry(company.books, { date: input.date, ...(input.memo ? { memo: input.memo } : {}), source: { kind: "manual" }, lines: input.lines });
  return { ...company, books };
}

const fold = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The id of the customer or vendor a journal line's typed name means: its id, or its name (case
 * and spacing aside). Refuses a name nobody has, or one two of them share.
 */
export function partyNamed(company: Pick<Company, "sales">, kind: "customer" | "vendor", typed: string): string {
  const parties = kind === "customer" ? company.sales.customers : company.sales.vendors;
  const text = typed.trim();
  if (parties.some((p) => p.id === text)) return text;
  const hits = parties.filter((p) => fold(p.name) === fold(text));
  if (hits.length === 1) return hits[0]!.id;
  if (hits.length > 1) throw new PostingError(`More than one ${kind} is called "${text}". Rename one of them first.`);
  throw new PostingError(`No ${kind} is called "${text}". Add them first, by their registered name, then enter it here.`);
}
