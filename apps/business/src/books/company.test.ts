import { describe, expect, it } from "vitest";
import { booksToJson, createBooks } from "@pnw/ledger";
import { addWorker, emptyPayroll, payrollToJson } from "@pnw/payroll";
import { addCustomer, addVendor, emptySales } from "@pnw/sales";
import { companyFromJson, companyToJson } from "./company";

const books = createBooks({ businessName: "T", fiscalYearStartMonth: 1 });
const payroll = addWorker(emptyPayroll(), {
  name: "Ana",
  payType: "hourly",
  rate: 2500n,
  frequency: "weekly",
  w4: { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n },
}).payroll;

describe("company file", () => {
  it("round-trips books, payroll and sales together", () => {
    const sales = addVendor(addCustomer(emptySales(), { name: "Acme" }).sales, { name: "Paper Co", tracks1099: true }).sales;
    expect(companyFromJson(companyToJson({ books, payroll, sales }))).toEqual({ books, payroll, sales });
  });

  it("still opens company files saved before sales existed", () => {
    const old = JSON.stringify({ format: "pnw-company", version: 1, books: booksToJson(books), payroll: payrollToJson(payroll) });
    expect(companyFromJson(old)).toEqual({ books, payroll, sales: emptySales() });
  });

  it("still opens books saved before payroll existed", () => {
    expect(companyFromJson(booksToJson(books))).toEqual({ books, payroll: emptyPayroll(), sales: emptySales() });
  });
});
