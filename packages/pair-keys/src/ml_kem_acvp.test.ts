// ML-KEM-1024 against NIST's own vectors (ACVP, FIPS 203), trimmed into fixtures/ml_kem_1024_acvp.json:
// the library this package uses must give NIST's answers before anything is built on it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "@noble/hashes/sha2.js";
import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { describe, expect, it } from "vitest";
import { fromHex, toHex } from "./bytes";
import { isMlKem1024Key } from "./format";

type Vectors = {
  keyGen: { tcId: number; d: string; z: string; ekSha256: string; dkSha256: string }[];
  encapsulation: { tcId: number; ek: string; m: string; cSha256: string; k: string }[];
  decapsulation: { tcId: number; reason: string; dk: string; c: string; k: string }[];
  encapsulationKeyCheck: { tcId: number; reason: string; valid: boolean; ek: string }[];
};
const V: Vectors = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "ml_kem_1024_acvp.json"), "utf8"));
const h = (b: Uint8Array) => toHex(sha256(b));

describe("ML-KEM-1024 against NIST's ACVP vectors", () => {
  it("has the vectors it expects", () => {
    expect(V.keyGen).toHaveLength(25);
    expect(V.encapsulation.length).toBeGreaterThan(0);
    expect(V.decapsulation.some((t) => t.reason === "modified ciphertext")).toBe(true);
    expect(V.encapsulationKeyCheck.some((t) => !t.valid)).toBe(true);
  });

  it("makes NIST's keys from d ‖ z (the seed a half keeps)", () => {
    for (const t of V.keyGen) {
      const { publicKey, secretKey } = ml_kem1024.keygen(fromHex(t.d + t.z, "seed"));
      expect(h(publicKey), `tcId ${t.tcId}`).toBe(t.ekSha256);
      expect(h(secretKey), `tcId ${t.tcId}`).toBe(t.dkSha256);
    }
  });

  it("encapsulates to NIST's answers", () => {
    for (const t of V.encapsulation) {
      const { cipherText, sharedSecret } = ml_kem1024.encapsulate(fromHex(t.ek, "ek"), fromHex(t.m, "m"));
      expect(h(cipherText), `tcId ${t.tcId}`).toBe(t.cSha256);
      expect(toHex(sharedSecret), `tcId ${t.tcId}`).toBe(t.k);
    }
  });

  it("decapsulates to NIST's answers, implicit rejection included", () => {
    for (const t of V.decapsulation) expect(toHex(ml_kem1024.decapsulate(fromHex(t.c, "c"), fromHex(t.dk, "dk"))), `tcId ${t.tcId} (${t.reason})`).toBe(t.k);
  });

  it("checks encapsulation keys as NIST does", () => {
    for (const t of V.encapsulationKeyCheck) {
      const ek = fromHex(t.ek, "ek");
      expect(isMlKem1024Key(ek), `tcId ${t.tcId} (${t.reason})`).toBe(t.valid);
      if (t.valid) expect(() => ml_kem1024.encapsulate(ek)).not.toThrow();
      else expect(() => ml_kem1024.encapsulate(ek)).toThrow();
    }
  });
});
