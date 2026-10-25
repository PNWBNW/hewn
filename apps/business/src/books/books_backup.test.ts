import { describe, expect, it } from "vitest";
import { addAccount, createBooks, postEntry, verifyChain } from "@pnw/ledger";
import { type Company, companyToJson, emptyCompany } from "./company";
import { createFund } from "./funds";
import { startFromShield } from "./opening";
import type { Rail } from "./rail";
import { addReviewItems } from "./review";
import { BackupFormatError, MAX_CHANGES, changeOf, rebuild, snapshotOf, stateHash, wantsSnapshot } from "./books_backup";

const ADDR = "aleo1" + "q".repeat(58);
const rail: Rail = { version: 1, network: "testnet", address: ADDR, linkedAt: "2026-10-14T18:00:00.000Z", links: [] };
const tx = (n: number) => `at1${String(n).padStart(58, "x")}`;

function start(): { c: Company; sales: string; bank: string } {
  let books = createBooks({ businessName: "Backup Co", fiscalYearStartMonth: 1 });
  const s = addAccount(books, { name: "Sales", type: "income" });
  const k = addAccount(s.books, { name: "Checking", type: "bank" });
  books = k.books;
  const c = startFromShield({ ...emptyCompany(books), rail }, { date: "2026-10-15", minor: 20_000_000n, at: "2026-10-15T10:00:00Z" });
  return { c, sales: s.account.id, bank: k.account.id };
}

function sell(c: Company, bank: string, sales: string, n: number, from = 0): Company {
  let books = c.books;
  for (let i = from; i < from + n; i++) {
    books = postEntry(books, { date: "2026-10-16", memo: `Job ${i}`, lines: [{ accountId: bank, debit: BigInt(1000 + i) }, { accountId: sales, credit: BigInt(1000 + i) }] }).books;
  }
  return { ...c, books };
}

/** The same books: the same state hash, and equal field by field (key order in the saved text doesn't matter). */
const same = async (a: Company, b: Company) => {
  expect(await stateHash(a)).toBe(await stateHash(b));
  expect(a).toEqual(b);
};

describe("backup pieces of the books", () => {
  it("rebuild the books exactly from a snapshot, hashes recomputed and the journal intact", async () => {
    const { c, bank, sales } = start();
    const books = sell(c, bank, sales, 5);
    const { piece } = await snapshotOf(books);
    expect(piece.doc).not.toContain('"hash"');
    expect(piece.doc).not.toContain('"prevHash"');
    const out = await rebuild([piece]);
    expect(out.applied).toBe(1);
    expect(out.stopped).toBeUndefined();
    expect(verifyChain(out.company.books)).toEqual({ ok: true });
    await same(out.company, books);
  });

  it("carry only what changed, and rebuild through a snapshot and changes", async () => {
    const { c, bank, sales } = start();
    let books = sell(c, bank, sales, 3);
    const s0 = await snapshotOf(books);

    books = sell(books, bank, sales, 2, 3);
    const c1 = (await changeOf(books, s0.mark))!;
    expect(c1.piece.entries).toHaveLength(2);
    expect(c1.piece.books).toBeUndefined(); // only entries were added
    expect(c1.piece.sections).toEqual({});

    books = createFund(books, { name: "Equipment fund" }).company; // a new account, and a new section
    books = addReviewItems(books, [{ id: tx(1), date: "2026-10-17", direction: "in", minor: "1000000", kind: "transfer_public", status: "new" }]);
    const c2 = (await changeOf(books, c1.mark))!;
    expect(c2.piece.entries).toHaveLength(0);
    expect(c2.piece.books).toBeDefined(); // accounts changed
    expect(Object.keys(c2.piece.sections).sort()).toEqual(["funds", "review"]);
    expect(c2.piece.prev).toBe(c1.piece.state);

    expect(await changeOf(books, c2.mark)).toBeNull(); // nothing new
    const out = await rebuild([s0.piece, c1.piece, c2.piece]);
    expect(out.applied).toBe(3);
    await same(out.company, books);
    expect(out.mark).toEqual(c2.mark);
  });

  it("is much smaller as a change than as a snapshot", async () => {
    const { c, bank, sales } = start();
    let books = sell(c, bank, sales, 200);
    const s0 = await snapshotOf(books);
    books = sell(books, bank, sales, 3, 200);
    const c1 = (await changeOf(books, s0.mark))!;
    expect(JSON.stringify(c1.piece).length * 20).toBeLessThan(JSON.stringify(s0.piece).length);
  });

  it("stops at a missing or out-of-place piece, keeping the books as of the piece before", async () => {
    const { c, bank, sales } = start();
    let books = sell(c, bank, sales, 2);
    const s0 = await snapshotOf(books);
    books = sell(books, bank, sales, 1, 2);
    const c1 = (await changeOf(books, s0.mark))!;
    const after1 = books;
    books = sell(books, bank, sales, 1, 3);
    const c2 = (await changeOf(books, c1.mark))!;
    books = sell(books, bank, sales, 1, 4);
    const c3 = (await changeOf(books, c2.mark))!;

    const missing = await rebuild([s0.piece, c1.piece, null, c3.piece]);
    expect(missing.applied).toBe(2);
    expect(missing.stopped).toMatchObject({ at: 2, reason: /missing/ });
    await same(missing.company, after1);

    const skipped = await rebuild([s0.piece, c1.piece, c3.piece]);
    expect(skipped.stopped).toMatchObject({ at: 2, reason: /doesn't follow/ });
  });

  it("refuses a piece whose contents were changed, and a chain without its snapshot", async () => {
    const { c, bank, sales } = start();
    const books = sell(c, bank, sales, 2);
    const s0 = await snapshotOf(books);
    const forged = { ...s0.piece, doc: s0.piece.doc.replace("Job 1", "Job 9") };
    await expect(rebuild([forged])).rejects.toThrow(/journal doesn't come back the same/);
    const later = sell(books, bank, sales, 1, 2);
    const c1 = (await changeOf(later, s0.mark))!;
    await expect(rebuild([c1.piece])).rejects.toThrow(/starts with a snapshot/);
    await expect(rebuild([{ v: 2 }])).rejects.toBeInstanceOf(BackupFormatError);
  });

  it("refuses a change against a mark from books with more entries", async () => {
    const { c, bank, sales } = start();
    const big = await snapshotOf(sell(c, bank, sales, 5));
    await expect(changeOf(sell(c, bank, sales, 2), big.mark)).rejects.toThrow(/fewer entries/);
  });

  it("starts a new chain at half a snapshot of changes, or after 12 changes (Joshua, 2026-10-26)", () => {
    expect(wantsSnapshot(null, 100)).toBe(true);
    expect(wantsSnapshot({ snapshotBytes: 10_000, changeBytes: 4_000, changes: 3 }, 900)).toBe(false);
    expect(wantsSnapshot({ snapshotBytes: 10_000, changeBytes: 4_000, changes: 3 }, 1_001)).toBe(true);
    expect(wantsSnapshot({ snapshotBytes: 10_000, changeBytes: 0, changes: MAX_CHANGES }, 10)).toBe(true);
  });
});
