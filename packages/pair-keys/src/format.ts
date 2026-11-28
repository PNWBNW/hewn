// ---------------------------------------------------------------------------
// The pair-key format, version 2: what each side publishes and what travels
// back. Versioned and crypto-agile: a version byte, then a list of parts, each
// tagged with its algorithm, so a third KEM (HQC, reserved below) can join the
// list later without a migration of its own.
//
//   public half   0x02 | count | (alg | length u16 BE | bytes) × count
//   ciphertexts   0x02 | count | (alg | length u16 BE | bytes) × count
//
// Parts appear once each, in ascending algorithm order. A public half carries
// every algorithm of the suite (P-256 and ML-KEM-1024 today); the ciphertexts
// carry one per KEM (ML-KEM-1024 today; P-256 is a key agreement, it has none).
// An algorithm this code doesn't know is refused, and so is the reserved HQC
// slot until it is built; trailing bytes are refused.
//
// A version 1 half is the bare P-256 point (65 bytes, first byte 0x04), so the
// first byte alone tells the two apart (`versionOf`). Version 1 pairs are made
// as they always were, by the app's own key ring; nothing here touches them.
// Nothing here logs a key.
// ---------------------------------------------------------------------------

import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { type Bytes, PairKeyError, concat } from "./bytes";

export const VERSION = 2;

/** Algorithm ids. Never reuse a number: a retired algorithm keeps its id, refused. */
export const ALG = {
  /** P-256 ECDH, the uncompressed point (65 bytes). As in version 1. */
  P256: 0x01,
  /** ML-KEM-1024, FIPS 203: an encapsulation key (1,568 bytes) or a ciphertext (1,568 bytes). */
  ML_KEM_1024: 0x02,
  /** HQC, NIST's code-based backup KEM: reserved until its standard is final. Refused today. */
  HQC_RESERVED: 0x03,
} as const;

/** The algorithms a version 2 public half must carry, ascending. */
export const SUITE: readonly number[] = [ALG.P256, ALG.ML_KEM_1024];
/** The KEMs of the suite: one ciphertext each travels back with the answer. */
export const KEMS: readonly number[] = [ALG.ML_KEM_1024];

export const P256_POINT_BYTES = 65;
export const ML_KEM_1024_EK_BYTES = ml_kem1024.lengths.publicKey!; // 1,568
export const ML_KEM_1024_CT_BYTES = ml_kem1024.lengths.cipherText!; // 1,568
const MAX_PARTS = 8;

const name = (alg: number): string => {
  if (alg === ALG.P256) return "P-256";
  if (alg === ALG.ML_KEM_1024) return "ML-KEM-1024";
  if (alg === ALG.HQC_RESERVED) return "HQC";
  return `0x${alg.toString(16).padStart(2, "0")}`;
};

export type PublicHalfV2 = { p256: Bytes; mlKem1024: Bytes };
export type CiphertextsV2 = { mlKem1024: Bytes };

/** The version of a public half: 1 for a bare P-256 point, 2 for this format. Anything else is refused. */
export function versionOf(half: Uint8Array): 1 | 2 {
  if (half.length === P256_POINT_BYTES && half[0] === 0x04) return 1;
  if (half.length > 0 && half[0] === VERSION) return 2;
  throw new PairKeyError(half.length === 0 ? "A key half is empty" : `A key half of version ${half[0]} isn't one this app can read`);
}

function encodeParts(parts: [number, Uint8Array][]): Bytes {
  const head = new Uint8Array([VERSION, parts.length]);
  return concat(head, ...parts.map(([alg, b]) => concat(new Uint8Array([alg, b.length >> 8, b.length & 0xff]), b)));
}

/** Reads the parts of a version 2 encoding; refuses unknown or reserved ids, repeats, disorder and leftovers. */
function decodeParts(bytes: Uint8Array, what: string, allowed: readonly number[]): Map<number, Bytes> {
  if (bytes.length < 2) throw new PairKeyError(`${what} is too short`);
  if (bytes[0] !== VERSION) throw new PairKeyError(`${what} is version ${bytes[0]}, not ${VERSION}`);
  const count = bytes[1]!;
  if (count === 0 || count > MAX_PARTS) throw new PairKeyError(`${what} has ${count} parts`);
  const parts = new Map<number, Bytes>();
  let at = 2;
  let last = 0;
  for (let i = 0; i < count; i++) {
    if (at + 3 > bytes.length) throw new PairKeyError(`${what} ends inside a part`);
    const alg = bytes[at]!;
    const len = (bytes[at + 1]! << 8) | bytes[at + 2]!;
    at += 3;
    if (alg === ALG.HQC_RESERVED) throw new PairKeyError(`${what} uses HQC, which is reserved and not supported yet`);
    if (!allowed.includes(alg)) throw new PairKeyError(`${what} uses an unknown algorithm (${name(alg)})`);
    if (alg <= last) throw new PairKeyError(`${what} repeats a part or lists them out of order`);
    if (at + len > bytes.length) throw new PairKeyError(`${what} ends inside its ${name(alg)} part`);
    parts.set(alg, bytes.slice(at, at + len));
    at += len;
    last = alg;
  }
  if (at !== bytes.length) throw new PairKeyError(`${what} has bytes after its last part`);
  return parts;
}

/**
 * FIPS 203 §7.2's check on an encapsulation key: every 12-bit coefficient of t̂ below q = 3329.
 * A key failing it can't be encapsulated to (the library refuses it as well); checked here so a
 * bad half is refused where it arrives, not later.
 */
export function isMlKem1024Key(ek: Uint8Array): boolean {
  if (ek.length !== ML_KEM_1024_EK_BYTES) return false;
  const t = ek.length - 32; // then ρ, 32 bytes
  for (let i = 0; i < t; i += 3) {
    const a = ek[i]! | ((ek[i + 1]! & 0x0f) << 8);
    const b = (ek[i + 1]! >> 4) | (ek[i + 2]! << 4);
    if (a >= 3329 || b >= 3329) return false;
  }
  return true;
}

/** Shapes only (the curve check needs WebCrypto: `pair_key.ts` does it before any key is made). */
function checkP256Shape(p: Uint8Array): void {
  if (p.length !== P256_POINT_BYTES || p[0] !== 0x04) throw new PairKeyError("The P-256 part must be an uncompressed point");
}

export function encodePublicHalf(half: PublicHalfV2): Bytes {
  checkP256Shape(half.p256);
  if (!isMlKem1024Key(half.mlKem1024)) throw new PairKeyError("The ML-KEM-1024 part isn't an encapsulation key");
  return encodeParts([
    [ALG.P256, half.p256],
    [ALG.ML_KEM_1024, half.mlKem1024],
  ]);
}

export function decodePublicHalf(bytes: Uint8Array): PublicHalfV2 {
  if (bytes.length === P256_POINT_BYTES && bytes[0] === 0x04) throw new PairKeyError("A key half is version 1 (P-256 only) where a version 2 half belongs");
  const parts = decodeParts(bytes, "A key half", SUITE);
  for (const alg of SUITE) if (!parts.has(alg)) throw new PairKeyError(`A key half lacks its ${name(alg)} part`);
  const half = { p256: parts.get(ALG.P256)!, mlKem1024: parts.get(ALG.ML_KEM_1024)! };
  checkP256Shape(half.p256);
  if (!isMlKem1024Key(half.mlKem1024)) throw new PairKeyError("The ML-KEM-1024 part isn't an encapsulation key");
  return half;
}

export function encodeCiphertexts(c: CiphertextsV2): Bytes {
  if (c.mlKem1024.length !== ML_KEM_1024_CT_BYTES) throw new PairKeyError("An ML-KEM-1024 ciphertext is 1,568 bytes");
  return encodeParts([[ALG.ML_KEM_1024, c.mlKem1024]]);
}

export function decodeCiphertexts(bytes: Uint8Array): CiphertextsV2 {
  const parts = decodeParts(bytes, "The ciphertexts", KEMS);
  for (const alg of KEMS) if (!parts.has(alg)) throw new PairKeyError(`The ciphertexts lack the ${name(alg)} one`);
  const mlKem1024 = parts.get(ALG.ML_KEM_1024)!;
  if (mlKem1024.length !== ML_KEM_1024_CT_BYTES) throw new PairKeyError("An ML-KEM-1024 ciphertext is 1,568 bytes");
  return { mlKem1024 };
}
