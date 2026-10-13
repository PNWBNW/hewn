// ---------------------------------------------------------------------------
// What the vault holds: the books plus everything private that hangs off
// them (payroll; customers, vendors, invoices and bills; attachments later).
// Each part keeps its own serializer; this file just wraps them in one
// document. Older saves still open: a bare books file (before payroll) and
// a company file without sales (before invoices and bills).
// ---------------------------------------------------------------------------

import { type Books, booksFromJson, booksToJson } from "@pnw/ledger";
import { type Payroll, emptyPayroll, payrollFromJson, payrollToJson } from "@pnw/payroll";
import { type Sales, emptySales, salesFromJson, salesToJson } from "@pnw/sales";

export type Company = { books: Books; payroll: Payroll; sales: Sales };

const FORMAT = "pnw-company";

export function companyToJson(c: Company): string {
  return JSON.stringify({
    format: FORMAT,
    version: 1,
    books: booksToJson(c.books),
    payroll: payrollToJson(c.payroll),
    sales: salesToJson(c.sales),
  });
}

export function companyFromJson(text: string): Company {
  const doc = JSON.parse(text) as { format?: string; version?: number; books?: string; payroll?: string; sales?: string };
  if (doc.format === FORMAT && doc.version === 1 && typeof doc.books === "string" && typeof doc.payroll === "string") {
    return {
      books: booksFromJson(doc.books),
      payroll: payrollFromJson(doc.payroll),
      sales: typeof doc.sales === "string" ? salesFromJson(doc.sales) : emptySales(),
    };
  }
  // Earlier saves held only the books.
  return { books: booksFromJson(text), payroll: emptyPayroll(), sales: emptySales() };
}
