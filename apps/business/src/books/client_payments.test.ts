import { describe, expect, it } from "vitest";
import { addAccount, createBooks } from "@pnw/ledger";
import { addCustomer, createInvoice, invoiceBalance, sendInvoice } from "@pnw/sales";
import { billOf, billsIn } from "./bill";
import { paymentsToRecord, recordClientPayment } from "./client_payments";
import { type Company, emptyCompany } from "./company";
import type { Connections } from "./connections";
import { type CustomerSide, billKey, markPaymentTold, setBillPayment, validateCustomer } from "./customer";
import type { Half } from "./key_ring";
import { addReviewItems } from "./review";
import { type ThreadItem, validateMessage } from "./thread";

const CUST = "aleo1" + "a".repeat(58);
const BIZ = "aleo1" + "d".repeat(58);
const TX = "at1" + "q".repeat(58);
const TX2 = "at1" + "p".repeat(58);
const key = (c: string) => "04" + c.repeat(128);
const half = (c: string): Half => ({ publicKey: key(c), privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" } });
let n = 0;
const item = (body: ThreadItem["body"], mine: boolean, from: "business" | "worker"): ThreadItem => ({ version: 1, id: (++n).toString(16).padStart(32, "0"), from, sentAt: "2026-10-26T10:00:00.000Z", body, mine, seq: n });

function business() {
  let books = createBooks({ businessName: "Cedar Co", fiscalYearStartMonth: 1 });
  const income = addAccount(books, { name: "Services", type: "income" });
  books = income.books;
  const cust = addCustomer(emptyCompanySales(), { name: "Rowan" });
  const inv = createInvoice(books, cust.sales, { customerId: cust.customer.id, date: "2026-10-20", lines: [{ description: "Sink", accountId: income.account.id, quantity: "1", unitPrice: 15490n }] });
  const sent = sendInvoice(books, inv.sales, inv.invoice.id);
  const base: Company = { ...emptyCompany(sent.books), sales: sent.sales, rail: { version: 1, network: "testnet", address: BIZ, linkedAt: "2026-10-01T00:00:00.000Z", links: [] } };
  return { company: base, invoice: inv.invoice, customerId: cust.customer.id };
}
function emptyCompanySales() {
  return emptyCompany(createBooks({ businessName: "x", fiscalYearStartMonth: 1 })).sales;
}
const paid = (invoiceId: string, number: string, amount: string, transactionId = TX) => item({ type: "payment", invoiceId, number, amount, transactionId }, false, "worker");
const withPayment = (company: Company, customerId: string, ...items: ThreadItem[]): Company => ({
  ...company,
  clients: { [CUST]: { address: CUST, name: "rowan", nameHash: "42", mine: half("1"), theirs: key("2"), customerId, thread: { items, nextIn: items.length, nextOut: 0 } } } as Connections,
});
const arrived = (company: Company, minor: string, id = TX, status: "new" | "excluded" = "new") =>
  addReviewItems(company, [{ id, date: "2026-10-26", direction: "in", minor, counterparty: CUST, kind: "transfer_private", status }]);

describe("a business recording a customer's payment from Shield", () => {
  it("waits until its own account shows the transfer, then records it against the invoice", () => {
    const { company, invoice, customerId } = business();
    let c = withPayment(company, customerId, paid(invoice.id, invoice.number, "15490"));
    expect(paymentsToRecord(c)[0]).toMatchObject({ number: invoice.number, problem: expect.stringMatching(/Not found in your Shield account yet/) });
    expect(() => recordClientPayment(c, TX)).toThrow(/Not found in your Shield account yet/);

    c = arrived(c, "154900000"); // $154.90 in six-decimal units
    expect(paymentsToRecord(c)[0]!.seen?.inReview).toBe(true);
    c = recordClientPayment(c, TX);
    const inv = c.sales.invoices.find((i) => i.id === invoice.id)!;
    expect(invoiceBalance(c.sales, inv)).toBe(0n);
    expect(c.sales.payments[0]).toMatchObject({ amount: 15490n, reference: TX, date: "2026-10-26" });
    const reviewed = c.review!.items.find((i) => i.id === TX)!;
    expect(reviewed.status).toBe("recorded");
    expect(reviewed.entryId).toBe(c.sales.payments[0]!.entryId);
    expect(paymentsToRecord(c)).toEqual([]); // recorded once only
  });

  it("refuses a payment whose amount differs from what arrived, or that For review already handled", () => {
    const { company, invoice, customerId } = business();
    const short = arrived(withPayment(company, customerId, paid(invoice.id, invoice.number, "15490")), "100000000");
    expect(paymentsToRecord(short)[0]!.problem).toMatch(/different amount/);
    const handled = arrived(withPayment(company, customerId, paid(invoice.id, invoice.number, "15490")), "154900000", TX, "excluded");
    expect(paymentsToRecord(handled)[0]!.problem).toMatch(/already handled under For review/);
  });

  it("refuses a payment naming another customer's invoice, and ignores one the business sent itself", () => {
    const { company, invoice } = business();
    const other = addCustomer(company.sales, { name: "Someone else" });
    const c = arrived(withPayment({ ...company, sales: other.sales }, other.customer.id, paid(invoice.id, invoice.number, "15490")), "154900000");
    expect(paymentsToRecord(c)[0]!.problem).toMatch(/isn't one of this customer's invoices/);
    const mine = withPayment(company, business().customerId, { ...paid(invoice.id, invoice.number, "15490", TX2), mine: true });
    expect(paymentsToRecord(mine)).toEqual([]);
  });

  it("takes a payment message only from the customer's side", () => {
    const raw = { version: 1, id: "e".repeat(32), from: "worker", sentAt: "2026-10-26T10:00:00.000Z", body: { type: "payment", invoiceId: "inv-1", number: "INV-0001", amount: "15490", transactionId: TX } };
    expect(validateMessage(raw, "worker").body.type).toBe("payment");
    expect(() => validateMessage({ ...raw, from: "business" }, "business")).toThrow(/can't send/);
    expect(() => validateMessage({ ...raw, body: { ...raw.body, transactionId: "not-a-tx" } }, "worker")).toThrow(/transaction/);
  });
});

describe("confirming a payment from the account's own records (Joshua's test, 2026-10-26)", () => {
  it("records it when For review hasn't listed it, and adds it there as recorded so it's never counted again", () => {
    const { company, invoice, customerId } = business();
    let c = withPayment(company, customerId, paid(invoice.id, invoice.number, "3144"));
    const arrived = new Map([[TX, { id: TX, date: "2026-10-25", minor: "31440000" }]]);
    expect(paymentsToRecord(c, arrived)[0]!.seen).toEqual({ txId: TX, date: "2026-10-25", minor: "31440000", inReview: false });
    // The invoice is $154.90; $31.44 applies to it and the rest stays owed.
    c = recordClientPayment(c, TX, arrived);
    expect(c.sales.payments[0]).toMatchObject({ amount: 3144n, reference: TX, date: "2026-10-25" });
    expect(c.review!.items).toEqual([expect.objectContaining({ id: TX, status: "recorded", direction: "in", minor: "31440000", entryId: c.sales.payments[0]!.entryId })]);
    expect(paymentsToRecord(c, arrived)).toEqual([]);
    // A later For review check finds the same transfer and leaves it alone.
    expect(arrived_again(c).review!.items.filter((i) => i.id === TX)).toHaveLength(1);
  });

  it("finds the transfer from this customer for exactly this amount when Shield files it under another id", () => {
    const { company, invoice, customerId } = business();
    const c = withPayment(company, customerId, paid(invoice.id, invoice.number, "3144"));
    const other = "at1" + "z".repeat(58);
    const arrived = new Map([[other, { id: other, date: "2026-10-25", minor: "31440000", from: CUST }]]);
    expect(paymentsToRecord(c, arrived)[0]!.seen?.txId).toBe(other);
    const done = recordClientPayment(c, TX, arrived);
    expect(done.review!.items.map((i) => [i.id, i.status])).toEqual([[other, "recorded"]]);
    expect(done.sales.payments[0]!.reference).toBe(TX);
    // Not from someone else, and not when two transfers could be it.
    expect(paymentsToRecord(c, new Map([[other, { id: other, date: "2026-10-25", minor: "31440000", from: BIZ }]]))[0]!.seen).toBeUndefined();
    const twin = "at1" + "y".repeat(58);
    expect(paymentsToRecord(c, new Map([...arrived, [twin, { id: twin, date: "2026-10-25", minor: "31440000", from: CUST }]]))[0]!.seen).toBeUndefined();
  });

  it("refuses a different amount, and one that came in before the books started from Shield", () => {
    const { company, invoice, customerId } = business();
    const c = withPayment(company, customerId, paid(invoice.id, invoice.number, "3144"));
    expect(paymentsToRecord(c, new Map([[TX, { id: TX, date: "2026-10-25", minor: "100000000" }]]))[0]!.problem).toMatch(/different amount/);
    const started = { ...c, rail: { ...c.rail!, start: { date: "2026-10-26" } } };
    expect(paymentsToRecord(started, new Map([[TX, { id: TX, date: "2026-10-25", minor: "31440000" }]]))[0]!.problem).toMatch(/opening balance/);
  });
});

const arrived_again = (c: Company) => addReviewItems(c, [{ id: TX, date: "2026-10-25", direction: "in", minor: "31440000", counterparty: CUST, kind: "transfer_private", status: "new" }]);

describe("a customer's payment of a bill", () => {
  const start = { address: BIZ, invoiceId: "inv-1", number: "INV-0001", cents: "15490" };
  const k = billKey(BIZ, "inv-1");

  it("moves pending → settled and then never changes; a failed try goes back to pending keeping the record's tag", () => {
    let side: CustomerSide = { version: 1 };
    side = setBillPayment(side, start, { status: "pending", attempt: "a".repeat(32) });
    side = setBillPayment(side, start, { status: "failed", failure: "No USDCx" });
    expect(side.payments![k]!.settlement).toEqual({ status: "failed", failure: "No USDCx", attempt: "a".repeat(32) });
    side = setBillPayment(side, start, { status: "settled", reference: TX });
    expect(setBillPayment(side, start, { status: "failed", failure: "late" })).toBe(side);
    side = markPaymentTold(side, k, "2026-10-26T12:00:00.000Z");
    expect(validateCustomer(JSON.parse(JSON.stringify(side)))).toEqual(side);
  });

  it("shows a bill paying while on its way, and paid once settled", () => {
    const bill = { ...billOf({ id: "inv-1", number: "INV-0001", customerId: "c", date: "2026-10-20", dueDate: "2026-11-19", terms: "net_30", lines: [{ description: "Sink", accountId: "a", quantity: "1", unitPrice: 15490n }], taxRateBp: 0, state: "sent" }) };
    const conns: Connections = { [BIZ]: { address: BIZ, name: "cedar_co", nameHash: "7", mine: half("1"), theirs: key("2"), thread: { items: [item({ type: "invoice", bill }, false, "business")], nextIn: 1, nextOut: 0 } } };
    expect(billsIn(conns)[0]!.status).toBe("open");
    const paying = setBillPayment({ version: 1 }, start, { status: "pending", reference: "wallet-id" });
    expect(billsIn(conns, paying.payments)[0]!.status).toBe("paying");
    const done = setBillPayment(paying, start, { status: "settled", reference: TX });
    expect(billsIn(conns, done.payments)[0]!.status).toBe("paid");
  });
});
