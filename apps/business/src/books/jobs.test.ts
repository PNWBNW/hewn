import { describe, expect, it } from "vitest";
import { createBooks } from "@pnw/ledger";
import { companyFromJson, companyToJson, emptyCompany } from "./company";
import { type JobPosting, type PostingFacts, factsLine, jobsFromJson, jobsToJson, listPostings, payLine, putPosting, validateBody, validateFacts } from "./jobs";

const facts: PostingFacts = { payType: "hourly", payMinCents: 2000, payMaxCents: 2500, employmentType: "full_time", hoursPerWeekTenths: 375, place: "remote" };
const posting = (id: string, extra: Partial<JobPosting> = {}): JobPosting => ({
  id,
  title: "Line cook",
  location: "Tacoma, WA",
  description: "Evenings and weekends.",
  facts,
  postedAt: "2026-10-19T10:00:00.000Z",
  transactionId: "at1abc",
  ...extra,
});

describe("posting facts", () => {
  it("accepts the program's ranges", () => {
    expect(validateFacts(facts)).toEqual(facts);
    expect(validateFacts({ ...facts, payType: "hidden", payMinCents: 0, payMaxCents: 0 }).payType).toBe("hidden");
    expect(validateFacts({ ...facts, hoursPerWeekTenths: 1680 }).hoursPerWeekTenths).toBe(1680);
  });
  it("refuses what the program refuses, before Shield is asked", () => {
    expect(() => validateFacts({ ...facts, payMinCents: 3000 })).toThrow(/below the bottom/);
    expect(() => validateFacts({ ...facts, payType: "hidden" })).toThrow(/leave the amounts empty/);
    expect(() => validateFacts({ ...facts, payMinCents: 0, payMaxCents: 0 })).toThrow(/Give the pay/);
    expect(() => validateFacts({ ...facts, hoursPerWeekTenths: 1681 })).toThrow(/between 0 and 168/);
    expect(() => validateFacts({ ...facts, payMinCents: 12.5 })).toThrow(/whole number of cents/);
    expect(() => validateFacts({ ...facts, employmentType: "gig" })).toThrow(/kind of work/);
    expect(() => validateFacts({ ...facts, place: "moon" })).toThrow(/where the work is/);
  });
  it("describes pay and the rest in words", () => {
    expect(payLine(facts)).toBe("$20.00–$25.00 an hour");
    expect(payLine({ ...facts, payMinCents: 2500 })).toBe("$25.00 an hour");
    expect(payLine({ ...facts, payType: "yearly", payMinCents: 0, payMaxCents: 6_000_000 })).toBe("$60,000 a year");
    expect(payLine({ ...facts, payType: "hidden", payMinCents: 0, payMaxCents: 0 })).toBe("Pay not shown");
    expect(factsLine(facts)).toBe("Full-time · 37.5 hours a week · Remote");
    expect(factsLine({ ...facts, employmentType: "unstated", hoursPerWeekTenths: 0, place: "unstated" })).toBe("");
  });
});

describe("posting words", () => {
  it("trims and bounds them", () => {
    expect(validateBody({ title: " Cook ", location: "", description: "x" })).toEqual({ title: "Cook", location: "", description: "x" });
    expect(() => validateBody({ title: "", location: "", description: "x" })).toThrow(/Give the posting a title/);
    expect(() => validateBody({ title: "t", location: "", description: " " })).toThrow(/Give the posting a description/);
    expect(() => validateBody({ title: "t".repeat(81), location: "", description: "x" })).toThrow(/title is too long/);
    expect(() => validateBody({ title: "t", location: "", description: "d".repeat(4001) })).toThrow(/description is too long/);
  });
});

describe("the vault's postings", () => {
  it("rides in the company file, and a file without any still opens", () => {
    const company = emptyCompany(createBooks({ businessName: "T", fiscalYearStartMonth: 1 }));
    const jobs = putPosting(undefined, posting("11"));
    expect(companyFromJson(companyToJson({ ...company, jobs })).jobs).toEqual(jobs);
    expect(companyFromJson(companyToJson(company)).jobs).toBeUndefined();
  });
  it("serialises and validates", () => {
    const jobs = putPosting(undefined, posting("11", { featuredUntil: 5000 }));
    const back = jobsFromJson(jobsToJson(jobs));
    expect(back).toEqual(jobs);
    expect(() => jobsFromJson(JSON.stringify({ version: 1, postings: [{ ...posting("0") }] }))).toThrow(/id isn't valid/);
    expect(() => jobsFromJson(JSON.stringify({ version: 1, postings: [{ ...posting("1"), transactionId: "x y" }] }))).toThrow(/transaction isn't valid/);
    expect(() => jobsFromJson(JSON.stringify({ version: 1, postings: [posting("1"), posting("1")] }))).toThrow(/listed twice/);
    expect(() => jobsFromJson(JSON.stringify({ version: 2, postings: [] }))).toThrow(/Unknown/);
  });
  it("replaces a posting by id and lists open ones first, newest first", () => {
    let jobs = putPosting(undefined, posting("1", { postedAt: "2026-10-01T00:00:00Z" }));
    jobs = putPosting(jobs, posting("2", { postedAt: "2026-10-05T00:00:00Z", closedAt: "2026-10-06T00:00:00Z" }));
    jobs = putPosting(jobs, posting("3", { postedAt: "2026-10-03T00:00:00Z" }));
    jobs = putPosting(jobs, { ...posting("1", { postedAt: "2026-10-01T00:00:00Z" }), title: "Head cook" });
    expect(jobs.postings).toHaveLength(3);
    expect(listPostings(jobs).map((p) => [p.id, p.title])).toEqual([
      ["3", "Line cook"],
      ["1", "Head cook"],
      ["2", "Line cook"],
    ]);
  });
});
