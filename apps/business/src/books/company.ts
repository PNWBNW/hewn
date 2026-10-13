// ---------------------------------------------------------------------------
// What the vault holds: the books plus everything private that hangs off
// them (payroll today; customers, vendors and attachments later). Each part
// keeps its own serializer; this file just wraps them in one document.
// Books saved before payroll existed (a bare books file) still open.
// ---------------------------------------------------------------------------

import { type Books, booksFromJson, booksToJson } from "@pnw/ledger";
import { type Payroll, emptyPayroll, payrollFromJson, payrollToJson } from "@pnw/payroll";

export type Company = { books: Books; payroll: Payroll };

const FORMAT = "pnw-company";

export function companyToJson(c: Company): string {
  return JSON.stringify({ format: FORMAT, version: 1, books: booksToJson(c.books), payroll: payrollToJson(c.payroll) });
}

export function companyFromJson(text: string): Company {
  const doc = JSON.parse(text) as { format?: string; version?: number; books?: string; payroll?: string };
  if (doc.format === FORMAT && doc.version === 1 && typeof doc.books === "string" && typeof doc.payroll === "string") {
    return { books: booksFromJson(doc.books), payroll: payrollFromJson(doc.payroll) };
  }
  // Earlier saves held only the books.
  return { books: booksFromJson(text), payroll: emptyPayroll() };
}
