// ---------------------------------------------------------------------------
// Matching a movement in For review to an entry already in the books (Joshua,
// 2026-10-26: the way a bank feed's Match keeps a deposit entered by hand from
// being counted again when the bank shows it). A waiting movement is offered
// the entries that moved the Shield account (or a set-aside in it) by the same
// amount the same way, near the same day, and not tied to another movement or
// undone. Matching posts nothing: the movement is tied to the entry (status
// recorded, `matched`), so the money counts once and the Dashboard check stays
// right. A match can be undone, which sends the movement back to be reviewed.
//
// Each candidate also says whether the movement's other side is the account of
// the customer or vendor the entry names (from the rail's party links, set when
// the party was found by registered name): the same, a different one, or not
// known when either account is missing. Matching to a different one is refused
// until the business confirms it; an unknown one is only labelled.
//
// Pure: no network, no React, no storage.
// ---------------------------------------------------------------------------

import type { Cents, Entry } from "@pnw/ledger";
import type { Company } from "./company";
import { isShieldFamily } from "./funds";
import { minorToCents } from "./opening";
import { type PartyKind, partyLinkFor } from "./rail";
import { type ReviewItem, ReviewError, validateReview } from "./review";

/** How far from the movement's day an entry is suggested on its own; "Find a match" looks further. */
export const SUGGEST_DAYS = 7;
export const FIND_DAYS = 60;

/** Whether the movement came from (or went to) the account of the party the entry names. */
export type Payer = "same" | "different" | "unknown";

export type MatchCandidate = {
  entry: Entry;
  cents: Cents;
  days: number;
  payer: Payer;
  /** The customer or vendor the entry names, when it names one. */
  party?: string;
  /** When the payer is different: the party whose account it is, if the books know it. */
  sender?: string;
};

type Parties = Pick<Company, "books" | "review" | "sales" | "rail">;

const partyName = (company: Pick<Company, "sales">, kind: PartyKind, id: string): string | undefined =>
  kind === "customer" ? company.sales.customers.find((c) => c.id === id)?.name : kind === "vendor" ? company.sales.vendors.find((v) => v.id === id)?.name : undefined;

/** The customer or vendor named on the entry's lines outside the Shield account, and their account if the books have it. */
export function payerOf(company: Parties, entry: Entry): { name?: string; address?: string } | undefined {
  for (const l of entry.lines) {
    if (isShieldFamily(company, l.accountId) || !l.name || (l.name.kind !== "customer" && l.name.kind !== "vendor")) continue;
    const address = company.rail ? partyLinkFor(company.rail, l.name.kind, l.name.id)?.address : undefined;
    const name = partyName(company, l.name.kind, l.name.id);
    return { ...(name ? { name } : {}), ...(address ? { address } : {}) };
  }
  return undefined;
}

/** How the movement's other side compares with the party the entry names. */
function comparePayer(company: Parties, item: ReviewItem, entry: Entry): Pick<MatchCandidate, "payer" | "party" | "sender"> {
  const named = payerOf(company, entry);
  const party = named?.name ? { party: named.name } : {};
  if (!named?.address || !item.counterparty) return { payer: "unknown", ...party };
  if (named.address === item.counterparty) return { payer: "same", ...party };
  const link = company.rail?.partyLinks?.find((p) => p.address === item.counterparty);
  const sender = link ? partyName(company, link.kind, link.id) : undefined;
  return { payer: "different", ...party, ...(sender ? { sender } : {}) };
}

/** What an entry did to the Shield account and its set-asides: more than zero is money in. */
export function shieldEffect(company: Pick<Company, "books">, entry: Entry): Cents {
  let net = 0n;
  for (const l of entry.lines) if (isShieldFamily(company, l.accountId)) net += l.debit - l.credit;
  return net;
}

/** Whole days between two YYYY-MM-DD dates, either way round. */
const daysApart = (a: string, b: string): number => Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));

/** The movement's own signed amount in cents. */
const signedCents = (item: ReviewItem): Cents => minorToCents(BigInt(item.minor)) * (item.direction === "in" ? 1n : -1n);

/** The candidate's payer, as the review list labels it beside the entry. */
export function payerLabel(candidate: Pick<MatchCandidate, "payer" | "party" | "sender">, direction: "in" | "out"): string {
  const way = direction === "in" ? "From" : "To";
  if (candidate.payer === "same") return `${way} ${candidate.party ? `${candidate.party}'s` : "the named party's"} account`;
  if (candidate.payer === "unknown") return "Account not compared";
  const whose = candidate.party ? `${candidate.party}'s` : "the one the entry names";
  return `${way} another account than ${whose}${candidate.sender ? ` (${candidate.sender}'s)` : ""}`;
}

/**
 * Entries a waiting movement may already be: same amount, same way through the Shield account,
 * within `days` of its day, not undone, not tied to another movement. Nearest day first.
 */
export function matchCandidates(company: Parties, item: ReviewItem, days = SUGGEST_DAYS): MatchCandidate[] {
  if (item.status !== "new" || item.within) return [];
  const cents = signedCents(item);
  if (cents === 0n) return [];
  const undone = new Set(company.books.entries.flatMap((e) => (e.reverses ? [e.reverses] : [])));
  const tied = new Set((company.review?.items ?? []).flatMap((i) => (i.entryId && i.id !== item.id ? [i.entryId] : [])));
  const out: MatchCandidate[] = [];
  for (const entry of company.books.entries) {
    if (entry.reverses || undone.has(entry.id) || tied.has(entry.id) || entry.source.kind === "opening_balance") continue;
    if (shieldEffect(company, entry) !== cents) continue;
    const apart = daysApart(item.date, entry.date);
    if (apart <= days) out.push({ entry, cents, days: apart, ...comparePayer(company, item, entry) });
  }
  return out.sort((a, b) => a.days - b.days || b.entry.seq - a.entry.seq);
}

/**
 * Ties a waiting movement to an entry already in the books: nothing is posted, and it counts once.
 * Refuses an entry that isn't a candidate (another amount or way, undone, or tied elsewhere), and
 * one whose named party has a different account than the movement's, unless `payerConfirmed`.
 */
export function matchEntry(company: Company, id: string, entryId: string, options: { payerConfirmed?: boolean } = {}): Company {
  const review = company.review;
  const item = review?.items.find((i) => i.id === id);
  if (!item) throw new ReviewError("That transaction isn't in the review list");
  if (item.status !== "new") throw new ReviewError("That transaction has already been reviewed");
  const candidate = matchCandidates(company, item, Number.MAX_SAFE_INTEGER).find((c) => c.entry.id === entryId);
  if (!candidate) {
    throw new ReviewError("That entry doesn't match this transaction: it needs the same amount, the same way through the Shield account, and no other match");
  }
  if (candidate.payer === "different" && !options.payerConfirmed) {
    const whose = candidate.party ? `${candidate.party}'s` : "the one the entry names";
    throw new ReviewError(item.direction === "in" ? `This came from another account than ${whose}` : `This went to another account than ${whose}`);
  }
  return { ...company, review: validateReview({ ...review!, items: review!.items.map((i) => (i.id === id ? { ...i, status: "recorded" as const, entryId, matched: true as const } : i)) }) };
}
