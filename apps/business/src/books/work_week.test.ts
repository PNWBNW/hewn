import { describe, expect, it } from "vitest";
import {
  WORK_WEEK_KEYS,
  cleanHalfHours,
  defaultWorkWeek,
  draftOfWorkWeek,
  isTimeZone,
  payRulesOf,
  validateWorkWeek,
  weekEndsOn,
  workWeekFromDraft,
  workWeekLines,
  workWeekSummary,
} from "./work_week";

const LA = defaultWorkWeek("America/Los_Angeles");

describe("a work week", () => {
  it("starts from Sunday to Saturday, overtime after 40 at time and a half, shifts up to 12", () => {
    expect(LA).toEqual({ startsOn: "sunday", timeZone: "America/Los_Angeles", overtimeAfterHours: 40, dailyOvertimeAfterHours: 0, longestShiftHours: 12, overtimeRate: 1.5 });
    expect(Object.keys(LA)).toEqual([...WORK_WEEK_KEYS]);
    expect(defaultWorkWeek().timeZone).toBeTruthy();
  });

  it("comes back clean, keys in the contract's order, whatever order it was built in", () => {
    const shuffled = { longestShiftHours: 10, dailyOvertimeAfterHours: 8, overtimeAfterHours: 40, timeZone: "America/New_York", startsOn: "sunday", extra: 1 };
    const w = validateWorkWeek(shuffled);
    // A work week from before the overtime rate was asked keeps its five keys, and its bytes.
    expect(Object.keys(w)).toEqual(WORK_WEEK_KEYS.slice(0, 5));
    expect(w).toEqual({ startsOn: "sunday", timeZone: "America/New_York", overtimeAfterHours: 40, dailyOvertimeAfterHours: 8, longestShiftHours: 10 });
    const withRate = validateWorkWeek({ overtimeRate: 2, ...shuffled });
    expect(Object.keys(withRate)).toEqual([...WORK_WEEK_KEYS]);
    expect(withRate.overtimeRate).toBe(2);
  });

  it("refuses an overtime rate outside 1 to 3, or finer than a hundredth", () => {
    expect(() => validateWorkWeek({ ...LA, overtimeRate: 0.5 })).toThrow(/1 to 3 times/);
    expect(() => validateWorkWeek({ ...LA, overtimeRate: 3.5 })).toThrow(/1 to 3 times/);
    expect(() => validateWorkWeek({ ...LA, overtimeRate: 1.555 })).toThrow(/1 to 3 times/);
    expect(() => validateWorkWeek({ ...LA, overtimeRate: "1.5" })).toThrow(/1 to 3 times/);
    expect(validateWorkWeek({ ...LA, overtimeRate: 1 }).overtimeRate).toBe(1);
    expect(validateWorkWeek({ ...LA, overtimeRate: 1.75 }).overtimeRate).toBe(1.75);
  });

  it("pays by the agreement's rules, or by the baseline without a work week", () => {
    expect(payRulesOf(undefined, "UTC")).toEqual({ timeZone: "UTC", overtimeAfterHours: 40, dailyOvertimeAfterHours: 0, overtimeRate: 1.5 });
    expect(payRulesOf({ ...LA, dailyOvertimeAfterHours: 10, overtimeRate: 2 })).toEqual({ timeZone: "America/Los_Angeles", overtimeAfterHours: 40, dailyOvertimeAfterHours: 10, overtimeRate: 2 });
    const { overtimeRate: _r, ...older } = LA;
    expect(payRulesOf(older).overtimeRate).toBe(1.5);
  });

  it("refuses a day, a zone or hours that aren't right", () => {
    expect(() => validateWorkWeek({ ...LA, startsOn: "someday" })).toThrow(/day of the week/);
    expect(() => validateWorkWeek({ ...LA, timeZone: "Mars/Olympus" })).toThrow(/time zone/);
    expect(() => validateWorkWeek({ ...LA, timeZone: "" })).toThrow(/time zone/);
    expect(() => validateWorkWeek({ ...LA, overtimeAfterHours: 40.25 })).toThrow(/Overtime after/);
    expect(() => validateWorkWeek({ ...LA, overtimeAfterHours: "40" })).toThrow(/Overtime after/);
    expect(() => validateWorkWeek({ ...LA, dailyOvertimeAfterHours: 25 })).toThrow(/Daily overtime/);
    expect(() => validateWorkWeek({ ...LA, longestShiftHours: 0 })).toThrow(/longest shift/);
    expect(() => validateWorkWeek({ ...LA, longestShiftHours: 24.5 })).toThrow(/longest shift/);
    expect(() => validateWorkWeek(null)).toThrow(/object/);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Europe/Lisbon")).toBe(true);
    expect(isTimeZone("x".repeat(65))).toBe(false);
  });

  it("puts itself into words", () => {
    expect(workWeekLines(LA)).toEqual([
      "Work week: Sunday to Saturday, Pacific Time (America/Los_Angeles).",
      "Overtime: after 40 hours in a week, paid at 1.5 times the hourly rate.",
      "Shifts: a shift longer than 12 hours is reviewed before it is paid.",
    ]);
    expect(workWeekLines({ ...LA, startsOn: "monday", dailyOvertimeAfterHours: 8, longestShiftHours: 10.5, overtimeRate: 2 })).toEqual([
      "Work week: Monday to Sunday, Pacific Time (America/Los_Angeles).",
      "Overtime: after 8 hours in a day or 40 hours in a week, paid at 2 times the hourly rate.",
      "Shifts: a shift longer than 10.5 hours is reviewed before it is paid.",
    ]);
    expect(workWeekLines({ ...LA, overtimeAfterHours: 0 })[1]).toBe("Overtime: none.");
    expect(workWeekLines({ ...LA, overtimeAfterHours: 0, dailyOvertimeAfterHours: 8 })[1]).toBe("Overtime: after 8 hours in a day, paid at 1.5 times the hourly rate.");
    expect(workWeekSummary(LA)).toBe("Sunday to Saturday · overtime after 40 hours a week at 1.5× · shifts up to 12 hours");
    expect(workWeekSummary({ ...LA, overtimeAfterHours: 0 })).toContain("no overtime");
    expect(weekEndsOn("monday")).toBe("sunday");
    expect(weekEndsOn("sunday")).toBe("saturday");
    expect(weekEndsOn("wednesday")).toBe("tuesday");
  });

  it("round-trips through the form and names what's wrong", () => {
    const draft = draftOfWorkWeek({ ...LA, dailyOvertimeAfterHours: 8, longestShiftHours: 10.5 });
    expect(draft).toEqual({ startsOn: "sunday", timeZone: "America/Los_Angeles", overtimeText: "40", dailyText: "8", longestText: "10.5", rateText: "1.5" });
    expect(workWeekFromDraft({ ...draft, rateText: "2" })).toEqual({ workWeek: { ...LA, dailyOvertimeAfterHours: 8, longestShiftHours: 10.5, overtimeRate: 2 } });
    expect(workWeekFromDraft({ ...draft, rateText: "" })).toEqual({ workWeek: { ...LA, dailyOvertimeAfterHours: 8, longestShiftHours: 10.5 } });
    expect(workWeekFromDraft({ ...draft, rateText: "1.5x" })).toEqual({ problem: expect.stringMatching(/1 to 3 times/) });
    expect(workWeekFromDraft({ ...draft, rateText: "4" })).toEqual({ problem: expect.stringMatching(/1 to 3 times/) });
    expect(workWeekFromDraft(draft)).toEqual({ workWeek: { ...LA, dailyOvertimeAfterHours: 8, longestShiftHours: 10.5 } });
    expect(workWeekFromDraft({ ...draft, overtimeText: "" })).toEqual({ workWeek: { ...LA, overtimeAfterHours: 0, dailyOvertimeAfterHours: 8, longestShiftHours: 10.5 } });
    expect(workWeekFromDraft({ ...draft, overtimeText: "40.25" })).toEqual({ problem: expect.stringMatching(/Overtime after/) });
    expect(workWeekFromDraft({ ...draft, dailyText: "x" })).toEqual({ problem: expect.stringMatching(/Daily overtime/) });
    expect(workWeekFromDraft({ ...draft, longestText: "" })).toEqual({ problem: expect.stringMatching(/longest shift/) });
    expect(cleanHalfHours(" 37.5 ", 0, 168)).toBe(37.5);
    expect(cleanHalfHours("37.25", 0, 168)).toBeNull();
    expect(cleanHalfHours("200", 0, 168)).toBeNull();
  });
});
