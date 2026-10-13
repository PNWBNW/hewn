// ---------------------------------------------------------------------------
// Balances and the trial balance.
//
// Year-end needs no closing entry: income and expense from earlier fiscal
// years simply roll into Retained Earnings when a report is run, so the
// journal never contains synthetic entries.
// ---------------------------------------------------------------------------

import { type BaseType, baseOf, normalSide } from "./accounts";
import { type Books, accountMap, systemAccount } from "./books";
import type { Cents } from "./money";
import { type IsoDate, assertDate, fiscalYearStart } from "./periods";

const isProfitAndLoss = (base: BaseType) => base === "income" || base === "expense";

/** Debit-positive balance of every account from `from` (inclusive) through `to` (inclusive). */
export function netByAccount(books: Books, range: { from?: IsoDate; to?: IsoDate } = {}): Map<string, Cents> {
  const from = range.from ? assertDate(range.from) : undefined;
  const to = range.to ? assertDate(range.to) : undefined;
  const out = new Map<string, Cents>();
  for (const e of books.entries) {
    if ((from && e.date < from) || (to && e.date > to)) continue;
    for (const l of e.lines) out.set(l.accountId, (out.get(l.accountId) ?? 0n) + l.debit - l.credit);
  }
  return out;
}

export type TrialBalanceRow = {
  accountId: string;
  name: string;
  base: BaseType;
  debit: Cents;
  credit: Cents;
};

export type TrialBalance = {
  asOf: IsoDate;
  rows: TrialBalanceRow[];
  totalDebit: Cents;
  totalCredit: Cents;
};

export function trialBalance(books: Books, asOf: IsoDate): TrialBalance {
  const yearStart = fiscalYearStart(asOf, books.settings.fiscalYearStartMonth);
  const accounts = accountMap(books);
  const retained = systemAccount(books, "retained_earnings").id;

  const balances = new Map<string, Cents>();
  for (const [id, net] of netByAccount(books, { to: asOf })) {
    const acct = accounts.get(id)!;
    // Prior-year profit or loss lands in Retained Earnings; this year's stays put.
    const target = isProfitAndLoss(baseOf(acct)) ? null : id;
    if (target) balances.set(target, (balances.get(target) ?? 0n) + net);
  }
  for (const [id, net] of netByAccount(books, { from: yearStart, to: asOf })) {
    if (isProfitAndLoss(baseOf(accounts.get(id)!))) balances.set(id, (balances.get(id) ?? 0n) + net);
  }
  const priorYears = netByAccount(books, { to: dayBefore(yearStart) });
  for (const [id, net] of priorYears) {
    if (isProfitAndLoss(baseOf(accounts.get(id)!))) balances.set(retained, (balances.get(retained) ?? 0n) + net);
  }

  const rows: TrialBalanceRow[] = [];
  for (const acct of books.accounts) {
    const bal = balances.get(acct.id) ?? 0n;
    if (bal === 0n) continue;
    rows.push({
      accountId: acct.id,
      name: acct.name,
      base: baseOf(acct),
      debit: bal > 0n ? bal : 0n,
      credit: bal < 0n ? -bal : 0n,
    });
  }
  return {
    asOf,
    rows,
    totalDebit: rows.reduce((s, r) => s + r.debit, 0n),
    totalCredit: rows.reduce((s, r) => s + r.credit, 0n),
  };
}

/** Income minus expenses (including cost of goods sold) for the range. */
export function netIncome(books: Books, from: IsoDate, to: IsoDate): Cents {
  const accounts = accountMap(books);
  let income = 0n;
  for (const [id, net] of netByAccount(books, { from, to })) {
    const base = baseOf(accounts.get(id)!);
    if (isProfitAndLoss(base)) income -= net; // credits raise income, debits (expenses) lower it
  }
  return income;
}

/** Balance shown the way a bookkeeper expects: positive on the account's normal side. */
export function displayBalance(books: Books, accountId: string, asOf?: IsoDate): Cents {
  const acct = accountMap(books).get(accountId);
  if (!acct) return 0n;
  const net = netByAccount(books, asOf ? { to: asOf } : {}).get(accountId) ?? 0n;
  return normalSide(baseOf(acct)) === "debit" ? net : -net;
}

function dayBefore(date: IsoDate): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
