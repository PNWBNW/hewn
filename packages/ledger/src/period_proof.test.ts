import { describe, expect, it } from "vitest";
import { type Books, type Entry, postEntry } from "./books";
import { hashEntry } from "./hash";
import { entriesInRange, periodRoot, type SettlementLink } from "./period_root";
import { type PeriodProof, buildPeriodProof, checkPeriodProof, periodProofToJson, readPeriodProof } from "./period_proof";
import { clock, sampleBooks } from "./test_helpers";

const SECRET = new Uint8Array(32).fill(7);
const code = (c: string) => expect.objectContaining({ code: c });

function october(): { books: Books; entries: Entry[]; settlements: SettlementLink[] } {
  let { books, ids } = sampleBooks();
  const post = (date: string, cents: bigint, memo?: string) => {
    books = postEntry(books, { date, ...(memo ? { memo } : {}), lines: [{ accountId: ids.rent!, debit: cents, memo: "line" }, { accountId: ids.checking!, credit: cents }] }, clock).books;
  };
  post("2026-09-30", 100n);
  post("2026-10-25", 200n, "first");
  post("2026-10-28", 300n);
  post("2026-11-01", 999n);
  post("2026-10-31", 400n, "posted after a November entry");
  const entries = entriesInRange(books, "2026-10-25", "2026-10-31");
  const settlements = [{ entryHash: entries[1]!.hash, txId: `at1${"q".repeat(58)}`, recipient: `aleo1${"p".repeat(58)}` }];
  return { books, entries, settlements };
}

function proof(prevRoot?: string): { proof: PeriodProof; root: string } {
  const { books, entries, settlements } = october();
  const input = { anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements, ...(prevRoot ? { prevRoot } : {}) };
  const root = periodRoot(input).root;
  const p = buildPeriodProof(
    { ...input, business: "Test Co", madeAt: "2026-11-05T00:00:00.000Z", accounts: books.accounts, closes: [{ start: "2026-10-25", end: "2026-10-31", root, closedAt: "2026-11-03T00:00:00.000Z" }] },
    root,
  );
  return { proof: p, root };
}

/** A copy that went through a file, as an auditor receives it. */
const viaFile = (p: PeriodProof): PeriodProof => readPeriodProof(periodProofToJson(p));
const failing = (p: PeriodProof) => checkPeriodProof(p).checks.filter((c) => !c.ok).map((c) => c.id);

describe("the period proof", () => {
  it("recomputes to the root the books anchored, from the file alone", () => {
    const { proof: p, root } = proof();
    const r = checkPeriodProof(viaFile(p));
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.root).toBe(root);
    expect(r).toMatchObject({ entries: 3, payments: 1 });
  });

  it("chains to the previous close", () => {
    const { proof: p, root } = proof("ab".repeat(32));
    expect(checkPeriodProof(viaFile(p)).root).toBe(root);
    expect(p.prevRoot).toBe("ab".repeat(32));
  });

  it("covers a range with nothing in it", () => {
    const input = { anchorSecret: SECRET, start: "2026-12-01", end: "2026-12-31", entries: [], settlements: [] };
    const p = buildPeriodProof({ ...input, business: "Test Co", madeAt: "2026-11-05T00:00:00.000Z", accounts: [], closes: [] });
    expect(checkPeriodProof(viaFile(p)).root).toBe(periodRoot(input).root);
  });

  it("never carries the secret, and names only the accounts the entries use", () => {
    const { proof: p } = proof();
    expect(periodProofToJson(p)).not.toContain("07".repeat(32));
    expect(p.accounts.map((a) => a.name).sort()).toEqual(["Checking", "Rent"]);
  });

  it("refuses to build when the books no longer give the closed root", () => {
    const { books, entries, settlements } = october();
    expect(() =>
      buildPeriodProof({ anchorSecret: SECRET, start: "2026-10-25", end: "2026-10-31", entries, settlements, business: "x", madeAt: "t", accounts: books.accounts, closes: [] }, "cd".repeat(32)),
    ).toThrow(code("BAD_PROOF"));
  });
});

describe("a proof that must fail", () => {
  it("a changed amount", () => {
    const p = viaFile(proof().proof);
    p.entries[1]!.lines[0]!.debit = "301";
    p.entries[1]!.lines[1]!.credit = "301";
    expect(failing(p)).toEqual(["entries"]);
    expect(checkPeriodProof(p).root).toBeNull();
  });

  it("a changed memo, rehashed by a forger so the entry itself checks out", () => {
    const p = viaFile(proof().proof);
    const e = p.entries[0]!;
    e.memo = "rewritten";
    const { salt: _s, hash: _h, lines, ...rest } = e;
    e.hash = hashEntry({ ...rest, lines: lines.map((l) => ({ ...l, debit: BigInt(l.debit), credit: BigInt(l.credit) })) });
    // The entry now hashes to its (new) hash, so only the root can catch it, and it does.
    expect(failing(p)).toEqual(["root"]);
  });

  it("a removed entry", () => {
    const p = viaFile(proof().proof);
    p.entries.splice(1, 1);
    expect(failing(p)).toEqual(["root"]);
  });

  it("entries out of order", () => {
    const p = viaFile(proof().proof);
    p.entries.reverse();
    expect(failing(p)).toEqual(expect.arrayContaining(["order", "root"]));
  });

  it("an entry from outside the range", () => {
    const p = viaFile(proof().proof);
    p.end = "2026-10-30";
    expect(failing(p)).toEqual(expect.arrayContaining(["range", "root"]));
  });

  it("a payment shown going to someone else", () => {
    const p = viaFile(proof().proof);
    p.settlements[0]!.recipient = `aleo1${"z".repeat(58)}`;
    expect(failing(p)).toEqual(["root"]);
  });

  it("a payment shown with another transaction", () => {
    const p = viaFile(proof().proof);
    p.settlements[0]!.txId = `at1${"x".repeat(58)}`;
    expect(failing(p)).toEqual(["root"]);
  });

  it("a wrong salt", () => {
    const p = viaFile(proof().proof);
    p.entries[2]!.salt = "00".repeat(32);
    expect(failing(p)).toEqual(["root"]);
  });

  it("a claimed root that isn't this one", () => {
    const p = viaFile(proof().proof);
    p.root = "12".repeat(32);
    expect(failing(p)).toEqual(["root"]);
  });

  it("another business's tag", () => {
    const p = viaFile(proof().proof);
    p.businessTag = "34".repeat(32);
    expect(failing(p)).toEqual(["root"]);
  });
});

describe("reading a proof file", () => {
  it("refuses what isn't one", () => {
    expect(() => readPeriodProof("not json")).toThrow(code("BAD_PROOF"));
    expect(() => readPeriodProof(JSON.stringify({ format: "pnw-ledger-books" }))).toThrow(code("BAD_PROOF"));
    expect(() => readPeriodProof(JSON.stringify({ ...proof().proof, version: 2 }))).toThrow(/newer version/);
  });

  it("refuses a damaged entry, line or root", () => {
    const base = JSON.parse(periodProofToJson(proof().proof));
    const broken = (f: (x: any) => void) => {
      const x = structuredClone(base);
      f(x);
      return () => readPeriodProof(JSON.stringify(x));
    };
    expect(broken((x) => (x.root = "nope"))).toThrow(code("BAD_PROOF"));
    expect(broken((x) => (x.entries[0].salt = 5))).toThrow(code("BAD_PROOF"));
    expect(broken((x) => (x.entries[0].lines[0].debit = "-1"))).toThrow(code("BAD_PROOF"));
    expect(broken((x) => (x.settlements = null))).toThrow(code("BAD_PROOF"));
    expect(broken((x) => (x.start = "2026-11-01"))).toThrow(code("BAD_PROOF"));
  });
});
