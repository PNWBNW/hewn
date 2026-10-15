import { describe, expect, it } from "vitest";
import { addAccount, balanceOf, createBooks } from "@pnw/ledger";
import { findRailAccount } from "@pnw/payroll";
import { type Company, companyFromJson, companyToJson, emptyCompany } from "./company";
import { startFromShield } from "./opening";
import { type Rail } from "./rail";
import {
  type ReviewItem,
  acceptItem,
  addReviewItems,
  byNewest,
  excludeItem,
  knownIds,
  undoReview,
  validateReview,
  waitingCount,
} from "./review";

const ADDR = "aleo1" + "q".repeat(58);
const DAO = "aleo1" + "d".repeat(58);
const tx = (n: number) => `at1${String(n).padStart(58, "x")}`;
const rail: Rail = { version: 1, network: "testnet", address: ADDR, linkedAt: "2026-10-14T18:00:00.000Z", links: [] };

function company(): { c: Company; expense: string; income: string } {
  let books = createBooks({ businessName: "T", fiscalYearStartMonth: 1 });
  const e = addAccount(books, { name: "Software", type: "expense" });
  books = e.books;
  const i = addAccount(books, { name: "Service Income", type: "income" });
  const c = startFromShield({ ...emptyCompany(i.books), rail }, { date: "2026-10-15", minor: 20_000_000n, at: "2026-10-15T10:00:00Z" });
  return { c, expense: e.account.id, income: i.account.id };
}

const sent: ReviewItem = { id: tx(1), date: "2026-10-16", direction: "out", minor: "4625000", counterparty: DAO, kind: "transfer_public", status: "new" };
const received: ReviewItem = { id: tx(2), date: "2026-10-16", at: "2026-10-16T12:00:00Z", direction: "in", minor: "4250000", kind: "transfer_public", status: "new" };

describe("the review list", () => {
  it("adds found movements once, however often the check runs", () => {
    const { c } = company();
    const once = addReviewItems(c, [sent, received]);
    const twice = addReviewItems(once, [sent, { ...received, status: "new" }]);
    expect(twice.review?.items).toHaveLength(2);
    expect(waitingCount(twice.review)).toBe(2);
    expect(knownIds(twice.review)).toEqual(new Set([tx(1), tx(2)]));
    expect(addReviewItems(once, [])).toBe(once);
  });

  it("marks a paycheck the app already paid as recorded", () => {
    const { c } = company();
    const withRun = {
      ...c,
      payroll: { ...c.payroll, runs: [{ paychecks: [{ settlement: { status: "settled", reference: tx(1) } }] }] },
    } as unknown as Company;
    const next = addReviewItems(withRun, [sent]);
    expect(next.review?.items[0]?.status).toBe("recorded");
    expect(waitingCount(next.review)).toBe(0);
  });

  it("posts money out against the chosen account, and money in the other way", () => {
    const { c, expense, income } = company();
    let next = addReviewItems(c, [sent, received]);
    next = acceptItem(next, tx(1), { accountId: expense, name: { kind: "vendor", id: "v1" }, tags: { project: "p1" }, memo: " Hosting " });
    next = acceptItem(next, tx(2), { accountId: income });
    const shield = findRailAccount(next.books)!.id;
    // 20.00 opening − 4.62 out + 4.25 in (a fraction of a cent is never posted).
    expect(balanceOf(next.books, shield)).toBe(2000n - 462n + 425n);
    expect(balanceOf(next.books, expense)).toBe(462n);
    expect(balanceOf(next.books, income)).toBe(-425n);
    const out = next.books.entries.find((e) => e.id === next.review!.items[0]!.entryId)!;
    expect(out).toMatchObject({ date: "2026-10-16", memo: "Hosting", source: { kind: "expense", ref: `review:${tx(1)}` } });
    expect(out.lines.find((l) => l.accountId === expense)).toMatchObject({ name: { kind: "vendor", id: "v1" }, tags: { project: "p1" } });
    expect(waitingCount(next.review)).toBe(0);
  });

  it("refuses to post twice, to the Shield account itself, to no account, or under a cent", () => {
    const { c, expense } = company();
    const shield = findRailAccount(c.books)!.id;
    let next = addReviewItems(c, [sent, { ...received, id: tx(3), minor: "9999" }]);
    expect(() => acceptItem(next, tx(1), { accountId: shield })).toThrow(/other than the Shield account/);
    expect(() => acceptItem(next, tx(1), { accountId: "acct-nope" })).toThrow(/Choose an account/);
    expect(() => acceptItem(next, tx(3), { accountId: expense })).toThrow(/less than a cent/);
    next = acceptItem(next, tx(1), { accountId: expense });
    expect(() => acceptItem(next, tx(1), { accountId: expense })).toThrow(/already been reviewed/);
    expect(() => acceptItem(next, tx(9), { accountId: expense })).toThrow(/isn't in the review list/);
  });

  it("excludes, and sends back: an excluded item simply, an accepted one by reversing its entry", () => {
    const { c, expense } = company();
    let next = addReviewItems(c, [sent, received]);
    next = excludeItem(next, tx(2));
    expect(waitingCount(next.review)).toBe(1);
    next = undoReview(next, tx(2), "2026-10-17");
    expect(next.review?.items.find((i) => i.id === tx(2))?.status).toBe("new");

    next = acceptItem(next, tx(1), { accountId: expense });
    const entries = next.books.entries.length;
    next = undoReview(next, tx(1), "2026-10-17");
    const item = next.review!.items.find((i) => i.id === tx(1))!;
    expect(item).toMatchObject({ status: "new" });
    expect(item.entryId).toBeUndefined();
    expect(next.books.entries).toHaveLength(entries + 1);
    expect(balanceOf(next.books, expense)).toBe(0n);
    expect(() => undoReview(next, tx(1), "2026-10-17")).toThrow(/Only accepted or excluded/);
  });

  it("keeps the list through a save and reload, and refuses malformed items", () => {
    const { c, expense } = company();
    const next = acceptItem(addReviewItems(c, [sent, received]), tx(1), { accountId: expense });
    expect(companyFromJson(companyToJson(next)).review).toEqual(next.review);
    for (const bad of [
      { ...sent, id: "nope" },
      { ...sent, direction: "sideways" },
      { ...sent, minor: "-1" },
      { ...sent, counterparty: "bob" },
      { ...sent, status: "accepted" },
      { ...sent, status: "maybe" },
      { ...sent, kind: "Transfer Public" },
    ]) {
      expect(() => validateReview({ version: 1, items: [bad] })).toThrow();
    }
  });

  it("lists newest first", () => {
    expect(byNewest([sent, received, { ...sent, id: tx(4), date: "2026-10-18" }]).map((i) => i.id)).toEqual([tx(4), tx(2), tx(1)]);
  });
});
