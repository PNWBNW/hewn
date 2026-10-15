import { describe, expect, it } from "vitest";
import { addAccount, balanceOf, createBooks } from "@pnw/ledger";
import { findRailAccount } from "@pnw/payroll";
import { type Company, companyFromJson, companyToJson, emptyCompany } from "./company";
import { closeFund, createFund, defaultSource, fundBalances, isShieldFamily, moveFund, updateFund, validateFunds } from "./funds";
import { startFromShield } from "./opening";
import type { Rail } from "./rail";
import { acceptItem, addReviewItems, changeItem, choicesOf } from "./review";

const ADDR = "aleo1" + "q".repeat(58);
const rail: Rail = { version: 1, network: "testnet", address: ADDR, linkedAt: "2026-10-14T18:00:00.000Z", links: [] };
const tx = (n: number) => `at1${String(n).padStart(58, "x")}`;

function company(): { c: Company; expense: string } {
  const e = addAccount(createBooks({ businessName: "T", fiscalYearStartMonth: 1 }), { name: "Tools", type: "expense" });
  const c = startFromShield({ ...emptyCompany(e.books), rail }, { date: "2026-10-15", minor: 20_000_000n, at: "2026-10-15T10:00:00Z" });
  return { c, expense: e.account.id };
}

describe("set-asides", () => {
  it("splits the Shield account without moving money: General plus each set-aside equals the total", () => {
    const { c } = company();
    const made = createFund(c, { name: " Equipment fund ", vendorIds: ["v1"] });
    const next = moveFund(made.company, { accountId: made.accountId, cents: 1000n, direction: "into", date: "2026-10-16" });
    const view = fundBalances(next);
    expect(view.general).toBe(1000n);
    expect(view.funds).toEqual([{ accountId: made.accountId, name: "Equipment fund", cents: 1000n, vendorIds: ["v1"] }]);
    expect(view.total).toBe(2000n);
    // The set-aside sits under the Shield account, as a bank account.
    const shield = findRailAccount(next.books)!;
    expect(next.books.accounts.find((a) => a.id === made.accountId)).toMatchObject({ parentId: shield.id, type: "bank" });
    expect(isShieldFamily(next, made.accountId)).toBe(true);
  });

  it("refuses to set aside more than General holds, or release more than the set-aside holds", () => {
    const { c } = company();
    const made = createFund(c, { name: "Equipment fund" });
    expect(() => moveFund(made.company, { accountId: made.accountId, cents: 2001n, direction: "into", date: "2026-10-16" })).toThrow(/more than General/);
    expect(() => moveFund(made.company, { accountId: made.accountId, cents: 1n, direction: "out", date: "2026-10-16" })).toThrow(/more than Equipment fund/);
    expect(() => moveFund(made.company, { accountId: made.accountId, cents: 0n, direction: "into", date: "2026-10-16" })).toThrow(/above zero/);
    expect(() => createFund(c, { name: "general" })).toThrow(/money that isn't set aside/);
    expect(() => createFund(c, { name: "  " })).toThrow(/Name the set-aside/);
  });

  it("pays a vendor out of the set-aside that names it, and everyone else out of General", () => {
    const { c, expense } = company();
    const made = createFund(c, { name: "Equipment fund", vendorIds: ["v-saw"] });
    const shield = findRailAccount(made.company.books)!.id;
    expect(defaultSource(made.company, "v-saw")).toBe(made.accountId);
    expect(defaultSource(made.company, "v-other")).toBe(shield);
    expect(defaultSource(made.company, undefined)).toBe(shield);

    // A reviewed payment taken out of the set-aside, then changed back to General.
    let next = moveFund(made.company, { accountId: made.accountId, cents: 1000n, direction: "into", date: "2026-10-16" });
    next = addReviewItems(next, [{ id: tx(1), date: "2026-10-16", direction: "out", minor: "4000000", kind: "transfer_public", status: "new" }]);
    next = acceptItem(next, tx(1), { accountId: expense, shieldAccountId: made.accountId, name: { kind: "vendor", id: "v-saw" } });
    expect(balanceOf(next.books, made.accountId)).toBe(600n);
    expect(choicesOf(next, tx(1))).toMatchObject({ accountId: expense, shieldAccountId: made.accountId });
    next = changeItem(next, tx(1), { accountId: expense }, "2026-10-17");
    expect(balanceOf(next.books, made.accountId)).toBe(1000n);
    expect(fundBalances(next).general).toBe(600n);
    expect(choicesOf(next, tx(1))?.shieldAccountId).toBeUndefined();
    // A set-aside is never the "other side" of a review.
    expect(() => changeItem(next, tx(1), { accountId: made.accountId }, "2026-10-17")).toThrow(/other than the Shield account/);
  });

  it("renames, changes vendors, and closes a set-aside back into General", () => {
    const { c } = company();
    const made = createFund(c, { name: "Equipment fund" });
    let next = updateFund(made.company, made.accountId, { name: "Tools fund", vendorIds: ["v1", "v1", "v2"] });
    expect(fundBalances(next).funds[0]).toMatchObject({ name: "Tools fund", vendorIds: ["v1", "v2"] });
    next = moveFund(next, { accountId: made.accountId, cents: 500n, direction: "into", date: "2026-10-16" });
    next = closeFund(next, made.accountId, "2026-10-17");
    expect(fundBalances(next)).toEqual({ general: 2000n, funds: [], total: 2000n });
    expect(next.books.accounts.find((a) => a.id === made.accountId)?.active).toBe(false);
    expect(() => updateFund(next, made.accountId, { name: "x" })).toThrow(/isn't open/);
  });

  it("keeps set-asides through a save and reload, and refuses malformed ones", () => {
    const { c } = company();
    const made = createFund(c, { name: "Equipment fund", vendorIds: ["v1"] });
    expect(companyFromJson(companyToJson(made.company)).funds).toEqual(made.company.funds);
    for (const bad of [{ version: 2, funds: [] }, { version: 1, funds: [{ vendorIds: [] }] }, { version: 1, funds: [{ accountId: "a", vendorIds: [3] }] }]) {
      expect(() => validateFunds(bad)).toThrow();
    }
  });
});
