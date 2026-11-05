import { describe, expect, it } from "vitest";
import { type Books, type Entry, postEntry } from "./books";
import { GENESIS_HASH } from "./hash";
import {
  type SettlementLink,
  businessTag,
  entriesInRange,
  entryLeaf,
  merkleProof,
  merkleRoot,
  periodRoot,
  settlementLeaf,
  verifyMerkleProof,
} from "./period_root";
import { clock, sampleBooks } from "./test_helpers";

const SECRET = new Uint8Array(32).fill(7);
const PINNED_ROOT = "04371e4cc4a2e4fc614a14a39a626b9f5365813108e21c861f99c9687ab56acf";
const OTHER = new Uint8Array(32).fill(8);
const code = (c: string) => expect.objectContaining({ code: c });

function october(): { books: Books; entries: Entry[] } {
  let { books, ids } = sampleBooks();
  const post = (date: string, cents: bigint) => {
    books = postEntry(books, { date, lines: [{ accountId: ids.rent!, debit: cents }, { accountId: ids.checking!, credit: cents }] }, clock).books;
  };
  post("2026-09-30", 100n);
  post("2026-10-25", 200n);
  post("2026-10-28", 300n);
  post("2026-10-31", 400n);
  post("2026-11-01", 500n);
  return { books, entries: entriesInRange(books, "2026-10-25", "2026-10-31") };
}

const pay: SettlementLink[] = [];

describe("the period root", () => {
  it("takes only the range's entries, in journal order, and names the range", () => {
    const { entries } = october();
    expect(entries.map((e) => e.date)).toEqual(["2026-10-25", "2026-10-28", "2026-10-31"]);
    const r = periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements: pay });
    expect(r.periodId).toBe("2026-10-25..2026-10-31");
    expect(r).toMatchObject({ n: 3, m: 0, chainHead: entries[2]!.hash });
    expect(r.root).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same every time for the same books", () => {
    const { entries } = october();
    const a = periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements: pay });
    const b = periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements: pay });
    expect(a.root).toBe(b.root);
  });

  it("changes when an entry is changed, removed or repeated", () => {
    const { entries } = october();
    const base = periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements: pay }).root;
    const changed = entries.map((e, i) => (i === 1 ? { ...e, hash: "f".repeat(64) } : e));
    expect(periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries: changed, settlements: pay }).root).not.toBe(base);
    expect(periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries: entries.slice(0, 2), settlements: pay }).root).not.toBe(base);
    // A repeated entry is refused outright: each once, in journal order.
    expect(() => periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries: [...entries, entries[2]!], settlements: pay })).toThrow(code("BAD_ROOT"));
  });

  it("refuses an entry dated outside the range", () => {
    const { books, entries } = october();
    const outside = books.entries.find((e) => e.date === "2026-11-01")!;
    expect(() => periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries: [...entries, outside], settlements: pay })).toThrow(code("BAD_ROOT"));
  });

  it("changes with the range, the previous root and the secret", () => {
    const { entries } = october();
    const base = periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements: pay }).root;
    expect(periodRoot({ anchorSecret: SECRET, start: "2026-10-24", end: "2026-10-31", entries, settlements: pay }).root).not.toBe(base);
    expect(periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements: pay, prevRoot: "a".repeat(64) }).root).not.toBe(base);
    expect(periodRoot({ anchorSecret: OTHER, start: "2026-10-25", end: "2026-10-31", entries, settlements: pay }).root).not.toBe(base);
    expect(businessTag(SECRET)).not.toBe(businessTag(OTHER));
  });

  it("commits to which transfer paid which entry, and to whom", () => {
    const { entries } = october();
    const s: SettlementLink = { entryHash: entries[1]!.hash, txId: "at1abc", recipient: "aleo1worker" };
    const with1 = periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements: [s] });
    expect(with1.m).toBe(1);
    const otherTx = periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements: [{ ...s, txId: "at1xyz" }] });
    const otherPerson = periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements: [{ ...s, recipient: "aleo1someone" }] });
    expect(otherTx.root).not.toBe(with1.root);
    expect(otherPerson.root).not.toBe(with1.root);
    expect(settlementLeaf(SECRET, s)).not.toBe(settlementLeaf(OTHER, s));
    expect(() => settlementLeaf(SECRET, { ...s, txId: " " })).toThrow(code("BAD_ROOT"));
  });

  it("has a fixed root for an empty range, which differs from any other", () => {
    const empty1 = periodRoot({ anchorSecret: SECRET, start: "2026-12-01", end: "2026-12-31", entries: [], settlements: [] });
    const empty2 = periodRoot({ anchorSecret: SECRET, start: "2026-12-01", end: "2026-12-31", entries: [], settlements: [] });
    expect(empty1.root).toBe(empty2.root);
    expect(empty1).toMatchObject({ n: 0, m: 0, chainHead: GENESIS_HASH });
    expect(empty1.entriesRoot).toBe(merkleRoot([]));
  });

  it("refuses a bad secret, range or previous root", () => {
    const { entries } = october();
    expect(() => periodRoot({ anchorSecret: new Uint8Array(16), start: "2026-10-25", end: "2026-10-31", entries, settlements: pay })).toThrow(code("BAD_ROOT"));
    expect(() => periodRoot({ anchorSecret: SECRET, start: "2026-10-31", end: "2026-10-25", entries: [], settlements: pay })).toThrow(code("BAD_ROOT"));
    expect(() => periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements: pay, prevRoot: "nope" })).toThrow(code("BAD_ROOT"));
  });
});

describe("inclusion proofs", () => {
  it("prove every leaf of odd and even trees, and nothing else", () => {
    for (const size of [1, 2, 3, 5, 8]) {
      const leaves = Array.from({ length: size }, (_, i) => entryLeaf(SECRET, String(i).padStart(64, "0")));
      const root = merkleRoot(leaves);
      leaves.forEach((leaf, i) => {
        const path = merkleProof(leaves, i);
        expect(verifyMerkleProof(leaf, path, root)).toBe(true);
        expect(verifyMerkleProof(entryLeaf(OTHER, String(i).padStart(64, "0")), path, root)).toBe(false);
      });
    }
  });

  it("an entry's proof checks against the anchored root's entries tree", () => {
    const { entries } = october();
    const r = periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements: pay });
    const leaf = entryLeaf(SECRET, entries[1]!.hash);
    expect(r.entryLeaves[1]).toBe(leaf);
    expect(verifyMerkleProof(leaf, merkleProof(r.entryLeaves, 1), r.entriesRoot)).toBe(true);
    expect(() => merkleProof(r.entryLeaves, 3)).toThrow(code("BAD_ROOT"));
  });
});

describe("the root's bytes are fixed", () => {
  // Roots are anchored on chain for good: the same input must give the same root in every
  // version of the app. A change here orphans every root already anchored.
  it("matches the recorded root for a fixed input", () => {
    const e = (seq: number, date: string, hash: string) => ({ id: `e${seq}`, seq, date, source: { kind: "manual" }, lines: [], postedAt: "2026-11-01T00:00:00.000Z", prevHash: "0".repeat(64), hash }) as unknown as Entry;
    const entries = [e(1, "2026-10-25", "11".repeat(32)), e(2, "2026-10-28", "22".repeat(32)), e(3, "2026-10-31", "33".repeat(32))];
    const settlements = [{ entryHash: "22".repeat(32), txId: "at1example", recipient: "aleo1example" }];
    const r = periodRoot({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements, prevRoot: "ab".repeat(32) });
    expect(r.root).toBe(PINNED_ROOT);
  });
});
