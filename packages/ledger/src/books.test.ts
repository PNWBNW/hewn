import { describe, expect, it } from "vitest";
import {
  type Books,
  addAccount,
  balanceOf,
  closeThrough,
  createBooks,
  deactivateAccount,
  editEntry,
  lockThrough,
  postEntry,
  reopenFrom,
  reverseEntry,
  reversalOf,
  updateAccount,
  verifyChain,
} from "./books";
import { SYSTEM_ACCOUNTS } from "./accounts";
import type { Entry } from "./books";
import { hashEntry } from "./hash";
import { clock, sampleBooks } from "./test_helpers";

const code = (c: string) => expect.objectContaining({ code: c });

function rentPaid(ids: Record<string, string>, date = "2026-10-01", cents = 150000n) {
  return {
    date,
    memo: "October rent",
    lines: [
      { accountId: ids.rent!, debit: cents },
      { accountId: ids.checking!, credit: cents },
    ],
  };
}

describe("new books", () => {
  it("come with every system account, active", () => {
    const books = createBooks({ businessName: "X", fiscalYearStartMonth: 1 });
    expect(books.accounts.map((a) => a.system)).toEqual(SYSTEM_ACCOUNTS.map((s) => s.role));
    expect(books.accounts.every((a) => a.active)).toBe(true);
  });

  it("reject a fiscal year that doesn't start in a real month", () => {
    expect(() => createBooks({ businessName: "X", fiscalYearStartMonth: 13 })).toThrow(code("BAD_PERIOD"));
  });
});

describe("chart of accounts", () => {
  it("rejects duplicate names and numbers", () => {
    const { books } = sampleBooks();
    expect(() => addAccount(books, { name: "checking", type: "bank" })).toThrow(code("DUPLICATE_ACCOUNT"));
    const numbered = addAccount(books, { name: "Petty Cash", number: "1050", type: "bank" }).books;
    expect(() => addAccount(numbered, { name: "Till", number: "1050", type: "bank" })).toThrow(code("DUPLICATE_ACCOUNT"));
  });

  it("only nests sub-accounts under the same statement section", () => {
    const { books, ids } = sampleBooks();
    expect(addAccount(books, { name: "Office Rent", type: "expense", parentId: ids.rent }).account.parentId).toBe(ids.rent);
    expect(() => addAccount(books, { name: "Oops", type: "bank", parentId: ids.rent })).toThrow(code("BAD_PARENT"));
  });

  it("caps nesting at five levels and refuses cycles", () => {
    let { books, ids } = sampleBooks();
    let parent = ids.rent!;
    for (let i = 2; i <= 5; i++) {
      const r = addAccount(books, { name: `Level ${i}`, type: "expense", parentId: parent });
      books = r.books;
      parent = r.account.id;
    }
    expect(() => addAccount(books, { name: "Level 6", type: "expense", parentId: parent })).toThrow(code("BAD_PARENT"));
    expect(() => updateAccount(books, ids.rent!, { parentId: parent })).toThrow(code("BAD_PARENT"));
  });

  it("never lets a system account change type or go inactive", () => {
    const { books, ids } = sampleBooks();
    expect(() => updateAccount(books, ids.retained_earnings!, { type: "income" })).toThrow(code("SYSTEM_ACCOUNT"));
    expect(() => deactivateAccount(books, ids.accounts_receivable!)).toThrow(code("SYSTEM_ACCOUNT"));
  });

  it("deactivates only empty accounts, and a used one can't jump statement sections", () => {
    const { books, ids } = sampleBooks();
    const { books: used } = postEntry(books, rentPaid(ids), clock);
    expect(() => deactivateAccount(used, ids.rent!)).toThrow(code("ACCOUNT_IN_USE"));
    expect(() => updateAccount(used, ids.rent!, { type: "fixed_asset" })).toThrow(code("ACCOUNT_IN_USE"));
    expect(updateAccount(used, ids.rent!, { type: "other_expense" }).accounts.find((a) => a.id === ids.rent)!.type).toBe("other_expense");
    expect(deactivateAccount(books, ids.rent!).accounts.find((a) => a.id === ids.rent)!.active).toBe(false);
  });
});

describe("posting", () => {
  it("records a balanced entry and moves both balances", () => {
    const { books, ids } = sampleBooks();
    const { books: next, entry } = postEntry(books, rentPaid(ids), clock);
    expect(entry).toMatchObject({ id: "je-1", seq: 1, source: { kind: "manual" } });
    expect(balanceOf(next, ids.rent!)).toBe(150000n);
    expect(balanceOf(next, ids.checking!)).toBe(-150000n);
    expect(books.entries).toHaveLength(0); // input books untouched
  });

  it("rejects an unbalanced entry", () => {
    const { books, ids } = sampleBooks();
    const bad = { date: "2026-10-01", lines: [{ accountId: ids.rent!, debit: 100n }, { accountId: ids.checking!, credit: 99n }] };
    expect(() => postEntry(books, bad)).toThrow(code("UNBALANCED"));
  });

  it("rejects one-line entries, both-sided lines, empty lines and negative amounts", () => {
    const { books, ids } = sampleBooks();
    const r = ids.rent!, c = ids.checking!;
    expect(() => postEntry(books, { date: "2026-10-01", lines: [{ accountId: r, debit: 1n }] })).toThrow(code("EMPTY_ENTRY"));
    expect(() => postEntry(books, { date: "2026-10-01", lines: [{ accountId: r, debit: 1n, credit: 1n }, { accountId: c }] })).toThrow(code("BAD_LINE"));
    expect(() => postEntry(books, { date: "2026-10-01", lines: [{ accountId: r }, { accountId: c }] })).toThrow(code("BAD_LINE"));
    expect(() => postEntry(books, { date: "2026-10-01", lines: [{ accountId: r, debit: -5n }, { accountId: c, credit: -5n }] })).toThrow(code("BAD_LINE"));
  });

  it("rejects floating-point amounts outright", () => {
    const { books, ids } = sampleBooks();
    const floaty = { date: "2026-10-01", lines: [{ accountId: ids.rent!, debit: 0.1 as unknown as bigint }, { accountId: ids.checking!, credit: 0.1 as unknown as bigint }] };
    expect(() => postEntry(books, floaty)).toThrow(code("BAD_AMOUNT"));
  });

  it("rejects unknown and inactive accounts", () => {
    const { books, ids } = sampleBooks();
    expect(() => postEntry(books, { date: "2026-10-01", lines: [{ accountId: "acct-999", debit: 1n }, { accountId: ids.checking!, credit: 1n }] })).toThrow(code("UNKNOWN_ACCOUNT"));
    const inactive = deactivateAccount(books, ids.rent!);
    expect(() => postEntry(inactive, rentPaid(ids))).toThrow(code("INACTIVE_ACCOUNT"));
  });

  it("requires a customer on receivables and a vendor on payables", () => {
    const { books, ids } = sampleBooks();
    const invoice = (name?: { kind: "customer" | "vendor"; id: string }) => ({
      date: "2026-10-02",
      lines: [{ accountId: ids.accounts_receivable!, debit: 5000n, ...(name ? { name } : {}) }, { accountId: ids.sales!, credit: 5000n }],
    });
    expect(() => postEntry(books, invoice())).toThrow(code("NAME_REQUIRED"));
    expect(() => postEntry(books, invoice({ kind: "vendor", id: "v1" }))).toThrow(code("NAME_REQUIRED"));
    expect(postEntry(books, invoice({ kind: "customer", id: "c1" })).entry.lines[0]!.name).toEqual({ kind: "customer", id: "c1" });

    const bill = { date: "2026-10-02", lines: [{ accountId: ids.rent!, debit: 100n }, { accountId: ids.accounts_payable!, credit: 100n }] };
    expect(() => postEntry(books, bill)).toThrow(code("NAME_REQUIRED"));
  });

  it("rejects impossible dates", () => {
    const { books, ids } = sampleBooks();
    for (const date of ["2026-02-30", "2026-13-01", "26-10-01", "2026/10/01"]) {
      expect(() => postEntry(books, rentPaid(ids, date)), date).toThrow(code("BAD_DATE"));
    }
  });

  it("won't post something labelled as a reversal", () => {
    const { books, ids } = sampleBooks();
    expect(() => postEntry(books, { ...rentPaid(ids), source: { kind: "reversal" } })).toThrow(code("BAD_LINE"));
  });
});

describe("reversals and edits", () => {
  it("a reversal mirrors the original and nets it to zero", () => {
    const { books, ids } = sampleBooks();
    const { books: b1, entry } = postEntry(books, rentPaid(ids), clock);
    const { books: b2, entry: rev } = reverseEntry(b1, entry.id, {}, clock);
    expect(rev).toMatchObject({ reverses: entry.id, date: entry.date, source: { kind: "reversal", ref: entry.id } });
    expect(rev.lines[0]).toMatchObject({ accountId: ids.rent, debit: 0n, credit: 150000n });
    expect(balanceOf(b2, ids.rent!)).toBe(0n);
    expect(b2.entries).toHaveLength(2); // the original is still there
    expect(reversalOf(b2, entry.id)?.id).toBe(rev.id);
  });

  it("refuses to reverse twice, or to reverse a reversal", () => {
    const { books, ids } = sampleBooks();
    const { books: b1, entry } = postEntry(books, rentPaid(ids), clock);
    const { books: b2, entry: rev } = reverseEntry(b1, entry.id, {}, clock);
    expect(() => reverseEntry(b2, entry.id)).toThrow(code("ALREADY_REVERSED"));
    expect(() => reverseEntry(b2, rev.id)).toThrow(code("ALREADY_REVERSED"));
    expect(() => reverseEntry(b2, "je-404")).toThrow(code("UNKNOWN_ENTRY"));
  });

  it("an edit is a reversal plus a linked replacement", () => {
    const { books, ids } = sampleBooks();
    const { books: b1, entry } = postEntry(books, rentPaid(ids), clock);
    const { books: b2, reversal, entry: fixed } = editEntry(b1, entry.id, rentPaid(ids, "2026-10-01", 160000n), {}, clock);
    expect(reversal.reverses).toBe(entry.id);
    expect(fixed.replaces).toBe(entry.id);
    expect(balanceOf(b2, ids.rent!)).toBe(160000n);
    expect(b2.entries.map((e) => e.id)).toEqual(["je-1", "je-2", "je-3"]);
    expect(verifyChain(b2)).toEqual({ ok: true });
  });

  it("a bad edit changes nothing", () => {
    const { books, ids } = sampleBooks();
    const { books: b1, entry } = postEntry(books, rentPaid(ids), clock);
    const unbalanced = { date: "2026-10-01", lines: [{ accountId: ids.rent!, debit: 2n }, { accountId: ids.checking!, credit: 1n }] };
    expect(() => editEntry(b1, entry.id, unbalanced)).toThrow(code("UNBALANCED"));
    expect(b1.entries).toHaveLength(1);
  });
});

describe("periods", () => {
  function withSeptember(): { books: Books; ids: Record<string, string>; septId: string } {
    const { books, ids } = sampleBooks();
    const { books: b, entry } = postEntry(books, rentPaid(ids, "2026-09-01"), clock);
    return { books: b, ids, septId: entry.id };
  }

  it("a closed period rejects new postings", () => {
    const { books, ids } = withSeptember();
    const closed = closeThrough(books, "2026-09", clock);
    expect(() => postEntry(closed, rentPaid(ids, "2026-09-30"))).toThrow(code("PERIOD_CLOSED"));
    expect(() => postEntry(closed, rentPaid(ids, "2025-12-31"))).toThrow(code("PERIOD_CLOSED"));
    expect(postEntry(closed, rentPaid(ids, "2026-10-01")).entry.date).toBe("2026-10-01");
  });

  it("reversing an entry in a closed period posts the reversal in an open one", () => {
    const { books, septId } = withSeptember();
    const closed = closeThrough(books, "2026-09", clock);
    expect(() => reverseEntry(closed, septId)).toThrow(code("PERIOD_CLOSED"));
    expect(reverseEntry(closed, septId, { date: "2026-10-01" }, clock).entry.date).toBe("2026-10-01");
  });

  it("reopening is deliberate, logged, and reopens every later month", () => {
    const { books, ids } = withSeptember();
    const closed = closeThrough(books, "2026-10", clock);
    const reopened = reopenFrom(closed, "2026-09", clock);
    expect(reopened.marks.closedThrough).toBe("2026-08");
    expect(postEntry(reopened, rentPaid(ids, "2026-09-15")).entry).toBeDefined();
    expect(reopened.events.map((e) => e.kind)).toEqual(["closed", "reopened"]);
    expect(() => reopenFrom(reopened, "2026-11")).toThrow(code("BAD_CLOSE"));
  });

  it("a locked period can't be reopened, posted to, or have entries reversed", () => {
    const { books, ids, septId } = withSeptember();
    const locked = lockThrough(closeThrough(books, "2026-09", clock), "2026-09", clock);
    expect(() => reopenFrom(locked, "2026-09")).toThrow(code("PERIOD_LOCKED"));
    expect(() => postEntry(locked, rentPaid(ids, "2026-09-02"))).toThrow(code("PERIOD_LOCKED"));
    expect(() => reverseEntry(locked, septId, { date: "2026-10-01" })).toThrow(code("PERIOD_LOCKED"));
  });

  it("locks only what's closed, and the close mark only moves forward", () => {
    const { books } = withSeptember();
    expect(() => lockThrough(books, "2026-09")).toThrow(code("BAD_CLOSE"));
    const closed = closeThrough(books, "2026-09", clock);
    expect(() => closeThrough(closed, "2026-08")).toThrow(code("BAD_CLOSE"));
    expect(() => closeThrough(closed, "2026-13")).toThrow(code("BAD_PERIOD"));
  });
});

describe("tamper evidence", () => {
  function threeEntries() {
    let { books, ids } = sampleBooks();
    for (const d of ["2026-10-01", "2026-10-02", "2026-10-03"]) books = postEntry(books, rentPaid(ids, d), clock).books;
    return books;
  }

  it("each entry links to the hash of the one before", () => {
    const books = threeEntries();
    expect(books.entries[0]!.prevHash).toBe("0".repeat(64));
    expect(books.entries[1]!.prevHash).toBe(books.entries[0]!.hash);
    expect(verifyChain(books)).toEqual({ ok: true });
  });

  it("changing an amount after the fact is detected", () => {
    const books = threeEntries();
    const forged = structuredClone(books) as Books;
    (forged.entries[1]!.lines[0] as { debit: bigint }).debit = 1n;
    expect(verifyChain(forged)).toMatchObject({ ok: false, seq: 2, reason: "contents changed" });
  });

  it("deleting or reordering entries is detected", () => {
    const books = threeEntries();
    expect(verifyChain({ ...books, entries: [books.entries[0]!, books.entries[2]!] })).toMatchObject({ ok: false });
    expect(verifyChain({ ...books, entries: [books.entries[1]!, books.entries[0]!, books.entries[2]!] })).toMatchObject({ ok: false });
  });

  it("rewriting an entry and its hash still breaks the next link", () => {
    const books = threeEntries();
    const forged = structuredClone(books) as Books;
    const first = forged.entries[0] as Entry;
    first.memo = "nothing to see";
    const { hash: _old, ...rest } = first;
    first.hash = hashEntry(rest); // the forger recomputes entry 1's own hash...
    // ...but entry 2 still points at the original hash, so the chain breaks there.
    expect(verifyChain(forged)).toMatchObject({ ok: false, seq: 2, reason: "broken link to previous entry" });
  });
});
