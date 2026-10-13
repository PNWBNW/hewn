import { describe, expect, it } from "vitest";
import { postEntry } from "./books";
import { displayBalance, netIncome, trialBalance } from "./reports";
import { clock, sampleBooks } from "./test_helpers";

function yearOfActivity() {
  let { books, ids } = sampleBooks();
  const post = (date: string, lines: Parameters<typeof postEntry>[1]["lines"]) => {
    books = postEntry(books, { date, lines }, clock).books;
  };
  post("2025-01-05", [{ accountId: ids.checking!, debit: 1_000_000n }, { accountId: ids.owner!, credit: 1_000_000n }]);
  post("2025-06-01", [{ accountId: ids.checking!, debit: 400_000n }, { accountId: ids.sales!, credit: 400_000n }]);
  post("2025-06-02", [{ accountId: ids.rent!, debit: 150_000n }, { accountId: ids.checking!, credit: 150_000n }]);
  post("2026-02-01", [{ accountId: ids.checking!, debit: 90_000n }, { accountId: ids.sales!, credit: 90_000n }]);
  post("2026-02-03", [{ accountId: ids.rent!, debit: 30_000n }, { accountId: ids.card!, credit: 30_000n }]);
  return { books, ids };
}

describe("trial balance", () => {
  it("always balances", () => {
    const { books } = yearOfActivity();
    for (const asOf of ["2025-01-31", "2025-12-31", "2026-02-28"]) {
      const tb = trialBalance(books, asOf);
      expect(tb.totalDebit, asOf).toBe(tb.totalCredit);
    }
  });

  it("rolls last year's profit into Retained Earnings with no closing entry", () => {
    const { books, ids } = yearOfActivity();
    const tb = trialBalance(books, "2026-02-28");
    const row = (id: string) => tb.rows.find((r) => r.accountId === id);
    // 2025 profit: 4,000 sales − 1,500 rent = 2,500 → Retained Earnings (credit).
    expect(row(ids.retained_earnings!)).toMatchObject({ credit: 250_000n, debit: 0n });
    // Only 2026 activity shows on the income and expense lines.
    expect(row(ids.sales!)).toMatchObject({ credit: 90_000n });
    expect(row(ids.rent!)).toMatchObject({ debit: 30_000n });
    expect(row(ids.checking!)).toMatchObject({ debit: 1_340_000n });
    expect(books.entries.every((e) => e.source.kind !== "reversal")).toBe(true);
  });

  it("respects a fiscal year that doesn't start in January", () => {
    const sample = sampleBooks();
    const ids = sample.ids;
    let books = { ...sample.books, settings: { ...sample.books.settings, fiscalYearStartMonth: 7 } };
    books = postEntry(books, { date: "2026-06-30", lines: [{ accountId: ids.checking!, debit: 100n }, { accountId: ids.sales!, credit: 100n }] }, clock).books;
    books = postEntry(books, { date: "2026-07-01", lines: [{ accountId: ids.checking!, debit: 7n }, { accountId: ids.sales!, credit: 7n }] }, clock).books;
    const tb = trialBalance(books, "2026-07-31");
    expect(tb.rows.find((r) => r.accountId === ids.retained_earnings)?.credit).toBe(100n);
    expect(tb.rows.find((r) => r.accountId === ids.sales)?.credit).toBe(7n);
  });

  it("ignores entries dated after the report date", () => {
    const { books, ids } = yearOfActivity();
    expect(trialBalance(books, "2025-01-31").rows.map((r) => r.accountId).sort()).toEqual([ids.checking, ids.owner].sort());
  });
});

describe("net income and balances", () => {
  it("is income minus expenses for the range", () => {
    const { books } = yearOfActivity();
    expect(netIncome(books, "2025-01-01", "2025-12-31")).toBe(250_000n);
    expect(netIncome(books, "2026-01-01", "2026-12-31")).toBe(60_000n);
  });

  it("shows balances positive on each account's normal side", () => {
    const { books, ids } = yearOfActivity();
    expect(displayBalance(books, ids.checking!)).toBe(1_340_000n); // asset: debit-normal
    expect(displayBalance(books, ids.card!)).toBe(30_000n); // liability: credit-normal
    expect(displayBalance(books, ids.sales!, "2025-12-31")).toBe(400_000n);
  });
});
