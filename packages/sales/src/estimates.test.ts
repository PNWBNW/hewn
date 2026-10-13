import { describe, expect, it } from "vitest";
import { addCustomer, createInvoice, deleteDraftInvoice, emptySales, invoiceTotals, sendInvoice, updateCustomer } from "./sales";
import {
  convertEstimateToInvoice,
  createEstimate,
  deleteEstimate,
  estimateStatus,
  estimateTotals,
  markEstimate,
  updateEstimate,
} from "./estimates";
import { salesFromJson, salesToJson } from "./serialize";
import { clock, contractor, invLine } from "./test_helpers";

function quoted() {
  const s = contractor();
  const lines = [
    invLine(s.income, "10", 12_500n, { taxable: true, tags: { project: "proj-1" } }),
    invLine(s.income, "1", 4_000n, { description: "Permit runner" }),
  ];
  const r = createEstimate(s.books, s.sales, { customerId: s.acme.id, date: "2026-10-01", lines, taxRateBp: 825, memo: "Deck" });
  return { ...s, sales: r.sales, estimate: r.estimate, lines };
}

describe("estimates", () => {
  it("are numbered EST-0001…, expire in 30 days by default, and never post", () => {
    const s = quoted();
    expect(s.estimate).toMatchObject({ id: "est-1", number: "EST-0001", state: "draft", expiryDate: "2026-10-31", taxRateBp: 825 });
    expect(s.estimate.lines[0]!.tags).toEqual({ project: "proj-1" });
    expect(estimateTotals(s.estimate)).toEqual({ subtotal: 129_000n, taxable: 125_000n, tax: 10_313n, total: 139_313n });
    const second = createEstimate(s.books, s.sales, { customerId: s.acme.id, date: "2026-10-02", expiryDate: "2026-10-09", lines: s.lines });
    expect(second.estimate.number).toBe("EST-0002");
    expect(s.books.entries).toHaveLength(0);
  });

  it("validates like an invoice", () => {
    const s = contractor();
    const base = { customerId: s.acme.id, date: "2026-10-01", lines: [invLine(s.income, "1", 100n)] };
    expect(() => createEstimate(s.books, s.sales, { ...base, lines: [] })).toThrow(/at least one line/);
    expect(() => createEstimate(s.books, s.sales, { ...base, expiryDate: "2026-09-30" })).toThrow(/expiry date is before/);
    expect(() => createEstimate(s.books, s.sales, { ...base, lines: [invLine(s.materials, "1", 100n)] })).toThrow(/income account/);
    expect(() => createEstimate(s.books, s.sales, { ...base, taxRateBp: 10_001 })).toThrow(/Tax rate/);
    const inactive = updateCustomer(s.sales, s.acme.id, { active: false });
    expect(() => createEstimate(s.books, inactive, base)).toThrow(/inactive/);
  });

  it("move draft → sent → accepted or declined; expired is derived", () => {
    const s = quoted();
    expect(estimateStatus(s.estimate, "2026-10-31")).toBe("draft");
    expect(estimateStatus(s.estimate, "2026-11-01")).toBe("expired");
    let sales = markEstimate(s.sales, "est-1", "sent");
    expect(estimateStatus(sales.estimates[0]!, "2026-11-01")).toBe("expired");
    expect(() => markEstimate(sales, "est-1", "sent")).toThrow(/already sent/);
    sales = markEstimate(sales, "est-1", "accepted");
    expect(estimateStatus(sales.estimates[0]!, "2026-12-01")).toBe("accepted");
    expect(() => updateEstimate(s.books, sales, "est-1", { customerId: s.acme.id, date: "2026-10-01", lines: s.lines })).toThrow(/can't be changed/);
    sales = markEstimate(sales, "est-1", "declined");
    expect(() => convertEstimateToInvoice(s.books, sales, "est-1")).toThrow(/declined/);
  });

  it("edit while pending; delete unless converted", () => {
    const s = quoted();
    const edited = updateEstimate(s.books, s.sales, "est-1", { customerId: s.acme.id, date: "2026-10-05", lines: s.lines.slice(0, 1), taxRateBp: 600 });
    expect(edited.estimates[0]).toMatchObject({ number: "EST-0001", date: "2026-10-05", expiryDate: "2026-11-04", taxRateBp: 600 });
    expect(deleteEstimate(edited, "est-1").estimates).toEqual([]);
  });

  it("converts once into a draft invoice with the same lines, tags and tax, linked both ways", () => {
    const s = quoted();
    let sales = createInvoice(s.books, s.sales, { customerId: s.acme.id, date: "2026-10-01", lines: s.lines }).sales; // INV-0001
    const r = convertEstimateToInvoice(s.books, sales, "est-1", { date: "2026-10-10" });
    sales = r.sales;
    expect(r.invoice).toMatchObject({ number: "INV-0002", state: "draft", date: "2026-10-10", dueDate: "2026-11-09", estimateId: "est-1", memo: "Deck" });
    expect(r.invoice.lines).toEqual(s.estimate.lines);
    expect(invoiceTotals(r.invoice)).toEqual(estimateTotals(s.estimate));
    expect(sales.estimates[0]).toMatchObject({ state: "converted", invoiceId: r.invoice.id });
    expect(estimateStatus(sales.estimates[0]!, "2027-01-01")).toBe("converted");
    expect(() => convertEstimateToInvoice(s.books, sales, "est-1")).toThrow(/already been converted/);
    expect(() => markEstimate(sales, "est-1", "declined")).toThrow(/already been converted/);
    expect(() => deleteEstimate(sales, "est-1")).toThrow(/became an invoice/);
    expect(s.books.entries).toHaveLength(0);

    // Sending the invoice posts the tags from the estimate's lines.
    const sent = sendInvoice(s.books, sales, r.invoice.id, clock);
    expect(sent.entry.lines.find((l) => l.tags)?.tags).toEqual({ project: "proj-1" });
  });

  it("gets its estimate back if the draft invoice is deleted", () => {
    const s = quoted();
    const r = convertEstimateToInvoice(s.books, markEstimate(s.sales, "est-1", "accepted"), "est-1");
    const back = deleteDraftInvoice(r.sales, r.invoice.id);
    expect(back.estimates[0]).toEqual({ ...s.estimate, state: "accepted" });
    expect(convertEstimateToInvoice(s.books, back, "est-1").invoice.number).toBe("INV-0002");
  });

  it("saves with the rest of sales; older files open with no estimates", () => {
    const s = quoted();
    expect(salesFromJson(salesToJson(s.sales))).toEqual(s.sales);
    const { estimates: _e, nextEstimate: _n, ...old } = addCustomer(emptySales(), { name: "Old Co" }).sales;
    const text = JSON.stringify({ format: "pnw-sales", sales: old });
    expect(salesFromJson(text)).toEqual({ ...old, estimates: [], nextEstimate: 1 });
  });
});
