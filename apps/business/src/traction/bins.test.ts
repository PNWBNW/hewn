import { describe, expect, it } from "vitest";
import { BINS, binLabel, binOf } from "./TractionMap";

describe("map bins", () => {
  it("start at one visitor, the testnet floor, and read as ranges", () => {
    expect(binOf(0)).toBe(-1);
    expect(binOf(1)).toBe(0);
    expect(binOf(4)).toBe(0);
    expect(binOf(5)).toBe(1);
    expect(binOf(25)).toBe(2);
    expect(binOf(1000)).toBe(BINS.length - 1);
    expect([0, 1, 2, 3].map(binLabel)).toEqual(["1–4", "5–24", "25–99", "100+"]);
  });
});
