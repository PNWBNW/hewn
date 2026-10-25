import { describe, expect, it } from "vitest";
import { addAccount, createBooks } from "@pnw/ledger";
import { type Sales, addCustomer, createInvoice, emptySales, sendInvoice, voidInvoice } from "@pnw/sales";
import { billOf, billsIn, deliveryOf, invoicesToDeliver, validateBill } from "./bill";
import type { Connections } from "./connections";
import type { Half } from "./key_ring";
import { type ThreadItem, validateMessage } from "./thread";

const A = "aleo1" + "a".repeat(58);
const key = (c: string) => "04" + c.repeat(128);
const half = (c: string): Half => ({ publicKey: key(c), privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" } });
let n = 0;
const item = (body: ThreadItem["body"], mine: boolean): ThreadItem => ({ version: 1, id: (++n).toString(16).padStart(32, "0"), from: mine ? "business" : "worker", sentAt: "2026-10-26T10:00:00.000Z", body, mine, seq: n });

function setup() {
  let books = createBooks({ businessName: "Cedar Co", fiscalYearStartMonth: 1 });
  const income = addAccount(books, { name: "Services", type: "income" });
  books = income.books;
  let sales: Sales = emptySales();
  const cust = addCustomer(sales, { name: "Rowan Ash" });
  sales = cust.sales;
  const inv = createInvoice(books, sales, {
    customerId: cust.customer.id,
    date: "2026-10-20",
    lines: [
      { description: "Fix the sink", accountId: income.account.id, quantity: "1.5", unitPrice: 8000n, taxable: true },
      { description: "Parts", accountId: income.account.id, quantity: "2", unitPrice: 1250n },
    ],
    taxRateBp: 825,
    memo: "Thanks!",
  });
  return { books, sales: inv.sales, invoice: inv.invoice, customerId: cust.customer.id };
}

describe("an invoice as the customer gets it", () => {
  it("carries what they need to see and pay it, and nothing of the books", () => {
    const { invoice } = setup();
    const bill = billOf(invoice);
    expect(bill).toMatchObject({ id: invoice.id, number: invoice.number, date: "2026-10-20", subtotal: "14500", tax: "990", total: "15490", memo: "Thanks!" });
    expect(bill.lines[0]).toEqual({ description: "Fix the sink", quantity: "1.5", unitPrice: "8000", taxable: true });
    expect(JSON.stringify(bill)).not.toContain("accountId");
  });

  it("refuses one whose totals don't add up, or that's damaged", () => {
    const bill = billOf(setup().invoice);
    expect(() => validateBill({ ...bill, total: "99999" })).toThrow(/don't add up/);
    expect(() => validateBill({ ...bill, lines: [] })).toThrow(/lines/);
    expect(() => validateBill({ ...bill, lines: [{ ...bill.lines[0], unitPrice: "-5" }] })).toThrow(/line is damaged/);
    expect(() => validateBill({ ...bill, dueDate: "soon" })).toThrow(/dates/);
  });

  it("can only be sent by the business", () => {
    const bill = billOf(setup().invoice);
    const raw = { version: 1, id: "f".repeat(32), from: "business", sentAt: "2026-10-26T10:00:00.000Z", body: { type: "invoice", bill } };
    expect(validateMessage(raw, "business").body).toEqual({ type: "invoice", bill });
    expect(() => validateMessage({ ...raw, from: "worker" }, "worker")).toThrow(/can't send/);
  });
});

describe("delivering invoices to a connected customer", () => {
  it("lists sent invoices not delivered yet, and voids of delivered ones", () => {
    const s = setup();
    const draftOnly: Connections = { [A]: { address: A, name: "rowan", nameHash: "42", mine: half("1"), theirs: key("2"), customerId: s.customerId } };
    expect(invoicesToDeliver(s.sales, draftOnly)).toEqual([]); // a draft isn't sent

    const sent = sendInvoice(s.books, s.sales, s.invoice.id);
    expect(invoicesToDeliver(sent.sales, draftOnly).map((d) => d.send)).toEqual(["invoice"]);
    expect(invoicesToDeliver(sent.sales, { [A]: { ...draftOnly[A]!, theirs: undefined } as never })).toEqual([]); // not connected

    const delivered: Connections = { [A]: { ...draftOnly[A]!, thread: { items: [item({ type: "invoice", bill: billOf(s.invoice) }, true)], nextIn: 0, nextOut: 1 } } };
    expect(invoicesToDeliver(sent.sales, delivered)).toEqual([]);
    expect(deliveryOf(delivered[A]!.thread!.items, s.invoice.id)).toBe("sent");

    const voided = voidInvoice(sent.books, sent.sales, s.invoice.id);
    expect(invoicesToDeliver(voided.sales, delivered).map((d) => d.send)).toEqual(["void"]);
    const told: Connections = { [A]: { ...delivered[A]!, thread: { ...delivered[A]!.thread!, items: [...delivered[A]!.thread!.items, item({ type: "invoice_void", id: s.invoice.id, number: s.invoice.number }, true)] } } };
    expect(deliveryOf(told[A]!.thread!.items, s.invoice.id)).toBe("void_sent");
    expect(invoicesToDeliver(voided.sales, told)).toEqual([]);
  });
});

describe("a customer's bills", () => {
  it("come from what businesses sent, the latest copy of each, voided when they said so", () => {
    const bill = billOf(setup().invoice);
    const later = { ...bill, id: "inv-2", number: "INV-0002", date: "2026-10-25" };
    const conns: Connections = {
      [A]: {
        address: A,
        name: "cedar_co",
        nameHash: "7",
        mine: half("1"),
        theirs: key("2"),
        thread: {
          items: [
            item({ type: "invoice", bill }, false),
            item({ type: "invoice", bill: later }, false),
            item({ type: "invoice_void", id: "inv-2", number: "INV-0002" }, false),
            item({ type: "text", text: "Thanks" }, true),
          ],
          nextIn: 3,
          nextOut: 1,
        },
      },
    };
    const bills = billsIn(conns);
    expect(bills.map((b) => [b.bill.number, b.status, b.business])).toEqual([
      ["INV-0002", "void", "cedar_co"],
      [bill.number, "open", "cedar_co"],
    ]);
    expect(billsIn(undefined)).toEqual([]);
  });
});
