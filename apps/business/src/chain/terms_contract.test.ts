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
