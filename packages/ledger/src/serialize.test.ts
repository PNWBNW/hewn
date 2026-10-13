import { describe, expect, it } from "vitest";
import { postEntry } from "./books";
import { booksFromJson, booksToJson } from "./serialize";
import { clock, sampleBooks } from "./test_helpers";

function someBooks() {
  const { books, ids } = sampleBooks();
  return postEntry(books, {
    date: "2026-10-01",
    lines: [{ accountId: ids.rent!, debit: 123_456_789_012n }, { accountId: ids.checking!, credit: 123_456_789_012n }],
  }, clock).books;
}

describe("books serialization", () => {
  it("round-trips exactly, including large cent amounts", () => {
    const books = someBooks();
    expect(booksFromJson(booksToJson(books))).toEqual(books);
  });

  it("refuses a file whose entries were edited outside the app", () => {
    const text = booksToJson(someBooks()).replace('"123456789012"', '"123456789013"');
    expect(() => booksFromJson(text)).toThrow(/integrity check/);
  });

  it("refuses things that aren't books", () => {
    expect(() => booksFromJson("not json")).toThrow(/not valid JSON/);
    expect(() => booksFromJson('{"format":"other"}')).toThrow(/Not a books file from this app/);
  });
});
