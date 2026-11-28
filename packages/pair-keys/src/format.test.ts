import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { describe, expect, it } from "vitest";
import { concat } from "./bytes";
import { ALG, KIND, ML_KEM_1024_CT_BYTES, VERSION, decodeAnswer, decodePublicHalf, encodeAnswer, encodePublicHalf, isMlKem1024Key, versionOf } from "./format";

const seed = (b: number) => new Uint8Array(64).fill(b);
const ek = ml_kem1024.keygen(seed(7)).publicKey;
const ct = new Uint8Array(ML_KEM_1024_CT_BYTES).fill(3);
// A point's shape (the curve itself is checked in pair_key.ts, with WebCrypto).
const point = concat(new Uint8Array([0x04]), new Uint8Array(64).fill(9));
const part = (alg: number, b: Uint8Array) => concat(new Uint8Array([alg, b.length >> 8, b.length & 0xff]), b);
const half = (...parts: Uint8Array[]) => concat(new Uint8Array([VERSION, KIND.HALF, parts.length]), ...parts);
const answer = (...parts: Uint8Array[]) => concat(new Uint8Array([VERSION, KIND.ANSWER, parts.length]), ...parts);

const RESERVED = [
  [ALG.HQC_RESERVED, /uses HQC, which is reserved and not supported yet/],
  [ALG.ML_DSA_65_RESERVED, /uses ML-DSA-65, which is reserved and not supported yet/],
  [ALG.HQC_FIPS_207_RESERVED, /uses HQC as published in FIPS 207, which is reserved and not supported yet/],
] as const;

describe("the version 2 format", () => {
  it("writes a half as version, kind, count and tagged parts (the P-256 point, the ML-KEM key), and reads it back", () => {
    const bytes = encodePublicHalf({ p256: point, mlKem1024: ek });
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([2, 1, 2]);
    expect(bytes.length).toBe(3 + 3 + 65 + 3 + 1568);
    expect(bytes).toEqual(half(part(ALG.P256, point), part(ALG.ML_KEM_1024, ek)));
    const back = decodePublicHalf(bytes);
    expect(back.p256).toEqual(point);
    expect(back.mlKem1024).toEqual(ek);
  });

  it("writes an answer the same way, with the responder's P-256 point and one ciphertext per KEM", () => {
    const bytes = encodeAnswer({ p256: point, mlKem1024: ct });
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([2, 2, 2]);
    expect(bytes).toEqual(answer(part(ALG.P256, point), part(ALG.ML_KEM_1024, ct)));
    const back = decodeAnswer(bytes);
    expect(back.p256).toEqual(point);
    expect(back.mlKem1024).toEqual(ct);
  });

  it("refuses an answer that carries an encapsulation key, and a half that carries a ciphertext", () => {
    // The same parts, the same lengths: only the kind tells an encapsulation key from a ciphertext.
    expect(() => decodeAnswer(half(part(ALG.P256, point), part(ALG.ML_KEM_1024, ek)))).toThrow(/The answer carries an encapsulation key/);
    expect(() => decodePublicHalf(answer(part(ALG.P256, point), part(ALG.ML_KEM_1024, ct)))).toThrow(/is an answer/);
    expect(() => decodeAnswer(concat(new Uint8Array([VERSION, 0x07, 1]), part(ALG.P256, point)))).toThrow(/unknown kind \(0x07\)/);
    expect(() => decodeAnswer(point)).toThrow(/version 1 half/);
  });

  it("tells a version 1 half (a bare P-256 point) from a version 2 one by its first byte", () => {
    expect(versionOf(point)).toBe(1);
    expect(versionOf(encodePublicHalf({ p256: point, mlKem1024: ek }))).toBe(2);
    expect(() => versionOf(new Uint8Array([3, 1]))).toThrow(/version 3/);
    expect(() => versionOf(new Uint8Array(0))).toThrow(/empty/);
  });

  it("refuses an unknown algorithm id clearly, in either message", () => {
    expect(() => decodePublicHalf(half(part(ALG.P256, point), part(ALG.ML_KEM_1024, ek), part(0x7e, new Uint8Array(4))))).toThrow(/unknown algorithm \(0x7e\)/);
    expect(() => decodeAnswer(answer(part(ALG.P256, point), part(ALG.ML_KEM_1024, ct), part(0x7e, new Uint8Array(4))))).toThrow(/unknown algorithm \(0x7e\)/);
    expect(() => decodeAnswer(answer(part(0x00, new Uint8Array(4))))).toThrow(/unknown algorithm \(0x00\)/);
  });

  it("refuses each reserved id by name (HQC 0x03, ML-DSA-65 0x04, HQC as published in FIPS 207 0x05), in either message", () => {
    for (const [alg, named] of RESERVED) {
      expect(() => decodePublicHalf(half(part(ALG.P256, point), part(ALG.ML_KEM_1024, ek), part(alg, new Uint8Array(4))))).toThrow(named);
      expect(() => decodeAnswer(answer(part(ALG.P256, point), part(ALG.ML_KEM_1024, ct), part(alg, new Uint8Array(4))))).toThrow(named);
      // First in the list, too: refused by name before anything else is read.
      expect(() => decodeAnswer(answer(part(alg, new Uint8Array(4))))).toThrow(named);
    }
  });

  it("refuses repeats, disorder, missing parts, other versions, truncation and leftovers", () => {
    expect(() => decodePublicHalf(half(part(ALG.ML_KEM_1024, ek), part(ALG.P256, point)))).toThrow(/out of order/);
    expect(() => decodePublicHalf(half(part(ALG.P256, point), part(ALG.P256, point)))).toThrow(/repeats/);
    expect(() => decodePublicHalf(half(part(ALG.P256, point)))).toThrow(/lacks its ML-KEM-1024 part/);
    expect(() => decodePublicHalf(half(part(ALG.ML_KEM_1024, ek)))).toThrow(/lacks its P-256 part/);
    expect(() => decodeAnswer(answer(part(ALG.ML_KEM_1024, ct)))).toThrow(/lacks its P-256 part/);
    expect(() => decodeAnswer(answer(part(ALG.P256, point)))).toThrow(/lacks its ML-KEM-1024 part/);
    expect(() => decodeAnswer(answer(part(ALG.ML_KEM_1024, ct), part(ALG.P256, point)))).toThrow(/out of order/);
    const good = encodePublicHalf({ p256: point, mlKem1024: ek });
    expect(() => decodePublicHalf(concat(new Uint8Array([3]), good.subarray(1)))).toThrow(/version 3, not 2/);
    expect(() => decodePublicHalf(good.subarray(0, good.length - 1))).toThrow(/ends inside/);
    expect(() => decodePublicHalf(concat(good, new Uint8Array([0])))).toThrow(/bytes after/);
    expect(() => decodePublicHalf(new Uint8Array([2, 1, 0]))).toThrow(/0 parts/);
    expect(() => decodePublicHalf(new Uint8Array([2, 1]))).toThrow(/too short/);
    const goodAnswer = encodeAnswer({ p256: point, mlKem1024: ct });
    expect(() => decodeAnswer(goodAnswer.subarray(0, goodAnswer.length - 1))).toThrow(/ends inside/);
    expect(() => decodeAnswer(concat(goodAnswer, new Uint8Array([0])))).toThrow(/bytes after/);
  });

  it("refuses parts of the wrong size or shape", () => {
    expect(() => decodePublicHalf(half(part(ALG.P256, point.subarray(0, 64)), part(ALG.ML_KEM_1024, ek)))).toThrow(/uncompressed point/);
    const compressed = concat(new Uint8Array([0x02]), point.subarray(1));
    expect(() => decodePublicHalf(half(part(ALG.P256, compressed), part(ALG.ML_KEM_1024, ek)))).toThrow(/uncompressed point/);
    expect(() => decodePublicHalf(half(part(ALG.P256, point), part(ALG.ML_KEM_1024, ek.subarray(1))))).toThrow(/encapsulation key/);
    expect(() => decodeAnswer(answer(part(ALG.P256, compressed), part(ALG.ML_KEM_1024, ct)))).toThrow(/uncompressed point/);
    expect(() => decodeAnswer(answer(part(ALG.P256, point), part(ALG.ML_KEM_1024, new Uint8Array(1567))))).toThrow(/1,568 bytes/);
    expect(() => encodeAnswer({ p256: point, mlKem1024: new Uint8Array(10) })).toThrow(/1,568 bytes/);
    expect(() => encodeAnswer({ p256: compressed, mlKem1024: ct })).toThrow(/uncompressed point/);
  });

  it("refuses an ML-KEM key with a coefficient not below q (FIPS 203 §7.2)", () => {
    expect(isMlKem1024Key(ek)).toBe(true);
    const bad = new Uint8Array(ek);
    bad[0] = 0xff;
    bad[1] = (bad[1]! & 0xf0) | 0x0f; // first coefficient 4095
    expect(isMlKem1024Key(bad)).toBe(false);
    expect(() => ml_kem1024.encapsulate(bad)).toThrow(); // the library agrees
    expect(() => encodePublicHalf({ p256: point, mlKem1024: bad })).toThrow(/encapsulation key/);
    expect(() => decodePublicHalf(half(part(ALG.P256, point), part(ALG.ML_KEM_1024, bad)))).toThrow(/encapsulation key/);
  });
});
