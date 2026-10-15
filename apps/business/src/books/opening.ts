// ---------------------------------------------------------------------------
// Starting the books from the linked Shield account: its balance on the start
// date becomes the opening balance of the books' "Shield account" (a bank
// account), with the other side in Opening Balance Equity. Nobody types it
// in and nobody balances debits against credits: the balance is read, and
// this posts it.
//
// Everything that moves in the account after the start date comes in for
// review later; everything before it is folded into this one figure.
//
// Pure: no network, no React, no storage. The balance arrives as six-decimal
// minor units (1.000000 = 1,000,000) and the books keep cents, so anything
// under a cent is left out.
// ---------------------------------------------------------------------------

import { type Books, type IsoDate, postEntry, systemAccount, updateAccount } from "@pnw/ledger";
import { RAIL_ACCOUNT_NAME, ensureRailAccount } from "@pnw/payroll";
import type { Company } from "./company";

/** Six-decimal minor units per cent. */
export const MINOR_PER_CENT = 10_000n;

/** Six-decimal minor units as whole cents, rounded down (a fraction of a cent isn't kept). */
export function minorToCents(minor: bigint): bigint {
  if (minor < 0n) throw new Error("A balance can't be negative");
  return minor / MINOR_PER_CENT;
}

export const OPENING_MEMO = "Opening balance of the Shield account";

/** The source every opening entry for the Shield account carries, so it can be found again. */
export const OPENING_SOURCE = { kind: "opening_balance", ref: "shield-account" } as const;

/** The Shield account, created if missing and renamed from its old name if it still has one. */
function shieldAccount(books: Books): { books: Books; accountId: string } {
  const { books: next, accountId } = ensureRailAccount(books);
  const account = next.accounts.find((a) => a.id === accountId)!;
  if (account.name === RAIL_ACCOUNT_NAME) return { books: next, accountId };
  return { books: updateAccount(next, accountId, { name: RAIL_ACCOUNT_NAME }), accountId };
}

/**
 * Starts the books from the Shield account's balance on `date`. Posts the opening entry when there
 * is anything to post, and records the start on the link either way. Refuses a second start.
 */
export function startFromShield(company: Company, input: { date: IsoDate; minor: bigint; at?: string }): Company {
  const rail = company.rail;
  if (!rail) throw new Error("Link Shield in Settings first");
  if (rail.start) throw new Error(`The books already follow this account from ${rail.start.date}`);
  const cents = minorToCents(input.minor);

  const { books: withAccount, accountId } = shieldAccount(company.books);
  const when = input.at ? { at: input.at } : {};
  if (cents === 0n) return { ...company, books: withAccount, rail: { ...rail, start: { date: input.date, ...when } } };

  const { books, entry } = postEntry(withAccount, {
    date: input.date,
    memo: OPENING_MEMO,
    source: { ...OPENING_SOURCE },
    lines: [
      { accountId, debit: cents },
      { accountId: systemAccount(withAccount, "opening_balance_equity").id, credit: cents },
    ],
  });
  return { ...company, books, rail: { ...rail, start: { date: input.date, ...when, entryId: entry.id } } };
}
