// ---------------------------------------------------------------------------
// Chart of accounts.
//
// Bookkeepers pick from familiar account types (bank, receivables, credit
// card, cost of goods sold, ...). Each type maps onto one of the five base
// types, which decides the account's normal balance and where it lands on
// the statements. System accounts are created with the books and can't be
// removed or retyped, because forms post to them automatically.
// ---------------------------------------------------------------------------

import { fail } from "./errors";

export type BaseType = "asset" | "liability" | "equity" | "income" | "expense";

export type AccountType =
  | "bank"
  | "accounts_receivable"
  | "other_current_asset"
  | "fixed_asset"
  | "other_asset"
  | "credit_card"
  | "accounts_payable"
  | "other_current_liability"
  | "long_term_liability"
  | "equity"
  | "income"
  | "other_income"
  | "cost_of_goods_sold"
  | "expense"
  | "other_expense";

export const ACCOUNT_TYPES: Record<AccountType, { base: BaseType; label: string }> = {
  bank: { base: "asset", label: "Bank" },
  accounts_receivable: { base: "asset", label: "Accounts receivable" },
  other_current_asset: { base: "asset", label: "Other current asset" },
  fixed_asset: { base: "asset", label: "Fixed asset" },
  other_asset: { base: "asset", label: "Other asset" },
  credit_card: { base: "liability", label: "Credit card" },
  accounts_payable: { base: "liability", label: "Accounts payable" },
  other_current_liability: { base: "liability", label: "Other current liability" },
  long_term_liability: { base: "liability", label: "Long-term liability" },
  equity: { base: "equity", label: "Equity" },
  income: { base: "income", label: "Income" },
  other_income: { base: "income", label: "Other income" },
  cost_of_goods_sold: { base: "expense", label: "Cost of goods sold" },
  expense: { base: "expense", label: "Expense" },
  other_expense: { base: "expense", label: "Other expense" },
};

/** Assets and expenses grow with debits; liabilities, equity and income with credits. */
export function normalSide(base: BaseType): "debit" | "credit" {
  return base === "asset" || base === "expense" ? "debit" : "credit";
}

/** Accounts the books create for themselves; forms post to these by role. */
export type SystemRole =
  | "accounts_receivable"
  | "accounts_payable"
  | "payments_to_deposit"
  | "opening_balance_equity"
  | "retained_earnings"
  | "sales_tax_payable"
  | "payroll_liabilities";

export type Account = {
  id: string;
  name: string;
  number?: string;
  type: AccountType;
  parentId?: string;
  description?: string;
  active: boolean;
  system?: SystemRole;
};

export type AccountInput = Omit<Account, "id" | "active" | "system">;

export const MAX_DEPTH = 5;

export const SYSTEM_ACCOUNTS: { role: SystemRole; name: string; type: AccountType }[] = [
  { role: "accounts_receivable", name: "Accounts Receivable", type: "accounts_receivable" },
  { role: "payments_to_deposit", name: "Payments to Deposit", type: "other_current_asset" },
  { role: "accounts_payable", name: "Accounts Payable", type: "accounts_payable" },
  { role: "sales_tax_payable", name: "Sales Tax Payable", type: "other_current_liability" },
  { role: "payroll_liabilities", name: "Payroll Liabilities", type: "other_current_liability" },
  { role: "opening_balance_equity", name: "Opening Balance Equity", type: "equity" },
  { role: "retained_earnings", name: "Retained Earnings", type: "equity" },
];

export function baseOf(account: Account): BaseType {
  return ACCOUNT_TYPES[account.type].base;
}

function depthOf(accounts: Map<string, Account>, id: string | undefined): number {
  let depth = 0;
  for (let cur = id; cur; cur = accounts.get(cur)?.parentId) depth++;
  return depth;
}

/** Checks a new or changed account against the rest of the chart. */
export function validateAccount(accounts: Map<string, Account>, candidate: Account): void {
  const name = candidate.name.trim();
  if (!name) fail("BAD_LINE", "An account needs a name");
  if (!(candidate.type in ACCOUNT_TYPES)) fail("BAD_LINE", `Unknown account type "${candidate.type}"`);

  for (const other of accounts.values()) {
    if (other.id === candidate.id) continue;
    const sameParent = (other.parentId ?? "") === (candidate.parentId ?? "");
    if (sameParent && other.name.trim().toLowerCase() === name.toLowerCase()) {
      fail("DUPLICATE_ACCOUNT", `An account named "${name}" already exists here`);
    }
    if (candidate.number && other.number === candidate.number) {
      fail("DUPLICATE_ACCOUNT", `Account number ${candidate.number} is already used by "${other.name}"`);
    }
  }

  if (candidate.parentId) {
    const parent = accounts.get(candidate.parentId);
    if (!parent) fail("BAD_PARENT", "Parent account not found");
    if (baseOf(parent) !== baseOf(candidate)) {
      fail("BAD_PARENT", `A ${baseOf(candidate)} account can't sit under a ${baseOf(parent)} account`);
    }
    // No cycles: the candidate must not be an ancestor of its new parent.
    for (let cur: string | undefined = parent.id; cur; cur = accounts.get(cur)?.parentId) {
      if (cur === candidate.id) fail("BAD_PARENT", "An account can't be nested under itself");
    }
    if (depthOf(accounts, candidate.parentId) + 1 > MAX_DEPTH) {
      fail("BAD_PARENT", `Sub-accounts nest at most ${MAX_DEPTH} levels deep`);
    }
  }
}
