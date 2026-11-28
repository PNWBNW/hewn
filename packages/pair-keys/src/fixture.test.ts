// fixtures/pair_keys_v2.json: fixed inputs and the answers this package gives, for a later port
// (the native client's Rust) to be checked against byte for byte. The test rebuilds every answer
// from the inputs, by the package and again by the construction written out by hand (README.md),
// and fails when either differs. The inputs are test values made for this file, never anyone's
// keys. To make the file again (only when the format changes; the inputs it already holds are kept,
// so only what they give changes):
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
import { type HalfV2, PendingPairV2, answerWith } from "./pair_key";

const FILE = join(__dirname, "..", "fixtures", "pair_keys_v2.json");
const WRITE = process.env.PAIR_KEYS_WRITE_FIXTURE === "1";
const subtle = globalThis.crypto.subtle;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

type P256 = { d: string; x: string; y: string; point: string };
type Initiator = { p256: P256; mlKemSeed: string; publicHalf: string };
type Case = {
  name: string;
  partiesKey: string;
  initiator: Initiator;
  /** The responder keeps no ML-KEM key: its P-256 key, made for this one answer. */
  responder: { p256: P256 };
  encapsulationRandomness: string;
  outOfBand: string | null;
  expected: { p256Shared: string; mlKemShared: string; answer: string; ikm: string; infoSha256: string; pairKey: string };
};
type Fixture = {
  about: string;
  v1: { about: string; partiesKey: string; mine: P256; theirs: string; pairKey: string };
  v2: Case[];
  outOfBand: { bytes: string; words: string; code: string };
};

const stored = (s: Initiator): HalfV2 => ({ version: 2, publicKey: s.publicHalf, privateKey: { p256: { kty: "EC", crv: "P-256", d: s.p256.d, x: s.p256.x, y: s.p256.y }, mlKemSeed: s.mlKemSeed } });
const jwk = (p: P256): JsonWebKey => ({ kty: "EC", crv: "P-256", d: p.d, x: p.x, y: p.y });

async function newP256(): Promise<P256> {
  const k = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const j = await subtle.exportKey("jwk", k.privateKey);
  return { d: j.d!, x: j.x!, y: j.y!, point: toHex(new Uint8Array(await subtle.exportKey("raw", k.publicKey))) };
}

async function ecdh(mine: P256, theirs: string): Promise<Uint8Array> {
  const priv = await subtle.importKey("jwk", jwk(mine), ECDH, false, ["deriveBits"]);
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

const len = (b: Uint8Array) => new Uint8Array([b.length >> 8, b.length & 0xff]);
const part = (alg: number, b: Uint8Array) => concat(new Uint8Array([alg]), len(b), b);

/** The two messages written out by hand from the README: version 2, the kind, two parts. */
const halfByHand = (point: Uint8Array, ek: Uint8Array) => concat(new Uint8Array([0x02, 0x01, 0x02]), part(0x01, point), part(0x02, ek));
const answerByHand = (point: Uint8Array, ct: Uint8Array) => concat(new Uint8Array([0x02, 0x02, 0x02]), part(0x01, point), part(0x02, ct));

/** The version 2 combiner written out by hand from the README, apart from the package's own code. */
function byHand(c: Omit<Case, "expected">, p256: Uint8Array, mlKem: Uint8Array, answer: Uint8Array) {
  const oob = c.outOfBand ? fromHex(c.outOfBand, "oob") : null;
  const ikm = concat(part(0x01, p256), part(0x02, mlKem), ...(oob ? [part(0xff, oob)] : []));
  const half = fromHex(c.initiator.publicHalf, "i");
  const info = concat(new TextEncoder().encode("PNW::PAIR::v2"), new Uint8Array([0x02, oob ? 1 : 0]), len(half), half, len(answer), answer);
  return { ikm: toHex(ikm), infoSha256: toHex(sha256(info)), pairKey: toHex(hkdf(sha256, ikm, fromHex(c.partiesKey, "salt"), info, 32)) };
}

function initiatorOf(p256: P256, mlKemSeed: string): Initiator {
  const ek = ml_kem1024.keygen(fromHex(mlKemSeed, "seed")).publicKey;
  return { p256, mlKemSeed, publicHalf: toHex(encodePublicHalf({ p256: fromHex(p256.point, "point"), mlKem1024: ek })) };
}

async function expectedFor(c: Omit<Case, "expected">): Promise<Case["expected"]> {
  const oob = c.outOfBand ? { outOfBand: fromHex(c.outOfBand, "oob") } : {};
  const made = await answerWith({ partiesKey: c.partiesKey, half: c.initiator.publicHalf, ...oob }, { p256: jwk(c.responder.p256), randomness: fromHex(c.encapsulationRandomness, "m") });
  const i = ml_kem1024.keygen(fromHex(c.initiator.mlKemSeed, "seed"));
  const enc = ml_kem1024.encapsulate(i.publicKey, fromHex(c.encapsulationRandomness, "m"));
  const p256 = await ecdh(c.responder.p256, c.initiator.p256.point);
  const answer = answerByHand(fromHex(c.responder.p256.point, "point"), enc.cipherText);
  expect(made.answer, c.name).toBe(toHex(answer));
  return { p256Shared: toHex(p256), mlKemShared: toHex(enc.sharedSecret), answer: made.answer, ...byHand(c, p256, enc.sharedSecret, answer), pairKey: made.key };
}

/** The file's contents: the inputs already in `previous` where it has them, fresh test values otherwise. */
async function make(previous: Partial<Fixture> | null): Promise<Fixture> {
  const rand = (n: number) => toHex(globalThis.crypto.getRandomValues(new Uint8Array(n)));
  const was = previous?.v2?.[0];
  const initiator = initiatorOf(was?.initiator.p256 ?? (await newP256()), was?.initiator.mlKemSeed ?? rand(64));
  const responder = { p256: was?.responder.p256 ?? (await newP256()) };
  const partiesKey = was?.partiesKey ?? rand(32);
  const m = was?.encapsulationRandomness ?? rand(32);
  const secret = previous?.outOfBand?.bytes ?? rand(32);
  const v2: Case[] = [];
  for (const [name, outOfBand] of [
    ["P-256 and ML-KEM-1024", null],
    ["P-256, ML-KEM-1024 and an out-of-band secret", secret],
  ] as const) {
    const c = { name, partiesKey, initiator, responder, encapsulationRandomness: m, outOfBand };
    v2.push({ ...c, expected: await expectedFor(c) });
  }
  const [v1a, v1b] = previous?.v1 ? [previous.v1.mine, previous.v1.theirs] : [await newP256(), (await newP256()).point];
  return {
    about:
      "Test vectors for @pnw/pair-keys (packages/pair-keys/README.md), made 2026-11-28 with random test values that are nobody's keys. Hex lower case; P-256 private parts as WebCrypto's JWK (base64url d, x, y). v1 is the P-256-only pair key the app makes today (apps/business/src/chain/key_ring.ts). v2: the initiator's half (`publicHalf`: version 0x02, kind 0x01, its P-256 point and ML-KEM-1024 encapsulation key) goes out with the start; the responder, with a P-256 key made for this answer alone, encapsulates to it with `encapsulationRandomness` as FIPS 203's m and sends back its answer (`expected.answer`: version 0x02, kind 0x02, its P-256 point and the ciphertext; no key of its own). `expected` gives each layer's shared secret, the answer as it travels, the combiner's input (ikm), the SHA-256 of its info (both messages whole, the half first), and the pair key both sides make.",
    v1: { about: "key = HKDF-SHA256(ECDH(mine, theirs), salt = partiesKey, info = 'PNW::PAIR::v1' ‖ the two points, lower hex first)", partiesKey: previous?.v1?.partiesKey ?? partiesKey, mine: v1a, theirs: v1b, pairKey: await v1Key(previous?.v1?.partiesKey ?? partiesKey, v1a, v1b) },
    v2,
    outOfBand: { bytes: secret, words: outOfBandToWords(fromHex(secret, "s")), code: outOfBandToCode(fromHex(secret, "s")) },
  };
}

describe("the fixture for a later port", () => {
  it.runIf(WRITE)("is written", async () => {
    const previous = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as Partial<Fixture>) : null;
    writeFileSync(FILE, `${JSON.stringify(await make(previous), null, 1)}\n`);
  });

  it("gives the package's answers, and the hand-written construction's, from its inputs", async () => {
    expect(existsSync(FILE)).toBe(true);
    const f: Fixture = JSON.parse(readFileSync(FILE, "utf8"));
    expect(f.v2).toHaveLength(2);
    for (const c of f.v2) {
      const ek = ml_kem1024.keygen(fromHex(c.initiator.mlKemSeed, "seed")).publicKey;
      expect(toHex(halfByHand(fromHex(c.initiator.p256.point, "p"), ek))).toBe(c.initiator.publicHalf);
      expect(Object.keys(c.responder)).toEqual(["p256"]);
      for (const p of [c.initiator.p256, c.responder.p256]) {
        expect(p.point).toBe(`04${toHex(unb64(p.x))}${toHex(unb64(p.y))}`);
        expect(b64url(fromHex(p.point, "p").subarray(1, 33))).toBe(p.x);
      }
      const { expected, ...inputs } = c;
      expect(await expectedFor(inputs), c.name).toEqual(expected);
      const oob = c.outOfBand ? { outOfBand: fromHex(c.outOfBand, "oob") } : {};
      const pending = await PendingPairV2.restore(stored(c.initiator));
      expect(pending.half).toBe(c.initiator.publicHalf);
      expect(await pending.complete({ partiesKey: c.partiesKey, answer: expected.answer, ...oob }), c.name).toBe(expected.pairKey);
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
