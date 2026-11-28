// Both sides of a version 2 pair make the same key, with and without the out-of-band secret, and
// changing any layer or any part of the transcript changes the key or is refused.
import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { describe, expect, it } from "vitest";
import { concat, fromHex, toHex } from "./bytes";
import { ALG, decodeCiphertexts, decodePublicHalf, encodeCiphertexts, encodePublicHalf } from "./format";
import { type HalfV2, answerPairV2, combine, completePairV2, newHalfV2, readPublicHalfV2 } from "./pair_key";

const PARTIES = "ab".repeat(32);
const OOB = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);
const KEY = /^[0-9a-f]{64}$/;

async function pair(outOfBand?: { initiator?: Uint8Array; responder?: Uint8Array }) {
  const initiator = await newHalfV2();
  const responder = await newHalfV2();
  const answer = await answerPairV2({ partiesKey: PARTIES, mine: responder, theirs: initiator.publicKey, ...(outOfBand?.responder ? { outOfBand: outOfBand.responder } : {}) });
  const complete = (over: Partial<Parameters<typeof completePairV2>[0]> = {}) =>
    completePairV2({ partiesKey: PARTIES, mine: initiator, theirs: responder.publicKey, ciphertexts: answer.ciphertexts, ...(outOfBand?.initiator ? { outOfBand: outOfBand.initiator } : {}), ...over });
  return { initiator, responder, answer, complete };
}

/** Flips one bit of a hex string's byte `at` (from the end when negative). */
const flip = (hex: string, at: number): string => {
  const b = fromHex(hex, "hex");
  const i = at < 0 ? b.length + at : at;
  b[i] = b[i]! ^ 0x01;
  return toHex(b);
};

describe("a version 2 pair key", () => {
  it("makes a half whose public part is the format, P-256 point and ML-KEM key, and whose private part is a JWK and a seed", async () => {
    const half = await newHalfV2();
    const pub = await readPublicHalfV2(half.publicKey);
    expect(pub.p256[0]).toBe(0x04);
    expect(pub.mlKem1024).toEqual(ml_kem1024.keygen(fromHex(half.privateKey.mlKemSeed, "seed")).publicKey);
    expect(half.privateKey.p256).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(half.privateKey.mlKemSeed).toMatch(/^[0-9a-f]{128}$/);
    expect(half.publicKey.length / 2).toBe(1641);
  });

  it("gives both sides the same key, without the out-of-band secret", async () => {
    const { answer, complete } = await pair();
    expect(answer.key).toMatch(KEY);
    expect(await complete()).toBe(answer.key);
    // What travels back: one ML-KEM-1024 ciphertext, in the format.
    expect(decodeCiphertexts(fromHex(answer.ciphertexts, "c")).mlKem1024).toHaveLength(1568);
  });

  it("gives both sides the same key with it, and a different one from the pair without it", async () => {
    const { answer, complete } = await pair({ initiator: OOB, responder: OOB });
    expect(await complete()).toBe(answer.key);
    expect(await complete({ outOfBand: undefined } as never)).not.toBe(answer.key);
    const other = new Uint8Array(OOB);
    other[31] = other[31]! ^ 1;
    expect(await complete({ outOfBand: other })).not.toBe(answer.key);
    expect(await complete({ outOfBand: concat(OOB, new Uint8Array([5])) })).not.toBe(answer.key);
  });

  it("leaves the caller's out-of-band secret as it was", async () => {
    const mine = new Uint8Array(OOB);
    await pair({ initiator: mine, responder: mine });
    expect(mine).toEqual(OOB);
  });

  it("refuses an out-of-band secret shorter than 32 bytes, or one byte repeated", async () => {
    const { complete, initiator } = await pair();
    await expect(complete({ outOfBand: new Uint8Array(31).fill(1) })).rejects.toThrow(/at least 32 bytes/);
    await expect(complete({ outOfBand: new Uint8Array(16).fill(1) })).rejects.toThrow(/at least 32 bytes/);
    await expect(complete({ outOfBand: new Uint8Array(32) })).rejects.toThrow(/one byte repeated/);
    await expect(complete({ outOfBand: new Uint8Array(65).fill(2) })).rejects.toThrow(/at most 64/);
    const responder = await newHalfV2();
    await expect(answerPairV2({ partiesKey: PARTIES, mine: responder, theirs: initiator.publicKey, outOfBand: new Uint8Array(31).fill(3) })).rejects.toThrow(/at least 32 bytes/);
  });

  it("changes when the ciphertext changes (ML-KEM rejects implicitly: a different secret, so a different key)", async () => {
    const { answer, complete } = await pair();
    expect(await complete({ ciphertexts: flip(answer.ciphertexts, -1) })).not.toBe(answer.key);
    expect(await complete({ ciphertexts: flip(answer.ciphertexts, 5) })).not.toBe(answer.key);
  });

  it("changes when either P-256 half changes", async () => {
    const { initiator, responder, answer, complete } = await pair();
    const otherResponder = await newHalfV2();
    // The responder's P-256 part swapped for another's, its ML-KEM part kept.
    const r = decodePublicHalf(fromHex(responder.publicKey, "h"));
    const swapped = toHex(encodePublicHalf({ p256: decodePublicHalf(fromHex(otherResponder.publicKey, "h")).p256, mlKem1024: r.mlKem1024 }));
    expect(await complete({ theirs: swapped })).not.toBe(answer.key);
    // The initiator answered with a different P-256 key than the one its half carries: refused.
    const wrongMine: HalfV2 = { ...initiator, privateKey: { ...initiator.privateKey, p256: otherResponder.privateKey.p256 } };
    await expect(complete({ mine: wrongMine })).rejects.toThrow(/P-256 key doesn't match its half/);
  });

  it("changes when the responder's ML-KEM key in the transcript changes, and refuses a seed that isn't the half's", async () => {
    const { initiator, responder, answer, complete } = await pair();
    const r = decodePublicHalf(fromHex(responder.publicKey, "h"));
    const otherKem = ml_kem1024.keygen(new Uint8Array(64).fill(4)).publicKey;
    expect(await complete({ theirs: toHex(encodePublicHalf({ p256: r.p256, mlKem1024: otherKem })) })).not.toBe(answer.key);
    const wrongSeed: HalfV2 = { ...initiator, privateKey: { ...initiator.privateKey, mlKemSeed: "11".repeat(64) } };
    await expect(complete({ mine: wrongSeed })).rejects.toThrow(/ML-KEM seed doesn't match/);
  });

  it("changes when the responder encapsulated to another ML-KEM key than the initiator's", async () => {
    const { initiator, responder, complete } = await pair();
    const i = decodePublicHalf(fromHex(initiator.publicKey, "h"));
    const otherKem = ml_kem1024.keygen(new Uint8Array(64).fill(6)).publicKey;
    const forged = toHex(encodePublicHalf({ p256: i.p256, mlKem1024: otherKem }));
    const answer = await answerPairV2({ partiesKey: PARTIES, mine: responder, theirs: forged });
    expect(await complete({ ciphertexts: answer.ciphertexts })).not.toBe(answer.key);
  });

  it("changes with the agreement's key (the salt)", async () => {
    const { answer, complete } = await pair();
    expect(await complete({ partiesKey: "cd".repeat(32) })).not.toBe(answer.key);
  });

  it("refuses a half that is this side's own, or one off the curve", async () => {
    const { initiator, complete } = await pair();
    await expect(complete({ theirs: initiator.publicKey })).rejects.toThrow(/this side's own/);
    await expect(answerPairV2({ partiesKey: PARTIES, mine: initiator, theirs: initiator.publicKey })).rejects.toThrow(/this side's own/);
    const r = decodePublicHalf(fromHex(initiator.publicKey, "h"));
    const off = new Uint8Array(r.p256);
    off[64] = off[64]! ^ 1;
    const offHalf = toHex(encodePublicHalf({ p256: off, mlKem1024: r.mlKem1024 }));
    await expect(readPublicHalfV2(offHalf)).rejects.toThrow(/point on the curve/);
    const responder = await newHalfV2();
    await expect(answerPairV2({ partiesKey: PARTIES, mine: responder, theirs: offHalf })).rejects.toThrow(/point on the curve/);
  });

  it("refuses a version 1 half, an unknown algorithm or the reserved HQC slot where a version 2 half belongs", async () => {
    const { initiator, complete } = await pair();
    const v1 = toHex(decodePublicHalf(fromHex(initiator.publicKey, "h")).p256);
    await expect(complete({ theirs: v1 })).rejects.toThrow(/version 1 \(P-256 only\)/);
    const withHqc = initiator.publicKey.slice(0, 2) + "03" + initiator.publicKey.slice(4) + "030004" + "00".repeat(4);
    await expect(complete({ theirs: withHqc })).rejects.toThrow(/HQC, which is reserved/);
    const withUnknown = initiator.publicKey.slice(0, 2) + "03" + initiator.publicKey.slice(4) + "090004" + "00".repeat(4);
    await expect(complete({ theirs: withUnknown })).rejects.toThrow(/unknown algorithm \(0x09\)/);
    await expect(complete({ ciphertexts: "02010300010000" })).rejects.toThrow(/HQC/);
  });

  it("refuses a malformed agreement key", async () => {
    const { complete } = await pair();
    await expect(complete({ partiesKey: "ab".repeat(31) })).rejects.toThrow(/32 bytes of hex/);
    await expect(complete({ partiesKey: "AB".repeat(32) })).rejects.toThrow(/32 bytes of hex/);
  });

  it("says nothing of a key in its errors", async () => {
    const { initiator, complete } = await pair();
    for (const bad of [complete({ theirs: initiator.publicKey }), complete({ ciphertexts: "02" }), complete({ outOfBand: new Uint8Array(3).fill(9) })]) {
      const e = await bad.then(() => null, (x: Error) => x);
      expect(e?.message).toBeTruthy();
      expect(e!.message).not.toMatch(/[0-9a-f]{16}/);
    }
  });
});

describe("the combiner", () => {
  const base = () => ({
    partiesKey: new Uint8Array(32).fill(0xab),
    initiator: new Uint8Array([2, 1, 9, 9]),
    responder: new Uint8Array([2, 1, 8, 8]),
    ciphertexts: encodeCiphertexts({ mlKem1024: new Uint8Array(1568).fill(5) }),
    p256: new Uint8Array(32).fill(1),
    mlKem1024: new Uint8Array(32).fill(2),
  });
  const key = (over: Partial<ReturnType<typeof base>> & { outOfBand?: Uint8Array; version?: number } = {}) => toHex(combine({ ...base(), ...over }));

  it("changes with every layer's secret, the version, the roles' order and whether the third layer is used", () => {
    const k = key();
    const seen = new Set([k]);
    const variants = [
      key({ p256: new Uint8Array(32).fill(3) }),
      key({ mlKem1024: new Uint8Array(32).fill(3) }),
      key({ outOfBand: new Uint8Array(32).fill(4) }),
      key({ outOfBand: new Uint8Array(33).fill(4) }),
      key({ version: 3 }),
      key({ version: 1 }),
      // The transcript's order: the two halves trade places.
      key({ initiator: base().responder, responder: base().initiator }),
      // Moving a byte from one framed part to the next.
      key({ initiator: new Uint8Array([2, 1, 9]), responder: new Uint8Array([9, 2, 1, 8, 8]) }),
      key({ ciphertexts: encodeCiphertexts({ mlKem1024: new Uint8Array(1568).fill(6) }) }),
      key({ partiesKey: new Uint8Array(32).fill(0xcd) }),
      // The two KEM secrets trading places.
      key({ p256: new Uint8Array(32).fill(2), mlKem1024: new Uint8Array(32).fill(1) }),
    ];
    for (const v of variants) {
      expect(v).toMatch(KEY);
      expect(seen.has(v)).toBe(false);
      seen.add(v);
    }
  });

  it("refuses a layer secret that isn't 32 bytes", () => {
    expect(() => combine({ ...base(), p256: new Uint8Array(31) })).toThrow(/32 bytes/);
    expect(() => combine({ ...base(), mlKem1024: new Uint8Array(33) })).toThrow(/32 bytes/);
  });

  it("keeps the algorithm ids fixed (an id is never reused)", () => {
    expect(ALG.P256).toBe(1);
    expect(ALG.ML_KEM_1024).toBe(2);
    expect(ALG.HQC_RESERVED).toBe(3);
  });
});
