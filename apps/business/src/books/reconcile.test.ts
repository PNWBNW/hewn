import { describe, expect, it } from "vitest";
import { addAccount, createBooks, postEntry } from "@pnw/ledger";
import { type PayRun, findRailAccount } from "@pnw/payroll";
import { type Company, emptyCompany } from "./company";
import { createFund, moveFund } from "./funds";
import { startFromShield } from "./opening";
import type { Rail } from "./rail";
import { differenceFor, reconcileShield, recordShieldDifference } from "./reconcile";
import { type ReviewItem, acceptItem, addReviewItems, excludeItem, keepWithin, matchDifference } from "./review";

const ADDR = "aleo1" + "q".repeat(58);
const rail: Rail = { version: 1, network: "testnet", address: ADDR, linkedAt: "2026-10-14T18:00:00.000Z", links: [] };
const tx = (n: number) => `at1${String(n).padStart(58, "x")}`;
const item = (n: number, direction: "in" | "out", minor: string): ReviewItem => ({ id: tx(n), date: "2026-10-16", direction, minor, kind: "transfer_public", status: "new" });

/** Books started from a $20.00 Shield balance (or `opening` minor units), with a cash account and an expense account beside it. */
function company(opening = 20_000_000n): { c: Company; expense: string; cash: string; income: string } {
  let books = createBooks({ businessName: "T", fiscalYearStartMonth: 1 });
  const e = addAccount(books, { name: "Materials", type: "expense" });
  const k = addAccount(e.books, { name: "Cash on hand", type: "bank" });
  const i = addAccount(k.books, { name: "Sales", type: "income" });
  books = i.books;
  const c = startFromShield({ ...emptyCompany(books), rail }, { date: "2026-10-15", minor: opening, at: "2026-10-15T10:00:00Z" });
  return { c, expense: e.account.id, cash: k.account.id, income: i.account.id };
}

/** A rail pay run from the Shield account with one paycheck of `net` cents in the given state (only what the check reads). */
function railRun(c: Company, net: bigint, status: "pending" | "settled" | "failed"): Company {
  const run = {
    id: "run-1",
    payDate: "2026-10-17",
    periodStart: "2026-10-10",
    periodEnd: "2026-10-16",
    bankAccountId: findRailAccount(c.books)!.id,
    mode: "rail",
    paychecks: [{ workerId: "w1", net, settlement: { status } }],
    entryIds: [],
  } as unknown as PayRun;
  return { ...c, payroll: { ...c.payroll, runs: [run] } };
}

describe("reconciling the Shield account", () => {
  it("has nothing to compare until the books follow a Shield account", () => {
    const books = createBooks({ businessName: "T", fiscalYearStartMonth: 1 });
    expect(reconcileShield(emptyCompany(books), 20_000_000n)).toEqual({ kind: "not_started" });
    expect(reconcileShield({ ...emptyCompany(books), rail }, 20_000_000n)).toEqual({ kind: "not_started" });
  });

  it("waits for the balance when Shield isn't read", () => {
    expect(reconcileShield(company().c, null)).toEqual({ kind: "unread", books: 2000n });
  });

  it("matches when the books and Shield agree", () => {
    expect(reconcileShield(company().c, 20_000_000n)).toEqual({ kind: "matches", books: 2000n, shield: 2000n });
  });

  it("matches when the opening balance dropped a fraction of a cent", () => {
    // $20.004999 opens the books at $20.00; Shield still holds the fraction.
    expect(reconcileShield(company(20_004_999n).c, 20_004_999n)).toMatchObject({ kind: "matches" });
  });

  it("ignores cash and every other account: only the Shield account is compared (Joshua, 2026-10-26)", () => {
    const { c, expense, cash, income } = company();
    // Materials bought with cash, an invoice paid in cash: the books' cash moves, Shield doesn't.
    let books = postEntry(c.books, { date: "2026-10-16", lines: [{ accountId: expense, debit: 15000n }, { accountId: cash, credit: 15000n }] }).books;
    books = postEntry(books, { date: "2026-10-16", lines: [{ accountId: cash, debit: 90000n }, { accountId: income, credit: 90000n }] }).books;
    expect(reconcileShield({ ...c, books }, 20_000_000n)).toMatchObject({ kind: "matches", books: 2000n });
  });

  it("counts the set-asides: moving money into one changes nothing", () => {
    const { c } = company();
    const made = createFund(c, { name: "Equipment fund" });
    const next = moveFund(made.company, { accountId: made.accountId, cents: 1500n, direction: "into", date: "2026-10-16" });
    expect(reconcileShield(next, 20_000_000n)).toMatchObject({ kind: "matches", books: 2000n });
  });

  it("explains a difference by movements waiting in For review", () => {
    const { c } = company();
    const next = addReviewItems(c, [item(1, "in", "4250000"), item(2, "out", "1000000")]);
    expect(reconcileShield(next, 23_250_000n)).toEqual({ kind: "waiting", books: 2000n, shield: 2325n, count: 2, minor: 3_250_000n });
  });

  it("matches once a movement is accepted, keeping the fraction of a cent it dropped", () => {
    const { c, expense } = company();
    // $4.6250001 out: the books post $4.62, Shield loses the full amount.
    let next = addReviewItems(c, [item(1, "out", "4625001")]);
    next = acceptItem(next, tx(1), { accountId: expense });
    expect(reconcileShield(next, 20_000_000n - 4_625_001n)).toMatchObject({ kind: "matches", books: 1538n });
  });

  it("matches with a movement excluded on purpose, which stays on the network and out of the books", () => {
    const { c } = company();
    const next = excludeItem(addReviewItems(c, [item(1, "in", "1000000")]), tx(1));
    expect(reconcileShield(next, 21_000_000n)).toMatchObject({ kind: "matches", books: 2000n });
  });

  it("flags a difference nothing explains, either way", () => {
    const { c } = company();
    // Shield holds a dollar less than the books, and nothing is waiting or settling.
    expect(reconcileShield(c, 19_000_000n)).toEqual({ kind: "off", books: 2000n, shield: 1900n, gap: -1_000_000n, waiting: 0 });
    // Shield holds a dollar more: money the feed hasn't found yet, say.
    expect(reconcileShield(c, 21_000_000n)).toMatchObject({ kind: "off", gap: 1_000_000n });
  });

  it("flags an entry posted to the Shield account by hand", () => {
    const { c, expense } = company();
    const shield = findRailAccount(c.books)!.id;
    const books = postEntry(c.books, { date: "2026-10-16", lines: [{ accountId: expense, debit: 300n }, { accountId: shield, credit: 300n }] }).books;
    expect(reconcileShield({ ...c, books }, 20_000_000n)).toMatchObject({ kind: "off", books: 1700n, gap: 3_000_000n });
  });

  it("never counts a move within the account, waiting or kept (Joshua's test, 2026-10-26)", () => {
    const join: ReviewItem = { id: tx(9), date: "2026-10-16", direction: "in", minor: "37190000", kind: "join_2", within: true, status: "new" };
    const listed = addReviewItems(company().c, [join]);
    expect(reconcileShield(listed, 20_000_000n).kind).toBe("matches");
    expect(reconcileShield(keepWithin(listed, tx(9)), 20_000_000n).kind).toBe("matches");
    expect(reconcileShield(excludeItem(listed, tx(9)), 20_000_000n).kind).toBe("matches");
  });

  it("records a difference nothing explains from the flag, either way, and then matches", () => {
    const { c, income, expense } = company();
    // Shield holds $5.75 more: a private payment the books couldn't read.
    expect(reconcileShield(c, 25_750_000n)).toMatchObject({ kind: "off", books: 2000n, shield: 2575n });
    const inn = recordShieldDifference(c, { cents: 575n, accountId: income, date: "2026-10-26", memo: "Birch, nails" });
    expect(reconcileShield(inn, 25_750_000n).kind).toBe("matches");
    expect(inn.books.entries.at(-1)).toMatchObject({ memo: "Birch, nails", source: { kind: "deposit" } });
    const out = recordShieldDifference(c, { cents: -300n, accountId: expense, date: "2026-10-26" });
    expect(reconcileShield(out, 17_000_000n).kind).toBe("matches");
    expect(() => recordShieldDifference(c, { cents: 0n, accountId: income, date: "2026-10-26" })).toThrow(/no difference/);
    expect(() => recordShieldDifference(c, { cents: 575n, accountId: findRailAccount(c.books)!.id, date: "2026-10-26" })).toThrow(/other than/);
    expect(() => recordShieldDifference(c, { cents: 575n, accountId: "nope", date: "2026-10-26" })).toThrow(/Choose an account/);
  });

  it("reminds the business when a payment waiting in For review may be a difference it already recorded", () => {
    const { c, income } = company();
    const recorded = recordShieldDifference(c, { cents: 575n, accountId: income, date: "2026-10-26" });
    const birch: ReviewItem = { ...item(20, "in", "5750000"), date: "2026-10-26" };
    expect(differenceFor(recorded.books, birch)).toMatchObject({ date: "2026-10-26", cents: 575n });
    // Not another amount, not the other way, not a move within, not one already reviewed, not one after the difference was recorded.
    expect(differenceFor(recorded.books, { ...birch, minor: "1000000" })).toBeNull();
    expect(differenceFor(recorded.books, { ...birch, direction: "out" })).toBeNull();
    expect(differenceFor(recorded.books, { ...birch, within: true })).toBeNull();
    expect(differenceFor(recorded.books, { ...birch, status: "excluded" })).toBeNull();
    expect(differenceFor(recorded.books, { ...birch, date: "2026-10-27" })).toBeNull();
    expect(differenceFor(c.books, birch)).toBeNull();
  });

  it("counts a payment tied to a recorded difference once, where excluding it would count it twice (Joshua's test, 2026-10-26)", () => {
    const { c, income } = company();
    // Shield got 5.75 the books couldn't read; it was recorded from the Dashboard; then the payment came in.
    let books = recordShieldDifference(c, { cents: 575n, accountId: income, date: "2026-10-26" });
    books = addReviewItems(books, [{ ...item(30, "in", "5750000"), date: "2026-10-26" }]);
    expect(reconcileShield(books, 25_750_000n)).toMatchObject({ kind: "off", waiting: 1 });
    const entryId = differenceFor(books.books, books.review!.items[0]!)!.entryId;
    const matched = matchDifference(books, tx(30), entryId);
    expect(matched.review!.items[0]).toMatchObject({ status: "recorded", entryId });
    expect(matched.books.entries).toHaveLength(books.books.entries.length);
    expect(reconcileShield(matched, 25_750_000n).kind).toBe("matches");
    expect(reconcileShield(excludeItem(books, tx(30)), 25_750_000n).kind).toBe("off");
    expect(() => matchDifference(matched, tx(30), entryId)).toThrow(/already been reviewed/);
  });

  it("holds off while rail pay is settling, and judges again once it has", () => {
    const { c } = company();
    const shield = findRailAccount(c.books)!.id;
    // The run posted: $5.00 net is gone from the books, not yet from Shield.
    const books = postEntry(c.books, { date: "2026-10-17", lines: [{ accountId: c.books.accounts.find((a) => a.type === "expense")!.id, debit: 500n }, { accountId: shield, credit: 500n }] }).books;
    const posted = { ...c, books };
    expect(reconcileShield(railRun(posted, 500n, "pending"), 20_000_000n)).toEqual({ kind: "settling", books: 1500n, shield: 2000n, count: 1 });
    expect(reconcileShield(railRun(posted, 500n, "failed"), 20_000_000n)).toMatchObject({ kind: "settling" });
    // Once the transfer left Shield, the two agree, settled or not.
    expect(reconcileShield(railRun(posted, 500n, "pending"), 15_000_000n)).toMatchObject({ kind: "matches" });
    // Settled but the money is still in Shield: nothing explains it.
    expect(reconcileShield(railRun(posted, 500n, "settled"), 20_000_000n)).toMatchObject({ kind: "off", gap: 5_000_000n });
  });
});
