// ---------------------------------------------------------------------------
// What the vault holds: the books plus everything private that hangs off
// them (payroll; customers, vendors, estimates, invoices and bills; the
// projects, classes and locations lines are tagged with; the rail, once an
// account is linked). Receipt files are sealed separately in the vault, never
// in this document. Each part keeps its own serializer; this file just wraps
// them in one document. Older saves still open: a bare books file (before
// payroll), a company file without sales (before invoices and bills), one
// without dimensions (before projects), one without a rail (most of them),
// and one without a role (every file from before the worker side existed is
// a business's), and one without an email (made before accounts).
// ---------------------------------------------------------------------------

import { type Books, type Dimensions, booksFromJson, booksToJson, dimensionsFromJson, dimensionsToJson, emptyDimensions } from "@pnw/ledger";
import { type Payroll, emptyPayroll, payrollFromJson, payrollToJson } from "@pnw/payroll";
import { type Sales, emptySales, salesFromJson, salesToJson } from "@pnw/sales";
import { type Rail, railFromJson, railToJson } from "./rail";
import { type Role, type Work, workFromJson, workToJson } from "./work";

export type Company = {
  books: Books;
  payroll: Payroll;
  sales: Sales;
  dimensions: Dimensions;
  rail?: Rail;
  /** Who this vault belongs to: a business (the default) or a person who works for one. */
  role?: Role;
  /** A person's own side: agreements, hours, paystubs. Only on a worker's file. */
  work?: Work;
  /** The account's email, normalised. Kept inside the encrypted file, never in the vault id's clear. Absent on books made before accounts. */
  email?: string;
};

const ROLES: Role[] = ["business", "worker"];

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
    ...(c.role ? { role: c.role } : {}),
    ...(c.work ? { work: workToJson(c.work) } : {}),
    ...(c.email ? { email: c.email } : {}),
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
    role?: string;
    work?: string;
    email?: string;
  };
  if (doc.format === FORMAT && doc.version === 1 && typeof doc.books === "string" && typeof doc.payroll === "string") {
    const company: Company = {
      books: booksFromJson(doc.books),
      payroll: payrollFromJson(doc.payroll),
      sales: typeof doc.sales === "string" ? salesFromJson(doc.sales) : emptySales(),
      dimensions: typeof doc.dimensions === "string" ? dimensionsFromJson(doc.dimensions) : emptyDimensions(),
    };
    if (typeof doc.rail === "string") company.rail = railFromJson(doc.rail);
    if (doc.role !== undefined) {
      if (!ROLES.includes(doc.role as Role)) throw new Error("Unknown role in this company file");
      company.role = doc.role as Role;
    }
    if (typeof doc.work === "string") company.work = workFromJson(doc.work);
    if (typeof doc.email === "string" && doc.email) company.email = doc.email;
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

/** The role a file was saved with; files from before roles existed are a business's. */
export const roleOf = (c: Pick<Company, "role">): Role => c.role ?? "business";
