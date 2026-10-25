// ---------------------------------------------------------------------------
// Reconciling the books' Shield account with Shield itself, as a bank
// reconciliation does with a bank statement: one account against what holds
// its money. The books' "Shield account" and its set-asides are compared with
// the linked account's USDCx (private and public together). Nothing else is:
// cash on hand, other bank accounts and anything paid with them never touch
// Shield, so they never enter this (Joshua, 2026-10-26). Only the stablecoin
// counts; ALEO is fee money and isn't in the books.
//
// The two can differ for reasons that are fine, and the check says which:
//   - movements waiting in For review: on the network, not yet in the books;
//   - movements excluded on purpose: on the network, kept out of the books;
//   - a fraction of a cent: the books keep cents, the coin keeps six decimals,
//     so each accepted movement and the opening balance may drop under a cent;
//   - pay still settling: a rail paycheck is in the books from the moment the
//     run posts, and leaves Shield when its transfer confirms.
// Whatever is left after those is a difference nothing explains: an entry
// posted to the Shield account by hand, or a movement the feed hasn't found
// yet. That is what the Dashboard flags.
//
// Pure: no network, no React, no storage. Amounts are compared in six-decimal
// minor units so nothing is rounded twice.
// ---------------------------------------------------------------------------

import type { Cents } from "@pnw/ledger";
import type { Company } from "./company";
import { fundBalances, isShieldFamily } from "./funds";
import { MINOR_PER_CENT, minorToCents } from "./opening";

export type Reconciliation =
  /** The books don't follow a Shield account yet: nothing to compare. */
  | { kind: "not_started" }
  /** The account's USDCx isn't fully read (Shield not connected, or a read failed). */
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
 * Compares the books' Shield account (with its set-asides) with the linked account's USDCx total,
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
