// ---------------------------------------------------------------------------
// Financial statements: profit and loss, and the balance sheet.
//
// Both are views over the same numbers as the trial balance. The P&L sums
// income and expense accounts over a date range; the balance sheet takes the
// trial balance as of a date, so prior-year profit sits in Retained Earnings
// by the same rule, and this fiscal year's profit shows as one "Net income"
// line in equity. Assets = liabilities + equity by construction.
//
// Each statement can carry a comparison column; every amount is an array
// with one value per column. Amounts are positive on the section's normal
// side (income as a credit, expenses and assets as debits), so a contra
// account such as Accumulated Depreciation shows as a negative.
// ---------------------------------------------------------------------------

import { type Account, type AccountType, ACCOUNT_TYPES, normalSide } from "./accounts";
import type { Books } from "./books";
import type { Cents } from "./money";
import { type IsoDate, assertDate, fiscalYearStart } from "./periods";
import { netByAccount, trialBalance } from "./reports";

/** One amount per column: the main period first, then the comparison. */
export type Amounts = Cents[];

export type DateRange = { from: IsoDate; to: IsoDate };

export type StatementRow = {
  /** Null for a computed line that isn't an account (the balance sheet's "Net income"). */
  accountId: string | null;
  name: string;
  number?: string;
  /** This account's own balance. */
  own: Amounts;
  /** Own plus every sub-account below it in this section. */
  total: Amounts;
  children: StatementRow[];
};

export type StatementSection = {
  id: string;
  label: string;
  rows: StatementRow[];
  /** Nested groups, e.g. "Current assets" inside "Assets". Empty groups are left out. */
  groups: StatementSection[];
  total: Amounts;
};

export type ProfitAndLoss = {
  columns: DateRange[];
  income: StatementSection;
  costOfGoodsSold: StatementSection;
  grossProfit: Amounts;
  expenses: StatementSection;
  netOperatingIncome: Amounts;
  otherIncome: StatementSection;
  otherExpenses: StatementSection;
  netOtherIncome: Amounts;
  netIncome: Amounts;
};

export type BalanceSheet = {
  columns: IsoDate[];
  assets: StatementSection;
  liabilities: StatementSection;
  equity: StatementSection;
  /** This fiscal year's profit to date, shown inside equity. */
  netIncome: Amounts;
  liabilitiesAndEquity: Amounts;
};

// ---- Building sections -------------------------------------------------------

const zeros = (n: number): Amounts => Array.from({ length: n }, () => 0n);
const add = (a: Amounts, b: Amounts): Amounts => a.map((v, i) => v + b[i]!);
const sub = (a: Amounts, b: Amounts): Amounts => a.map((v, i) => v - b[i]!);

/** Chart order within a level: numbered accounts by number, then unnumbered ones, each by name. */
export function compareAccounts(x: Account, y: Account): number {
  if (x.number !== y.number) {
    if (x.number === undefined) return 1;
    if (y.number === undefined) return -1;
    return x.number < y.number ? -1 : 1;
  }
  const [a, b] = [x.name.toLowerCase(), y.name.toLowerCase()];
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A section of every account whose type is in `types`, nested under its
 * nearest ancestor in the same section, in chart order. Accounts with nothing
 * in any column are left out unless a sub-account below them has something.
 * `nets` are debit-positive balances, one map per column.
 */
function accountSection(
  books: Books,
  id: string,
  label: string,
  types: AccountType[],
  nets: Map<string, Cents>[],
): StatementSection {
  const members = books.accounts.filter((a) => types.includes(a.type));
  const inSection = new Map(members.map((a) => [a.id, a]));
  const all = new Map(books.accounts.map((a) => [a.id, a]));
  const parentOf = (a: Account) => {
    for (let cur = a.parentId; cur; cur = all.get(cur)?.parentId) if (inSection.has(cur)) return cur;
    return undefined;
  };
  const byParent = new Map<string | undefined, Account[]>();
  for (const a of members) {
    const p = parentOf(a);
    byParent.set(p, [...(byParent.get(p) ?? []), a]);
  }

  const build = (parent: string | undefined): StatementRow[] => {
    const out: StatementRow[] = [];
    for (const a of (byParent.get(parent) ?? []).sort(compareAccounts)) {
      const flip = normalSide(ACCOUNT_TYPES[a.type].base) === "credit";
      const own = nets.map((m) => (flip ? -(m.get(a.id) ?? 0n) : (m.get(a.id) ?? 0n)));
      const children = build(a.id);
      if (children.length === 0 && own.every((v) => v === 0n)) continue;
      const total = children.reduce((s, c) => add(s, c.total), own);
      out.push({ accountId: a.id, name: a.name, ...(a.number ? { number: a.number } : {}), own, total, children });
    }
    return out;
  };
  const rows = build(undefined);
  return { id, label, rows, groups: [], total: rows.reduce((s, r) => add(s, r.total), zeros(nets.length)) };
}

function group(id: string, label: string, parts: StatementSection[], width: number): StatementSection {
  const groups = parts.filter((g) => g.rows.length > 0 || g.groups.length > 0);
  return { id, label, rows: [], groups, total: groups.reduce((s, g) => add(s, g.total), zeros(width)) };
}

// ---- Profit and loss -----------------------------------------------------------

/** Income and expenses for `range`, optionally beside a comparison range. */
export function profitAndLoss(books: Books, range: DateRange, compare?: DateRange): ProfitAndLoss {
  const columns = compare ? [range, compare] : [range];
  for (const c of columns) {
    assertDate(c.from);
    assertDate(c.to);
  }
  const nets = columns.map((c) => netByAccount(books, c));
  const section = (id: string, label: string, types: AccountType[]) => accountSection(books, id, label, types, nets);

  const income = section("income", "Income", ["income"]);
  const costOfGoodsSold = section("cost_of_goods_sold", "Cost of goods sold", ["cost_of_goods_sold"]);
  const expenses = section("expenses", "Expenses", ["expense"]);
  const otherIncome = section("other_income", "Other income", ["other_income"]);
  const otherExpenses = section("other_expenses", "Other expenses", ["other_expense"]);

  const grossProfit = sub(income.total, costOfGoodsSold.total);
  const netOperatingIncome = sub(grossProfit, expenses.total);
  const netOtherIncome = sub(otherIncome.total, otherExpenses.total);
  return {
    columns,
    income,
    costOfGoodsSold,
    grossProfit,
    expenses,
    netOperatingIncome,
    otherIncome,
    otherExpenses,
    netOtherIncome,
    netIncome: add(netOperatingIncome, netOtherIncome),
  };
}

// ---- Balance sheet ---------------------------------------------------------------

/** What the business owns and owes as of `asOf`, optionally beside a comparison date. */
export function balanceSheet(books: Books, asOf: IsoDate, compareTo?: IsoDate): BalanceSheet {
  const columns = compareTo ? [assertDate(asOf), assertDate(compareTo)] : [assertDate(asOf)];
  const width = columns.length;
  // The trial balance already rolls earlier fiscal years into Retained Earnings and keeps
  // this year's income and expense on their own lines; reuse it so the two never disagree.
  const tbs = columns.map((d) => trialBalance(books, d));
  const nets = tbs.map((tb) => new Map(tb.rows.map((r) => [r.accountId, r.debit - r.credit])));
  const section = (id: string, label: string, types: AccountType[]) => accountSection(books, id, label, types, nets);

  const assets = group(
    "assets",
    "Assets",
    [
      group(
        "current_assets",
        "Current assets",
        [
          section("bank", "Bank accounts", ["bank"]),
          section("accounts_receivable", "Accounts receivable", ["accounts_receivable"]),
          section("other_current_assets", "Other current assets", ["other_current_asset"]),
        ],
        width,
      ),
      section("fixed_assets", "Fixed assets", ["fixed_asset"]),
      section("other_assets", "Other assets", ["other_asset"]),
    ],
    width,
  );
  const liabilities = group(
    "liabilities",
    "Liabilities",
    [
      group(
        "current_liabilities",
        "Current liabilities",
        [
          section("credit_cards", "Credit cards", ["credit_card"]),
          section("accounts_payable", "Accounts payable", ["accounts_payable"]),
          section("other_current_liabilities", "Other current liabilities", ["other_current_liability"]),
        ],
        width,
      ),
      section("long_term_liabilities", "Long-term liabilities", ["long_term_liability"]),
    ],
    width,
  );

  // This fiscal year's profit: every income and expense line left on the trial balance.
  const accounts = new Map(books.accounts.map((a) => [a.id, a]));
  const netIncome = tbs.map((tb) =>
    tb.rows.reduce((s, r) => {
      const base = ACCOUNT_TYPES[accounts.get(r.accountId)!.type].base;
      return base === "income" || base === "expense" ? s + r.credit - r.debit : s;
    }, 0n),
  );
  const equityAccounts = section("equity", "Equity", ["equity"]);
  const netIncomeRow: StatementRow = { accountId: null, name: "Net income", own: netIncome, total: netIncome, children: [] };
  const equity: StatementSection = {
    ...equityAccounts,
    rows: [...equityAccounts.rows, netIncomeRow],
    total: add(equityAccounts.total, netIncome),
  };

  return { columns, assets, liabilities, equity, netIncome, liabilitiesAndEquity: add(liabilities.total, equity.total) };
}

/** First and last day of the fiscal year that contains `date`. */
export function fiscalYearOf(books: Books, date: IsoDate): DateRange {
  const from = fiscalYearStart(date, books.settings.fiscalYearStartMonth);
  const [y, m] = from.split("-").map(Number) as [number, number];
  const to = new Date(Date.UTC(y + 1, m - 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}
