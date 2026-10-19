import { describe, expect, it } from "vitest";
import { type PaystubDocument, canonicalPaystub, paystubHash } from "@pnw/payroll";
import { paystubFromCanonical, receivedPaystubHash } from "./paystub_document";

const DOC: PaystubDocument = {
  version: 1,
  businessName: "Day Construction",
  workerId: "wkr-1",
  workerName: "Ana",
  payDate: "2026-10-23",
  periodStart: "2026-10-18",
  periodEnd: "2026-10-24",
  payType: "hourly",
  rate: 2250n,
  hours: 40,
  gross: 100_125n,
  federalIncomeTax: 8_000n,
  socialSecurity: 6_208n,
  medicare: 1_452n,
  additionalMedicare: 0n,
  employerSocialSecurity: 6_208n,
  employerMedicare: 1_452n,
  net: 84_465n,
  ytdGross: 100_125n,
  ytdWithheld: 15_660n,
  runId: "run-1",
  position: 1,
};

describe("a paystub as it arrives", () => {
  it("reads back to the hash the books committed to, with or without overtime", () => {
    const plain = JSON.parse(canonicalPaystub(DOC));
    expect(receivedPaystubHash(plain).hash).toBe(paystubHash(DOC));
    const withOvertime: PaystubDocument = { ...DOC, overtimeHours: 9, overtimeRate: 1.5 };
    const received = receivedPaystubHash(JSON.parse(canonicalPaystub(withOvertime)));
    expect(received.document).toMatchObject({ overtimeHours: 9, overtimeRate: 1.5 });
    expect(received.hash).toBe(paystubHash(withOvertime));
    expect(received.hash).not.toBe(paystubHash(DOC));
  });

  it("refuses overtime without both its hours and its rate as numbers", () => {
    const plain = JSON.parse(canonicalPaystub(DOC));
    expect(() => paystubFromCanonical({ ...plain, overtimeHours: 9 })).toThrow(/hours and its rate/);
    expect(() => paystubFromCanonical({ ...plain, overtimeHours: "9", overtimeRate: 1.5 })).toThrow(/hours and its rate/);
    expect(paystubFromCanonical(plain)).not.toHaveProperty("overtimeHours");
  });
});
