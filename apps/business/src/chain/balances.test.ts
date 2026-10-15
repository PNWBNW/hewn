import { describe, expect, it } from "vitest";
import {
  CREDITS_PROGRAM,
  type MappingRead,
  USDCX_PROGRAM,
  explorerMappingRead,
  formatSixDecimals,
  parseMappingAmount,
  privateCredits,
  privateTokens,
  publicCredits,
  publicTokens,
  totalOf,
} from "./balances";

const OWNER = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsx3wr5q";

const credits = (micro: string, extra: Record<string, unknown> = {}) => ({
  recordName: "credits",
  recordPlaintext: `{ owner: ${OWNER}.private, microcredits: ${micro}u64.private, _nonce: 1group.public }`,
  ...extra,
});
const token = (amount: string, extra: Record<string, unknown> = {}) => ({
  recordName: "Token",
  recordPlaintext: `{ owner: ${OWNER}.private, amount: ${amount}u128.private, _nonce: 2group.public }`,
  ...extra,
});

describe("private balances from the wallet's records", () => {
  it("sums unspent credits and skips spent ones", () => {
    expect(privateCredits([credits("1500000"), credits("250000"), credits("9", { spent: true })])).toBe(1_750_000n);
  });

  it("sums unspent Token records and skips other record kinds", () => {
    expect(privateTokens([token("10000000"), token("5"), { recordName: "ComplianceRecord", recordPlaintext: "{ amount: 99u128 }" }])).toBe(10_000_005n);
  });

  it("ignores shapes it doesn't know", () => {
    expect(privateCredits([null, 7, "x", {}, { recordPlaintext: 3 }, token("4")])).toBe(0n);
    expect(privateTokens([])).toBe(0n);
  });
});

describe("public balances from the explorer", () => {
  it("parses a mapping value and treats a missing entry as null", () => {
    expect(parseMappingAmount("1500000u64", "u64")).toBe(1_500_000n);
    expect(parseMappingAmount('12u128', "u128")).toBe(12n);
    expect(parseMappingAmount(null, "u64")).toBeNull();
  });

  it("refuses a value of the wrong type or shape", () => {
    for (const v of ["12u128", "-1u64", "abc", 12, { value: "1u64" }]) expect(() => parseMappingAmount(v, "u64")).toThrow(/unexpected/);
  });

  it("reads public credits from credits.aleo's account mapping", async () => {
    const seen: string[] = [];
    const read: MappingRead = async (p, m, k) => (seen.push(`${p}/${m}/${k}`), "42u64");
    expect(await publicCredits(OWNER, read)).toBe(42n);
    expect(seen).toEqual([`${CREDITS_PROGRAM}/account/${OWNER}`]);
    expect(await publicCredits(OWNER, async () => null)).toBe(0n);
  });

  it("tries each stablecoin mapping until one has an entry", async () => {
    const tried: string[] = [];
    const read: MappingRead = async (p, m) => {
      tried.push(`${p}/${m}`);
      if (m === "balances") throw new Error("no such mapping");
      return "7000000u128";
    };
    expect(await publicTokens(OWNER, read)).toBe(7_000_000n);
    expect(tried).toEqual([`${USDCX_PROGRAM}/balances`, `${USDCX_PROGRAM}/account`]);
  });

  it("is zero when the mappings answer but hold nothing, and fails when none answers", async () => {
    expect(await publicTokens(OWNER, async () => null)).toBe(0n);
    await expect(
      publicTokens(OWNER, async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow("offline");
  });

  it("asks the explorer for the mapping entry and reads a 404 as no entry", async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return url.includes("/missing/") ? new Response("", { status: 404 }) : new Response('"5u64"', { status: 200 });
    }) as unknown as typeof fetch;
    const read = explorerMappingRead("https://example.test/v2/testnet/", fake);
    expect(await read("credits.aleo", "account", OWNER)).toBe("5u64");
    expect(await read("credits.aleo", "missing", OWNER)).toBeNull();
    expect(urls[0]).toBe(`https://example.test/v2/testnet/program/credits.aleo/mapping/account/${OWNER}`);
    const failing = explorerMappingRead("https://example.test", (async () => new Response("", { status: 500 })) as unknown as typeof fetch);
    await expect(failing("credits.aleo", "account", OWNER)).rejects.toThrow("500");
  });
});

describe("showing a balance", () => {
  it("writes six-decimal units with at least two decimals", () => {
    expect(formatSixDecimals(0n)).toBe("0.00");
    expect(formatSixDecimals(1_500_000n)).toBe("1.50");
    expect(formatSixDecimals(1_234_567_891n)).toBe("1,234.567891");
    expect(formatSixDecimals(10n)).toBe("0.00001");
    expect(formatSixDecimals(-2_000_000n)).toBe("-2.00");
  });

  it("totals a coin only once both parts are read", () => {
    expect(totalOf({ private: 1n, public: 2n })).toBe(3n);
    expect(totalOf({ private: null, public: 2n })).toBeNull();
  });
});
