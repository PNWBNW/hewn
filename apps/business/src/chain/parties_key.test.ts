import { describe, expect, it } from "vitest";
import { byteArrayHex, partiesKeysOf, readPartiesKeys } from "./parties_key";

const EMPLOYER = "aleo1" + "q".repeat(58);
const WORKER = "aleo1" + "z".repeat(58);
const bytes = (n: number, fill: number) => "[ " + Array.from({ length: n }, () => `${fill}u8`).join(", ") + " ]";

function record(name: string, { agreementFill = 1, keyFill = 9, spent = false, keyBytes = 32 } = {}) {
  return {
    recordName: name,
    spent,
    recordPlaintext: [
      "{",
      `  owner: ${EMPLOYER}.private,`,
      `  agreement_id: ${bytes(32, agreementFill)}.private,`,
      `  parties_key: ${bytes(keyBytes, keyFill)}.private,`,
      "  employer_name_hash: 1field.private,",
      "  worker_name_hash: 2field.private,",
      `  employer_address: ${EMPLOYER}.private,`,
      `  worker_address: ${WORKER}.private,`,
      "  _nonce: 1group.public",
      "}",
    ].join("\n"),
  };
}

describe("parties keys from agreement records", () => {
  it("reads a byte array field as hex, and refuses the wrong length or a non-byte", () => {
    expect(byteArrayHex("x: [ 255u8, 0u8, 16u8 ]", "x")).toBe("ff0010");
    expect(byteArrayHex("x: [ 255u8, 0u8 ]", "x", 2)).toBe("ff00");
    expect(byteArrayHex("x: [ 255u8, 0u8 ]", "x", 32)).toBeNull();
    expect(byteArrayHex("x: [ 256u8 ]", "x")).toBeNull();
    expect(byteArrayHex("x: [ ]", "x")).toBeNull();
    expect(byteArrayHex("y: [ 1u8 ]", "x")).toBeNull();
  });

  it("maps each unspent agreement, pending or final, to its 64-hex key", () => {
    const keys = partiesKeysOf([
      record("FinalAgreement", { agreementFill: 1, keyFill: 9 }),
      record("PendingAgreement", { agreementFill: 2, keyFill: 10 }),
      record("FinalAgreement", { agreementFill: 3, keyFill: 11, spent: true }),
      record("Token", { agreementFill: 4 }),
      record("FinalAgreement", { agreementFill: 5, keyBytes: 16 }),
      { recordName: "FinalAgreement", spent: false },
      null,
      "nope",
    ]);
    expect([...keys.entries()]).toEqual([
      ["01".repeat(32), "09".repeat(32)],
      ["02".repeat(32), "0a".repeat(32)],
    ]);
    expect(keys.get("09".repeat(32))).toBeUndefined();
  });

  it("asks the wallet for the agreement program's records, spent ones included", async () => {
    const calls: [string, boolean | undefined][] = [];
    const keys = await readPartiesKeys(async (program, all) => {
      calls.push([program, all]);
      return [record("FinalAgreement")];
    });
    expect(calls).toEqual([["employer_agreement_v5.aleo", true], ["employer_agreement_v4.aleo", true]]);
    expect(keys.get("01".repeat(32))).toBe("09".repeat(32));
    expect(await readPartiesKeys(async () => "nothing" as unknown as unknown[])).toEqual(new Map());
  });
});
