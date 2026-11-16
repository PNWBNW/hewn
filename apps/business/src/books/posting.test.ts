import { describe, expect, it } from "vitest";
import { addAccount, createBooks, systemAccount } from "@pnw/ledger";
import { addCustomer, addVendor } from "@pnw/sales";
import { type Company, emptyCompany } from "./company";
import { PostingError, partyNamed, postJournalEntry } from "./posting";

/** Books with an expense account and one vendor (vend-1) and one customer (cust-1). */
function company(): { c: Company; supplies: string; ap: string; ar: string } {
  const s = addAccount(createBooks({ businessName: "T", fiscalYearStartMonth: 1 }), { name: "Office supplies", type: "expense" });
  const c = emptyCompany(s.books);
  const sales = addCustomer(addVendor(c.sales, { name: "Acme Supply" }).sales, { name: "Ana Ruiz" }).sales;
  return { c: { ...c, sales }, supplies: s.account.id, ap: systemAccount(s.books, "accounts_payable").id, ar: systemAccount(s.books, "accounts_receivable").id };
}

describe("a journal entry", () => {
  it("is always manual, and names only a customer or vendor that exists", () => {
    const { c, supplies, ap } = company();
    const lines = (id: string) => [{ accountId: supplies, debit: 900n }, { accountId: ap, credit: 900n, name: { kind: "vendor" as const, id } }];
    expect(() => postJournalEntry(c, { date: "2026-10-10", lines: lines("vend-99") })).toThrow(PostingError);
    expect(() => postJournalEntry(c, { date: "2026-10-10", lines: lines("vend-99") })).toThrow(/vendor/);
    const x = postJournalEntry(c, { date: "2026-10-10", memo: "Paper", lines: lines("vend-1") });
    expect(x.books.entries.at(-1)).toMatchObject({ memo: "Paper", source: { kind: "manual" } });
  });

  it("refuses an input that brings its own source, whatever kind it claims", () => {
    const { c, supplies, ap } = company();
    const lines = [{ accountId: supplies, debit: 100n }, { accountId: ap, credit: 100n, name: { kind: "vendor" as const, id: "vend-1" } }];
    const kinds = ["payroll", "bill", "bill_payment", "invoice", "payment", "deposit", "tax_payment", "manual"] as const;
    for (const kind of kinds) {
      const input = { date: "2026-11-02", source: { kind, ref: "run-7", doc: "ab".repeat(32) }, lines } as unknown as Parameters<typeof postJournalEntry>[1];
      expect(() => postJournalEntry(c, input)).toThrow("A journal entry is always manual");
    }
    expect(c.books.entries).toHaveLength(0);
  });

  it("checks a customer's name the same way, and lets lines with no name or 'other' through", () => {
    const { c, supplies, ar } = company();
    const bad = [{ accountId: ar, debit: 100n, name: { kind: "customer" as const, id: "Ana Ruiz" } }, { accountId: supplies, credit: 100n }];
    expect(() => postJournalEntry(c, { date: "2026-10-10", lines: bad })).toThrow(/customer/);
    const good = [{ accountId: ar, debit: 100n, name: { kind: "customer" as const, id: "cust-1" } }, { accountId: supplies, credit: 100n, name: { kind: "other" as const, id: "anything" } }];
    expect(postJournalEntry(c, { date: "2026-10-10", lines: good }).books.entries).toHaveLength(1);
    // A vendor's id named as a customer isn't that customer.
    const crossed = [{ accountId: ar, debit: 100n, name: { kind: "customer" as const, id: "vend-1" } }, { accountId: supplies, credit: 100n }];
    expect(() => postJournalEntry(c, { date: "2026-10-10", lines: crossed })).toThrow(/customer/);
  });
});

describe("finding a customer or vendor by the name typed on a journal line", () => {
  it("finds one by its name or id, and refuses a name nobody has or two share", () => {
    const { c } = company();
    expect(partyNamed(c, "vendor", "  acme supply ")).toBe("vend-1");
    expect(partyNamed(c, "vendor", "vend-1")).toBe("vend-1");
    expect(() => partyNamed(c, "vendor", "Acme Supplies")).toThrow(/No vendor is called/);
    expect(() => partyNamed(c, "customer", "Acme Supply")).toThrow(/No customer is called/);
    const twice = { ...c, sales: addVendor(c.sales, { name: "Acme  Supply" }).sales };
    expect(() => partyNamed(twice, "vendor", "acme supply")).toThrow(/More than one vendor/);
  });
});
