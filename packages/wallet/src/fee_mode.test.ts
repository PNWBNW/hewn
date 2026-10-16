import { describe, expect, it } from "vitest";
import { FEE_MODE_KEY, readFeeMode, withFeeMode, writeFeeMode } from "./fee_mode";

const memory = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
};

const broken = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("fee mode", () => {
  it("is public until private is chosen, and back again", () => {
    const s = memory();
    expect(readFeeMode(s)).toBe("public");
    expect(writeFeeMode("private", s)).toBe(true);
    expect(s.m.get(FEE_MODE_KEY)).toBe("private");
    expect(readFeeMode(s)).toBe("private");
    expect(writeFeeMode("public", s)).toBe(true);
    expect(s.m.has(FEE_MODE_KEY)).toBe(false);
    expect(readFeeMode(s)).toBe("public");
  });

  it("reads anything else, a blocked store or no store as public", () => {
    const s = memory();
    s.setItem(FEE_MODE_KEY, "PRIVATE");
    expect(readFeeMode(s)).toBe("public");
    expect(readFeeMode(broken)).toBe("public");
    expect(readFeeMode(null)).toBe("public");
    expect(writeFeeMode("private", broken)).toBe(false);
    expect(writeFeeMode("private", null)).toBe(false);
  });

  it("sets the call's fee to the mode, whatever the call asked for", () => {
    const call = { program: "p.aleo", function: "f", inputs: ["1u8"], privateFee: false };
    expect(withFeeMode(call, "private")).toEqual({ ...call, privateFee: true });
    expect(withFeeMode({ ...call, privateFee: true }, "public")).toEqual({ ...call, privateFee: false });
    expect(call.privateFee).toBe(false); // the original is left alone
  });
});
