// fixtures/pair_keys_v2.json: fixed inputs and the answers this package gives, for a later port
// (the native client's Rust) to be checked against byte for byte. The test rebuilds every answer
// from the inputs, by the package and again by the construction written out by hand (README.md),
// and fails when either differs. The inputs are test values made for this file, never anyone's
// keys. To make the file again (only when the format changes, as a new version):
//
//   PAIR_KEYS_WRITE_FIXTURE=1 pnpm vitest run --project pair-keys fixture
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { describe, expect, it } from "vitest";
import { concat, fromHex, toHex } from "./bytes";
import { encodePublicHalf } from "./format";
import { outOfBandFromCode, outOfBandFromWords, outOfBandToCode, outOfBandToWords } from "./out_of_band";
import { type HalfV2, answerWith, completePairV2 } from "./pair_key";

const FILE = join(__dirname, "..", "fixtures", "pair_keys_v2.json");
const WRITE = process.env.PAIR_KEYS_WRITE_FIXTURE === "1";
const subtle = globalThis.crypto.subtle;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

type P256 = { d: string; x: string; y: string; point: string };
type Side = { p256: P256; mlKemSeed: string; publicHalf: string };
type Case = {
  name: string;
  partiesKey: string;
  initiator: Side;
  responder: Side;
  encapsulationRandomness: string;
  outOfBand: string | null;
  expected: { p256Shared: string; mlKemShared: string; ciphertexts: string; ikm: string; infoSha256: string; pairKey: string };
};
type Fixture = {
  about: string;
  v1: { about: string; partiesKey: string; mine: P256; theirs: string; pairKey: string };
  v2: Case[];
  outOfBand: { bytes: string; words: string; code: string };
};

const half = (s: Side): HalfV2 => ({ version: 2, publicKey: s.publicHalf, privateKey: { p256: { kty: "EC", crv: "P-256", d: s.p256.d, x: s.p256.x, y: s.p256.y }, mlKemSeed: s.mlKemSeed } });

async function newP256(): Promise<P256> {
  const k = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const jwk = await subtle.exportKey("jwk", k.privateKey);
  return { d: jwk.d!, x: jwk.x!, y: jwk.y!, point: toHex(new Uint8Array(await subtle.exportKey("raw", k.publicKey))) };
}

async function ecdh(mine: P256, theirs: string): Promise<Uint8Array> {
  const priv = await subtle.importKey("jwk", { kty: "EC", crv: "P-256", d: mine.d, x: mine.x, y: mine.y }, ECDH, false, ["deriveBits"]);
  const pub = await subtle.importKey("raw", fromHex(theirs, "point"), ECDH, false, []);
  return new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256));
}

/** Version 1, as `apps/business/src/chain/key_ring.ts` makes it: the halves sorted, the parties key as salt. */
async function v1Key(partiesKey: string, mine: P256, theirs: string): Promise<string> {
  const shared = await ecdh(mine, theirs);
  const [lo, hi] = [mine.point, theirs].sort();
  const info = concat(new TextEncoder().encode("PNW::PAIR::v1"), fromHex(lo!, "lo"), fromHex(hi!, "hi"));
  return toHex(hkdf(sha256, shared, fromHex(partiesKey, "salt"), info, 32));
}

/** The version 2 construction written out by hand from the README, apart from the package's own code. */
function byHand(c: Omit<Case, "expected">, p256: Uint8Array, mlKem: Uint8Array, ciphertexts: Uint8Array) {
  const oob = c.outOfBand ? fromHex(c.outOfBand, "oob") : null;
  const len = (b: Uint8Array) => new Uint8Array([b.length >> 8, b.length & 0xff]);
  const ikm = concat(new Uint8Array([0x01]), len(p256), p256, new Uint8Array([0x02]), len(mlKem), mlKem, ...(oob ? [new Uint8Array([0xff]), len(oob), oob] : []));
  const i = fromHex(c.initiator.publicHalf, "i");
  const r = fromHex(c.responder.publicHalf, "r");
  const info = concat(new TextEncoder().encode("PNW::PAIR::v2"), new Uint8Array([0x02, oob ? 1 : 0]), len(i), i, len(r), r, len(ciphertexts), ciphertexts);
  return { ikm: toHex(ikm), infoSha256: toHex(sha256(info)), pairKey: toHex(hkdf(sha256, ikm, fromHex(c.partiesKey, "salt"), info, 32)) };
}

async function newSide(): Promise<Side> {
  const p256 = await newP256();
  const mlKemSeed = toHex(globalThis.crypto.getRandomValues(new Uint8Array(64)));
  const ek = ml_kem1024.keygen(fromHex(mlKemSeed, "seed")).publicKey;
  return { p256, mlKemSeed, publicHalf: toHex(encodePublicHalf({ p256: fromHex(p256.point, "point"), mlKem1024: ek })) };
}

async function expectedFor(c: Omit<Case, "expected">): Promise<Case["expected"]> {
  const answer = await answerWith({ partiesKey: c.partiesKey, mine: half(c.responder), theirs: c.initiator.publicHalf, ...(c.outOfBand ? { outOfBand: fromHex(c.outOfBand, "oob") } : {}) }, fromHex(c.encapsulationRandomness, "m"));
  const i = ml_kem1024.keygen(fromHex(c.initiator.mlKemSeed, "seed"));
  const enc = ml_kem1024.encapsulate(i.publicKey, fromHex(c.encapsulationRandomness, "m"));
  const p256 = await ecdh(c.responder.p256, c.initiator.p256.point);
  return { p256Shared: toHex(p256), mlKemShared: toHex(enc.sharedSecret), ciphertexts: answer.ciphertexts, ...byHand(c, p256, enc.sharedSecret, fromHex(answer.ciphertexts, "c")), pairKey: answer.key };
}

async function make(): Promise<Fixture> {
  const rand = (n: number) => toHex(globalThis.crypto.getRandomValues(new Uint8Array(n)));
  const [initiator, responder, v1a, v1b] = [await newSide(), await newSide(), await newP256(), await newP256()];
  const partiesKey = rand(32);
  const m = rand(32);
  const secret = rand(32);
  const v2: Case[] = [];
  for (const [name, outOfBand] of [
    ["P-256 and ML-KEM-1024", null],
    ["P-256, ML-KEM-1024 and an out-of-band secret", secret],
  ] as const) {
    const c = { name, partiesKey, initiator, responder, encapsulationRandomness: m, outOfBand };
    v2.push({ ...c, expected: await expectedFor(c) });
  }
  return {
    about:
      "Test vectors for @pnw/pair-keys (packages/pair-keys/README.md), made 2026-11-28 with random test values that are nobody's keys. Hex lower case; P-256 private parts as WebCrypto's JWK (base64url d, x, y). v1 is the P-256-only pair key the app makes today (apps/business/src/chain/key_ring.ts). v2: the responder encapsulates to the initiator's ML-KEM-1024 key with `encapsulationRandomness` as FIPS 203's m; `expected` gives each layer's shared secret, the ciphertexts as they travel, the combiner's input (ikm), the SHA-256 of its info, and the pair key both sides make.",
    v1: { about: "key = HKDF-SHA256(ECDH(mine, theirs), salt = partiesKey, info = 'PNW::PAIR::v1' ‖ the two points, lower hex first)", partiesKey, mine: v1a, theirs: v1b.point, pairKey: await v1Key(partiesKey, v1a, v1b.point) },
    v2,
    outOfBand: { bytes: secret, words: outOfBandToWords(fromHex(secret, "s")), code: outOfBandToCode(fromHex(secret, "s")) },
  };
}

describe("the fixture for a later port", () => {
  it.runIf(WRITE)("is written", async () => {
    writeFileSync(FILE, `${JSON.stringify(await make(), null, 1)}\n`);
  });

  it("gives the package's answers, and the hand-written construction's, from its inputs", async () => {
    expect(existsSync(FILE)).toBe(true);
    const f: Fixture = JSON.parse(readFileSync(FILE, "utf8"));
    expect(f.v2).toHaveLength(2);
    for (const c of f.v2) {
      for (const s of [c.initiator, c.responder]) {
        const ek = ml_kem1024.keygen(fromHex(s.mlKemSeed, "seed")).publicKey;
        expect(toHex(encodePublicHalf({ p256: fromHex(s.p256.point, "p"), mlKem1024: ek }))).toBe(s.publicHalf);
        expect(s.p256.point).toBe(`04${toHex(unb64(s.p256.x))}${toHex(unb64(s.p256.y))}`);
        expect(b64url(fromHex(s.p256.point, "p").subarray(1, 33))).toBe(s.p256.x);
      }
      const { expected, ...inputs } = c;
      expect(await expectedFor(inputs), c.name).toEqual(expected);
      const oob = c.outOfBand ? { outOfBand: fromHex(c.outOfBand, "oob") } : {};
      expect(await completePairV2({ partiesKey: c.partiesKey, mine: half(c.initiator), theirs: c.responder.publicHalf, ciphertexts: expected.ciphertexts, ...oob }), c.name).toBe(expected.pairKey);
    }
    expect(f.v2[0]!.expected.pairKey).not.toBe(f.v2[1]!.expected.pairKey);
    expect(await v1Key(f.v1.partiesKey, f.v1.mine, f.v1.theirs)).toBe(f.v1.pairKey);
    expect(outOfBandToWords(fromHex(f.outOfBand.bytes, "s"))).toBe(f.outOfBand.words);
    expect(outOfBandToCode(fromHex(f.outOfBand.bytes, "s"))).toBe(f.outOfBand.code);
    expect(toHex(outOfBandFromWords(f.outOfBand.words))).toBe(f.outOfBand.bytes);
    expect(toHex(outOfBandFromCode(f.outOfBand.code))).toBe(f.outOfBand.bytes);
    expect(f.v2[1]!.outOfBand).toBe(f.outOfBand.bytes);
  });
});
