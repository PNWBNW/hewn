import { describe, expect, it } from "vitest";
import { arrayFieldHex, byteWords, packedWords } from "./packed";

const ID = "00112233445566778899aabbccddeeff" + "ffeeddccbbaa99887766554433221100";

describe("packed bytes, as employer_agreement_v5 carries them", () => {
  it("pack 32 bytes as two u128 words, the high word first, and 64 as four", () => {
    expect(packedWords(ID, 2)).toBe(`[${BigInt("0x00112233445566778899aabbccddeeff")}u128, ${BigInt("0xffeeddccbbaa99887766554433221100")}u128]`);
    expect(packedWords(`0x${ID}`, 2)).toBe(packedWords(ID, 2));
    expect(packedWords(ID + ID, 4).match(/u128/g)).toHaveLength(4);
    expect(packedWords("00".repeat(32), 2)).toBe("[0u128, 0u128]");
    expect(() => packedWords(ID, 4)).toThrow(/64 bytes/);
    expect(() => packedWords("zz".repeat(32), 2)).toThrow();
  });

  it("read a packed field back to the same hex, and a byte array too", () => {
    const packed = `{\n  agreement_id: ${packedWords(ID, 2)}.private,\n  half: ${packedWords(ID + ID, 4)}.private\n}`;
    expect(arrayFieldHex(packed, "agreement_id")).toBe(ID);
    expect(arrayFieldHex(packed, "agreement_id", 32)).toBe(ID);
    expect(arrayFieldHex(packed, "agreement_id", 64)).toBeNull();
    expect(arrayFieldHex(packed, "half", 64)).toBe(ID + ID);
    expect(arrayFieldHex(packed, "missing")).toBeNull();
    const bytes = `{\n  agreement_id: ${byteWords(ID)}.private\n}`;
    expect(byteWords(ID).match(/u8\b/g)).toHaveLength(32);
    expect(arrayFieldHex(bytes, "agreement_id", 32)).toBe(ID);
    expect(arrayFieldHex("x: [ 255u8, 0u8, 16u8 ]", "x")).toBe("ff0010");
    expect(arrayFieldHex("x: [ 256u8 ]", "x")).toBeNull();
    expect(arrayFieldHex(`x: [${(1n << 128n).toString()}u128, 0u128]`, "x")).toBeNull();
    expect(arrayFieldHex("x: [ ]", "x")).toBeNull();
  });
});
