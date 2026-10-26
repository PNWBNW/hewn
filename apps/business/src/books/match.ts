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
// Pure: no network, no React, no storage.
// ---------------------------------------------------------------------------

import type { Cents, Entry } from "@pnw/ledger";
import type { Company } from "./company";
import { isShieldFamily } from "./funds";
import { minorToCents } from "./opening";
import { type ReviewItem, ReviewError, validateReview } from "./review";

/** How far from the movement's day an entry is suggested on its own; "Find a match" looks further. */
export const SUGGEST_DAYS = 7;
export const FIND_DAYS = 60;

export type MatchCandidate = { entry: Entry; cents: Cents; days: number };

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

/**
 * Entries a waiting movement may already be: same amount, same way through the Shield account,
 * within `days` of its day, not undone, not tied to another movement. Nearest day first.
 */
export function matchCandidates(company: Pick<Company, "books" | "review">, item: ReviewItem, days = SUGGEST_DAYS): MatchCandidate[] {
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
    if (apart <= days) out.push({ entry, cents, days: apart });
  }
  return out.sort((a, b) => a.days - b.days || b.entry.seq - a.entry.seq);
}

/**
 * Ties a waiting movement to an entry already in the books: nothing is posted, and it counts once.
 * Refuses an entry that isn't a candidate (another amount or way, undone, or tied elsewhere).
 */
export function matchEntry(company: Company, id: string, entryId: string): Company {
  const review = company.review;
  const item = review?.items.find((i) => i.id === id);
  if (!item) throw new ReviewError("That transaction isn't in the review list");
  if (item.status !== "new") throw new ReviewError("That transaction has already been reviewed");
  if (!matchCandidates(company, item, Number.MAX_SAFE_INTEGER).some((c) => c.entry.id === entryId)) {
    throw new ReviewError("That entry doesn't match this transaction: it needs the same amount, the same way through the Shield account, and no other match");
  }
  return { ...company, review: validateReview({ ...review!, items: review!.items.map((i) => (i.id === id ? { ...i, status: "recorded" as const, entryId, matched: true as const } : i)) }) };
}
