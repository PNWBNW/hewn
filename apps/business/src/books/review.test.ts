import { describe, expect, it } from "vitest";
import { addAccount, balanceOf, createBooks } from "@pnw/ledger";
import { ensureRailAccount, findRailAccount } from "@pnw/payroll";
import { addCustomer, addVendor, createInvoice, enterBill, payBills, sendInvoice, voidBillPayment, voidPayment } from "@pnw/sales";
import { paymentsToRecord, recordClientPayment } from "./client_payments";
import { type Company, companyFromJson, companyToJson, emptyCompany } from "./company";
import type { Connections } from "./connections";
import type { Half } from "./key_ring";
import { startFromShield } from "./opening";
import { type Rail } from "./rail";
import {
  type ReviewItem,
  acceptItem,
  addReviewItems,
  byNewest,
  changeItem,
  choicesOf,
  excludeItem,
  keepWithin,
  knownIds,
  reopenForVoidedEntry,
  undoReview,
  validateReview,
  waitingCount,
} from "./review";
import type { ThreadItem } from "./thread";

const ADDR = "aleo1" + "q".repeat(58);
const DAO = "aleo1" + "d".repeat(58);
const tx = (n: number) => `at1${String(n).padStart(58, "x")}`;
const rail: Rail = { version: 1, network: "testnet", address: ADDR, linkedAt: "2026-10-14T18:00:00.000Z", links: [] };

function company(): { c: Company; expense: string; income: string } {
  let books = createBooks({ businessName: "T", fiscalYearStartMonth: 1 });
  const e = addAccount(books, { name: "Software", type: "expense" });
  books = e.books;
  const i = addAccount(books, { name: "Service Income", type: "income" });
  const c = startFromShield({ ...emptyCompany(i.books), rail }, { date: "2026-10-15", minor: 20_000_000n, at: "2026-10-15T10:00:00Z" });
  return { c, expense: e.account.id, income: i.account.id };
}

const sent: ReviewItem = { id: tx(1), date: "2026-10-16", direction: "out", minor: "4625000", counterparty: DAO, kind: "transfer_public", status: "new" };
const received: ReviewItem = { id: tx(2), date: "2026-10-16", at: "2026-10-16T12:00:00Z", direction: "in", minor: "4250000", kind: "transfer_public", status: "new" };

describe("the review list", () => {
  it("leaves out a movement it can't keep, and still takes the rest (Joshua's test, 2026-10-26)", () => {
    const { c } = company();
    const odd = { ...sent, id: "at1 not-a-transaction" } as ReviewItem;
    const next = addReviewItems(c, [odd, received]);
    expect(next.review!.items.map((i) => i.id)).toEqual([received.id]);
  });

  it("adds found movements once, however often the check runs", () => {
    const { c } = company();
    const once = addReviewItems(c, [sent, received]);
    const twice = addReviewItems(once, [sent, { ...received, status: "new" }]);
    expect(twice.review?.items).toHaveLength(2);
    expect(waitingCount(twice.review)).toBe(2);
    expect(knownIds(twice.review)).toEqual(new Set([tx(1), tx(2)]));
    expect(addReviewItems(once, [])).toBe(once);
  });

  it("marks a paycheck the app already paid as recorded", () => {
    const { c } = company();
    const withRun = {
      ...c,
      payroll: { ...c.payroll, runs: [{ paychecks: [{ settlement: { status: "settled", reference: tx(1) } }] }] },
    } as unknown as Company;
    const next = addReviewItems(withRun, [sent]);
    expect(next.review?.items[0]?.status).toBe("recorded");
    expect(waitingCount(next.review)).toBe(0);
  });

  it("posts money out against the chosen account, and money in the other way", () => {
    const { c, expense, income } = company();
    let next = addReviewItems(c, [sent, received]);
    next = acceptItem(next, tx(1), { accountId: expense, name: { kind: "vendor", id: "v1" }, tags: { project: "p1" }, memo: " Hosting " });
    next = acceptItem(next, tx(2), { accountId: income });
    const shield = findRailAccount(next.books)!.id;
    // 20.00 opening − 4.62 out + 4.25 in (a fraction of a cent is never posted).
    expect(balanceOf(next.books, shield)).toBe(2000n - 462n + 425n);
    expect(balanceOf(next.books, expense)).toBe(462n);
    expect(balanceOf(next.books, income)).toBe(-425n);
    const out = next.books.entries.find((e) => e.id === next.review!.items[0]!.entryId)!;
    expect(out).toMatchObject({ date: "2026-10-16", memo: "Hosting", source: { kind: "expense", ref: `review:${tx(1)}` } });
    expect(out.lines.find((l) => l.accountId === expense)).toMatchObject({ name: { kind: "vendor", id: "v1" }, tags: { project: "p1" } });
    expect(waitingCount(next.review)).toBe(0);
  });

  it("refuses to post twice, to the Shield account itself, to no account, or under a cent", () => {
    const { c, expense } = company();
    const shield = findRailAccount(c.books)!.id;
    let next = addReviewItems(c, [sent, { ...received, id: tx(3), minor: "9999" }]);
    expect(() => acceptItem(next, tx(1), { accountId: shield })).toThrow(/other than the Shield account/);
    expect(() => acceptItem(next, tx(1), { accountId: "acct-nope" })).toThrow(/Choose an account/);
    expect(() => acceptItem(next, tx(3), { accountId: expense })).toThrow(/less than a cent/);
    next = acceptItem(next, tx(1), { accountId: expense });
    expect(() => acceptItem(next, tx(1), { accountId: expense })).toThrow(/already been reviewed/);
    expect(() => acceptItem(next, tx(9), { accountId: expense })).toThrow(/isn't in the review list/);
  });

  it("excludes, and sends back: an excluded item simply, an accepted one by reversing its entry", () => {
    const { c, expense } = company();
    let next = addReviewItems(c, [sent, received]);
    next = excludeItem(next, tx(2));
    expect(waitingCount(next.review)).toBe(1);
    next = undoReview(next, tx(2), "2026-10-17");
    expect(next.review?.items.find((i) => i.id === tx(2))?.status).toBe("new");

    next = acceptItem(next, tx(1), { accountId: expense });
    const entries = next.books.entries.length;
    next = undoReview(next, tx(1), "2026-10-17");
    const item = next.review!.items.find((i) => i.id === tx(1))!;
    expect(item).toMatchObject({ status: "new" });
    expect(item.entryId).toBeUndefined();
    expect(next.books.entries).toHaveLength(entries + 1);
    expect(balanceOf(next.books, expense)).toBe(0n);
    expect(() => undoReview(next, tx(1), "2026-10-17")).toThrow(/Only accepted, excluded, kept or matched/);
  });

  it("reviews a move within the account like any other: kept with nothing posted, sent back, or posted elsewhere (Joshua, 2026-10-26)", () => {
    const { c, expense } = company();
    const move: ReviewItem = { id: tx(3), date: "2026-10-16", direction: "in", minor: "37190000", kind: "join", within: true, status: "new" };
    const listed = addReviewItems(c, [move]);
    expect(waitingCount(listed.review)).toBe(1);
    const entries = listed.books.entries.length;
    const kept = keepWithin(listed, tx(3));
    expect(kept.review!.items[0]).toMatchObject({ status: "internal", within: true });
    expect(kept.books.entries).toHaveLength(entries);
    expect(() => keepWithin(kept, tx(3))).toThrow(/already been reviewed/);
    const back = undoReview(kept, tx(3), "2026-10-17");
    expect(back.review!.items[0]).toMatchObject({ status: "new", within: true });
    // The business may call it something else: it went to another of its accounts, say.
    expect(acceptItem(back, tx(3), { accountId: expense }).review!.items[0]!.status).toBe("accepted");
  });

  it("brings back a move the app kept out of review on its own before (Joshua, 2026-10-26)", () => {
    const old = validateReview({ version: 1, items: [{ id: tx(4), date: "2026-10-16", direction: "in", minor: "1", kind: "join", status: "internal" }] });
    expect(old.items[0]).toMatchObject({ status: "new", within: true });
    const kept = validateReview({ version: 1, items: [{ id: tx(4), date: "2026-10-16", direction: "in", minor: "1", kind: "join", within: true, status: "internal" }] });
    expect(kept.items[0]!.status).toBe("internal");
    expect(() => validateReview({ version: 1, items: [{ ...kept.items[0], within: "yes" }] })).toThrow(/marked true/);
  });

  it("keeps the list through a save and reload, and refuses malformed items", () => {
    const { c, expense } = company();
    const next = acceptItem(addReviewItems(c, [sent, received]), tx(1), { accountId: expense });
    expect(companyFromJson(companyToJson(next)).review).toEqual(next.review);
    for (const bad of [
      { ...sent, id: "nope" },
      { ...sent, direction: "sideways" },
      { ...sent, minor: "-1" },
      { ...sent, counterparty: "bob" },
      { ...sent, status: "accepted" },
      { ...sent, status: "maybe" },
      { ...sent, kind: "Transfer Public" },
    ]) {
      expect(() => validateReview({ version: 1, items: [bad] })).toThrow();
    }
  });

  it("lists newest first", () => {
    expect(byNewest([sent, received, { ...sent, id: tx(4), date: "2026-10-18" }]).map((i) => i.id)).toEqual([tx(4), tx(2), tx(1)]);
  });

  it("changes an accepted item in one step: the old entry reversed, the new one posted", () => {
    const { c, expense, income } = company();
    const owner = addAccount(c.books, { name: "Owner's Draw", type: "equity" });
    let next = acceptItem(addReviewItems({ ...c, books: owner.books }, [sent]), tx(1), { accountId: expense, tags: { project: "p1" }, memo: "Hosting" });
    expect(choicesOf(next, tx(1))).toEqual({ accountId: expense, tags: { project: "p1" }, memo: "Hosting" });
    const before = next.books.entries.length;
    next = changeItem(next, tx(1), { accountId: owner.account.id, memo: "Mine" }, "2026-10-17");
    expect(next.books.entries).toHaveLength(before + 2); // the reversal and the corrected entry
    expect(balanceOf(next.books, expense)).toBe(0n);
    expect(balanceOf(next.books, owner.account.id)).toBe(462n);
    expect(choicesOf(next, tx(1))).toEqual({ accountId: owner.account.id, memo: "Mine" });
    expect(next.review?.items[0]?.status).toBe("accepted");
    // Only accepted items can change, and a bad choice changes nothing.
    expect(() => changeItem(next, tx(1), { accountId: "acct-nope" }, "2026-10-17")).toThrow(/Choose an account/);
    const waiting = addReviewItems(next, [received]);
    expect(() => changeItem(waiting, tx(2), { accountId: income }, "2026-10-17")).toThrow(/Only an accepted/);
    expect(choicesOf(waiting, tx(2))).toBeNull();
  });
});

describe("voiding a payment puts its transfer back under For review", () => {
  const CUST = "aleo1" + "c".repeat(58);
  const CTX = "at1" + "q".repeat(58);
  const OTHER_TX = "at1" + "w".repeat(58);
  const half = (c: string): Half => ({ publicKey: "04" + c.repeat(128), privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" } });
  const paidMessage = (invoiceId: string, number: string): ThreadItem => ({
    version: 1,
    id: "f".repeat(32),
    from: "worker",
    sentAt: "2026-10-26T10:00:00.000Z",
    body: { type: "payment", invoiceId, number, amount: "15490", transactionId: CTX },
    mine: false,
    seq: 1,
  });
  // A recorded item for some other entry, to show it's left alone.
  const elsewhere: ReviewItem = { id: OTHER_TX, date: "2026-10-20", direction: "in", minor: "1000000", kind: "transfer_public", status: "recorded", entryId: "je-elsewhere" };

  it("a customer's payment: the transfer waits again, and can be recorded again", () => {
    const { c: start, income } = company();
    const cust = addCustomer(start.sales, { name: "Rowan" });
    const inv = createInvoice(start.books, cust.sales, { customerId: cust.customer.id, date: "2026-10-20", lines: [{ description: "Sink", accountId: income, quantity: "1", unitPrice: 15490n }] });
    const sent = sendInvoice(start.books, inv.sales, inv.invoice.id);
    const clients = { [CUST]: { address: CUST, name: "rowan", nameHash: "42", mine: half("1"), theirs: "04" + "2".repeat(128), customerId: cust.customer.id, thread: { items: [paidMessage(inv.invoice.id, inv.invoice.number)], nextIn: 1, nextOut: 0 } } } as Connections;
    let c: Company = { ...start, books: sent.books, sales: sent.sales, clients };
    c = addReviewItems(c, [{ id: CTX, date: "2026-10-26", direction: "in", minor: "154900000", counterparty: CUST, kind: "transfer_private", status: "new" }, elsewhere]);
    c = recordClientPayment(c, CTX);
    const payment = c.sales.payments[0]!;
    expect(c.review!.items.find((i) => i.id === CTX)).toMatchObject({ status: "recorded", entryId: payment.entryId });

    const v = voidPayment(c.books, c.sales, payment.id, { date: "2026-10-27" });
    const voided = reopenForVoidedEntry({ ...c, books: v.books, sales: v.sales }, payment.entryId);
    const item = voided.review!.items.find((i) => i.id === CTX)!;
    expect(item.status).toBe("new");
    expect(item.entryId).toBeUndefined();
    expect(voided.review!.items.find((i) => i.id === OTHER_TX)).toEqual(elsewhere);
    // The customer's word shows again with the transfer seen, ready to record.
    expect(paymentsToRecord(voided)[0]).toMatchObject({ transactionId: CTX, seen: { txId: CTX, inReview: true } });
    const again = recordClientPayment(voided, CTX);
    expect(again.sales.payments.filter((p) => !p.voidEntryId)).toHaveLength(1);
    expect(again.review!.items.find((i) => i.id === CTX)).toMatchObject({ status: "recorded", entryId: again.sales.payments[1]!.entryId });
  });

  it("a bill payment from the Shield account: the transfer waits again", () => {
    const { c: start, expense } = company();
    const { books: withShield, accountId: shield } = ensureRailAccount(start.books);
    const vendor = addVendor(start.sales, { name: "Hosting Co" });
    const bill = enterBill(withShield, vendor.sales, { vendorId: vendor.vendor.id, date: "2026-10-16", lines: [{ description: "Hosting", accountId: expense, amount: 462n }] });
    const paidBill = payBills(bill.books, bill.sales, { vendorId: vendor.vendor.id, date: "2026-10-16", bankAccountId: shield, applications: [{ billId: bill.bill.id, amount: 462n }] });
    let c: Company = { ...start, books: paidBill.books, sales: paidBill.sales };
    c = addReviewItems(c, [{ ...sent, status: "recorded", entryId: paidBill.billPayment.entryId }, elsewhere]);

    const v = voidBillPayment(c.books, c.sales, paidBill.billPayment.id, { date: "2026-10-17" });
    const voided = reopenForVoidedEntry({ ...c, books: v.books, sales: v.sales }, paidBill.billPayment.entryId);
    expect(voided.review!.items.find((i) => i.id === sent.id)).toEqual({ ...sent, status: "new" });
    expect(voided.review!.items.find((i) => i.id === OTHER_TX)).toEqual(elsewhere);
    expect(waitingCount(voided.review)).toBe(1);
    // Nothing recorded with that entry: unchanged.
    expect(reopenForVoidedEntry(voided, paidBill.billPayment.entryId)).toBe(voided);
  });
});
