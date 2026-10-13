// Property tests: throw thousands of random entries at the ledger and check
// that the invariants hold no matter what.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Books, postEntry, reverseEntry, verifyChain } from "./books";
import { trialBalance } from "./reports";
import { clock, sampleBooks } from "./test_helpers";

const { books: base, ids } = sampleBooks();
const plain = [ids.checking!, ids.sales!, ids.rent!, ids.card!, ids.owner!];

const amount = fc.bigInt({ min: 1n, max: 10_000_000_00n });
const day = fc.integer({ min: 1, max: 28 }).map((d) => `2026-10-${String(d).padStart(2, "0")}`);

/** A random balanced entry: N debit lines, then credits that add up to the same total. */
const balancedEntry = fc
  .record({
    debits: fc.array(fc.record({ account: fc.constantFrom(...plain), cents: amount }), { minLength: 1, maxLength: 5 }),
    creditAccounts: fc.array(fc.constantFrom(...plain), { minLength: 1, maxLength: 4 }),
    date: day,
  })
  .map(({ debits, creditAccounts, date }) => {
    const total = debits.reduce((s, d) => s + d.cents, 0n);
    const n = BigInt(creditAccounts.length);
    const share = total / n;
    const credits = creditAccounts.map((account, i) => ({
      accountId: account,
      credit: i === creditAccounts.length - 1 ? total - share * (n - 1n) : share,
    }));
    return {
      date,
      lines: [...debits.map((d) => ({ accountId: d.account, debit: d.cents })), ...credits].filter(
        (l) => ("debit" in l ? l.debit : l.credit) > 0n,
      ),
    };
  })
  .filter((e) => e.lines.length >= 2);

describe("ledger invariants (property-based)", () => {
  it("any balanced entries post, and the trial balance always balances", () => {
    fc.assert(
      fc.property(fc.array(balancedEntry, { minLength: 1, maxLength: 30 }), (entries) => {
        let books: Books = base;
        for (const e of entries) books = postEntry(books, e, clock).books;
        const tb = trialBalance(books, "2026-10-31");
        expect(tb.totalDebit).toBe(tb.totalCredit);
        expect(verifyChain(books)).toEqual({ ok: true });
      }),
      { numRuns: 300 },
    );
  });

  it("any entry that is off by even one cent is rejected", () => {
    fc.assert(
      fc.property(balancedEntry, fc.bigInt({ min: 1n, max: 1_000n }), (entry, skew) => {
        const lines = entry.lines.map((l, i) => (i === 0 && "debit" in l ? { ...l, debit: l.debit + skew } : l));
        expect(() => postEntry(base, { ...entry, lines })).toThrow(expect.objectContaining({ code: "UNBALANCED" }));
      }),
      { numRuns: 300 },
    );
  });

  it("reversing everything brings every balance back to zero", () => {
    fc.assert(
      fc.property(fc.array(balancedEntry, { minLength: 1, maxLength: 15 }), (entries) => {
        let books: Books = base;
        for (const e of entries) books = postEntry(books, e, clock).books;
        for (const e of [...books.entries]) books = reverseEntry(books, e.id, {}, clock).books;
        expect(trialBalance(books, "2026-10-31").rows).toEqual([]);
        expect(verifyChain(books)).toEqual({ ok: true });
      }),
      { numRuns: 150 },
    );
  });

  it("tampering with any single stored amount is detected", () => {
    fc.assert(
      fc.property(fc.array(balancedEntry, { minLength: 2, maxLength: 10 }), fc.nat(), fc.nat(), (entries, ei, li) => {
        let books: Books = base;
        for (const e of entries) books = postEntry(books, e, clock).books;
        const forged = structuredClone(books) as Books;
        const entry = forged.entries[ei % forged.entries.length]!;
        const line = entry.lines[li % entry.lines.length] as { debit: bigint; credit: bigint };
        if (line.debit > 0n) line.debit += 1n;
        else line.credit += 1n;
        expect(verifyChain(forged).ok).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
