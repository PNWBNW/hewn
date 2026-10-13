import { describe, expect, it } from "vitest";
import { type Books, postEntry, reverseEntry } from "./books";
import {
  addProject,
  addTag,
  cleanTags,
  dimensionsFromJson,
  dimensionsToJson,
  emptyDimensions,
  linesTagged,
  marginBp,
  profitAndLossForTag,
  profitByTag,
  tagOptions,
  updateProject,
  updateTag,
} from "./dimensions";
import { addAccount } from "./books";
import { hashEntry } from "./hash";
import { clock, sampleBooks } from "./test_helpers";

const OCT = { from: "2026-10-01", to: "2026-10-31" };

function jobBooks() {
  let { books, ids } = sampleBooks();
  const r = addAccount(books, { name: "Materials", type: "cost_of_goods_sold" });
  books = r.books;
  ids.materials = r.account.id;
  const post = (date: string, lines: Parameters<typeof postEntry>[1]["lines"]) => {
    const p = postEntry(books, { date, lines }, clock);
    books = p.books;
    return p.entry;
  };
  const job = { project: "proj-1" };
  // Income 2,000 on the job, 500 untagged.
  post("2026-10-02", [
    { accountId: ids.checking!, debit: 250_000n },
    { accountId: ids.sales!, credit: 200_000n, tags: job },
    { accountId: ids.sales!, credit: 50_000n },
  ]);
  // Materials 300 on the job; rent 400 split: 100 to the job, 300 to proj-2.
  post("2026-10-03", [{ accountId: ids.materials!, debit: 30_000n, tags: job }, { accountId: ids.checking!, credit: 30_000n }]);
  post("2026-10-04", [
    { accountId: ids.rent!, debit: 10_000n, tags: { ...job, class: "class-1" } },
    { accountId: ids.rent!, debit: 30_000n, tags: { project: "proj-2" } },
    { accountId: ids.card!, credit: 40_000n },
  ]);
  // Out of range.
  post("2026-09-30", [{ accountId: ids.checking!, debit: 99_900n }, { accountId: ids.sales!, credit: 99_900n, tags: job }]);
  return { books, ids, post };
}

describe("dimension lists", () => {
  it("adds unlimited projects, classes and locations with unique names", () => {
    let dims = emptyDimensions();
    for (let i = 1; i <= 30; i++) dims = addProject(dims, { name: `Job ${i}` }).dims;
    dims = addProject(dims, { name: "Kitchen remodel", customerId: "cust-1" }).dims;
    dims = addTag(dims, "class", { name: "Residential" }).dims;
    dims = addTag(dims, "location", { name: "North yard" }).dims;
    expect(dims.projects).toHaveLength(31);
    expect(dims.projects[30]).toEqual({ id: "proj-31", name: "Kitchen remodel", customerId: "cust-1", status: "active" });
    expect(dims.classes).toEqual([{ id: "class-1", name: "Residential", active: true }]);
    expect(dims.locations).toEqual([{ id: "loc-1", name: "North yard", active: true }]);
    expect(() => addProject(dims, { name: "kitchen REMODEL" })).toThrow(/already on your list/);
    expect(() => addTag(dims, "class", { name: "  " })).toThrow(/needs a name/);
  });

  it("closes, renames and unlinks projects; deactivates classes", () => {
    let dims = addProject(emptyDimensions(), { name: "Deck", customerId: "cust-1" }).dims;
    dims = updateProject(dims, "proj-1", { status: "closed", name: "Back deck", customerId: null });
    expect(dims.projects[0]).toEqual({ id: "proj-1", name: "Back deck", status: "closed" });
    expect(tagOptions(dims, "project")).toEqual([{ id: "proj-1", name: "Back deck", open: false }]);
    dims = addTag(dims, "class", { name: "Retail" }).dims;
    dims = updateTag(dims, "class", "class-1", { active: false });
    expect(tagOptions(dims, "class")).toEqual([{ id: "class-1", name: "Retail", open: false }]);
    expect(() => updateProject(dims, "proj-9", { status: "closed" })).toThrow(/not found/);
  });

  it("round-trips through JSON", () => {
    const dims = addTag(addProject(emptyDimensions(), { name: "Deck" }).dims, "location", { name: "Shop" }).dims;
    expect(dimensionsFromJson(dimensionsToJson(dims))).toEqual(dims);
    expect(() => dimensionsFromJson(JSON.stringify({ format: "other" }))).toThrow();
  });

  it("drops blank tags so untagged lines hash as before", () => {
    expect(cleanTags(undefined)).toBeUndefined();
    expect(cleanTags({ project: "", class: undefined })).toBeUndefined();
    expect(cleanTags({ project: "proj-1", location: "" })).toEqual({ project: "proj-1" });
    expect(() => cleanTags({ project: " proj-1" })).toThrow();
  });

  it("puts tags in the entry hash", () => {
    const { books, ids } = jobBooks();
    const e = books.entries[1]!;
    const { hash: _h, ...rest } = e;
    const retagged = { ...rest, lines: rest.lines.map((l) => ({ ...l, tags: { project: "proj-2" } })) };
    expect(hashEntry(retagged)).not.toBe(e.hash);
    expect(ids.materials).toBeTruthy();
  });
});

describe("profit by tag", () => {
  it("is a P&L of only the tagged lines", () => {
    const { books } = jobBooks();
    const pl = profitAndLossForTag(books, "project", "proj-1", OCT);
    expect(pl.income.total).toEqual([200_000n]);
    expect(pl.costOfGoodsSold.total).toEqual([30_000n]);
    expect(pl.expenses.total).toEqual([10_000n]);
    expect(pl.netIncome).toEqual([160_000n]);
    expect(profitAndLossForTag(books, "class", "class-1", OCT).netIncome).toEqual([-10_000n]);
    expect(linesTagged(books, "project", "nope").entries).toEqual([]);
  });

  it("summarises every project, and a void nets out", () => {
    const { books: b0 } = jobBooks();
    const s = profitByTag(b0, "project", OCT, ["proj-3"]);
    expect(s.rows).toEqual([
      { tagId: "proj-3", income: 0n, costOfGoodsSold: 0n, expenses: 0n, profit: 0n, marginBp: null },
      { tagId: "proj-1", income: 200_000n, costOfGoodsSold: 30_000n, expenses: 10_000n, profit: 160_000n, marginBp: 8000 },
      { tagId: "proj-2", income: 0n, costOfGoodsSold: 0n, expenses: 30_000n, profit: -30_000n, marginBp: null },
    ]);
    expect(s.total).toMatchObject({ income: 200_000n, costOfGoodsSold: 30_000n, expenses: 40_000n, profit: 130_000n });
    const voided: Books = reverseEntry(b0, b0.entries[1]!.id, {}, clock).books;
    expect(profitByTag(voided, "project", OCT).rows.find((r) => r.tagId === "proj-1")!.costOfGoodsSold).toBe(0n);
  });

  it("rounds the margin half away from zero", () => {
    expect(marginBp(1n, 3n)).toBe(3333);
    expect(marginBp(2n, 3n)).toBe(6667);
    expect(marginBp(-2n, 3n)).toBe(-6667);
    expect(marginBp(0n, 0n)).toBeNull();
  });
});
