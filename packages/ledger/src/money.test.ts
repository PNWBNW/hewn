import { describe, expect, it } from "vitest";
import { formatCents, parseCents, sumCents } from "./money";

describe("money", () => {
  it("parses amounts to whole cents", () => {
    expect(parseCents("12.34")).toBe(1234n);
    expect(parseCents("1,234.5")).toBe(123450n);
    expect(parseCents("$7")).toBe(700n);
    expect(parseCents("-0.05")).toBe(-5n);
    expect(parseCents(" 999999999999999.99 ")).toBe(99999999999999999n);
  });

  it("rejects anything that isn't an exact amount", () => {
    for (const bad of ["", "abc", "1.234", "1e3", "12.3.4", "--1", "1 000", "NaN", "Infinity"]) {
      expect(() => parseCents(bad), bad).toThrow(expect.objectContaining({ code: "BAD_AMOUNT" }));
    }
  });

  it("formats cents back for display", () => {
    expect(formatCents(123450n)).toBe("1,234.50");
    expect(formatCents(-5n)).toBe("-0.05");
    expect(formatCents(0n)).toBe("0.00");
  });

  it("adds without floating-point drift", () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in cents it's exact.
    expect(sumCents([parseCents("0.10"), parseCents("0.20")])).toBe(30n);
    expect(sumCents(Array(1000).fill(1n))).toBe(1000n);
  });
});
