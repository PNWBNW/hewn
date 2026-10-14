import { describe, expect, it } from "vitest";
import { addProject, addTag, booksToJson, createBooks, emptyDimensions } from "@pnw/ledger";
import { addWorker, emptyPayroll, payrollToJson } from "@pnw/payroll";
import { addCustomer, addVendor, emptySales, salesToJson } from "@pnw/sales";
import { companyFromJson, companyToJson, roleOf } from "./company";
import type { Rail } from "./rail";
import { emptyWork, punch, upsertAgreement } from "./work";

const books = createBooks({ businessName: "T", fiscalYearStartMonth: 1 });
const payroll = addWorker(emptyPayroll(), {
  name: "Ana",
  payType: "hourly",
  rate: 2500n,
  frequency: "weekly",
  w4: { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n },
}).payroll;
const sales = addVendor(addCustomer(emptySales(), { name: "Acme" }).sales, { name: "Paper Co", tracks1099: true }).sales;

describe("company file", () => {
  it("round-trips books, payroll, sales and dimensions together", () => {
    const dimensions = addTag(addProject(emptyDimensions(), { name: "Kitchen", customerId: "cust-1" }).dims, "class", { name: "Residential" }).dims;
    expect(companyFromJson(companyToJson({ books, payroll, sales, dimensions }))).toEqual({ books, payroll, sales, dimensions });
  });

  it("carries the rail when an account is linked, and leaves it out when not", () => {
    const rail: Rail = {
      version: 1,
      network: "testnet",
      address: "aleo1" + "q".repeat(58),
      linkedAt: "2026-10-14T18:00:00.000Z",
      businessName: "brothers",
      links: [{ workerId: "wkr-1", address: "aleo1" + "z".repeat(58), nameHash: "7", agreementId: "01".repeat(32), status: "linked" }],
    };
    const dimensions = emptyDimensions();
    const linked = companyToJson({ books, payroll, sales, dimensions, rail });
    expect(companyFromJson(linked)).toEqual({ books, payroll, sales, dimensions, rail });
    const unlinked = companyToJson({ books, payroll, sales, dimensions });
    expect(JSON.parse(unlinked)).not.toHaveProperty("rail");
    expect(companyFromJson(unlinked)).not.toHaveProperty("rail");
  });

  it("carries a worker's role and work, and leaves both out of a business's file", () => {
    const dimensions = emptyDimensions();
    let work = upsertAgreement(emptyWork("Ana Ruiz"), {
      agreementId: "01".repeat(32),
      partiesKey: "ab".repeat(32),
      employerAddress: "aleo1" + "k".repeat(58),
      employerNameHash: "1",
      status: "active",
      employerName: "brothers",
    });
    work = punch(work, "01".repeat(32), "2026-10-14T15:00:00.000Z", "p1").work;
    const worker = companyToJson({ books, payroll: emptyPayroll(), sales: emptySales(), dimensions, role: "worker", work });
    expect(JSON.parse(worker).role).toBe("worker");
    expect(companyFromJson(worker)).toEqual({ books, payroll: emptyPayroll(), sales: emptySales(), dimensions, role: "worker", work });
    expect(roleOf(companyFromJson(worker))).toBe("worker");
    const business = companyToJson({ books, payroll, sales, dimensions });
    expect(JSON.parse(business)).not.toHaveProperty("role");
    expect(JSON.parse(business)).not.toHaveProperty("work");
    expect(companyFromJson(business)).not.toHaveProperty("role");
  });

  it("treats every file from before roles existed as a business's", () => {
    const old = JSON.stringify({ format: "pnw-company", version: 1, books: booksToJson(books), payroll: payrollToJson(payroll), sales: salesToJson(sales) });
    expect(roleOf(companyFromJson(old))).toBe("business");
    expect(roleOf(companyFromJson(booksToJson(books)))).toBe("business");
    const bad = JSON.stringify({ format: "pnw-company", version: 1, books: booksToJson(books), payroll: payrollToJson(payroll), role: "owner" });
    expect(() => companyFromJson(bad)).toThrow(/role/);
  });

  it("carries the account's email inside the file, and leaves it out when there is none", () => {
    const dimensions = emptyDimensions();
    const withEmail = companyToJson({ books, payroll, sales, dimensions, email: "ana@example.com" });
    expect(JSON.parse(withEmail).email).toBe("ana@example.com");
    expect(companyFromJson(withEmail)).toEqual({ books, payroll, sales, dimensions, email: "ana@example.com" });
    const without = companyToJson({ books, payroll, sales, dimensions });
    expect(JSON.parse(without)).not.toHaveProperty("email");
    expect(companyFromJson(without)).not.toHaveProperty("email");
  });

  it("opens files saved before accounts with no email", () => {
    const old = JSON.stringify({ format: "pnw-company", version: 1, books: booksToJson(books), payroll: payrollToJson(payroll), sales: salesToJson(sales), role: "business" });
    expect(companyFromJson(old).email).toBeUndefined();
    expect(companyFromJson(booksToJson(books)).email).toBeUndefined();
  });

  it("still opens company files saved before projects existed", () => {
    const old = JSON.stringify({ format: "pnw-company", version: 1, books: booksToJson(books), payroll: payrollToJson(payroll), sales: salesToJson(sales) });
    expect(companyFromJson(old)).toEqual({ books, payroll, sales, dimensions: emptyDimensions() });
  });

  it("still opens company files saved before sales existed", () => {
    const old = JSON.stringify({ format: "pnw-company", version: 1, books: booksToJson(books), payroll: payrollToJson(payroll) });
    expect(companyFromJson(old)).toEqual({ books, payroll, sales: emptySales(), dimensions: emptyDimensions() });
  });

  it("still opens books saved before payroll existed", () => {
    expect(companyFromJson(booksToJson(books))).toEqual({ books, payroll: emptyPayroll(), sales: emptySales(), dimensions: emptyDimensions() });
  });
});
