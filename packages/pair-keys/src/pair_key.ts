// ---------------------------------------------------------------------------
// A pair's key, version 2: three layers, each of which an attacker must break.
//
//   1. P-256 ECDH, as in version 1 (secure against today's computers);
//   2. ML-KEM-1024 (FIPS 203), designed to hold against a quantum computer;
//   3. an out-of-band secret (optional, at least 32 bytes) the two people
//      exchanged outside this app and the chain (`out_of_band.ts`).
//
// Who encapsulates: the side that answers a start (the responder) encapsulates
// to the starting side's (the initiator's) ML-KEM key, which it already holds
// when it answers, and the ciphertext rides back with its answer. So the
// handshake stays two messages, as in version 1: the initiator's half goes out
// with its start, the responder's half and the ciphertext with the answer.
// The responder's own ML-KEM key travels too (a version 2 half always has the
// whole suite, whichever side it starts or answers) and is bound into the
// transcript, though this pair encapsulates only one way.
//
// The combiner, HKDF-SHA256 (RFC 5869), as in version 1:
//
//   ikm  = for each layer used, in this order:  id ‖ len ‖ shared secret
//            0x01 P-256 (32 bytes), 0x02 ML-KEM-1024 (32), 0xff out of band (32–64)
//   info = "PNW::PAIR::v2" ‖ 0x02 ‖ flags (bit 0: out of band used)
//            ‖ len ‖ initiator's half ‖ len ‖ responder's half ‖ len ‖ ciphertexts
//   key  = HKDF-SHA256(salt = the agreement's parties key, ikm, info, 32 bytes)
//
// (len: two bytes, big-endian.) Why HKDF rather than X-Wing's SHA3-256
// combiner: X-Wing's proof is for X25519 with ML-KEM-768 and leaves the
// ML-KEM ciphertext out on the strength of that pairing; this pair has P-256,
// ML-KEM-1024 and an optional third secret, so the conservative generic
// construction is used instead: every secret in the extract step (the output
// stays a PRF as long as any one of them is unknown), and the whole transcript
// (both halves, the ciphertext, the version, whether the third layer is used)
// in the expand step, so no part can be swapped without changing the key. It
// is also what version 1 already uses, with the same salt, so the Rust port
// needs no new primitive. The halves keep their roles (initiator first): a
// version 2 pair is not symmetric, unlike version 1's sorted halves.
//
// Secret bytes are zeroed once used, where JavaScript lets them be: our own
// arrays and the buffers WebCrypto hands back; not strings (the key's hex
// form, as in version 1) or the engine's copies. Nothing here logs a key.
// ---------------------------------------------------------------------------

import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { type Bytes, PairKeyError, concat, framed, fromHex, toHex, wipe } from "./bytes";
import { ALG, type PublicHalfV2, VERSION, decodeCiphertexts, decodePublicHalf, encodeCiphertexts, encodePublicHalf } from "./format";
import { checkOutOfBand } from "./out_of_band";

const LABEL = new TextEncoder().encode("PNW::PAIR::v2");
const OUT_OF_BAND_ID = 0xff;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const subtle = () => globalThis.crypto.subtle;

/** This side's private half: the P-256 key as WebCrypto exports it, and the 64-byte ML-KEM seed (d ‖ z). */
export type PrivateHalfV2 = { p256: JsonWebKey; mlKemSeed: string };
/** A version 2 half: `publicKey` (hex of the encoding in `format.ts`) travels, `privateKey` stays in the vault. */
export type HalfV2 = { version: 2; publicKey: string; privateKey: PrivateHalfV2 };

const PARTIES_KEY = /^[0-9a-f]{64}$/;
const SEED = /^[0-9a-f]{128}$/;

function partiesKeyBytes(partiesKey: string): Bytes {
  if (!PARTIES_KEY.test(partiesKey)) throw new PairKeyError("The agreement's key must be 32 bytes of hex");
  return fromHex(partiesKey, "The agreement's key");
}

/** Checks the P-256 part is a point on the curve, as WebCrypto takes it. */
async function p256Public(point: Bytes): Promise<CryptoKey> {
  try {
    return await subtle().importKey("raw", point, ECDH, false, []);
  } catch {
    throw new PairKeyError("The P-256 part isn't a point on the curve");
  }
}

async function p256Shared(mine: JsonWebKey, theirs: Bytes): Promise<Bytes> {
  const pub = await p256Public(theirs);
  let priv: CryptoKey;
  try {
    priv = await subtle().importKey("jwk", { kty: "EC", crv: "P-256", x: mine.x, y: mine.y, d: mine.d, ext: true }, ECDH, false, ["deriveBits"]);
  } catch {
    throw new PairKeyError("This side's P-256 key can't be read");
  }
  return new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: pub }, priv, 256));
}

/** The ML-KEM key pair behind a seed. The caller wipes the secret key. */
function mlKemKeys(seedHex: string): { publicKey: Uint8Array; secretKey: Uint8Array } {
  if (!SEED.test(seedHex)) throw new PairKeyError("An ML-KEM seed is 64 bytes of hex");
  const seed = fromHex(seedHex, "An ML-KEM seed");
  try {
    return ml_kem1024.keygen(seed);
  } finally {
    wipe(seed);
  }
}

const b64url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** This side's P-256 private key belongs to the P-256 part of its own half (a vault mix-up fails here, not as a wrong key). */
function checkMine(mine: HalfV2, half: PublicHalfV2): PublicHalfV2 {
  const jwk = mine.privateKey.p256;
  if (jwk.x !== b64url(half.p256.subarray(1, 33)) || jwk.y !== b64url(half.p256.subarray(33))) throw new PairKeyError("This side's P-256 key doesn't match its half");
  return half;
}

/** A version 2 public half from its hex, every part checked (shapes, the ML-KEM key, the curve). */
export async function readPublicHalfV2(hex: string): Promise<PublicHalfV2> {
  const half = decodePublicHalf(fromHex(hex, "A key half"));
  await p256Public(half.p256);
  return half;
}

/** A fresh half: a P-256 key in WebCrypto and a random ML-KEM-1024 seed. */
export async function newHalfV2(): Promise<HalfV2> {
  const pair = await subtle().generateKey(ECDH, true, ["deriveBits"]);
  const p256 = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  const jwk = await subtle().exportKey("jwk", pair.privateKey);
  const seed = globalThis.crypto.getRandomValues(new Uint8Array(ml_kem1024.lengths.seed!));
  const keys = ml_kem1024.keygen(seed);
  wipe(keys.secretKey);
  const half: HalfV2 = {
    version: 2,
    publicKey: toHex(encodePublicHalf({ p256, mlKem1024: keys.publicKey })),
    privateKey: { p256: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d }, mlKemSeed: toHex(seed) },
  };
  wipe(seed);
  return half;
}

/** The secrets and the transcript the combiner takes. Exported for the tests and the fixture. */
export type CombineInput = {
  partiesKey: Bytes;
  initiator: Uint8Array;
  responder: Uint8Array;
  ciphertexts: Uint8Array;
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
  const info = concat(LABEL, new Uint8Array([input.version ?? VERSION, input.outOfBand ? 1 : 0]), framed(input.initiator), framed(input.responder), framed(input.ciphertexts));
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

export type AnswerInput = {
  /** The agreement's parties key (64 hex characters): the salt, as in version 1. */
  partiesKey: string;
  /** This side's half (the responder's). */
  mine: HalfV2;
  /** The initiator's public half, as it arrived (hex). */
  theirs: string;
  /** The out-of-band secret, when the two share one. The caller keeps and wipes its own copy. */
  outOfBand?: Uint8Array;
};

/**
 * The responder's side: encapsulates to the initiator's ML-KEM key and makes the pair's key.
 * `ciphertexts` (hex) travels back with the answer; `key` (64 hex characters) never travels.
 */
export async function answerPairV2(input: AnswerInput): Promise<{ ciphertexts: string; key: string }> {
  return answerWith(input, undefined);
}

/** As `answerPairV2`, with the encapsulation's 32 random bytes given: for the fixture only, never the app. */
export async function answerWith(input: AnswerInput, randomness: Uint8Array | undefined): Promise<{ ciphertexts: string; key: string }> {
  const salt = partiesKeyBytes(input.partiesKey);
  const initiatorBytes = fromHex(input.theirs, "Their key half");
  const initiator = decodePublicHalf(initiatorBytes);
  const responderBytes = fromHex(input.mine.publicKey, "This side's key half");
  checkMine(input.mine, decodePublicHalf(responderBytes));
  if (toHex(responderBytes) === toHex(initiatorBytes)) throw new PairKeyError("Their key half is this side's own");
  const oob = outOfBandCopy(input.outOfBand);
  let p256: Bytes | undefined;
  let enc: { cipherText: Uint8Array; sharedSecret: Uint8Array } | undefined;
  let key: Bytes | undefined;
  try {
    p256 = await p256Shared(input.mine.privateKey.p256, initiator.p256);
    try {
      enc = ml_kem1024.encapsulate(initiator.mlKem1024, randomness);
    } catch {
      throw new PairKeyError("Their ML-KEM-1024 key can't be encapsulated to");
    }
    const ciphertexts = encodeCiphertexts({ mlKem1024: new Uint8Array(enc.cipherText) });
    key = combine({ partiesKey: salt, initiator: initiatorBytes, responder: responderBytes, ciphertexts, p256, mlKem1024: enc.sharedSecret, ...(oob ? { outOfBand: oob } : {}) });
    return { ciphertexts: toHex(ciphertexts), key: toHex(key) };
  } finally {
    wipe(p256, enc?.sharedSecret, oob, key, salt);
  }
}

export type CompleteInput = {
  partiesKey: string;
  /** This side's half (the initiator's). */
  mine: HalfV2;
  /** The responder's public half, from its answer (hex). */
  theirs: string;
  /** The ciphertexts from its answer (hex). */
  ciphertexts: string;
  outOfBand?: Uint8Array;
};

/** The initiator's side: decapsulates the answer's ciphertext and makes the same key (64 hex characters). */
export async function completePairV2(input: CompleteInput): Promise<string> {
  const salt = partiesKeyBytes(input.partiesKey);
  const initiatorBytes = fromHex(input.mine.publicKey, "This side's key half");
  const initiator = checkMine(input.mine, decodePublicHalf(initiatorBytes));
  const responderBytes = fromHex(input.theirs, "Their key half");
  const responder = decodePublicHalf(responderBytes);
  if (toHex(responderBytes) === toHex(initiatorBytes)) throw new PairKeyError("Their key half is this side's own");
  const ciphertextBytes = fromHex(input.ciphertexts, "The ciphertexts");
  const { mlKem1024: cipherText } = decodeCiphertexts(ciphertextBytes);
  const oob = outOfBandCopy(input.outOfBand);
  let p256: Bytes | undefined;
  let keys: { publicKey: Uint8Array; secretKey: Uint8Array } | undefined;
  let shared: Uint8Array | undefined;
  let key: Bytes | undefined;
  try {
    keys = mlKemKeys(input.mine.privateKey.mlKemSeed);
    if (toHex(keys.publicKey) !== toHex(initiator.mlKem1024)) throw new PairKeyError("This side's ML-KEM seed doesn't match its half");
    p256 = await p256Shared(input.mine.privateKey.p256, responder.p256);
    // ML-KEM never fails here: a wrong ciphertext gives a different (implicitly rejected) secret, so a different key.
    shared = ml_kem1024.decapsulate(cipherText, keys.secretKey);
    key = combine({ partiesKey: salt, initiator: initiatorBytes, responder: responderBytes, ciphertexts: ciphertextBytes, p256, mlKem1024: shared, ...(oob ? { outOfBand: oob } : {}) });
    return toHex(key);
  } finally {
    wipe(p256, keys?.secretKey, shared, oob, key, salt);
  }
}
