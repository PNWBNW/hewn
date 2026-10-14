import { describe, expect, it } from "vitest";
import { addProject, addTag, booksToJson, createBooks, emptyDimensions } from "@pnw/ledger";
import { addWorker, emptyPayroll, payrollToJson } from "@pnw/payroll";
import { addCustomer, addVendor, emptySales, salesToJson } from "@pnw/sales";
import { companyFromJson, companyToJson } from "./company";
import type { Rail } from "./rail";

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
      links: [{ workerId: "wkr-1", address: "aleo1" + "z".repeat(58), nameHash: "7", agreementId: "01".repeat(32) }],
    };
    const dimensions = emptyDimensions();
    const linked = companyToJson({ books, payroll, sales, dimensions, rail });
    expect(companyFromJson(linked)).toEqual({ books, payroll, sales, dimensions, rail });
    const unlinked = companyToJson({ books, payroll, sales, dimensions });
    expect(JSON.parse(unlinked)).not.toHaveProperty("rail");
    expect(companyFromJson(unlinked)).not.toHaveProperty("rail");
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
