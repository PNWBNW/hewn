import { describe, expect, it } from "vitest";
import {
  type AttachmentRef,
  MAX_ATTACHMENT_BYTES,
  attachToBill,
  attachmentIds,
  createInvoice,
  detachFromBill,
  enterBill,
  payBills,
  paidToVendor,
  sendInvoice,
  voidBillPayment,
} from "./sales";
import { salesFromJson, salesToJson } from "./serialize";
import { clock, contractor, invLine } from "./test_helpers";

const receipt: AttachmentRef = { attachmentId: "att-1", sha256: "a".repeat(64), type: "image/png", size: 2048, name: " lumber.png " };

describe("tags on invoices and bills", () => {
  it("carry onto the posted income and expense lines, and nowhere else", () => {
    const s = contractor();
    const c = createInvoice(s.books, s.sales, {
      customerId: s.acme.id,
      date: "2026-10-01",
      taxRateBp: 825,
      lines: [
        invLine(s.income, "1", 100_000n, { taxable: true, tags: { project: "proj-1", location: "loc-1", class: "" } }),
        invLine(s.income, "1", 5_000n),
      ],
    });
    expect(c.invoice.lines[0]!.tags).toEqual({ project: "proj-1", location: "loc-1" });
    expect(c.invoice.lines[1]).not.toHaveProperty("tags");
    const sent = sendInvoice(s.books, c.sales, c.invoice.id, clock);
    expect(sent.entry.lines.map((l) => l.tags ?? null)).toEqual([null, { project: "proj-1", location: "loc-1" }, null, null]);

    const bill = enterBill(sent.books, sent.sales, {
      vendorId: s.lumber.id,
      date: "2026-10-02",
      lines: [
        { description: "Lumber", accountId: s.materials, amount: 40_000n, tags: { project: "proj-1" } },
        { description: "Shop", accountId: s.materials, amount: 1_000n },
      ],
    }, clock);
    expect(bill.entry.lines.map((l) => l.tags ?? null)).toEqual([{ project: "proj-1" }, null, null]);
    expect(() =>
      enterBill(s.books, s.sales, { vendorId: s.lumber.id, date: "2026-10-02", lines: [{ description: "", accountId: s.materials, amount: 1n, tags: { project: " x" } }] }),
    ).toThrow();
  });
});

describe("bill attachments", () => {
  it("keep only a reference on the bill, add and remove without posting", () => {
    const s = contractor();
    const r = enterBill(s.books, s.sales, { vendorId: s.lumber.id, date: "2026-10-02", lines: [{ description: "", accountId: s.materials, amount: 100n }], attachments: [receipt] }, clock);
    expect(r.bill.attachments).toEqual([{ ...receipt, name: "lumber.png" }]);
    const pdf = { ...receipt, attachmentId: "att-2", type: "application/pdf", name: "invoice.pdf" };
    let sales = attachToBill(r.sales, r.bill.id, pdf);
    expect(attachmentIds(sales)).toEqual(["att-1", "att-2"]);
    expect(() => attachToBill(sales, r.bill.id, pdf)).toThrow(/already attached/);
    sales = detachFromBill(detachFromBill(sales, r.bill.id, "att-1"), r.bill.id, "att-2");
    expect(sales.bills[0]).not.toHaveProperty("attachments");
    expect(r.books.entries).toHaveLength(1);
    expect(salesFromJson(salesToJson(r.sales))).toEqual(r.sales);
  });

  it("refuse other file types, oversized files and malformed references", () => {
    const s = contractor();
    const r = enterBill(s.books, s.sales, { vendorId: s.lumber.id, date: "2026-10-02", lines: [{ description: "", accountId: s.materials, amount: 100n }] }, clock);
    const bad = (ref: Partial<AttachmentRef>) => () => attachToBill(r.sales, r.bill.id, { ...receipt, ...ref });
    expect(bad({ type: "text/html" })).toThrow(/photo or a PDF/);
    expect(bad({ size: MAX_ATTACHMENT_BYTES + 1 })).toThrow(/10 MB/);
    expect(bad({ size: 0 })).toThrow(/empty/);
    expect(bad({ sha256: "xyz" })).toThrow(/fingerprint/);
    expect(bad({ attachmentId: "../etc" })).toThrow(/id/);
    expect(attachToBill(r.sales, r.bill.id, { ...receipt, size: MAX_ATTACHMENT_BYTES }).bills[0]!.attachments).toHaveLength(1);
  });
});

describe("1099 amounts", () => {
  it("sum bill payments to a vendor in the range, ignoring voided payments", () => {
    const s = contractor();
    let { books, sales } = s;
    const bill = (date: string, amount: bigint) => {
      const r = enterBill(books, sales, { vendorId: s.lumber.id, date, lines: [{ description: "", accountId: s.materials, amount }] }, clock);
      ({ books, sales } = r);
      return r.bill;
    };
    const pay = (date: string, billId: string, amount: bigint) => {
      const r = payBills(books, sales, { date, vendorId: s.lumber.id, bankAccountId: s.bank, applications: [{ billId, amount }] }, clock);
      ({ books, sales } = r);
      return r.billPayment;
    };
    const a = bill("2025-12-20", 50_000n);
    const b = bill("2026-03-01", 120_000n);
    pay("2025-12-28", a.id, 50_000n);
    pay("2026-03-15", b.id, 70_000n);
    const p = pay("2026-04-15", b.id, 50_000n);
    ({ books, sales } = voidBillPayment(books, sales, p.id, {}, clock));
    expect(paidToVendor(sales, s.lumber.id, "2026-01-01", "2026-12-31")).toBe(70_000n);
    expect(paidToVendor(sales, s.lumber.id, "2025-01-01", "2025-12-31")).toBe(50_000n);
    expect(paidToVendor(sales, s.power.id, "2026-01-01", "2026-12-31")).toBe(0n);
  });
});
