import { describe, expect, it } from "vitest";
import { paychecksAYear, paycheckNumber, receivedPlace, runPlace } from "./paystub_rings";
import type { ReceivedPaystub } from "./work";

const canon = (payDate: string, periodStart: string, periodEnd: string) => ({
  version: 1,
  payType: "hourly",
  position: 1,
  hours: 40,
  businessName: "Dayco Builders",
  workerId: "w1",
  workerName: "Ana W",
  payDate,
  periodStart,
  periodEnd,
  runId: `run-${payDate}`,
  rate: "2500",
  gross: "100000",
  federalIncomeTax: "0",
  socialSecurity: "0",
  medicare: "0",
  additionalMedicare: "0",
  employerSocialSecurity: "0",
  employerMedicare: "0",
  net: "100000",
  ytdGross: "100000",
  ytdWithheld: "0",
});

const received = (agreementId: string, seq: number, payDate: string, periodStart: string, periodEnd: string, document: unknown = canon(payDate, periodStart, periodEnd)): ReceivedPaystub => ({
  agreementId,
  seq,
  lookup: `${agreementId}:${seq}`,
  receivedAt: `${payDate}T12:00:00.000Z`,
  document,
  settlement: { transactionId: "at1example" },
  businessName: "Dayco Builders",
  paystubHash: "ab".repeat(32),
});

describe("paychecks a year, from the period's length", () => {
  it("reads weekly, two-week, half-month and monthly periods", () => {
    expect(paychecksAYear("2026-10-19", "2026-10-25")).toBe(52);
    expect(paychecksAYear("2026-10-12", "2026-10-25")).toBe(26);
    expect(paychecksAYear("2026-10-01", "2026-10-15")).toBe(24);
    expect(paychecksAYear("2026-10-16", "2026-10-31")).toBe(24);
    expect(paychecksAYear("2026-02-16", "2026-02-28")).toBe(24);
    expect(paychecksAYear("2026-10-01", "2026-10-31")).toBe(12);
    expect(paychecksAYear("2026-02-01", "2026-02-28")).toBe(12);
  });

  it("falls back to two-week pay when the dates make no sense", () => {
    expect(paychecksAYear("not a date", "2026-10-25")).toBe(26);
    expect(paychecksAYear("2026-10-25", "2026-10-01")).toBe(26);
  });
});

describe("a paycheck's number in its year", () => {
  it("counts the earlier pay dates of the same year, in any order, never the date itself or later ones", () => {
    const dates = ["2026-03-13", "2026-01-16", "2025-12-19", "2026-02-13", "2026-01-30", "2026-04-10"];
    expect(paycheckNumber("2026-01-16", dates)).toBe(1);
    expect(paycheckNumber("2026-03-13", dates)).toBe(4);
    expect(paycheckNumber("2026-04-10", dates)).toBe(5);
    expect(paycheckNumber("2025-12-19", dates)).toBe(1);
    expect(paycheckNumber("2027-01-01", dates)).toBe(1);
  });
});

describe("a received paystub's place", () => {
  const dayco = [
    received("a1", 0, "2026-01-16", "2026-01-05", "2026-01-18"),
    received("a1", 1, "2026-01-30", "2026-01-19", "2026-02-01"),
    received("a1", 2, "2026-02-13", "2026-02-02", "2026-02-15"),
    received("a1", 3, "2027-01-15", "2027-01-04", "2027-01-17"),
  ];
  const other = received("a2", 0, "2026-02-06", "2026-01-26", "2026-02-01");
  const broken = received("a1", 9, "2026-02-27", "2026-02-16", "2026-03-01", { version: 2 });

  it("is counted among the paystubs from the same agreement, at the period's pace", () => {
    const all = [...dayco, other, broken];
    expect(receivedPlace(dayco[2]!, all)).toEqual({ n: 3, of: 26 });
    expect(receivedPlace(dayco[0]!, all)).toEqual({ n: 1, of: 26 });
    expect(receivedPlace(dayco[3]!, all)).toEqual({ n: 1, of: 26 });
    expect(receivedPlace(other, all)).toEqual({ n: 1, of: 52 });
  });

  it("is null for a paystub that can't be read, which also doesn't count for the others", () => {
    expect(receivedPlace(broken, [...dayco, broken])).toBeNull();
    expect(receivedPlace(dayco[2]!, [...dayco, broken])).toEqual({ n: 3, of: 26 });
  });
});

describe("a paycheck's place in the business's runs", () => {
  const run = (id: string, payDate: string, workerIds: string[]) => ({ id, payDate, paychecks: workerIds.map((workerId) => ({ workerId })) });
  const payroll = { runs: [run("r1", "2026-01-16", ["w1", "w2"]), run("r2", "2026-01-30", ["w2"]), run("r3", "2026-02-13", ["w1", "w2"]), run("r4", "2026-02-27", ["w1"])] } as unknown as Parameters<typeof runPlace>[0];

  it("counts only the runs that paid this person, at their own frequency", () => {
    expect(runPlace(payroll, "w1", { payDate: "2026-02-27" }, "biweekly")).toEqual({ n: 3, of: 26 });
    expect(runPlace(payroll, "w2", { payDate: "2026-02-13" }, "weekly")).toEqual({ n: 3, of: 52 });
    expect(runPlace(payroll, "w1", { payDate: "2026-01-16" }, "monthly")).toEqual({ n: 1, of: 12 });
  });

  it("never shows more paychecks than the year holds rings for", () => {
    const busy = { runs: Array.from({ length: 14 }, (_, i) => run(`m${i}`, `2026-${String(i + 1).padStart(2, "0")}-01`.replace("2026-13", "2026-12").replace("2026-14", "2026-12"), ["w1"])) } as unknown as Parameters<typeof runPlace>[0];
    expect(runPlace(busy, "w1", { payDate: "2026-12-31" }, "monthly")).toEqual({ n: 15, of: 15 });
  });
});
