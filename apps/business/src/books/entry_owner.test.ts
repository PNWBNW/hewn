import { describe, expect, it } from "vitest";
import { addAccount, balanceOf, createBooks, postEntry, reversalOf, systemAccount } from "@pnw/ledger";
import { type PayRun, findRailAccount, recordTaxPayment } from "@pnw/payroll";
import { addVendor, billBalance, enterBill } from "@pnw/sales";
import { type Company, emptyCompany } from "./company";
import { EntryOwnedError, entryOwner, voidEntry } from "./entry_owner";
import { matchEntry } from "./match";
import { startFromShield } from "./opening";
import type { Rail } from "./rail";
import { type ReviewItem, acceptItem, addReviewItems } from "./review";

const ADDR = "aleo1" + "q".repeat(58);
const rail: Rail = { version: 1, network: "testnet", address: ADDR, linkedAt: "2026-10-14T18:00:00.000Z", links: [] };
const tx = (n: number) => `at1${String(n).padStart(58, "x")}`;
const out = (n: number, minor: string): ReviewItem => ({ id: tx(n), date: "2026-10-20", direction: "out", minor, kind: "transfer_private", status: "new" });

/** Books following a $20,000 Shield balance, with a cash account, an expense account and one vendor. */
function company(): { c: Company; supplies: string; cash: string } {
  const s = addAccount(createBooks({ businessName: "T", fiscalYearStartMonth: 1 }), { name: "Office supplies", type: "expense" });
  const k = addAccount(s.books, { name: "Cash on hand", type: "bank" });
  const c = startFromShield({ ...emptyCompany(k.books), rail }, { date: "2026-10-01", minor: 20_000_000_000n, at: "2026-10-01T10:00:00Z" });
  return { c: { ...c, sales: addVendor(c.sales, { name: "Acme Supply" }).sales }, supplies: s.account.id, cash: k.account.id };
}

describe("voiding an entry from Transactions", () => {
  it("refuses a bill's own entry: payables and the bill stay as they were", () => {
    const { c, supplies } = company();
    const b = enterBill(c.books, c.sales, { vendorId: "vend-1", number: "A-77", date: "2026-10-10", lines: [{ description: "Paper", accountId: supplies, amount: 100_000n }] });
    const x: Company = { ...c, books: b.books, sales: b.sales };
    expect(entryOwner(x, b.bill.entryId)).toMatchObject({ href: "/expenses", label: "Void it from Expenses" });
    expect(() => voidEntry(x, b.bill.entryId, { date: "2026-11-13" })).toThrow(EntryOwnedError);
    expect(() => voidEntry(x, b.bill.entryId)).toThrow("Void it from Expenses");
    expect(balanceOf(x.books, systemAccount(x.books, "accounts_payable").id)).toBe(-100_000n);
    expect(billBalance(x.sales, b.bill)).toBe(100_000n);
    expect(reversalOf(x.books, b.bill.entryId)).toBeUndefined();
  });

  it("refuses a pay run's entry, and voids a payroll tax payment, which nothing else can correct", () => {
    const { c, cash, supplies } = company();
    const paid = postEntry(c.books, { date: "2026-10-15", memo: "Wages", source: { kind: "payroll", ref: "run-1" }, lines: [{ accountId: supplies, debit: 50_000n }, { accountId: cash, credit: 50_000n }] });
    const run = { id: "run-1", payDate: "2026-10-15", mode: "fiat", paychecks: [], entryIds: [paid.entry.id] } as unknown as PayRun;
    const withRun: Company = { ...c, books: paid.books, payroll: { ...c.payroll, runs: [run] } };
    expect(() => voidEntry(withRun, paid.entry.id)).toThrow("A pay run can't be voided; post a correcting entry");

    const deposit = postEntry(c.books, { date: "2026-10-01", lines: [{ accountId: cash, debit: 10_000n }, { accountId: systemAccount(c.books, "payroll_liabilities").id, credit: 10_000n }] });
    const tax = recordTaxPayment(deposit.books, { date: "2026-10-20", amount: 10_000n, bankAccountId: cash });
    const x = voidEntry({ ...c, books: tax.books }, tax.entry.id);
    expect(reversalOf(x.books, tax.entry.id)).toBeDefined();
  });

  it("voids an entry that claims a bill's source kind with no bill behind it", () => {
    const { c, supplies, cash } = company();
    const unbacked = postEntry(c.books, { date: "2026-10-12", source: { kind: "bill", ref: "bill-9" }, lines: [{ accountId: supplies, debit: 500n }, { accountId: cash, credit: 500n }] });
    const x: Company = { ...c, books: unbacked.books };
    expect(entryOwner(x, unbacked.entry.id)).toBeUndefined();
    expect(reversalOf(voidEntry(x, unbacked.entry.id).books, unbacked.entry.id)).toBeDefined();
  });

  it("refuses a manual entry matched from For review, and one accepted there", () => {
    const { c, supplies } = company();
    const shield = findRailAccount(c.books)!.id;
    const je = postEntry(c.books, { date: "2026-10-20", memo: "Rent", lines: [{ accountId: supplies, debit: 250_000n }, { accountId: shield, credit: 250_000n }] });
    const matched = matchEntry(addReviewItems({ ...c, books: je.books }, [out(1, "2500000000")]), tx(1), je.entry.id);
    expect(() => voidEntry(matched, je.entry.id)).toThrow("Undo it from For review");

    const accepted = acceptItem(addReviewItems(c, [out(2, "1000000")]), tx(2), { accountId: supplies });
    const entryId = accepted.review!.items[0]!.entryId!;
    expect(entryOwner(accepted, entryId)).toMatchObject({ href: "/transactions?tab=review", label: "Undo it from For review" });
  });

  it("refuses the entry that opened the books from Shield", () => {
    const { c } = company();
    const opening = c.rail!.start!.entryId!;
    expect(() => voidEntry(c, opening)).toThrow(EntryOwnedError);
  });

  it("voids a plain journal entry, and passes the date on for a closed period", () => {
    const { c, supplies, cash } = company();
    const je = postEntry(c.books, { date: "2026-10-05", lines: [{ accountId: supplies, debit: 700n }, { accountId: cash, credit: 700n }] });
    const closed: Company = { ...c, books: { ...je.books, marks: { closedThrough: "2026-10-31" } } };
    expect(() => voidEntry(closed, je.entry.id)).toThrow(expect.objectContaining({ code: "PERIOD_CLOSED" }));
    const x = voidEntry(closed, je.entry.id, { date: "2026-11-13" });
    expect(reversalOf(x.books, je.entry.id)?.date).toBe("2026-11-13");
  });
});
