import { describe, expect, it } from "vitest";
import { centsToMinor, formatMinorAsDollars, parseTokenPlaintext, parseTokenRecords, totalBalance } from "./records";

const plaintext = (amount: string, owner = "aleo1abc") => `{\n  owner: ${owner}.private,\n  amount: ${amount}u128.private,\n  _nonce: 123group.public\n}`;

describe("Token records", () => {
  it("reads the amount out of a record plaintext", () => {
    expect(parseTokenPlaintext(plaintext("1500000"))).toEqual({ plaintext: plaintext("1500000"), amount: 1_500_000n });
    expect(parseTokenPlaintext("{ owner: aleo1abc.private, microcredits: 5u64.private }")).toBeNull();
  });

  it("keeps unspent Token records with plaintext and skips the rest", () => {
    const raw = [
      { recordName: "Token", spent: false, recordPlaintext: plaintext("10") },
      { recordName: "Token", spent: true, recordPlaintext: plaintext("20") },
      { recordName: "Other", spent: false, recordPlaintext: plaintext("30") },
      { recordName: "Token", spent: false }, // no plaintext: the wallet didn't decrypt it
      { spent: false, recordPlaintext: plaintext("40") }, // no name given: trust the shape
      null,
      "junk",
    ];
    expect(parseTokenRecords(raw).map((r) => r.amount)).toEqual([10n, 40n]);
    expect(totalBalance(parseTokenRecords(raw))).toBe(50n);
  });

  it("converts cents to minor units and formats minor units as dollars", () => {
    expect(centsToMinor(104_805n)).toBe(1_048_050_000n);
    expect(formatMinorAsDollars(1_048_050_000n)).toBe("1,048.05");
    expect(formatMinorAsDollars(0n)).toBe("0.00");
    expect(formatMinorAsDollars(9_999n)).toBe("0.00"); // below a cent
  });
});
