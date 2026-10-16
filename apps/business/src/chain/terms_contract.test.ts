// The employer (chain/terms.ts) seals the terms an offer is hashed from; the
// worker (chain/work/terms.ts) re-hashes what arrives and compares it with the
// agreement record. Both sides were written separately against one contract,
// so this pins them to each other byte for byte.

import { describe, expect, it } from "vitest";
import { canonicalTerms as employerCanonical, type Terms as EmployerTerms } from "./terms";
import { canonicalTerms as workerCanonical } from "./work/terms";
import type { Terms as WorkerTerms } from "@/books/work";

const terms = {
  version: 1 as const,
  kind: "terms" as const,
  agreementId: "a".repeat(64),
  termsText: "Part-time carpentry, tools provided. Overtime after 40 hours.",
  payType: "hourly" as const,
  rate: "3250",
  frequency: "biweekly" as const,
  startDate: "2026-11-02",
  businessName: "Brothers Carpentry",
  offeredAt: "2026-10-14T15:00:00.000Z",
};

describe("terms contract", () => {
  it("both sides produce the same canonical bytes for the same terms", () => {
    expect(workerCanonical(terms as WorkerTerms)).toBe(employerCanonical(terms as EmployerTerms));
  });

  it("key order is the contract's, whatever order the object was built in", () => {
    const shuffled = { offeredAt: terms.offeredAt, businessName: terms.businessName, startDate: terms.startDate, frequency: terms.frequency, rate: terms.rate, payType: terms.payType, termsText: terms.termsText, agreementId: terms.agreementId, kind: terms.kind, version: terms.version };
    expect(employerCanonical(shuffled as EmployerTerms)).toBe(employerCanonical(terms as EmployerTerms));
    expect(workerCanonical(shuffled as WorkerTerms)).toBe(workerCanonical(terms as WorkerTerms));
    expect(JSON.parse(employerCanonical(terms as EmployerTerms))).toEqual(terms);
    expect(Object.keys(JSON.parse(employerCanonical(shuffled as EmployerTerms)))).toEqual(Object.keys(terms));
  });
});

describe("terms contract, version 2 (the offer letter)", () => {
  const v2 = {
    ...terms,
    version: 2 as const,
    expiresAt: "2026-10-21T15:00:00.000Z",
    letter: { description: "Framing crew lead.", requirements: "Own truck.", handbook: "Steel toes on site.", other: "" },
    files: [{ name: "contract.pdf", type: "application/pdf", size: 300_000, sha256: "b".repeat(64), chunks: 2 }],
  };

  it("both sides produce the same bytes, letter and files at the end in their own fixed order", () => {
    const shuffled = {
      files: [{ chunks: 2, sha256: "b".repeat(64), size: 300_000, type: "application/pdf", name: "contract.pdf" }],
      letter: { other: "", handbook: "Steel toes on site.", requirements: "Own truck.", description: "Framing crew lead." },
      ...terms,
      version: 2 as const,
      expiresAt: "2026-10-21T15:00:00.000Z",
    };
    const employer = employerCanonical(v2 as EmployerTerms);
    expect(workerCanonical(v2 as WorkerTerms)).toBe(employer);
    expect(employerCanonical(shuffled as EmployerTerms)).toBe(employer);
    expect(workerCanonical(shuffled as WorkerTerms)).toBe(employer);
    expect(Object.keys(JSON.parse(employer))).toEqual([...Object.keys(terms), "expiresAt", "letter", "files"]);
  });

  it("the worker's check covers every word and every file: change one and the terms no longer match the record", async () => {
    const { termsDocHash, termsMatchRecord } = await import("./work/terms");
    const record = termsDocHash(v2 as WorkerTerms);
    expect(termsMatchRecord(v2 as WorkerTerms, record)).toBe(true);
    const otherFile = { ...v2, files: [{ ...v2.files[0]!, sha256: "c".repeat(64) }] };
    const otherWords = { ...v2, letter: { ...v2.letter, handbook: "Sandals fine." } };
    expect(termsMatchRecord(otherFile as WorkerTerms, record)).toBe(false);
    expect(termsMatchRecord(otherWords as WorkerTerms, record)).toBe(false);
    expect(termsMatchRecord({ ...terms } as WorkerTerms, record)).toBe(false); // the same offer as version 1
  });
});

describe("terms contract, version 2 with the job fields", () => {
  const v2 = {
    ...terms,
    version: 2 as const,
    expiresAt: "2026-10-21T15:00:00.000Z",
    letter: { description: "Framing crew lead.", requirements: "", handbook: "", other: "" },
    files: [],
  };

  it("both sides put the employment type and hours last, in that order, only when given", () => {
    const full = { hoursPerWeek: "37.5", ...v2, employmentType: "full_time" as const };
    const employer = employerCanonical(full as EmployerTerms);
    expect(workerCanonical(full as WorkerTerms)).toBe(employer);
    expect(Object.keys(JSON.parse(employer))).toEqual([...Object.keys(terms), "expiresAt", "letter", "files", "employmentType", "hoursPerWeek"]);
    // An offer without them keeps the bytes it was hashed with.
    expect(Object.keys(JSON.parse(employerCanonical(v2 as EmployerTerms)))).toEqual([...Object.keys(terms), "expiresAt", "letter", "files"]);
    expect(workerCanonical(v2 as WorkerTerms)).toBe(employerCanonical(v2 as EmployerTerms));
  });

  it("both sides refuse a job field this app doesn't know", () => {
    expect(() => employerCanonical({ ...v2, employmentType: "gig" } as unknown as EmployerTerms)).toThrow(/employment type/);
    expect(() => workerCanonical({ ...v2, hoursPerWeek: "40.0" } as unknown as WorkerTerms)).toThrow(/Hours a week/);
  });
});
