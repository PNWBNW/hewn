import { describe, expect, it } from "vitest";
import type { ThreadMessage } from "../books/thread";
import { addApplicant, applicantWorkerId, emptyJobs, jobsFromJson, jobsToJson, putPosting, setApplicantStatus } from "../books/jobs";
import { applicantKey, newHiringKey, packApplication } from "./applications";
import { applicantOf, interviewText, openApplications, statusBody } from "./applicants";
import type { LetterRecord } from "./letters";

const ids: Record<string, string> = { ana: "a".repeat(32), ben: "b".repeat(32), eve: "e".repeat(32) };
const message = (postingId: string, name: string): ThreadMessage => ({
  version: 1,
  id: ids[name]!,
  from: "worker",
  sentAt: "2026-10-19T12:00:00.000Z",
  body: { type: "application", postingId, name, nameHash: "123", message: "Hello", resume: "My resume." },
});
const record = (envelope: Uint8Array, blockHeight: number): LetterRecord => ({ kind: "page", lookup: "ab".repeat(32), envelope: new Uint8Array(envelope), blockHeight });

describe("opening the letters under a posting", () => {
  it("finds each new applicant once, skips known keys and what won't open", async () => {
    const hiring = await newHiringKey();
    const a = await applicantKey(hiring.publicKey, "42");
    const b = await applicantKey(hiring.publicKey, "42");
    const other = await applicantKey((await newHiringKey()).publicKey, "42");
    const records = [
      record(await packApplication(a.partiesKey, a.oneTimePublicKey, message("42", "ana")), 10),
      record(await packApplication(b.partiesKey, b.oneTimePublicKey, message("42", "ben")), 11),
      record(await packApplication(a.partiesKey, a.oneTimePublicKey, message("42", "ana")), 12), // sent twice
      record(await packApplication(other.partiesKey, other.oneTimePublicKey, message("42", "eve")), 13), // another posting's key
      record(new Uint8Array(10), 14),
    ];
    const { found, unreadable } = await openApplications(records, hiring, "42", new Set([b.partiesKey]));
    expect(found.map((f) => [f.message.body.name, f.partiesKey])).toEqual([["ana", a.partiesKey]]);
    expect(unreadable).toBe(2);
    const applicant = applicantOf(found[0]!, "aleo1" + "q".repeat(58));
    expect(applicant).toEqual({ partiesKey: a.partiesKey, name: "ana", nameHash: "123", address: "aleo1" + "q".repeat(58), appliedAt: "2026-10-19T12:00:00.000Z" });
  });
});

describe("the business's applicants", () => {
  const posting = { id: "42", title: "Cook", location: "", description: "d", facts: { payType: "hidden", payMinCents: 0, payMaxCents: 0, employmentType: "unstated", hoursPerWeekTenths: 0, place: "unstated" }, postedAt: "2026-10-19T10:00:00.000Z", transactionId: "at1x" } as const;
  const applicant = (key: string, name: string, at: string) => ({ partiesKey: key.repeat(32), name, nameHash: "1", address: "aleo1" + "q".repeat(58), appliedAt: at });
  it("are kept on the posting, once per key, newest first, with the status last sent", () => {
    let jobs = putPosting(emptyJobs(), { ...posting });
    jobs = addApplicant(jobs, "42", applicant("aa", "ana", "2026-10-19T12:00:00.000Z"));
    jobs = addApplicant(jobs, "42", applicant("bb", "ben", "2026-10-20T12:00:00.000Z"));
    jobs = addApplicant(jobs, "42", applicant("aa", "ana", "2026-10-19T12:00:00.000Z"));
    expect(jobs.postings[0]!.applicants?.map((a) => a.name)).toEqual(["ben", "ana"]);
    jobs = setApplicantStatus(jobs, "42", "aa".repeat(32), "interviewing", "2026-10-21T09:00:00.000Z");
    expect(jobs.postings[0]!.applicants?.find((a) => a.name === "ana")?.status).toBe("interviewing");
    expect(jobsFromJson(jobsToJson(jobs))).toEqual(jobs);
    expect(() => addApplicant(jobs, "99", applicant("cc", "cy", "2026-10-19T12:00:00.000Z"))).toThrow(/isn't in the books/);
    expect(() => setApplicantStatus(jobs, "42", "cc".repeat(32), "seen", "2026-10-21T09:00:00.000Z")).toThrow(/isn't in the books/);
    expect(() => jobsFromJson(JSON.stringify({ ...jobs, postings: [{ ...jobs.postings[0], applicants: [{ ...applicant("aa", "ana", "x"), status: "ghosted" }] }] }))).toThrow(/time they applied/);
    expect(applicantWorkerId("aa".repeat(32))).toBe("applicant:aaaaaaaaaaaaaaaa");
  });
  it("word the status and the interview", () => {
    expect(statusBody("42", "seen")).toEqual({ type: "application_status", postingId: "42", status: "seen" });
    expect(interviewText("2026-10-21T14:00:00", "Shop floor, 12 Pine St", " Ask for Jo. ")).toBe("Interview: Wed, Oct 21 at 2:00 PM\nShop floor, 12 Pine St\n\nAsk for Jo.");
    expect(interviewText("Thursday morning", "", "")).toBe("Interview: Thursday morning");
  });
});
