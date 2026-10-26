// ---------------------------------------------------------------------------
// Set-asides ("floating values", Joshua): money in the Shield account earmarked
// for something, without any money moving. Shield holds one balance; the
// books split it. Each set-aside is a sub-account of the Shield account (a
// bank account under it), and what's left in the Shield account itself is
// "General", the money free to spend. Moving money into or out of a
// set-aside is a book entry between the two; Shield's balance doesn't change and
// the total always matches it.
//
// A set-aside can name the vendors it pays (an Equipment fund that pays the
// equipment supplier, say): when such a vendor is paid, the payment comes out
// of that set-aside by default. Everything else comes out of General.
//
// Taxes owed (sales tax collected, payroll withholding and employer taxes not
// yet paid to the agencies) are set aside on their own (Joshua, 2026-10-26):
// not an account or an entry, just held back from what's free to spend, so
// the figure moves the moment a tax is collected or paid.
//
// Pure: no network, no React, no storage.
// ---------------------------------------------------------------------------

import { type Account, type Cents, type IsoDate, addAccount, balanceOf, deactivateAccount, postEntry, updateAccount } from "@pnw/ledger";
import { ensureRailAccount, findRailAccount } from "@pnw/payroll";
import type { Company } from "./company";

export type Fund = {
  /** The sub-account that holds it. */
  accountId: string;
  /** Vendors whose payments come out of it by default. Empty: none by default, but any may be chosen. */
  vendorIds: string[];
};

export type Funds = { version: 1; funds: Fund[] };

export class FundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FundError";
  }
}

export const GENERAL = "General";

export const emptyFunds = (): Funds => ({ version: 1, funds: [] });

export function validateFunds(raw: unknown): Funds {
  const f = raw as Partial<Funds> | null;
  if (!f || typeof f !== "object") throw new FundError("Set-asides must be an object");
  if (f.version !== 1) throw new FundError("Unknown set-aside version");
  if (!Array.isArray(f.funds)) throw new FundError("Set-asides must be a list");
  const byAccount = new Map<string, Fund>();
  for (const raw of f.funds) {
    const x = raw as Partial<Fund> | null;
    if (!x || typeof x !== "object" || typeof x.accountId !== "string" || !x.accountId) throw new FundError("Each set-aside needs its account");
    if (!Array.isArray(x.vendorIds) || x.vendorIds.some((v) => typeof v !== "string" || !v)) throw new FundError("A set-aside's vendors must be a list");
    byAccount.set(x.accountId, { accountId: x.accountId, vendorIds: [...new Set(x.vendorIds)] });
  }
  return { version: 1, funds: [...byAccount.values()] };
}

export const fundsToJson = (f: Funds): string => JSON.stringify(validateFunds(f));
export const fundsFromJson = (text: string): Funds => validateFunds(JSON.parse(text));

/** The Shield account and its open set-aside accounts. */
function family(company: Pick<Company, "books">): { shield: Account | undefined; children: Account[] } {
  const shield = findRailAccount(company.books);
  const children = shield ? company.books.accounts.filter((a) => a.active && a.parentId === shield.id) : [];
  return { shield, children };
}

/** Whether an account is the Shield account or one of its set-asides (closed ones too): the money held in Shield. */
export function isShieldFamily(company: Pick<Company, "books">, accountId: string): boolean {
  const shield = findRailAccount(company.books);
  if (!shield) return false;
  return accountId === shield.id || company.books.accounts.some((a) => a.id === accountId && a.parentId === shield.id);
}

export type FundView = { accountId: string; name: string; cents: Cents; vendorIds: string[] };

/** General (free to spend), each set-aside, and the total, which matches the books' Shield account with its set-asides. */
export function fundBalances(company: Pick<Company, "books" | "funds">): { general: Cents; funds: FundView[]; total: Cents } {
  const { shield, children } = family(company);
  if (!shield) return { general: 0n, funds: [], total: 0n };
  const records = new Map((company.funds?.funds ?? []).map((f) => [f.accountId, f]));
  const funds = children.map((a) => ({ accountId: a.id, name: a.name, cents: balanceOf(company.books, a.id), vendorIds: records.get(a.id)?.vendorIds ?? [] }));
  const general = balanceOf(company.books, shield.id);
  return { general, funds, total: funds.reduce((t, f) => t + f.cents, general) };
}

const TAX_ROLES = new Set(["sales_tax_payable", "payroll_liabilities"]);

/** Taxes the books owe and haven't paid: Sales Tax Payable and Payroll Liabilities, with any accounts under them. Never below zero. */
export function taxesOwed(books: Company["books"]): Cents {
  const roots = new Set(books.accounts.filter((a) => a.system && TAX_ROLES.has(a.system)).map((a) => a.id));
  let owed = 0n;
  for (const a of books.accounts) if (roots.has(a.id) || (a.parentId && roots.has(a.parentId))) owed -= balanceOf(books, a.id);
  return owed > 0n ? owed : 0n;
}

/**
 * What's free to spend: General in the Shield account (or, before the books follow one, the bank
 * accounts' total `cash`), less the taxes owed. Can go below zero, which says the taxes aren't covered.
 */
export function freeToSpend(company: Pick<Company, "books" | "funds">, cash: Cents): { cents: Cents; taxes: Cents; from: "general" | "cash" } {
  const shield = findRailAccount(company.books);
  const taxes = taxesOwed(company.books);
  return shield ? { cents: fundBalances(company).general - taxes, taxes, from: "general" } : { cents: cash - taxes, taxes, from: "cash" };
}

/** Where a payment to `vendorId` comes out of by default: the first set-aside that names the vendor, else General. */
export function defaultSource(company: Pick<Company, "books" | "funds">, vendorId: string | undefined): string | undefined {
  const { shield, children } = family(company);
  if (!shield) return undefined;
  const live = new Set(children.map((a) => a.id));
  const named = vendorId ? company.funds?.funds.find((f) => live.has(f.accountId) && f.vendorIds.includes(vendorId)) : undefined;
  return named?.accountId ?? shield.id;
}

function withRecord(company: Company, fund: Fund): Company {
  const funds = company.funds ?? emptyFunds();
  return { ...company, funds: validateFunds({ ...funds, funds: [...funds.funds.filter((f) => f.accountId !== fund.accountId), fund] }) };
}

/** A new, empty set-aside under the Shield account. */
export function createFund(company: Company, input: { name: string; vendorIds?: string[] }): { company: Company; accountId: string } {
  const name = input.name.trim();
  if (!name) throw new FundError("Name the set-aside");
  if (name.toLowerCase() === GENERAL.toLowerCase()) throw new FundError(`"${GENERAL}" is the money that isn't set aside; pick another name`);
  const { books: withShield, accountId: shieldId } = ensureRailAccount(company.books);
  const { books, account } = addAccount(withShield, { name, type: "bank", parentId: shieldId });
  return { company: withRecord({ ...company, books }, { accountId: account.id, vendorIds: input.vendorIds ?? [] }), accountId: account.id };
}

/** Renames a set-aside or changes the vendors it pays. */
export function updateFund(company: Company, accountId: string, changes: { name?: string; vendorIds?: string[] }): Company {
  if (!family(company).children.some((a) => a.id === accountId)) throw new FundError("That set-aside isn't open");
  let books = company.books;
  if (changes.name !== undefined) {
    const name = changes.name.trim();
    if (!name) throw new FundError("Name the set-aside");
    if (name.toLowerCase() === GENERAL.toLowerCase()) throw new FundError(`"${GENERAL}" is the money that isn't set aside; pick another name`);
    books = updateAccount(books, accountId, { name });
  }
  const current = company.funds?.funds.find((f) => f.accountId === accountId);
  return withRecord({ ...company, books }, { accountId, vendorIds: changes.vendorIds ?? current?.vendorIds ?? [] });
}

export const MOVE_SOURCE = { kind: "manual", ref: "set-aside" } as const;

/**
 * Sets money aside (`into`: General → the set-aside) or releases it (`out`: back to General). A book
 * entry only; refused when it would take General or the set-aside below zero.
 */
export function moveFund(company: Company, input: { accountId: string; cents: Cents; direction: "into" | "out"; date: IsoDate; memo?: string }): Company {
  const { shield, children } = family(company);
  const fund = children.find((a) => a.id === input.accountId);
  if (!shield || !fund) throw new FundError("That set-aside isn't open");
  if (input.cents <= 0n) throw new FundError("Enter an amount above zero");
  const from = input.direction === "into" ? shield : fund;
  const to = input.direction === "into" ? fund : shield;
  const available = balanceOf(company.books, from.id);
  if (input.cents > available) {
    throw new FundError(input.direction === "into" ? "That's more than General holds" : `That's more than ${fund.name} holds`);
  }
  const { books } = postEntry(company.books, {
    date: input.date,
    memo: input.memo?.trim() || (input.direction === "into" ? `Set aside for ${fund.name}` : `Released from ${fund.name}`),
    source: { ...MOVE_SOURCE },
    lines: [
      { accountId: to.id, debit: input.cents },
      { accountId: from.id, credit: input.cents },
    ],
  });
  return { ...company, books };
}

/** Closes a set-aside: whatever it holds goes back to General, then the account is made inactive. */
export function closeFund(company: Company, accountId: string, date: IsoDate): Company {
  const left = balanceOf(company.books, accountId);
  if (left < 0n) throw new FundError("This set-aside is below zero; move money into it before closing it");
  const emptied = left > 0n ? moveFund(company, { accountId, cents: left, direction: "out", date, memo: "Set-aside closed" }) : company;
  const funds = emptied.funds ?? emptyFunds();
  return { ...emptied, books: deactivateAccount(emptied.books, accountId), funds: { ...funds, funds: funds.funds.filter((f) => f.accountId !== accountId) } };
}
