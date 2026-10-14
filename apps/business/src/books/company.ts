// ---------------------------------------------------------------------------
// What the vault holds: the books plus everything private that hangs off
// them (payroll; customers, vendors, estimates, invoices and bills; the
// projects, classes and locations lines are tagged with; the rail, once an
// account is linked). Receipt files are sealed separately in the vault, never
// in this document. Each part keeps its own serializer; this file just wraps
// them in one document. Older saves still open: a bare books file (before
// payroll), a company file without sales (before invoices and bills), one
// without dimensions (before projects), and one without a rail (most of them).
// ---------------------------------------------------------------------------

import { type Books, type Dimensions, booksFromJson, booksToJson, dimensionsFromJson, dimensionsToJson, emptyDimensions } from "@pnw/ledger";
import { type Payroll, emptyPayroll, payrollFromJson, payrollToJson } from "@pnw/payroll";
import { type Sales, emptySales, salesFromJson, salesToJson } from "@pnw/sales";
import { type Rail, railFromJson, railToJson } from "./rail";

export type Company = { books: Books; payroll: Payroll; sales: Sales; dimensions: Dimensions; rail?: Rail };

const FORMAT = "pnw-company";

export function companyToJson(c: Company): string {
  return JSON.stringify({
    format: FORMAT,
    version: 1,
    books: booksToJson(c.books),
    payroll: payrollToJson(c.payroll),
    sales: salesToJson(c.sales),
    dimensions: dimensionsToJson(c.dimensions),
    ...(c.rail ? { rail: railToJson(c.rail) } : {}),
  });
}

export function companyFromJson(text: string): Company {
  const doc = JSON.parse(text) as {
    format?: string;
    version?: number;
    books?: string;
    payroll?: string;
    sales?: string;
    dimensions?: string;
    rail?: string;
  };
  if (doc.format === FORMAT && doc.version === 1 && typeof doc.books === "string" && typeof doc.payroll === "string") {
    const company: Company = {
      books: booksFromJson(doc.books),
      payroll: payrollFromJson(doc.payroll),
      sales: typeof doc.sales === "string" ? salesFromJson(doc.sales) : emptySales(),
      dimensions: typeof doc.dimensions === "string" ? dimensionsFromJson(doc.dimensions) : emptyDimensions(),
    };
    if (typeof doc.rail === "string") company.rail = railFromJson(doc.rail);
    return company;
  }
  // Earlier saves held only the books.
  return { books: booksFromJson(text), payroll: emptyPayroll(), sales: emptySales(), dimensions: emptyDimensions() };
}

export const emptyCompany = (books: Books): Company => ({
  books,
  payroll: emptyPayroll(),
  sales: emptySales(),
  dimensions: emptyDimensions(),
});
