import { describe, expect, it } from "vitest";
import { defaultWorkWeek } from "../books/work_week";
import { type DraftInput, draftProblem, draftTerms, longDate, payLine } from "./agreement_draft";

const BASE: DraftInput = {
  businessName: "dayco",
  workerName: "Ana Ruiz",
  payType: "hourly",
  rate: 3000n,
  frequency: "biweekly",
  startDate: "2026-11-02",
  reviewDate: "2027-01-31",
};

describe("agreement draft", () => {
  it("states pay, dates and the parties, one paragraph each", () => {
    expect(draftTerms(BASE)).toBe(
      [
        "Offer of employment from dayco to Ana Ruiz.",
        "Pay: $30.00 an hour, paid every two weeks.",
        "Dates: starts November 2, 2026; open-ended.",
        "Pay review: January 31, 2027.",
        "Accepting this offer means you agree to these terms.",
      ].join("\n\n"),
    );
  });

  it("adds the optional lines only when they're filled in", () => {
    const text = draftTerms({
      ...BASE,
      jobTitle: " Carpenter ",
      duties: "Framing and finish work.",
      hoursPerWeek: "40",
      noticeDays: "14",
      endDate: "2027-06-30",
    });
    expect(text).toContain("Role: Carpenter.");
    expect(text).toContain("Duties: Framing and finish work.");
    expect(text).toContain("Hours: about 40 a week.");
    expect(text).toContain("Dates: starts November 2, 2026 and ends June 30, 2027.");
    expect(text).toContain("Notice: either of us can end this agreement by giving 14 days' notice.");
    expect(text).not.toContain("open-ended");
  });

  it("says a year for a salary and a day for one day's notice", () => {
    expect(payLine("salary", 6_500_000n, "monthly")).toBe("$65,000.00 a year, paid monthly");
    expect(draftTerms({ ...BASE, noticeDays: "1" })).toContain("1 day's notice");
  });

  it("names the business generically when it has no name yet", () => {
    expect(draftTerms({ ...BASE, businessName: " " })).toContain("from the business to Ana Ruiz");
  });

  it("refuses hours and notice that make no sense", () => {
    for (const hours of ["0", "-5", "abc", "169"]) {
      expect(draftProblem({ hoursPerWeek: hours })).toMatch(/Hours/);
      expect(() => draftTerms({ ...BASE, hoursPerWeek: hours })).toThrow(/Hours/);
    }
    for (const notice of ["-1", "2.5", "two", "1000"]) {
      expect(draftProblem({ noticeDays: notice })).toMatch(/Notice/);
      expect(() => draftTerms({ ...BASE, noticeDays: notice })).toThrow(/Notice/);
    }
    expect(draftProblem({ hoursPerWeek: "", noticeDays: "" })).toBeNull();
  });

  it("writes long dates and leaves anything else alone", () => {
    expect(longDate("2026-01-05")).toBe("January 5, 2026");
    expect(longDate("2026-13-05")).toBe("2026-13-05");
    expect(longDate("soon")).toBe("soon");
  });
});

describe("agreement draft: employment type and hours", () => {
  it("states the employment type after the role, and hours the one way", () => {
    const text = draftTerms({ ...BASE, jobTitle: "Carpenter", employmentType: "part_time", hoursPerWeek: "37.50" });
    expect(text).toContain("Role: Carpenter.\n\nEmployment: Part-time.");
    expect(text).toContain("Hours: about 37.5 a week.");
  });

  it("refuses hours that aren't a plain number up to 168", () => {
    for (const bad of ["0", "169", "1e2", "40.125", "forty"]) expect(draftProblem({ hoursPerWeek: bad })).toMatch(/up to 168/);
    expect(draftProblem({ hoursPerWeek: "168" })).toBeNull();
  });
});

describe("the work week in the draft", () => {
  it("follows the hours, one sentence a fact, and is left out when the offer has none", () => {
    const text = draftTerms({ ...BASE, hoursPerWeek: "40", workWeek: { ...defaultWorkWeek("America/Los_Angeles"), dailyOvertimeAfterHours: 8 } });
    expect(text).toContain(
      "Hours: about 40 a week.\n\nWork week: Sunday to Saturday, Pacific Time (America/Los_Angeles).\n\nOvertime: after 8 hours in a day or 40 hours in a week.\n\nShifts: a shift longer than 12 hours is reviewed before it is paid.\n\nDates:",
    );
    expect(draftTerms(BASE)).not.toContain("Work week");
  });
});
