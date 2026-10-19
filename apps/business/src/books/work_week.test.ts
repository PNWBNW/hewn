import { describe, expect, it } from "vitest";
import {
  WORK_WEEK_KEYS,
  cleanHalfHours,
  defaultWorkWeek,
  draftOfWorkWeek,
  isTimeZone,
  validateWorkWeek,
  weekEndsOn,
  workWeekFromDraft,
  workWeekLines,
  workWeekSummary,
} from "./work_week";

const LA = defaultWorkWeek("America/Los_Angeles");

describe("a work week", () => {
  it("starts from Monday to Sunday, overtime after 40, shifts up to 12", () => {
    expect(LA).toEqual({ startsOn: "monday", timeZone: "America/Los_Angeles", overtimeAfterHours: 40, dailyOvertimeAfterHours: 0, longestShiftHours: 12 });
    expect(Object.keys(LA)).toEqual([...WORK_WEEK_KEYS]);
    expect(defaultWorkWeek().timeZone).toBeTruthy();
  });

  it("comes back clean, keys in the contract's order, whatever order it was built in", () => {
    const shuffled = { longestShiftHours: 10, dailyOvertimeAfterHours: 8, overtimeAfterHours: 40, timeZone: "America/New_York", startsOn: "sunday", extra: 1 };
    const w = validateWorkWeek(shuffled);
    expect(Object.keys(w)).toEqual([...WORK_WEEK_KEYS]);
    expect(w).toEqual({ startsOn: "sunday", timeZone: "America/New_York", overtimeAfterHours: 40, dailyOvertimeAfterHours: 8, longestShiftHours: 10 });
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
      "Work week: Monday to Sunday, Pacific Time (America/Los_Angeles).",
      "Overtime: after 40 hours in a week.",
      "Shifts: a shift longer than 12 hours is reviewed before it is paid.",
    ]);
    expect(workWeekLines({ ...LA, startsOn: "sunday", dailyOvertimeAfterHours: 8, longestShiftHours: 10.5 })).toEqual([
      "Work week: Sunday to Saturday, Pacific Time (America/Los_Angeles).",
      "Overtime: after 8 hours in a day or 40 hours in a week.",
      "Shifts: a shift longer than 10.5 hours is reviewed before it is paid.",
    ]);
    expect(workWeekLines({ ...LA, overtimeAfterHours: 0 })[1]).toBe("Overtime: none.");
    expect(workWeekLines({ ...LA, overtimeAfterHours: 0, dailyOvertimeAfterHours: 8 })[1]).toBe("Overtime: after 8 hours in a day.");
    expect(workWeekSummary(LA)).toBe("Monday to Sunday · overtime after 40 hours a week · shifts up to 12 hours");
    expect(workWeekSummary({ ...LA, overtimeAfterHours: 0 })).toContain("no overtime");
    expect(weekEndsOn("monday")).toBe("sunday");
    expect(weekEndsOn("sunday")).toBe("saturday");
    expect(weekEndsOn("wednesday")).toBe("tuesday");
  });

  it("round-trips through the form and names what's wrong", () => {
    const draft = draftOfWorkWeek({ ...LA, dailyOvertimeAfterHours: 8, longestShiftHours: 10.5 });
    expect(draft).toEqual({ startsOn: "monday", timeZone: "America/Los_Angeles", overtimeText: "40", dailyText: "8", longestText: "10.5" });
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
