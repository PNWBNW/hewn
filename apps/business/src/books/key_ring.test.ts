import { describe, expect, it } from "vitest";
import { type Half, type KeyRing, isTwinSealed, pairId, seedPair } from "./key_ring";

const half = (n: string): Half => ({ publicKey: "04" + n.repeat(128), privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" } });
const AT = "2026-10-23T12:00:00.000Z";

describe("seeding a pair from an agreement's records (employer_agreement_v5)", () => {
  it("starts the conversation under the pair, with both halves, when the ring had nothing", () => {
    const ring = seedPair(undefined, half("1"), half("2").publicKey, AT);
    expect(ring.pairs).toHaveLength(1);
    expect(ring.pairs[0]).toMatchObject({ mine: half("1"), theirs: half("2").publicKey, sent: true, nextIn: 0, nextOut: 0, createdAt: AT });
    expect(ring.out).toBe(pairId(ring.pairs[0]!));
    expect(isTwinSealed(ring)).toBe(true);
  });

  it("changes nothing when seeded again, or with this side's own half, or with a half that isn't one", () => {
    const ring = seedPair(undefined, half("1"), half("2").publicKey, AT);
    expect(seedPair(ring, half("1"), half("2").publicKey, "2026-10-24T00:00:00.000Z")).toEqual(ring);
    expect(seedPair(ring, half("1"), half("1").publicKey, AT)).toEqual(ring);
    expect(seedPair(ring, half("1"), "not-a-key", AT)).toEqual(ring);
  });

  it("fills in the other half on a start of this side's that was still waiting, and keeps a pair that already has another", () => {
    const waiting: KeyRing = { pairs: [{ mine: half("1"), nextIn: 0, nextOut: 0, createdAt: AT }] };
    const filled = seedPair(waiting, half("1"), half("2").publicKey, AT);
    expect(filled.pairs[0]!.theirs).toBe(half("2").publicKey);
    expect(filled.out).toBe(pairId(filled.pairs[0]!));
    // The same start answered by a different half over letters stays as it is.
    expect(seedPair(filled, half("1"), half("3").publicKey, AT)).toEqual(filled);
  });

  it("doesn't move a ring that already writes under a pair", () => {
    const first = seedPair(undefined, half("1"), half("2").publicKey, AT);
    const second = seedPair(first, half("5"), half("6").publicKey, AT);
    expect(second.pairs).toHaveLength(2);
    expect(second.out).toBe(first.out);
  });
});
