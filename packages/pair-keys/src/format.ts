// ---------------------------------------------------------------------------
// The pair-key format, version 2: what each side sends. Versioned and
// crypto-agile: a version byte, the message's kind, then a list of parts, each
// tagged with its algorithm, so another KEM (HQC, reserved below) can join the
// list later without a migration of its own.
//
//   half     0x02 | 0x01 | count | (alg | length u16 BE | bytes) × count
//   answer   0x02 | 0x02 | count | (alg | length u16 BE | bytes) × count
//
// The half is the initiator's: its P-256 point and its ML-KEM-1024
// encapsulation key. The answer is the responder's: its P-256 point and one
// ciphertext per KEM of the suite (ML-KEM-1024 today). The responder sends no
// KEM key of its own (it never decapsulates), so an answer that carries one
// (a half where an answer belongs) is refused. The kind byte keeps the two
// apart: an encapsulation key and a ciphertext are both 1,568 bytes.
//
// Parts appear once each, in ascending algorithm order, every one of the suite.
// An algorithm this code doesn't know is refused by number, a reserved one by
// name; trailing bytes are refused.
//
// A version 1 half is the bare P-256 point (65 bytes, first byte 0x04), so the
// first byte alone tells the two apart (`versionOf`). Version 1 pairs are made
// as they always were, by the app's own key ring; nothing here touches them.
// Nothing here logs a key.
// ---------------------------------------------------------------------------

import { ml_kem1024 } from "@noble/post-quantum/ml-kem.js";
import { type Bytes, PairKeyError, concat } from "./bytes";

export const VERSION = 2;

/** What a version 2 message is: the initiator's half, or the responder's answer to it. */
export const KIND = { HALF: 0x01, ANSWER: 0x02 } as const;

/** Algorithm ids. Never reuse a number: a retired algorithm keeps its id, refused. */
export const ALG = {
  /** P-256 ECDH, the uncompressed point (65 bytes). As in version 1. */
  P256: 0x01,
  /** ML-KEM-1024, FIPS 203: the initiator's encapsulation key (1,568 bytes) or the responder's ciphertext (1,568 bytes). */
  ML_KEM_1024: 0x02,
  /** HQC, NIST's code-based backup KEM, as its team specifies it today: reserved here, built in a package of its own. Refused. */
  HQC_RESERVED: 0x03,
  /** ML-DSA-65, FIPS 204: a signature over the half by its owner's identity key, reserved until
   * quantum computers come close (a signature can't be harvested, so it isn't needed yet). Refused today. */
  ML_DSA_65_RESERVED: 0x04,
  /** HQC as published in FIPS 207, should the standard differ from today's HQC: reserved, refused. */
  HQC_FIPS_207_RESERVED: 0x05,
} as const;

/** Ids held for a later suite: refused by name, never treated as unknown. */
const RESERVED: ReadonlyMap<number, string> = new Map([
  [ALG.HQC_RESERVED, "HQC"],
  [ALG.ML_DSA_65_RESERVED, "ML-DSA-65"],
  [ALG.HQC_FIPS_207_RESERVED, "HQC as published in FIPS 207"],
]);

/** The algorithms a version 2 half must carry, ascending. */
export const SUITE: readonly number[] = [ALG.P256, ALG.ML_KEM_1024];
/** The KEMs of the suite: the answer carries one ciphertext for each. */
export const KEMS: readonly number[] = [ALG.ML_KEM_1024];
/** The parts an answer must carry, ascending: the responder's P-256 point, then a ciphertext per KEM. */
const ANSWER_PARTS: readonly number[] = [ALG.P256, ...KEMS];

export const P256_POINT_BYTES = 65;
export const ML_KEM_1024_EK_BYTES = ml_kem1024.lengths.publicKey!; // 1,568
export const ML_KEM_1024_CT_BYTES = ml_kem1024.lengths.cipherText!; // 1,568
const MAX_PARTS = 8;

const name = (alg: number): string => {
  if (alg === ALG.P256) return "P-256";
  if (alg === ALG.ML_KEM_1024) return "ML-KEM-1024";
  const reserved = RESERVED.get(alg);
  if (reserved) return reserved;
  return `0x${alg.toString(16).padStart(2, "0")}`;
};

/** The initiator's half: its P-256 point and its ML-KEM-1024 encapsulation key. */
export type PublicHalfV2 = { p256: Bytes; mlKem1024: Bytes };
/** The responder's answer: its P-256 point and the ML-KEM-1024 ciphertext (no key of its own). */
export type AnswerV2 = { p256: Bytes; mlKem1024: Bytes };

/** The version of a public half: 1 for a bare P-256 point, 2 for this format. Anything else is refused. */
export function versionOf(half: Uint8Array): 1 | 2 {
  if (half.length === P256_POINT_BYTES && half[0] === 0x04) return 1;
  if (half.length > 0 && half[0] === VERSION) return 2;
  throw new PairKeyError(half.length === 0 ? "A key half is empty" : `A key half of version ${half[0]} isn't one this app can read`);
}

function encodeParts(kind: number, parts: [number, Uint8Array][]): Bytes {
  const head = new Uint8Array([VERSION, kind, parts.length]);
  return concat(head, ...parts.map(([alg, b]) => concat(new Uint8Array([alg, b.length >> 8, b.length & 0xff]), b)));
}

/** Reads the parts of a version 2 message of one kind; refuses another kind, unknown or reserved ids, repeats, disorder, gaps and leftovers. */
function decodeParts(bytes: Uint8Array, what: string, kind: number, required: readonly number[]): Map<number, Bytes> {
  if (bytes.length < 3) throw new PairKeyError(`${what} is too short`);
  if (bytes[0] !== VERSION) throw new PairKeyError(`${what} is version ${bytes[0]}, not ${VERSION}`);
  if (bytes[1] !== kind) {
    if (kind === KIND.ANSWER && bytes[1] === KIND.HALF) throw new PairKeyError(`${what} carries an encapsulation key (it is a key half): an answer carries only the responder's P-256 point and the ciphertexts`);
    if (kind === KIND.HALF && bytes[1] === KIND.ANSWER) throw new PairKeyError(`${what} is an answer (it carries ciphertexts, not keys)`);
    throw new PairKeyError(`${what} is of an unknown kind (0x${bytes[1]!.toString(16).padStart(2, "0")})`);
  }
  const count = bytes[2]!;
  if (count === 0 || count > MAX_PARTS) throw new PairKeyError(`${what} has ${count} parts`);
  const parts = new Map<number, Bytes>();
  let at = 3;
  let last = 0;
  for (let i = 0; i < count; i++) {
    if (at + 3 > bytes.length) throw new PairKeyError(`${what} ends inside a part`);
    const alg = bytes[at]!;
    const len = (bytes[at + 1]! << 8) | bytes[at + 2]!;
    at += 3;
    const reserved = RESERVED.get(alg);
    if (reserved) throw new PairKeyError(`${what} uses ${reserved}, which is reserved and not supported yet`);
    if (!required.includes(alg)) throw new PairKeyError(`${what} uses an unknown algorithm (${name(alg)})`);
    if (alg <= last) throw new PairKeyError(`${what} repeats a part or lists them out of order`);
    if (at + len > bytes.length) throw new PairKeyError(`${what} ends inside its ${name(alg)} part`);
    parts.set(alg, bytes.slice(at, at + len));
    at += len;
    last = alg;
  }
  if (at !== bytes.length) throw new PairKeyError(`${what} has bytes after its last part`);
  for (const alg of required) if (!parts.has(alg)) throw new PairKeyError(`${what} lacks its ${name(alg)} part`);
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

/** Shapes only (the curve check needs WebCrypto: `pair_key.ts` does it before any key is used). */
function checkP256Shape(p: Uint8Array): void {
  if (p.length !== P256_POINT_BYTES || p[0] !== 0x04) throw new PairKeyError("The P-256 part must be an uncompressed point");
}

function checkCiphertext(c: Uint8Array): void {
  if (c.length !== ML_KEM_1024_CT_BYTES) throw new PairKeyError("An ML-KEM-1024 ciphertext is 1,568 bytes");
}

export function encodePublicHalf(half: PublicHalfV2): Bytes {
  checkP256Shape(half.p256);
  if (!isMlKem1024Key(half.mlKem1024)) throw new PairKeyError("The ML-KEM-1024 part isn't an encapsulation key");
  return encodeParts(KIND.HALF, [
    [ALG.P256, half.p256],
    [ALG.ML_KEM_1024, half.mlKem1024],
  ]);
}

export function decodePublicHalf(bytes: Uint8Array): PublicHalfV2 {
  if (bytes.length === P256_POINT_BYTES && bytes[0] === 0x04) throw new PairKeyError("A key half is version 1 (P-256 only) where a version 2 half belongs");
  const parts = decodeParts(bytes, "A key half", KIND.HALF, SUITE);
  const half = { p256: parts.get(ALG.P256)!, mlKem1024: parts.get(ALG.ML_KEM_1024)! };
  checkP256Shape(half.p256);
  if (!isMlKem1024Key(half.mlKem1024)) throw new PairKeyError("The ML-KEM-1024 part isn't an encapsulation key");
  return half;
}

export function encodeAnswer(answer: AnswerV2): Bytes {
  checkP256Shape(answer.p256);
  checkCiphertext(answer.mlKem1024);
  return encodeParts(KIND.ANSWER, [
    [ALG.P256, answer.p256],
    [ALG.ML_KEM_1024, answer.mlKem1024],
  ]);
}

export function decodeAnswer(bytes: Uint8Array): AnswerV2 {
  if (bytes.length === P256_POINT_BYTES && bytes[0] === 0x04) throw new PairKeyError("The answer is a version 1 half (P-256 only) where a version 2 answer belongs");
  const parts = decodeParts(bytes, "The answer", KIND.ANSWER, ANSWER_PARTS);
  const answer = { p256: parts.get(ALG.P256)!, mlKem1024: parts.get(ALG.ML_KEM_1024)! };
  checkP256Shape(answer.p256);
  checkCiphertext(answer.mlKem1024);
  return answer;
}
