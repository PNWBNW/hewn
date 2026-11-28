import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { describe, expect, it } from "vitest";
import { concat } from "./bytes";
import { ALG, ML_KEM_1024_CT_BYTES, VERSION, decodeCiphertexts, decodePublicHalf, encodeCiphertexts, encodePublicHalf, isMlKem1024Key, versionOf } from "./format";

const seed = (b: number) => new Uint8Array(64).fill(b);
const ek = ml_kem1024.keygen(seed(7)).publicKey;
// A point's shape (the curve itself is checked in pair_key.ts, with WebCrypto).
const point = concat(new Uint8Array([0x04]), new Uint8Array(64).fill(9));
const part = (alg: number, b: Uint8Array) => concat(new Uint8Array([alg, b.length >> 8, b.length & 0xff]), b);
const raw = (...parts: Uint8Array[]) => concat(new Uint8Array([VERSION, parts.length]), ...parts);

describe("the version 2 format", () => {
  it("writes a public half as version, count and tagged parts, and reads it back", () => {
    const bytes = encodePublicHalf({ p256: point, mlKem1024: ek });
    expect(bytes[0]).toBe(2);
    expect(bytes[1]).toBe(2);
    expect(bytes.length).toBe(2 + 3 + 65 + 3 + 1568);
    expect(bytes).toEqual(raw(part(ALG.P256, point), part(ALG.ML_KEM_1024, ek)));
    const back = decodePublicHalf(bytes);
    expect(back.p256).toEqual(point);
    expect(back.mlKem1024).toEqual(ek);
  });

  it("writes the ciphertexts the same way, one per KEM", () => {
    const c = new Uint8Array(ML_KEM_1024_CT_BYTES).fill(3);
    const bytes = encodeCiphertexts({ mlKem1024: c });
    expect(bytes).toEqual(raw(part(ALG.ML_KEM_1024, c)));
    expect(decodeCiphertexts(bytes).mlKem1024).toEqual(c);
  });

  it("tells a version 1 half (a bare P-256 point) from a version 2 one by its first byte", () => {
    expect(versionOf(point)).toBe(1);
    expect(versionOf(encodePublicHalf({ p256: point, mlKem1024: ek }))).toBe(2);
    expect(() => versionOf(new Uint8Array([3, 1]))).toThrow(/version 3/);
    expect(() => versionOf(new Uint8Array(0))).toThrow(/empty/);
  });

  it("refuses an unknown algorithm id, and the reserved HQC slot, clearly", () => {
    expect(() => decodePublicHalf(raw(part(ALG.P256, point), part(ALG.ML_KEM_1024, ek), part(0x7e, new Uint8Array(4))))).toThrow(/unknown algorithm \(0x7e\)/);
    expect(() => decodePublicHalf(raw(part(ALG.P256, point), part(ALG.ML_KEM_1024, ek), part(ALG.HQC_RESERVED, new Uint8Array(4))))).toThrow(/HQC, which is reserved and not supported yet/);
    expect(() => decodeCiphertexts(raw(part(ALG.ML_KEM_1024, new Uint8Array(1568)), part(ALG.HQC_RESERVED, new Uint8Array(4))))).toThrow(/HQC/);
    // P-256 has no ciphertext: in the ciphertext list it is an unknown part.
    expect(() => decodeCiphertexts(raw(part(ALG.P256, point)))).toThrow(/unknown algorithm/);
  });

  it("refuses the reserved ML-DSA-65 slot by name", () => {
    expect(() => decodePublicHalf(raw(part(ALG.P256, point), part(ALG.ML_KEM_1024, ek), part(ALG.ML_DSA_65_RESERVED, new Uint8Array(4))))).toThrow(/ML-DSA-65, which is reserved/);
  });

  it("refuses repeats, disorder, missing parts, other versions, truncation and leftovers", () => {
    expect(() => decodePublicHalf(raw(part(ALG.ML_KEM_1024, ek), part(ALG.P256, point)))).toThrow(/out of order/);
    expect(() => decodePublicHalf(raw(part(ALG.P256, point), part(ALG.P256, point)))).toThrow(/repeats/);
    expect(() => decodePublicHalf(raw(part(ALG.P256, point)))).toThrow(/lacks its ML-KEM-1024 part/);
    expect(() => decodePublicHalf(raw(part(ALG.ML_KEM_1024, ek)))).toThrow(/lacks its P-256 part/);
    const good = encodePublicHalf({ p256: point, mlKem1024: ek });
    expect(() => decodePublicHalf(concat(new Uint8Array([3]), good.subarray(1)))).toThrow(/version 3, not 2/);
    expect(() => decodePublicHalf(good.subarray(0, good.length - 1))).toThrow(/ends inside/);
    expect(() => decodePublicHalf(concat(good, new Uint8Array([0])))).toThrow(/bytes after/);
    expect(() => decodePublicHalf(new Uint8Array([2, 0]))).toThrow(/0 parts/);
    expect(() => decodePublicHalf(new Uint8Array([2]))).toThrow(/too short/);
  });

  it("refuses parts of the wrong size or shape", () => {
    expect(() => decodePublicHalf(raw(part(ALG.P256, point.subarray(0, 64)), part(ALG.ML_KEM_1024, ek)))).toThrow(/uncompressed point/);
    const compressed = concat(new Uint8Array([0x02]), point.subarray(1));
    expect(() => decodePublicHalf(raw(part(ALG.P256, compressed), part(ALG.ML_KEM_1024, ek)))).toThrow(/uncompressed point/);
    expect(() => decodePublicHalf(raw(part(ALG.P256, point), part(ALG.ML_KEM_1024, ek.subarray(1))))).toThrow(/encapsulation key/);
    expect(() => decodeCiphertexts(raw(part(ALG.ML_KEM_1024, new Uint8Array(1567))))).toThrow(/1,568 bytes/);
    expect(() => encodeCiphertexts({ mlKem1024: new Uint8Array(10) })).toThrow(/1,568 bytes/);
  });

  it("refuses an ML-KEM key with a coefficient not below q (FIPS 203 §7.2)", () => {
    expect(isMlKem1024Key(ek)).toBe(true);
    const bad = new Uint8Array(ek);
    bad[0] = 0xff;
    bad[1] = (bad[1]! & 0xf0) | 0x0f; // first coefficient 4095
    expect(isMlKem1024Key(bad)).toBe(false);
    expect(() => ml_kem1024.encapsulate(bad)).toThrow(); // the library agrees
    expect(() => encodePublicHalf({ p256: point, mlKem1024: bad })).toThrow(/encapsulation key/);
    expect(() => decodePublicHalf(raw(part(ALG.P256, point), part(ALG.ML_KEM_1024, bad)))).toThrow(/encapsulation key/);
  });
});
