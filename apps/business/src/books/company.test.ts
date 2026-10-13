import { describe, expect, it } from "vitest";
import { booksToJson, createBooks } from "@pnw/ledger";
import { addWorker, emptyPayroll } from "@pnw/payroll";
import { companyFromJson, companyToJson } from "./company";

const books = createBooks({ businessName: "T", fiscalYearStartMonth: 1 });

describe("company file", () => {
  it("round-trips books and payroll together", () => {
    const payroll = addWorker(emptyPayroll(), {
      name: "Ana",
      payType: "hourly",
      rate: 2500n,
      frequency: "weekly",
      w4: { filingStatus: "single", dependentCredit: 0n, otherIncome: 0n, extraDeductions: 0n, extraWithholding: 0n },
    }).payroll;
    expect(companyFromJson(companyToJson({ books, payroll }))).toEqual({ books, payroll });
  });

  it("still opens books saved before payroll existed", () => {
    expect(companyFromJson(booksToJson(books))).toEqual({ books, payroll: emptyPayroll() });
  });
});
