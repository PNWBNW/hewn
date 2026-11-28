// The secret bytes a pairing uses are zeroed once it is done, where a test can see them: ML-KEM is
// wrapped so every seed, decapsulation key and shared secret it is given or gives back is kept, and
// WebCrypto's ECDH so every secret it hands back is; each must be all zeros once a pending pair key
// completes (or fails to, or is discarded) and once an answer is made. Strings (the key's hex, the
// vault's copy) and the engines' own copies can't be zeroed, and aren't checked (README.md).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingPairV2, answerPairV2 } from "./pair_key";

const seen = vi.hoisted(() => ({ seeds: [] as Uint8Array[], secretKeys: [] as Uint8Array[], shared: [] as Uint8Array[], ecdh: [] as ArrayBuffer[] }));

vi.mock("@noble/post-quantum/ml-kem.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("@noble/post-quantum/ml-kem.js")>();
  const k = real.ml_kem1024;
  return {
    ...real,
    ml_kem1024: {
      ...k,
      keygen: (seed?: Uint8Array) => {
        const out = k.keygen(seed);
        if (seed) seen.seeds.push(seed);
        seen.secretKeys.push(out.secretKey);
        return out;
      },
      encapsulate: (ek: Uint8Array, m?: Uint8Array) => {
        const out = k.encapsulate(ek, m);
        seen.shared.push(out.sharedSecret);
        return out;
      },
      decapsulate: (c: Uint8Array, dk: Uint8Array) => {
        const out = k.decapsulate(c, dk);
        seen.shared.push(out);
        return out;
      },
    },
  };
});

const PARTIES = "ab".repeat(32);
const OOB = Uint8Array.from({ length: 32 }, (_, i) => i * 5 + 3);
const zero = (b: Uint8Array | ArrayBuffer) => new Uint8Array(b).every((x) => x === 0);
const all = () => [...seen.seeds, ...seen.secretKeys, ...seen.shared, ...seen.ecdh];
const clear = () => {
  for (const list of Object.values(seen)) list.length = 0;
};

beforeEach(() => {
  clear();
  const subtle = globalThis.crypto.subtle;
  const derive = subtle.deriveBits.bind(subtle);
  vi.spyOn(subtle, "deriveBits").mockImplementation(async (...args: Parameters<SubtleCrypto["deriveBits"]>) => {
    const out = await derive(...args);
    seen.ecdh.push(out);
    return out;
  });
});
afterEach(() => vi.restoreAllMocks());

describe("secret bytes, once a pairing is done", () => {
  it("are zeroed on both sides once the initiator completes (with the out-of-band secret)", async () => {
    const pending = await PendingPairV2.create();
    const [seed] = seen.seeds;
    expect(seed && !zero(seed)).toBe(true); // the pending key holds its seed until the answer
    const { answer, key } = await answerPairV2({ partiesKey: PARTIES, half: pending.half, outOfBand: OOB });
    expect(seen.ecdh).toHaveLength(1);
    expect(seen.shared).toHaveLength(1);
    expect(await pending.complete({ partiesKey: PARTIES, answer, outOfBand: OOB })).toBe(key);
    expect(seen.ecdh).toHaveLength(2);
    expect(seen.shared).toHaveLength(2); // the encapsulation's and the decapsulation's
    expect(seen.secretKeys.length).toBeGreaterThanOrEqual(2);
    for (const b of all()) expect(zero(b)).toBe(true);
  });

  it("are zeroed when the answer is refused, and when the pending key is restored from the vault first", async () => {
    const stored = (await PendingPairV2.create()).toStored();
    clear();
    const restored = await PendingPairV2.restore(stored);
    expect(seen.seeds).toHaveLength(1);
    expect(zero(seen.seeds[0]!)).toBe(false);
    await expect(restored.complete({ partiesKey: PARTIES, answer: restored.half })).rejects.toThrow(/carries an encapsulation key/);
    for (const b of all()) expect(zero(b)).toBe(true);
  });

  it("are zeroed when a pending key is discarded unanswered", async () => {
    const pending = await PendingPairV2.create();
    pending.discard();
    expect(seen.seeds).toHaveLength(1);
    for (const b of all()) expect(zero(b)).toBe(true);
  });

  it("are zeroed on the responder's side when it answers", async () => {
    const pending = await PendingPairV2.create();
    clear();
    await answerPairV2({ partiesKey: PARTIES, half: pending.half });
    expect(seen.ecdh).toHaveLength(1);
    expect(seen.shared).toHaveLength(1);
    for (const b of all()) expect(zero(b)).toBe(true);
    pending.discard();
  });
});
