import { describe, expect, it } from "vitest";
import { addAccount, createBooks, postEntry } from "@pnw/ledger";
import { emptySales } from "@pnw/sales";
import { checkPeriodProof, periodProofToJson, readPeriodProof } from "@pnw/ledger";
import { closeChecks, closeRange, closeReminder, lockCloses, nextStart, periodProofFor, proofFileName, recordAnchor, reopenCloses, standingCloses, suggestedEnd, validateClosing } from "./close";
import { type Company, companyFromJson, companyToJson, emptyCompany } from "./company";
import { addReviewItems } from "./review";

const SECRET = "ab".repeat(32);
const TX = `at1${"q".repeat(58)}`;
const opts = (over: Partial<{ today: string; now: string; shieldMatches: boolean; newSecret: string }> = {}) => ({
  today: "2026-11-02",
  now: "2026-11-02T18:00:00.000Z",
  shieldMatches: true,
  newSecret: SECRET,
  ...over,
});

function october(): Company {
  let books = createBooks({ businessName: "T", fiscalYearStartMonth: 1 });
  const bank = addAccount(books, { name: "Shield", type: "bank" });
  const tools = addAccount(bank.books, { name: "Tools", type: "expense" });
  books = tools.books;
  for (const [date, cents] of [["2026-10-25", 100n], ["2026-10-28", 200n], ["2026-11-01", 300n]] as const) {
    books = postEntry(books, { date, lines: [{ accountId: tools.account.id, debit: cents }, { accountId: bank.account.id, credit: cents }] }).books;
  }
  return emptyCompany(books);
}

describe("closing a period", () => {
  it("starts at the books' first entry, then the day after the last close", () => {
    const c = october();
    expect(nextStart(c)).toBe("2026-10-25");
    const { company } = closeRange(c, "2026-10-31", opts());
    expect(nextStart(company)).toBe("2026-11-01");
    expect(nextStart(emptyCompany(createBooks({ businessName: "E", fiscalYearStartMonth: 1 })))).toBeNull();
  });

  it("suggests the end of the last full month, or yesterday", () => {
    expect(suggestedEnd("2026-10-25", "2026-11-02")).toBe("2026-10-31");
    expect(suggestedEnd("2026-11-01", "2026-11-20")).toBe("2026-11-19");
  });

  it("closes through any date before today, keeping a record with the root (Joshua, 2026-11-02)", () => {
    const { company, record } = closeRange(october(), "2026-10-31", opts());
    expect(company.books.marks.closedThrough).toBe("2026-10-31");
    expect(record).toMatchObject({ start: "2026-10-25", end: "2026-10-31", entries: 2, settlements: 0 });
    expect(record.root).toMatch(/^[0-9a-f]{64}$/);
    expect(company.closing?.secret).toBe(SECRET);
    // Part of a month: the next close starts the day after.
    const part = closeRange(company, "2026-11-01", opts());
    expect(part.record).toMatchObject({ start: "2026-11-01", end: "2026-11-01", entries: 1, prevRoot: record.root });
  });

  it("refuses today, a range before its start, and any failing line", () => {
    const c = october();
    expect(() => closeRange(c, "2026-11-02", opts())).toThrow(/Today can't be closed/);
    expect(() => closeRange(c, "2026-10-20", opts())).toThrow(/on or after the range's first day/);
    expect(() => closeRange(c, "2026-10-31", opts({ shieldMatches: false }))).toThrow(/Shield check/);
    const waiting = addReviewItems(c, [{ id: TX, date: "2026-10-30", direction: "in", minor: "1000000", kind: "x", status: "new" }]);
    expect(() => closeRange(waiting, "2026-10-31", opts())).toThrow(/to review/);
  });

  it("checks each line separately and says where to fix it", () => {
    const c = october();
    const sales = { ...emptySales(), invoices: [{ id: "i1", number: "INV-1", customerId: "c", date: "2026-10-30", dueDate: "2026-11-30", terms: "net30", lines: [], taxRateBp: 0, state: "draft" }] } as unknown as Company["sales"];
    const lines = closeChecks({ ...c, sales }, "2026-10-25", "2026-10-31", "2026-11-02");
    expect(lines.map((l) => [l.id, l.ok])).toEqual([["date", true], ["review", true], ["payroll", true], ["drafts", false]]);
    expect(lines.find((l) => l.id === "drafts")).toMatchObject({ href: "/sales" });
  });

  it("notes the anchor once it lands", () => {
    const { company } = closeRange(october(), "2026-10-31", opts());
    const anchored = recordAnchor(company, "2026-10-31", TX, "2026-11-02T18:01:00.000Z");
    expect(anchored.closing?.records[0]?.anchor).toEqual({ txId: TX, at: "2026-11-02T18:01:00.000Z" });
    expect(() => recordAnchor(company, "2026-10-30", TX, "2026-11-02T18:01:00.000Z")).toThrow(/isn't in the books/);
    expect(() => recordAnchor(company, "2026-10-31", "nope", "2026-11-02T18:01:00.000Z")).toThrow(/transaction id/);
  });

  it("reopens until locked, keeps undone closes, and chains the next close to the last one standing", () => {
    const first = closeRange(october(), "2026-10-31", opts());
    const second = closeRange(first.company, "2026-11-01", opts());
    const reopened = reopenCloses(second.company, "2026-11-01", "2026-11-03T10:00:00.000Z");
    expect(reopened.books.marks.closedThrough).toBe("2026-10-31");
    expect(standingCloses(reopened.closing).map((r) => r.end)).toEqual(["2026-10-31"]);
    expect(reopened.closing?.records).toHaveLength(2);
    const again = closeRange(reopened, "2026-11-01", opts({ today: "2026-11-03" }));
    expect(again.record.prevRoot).toBe(first.record.root);
    // Unchanged, it has the same root; once that was anchored, the anchor carries over.
    expect(again.record.root).toBe(second.record.root);
    const anchoredFirst = recordAnchor(second.company, "2026-11-01", TX, "2026-11-02T19:00:00.000Z");
    const reclosed = closeRange(reopenCloses(anchoredFirst, "2026-11-01", "2026-11-03T10:00:00.000Z"), "2026-11-01", opts({ today: "2026-11-03" }));
    expect(reclosed.record.anchor?.txId).toBe(TX);
    const locked = lockCloses(first.company, "2026-10-31", "2026-11-03T10:00:00.000Z");
    expect(() => reopenCloses(locked, "2026-10-30", "2026-11-03T10:00:00.000Z")).toThrow(/locked/);
  });

  it("keeps the closes through a save and refuses damaged ones", () => {
    const { company } = closeRange(october(), "2026-10-31", opts());
    const back = companyFromJson(companyToJson(company));
    expect(back.closing).toEqual(company.closing);
    expect(() => validateClosing({ version: 1, secret: "short", records: [] })).toThrow(/damaged/);
    expect(() => validateClosing({ ...company.closing, records: [{ ...company.closing!.records[0], root: "x" }] })).toThrow(/damaged/);
  });

  it("reminds from the 5th to close last month while it isn't closed", () => {
    const c = october();
    expect(closeReminder(c, "2026-11-04")).toBeNull();
    expect(closeReminder(c, "2026-11-05")).toEqual({ through: "2026-10-31" });
    const { company } = closeRange(c, "2026-10-31", opts());
    expect(closeReminder(company, "2026-11-05")).toBeNull();
    expect(closeReminder(emptyCompany(createBooks({ businessName: "E", fiscalYearStartMonth: 1 })), "2026-11-05")).toBeNull();
  });
});

describe("the period proof of a close", () => {
  it("recomputes, from the file alone, to the root the close anchored", () => {
    const first = closeRange(october(), "2026-10-31", opts());
    const second = closeRange(first.company, "2026-11-01", opts());
    for (const { company, record } of [first, second]) {
      const proof = periodProofFor(second.company, record, "2026-11-05T00:00:00.000Z");
      const checked = checkPeriodProof(readPeriodProof(periodProofToJson(proof)));
      expect(checked.root).toBe(record.root);
      expect(checked.checks.every((c) => c.ok)).toBe(true);
      void company;
    }
    // The second chains to the first, and the file says so.
    expect(periodProofFor(second.company, second.record, "t").prevRoot).toBe(first.record.root);
  });

  it("carries every close of the range, newest first, with its anchor", () => {
    const closed = closeRange(october(), "2026-10-31", opts());
    const anchored = recordAnchor(closed.company, "2026-10-31", TX, "2026-11-03T00:00:00.000Z");
    // Reopened from the 30th and closed again: a new, shorter range, with a root of its own, not anchored yet.
    const reopened = reopenCloses(anchored, "2026-10-30", "2026-11-04T00:00:00.000Z");
    const again = closeRange(reopened, "2026-10-31", opts({ now: "2026-11-04T01:00:00.000Z" }));
    expect(again.record).toMatchObject({ start: "2026-10-30", end: "2026-10-31" });
    const proof = periodProofFor(again.company, again.record, "t");
    expect(proof.closes.map((c) => [c.start, c.closedAt, c.anchorTx ?? null, c.reopenedAt ?? null])).toEqual([
      ["2026-10-30", "2026-11-04T01:00:00.000Z", null, null],
      ["2026-10-25", "2026-11-02T18:00:00.000Z", TX, "2026-11-04T00:00:00.000Z"],
    ]);
    expect(checkPeriodProof(proof).root).toBe(again.record.root);
  });

  it("closed again unchanged after a reopen: the same root, and the anchor it already has", () => {
    const closed = closeRange(october(), "2026-10-31", opts());
    const anchored = recordAnchor(closed.company, "2026-10-31", TX, "2026-11-03T00:00:00.000Z");
    const again = closeRange(reopenCloses(anchored, "2026-10-25", "2026-11-04T00:00:00.000Z"), "2026-10-31", opts({ now: "2026-11-04T01:00:00.000Z" }));
    expect(again.record.root).toBe(closed.record.root);
    const proof = periodProofFor(again.company, again.record, "t");
    expect(proof.closes.map((c) => [c.closedAt, c.anchorTx ?? null, c.reopenedAt ?? null])).toEqual([
      ["2026-11-04T01:00:00.000Z", TX, null],
      ["2026-11-02T18:00:00.000Z", TX, "2026-11-04T00:00:00.000Z"],
    ]);
  });

  it("refuses a reopened close, and books without closes", () => {
    const closed = closeRange(october(), "2026-10-31", opts());
    const reopened = reopenCloses(closed.company, "2026-10-25", "2026-11-04T00:00:00.000Z");
    const stale = reopened.closing!.records[0]!;
    expect(() => periodProofFor(reopened, stale, "t")).toThrow(/reopened/);
    expect(() => periodProofFor(october(), closed.record, "t")).toThrow(/no closes/);
  });

  it("names the file for the business and the range", () => {
    expect(proofFileName("Day & Co.", { start: "2026-10-25", end: "2026-10-31" })).toBe("day-co-period-proof-2026-10-25-to-2026-10-31.json");
    expect(proofFileName("***", { start: "2026-10-25", end: "2026-10-31" })).toBe("books-period-proof-2026-10-25-to-2026-10-31.json");
  });
});
