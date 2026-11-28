// Both sides of a version 2 pair make the same key, with and without the out-of-band secret; the
// answer carries only the responder's P-256 point and the ciphertext; a pending pair key opens one
// answer; and changing any layer or any part of what travels changes the key or is refused.
import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { describe, expect, it } from "vitest";
import { concat, fromHex, toHex } from "./bytes";
import { ALG, KIND, decodeAnswer, decodePublicHalf, encodeAnswer, encodePublicHalf } from "./format";
import { type HalfV2, PendingPairV2, answerPairV2, combine, readPublicHalfV2 } from "./pair_key";

const PARTIES = "ab".repeat(32);
const OOB = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 1);
const KEY = /^[0-9a-f]{64}$/;

/**
 * A pairing: the initiator's pending key, the vault's copy of it, the responder's answer, and
 * `complete`, which opens an answer with a fresh copy restored from the vault's (each pending key
 * opens one answer only), any input changed.
 */
async function pair(outOfBand?: { initiator?: Uint8Array; responder?: Uint8Array }) {
  const pending = await PendingPairV2.create();
  const stored = pending.toStored();
  const answer = await answerPairV2({ partiesKey: PARTIES, half: pending.half, ...(outOfBand?.responder ? { outOfBand: outOfBand.responder } : {}) });
  const complete = async (over: Partial<Parameters<PendingPairV2["complete"]>[0]> = {}) =>
    (await PendingPairV2.restore(stored)).complete({ partiesKey: PARTIES, answer: answer.answer, ...(outOfBand?.initiator ? { outOfBand: outOfBand.initiator } : {}), ...over });
  return { pending, stored, answer, complete };
}

/** Flips one bit of a hex string's byte `at` (from the end when negative). */
const flip = (hex: string, at: number, bit = 0x01): string => {
  const b = fromHex(hex, "hex");
  const i = at < 0 ? b.length + at : at;
  b[i] = b[i]! ^ bit;
  return toHex(b);
};

/** A half or an answer with one more part, and the count raised to match. */
const withPart = (hex: string, alg: number): string => {
  const b = fromHex(hex, "hex");
  b[2] = b[2]! + 1;
  return toHex(concat(b, new Uint8Array([alg, 0, 4, 0, 0, 0, 0])));
};

describe("a version 2 pair key", () => {
  it("makes a pending pair key whose half is the format (the P-256 point and the ML-KEM key), kept in the vault as a JWK and a seed", async () => {
    const pending = await PendingPairV2.create();
    expect(pending.state).toBe("pending");
    const pub = await readPublicHalfV2(pending.half);
    const stored = pending.toStored();
    expect(stored.publicKey).toBe(pending.half);
    expect(pub.p256[0]).toBe(0x04);
    expect(pub.mlKem1024).toEqual(ml_kem1024.keygen(fromHex(stored.privateKey.mlKemSeed, "seed")).publicKey);
    expect(stored.privateKey.p256).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(stored.privateKey.mlKemSeed).toMatch(/^[0-9a-f]{128}$/);
    expect(pending.half.slice(0, 4)).toBe("0201");
    expect(pending.half.length / 2).toBe(1642);
  });

  it("gives both sides the same key, without the out-of-band secret", async () => {
    const { pending, answer } = await pair();
    expect(answer.key).toMatch(KEY);
    expect(await pending.complete({ partiesKey: PARTIES, answer: answer.answer })).toBe(answer.key);
  });

  it("sends back only the responder's P-256 point and one ciphertext per KEM: no key of its own", async () => {
    const { answer } = await pair();
    const bytes = fromHex(answer.answer, "a");
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([2, KIND.ANSWER, 2]);
    const a = decodeAnswer(bytes);
    expect(a.p256[0]).toBe(0x04);
    expect(a.mlKem1024).toHaveLength(1568);
    expect(bytes).toHaveLength(3 + 3 + 65 + 3 + 1568);
    // A fresh P-256 key for each answer: two answers to one half share nothing.
    const { pending } = await pair();
    const [one, two] = [await answerPairV2({ partiesKey: PARTIES, half: pending.half }), await answerPairV2({ partiesKey: PARTIES, half: pending.half })];
    expect(decodeAnswer(fromHex(one.answer, "a")).p256).not.toEqual(decodeAnswer(fromHex(two.answer, "a")).p256);
    expect(one.key).not.toBe(two.key);
  });

  it("gives both sides the same key with it, and a different one from the pair without it", async () => {
    const { answer, complete } = await pair({ initiator: OOB, responder: OOB });
    expect(await complete()).toBe(answer.key);
    expect(await complete({ outOfBand: undefined } as never)).not.toBe(answer.key);
    const other = new Uint8Array(OOB);
    other[31] = other[31]! ^ 1;
    expect(await complete({ outOfBand: other })).not.toBe(answer.key);
    expect(await complete({ outOfBand: concat(OOB, new Uint8Array([5])) })).not.toBe(answer.key);
    // Only the responder used one: a different key, no error.
    const oneSided = await pair({ responder: OOB });
    expect(await oneSided.complete()).not.toBe(oneSided.answer.key);
  });

  it("leaves the caller's out-of-band secret as it was", async () => {
    const mine = new Uint8Array(OOB);
    const { complete } = await pair({ initiator: mine, responder: mine });
    await complete();
    expect(mine).toEqual(OOB);
  });

  it("refuses an out-of-band secret shorter than 32 bytes, or one byte repeated", async () => {
    const { complete, pending } = await pair();
    await expect(complete({ outOfBand: new Uint8Array(31).fill(1) })).rejects.toThrow(/at least 32 bytes/);
    await expect(complete({ outOfBand: new Uint8Array(16).fill(1) })).rejects.toThrow(/at least 32 bytes/);
    await expect(complete({ outOfBand: new Uint8Array(32) })).rejects.toThrow(/one byte repeated/);
    await expect(complete({ outOfBand: new Uint8Array(65).fill(2) })).rejects.toThrow(/at most 64/);
    await expect(answerPairV2({ partiesKey: PARTIES, half: pending.half, outOfBand: new Uint8Array(31).fill(3) })).rejects.toThrow(/at least 32 bytes/);
  });

  it("changes when the ciphertext changes (ML-KEM rejects implicitly: a different secret, so a different key)", async () => {
    const { answer, complete } = await pair();
    expect(await complete({ answer: flip(answer.answer, -1) })).not.toBe(answer.key);
    expect(await complete({ answer: flip(answer.answer, 80) })).not.toBe(answer.key);
  });

  it("changes when the answer's P-256 point changes, and refuses a stored P-256 key that isn't the half's", async () => {
    const { stored, answer, complete } = await pair();
    const elsewhere = decodePublicHalf(fromHex((await PendingPairV2.create()).half, "h")).p256;
    const swapped = toHex(encodeAnswer({ p256: elsewhere, mlKem1024: decodeAnswer(fromHex(answer.answer, "a")).mlKem1024 }));
    expect(await complete({ answer: swapped })).not.toBe(answer.key);
    const other = (await PendingPairV2.create()).toStored();
    const wrongMine: HalfV2 = { ...stored, privateKey: { ...stored.privateKey, p256: other.privateKey.p256 } };
    await expect(PendingPairV2.restore(wrongMine)).rejects.toThrow(/P-256 key doesn't match its half/);
  });

  it("refuses a stored seed that isn't the half's, or a stored copy of another version", async () => {
    const { stored } = await pair();
    await expect(PendingPairV2.restore({ ...stored, privateKey: { ...stored.privateKey, mlKemSeed: "11".repeat(64) } })).rejects.toThrow(/ML-KEM seed doesn't match/);
    await expect(PendingPairV2.restore({ ...stored, privateKey: { ...stored.privateKey, mlKemSeed: "11" } })).rejects.toThrow(/64 bytes of hex/);
    await expect(PendingPairV2.restore({ ...stored, version: 1 } as never)).rejects.toThrow(/another version/);
  });

  it("changes when the responder encapsulated to another ML-KEM key than the initiator's", async () => {
    const { pending, complete } = await pair();
    const i = decodePublicHalf(fromHex(pending.half, "h"));
    const otherKem = ml_kem1024.keygen(new Uint8Array(64).fill(6)).publicKey;
    const forged = toHex(encodePublicHalf({ p256: i.p256, mlKem1024: otherKem }));
    const answer = await answerPairV2({ partiesKey: PARTIES, half: forged });
    expect(await complete({ answer: answer.answer })).not.toBe(answer.key);
  });

  it("changes with the agreement's key (the salt)", async () => {
    const { answer, complete } = await pair();
    expect(await complete({ partiesKey: "cd".repeat(32) })).not.toBe(answer.key);
  });

  it("refuses an answer that carries an encapsulation key: a half where the answer belongs", async () => {
    const { pending, complete } = await pair();
    await expect(complete({ answer: pending.half })).rejects.toThrow(/carries an encapsulation key/);
    const another = (await PendingPairV2.create()).half;
    await expect(complete({ answer: another })).rejects.toThrow(/carries an encapsulation key/);
  });

  it("refuses an answer carrying this side's own P-256 point, or one off the curve, and a half off the curve", async () => {
    const { pending, answer, complete } = await pair();
    const own = decodePublicHalf(fromHex(pending.half, "h")).p256;
    const ct = decodeAnswer(fromHex(answer.answer, "a")).mlKem1024;
    await expect(complete({ answer: toHex(encodeAnswer({ p256: own, mlKem1024: ct })) })).rejects.toThrow(/this side's own P-256 key/);
    const off = new Uint8Array(decodeAnswer(fromHex(answer.answer, "a")).p256);
    off[64] = off[64]! ^ 1;
    await expect(complete({ answer: toHex(encodeAnswer({ p256: off, mlKem1024: ct })) })).rejects.toThrow(/point on the curve/);
    const offOwn = new Uint8Array(own);
    offOwn[64] = offOwn[64]! ^ 1;
    const offHalf = toHex(encodePublicHalf({ p256: offOwn, mlKem1024: decodePublicHalf(fromHex(pending.half, "h")).mlKem1024 }));
    await expect(readPublicHalfV2(offHalf)).rejects.toThrow(/point on the curve/);
    await expect(answerPairV2({ partiesKey: PARTIES, half: offHalf })).rejects.toThrow(/point on the curve/);
  });

  it("refuses a version 1 half, an unknown algorithm, and each reserved id by name, in the half and in the answer", async () => {
    const { pending, answer, complete } = await pair();
    const v1 = toHex(decodePublicHalf(fromHex(pending.half, "h")).p256);
    await expect(answerPairV2({ partiesKey: PARTIES, half: v1 })).rejects.toThrow(/version 1 \(P-256 only\)/);
    await expect(complete({ answer: v1 })).rejects.toThrow(/version 1 half/);
    for (const [alg, named] of [
      [ALG.HQC_RESERVED, /uses HQC, which is reserved and not supported yet/],
      [ALG.ML_DSA_65_RESERVED, /uses ML-DSA-65, which is reserved and not supported yet/],
      [ALG.HQC_FIPS_207_RESERVED, /uses HQC as published in FIPS 207, which is reserved and not supported yet/],
    ] as const) {
      await expect(answerPairV2({ partiesKey: PARTIES, half: withPart(pending.half, alg) })).rejects.toThrow(named);
      await expect(complete({ answer: withPart(answer.answer, alg) })).rejects.toThrow(named);
    }
    await expect(answerPairV2({ partiesKey: PARTIES, half: withPart(pending.half, 0x09) })).rejects.toThrow(/unknown algorithm \(0x09\)/);
    await expect(complete({ answer: withPart(answer.answer, 0x09) })).rejects.toThrow(/unknown algorithm \(0x09\)/);
  });

  it("refuses a malformed agreement key", async () => {
    const { complete } = await pair();
    await expect(complete({ partiesKey: "ab".repeat(31) })).rejects.toThrow(/32 bytes of hex/);
    await expect(complete({ partiesKey: "AB".repeat(32) })).rejects.toThrow(/32 bytes of hex/);
  });

  it("says nothing of a key in its errors", async () => {
    const { pending, complete } = await pair();
    for (const bad of [complete({ answer: pending.half }), complete({ answer: "02" }), complete({ outOfBand: new Uint8Array(3).fill(9) }), pending.complete({ partiesKey: PARTIES, answer: "00" }).catch(() => null).then(() => pending.complete({ partiesKey: PARTIES, answer: "00" }))]) {
      const e = await bad.then(() => null, (x: Error) => x);
      expect(e?.message).toBeTruthy();
      expect(e!.message).not.toMatch(/[0-9a-f]{16}/);
    }
  });
});

describe("one answer per pending pair key", () => {
  it("opens one answer: the same answer again, or a second one, is refused", async () => {
    const { pending, answer } = await pair();
    expect(await pending.complete({ partiesKey: PARTIES, answer: answer.answer })).toBe(answer.key);
    expect(pending.state).toBe("spent");
    await expect(pending.complete({ partiesKey: PARTIES, answer: answer.answer })).rejects.toThrow(/already taken an answer/);
    const second = await answerPairV2({ partiesKey: PARTIES, half: pending.half });
    await expect(pending.complete({ partiesKey: PARTIES, answer: second.answer })).rejects.toThrow(/already taken an answer/);
    expect(() => pending.toStored()).toThrow(/already taken an answer/);
  });

  it("refuses a second answer that arrives while the first is being opened", async () => {
    const { pending, answer } = await pair();
    const second = await answerPairV2({ partiesKey: PARTIES, half: pending.half });
    const [a, b] = await Promise.allSettled([pending.complete({ partiesKey: PARTIES, answer: answer.answer }), pending.complete({ partiesKey: PARTIES, answer: second.answer })]);
    expect(a).toEqual({ status: "fulfilled", value: answer.key });
    expect(b.status).toBe("rejected");
    expect((b as PromiseRejectedResult).reason.message).toMatch(/already taken an answer/);
  });

  it("is spent by an answer it refused, too: the right one afterwards is refused", async () => {
    const { pending, answer } = await pair();
    await expect(pending.complete({ partiesKey: PARTIES, answer: flip(answer.answer, 0) })).rejects.toThrow(/version 3/);
    expect(pending.state).toBe("spent");
    await expect(pending.complete({ partiesKey: PARTIES, answer: answer.answer })).rejects.toThrow(/already taken an answer/);
  });

  it("can be discarded without an answer, after which it opens none", async () => {
    const { pending, answer } = await pair();
    pending.discard();
    expect(pending.state).toBe("discarded");
    await expect(pending.complete({ partiesKey: PARTIES, answer: answer.answer })).rejects.toThrow(/discarded/);
    expect(() => pending.toStored()).toThrow(/discarded/);
    pending.discard();
    expect(pending.state).toBe("discarded");
  });

  it("restores from the vault's copy and gives the same key (the copy is the key ring's to remove)", async () => {
    const { stored, answer } = await pair();
    const restored = await PendingPairV2.restore(stored);
    expect(restored.half).toBe(stored.publicKey);
    expect(restored.toStored()).toEqual(stored);
    expect(await restored.complete({ partiesKey: PARTIES, answer: answer.answer })).toBe(answer.key);
  });
});

describe("what travels", () => {
  // Every header byte, the edges and middle of each part, and a stride through the long ones.
  const positions = (length: number): number[] => {
    const at = new Set<number>([0, 1, 2, 3, 4, 5, 6, 7, 38, 69, 70, 71, 72, 73, 74, 75, length - 33, length - 32, length - 1]);
    for (let i = 76; i < length; i += 61) at.add(i);
    return [...at].sort((a, b) => a - b);
  };
  const outcome = (p: Promise<string>) => p.then((k) => k, () => null);

  it("altering any byte of the initiator's half on its way is refused, or leaves the two sides with different keys", async () => {
    const { pending, stored } = await pair();
    const tried = positions(pending.half.length / 2);
    expect(tried.length).toBeGreaterThan(40);
    const seen = { refused: 0, differed: 0 };
    for (const at of tried) {
      const altered = await answerPairV2({ partiesKey: PARTIES, half: flip(pending.half, at) }).then((a) => a, () => null);
      if (!altered) {
        seen.refused += 1; // refused where it arrived
        continue;
      }
      const initiator = await outcome((await PendingPairV2.restore(stored)).complete({ partiesKey: PARTIES, answer: altered.answer }));
      expect(initiator, `half byte ${at}`).not.toBe(altered.key);
      seen.differed += 1;
    }
    // Both happen: the headers and the point are refused, most of the ML-KEM key still encapsulates.
    expect(seen.refused).toBeGreaterThan(5);
    expect(seen.differed).toBeGreaterThan(5);
  });

  it("altering any byte of the responder's answer on its way is refused, or gives the initiator a different key", async () => {
    const { answer, complete } = await pair({ initiator: OOB, responder: OOB });
    const tried = positions(answer.answer.length / 2);
    const seen = { refused: 0, differed: 0 };
    for (const at of tried) {
      for (const bit of [0x01, 0x80]) {
        const got = await outcome(complete({ answer: flip(answer.answer, at, bit) }));
        expect(got, `answer byte ${at}`).not.toBe(answer.key);
        seen[got === null ? "refused" : "differed"] += 1;
      }
    }
    expect(seen.refused).toBeGreaterThan(5);
    expect(seen.differed).toBeGreaterThan(5);
    expect(await complete()).toBe(answer.key);
  });
});

describe("the combiner", () => {
  const base = () => ({
    partiesKey: new Uint8Array(32).fill(0xab),
    half: new Uint8Array([2, 1, 9, 9]),
    answer: new Uint8Array([2, 2, 8, 8]),
    p256: new Uint8Array(32).fill(1),
    mlKem1024: new Uint8Array(32).fill(2),
  });
  const key = (over: Partial<ReturnType<typeof base>> & { outOfBand?: Uint8Array; version?: number } = {}) => toHex(combine({ ...base(), ...over }));

  it("changes with every layer's secret, the version, either message, the roles' order and whether the third layer is used", () => {
    const k = key();
    const seen = new Set([k]);
    const variants = [
      key({ p256: new Uint8Array(32).fill(3) }),
      key({ mlKem1024: new Uint8Array(32).fill(3) }),
      key({ outOfBand: new Uint8Array(32).fill(4) }),
      key({ outOfBand: new Uint8Array(33).fill(4) }),
      key({ version: 3 }),
      key({ version: 1 }),
      // The two messages trade places.
      key({ half: base().answer, answer: base().half }),
      // Moving a byte from one framed message to the next.
      key({ half: new Uint8Array([2, 1, 9]), answer: new Uint8Array([9, 2, 2, 8, 8]) }),
      key({ half: new Uint8Array([2, 1, 9, 7]) }),
      key({ answer: new Uint8Array([2, 2, 8, 7]) }),
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

  it("keeps the algorithm ids and kinds fixed (an id is never reused)", () => {
    expect(ALG.P256).toBe(1);
    expect(ALG.ML_KEM_1024).toBe(2);
    expect(ALG.HQC_RESERVED).toBe(3);
    expect(ALG.ML_DSA_65_RESERVED).toBe(4);
    expect(ALG.HQC_FIPS_207_RESERVED).toBe(5);
    expect(KIND).toEqual({ HALF: 1, ANSWER: 2 });
  });
});
