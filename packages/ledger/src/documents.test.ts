// An entry can commit to a document (a paystub, say) by carrying its hash in
// `source.doc`. The hash chain stays backward compatible: entries without a
// document still hash in layout 1, so books saved before this existed verify
// unchanged.
import { describe, expect, it } from "vitest";
import { editEntry, postEntry, reverseEntry, verifyChain } from "./books";
import { canonicalEntry, hashEntry } from "./hash";
import { booksFromJson, booksToJson } from "./serialize";
import { clock, sampleBooks } from "./test_helpers";

const code = (c: string) => expect.objectContaining({ code: c });
const DOC = "a".repeat(64);

// Written by the ledger before `source.doc` existed (sampleBooks + a bill, a
// deposit, an edit of the deposit and a reversal of the bill, deterministic
// clock). Its hashes must never change.
const V1_BOOKS =
  '{"format":"pnw-ledger-books","books":{"version":1,"settings":{"businessName":"Test Co","fiscalYearStartMonth":1},"accounts":[{"name":"Accounts Receivable","type":"accounts_receivable","id":"acct-1","active":true,"system":"accounts_receivable"},{"name":"Payments to Deposit","type":"other_current_asset","id":"acct-2","active":true,"system":"payments_to_deposit"},{"name":"Accounts Payable","type":"accounts_payable","id":"acct-3","active":true,"system":"accounts_payable"},{"name":"Sales Tax Payable","type":"other_current_liability","id":"acct-4","active":true,"system":"sales_tax_payable"},{"name":"Payroll Liabilities","type":"other_current_liability","id":"acct-5","active":true,"system":"payroll_liabilities"},{"name":"Opening Balance Equity","type":"equity","id":"acct-6","active":true,"system":"opening_balance_equity"},{"name":"Retained Earnings","type":"equity","id":"acct-7","active":true,"system":"retained_earnings"},{"name":"Checking","type":"bank","id":"acct-8","active":true},{"name":"Sales","type":"income","id":"acct-9","active":true},{"name":"Rent","type":"expense","id":"acct-10","active":true},{"name":"Card","type":"credit_card","id":"acct-11","active":true},{"name":"Owner Investment","type":"equity","id":"acct-12","active":true}],"entries":[{"date":"2026-10-01","memo":"October rent","source":{"kind":"bill","ref":"bill-1"},"lines":[{"accountId":"acct-10","debit":{"$c":"150000"},"name":{"kind":"vendor","id":"vend-1"},"tags":{"project":"proj-1"},"credit":{"$c":"0"}},{"accountId":"acct-3","credit":{"$c":"150000"},"name":{"kind":"vendor","id":"vend-1"},"debit":{"$c":"0"}}],"id":"je-1","seq":1,"postedAt":"2026-10-13T00:00:00.000Z","prevHash":"0000000000000000000000000000000000000000000000000000000000000000","hash":"f562bf906d26f988496e80450c468d5150770da0b17b8b5536be2dadd6e5bc36"},{"date":"2026-10-02","source":{"kind":"manual"},"lines":[{"accountId":"acct-8","debit":{"$c":"500000"},"memo":"deposit","credit":{"$c":"0"}},{"accountId":"acct-9","credit":{"$c":"500000"},"debit":{"$c":"0"}}],"id":"je-2","seq":2,"postedAt":"2026-10-13T00:00:01.000Z","prevHash":"f562bf906d26f988496e80450c468d5150770da0b17b8b5536be2dadd6e5bc36","hash":"d010479438963f2d420f52c1e1a237aedea59f680899f42f43c462c19be475f0"},{"date":"2026-10-02","memo":"Reverses je-2","source":{"kind":"reversal","ref":"je-2"},"lines":[{"accountId":"acct-8","debit":{"$c":"0"},"memo":"deposit","credit":{"$c":"500000"}},{"accountId":"acct-9","credit":{"$c":"0"},"debit":{"$c":"500000"}}],"reverses":"je-2","id":"je-3","seq":3,"postedAt":"2026-10-13T00:00:02.000Z","prevHash":"d010479438963f2d420f52c1e1a237aedea59f680899f42f43c462c19be475f0","hash":"b00a58c884fdf1b81336d1369d2963d9931864455817783bba22244c5fea4b62"},{"date":"2026-10-02","source":{"kind":"manual"},"lines":[{"accountId":"acct-8","debit":{"$c":"520000"},"credit":{"$c":"0"}},{"accountId":"acct-9","credit":{"$c":"520000"},"debit":{"$c":"0"}}],"replaces":"je-2","id":"je-4","seq":4,"postedAt":"2026-10-13T00:00:03.000Z","prevHash":"b00a58c884fdf1b81336d1369d2963d9931864455817783bba22244c5fea4b62","hash":"a06b9f0adcb33c8aa152d3918ef58cd830dc90456ab89546eea3a5bf799af859"},{"date":"2026-10-01","memo":"Reverses je-1: October rent","source":{"kind":"reversal","ref":"je-1"},"lines":[{"accountId":"acct-10","debit":{"$c":"0"},"name":{"kind":"vendor","id":"vend-1"},"tags":{"project":"proj-1"},"credit":{"$c":"150000"}},{"accountId":"acct-3","credit":{"$c":"0"},"name":{"kind":"vendor","id":"vend-1"},"debit":{"$c":"150000"}}],"reverses":"je-1","id":"je-5","seq":5,"postedAt":"2026-10-13T00:00:04.000Z","prevHash":"a06b9f0adcb33c8aa152d3918ef58cd830dc90456ab89546eea3a5bf799af859","hash":"64b531f144a9e3959a91a43c45ecacddd12027a8764e3b4ab4323abc9c0bb17d"}],"marks":{},"events":[],"nextAccount":13}}';

function rent(ids: Record<string, string>, doc?: string) {
  return {
    date: "2026-10-01",
    memo: "October rent",
    source: { kind: "bill" as const, ref: "bill-1", ...(doc ? { doc } : {}) },
    lines: [
      { accountId: ids.rent!, debit: 150000n },
      { accountId: ids.checking!, credit: 150000n },
    ],
  };
}

describe("books saved before documents existed", () => {
  it("still verify, hash for hash", () => {
    const books = booksFromJson(V1_BOOKS);
    expect(books.entries).toHaveLength(5);
    expect(verifyChain(books)).toEqual({ ok: true });
    expect(books.entries.map((e) => e.hash)).toEqual([
      "f562bf906d26f988496e80450c468d5150770da0b17b8b5536be2dadd6e5bc36",
      "d010479438963f2d420f52c1e1a237aedea59f680899f42f43c462c19be475f0",
      "b00a58c884fdf1b81336d1369d2963d9931864455817783bba22244c5fea4b62",
      "a06b9f0adcb33c8aa152d3918ef58cd830dc90456ab89546eea3a5bf799af859",
      "64b531f144a9e3959a91a43c45ecacddd12027a8764e3b4ab4323abc9c0bb17d",
    ]);
    for (const e of books.entries) expect(canonicalEntry(e).startsWith("[1,")).toBe(true);
  });
});

describe("an entry with a document", () => {
  it("hashes differently from the same entry without one, in layout 2", () => {
    const { books, ids } = sampleBooks();
    const plain = postEntry(books, rent(ids), clock).entry;
    const withDoc = postEntry(books, rent(ids, DOC), { now: () => plain.postedAt }).entry;
    expect(withDoc.source).toEqual({ kind: "bill", ref: "bill-1", doc: DOC });
    expect(withDoc.hash).not.toBe(plain.hash);
    expect(canonicalEntry(plain).startsWith("[1,")).toBe(true);
    // Layout 2 is layout 1 byte for byte, with the document appended: nothing else moves.
    expect(canonicalEntry(withDoc)).toBe(`[2,${canonicalEntry(plain).slice(3, -1)},"${DOC}"]`);
    const { hash: _h, ...rest } = withDoc;
    expect(hashEntry(rest)).toBe(withDoc.hash);
  });

  it("changing the document after posting is detected", () => {
    const { books, ids } = sampleBooks();
    const posted = postEntry(books, rent(ids, DOC), clock).books;
    const forged = structuredClone(posted);
    (forged.entries[0]!.source as { doc: string }).doc = "b".repeat(64);
    expect(verifyChain(posted)).toEqual({ ok: true });
    expect(verifyChain(forged)).toMatchObject({ ok: false, seq: 1, reason: "contents changed" });
  });

  it("must be a 32-byte lower-case hex hash", () => {
    const { books, ids } = sampleBooks();
    for (const bad of [" ", "abc", "A".repeat(64), "g".repeat(64), "a".repeat(63), "a".repeat(65)]) {
      expect(() => postEntry(books, rent(ids, bad)), bad).toThrow(code("BAD_DOC"));
    }
    const b1 = postEntry(books, rent(ids), clock).books;
    expect(() => editEntry(b1, "je-1", rent(ids, "xyz"))).toThrow(code("BAD_DOC"));
    expect(b1.entries).toHaveLength(1);
  });

  it("is kept by an edit's replacement and never copied onto a reversal", () => {
    const { books, ids } = sampleBooks();
    const b1 = postEntry(books, rent(ids, DOC), clock).books;
    const corrected = {
      ...rent(ids, DOC),
      lines: [
        { accountId: ids.rent!, debit: 160000n },
        { accountId: ids.checking!, credit: 160000n },
      ],
    };
    const { books: b2, reversal, entry: fixed } = editEntry(b1, "je-1", corrected, {}, clock);
    expect(reversal.source).toEqual({ kind: "reversal", ref: "je-1" });
    expect(fixed.source).toEqual({ kind: "bill", ref: "bill-1", doc: DOC });
    // An edit that gives no source keeps the original's, document included.
    const kept = editEntry(b1, "je-1", { date: "2026-10-01", lines: rent(ids).lines }, {}, clock).entry;
    expect(kept.source.doc).toBe(DOC);
    const rev = reverseEntry(b2, fixed.id, {}, clock).entry;
    expect(rev.source).toEqual({ kind: "reversal", ref: fixed.id });
    expect("doc" in rev.source).toBe(false);
    expect(verifyChain(b2)).toEqual({ ok: true });
  });

  it("round-trips through the vault format and still verifies", () => {
    const { books, ids } = sampleBooks();
    const posted = postEntry(postEntry(books, rent(ids, DOC), clock).books, rent(ids), clock).books;
    const back = booksFromJson(booksToJson(posted));
    expect(back).toEqual(posted);
    expect(back.entries[0]!.source.doc).toBe(DOC);
    expect(back.entries[1]!.source.doc).toBeUndefined();
    expect(() => booksFromJson(booksToJson(posted).replace(DOC, "b".repeat(64)))).toThrow(/integrity check/);
  });
});
