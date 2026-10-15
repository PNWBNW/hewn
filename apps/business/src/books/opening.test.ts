import { describe, expect, it } from "vitest";
import { addAccount, balanceOf, createBooks, postEntry, systemAccount } from "@pnw/ledger";
import { RAIL_ACCOUNT_NAME, findRailAccount } from "@pnw/payroll";
import { type Company, companyFromJson, companyToJson, emptyCompany } from "./company";
import { OPENING_SOURCE, minorToCents, startFromShield } from "./opening";
import { type Rail, validateRail } from "./rail";

const ADDR = "aleo1" + "q".repeat(58);
const rail: Rail = { version: 1, network: "testnet", address: ADDR, linkedAt: "2026-10-14T18:00:00.000Z", links: [] };
const company = (): Company => ({ ...emptyCompany(createBooks({ businessName: "T", fiscalYearStartMonth: 1 })), rail });

describe("starting the books from the Shield account", () => {
  it("posts the balance as the Shield account's opening balance against Opening Balance Equity", () => {
    const c = startFromShield(company(), { date: "2026-10-15", minor: 19_000_000n });
    const account = findRailAccount(c.books)!;
    expect(account).toMatchObject({ name: RAIL_ACCOUNT_NAME, type: "bank" });
    expect(balanceOf(c.books, account.id)).toBe(1900n);
    expect(balanceOf(c.books, systemAccount(c.books, "opening_balance_equity").id)).toBe(-1900n);
    const entry = c.books.entries.at(-1)!;
    expect(entry).toMatchObject({ date: "2026-10-15", source: OPENING_SOURCE });
    expect(c.rail?.start).toEqual({ date: "2026-10-15", entryId: entry.id });
  });

  it("drops a fraction of a cent rather than rounding money up", () => {
    expect(minorToCents(19_009_999n)).toBe(1900n);
    expect(minorToCents(0n)).toBe(0n);
    expect(() => minorToCents(-1n)).toThrow(/negative/);
  });

  it("records the start with no entry when the account holds nothing", () => {
    const c = startFromShield(company(), { date: "2026-10-15", minor: 5_000n });
    expect(c.books.entries).toHaveLength(0);
    expect(c.rail?.start).toEqual({ date: "2026-10-15" });
    expect(findRailAccount(c.books)?.name).toBe(RAIL_ACCOUNT_NAME);
  });

  it("renames the account from its old name and keeps what it already holds", () => {
    const base = company();
    const old = addAccount(base.books, { name: "Rail balance", type: "bank" });
    const opening = systemAccount(old.books, "opening_balance_equity").id;
    const paid = postEntry(old.books, { date: "2026-10-01", lines: [{ accountId: old.account.id, debit: 500n }, { accountId: opening, credit: 500n }] });
    const c = startFromShield({ ...base, books: paid.books }, { date: "2026-10-15", minor: 10_000_000n });
    expect(c.books.accounts.filter((a) => a.type === "bank" && a.active)).toHaveLength(1);
    expect(findRailAccount(c.books)).toMatchObject({ id: old.account.id, name: RAIL_ACCOUNT_NAME });
    expect(balanceOf(c.books, old.account.id)).toBe(1500n);
  });

  it("refuses to start twice, or without a linked account", () => {
    const c = startFromShield(company(), { date: "2026-10-15", minor: 1n });
    expect(() => startFromShield(c, { date: "2026-10-16", minor: 1n })).toThrow(/already follow this account from 2026-10-15/);
    expect(() => startFromShield({ ...company(), rail: undefined }, { date: "2026-10-15", minor: 1n })).toThrow(/Link Shield/);
  });

  it("keeps the start through a save and reload, and refuses a malformed one", () => {
    const c = startFromShield(company(), { date: "2026-10-15", minor: 19_000_000n });
    expect(companyFromJson(companyToJson(c)).rail?.start).toEqual(c.rail?.start);
    for (const start of [{ date: "15/10/2026" }, { date: "2026-02-31x" }, "2026-10-15", { date: "2026-10-15", entryId: 7 }]) {
      expect(() => validateRail({ ...rail, start })).toThrow();
    }
  });
});
