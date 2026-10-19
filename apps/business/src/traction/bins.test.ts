import { describe, expect, it } from "vitest";
import { BINS, binLabel, binOf } from "./TractionMap";

describe("map bins", () => {
  it("start at the publishing floor and read as ranges", () => {
    expect(binOf(4)).toBe(-1);
    expect(binOf(5)).toBe(0);
    expect(binOf(24)).toBe(1);
    expect(binOf(25)).toBe(2);
    expect(binOf(1000)).toBe(BINS.length - 1);
    expect([0, 1, 2, 3].map(binLabel)).toEqual(["5–9", "10–24", "25–99", "100+"]);
  });
});
