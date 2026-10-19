// ---------------------------------------------------------------------------
// The business's job postings, as the vault keeps them (docs/JOB_BOARD.md).
//
// A posting is the one thing in this app meant for anyone to read: its facts
// (pay, type, hours, where) and its words (title, location, description) are
// public on the board. The vault keeps the business's own copy so the Jobs
// page lists them without reading the network, and so the words are there to
// edit. Applicants never appear here: they arrive as letters, in the
// applicant's own conversation. No chain code in this file; the encodings
// live in chain/jobs.ts.
// ---------------------------------------------------------------------------

export type PayType = "hidden" | "hourly" | "yearly";
export type EmploymentType = "unstated" | "full_time" | "part_time" | "seasonal" | "temporary" | "contract";
export type Place = "unstated" | "on_site" | "remote" | "hybrid";

export const PAY_TYPES: readonly PayType[] = ["hidden", "hourly", "yearly"];
export const EMPLOYMENT_TYPES: readonly EmploymentType[] = ["unstated", "full_time", "part_time", "seasonal", "temporary", "contract"];
export const PLACES: readonly Place[] = ["unstated", "on_site", "remote", "hybrid"];

export const PAY_TYPE_LABEL: Record<PayType, string> = { hidden: "Not shown", hourly: "An hour", yearly: "A year" };
export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  unstated: "Not stated",
  full_time: "Full-time",
  part_time: "Part-time",
  seasonal: "Seasonal",
  temporary: "Temporary",
  contract: "Contract",
};
export const PLACE_LABEL: Record<Place, string> = { unstated: "Not stated", on_site: "On site", remote: "Remote", hybrid: "Hybrid" };

/** What anyone can filter on. Pay in cents; hours in tenths (375 is 37.5). */
export type PostingFacts = {
  payType: PayType;
  payMinCents: number;
  payMaxCents: number;
  employmentType: EmploymentType;
  hoursPerWeekTenths: number;
  place: Place;
};

/** The posting's words. */
export type PostingBody = { title: string; location: string; description: string };

export const MAX_TITLE_CHARS = 80;
export const MAX_LOCATION_CHARS = 80;
export const MAX_DESCRIPTION_CHARS = 4_000;
export const MAX_HOURS_TENTHS = 1_680;
export const MAX_PAY_CENTS = 1_000_000_000_00; // $1 billion, in cents: well inside u64
export const MAX_POSTINGS = 500;

export class JobsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobsError";
  }
}

const isCount = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
const isStamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const FIELD = /^[0-9]{1,78}$/;
const TX = /^[a-z0-9_]{1,80}$/;

/** The same checks the program makes, so a bad posting is refused before Shield is asked. */
export function validateFacts(raw: unknown): PostingFacts {
  if (!raw || typeof raw !== "object") throw new JobsError("The posting's facts are missing");
  const f = raw as Record<string, unknown>;
  if (!PAY_TYPES.includes(f.payType as PayType)) throw new JobsError("Choose how pay is shown");
  if (!isCount(f.payMinCents, MAX_PAY_CENTS) || !isCount(f.payMaxCents, MAX_PAY_CENTS)) throw new JobsError("Pay must be a whole number of cents");
  if (f.payMaxCents < f.payMinCents) throw new JobsError("The top of the pay range is below the bottom");
  if (f.payType === "hidden" && (f.payMinCents !== 0 || f.payMaxCents !== 0)) throw new JobsError("With pay not shown, leave the amounts empty");
  if (f.payType !== "hidden" && f.payMaxCents === 0) throw new JobsError("Give the pay, or choose not to show it");
  if (!EMPLOYMENT_TYPES.includes(f.employmentType as EmploymentType)) throw new JobsError("Choose the kind of work");
  if (!isCount(f.hoursPerWeekTenths, MAX_HOURS_TENTHS)) throw new JobsError("Hours a week must be between 0 and 168");
  if (!PLACES.includes(f.place as Place)) throw new JobsError("Choose where the work is");
  return {
    payType: f.payType as PayType,
    payMinCents: f.payMinCents,
    payMaxCents: f.payMaxCents,
    employmentType: f.employmentType as EmploymentType,
    hoursPerWeekTenths: f.hoursPerWeekTenths,
    place: f.place as Place,
  };
}

/** The words, trimmed and within their limits (the packed size is checked where they are packed). */
export function validateBody(raw: unknown): PostingBody {
  if (!raw || typeof raw !== "object") throw new JobsError("The posting's words are missing");
  const b = raw as Record<string, unknown>;
  const text = (v: unknown, what: string, max: number, required: boolean): string => {
    if (typeof v !== "string") throw new JobsError(`The ${what} isn't text`);
    const t = v.trim();
    if (required && !t) throw new JobsError(`Give the posting a ${what}`);
    if (t.length > max) throw new JobsError(`The ${what} is too long (at most ${max.toLocaleString("en-US")} characters)`);
    return t;
  };
  return {
    title: text(b.title, "title", MAX_TITLE_CHARS, true),
    location: text(b.location, "location", MAX_LOCATION_CHARS, false),
    description: text(b.description, "description", MAX_DESCRIPTION_CHARS, true),
  };
}

/** A posting as the business keeps it: what's on the board, plus when and how it got there. */
export type JobPosting = PostingBody & {
  /** The posting's id on the board: a decimal field, no suffix. */
  id: string;
  facts: PostingFacts;
  /** When it was posted, and the transaction that did it. */
  postedAt: string;
  transactionId: string;
  /** The last update, if any. */
  updatedAt?: string;
  /** Set once it was closed; a closed posting stays listed for the record. */
  closedAt?: string;
  /** The block height the featured window runs to, as last set; 0 or absent when never featured. */
  featuredUntil?: number;
};

export type Jobs = { version: 1; postings: JobPosting[] };

export const emptyJobs = (): Jobs => ({ version: 1, postings: [] });

function validatePosting(raw: unknown): JobPosting {
  if (!raw || typeof raw !== "object") throw new JobsError("A posting isn't valid");
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || !FIELD.test(p.id) || /^0+$/.test(p.id)) throw new JobsError("A posting's id isn't valid");
  if (!isStamp(p.postedAt)) throw new JobsError("A posting's date isn't valid");
  if (typeof p.transactionId !== "string" || !TX.test(p.transactionId)) throw new JobsError("A posting's transaction isn't valid");
  const posting: JobPosting = { ...validateBody(p), id: p.id, facts: validateFacts(p.facts), postedAt: p.postedAt, transactionId: p.transactionId };
  if (p.updatedAt !== undefined) {
    if (!isStamp(p.updatedAt)) throw new JobsError("A posting's update date isn't valid");
    posting.updatedAt = p.updatedAt;
  }
  if (p.closedAt !== undefined) {
    if (!isStamp(p.closedAt)) throw new JobsError("A posting's close date isn't valid");
    posting.closedAt = p.closedAt;
  }
  if (p.featuredUntil !== undefined) {
    if (!isCount(p.featuredUntil, 0xffff_ffff)) throw new JobsError("A posting's featured height isn't valid");
    posting.featuredUntil = p.featuredUntil;
  }
  return posting;
}

export function jobsToJson(j: Jobs): string {
  return JSON.stringify({ version: 1, postings: j.postings });
}

export function jobsFromJson(text: string): Jobs {
  const doc = JSON.parse(text) as { version?: number; postings?: unknown };
  if (doc.version !== 1 || !Array.isArray(doc.postings)) throw new JobsError("Unknown postings format");
  if (doc.postings.length > MAX_POSTINGS) throw new JobsError("Too many postings");
  const postings = doc.postings.map(validatePosting);
  if (new Set(postings.map((p) => p.id)).size !== postings.length) throw new JobsError("A posting is listed twice");
  return { version: 1, postings };
}

/** Adds a posting, or replaces the one with the same id. Newest first. */
export function putPosting(jobs: Jobs | undefined, posting: JobPosting): Jobs {
  const rest = (jobs ?? emptyJobs()).postings.filter((p) => p.id !== posting.id);
  if (rest.length >= MAX_POSTINGS) throw new JobsError("Too many postings; close and remove some first");
  return { version: 1, postings: [posting, ...rest].sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1)) };
}

export const postingById = (jobs: Jobs | undefined, id: string): JobPosting | undefined => jobs?.postings.find((p) => p.id === id);

/** Open postings first, then closed, each newest first. */
export function listPostings(jobs: Jobs | undefined): JobPosting[] {
  const all = jobs?.postings ?? [];
  const byDate = (a: JobPosting, b: JobPosting) => (a.postedAt < b.postedAt ? 1 : -1);
  return [...all.filter((p) => !p.closedAt).sort(byDate), ...all.filter((p) => p.closedAt).sort(byDate)];
}

/** "$20.00–$25.00 an hour", "$60,000 a year", or "Pay not shown". */
export function payLine(f: PostingFacts): string {
  if (f.payType === "hidden") return "Pay not shown";
  const money = (cents: number) =>
    `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: f.payType === "yearly" ? 0 : 2, maximumFractionDigits: f.payType === "yearly" ? 0 : 2 })}`;
  const range = f.payMinCents === f.payMaxCents || f.payMinCents === 0 ? money(f.payMaxCents) : `${money(f.payMinCents)}–${money(f.payMaxCents)}`;
  return `${range} ${f.payType === "hourly" ? "an hour" : "a year"}`;
}

/** "Full-time · 37.5 hours a week · Remote", leaving out what isn't stated. */
export function factsLine(f: PostingFacts): string {
  const parts: string[] = [];
  if (f.employmentType !== "unstated") parts.push(EMPLOYMENT_TYPE_LABEL[f.employmentType]);
  if (f.hoursPerWeekTenths > 0) parts.push(`${(f.hoursPerWeekTenths / 10).toLocaleString("en-US", { maximumFractionDigits: 1 })} hours a week`);
  if (f.place !== "unstated") parts.push(PLACE_LABEL[f.place]);
  return parts.join(" · ");
}
