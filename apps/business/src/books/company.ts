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
// a business's), one without a username (made before accounts), and one
// that calls it `email` (made before usernames, 2026-10-21).
// ---------------------------------------------------------------------------

import { type Books, type Dimensions, booksFromJson, booksToJson, dimensionsFromJson, dimensionsToJson, emptyDimensions } from "@pnw/ledger";
import { type Payroll, emptyPayroll, payrollFromJson, payrollToJson } from "@pnw/payroll";
import { type Sales, emptySales, salesFromJson, salesToJson } from "@pnw/sales";
import { type Mailbox, mailboxFromJson, mailboxToJson } from "./mailbox";
import { type Review, reviewFromJson, reviewToJson } from "./review";
import { type Funds, fundsFromJson, fundsToJson } from "./funds";
import { type Jobs, jobsFromJson, jobsToJson } from "./jobs";
import { type Rail, railFromJson, railToJson } from "./rail";
import { type Schedule, scheduleFromJson, scheduleToJson } from "./schedule";
import { type Role, type Work, workFromJson, workToJson } from "./work";
import { type PersonalEvent, validateEvents } from "./events";

export type Company = {
  books: Books;
  payroll: Payroll;
  sales: Sales;
  dimensions: Dimensions;
  rail?: Rail;
  /** What other people have sent this business (a team member's hours). Only on a business's file, once something arrived. */
  mailbox?: Mailbox;
  /** Money that moved in the Shield account, waiting to be said what it was. Only once something was found. */
  review?: Review;
  /** Set-asides inside the Shield account (books/funds.ts). Only once one was made. */
  funds?: Funds;
  /** The business's job postings on the board (books/jobs.ts). Only once one was posted. */
  jobs?: Jobs;
  /** The business's schedule drafts (books/schedule.ts); what was published lives in each conversation. Only once one was drafted. */
  schedule?: Schedule;
  /** Who this vault belongs to: a business (the default) or a person who works for one. */
  role?: Role;
  /** A person's own side: agreements, hours, paystubs. Only on a worker's file. */
  work?: Work;
  /** Personal events (books/events.ts): only on this account's own calendar. Absent before the first. */
  events?: PersonalEvent[];
  /** The account's username, normalised (an email on accounts made before usernames). Kept inside the encrypted file, never in the vault id's clear. Absent on books made before accounts. */
  username?: string;
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
    ...(c.mailbox ? { mailbox: mailboxToJson(c.mailbox) } : {}),
    ...(c.review ? { review: reviewToJson(c.review) } : {}),
    ...(c.funds ? { funds: fundsToJson(c.funds) } : {}),
    ...(c.jobs ? { jobs: jobsToJson(c.jobs) } : {}),
    ...(c.schedule ? { schedule: scheduleToJson(c.schedule) } : {}),
    ...(c.role ? { role: c.role } : {}),
    ...(c.work ? { work: workToJson(c.work) } : {}),
    ...(c.events && c.events.length > 0 ? { events: JSON.stringify(c.events) } : {}),
    ...(c.username ? { username: c.username } : {}),
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
    mailbox?: string;
    review?: string;
    funds?: string;
    jobs?: string;
    schedule?: string;
    role?: string;
    work?: string;
    events?: string;
    username?: string;
    /** What the username was called before usernames (2026-10-21). */
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
    if (typeof doc.mailbox === "string") company.mailbox = mailboxFromJson(doc.mailbox);
    if (typeof doc.review === "string") company.review = reviewFromJson(doc.review);
    if (typeof doc.funds === "string") company.funds = fundsFromJson(doc.funds);
    if (typeof doc.jobs === "string") company.jobs = jobsFromJson(doc.jobs);
    if (typeof doc.schedule === "string") company.schedule = scheduleFromJson(doc.schedule);
    if (doc.role !== undefined) {
      if (!ROLES.includes(doc.role as Role)) throw new Error("Unknown role in this company file");
      company.role = doc.role as Role;
    }
    if (typeof doc.work === "string") company.work = workFromJson(doc.work);
    if (typeof doc.events === "string") company.events = validateEvents(JSON.parse(doc.events));
    const username = typeof doc.username === "string" && doc.username ? doc.username : typeof doc.email === "string" && doc.email ? doc.email : null;
    if (username) company.username = username;
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
