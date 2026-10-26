// ---------------------------------------------------------------------------
// Reconciling the books' Shield account with Shield itself, as a bank
// reconciliation does with a bank statement: one account against what holds
// its money. The books' "Shield account" and its set-asides are compared with
// the linked account's stablecoin (private and public together). Nothing else is:
// cash on hand, other bank accounts and anything paid with them never touch
// Shield, so they never enter this (Joshua, 2026-10-26). Only the stablecoin
// counts; the network's own coin is fee money and isn't in the books.
//
// The two can differ for reasons that are fine, and the check says which:
//   - movements waiting in For review: on the network, not yet in the books;
//   - movements excluded on purpose: on the network, kept out of the books;
//   - a fraction of a cent: the books keep cents, the coin keeps six decimals,
//     so each accepted movement and the opening balance may drop under a cent;
//   - pay still settling: a rail paycheck is in the books from the moment the
//     run posts, and leaves Shield when its transfer confirms.
// A move within the account (records combined, public to private) never
// changes the total, whatever it was marked. Whatever is left after those is a
// difference nothing explains: an entry posted to the Shield account by hand,
// or a movement the feed can't read (a private payment from someone else that
// Shield won't open, Joshua's test 2026-10-26). That is what the Dashboard
// flags, and the business can record it there, as a bank reconciliation
// records an unexplained difference (`recordShieldDifference`).
//
// Pure: no network, no React, no storage. Amounts are compared in six-decimal
// minor units so nothing is rounded twice.
// ---------------------------------------------------------------------------

import { type Books, type Cents, type IsoDate, type NameRef, postEntry } from "@pnw/ledger";
import { RAIL_ACCOUNT_NAME, ensureRailAccount } from "@pnw/payroll";
import type { Company } from "./company";
import { fundBalances, isShieldFamily } from "./funds";
import { MINOR_PER_CENT, minorToCents } from "./opening";
import type { ReviewItem } from "./review";

export type Reconciliation =
  /** The books don't follow a Shield account yet: nothing to compare. */
  | { kind: "not_started" }
  /** The account's stablecoin isn't fully read (Shield not connected, or a read failed). */
  | { kind: "unread"; books: Cents }
  /** The books and Shield agree, to the cent. */
  | { kind: "matches"; books: Cents; shield: Cents }
  /** They differ only by movements waiting in For review. */
  | { kind: "waiting"; books: Cents; shield: Cents; count: number; minor: bigint }
  /** They differ, and pay is still settling: check again once it has. */
  | { kind: "settling"; books: Cents; shield: Cents; count: number }
  /** They differ by an amount nothing explains: `gap` is Shield minus the books, in minor units. */
  | { kind: "off"; books: Cents; shield: Cents; gap: bigint };

/** Signed: money in adds to Shield, money out takes from it. */
const signed = (direction: "in" | "out", minor: bigint) => (direction === "in" ? minor : -minor);

/**
 * Compares the books' Shield account (with its set-asides) with the linked account's stablecoin total,
 * `shieldMinor` in six-decimal minor units, or null when it isn't fully read.
 */
export function reconcileShield(
  company: Pick<Company, "books" | "funds" | "review" | "rail" | "payroll">,
  shieldMinor: bigint | null,
): Reconciliation {
  if (!company.rail?.start) return { kind: "not_started" };
  const books = fundBalances(company).total;
  if (shieldMinor === null) return { kind: "unread", books };
  const shield = minorToCents(shieldMinor);

  // What the books already account for, in minor units: everything posted, plus the movements
  // decided not to post, plus the fractions of a cent each accepted movement dropped.
  let decided = 0n;
  let waitingMinor = 0n;
  let waitingCount = 0;
  for (const item of company.review?.items ?? []) {
    if (item.within) continue; // the money stayed in the account: the total never moved
    const minor = BigInt(item.minor);
    if (item.status === "new") {
      waitingMinor += signed(item.direction, minor);
      waitingCount += 1;
    } else if (item.status === "excluded") {
      decided += signed(item.direction, minor);
    } else if (item.status === "accepted") {
      decided += signed(item.direction, minor % MINOR_PER_CENT);
    }
  }

  // The opening balance dropped up to a cent less one minor unit; nothing else rounds.
  const residual = shieldMinor - books * MINOR_PER_CENT - decided;
  const withinRounding = (r: bigint) => r >= 0n && r < MINOR_PER_CENT;
  if (withinRounding(residual) && waitingCount === 0) return { kind: "matches", books, shield };
  if (withinRounding(residual - waitingMinor)) {
    return waitingCount === 0 ? { kind: "matches", books, shield } : { kind: "waiting", books, shield, count: waitingCount, minor: waitingMinor };
  }

  // Rail pay posted from the Shield account whose transfer hasn't confirmed: the books already
  // show it gone, Shield may not yet. Not judged until it settles.
  let settling = 0;
  for (const run of company.payroll.runs) {
    if (run.mode !== "rail" || !isShieldFamily(company, run.bankAccountId)) continue;
    for (const p of run.paychecks) if (p.net > 0n && p.settlement.status !== "settled") settling += 1;
  }
  if (settling > 0) return { kind: "settling", books, shield, count: settling };

  return { kind: "off", books, shield, gap: residual - waitingMinor };
}

export type DifferenceInput = {
  /** Shield minus the books, in cents: more than zero is money in nothing explains, less is money out. */
  cents: Cents;
  /** The other side: income for money in, expense for money out, or whatever the business says it was. */
  accountId: string;
  date: IsoDate;
  memo?: string;
  /** The customer or vendor, if the business knows who. */
  name?: NameRef;
};

/**
 * Records a difference nothing explains, from the Dashboard's flag: the Shield account on one
 * side, the account the business chose on the other, dated the day it's recorded. If the movement
 * behind it shows up in For review later, excluding it there keeps it from counting twice.
 */
export function recordShieldDifference(company: Company, input: DifferenceInput): Company {
  if (typeof input.cents !== "bigint" || input.cents === 0n) throw new Error("There's no difference to record");
  if (!company.books.accounts.some((a) => a.id === input.accountId && a.active)) throw new Error("Choose an account");
  const { books: withShield, accountId: shield } = ensureRailAccount(company.books);
  if (isShieldFamily({ books: withShield }, input.accountId)) throw new Error(`Choose an account other than the ${RAIL_ACCOUNT_NAME}`);
  const inbound = input.cents > 0n;
  const amount = inbound ? input.cents : -input.cents;
  const other = { accountId: input.accountId, ...(input.name ? { name: input.name } : {}) };
  const { books } = postEntry(withShield, {
    date: input.date,
    memo: input.memo?.trim() || `Difference with ${RAIL_ACCOUNT_NAME}, recorded from the Dashboard`,
    source: { kind: inbound ? "deposit" : "expense", ref: `reconcile:${input.date}` },
    lines: inbound ? [{ accountId: shield, debit: amount }, { ...other, credit: amount }] : [{ ...other, debit: amount }, { accountId: shield, credit: amount }],
  });
  return { ...company, books };
}

const DIFFERENCE = /^reconcile:/;

/** The differences recorded from the Dashboard and still standing (not reversed): when, and how much (more than zero is money in). */
export function recordedDifferences(books: Pick<Books, "entries">): { entryId: string; date: string; cents: Cents }[] {
  const reversed = new Set(books.entries.flatMap((e) => (e.reverses ? [e.reverses] : [])));
  return books.entries.flatMap((e) => {
    if (!e.source?.ref || !DIFFERENCE.test(e.source.ref) || reversed.has(e.id)) return [];
    const amount = e.lines.reduce((n, l) => n + l.debit, 0n);
    return [{ entryId: e.id, date: e.date, cents: e.source.kind === "deposit" ? amount : -amount }];
  });
}

/**
 * A difference recorded from the Dashboard that a movement waiting in For review may be: same
 * direction, same amount, recorded on or after the day it moved. Only a reminder; the business
 * decides (a match by amount alone can be a coincidence).
 */
export function differenceFor(books: Pick<Books, "entries">, item: ReviewItem): { entryId: string; date: string; cents: Cents } | null {
  if (item.status !== "new" || item.within) return null;
  const cents = minorToCents(BigInt(item.minor)) * (item.direction === "in" ? 1n : -1n);
  if (cents === 0n) return null;
  return recordedDifferences(books).find((d) => d.cents === cents && d.date >= item.date) ?? null;
}
