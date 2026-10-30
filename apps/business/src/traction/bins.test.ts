import { describe, expect, it } from "vitest";
import { BINS, binLabel, binOf } from "./TractionMap";

describe("map bins", () => {
  it("start at one visitor, the testnet floor, and read as ranges", () => {
    expect(binOf(0)).toBe(-1);
    expect(binOf(1)).toBe(0);
    expect(binOf(2)).toBe(1);
    expect(binOf(4)).toBe(1);
    expect(binOf(5)).toBe(2);
    expect(binOf(44)).toBe(4);
    expect(binOf(50)).toBe(5);
    expect(binOf(1000)).toBe(BINS.length - 1);
    expect(BINS.map((_, i) => binLabel(i))).toEqual(["1", "2–4", "5–9", "10–24", "25–49", "50–99", "100+"]);
  });
});
