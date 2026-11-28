// ---------------------------------------------------------------------------
// A pair's key, version 2: three layers, each of which an attacker must break.
//
//   1. P-256 ECDH, as in version 1 (secure against today's computers);
//   2. ML-KEM-1024 (FIPS 203), designed to hold against a quantum computer;
//   3. an out-of-band secret (optional, at least 32 bytes) the two people
//      exchanged outside this app and the chain (`out_of_band.ts`).
//
// Who sends what. The side that starts (the initiator) makes a pending pair
// key, `PendingPairV2`: a P-256 key and an ML-KEM-1024 key pair. Its half (the
// P-256 point and the encapsulation key) goes out with the start. The side that
// answers (the responder) makes a fresh P-256 key for this answer alone,
// encapsulates to the initiator's ML-KEM key, and sends back its answer: its
// P-256 point and the ciphertext, nothing else (it never decapsulates, so it
// has no KEM key to send). The handshake stays two messages, as in version 1.
//
// One answer per pending key. Completing a pairing spends the pending keys:
// the first `complete` uses them and zeroes them, whatever its outcome, and any
// later call (a second answer, or the same one again) is refused. Attacks that
// recover an ML-KEM private key from how it handles ciphertexts (decapsulation
// failures, plaintext-checking oracles through a side channel or a flawed
// check) need many chosen ciphertexts under one key; a key that opens one
// ciphertext gives them one. The README has the detail. The object enforces
// this in memory; the copy the vault keeps (`stored`) must be removed in the
// same write that keeps the pair's key, or a restore could open a second one.
//
// The combiner, HKDF-SHA256 (RFC 5869), as in version 1:
//
//   ikm  = for each layer used, in this order:  id ‖ len ‖ shared secret
//            0x01 P-256 (32 bytes), 0x02 ML-KEM-1024 (32), 0xff out of band (32–64)
//   info = "PNW::PAIR::v2" ‖ 0x02 ‖ flags (bit 0: out of band used)
//            ‖ len ‖ the initiator's half ‖ len ‖ the responder's answer
//   key  = HKDF-SHA256(salt = the agreement's parties key, ikm, info, 32 bytes)
//
// (len: two bytes, big-endian.) Everything that travels is in the info, each
// message whole and in its role: the half first, then the answer, and each
// begins with its kind byte (`format.ts`), so the two can't trade places, and
// no part (a P-256 point, the encapsulation key, the ciphertext) can be swapped
// or dropped without changing the key. Why HKDF rather than X-Wing's SHA3-256
// combiner: X-Wing's proof is for X25519 with ML-KEM-768 and leaves the ML-KEM
// ciphertext out on the strength of that pairing; this pair has P-256,
// ML-KEM-1024 and an optional third secret, so the conservative generic
// construction is used instead: every secret in the extract step (the output
// stays a PRF as long as any one of them is unknown), the whole transcript in
// the expand step. It is also what version 1 already uses, with the same salt,
// so the Rust port needs no new primitive. A version 2 pair is not symmetric,
// unlike version 1's sorted halves.
//
// Secret bytes are zeroed once used, where JavaScript lets them be: our own
// arrays and the buffers WebCrypto hands back; not strings (the key's hex
// form, as in version 1, the stored form's JWK and seed) or the engine's
// copies. The responder's P-256 key is made non-extractable and never leaves
// WebCrypto. Nothing here logs a key.
// ---------------------------------------------------------------------------

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { type Bytes, PairKeyError, concat, framed, fromHex, toHex, wipe } from "./bytes";
import { ALG, type PublicHalfV2, VERSION, decodeAnswer, decodePublicHalf, encodeAnswer, encodePublicHalf } from "./format";
import { checkOutOfBand } from "./out_of_band";

const LABEL = new TextEncoder().encode("PNW::PAIR::v2");
const OUT_OF_BAND_ID = 0xff;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const subtle = () => globalThis.crypto.subtle;

/** The initiator's private half as the vault keeps it: the P-256 key as WebCrypto exports it, and the 64-byte ML-KEM seed (d ‖ z), hex. */
export type PrivateHalfV2 = { p256: JsonWebKey; mlKemSeed: string };
/** A pending pair key as the vault keeps it while the answer is awaited: `publicKey` (hex of the half) travels, `privateKey` stays. */
export type HalfV2 = { version: 2; publicKey: string; privateKey: PrivateHalfV2 };

const PARTIES_KEY = /^[0-9a-f]{64}$/;
const SEED = /^[0-9a-f]{128}$/;
const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;

function partiesKeyBytes(partiesKey: string): Bytes {
  if (!PARTIES_KEY.test(partiesKey)) throw new PairKeyError("The agreement's key must be 32 bytes of hex");
  return fromHex(partiesKey, "The agreement's key");
}

const b64url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromB64url32(s: unknown, what: string): Bytes {
  if (typeof s !== "string" || !B64URL_32.test(s)) throw new PairKeyError(`${what} must be 32 bytes of base64url`);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=");
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Checks the P-256 part is a point on the curve, as WebCrypto takes it. */
async function p256Public(point: Bytes): Promise<CryptoKey> {
  try {
    return await subtle().importKey("raw", point, ECDH, false, []);
  } catch {
    throw new PairKeyError("The P-256 part isn't a point on the curve");
  }
}

/** A P-256 private key from its point (this side's half) and its scalar, non-extractable. */
async function p256Private(point: Uint8Array, d: Uint8Array): Promise<CryptoKey> {
  try {
    return await subtle().importKey("jwk", { kty: "EC", crv: "P-256", x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33)), d: b64url(d), ext: true }, ECDH, false, ["deriveBits"]);
  } catch {
    throw new PairKeyError("This side's P-256 key can't be read");
  }
}

/** The 32-byte ECDH secret; the caller wipes it (it is a view of WebCrypto's own buffer). */
async function ecdh(mine: CryptoKey, theirs: CryptoKey): Promise<Bytes> {
  return new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: theirs }, mine, 256));
}

/** A version 2 half from its hex, every part checked (shapes, the ML-KEM key, the curve). */
export async function readPublicHalfV2(hex: string): Promise<PublicHalfV2> {
  const half = decodePublicHalf(fromHex(hex, "A key half"));
  await p256Public(half.p256);
  return half;
}

/** The secrets and the transcript the combiner takes. Exported for the tests and the fixture. */
export type CombineInput = {
  partiesKey: Bytes;
  /** The initiator's half, as it travelled. */
  half: Uint8Array;
  /** The responder's answer, as it travelled. */
  answer: Uint8Array;
  p256: Uint8Array;
  mlKem1024: Uint8Array;
  outOfBand?: Uint8Array;
  /** The version byte the info carries; only the tests set it, to show a change alters the key. */
  version?: number;
};

/** The combiner (this file's header): HKDF-SHA256 over every secret, the transcript in its info. Returns 32 bytes. */
export function combine(input: CombineInput): Bytes {
  if (input.p256.length !== 32 || input.mlKem1024.length !== 32) throw new PairKeyError("A layer's shared secret is 32 bytes");
  const layers: Uint8Array[] = [new Uint8Array([ALG.P256]), framed(input.p256), new Uint8Array([ALG.ML_KEM_1024]), framed(input.mlKem1024)];
  if (input.outOfBand) layers.push(new Uint8Array([OUT_OF_BAND_ID]), framed(input.outOfBand));
  const ikm = concat(...layers);
  const info = concat(LABEL, new Uint8Array([input.version ?? VERSION, input.outOfBand ? 1 : 0]), framed(input.half), framed(input.answer));
  try {
    return new Uint8Array(hkdf(sha256, ikm, input.partiesKey, info, 32));
  } finally {
    wipe(ikm, ...layers);
  }
}

function outOfBandCopy(outOfBand: Uint8Array | undefined): Bytes | undefined {
  if (outOfBand === undefined) return undefined;
  checkOutOfBand(outOfBand);
  return new Uint8Array(outOfBand);
}

// ---- The initiator -----------------------------------------------------------

export type CompleteInput = {
  /** The agreement's parties key (64 hex characters): the salt, as in version 1. */
  partiesKey: string;
  /** The responder's answer, as it arrived (hex). */
  answer: string;
  /** The out-of-band secret, when the two share one. The caller keeps and wipes its own copy. */
  outOfBand?: Uint8Array;
};

export type PendingState = "pending" | "spent" | "discarded";

/**
 * The initiator's pending pair key: made when it starts, it opens exactly one answer. `half` (hex)
 * travels with the start; `complete` takes the answer and gives the pair's key, once. The secret
 * bytes it holds (the P-256 scalar, the ML-KEM seed) are zeroed when it completes, fails to, or is
 * discarded; a second `complete` is refused.
 */
export class PendingPairV2 {
  /** The half that travels with the start (hex of the encoding in `format.ts`). */
  readonly half: string;
  readonly #halfBytes: Bytes;
  readonly #point: Bytes;
  readonly #ek: Bytes;
  readonly #d: Bytes;
  readonly #seed: Bytes;
  #state: PendingState = "pending";

  private constructor(halfBytes: Bytes, half: PublicHalfV2, d: Bytes, seed: Bytes) {
    this.#halfBytes = halfBytes;
    this.half = toHex(halfBytes);
    this.#point = half.p256;
    this.#ek = half.mlKem1024;
    this.#d = d;
    this.#seed = seed;
  }

  /** A fresh pending pair key: a P-256 key from WebCrypto and a random ML-KEM-1024 seed. */
  static async create(): Promise<PendingPairV2> {
    const pair = await subtle().generateKey(ECDH, true, ["deriveBits"]);
    const p256 = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
    const d = fromB64url32((await subtle().exportKey("jwk", pair.privateKey)).d, "A P-256 key");
    const seed = globalThis.crypto.getRandomValues(new Uint8Array(ml_kem1024.lengths.seed!));
    const keys = ml_kem1024.keygen(seed);
    wipe(keys.secretKey);
    const halfBytes = encodePublicHalf({ p256, mlKem1024: keys.publicKey });
    return new PendingPairV2(halfBytes, decodePublicHalf(halfBytes), d, seed);
  }

  /**
   * A pending pair key from the copy the vault kept, every part checked against its half. The
   * caller's copy is left as it is: it must be removed from the vault in the same write that keeps
   * the pair's key, or it could be restored to open a second answer.
   */
  static async restore(stored: HalfV2): Promise<PendingPairV2> {
    if (stored?.version !== 2) throw new PairKeyError("A pending pair key of another version can't be restored here");
    const halfBytes = fromHex(stored.publicKey, "This side's key half");
    const half = decodePublicHalf(halfBytes);
    await p256Public(half.p256);
    const jwk = stored.privateKey?.p256;
    if (jwk?.kty !== "EC" || jwk.crv !== "P-256" || jwk.x !== b64url(half.p256.subarray(1, 33)) || jwk.y !== b64url(half.p256.subarray(33))) throw new PairKeyError("This side's P-256 key doesn't match its half");
    const d = fromB64url32(jwk.d, "This side's P-256 key");
    const seedHex = stored.privateKey.mlKemSeed;
    if (typeof seedHex !== "string" || !SEED.test(seedHex)) {
      wipe(d);
      throw new PairKeyError("An ML-KEM seed is 64 bytes of hex");
    }
    const seed = fromHex(seedHex, "An ML-KEM seed");
    const keys = ml_kem1024.keygen(seed);
    wipe(keys.secretKey);
    if (!same(keys.publicKey, half.mlKem1024)) {
      wipe(d, seed);
      throw new PairKeyError("This side's ML-KEM seed doesn't match its half");
    }
    return new PendingPairV2(halfBytes, half, d, seed);
  }

  /** "pending" until it completes (or tries to) or is discarded. */
  get state(): PendingState {
    return this.#state;
  }

  /** What the vault keeps while the answer is awaited. Refused once spent or discarded. */
  toStored(): HalfV2 {
    this.#mustBePending();
    return {
      version: 2,
      publicKey: this.half,
      privateKey: { p256: { kty: "EC", crv: "P-256", x: b64url(this.#point.subarray(1, 33)), y: b64url(this.#point.subarray(33)), d: b64url(this.#d) }, mlKemSeed: toHex(this.#seed) },
    };
  }

  /**
   * Opens the responder's answer: the pair's key (64 hex characters), the same the responder made.
   * Once only: this call spends the keys before anything else, so a second call (a second answer,
   * the same one again, or one made while this one runs) is refused, and the keys are zeroed when it
   * ends, whether it gave a key or refused the answer.
   */
  async complete(input: CompleteInput): Promise<string> {
    this.#mustBePending();
    this.#state = "spent";
    let salt: Bytes | undefined;
    let oob: Bytes | undefined;
    let p256: Bytes | undefined;
    let keys: { publicKey: Uint8Array; secretKey: Uint8Array } | undefined;
    let shared: Uint8Array | undefined;
    let key: Bytes | undefined;
    try {
      salt = partiesKeyBytes(input.partiesKey);
      const answerBytes = fromHex(input.answer, "The answer");
      const answer = decodeAnswer(answerBytes);
      if (same(answer.p256, this.#point)) throw new PairKeyError("The answer carries this side's own P-256 key");
      oob = outOfBandCopy(input.outOfBand);
      const theirs = await p256Public(answer.p256);
      p256 = await ecdh(await p256Private(this.#point, this.#d), theirs);
      keys = ml_kem1024.keygen(this.#seed);
      if (!same(keys.publicKey, this.#ek)) throw new PairKeyError("This side's ML-KEM seed doesn't match its half");
      // ML-KEM never fails here: a wrong ciphertext gives a different (implicitly rejected) secret, so a different key.
      shared = ml_kem1024.decapsulate(answer.mlKem1024, keys.secretKey);
      key = combine({ partiesKey: salt, half: this.#halfBytes, answer: answerBytes, p256, mlKem1024: shared, ...(oob ? { outOfBand: oob } : {}) });
      return toHex(key);
    } finally {
      wipe(this.#d, this.#seed, keys?.secretKey, shared, p256, oob, key, salt);
    }
  }

  /** Zeroes the keys without opening an answer (the start was withdrawn, or the vault dropped it). Idempotent. */
  discard(): void {
    if (this.#state === "pending") this.#state = "discarded";
    wipe(this.#d, this.#seed);
  }

  #mustBePending(): void {
    if (this.#state === "spent") throw new PairKeyError("This pending pair key has already taken an answer: each one opens one answer only");
    if (this.#state === "discarded") throw new PairKeyError("This pending pair key was discarded");
  }
}

// ---- The responder -----------------------------------------------------------

export type AnswerInput = {
  /** The agreement's parties key (64 hex characters): the salt, as in version 1. */
  partiesKey: string;
  /** The initiator's half, as it arrived with the start (hex). */
  half: string;
  /** The out-of-band secret, when the two share one. The caller keeps and wipes its own copy. */
  outOfBand?: Uint8Array;
};

/**
 * The responder's side: a fresh P-256 key for this answer alone, an encapsulation to the
 * initiator's ML-KEM key, and the pair's key. `answer` (hex) travels back; `key` (64 hex characters)
 * never travels. Nothing else is kept: the P-256 key is non-extractable and dropped here.
 */
export async function answerPairV2(input: AnswerInput): Promise<{ answer: string; key: string }> {
  return answerWith(input, {});
}

/**
 * As `answerPairV2`, with the responder's P-256 key and the encapsulation's 32 random bytes given:
 * for the fixture only, never the app (not exported from the package).
 */
export async function answerWith(input: AnswerInput, fixed: { p256?: JsonWebKey; randomness?: Uint8Array }): Promise<{ answer: string; key: string }> {
  let salt: Bytes | undefined;
  let oob: Bytes | undefined;
  let p256: Bytes | undefined;
  let enc: { cipherText: Uint8Array; sharedSecret: Uint8Array } | undefined;
  let key: Bytes | undefined;
  try {
    salt = partiesKeyBytes(input.partiesKey);
    const halfBytes = fromHex(input.half, "Their key half");
    const half = decodePublicHalf(halfBytes);
    const theirs = await p256Public(half.p256);
    oob = outOfBandCopy(input.outOfBand);
    const mine = fixed.p256 ? await fixedP256(fixed.p256) : await subtle().generateKey(ECDH, false, ["deriveBits"]);
    const point = new Uint8Array(await subtle().exportKey("raw", mine.publicKey));
    p256 = await ecdh(mine.privateKey, theirs);
    try {
      enc = ml_kem1024.encapsulate(half.mlKem1024, fixed.randomness);
    } catch {
      throw new PairKeyError("Their ML-KEM-1024 key can't be encapsulated to");
    }
    const answer = encodeAnswer({ p256: point, mlKem1024: new Uint8Array(enc.cipherText) });
    key = combine({ partiesKey: salt, half: halfBytes, answer, p256, mlKem1024: enc.sharedSecret, ...(oob ? { outOfBand: oob } : {}) });
    return { answer: toHex(answer), key: toHex(key) };
  } finally {
    wipe(p256, enc?.sharedSecret, oob, key, salt);
  }
}

async function fixedP256(jwk: JsonWebKey): Promise<CryptoKeyPair> {
  const privateKey = await subtle().importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, ext: true }, ECDH, false, ["deriveBits"]);
  const publicKey = await subtle().importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true }, ECDH, true, []);
  return { privateKey, publicKey };
}
