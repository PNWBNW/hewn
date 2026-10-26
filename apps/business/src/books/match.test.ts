import { describe, expect, it } from "vitest";
import { addAccount, createBooks, postEntry, reverseEntry } from "@pnw/ledger";
import { findRailAccount } from "@pnw/payroll";
import { type Company, emptyCompany } from "./company";
import { FIND_DAYS, matchCandidates, matchEntry } from "./match";
import { startFromShield } from "./opening";
import type { Rail } from "./rail";
import { reconcileShield, recordShieldDifference } from "./reconcile";
import { type ReviewItem, addReviewItems, excludeItem, undoReview, validateReview } from "./review";

const ADDR = "aleo1" + "q".repeat(58);
const rail: Rail = { version: 1, network: "testnet", address: ADDR, linkedAt: "2026-10-14T18:00:00.000Z", links: [] };
const tx = (n: number) => `at1${String(n).padStart(58, "x")}`;
const waiting = (n: number, direction: "in" | "out", minor: string, date = "2026-10-26"): ReviewItem => ({ id: tx(n), date, direction, minor, kind: "transfer_private", status: "new" });

/** Books following a $20.00 Shield balance, with an income and an expense account. */
function company(): { c: Company; income: string; expense: string } {
  const i = addAccount(createBooks({ businessName: "T", fiscalYearStartMonth: 1 }), { name: "Sales", type: "income" });
  const e = addAccount(i.books, { name: "Tools", type: "expense" });
  const c = startFromShield({ ...emptyCompany(e.books), rail }, { date: "2026-10-15", minor: 20_000_000n, at: "2026-10-15T10:00:00Z" });
  return { c, income: i.account.id, expense: e.account.id };
}

/** A deposit into the Shield account entered by hand. */
const byHand = (c: Company, account: string, cents: bigint, date: string, memo = "Birch, nails"): Company => {
  const shield = findRailAccount(c.books)!.id;
  return { ...c, books: postEntry(c.books, { date, memo, lines: [{ accountId: shield, debit: cents }, { accountId: account, credit: cents }] }).books };
};

describe("matching a movement to an entry already in the books (Joshua, 2026-10-26)", () => {
  it("suggests an entry with the same amount, the same way, near the same day", () => {
    const { c, income } = company();
    let books = byHand(byHand(c, income, 575n, "2026-10-26"), income, 575n, "2026-09-01", "Long ago");
    books = addReviewItems(books, [waiting(1, "in", "5750000")]);
    const item = books.review!.items[0]!;
    expect(matchCandidates(books, item).map((m) => m.entry.memo)).toEqual(["Birch, nails"]);
    expect(matchCandidates(books, item, FIND_DAYS).map((m) => m.entry.memo)).toEqual(["Birch, nails", "Long ago"]);
    // Not another amount, not the other way, not a move within the account, not one already reviewed.
    expect(matchCandidates(books, { ...item, minor: "1000000" })).toEqual([]);
    expect(matchCandidates(books, { ...item, direction: "out" })).toEqual([]);
    expect(matchCandidates(books, { ...item, within: true })).toEqual([]);
    expect(matchCandidates(books, { ...item, status: "excluded" })).toEqual([]);
    // Never the opening balance.
    expect(matchCandidates(addReviewItems(c, [waiting(2, "in", "200000000", "2026-10-15")]), waiting(2, "in", "200000000", "2026-10-15"))).toEqual([]);
  });

  it("finds a difference recorded from the Dashboard, and leaves out an entry undone or matched already", () => {
    const { c, income } = company();
    let books = recordShieldDifference(c, { cents: 575n, accountId: income, date: "2026-10-26" });
    books = addReviewItems(books, [waiting(1, "in", "5750000"), waiting(2, "in", "5750000")]);
    const [first, second] = books.review!.items;
    const entryId = matchCandidates(books, first!)[0]!.entry.id;
    const matched = matchEntry(books, tx(1), entryId);
    expect(matchCandidates(matched, second!)).toEqual([]);
    const undone = { ...books, books: reverseEntry(books.books, entryId, { date: "2026-10-26" }).books };
    expect(matchCandidates(undone, first!)).toEqual([]);
  });

  it("ties the movement to the entry, posts nothing, counts once, and can be undone (Joshua's test: excluding counted it twice)", () => {
    const { c, income } = company();
    // Shield got 5.75 the books couldn't read; it was recorded from the Dashboard; then the payment came in.
    let books = recordShieldDifference(c, { cents: 575n, accountId: income, date: "2026-10-26" });
    books = addReviewItems(books, [waiting(30, "in", "5750000")]);
    expect(reconcileShield(books, 25_750_000n)).toMatchObject({ kind: "off", waiting: 1 });
    expect(reconcileShield(excludeItem(books, tx(30)), 25_750_000n).kind).toBe("off");
    const entryId = matchCandidates(books, books.review!.items[0]!)[0]!.entry.id;
    const matched = matchEntry(books, tx(30), entryId);
    expect(matched.review!.items[0]).toMatchObject({ status: "recorded", entryId, matched: true });
    expect(matched.books.entries).toHaveLength(books.books.entries.length);
    expect(reconcileShield(matched, 25_750_000n).kind).toBe("matches");
    expect(validateReview(JSON.parse(JSON.stringify(matched.review)))).toEqual(matched.review);
    expect(() => matchEntry(matched, tx(30), entryId)).toThrow(/already been reviewed/);
    const back = undoReview(matched, tx(30), "2026-10-27");
    expect(back.review!.items[0]).toEqual(waiting(30, "in", "5750000"));
    expect(back.books.entries).toHaveLength(books.books.entries.length);
  });

  it("refuses an entry that isn't a match", () => {
    const { c, income, expense } = company();
    const shield = findRailAccount(c.books)!.id;
    let books = byHand(c, income, 100n, "2026-10-26");
    books = { ...books, books: postEntry(books.books, { date: "2026-10-26", lines: [{ accountId: expense, debit: 575n }, { accountId: shield, credit: 575n }] }).books };
    books = addReviewItems(books, [waiting(1, "in", "5750000")]);
    for (const e of books.books.entries) expect(() => matchEntry(books, tx(1), e.id)).toThrow(/doesn't match/);
    expect(() => validateReview({ version: 1, items: [{ ...waiting(1, "in", "1"), matched: true }] })).toThrow(/recorded item with its entry/);
  });
});
