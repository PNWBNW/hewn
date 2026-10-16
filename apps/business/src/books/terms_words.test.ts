import { describe, expect, it } from "vitest";
import { cleanHours, employmentLabel, isEmploymentType, validateJobFields } from "./terms_words";

describe("job fields", () => {
  it("writes hours one way, and refuses anything else", () => {
    expect(cleanHours("40")).toBe("40");
    expect(cleanHours(" 37.50 ")).toBe("37.5");
    expect(cleanHours("0.5")).toBe("0.5");
    for (const bad of ["", "0", "169", "-1", "1e2", "40.125", "4 0", "forty"]) expect(cleanHours(bad)).toBeNull();
  });

  it("knows the employment types", () => {
    expect(isEmploymentType("full_time")).toBe(true);
    expect(isEmploymentType("freelance")).toBe(false);
    expect(employmentLabel("contract")).toBe("Contract (fixed term)");
  });

  it("keeps the fields in their order, leaves absent ones absent, and refuses bad ones", () => {
    expect(Object.keys(validateJobFields({ hoursPerWeek: "40", employmentType: "seasonal", other: 1 }))).toEqual(["employmentType", "hoursPerWeek"]);
    expect(validateJobFields({})).toEqual({});
    expect(() => validateJobFields({ employmentType: "gig" })).toThrow(/employment type/);
    // Hours must already be in their one written form, so the terms hash can't vary.
    expect(() => validateJobFields({ hoursPerWeek: "40.0" })).toThrow(/Hours a week/);
    expect(() => validateJobFields({ hoursPerWeek: 40 })).toThrow(/Hours a week/);
  });
});
