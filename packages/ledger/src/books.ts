// ---------------------------------------------------------------------------
// The books: chart of accounts, an append-only journal, and period marks.
//
// Every operation is a pure function: (books, input) → new books. Nothing is
// ever edited or deleted in the journal. "Edit" and "void" post a reversal
// (and, for edit, a replacement), so history stays intact and every entry
// hash-chains to the one before it. The rules enforced here are the same
// ones gl_core.aleo will enforce in-circuit for anchored/settled modes:
//
//   1. Debits equal credits in every entry.
//   2. Every line hits an account that exists and is active.
//   3. Nothing is dated in a closed period; nothing in a locked period is reversed.
//   4. Receivable and payable lines name the customer or vendor.
// ---------------------------------------------------------------------------

import {
  type Account,
  type AccountInput,
  type SystemRole,
  ACCOUNT_TYPES,
  SYSTEM_ACCOUNTS,
  baseOf,
  validateAccount,
} from "./accounts";
import { fail } from "./errors";
import { GENESIS_HASH, hashEntry } from "./hash";
import { type Cents, sumCents } from "./money";
import {
  type IsoDate,
  type PeriodId,
  type PeriodMarks,
  assertDate,
  assertOpen,
  assertPeriod,
  periodOf,
  previousPeriod,
  statusOf,
} from "./periods";

// ---- Types -----------------------------------------------------------------

export type NameRef = { kind: "customer" | "vendor" | "employee" | "other"; id: string };

export type Tags = { class?: string; location?: string; project?: string };

export type Line = {
  accountId: string;
  debit: Cents;
  credit: Cents;
  memo?: string;
  name?: NameRef;
  tags?: Tags;
};

export type LineInput = Omit<Line, "debit" | "credit"> & { debit?: Cents; credit?: Cents };

export type SourceKind =
  | "manual"
  | "opening_balance"
  | "invoice"
  | "payment"
  | "deposit"
  | "bill"
  | "bill_payment"
  | "expense"
  | "payroll"
  | "tax_payment"
  | "sales_tax_payment"
  | "reversal";

/**
 * Where an entry came from. `ref` names the record that posted it (a run, an
 * invoice). `doc` is the hex BLAKE3 of the document the entry commits to (a
 * paystub, say): it's inside the entry hash, so the document is as
 * tamper-evident as the entry.
 */
export type Source = { kind: SourceKind; ref?: string; doc?: string };

export type EntryInput = {
  date: IsoDate;
  memo?: string;
  source?: Source;
  lines: LineInput[];
};

export type Entry = {
  id: string;
  seq: number;
  date: IsoDate;
  memo?: string;
  source: Source;
  lines: Line[];
  postedAt: string;
  /** Set on a reversal: the entry it cancels. */
  reverses?: string;
  /** Set on the new entry of an edit: the entry it replaces. */
  replaces?: string;
  prevHash: string;
  hash: string;
};

export type BooksEvent =
  | { kind: "closed"; through: PeriodId; at: string }
  | { kind: "reopened"; from: PeriodId; at: string }
  | { kind: "locked"; through: PeriodId; at: string };

export type Settings = {
  businessName: string;
  /** 1 = January. */
  fiscalYearStartMonth: number;
};

export type Books = {
  version: 1;
  settings: Settings;
  accounts: readonly Account[];
  entries: readonly Entry[];
  marks: PeriodMarks;
  events: readonly BooksEvent[];
  nextAccount: number;
};

/** Timestamps come from the caller so operations stay deterministic in tests. */
export type Clock = { now?: () => string };
const stamp = (clock?: Clock) => (clock?.now ?? (() => new Date().toISOString()))();

// ---- Books -----------------------------------------------------------------

export function createBooks(settings: Settings): Books {
  const month = settings.fiscalYearStartMonth;
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    fail("BAD_PERIOD", "Fiscal year must start in month 1–12");
  }
  let books: Books = {
    version: 1,
    settings: { ...settings },
    accounts: [],
    entries: [],
    marks: {},
    events: [],
    nextAccount: 1,
  };
  for (const sys of SYSTEM_ACCOUNTS) {
    books = insertAccount(books, { name: sys.name, type: sys.type }, sys.role);
  }
  return books;
}

export function accountMap(books: Books): Map<string, Account> {
  return new Map(books.accounts.map((a) => [a.id, a]));
}

export function systemAccount(books: Books, role: SystemRole): Account {
  const acct = books.accounts.find((a) => a.system === role);
  if (!acct) fail("UNKNOWN_ACCOUNT", `System account "${role}" is missing`);
  return acct;
}

// ---- Accounts --------------------------------------------------------------

function insertAccount(books: Books, input: AccountInput, system?: SystemRole): Books {
  const account: Account = {
    ...input,
    name: input.name.trim(),
    id: `acct-${books.nextAccount}`,
    active: true,
    ...(system ? { system } : {}),
  };
  validateAccount(accountMap(books), account);
  return { ...books, accounts: [...books.accounts, account], nextAccount: books.nextAccount + 1 };
}

export function addAccount(books: Books, input: AccountInput): { books: Books; account: Account } {
  const next = insertAccount(books, input);
  return { books: next, account: next.accounts[next.accounts.length - 1]! };
}

function hasPostings(books: Books, accountId: string): boolean {
  return books.entries.some((e) => e.lines.some((l) => l.accountId === accountId));
}

export function balanceOf(books: Books, accountId: string): Cents {
  let bal = 0n;
  for (const e of books.entries) for (const l of e.lines) if (l.accountId === accountId) bal += l.debit - l.credit;
  return bal;
}

export function updateAccount(
  books: Books,
  id: string,
  changes: Partial<Pick<Account, "name" | "number" | "type" | "parentId" | "description">>,
): Books {
  const accounts = accountMap(books);
  const current = accounts.get(id) ?? fail("UNKNOWN_ACCOUNT", `No account ${id}`);
  if (current.system && changes.type && changes.type !== current.type) {
    fail("SYSTEM_ACCOUNT", `"${current.name}" is a system account; its type can't change`);
  }
  const updated: Account = { ...current, ...changes, name: (changes.name ?? current.name).trim() };
  if (
    changes.type &&
    ACCOUNT_TYPES[changes.type].base !== baseOf(current) &&
    hasPostings(books, id)
  ) {
    fail("ACCOUNT_IN_USE", `"${current.name}" has postings; it can't move to a different statement section`);
  }
  validateAccount(accounts, updated);
  return { ...books, accounts: books.accounts.map((a) => (a.id === id ? updated : a)) };
}

/** Accounts are never deleted; they're made inactive, and only once they're empty. */
export function deactivateAccount(books: Books, id: string): Books {
  const acct = accountMap(books).get(id) ?? fail("UNKNOWN_ACCOUNT", `No account ${id}`);
  if (acct.system) fail("SYSTEM_ACCOUNT", `"${acct.name}" is a system account and stays active`);
  if (balanceOf(books, id) !== 0n) {
    fail("ACCOUNT_IN_USE", `"${acct.name}" still has a balance; move it to another account first`);
  }
  if (books.accounts.some((a) => a.parentId === id && a.active)) {
    fail("ACCOUNT_IN_USE", `"${acct.name}" has active sub-accounts`);
  }
  return { ...books, accounts: books.accounts.map((a) => (a.id === id ? { ...a, active: false } : a)) };
}

export function reactivateAccount(books: Books, id: string): Books {
  if (!accountMap(books).has(id)) fail("UNKNOWN_ACCOUNT", `No account ${id}`);
  return { ...books, accounts: books.accounts.map((a) => (a.id === id ? { ...a, active: true } : a)) };
}

// ---- Journal ---------------------------------------------------------------

function normalizeLines(books: Books, inputs: LineInput[]): Line[] {
  if (inputs.length < 2) fail("EMPTY_ENTRY", "A journal entry needs at least two lines");
  const accounts = accountMap(books);
  const lines = inputs.map((input, i): Line => {
    const debit = input.debit ?? 0n;
    const credit = input.credit ?? 0n;
    const where = `Line ${i + 1}`;
    if (typeof debit !== "bigint" || typeof credit !== "bigint") {
      fail("BAD_AMOUNT", `${where}: amounts must be whole cents (bigint)`);
    }
    if (debit < 0n || credit < 0n) fail("BAD_LINE", `${where}: amounts can't be negative; use the other column`);
    if ((debit > 0n) === (credit > 0n)) fail("BAD_LINE", `${where}: enter a debit or a credit, not both or neither`);

    const acct = accounts.get(input.accountId) ?? fail("UNKNOWN_ACCOUNT", `${where}: account not found`);
    if (!acct.active) fail("INACTIVE_ACCOUNT", `${where}: "${acct.name}" is inactive`);
    if (acct.type === "accounts_receivable" && input.name?.kind !== "customer") {
      fail("NAME_REQUIRED", `${where}: lines on "${acct.name}" must name a customer`);
    }
    if (acct.type === "accounts_payable" && input.name?.kind !== "vendor") {
      fail("NAME_REQUIRED", `${where}: lines on "${acct.name}" must name a vendor`);
    }
    return { ...input, debit, credit };
  });

  const debits = sumCents(lines.map((l) => l.debit));
  const credits = sumCents(lines.map((l) => l.credit));
  if (debits !== credits) {
    fail("UNBALANCED", `Debits (${debits}) and credits (${credits}) differ by ${debits - credits} cents`);
  }
  return lines;
}

function append(
  books: Books,
  draft: Omit<Entry, "id" | "seq" | "prevHash" | "hash" | "postedAt">,
  clock?: Clock,
): { books: Books; entry: Entry } {
  const seq = books.entries.length + 1;
  const prevHash = books.entries[books.entries.length - 1]?.hash ?? GENESIS_HASH;
  const unhashed = { ...draft, id: `je-${seq}`, seq, postedAt: stamp(clock), prevHash };
  const entry: Entry = { ...unhashed, hash: hashEntry(unhashed) };
  return { books: { ...books, entries: [...books.entries, entry] }, entry };
}

export function postEntry(books: Books, input: EntryInput, clock?: Clock): { books: Books; entry: Entry } {
  if (input.source?.kind === "reversal") fail("BAD_LINE", "Use reverseEntry to post a reversal");
  return post(books, input, {}, clock);
}

const DOC_HASH = /^[0-9a-f]{64}$/;

/** A document hash is 32 bytes as lower-case hex, exactly as the hash functions write it. */
function normalizeSource(source: Source | undefined): Source {
  if (!source) return { kind: "manual" };
  if (source.doc !== undefined && (typeof source.doc !== "string" || !DOC_HASH.test(source.doc))) {
    fail("BAD_DOC", "A document hash must be 64 lower-case hex characters");
  }
  return source;
}

function post(
  books: Books,
  input: EntryInput,
  links: Pick<Entry, "replaces">,
  clock?: Clock,
): { books: Books; entry: Entry } {
  const date = assertDate(input.date);
  assertOpen(books.marks, date);
  const source = normalizeSource(input.source);
  const lines = normalizeLines(books, input.lines);
  return append(
    books,
    {
      date,
      ...(input.memo ? { memo: input.memo } : {}),
      source,
      lines,
      ...links,
    },
    clock,
  );
}

export function findEntry(books: Books, id: string): Entry {
  return books.entries.find((e) => e.id === id) ?? fail("UNKNOWN_ENTRY", `No entry ${id}`);
}

/** The reversal that cancels `id`, if any. */
export function reversalOf(books: Books, id: string): Entry | undefined {
  return books.entries.find((e) => e.reverses === id);
}

/**
 * Cancels an entry by posting its mirror image. Dated like the original when
 * that period is open; otherwise the caller must pick a date in an open
 * period. Entries in a locked period can't be reversed at all.
 */
export function reverseEntry(
  books: Books,
  id: string,
  options: { date?: IsoDate; memo?: string } = {},
  clock?: Clock,
): { books: Books; entry: Entry } {
  const original = findEntry(books, id);
  if (original.reverses) fail("ALREADY_REVERSED", `${id} is itself a reversal; post a new entry instead`);
  if (reversalOf(books, id)) fail("ALREADY_REVERSED", `${id} has already been reversed`);
  if (statusOf(books.marks, periodOf(original.date)) === "locked") {
    fail("PERIOD_LOCKED", `${id} is in locked period ${periodOf(original.date)} and can't be reversed`);
  }
  const date = assertDate(options.date ?? original.date);
  assertOpen(books.marks, date);
  return append(
    books,
    {
      date,
      memo: options.memo ?? `Reverses ${original.id}${original.memo ? `: ${original.memo}` : ""}`,
      source: { kind: "reversal", ref: original.id },
      lines: original.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
      reverses: original.id,
    },
    clock,
  );
}

/**
 * What a user sees as "edit": reverse the original and post the corrected
 * entry, linked to it. Both land in the journal; nothing is overwritten.
 */
export function editEntry(
  books: Books,
  id: string,
  corrected: EntryInput,
  options: { reversalDate?: IsoDate } = {},
  clock?: Clock,
): { books: Books; reversal: Entry; entry: Entry } {
  const original = findEntry(books, id);
  // Validate the replacement before posting anything, so a bad edit changes nothing.
  assertOpen(books.marks, assertDate(corrected.date));
  normalizeSource(corrected.source);
  normalizeLines(books, corrected.lines);
  const reversed = reverseEntry(books, id, options.reversalDate ? { date: options.reversalDate } : {}, clock);
  const posted = post(
    reversed.books,
    { ...corrected, source: corrected.source ?? original.source },
    { replaces: id },
    clock,
  );
  return { books: posted.books, reversal: reversed.entry, entry: posted.entry };
}

function withoutHash(entry: Entry): Omit<Entry, "hash"> {
  const { hash: _hash, ...rest } = entry;
  return rest;
}

/** Recomputes every hash and link. Returns the first broken entry, if any. */
export function verifyChain(books: Books): { ok: true } | { ok: false; seq: number; reason: string } {
  let prev = GENESIS_HASH;
  for (const [i, e] of books.entries.entries()) {
    if (e.seq !== i + 1) return { ok: false, seq: i + 1, reason: "sequence gap" };
    if (e.prevHash !== prev) return { ok: false, seq: e.seq, reason: "broken link to previous entry" };
    if (hashEntry(withoutHash(e)) !== e.hash) return { ok: false, seq: e.seq, reason: "contents changed" };
    prev = e.hash;
  }
  return { ok: true };
}

// ---- Periods ---------------------------------------------------------------

/** Closes every period up to and including `period`. */
export function closeThrough(books: Books, period: PeriodId, clock?: Clock): Books {
  assertPeriod(period);
  if (books.marks.closedThrough && period <= books.marks.closedThrough) {
    fail("BAD_CLOSE", `Books are already closed through ${books.marks.closedThrough}`);
  }
  return {
    ...books,
    marks: { ...books.marks, closedThrough: period },
    events: [...books.events, { kind: "closed", through: period, at: stamp(clock) }],
  };
}

/** Reopens `period` and everything after it. Locked periods stay shut. */
export function reopenFrom(books: Books, period: PeriodId, clock?: Clock): Books {
  assertPeriod(period);
  const { closedThrough, lockedThrough } = books.marks;
  if (!closedThrough || period > closedThrough) fail("BAD_CLOSE", `${period} isn't closed`);
  if (lockedThrough && period <= lockedThrough) fail("PERIOD_LOCKED", `${period} is locked and can't be reopened`);
  // "Closed through" is a single mark, so reopening a month reopens every month after it.
  const marks: PeriodMarks = { ...books.marks, closedThrough: previousPeriod(period) };
  return { ...books, marks, events: [...books.events, { kind: "reopened", from: period, at: stamp(clock) }] };
}

/** Locks every period up to `period`. They must already be closed. Permanent. */
export function lockThrough(books: Books, period: PeriodId, clock?: Clock): Books {
  assertPeriod(period);
  const { closedThrough, lockedThrough } = books.marks;
  if (!closedThrough || period > closedThrough) fail("BAD_CLOSE", `Close ${period} before locking it`);
  if (lockedThrough && period <= lockedThrough) fail("BAD_CLOSE", `Already locked through ${lockedThrough}`);
  return {
    ...books,
    marks: { ...books.marks, lockedThrough: period },
    events: [...books.events, { kind: "locked", through: period, at: stamp(clock) }],
  };
}
