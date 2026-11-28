// ---------------------------------------------------------------------------
// The third layer: a secret two people share outside this app and the chain
// (scanned in person as a QR code, or read over another channel), kept in each
// side's vault and mixed into the pair's key (`pair_key.ts`). With it, nothing
// on the chain alone opens a letter, whatever breaks later.
//
// At least 32 bytes (256 bits); shorter is refused. A new one is 32 random
// bytes, written two ways, both carrying the same 26 symbols of 11 bits:
//
//   the 256 bits ‖ 8 check bits (SHA-256 of "PNW::OOB::v1" ‖ the secret)
//     = 24 symbols, then 2 Reed–Solomon check symbols over GF(2¹¹)
//
//   words: 26 words of the BIP-39 English list (@pnw/vault's copy, pinned by
//          its SHA-256), e.g. read aloud. A word may be typed by its first
//          four letters (no two words share them).
//   code:  "PNW-OOB1:" and 58 characters of Crockford base32, for a QR code
//          (every character is in the QR alphanumeric set). Reading forgives
//          case, spaces and dashes, and I, L, O for 1, 1, 0.
//
// The two Reed–Solomon symbols make the code's distance 3: any one or two
// wrong words, two swapped words, or one wrong character of the code (a
// character spans at most two symbols) is always caught; wider damage passes
// only by chance, about one in 2³⁰ (22 bits of Reed–Solomon, 8 of hash). These
// are not wallet seed phrases: the words don't follow BIP-39's checksum, and
// this app never asks for a wallet's words.
//
// Pure apart from the random source. Nothing here logs a secret.
// ---------------------------------------------------------------------------

import { sha256 } from "@noble/hashes/sha2.js";
import { WORDS } from "@pnw/vault/passphrase-words";
import { type Bytes, PairKeyError, concat, wipe } from "./bytes";

export const OUT_OF_BAND_MIN_BYTES = 32;
export const OUT_OF_BAND_MAX_BYTES = 64;
/** What `newOutOfBand` makes and the two encodings carry. */
export const OUT_OF_BAND_BYTES = 32;
export const OUT_OF_BAND_WORDS = 26;
export const CODE_PREFIX = "PNW-OOB1:";

const DOMAIN = new TextEncoder().encode("PNW::OOB::v1");
const DATA_SYMBOLS = 24;
const CODE_CHARS = 58; // 26 × 11 = 286 bits, padded with 4 zero bits to 290 = 58 × 5
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Refuses a secret too short (under 256 bits), too long, or one byte repeated (all zeros, say). */
export function checkOutOfBand(secret: Uint8Array): void {
  if (!(secret instanceof Uint8Array)) throw new PairKeyError("An out-of-band secret is bytes");
  if (secret.length < OUT_OF_BAND_MIN_BYTES) throw new PairKeyError("An out-of-band secret is at least 32 bytes (256 bits)");
  if (secret.length > OUT_OF_BAND_MAX_BYTES) throw new PairKeyError("An out-of-band secret is at most 64 bytes");
  if (secret.every((b) => b === secret[0])) throw new PairKeyError("An out-of-band secret can't be one byte repeated");
}

/** A fresh out-of-band secret: 32 random bytes. */
export const newOutOfBand = (): Bytes => globalThis.crypto.getRandomValues(new Uint8Array(OUT_OF_BAND_BYTES));

// ---- GF(2¹¹), x¹¹ + x² + 1 (primitive), and the two check symbols -------------------------

const FIELD = 2048;
const EXP = new Uint16Array(2 * (FIELD - 1));
const LOG = new Uint16Array(FIELD);
{
  let x = 1;
  for (let i = 0; i < FIELD - 1; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & FIELD) x ^= 0x805;
  }
  for (let i = FIELD - 1; i < EXP.length; i++) EXP[i] = EXP[i - (FIELD - 1)]!;
}
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);
// g(x) = (x − α)(x − α²) = x² + (α + α²)x + α³
const G1 = EXP[1]! ^ EXP[2]!;
const G0 = EXP[3]!;

/** The two check symbols for the data symbols (highest degree first). */
function parity(data: readonly number[]): [number, number] {
  let r1 = 0;
  let r0 = 0;
  for (const m of data) {
    const f = m ^ r1;
    r1 = r0 ^ mul(f, G1);
    r0 = mul(f, G0);
  }
  return [r1, r0];
}

/** c(αʲ) for a codeword, highest degree first: zero for both j = 1, 2 when nothing is wrong. Exported for the tests. */
export function syndrome(code: readonly number[], j: 1 | 2): number {
  let s = 0;
  for (const c of code) s = mul(s, EXP[j]!) ^ c;
  return s;
}

// ---- Bits and symbols ----------------------------------------------------------------------

function checkByte(secret: Uint8Array): number {
  const h = sha256(concat(DOMAIN, secret));
  const b = h[0]!;
  wipe(h);
  return b;
}

/** 32 bytes and their check byte as 24 symbols of 11 bits, then the 2 check symbols. */
function symbolsOf(secret: Uint8Array): number[] {
  if (secret.length !== OUT_OF_BAND_BYTES) throw new PairKeyError("Only a 32-byte out-of-band secret is written out");
  checkOutOfBand(secret);
  const bytes = concat(secret, new Uint8Array([checkByte(secret)]));
  const data: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    if (bits >= 11) {
      data.push((acc >> (bits - 11)) & 0x7ff);
      bits -= 11;
      acc &= (1 << bits) - 1;
    }
  }
  wipe(bytes);
  if (data.length !== DATA_SYMBOLS || bits !== 0) throw new PairKeyError("An out-of-band secret didn't fill its symbols");
  return [...data, ...parity(data)];
}

/** The secret back from 26 symbols, or a PairKeyError saying why not. */
function secretOf(symbols: readonly number[]): Bytes {
  if (symbols.length !== OUT_OF_BAND_WORDS) throw new PairKeyError(`An out-of-band secret is ${OUT_OF_BAND_WORDS} words`);
  if (syndrome(symbols, 1) !== 0 || syndrome(symbols, 2) !== 0) throw new PairKeyError("A word or character is wrong: the check doesn't match");
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const s of symbols.slice(0, DATA_SYMBOLS)) {
    acc = (acc << 11) | s;
    bits += 11;
    while (bits >= 8) {
      bytes.push((acc >> (bits - 8)) & 0xff);
      bits -= 8;
      acc &= (1 << bits) - 1;
    }
  }
  const secret = new Uint8Array(bytes.slice(0, OUT_OF_BAND_BYTES));
  const ok = checkByte(secret) === bytes[OUT_OF_BAND_BYTES];
  bytes.fill(0);
  if (!ok) {
    wipe(secret);
    throw new PairKeyError("A word or character is wrong: the check doesn't match");
  }
  checkOutOfBand(secret);
  return secret;
}

// ---- Words ---------------------------------------------------------------------------------

const BY_PREFIX = new Map<string, number>();
WORDS.forEach((w, i) => {
  BY_PREFIX.set(w, i);
  if (w.length > 4) BY_PREFIX.set(w.slice(0, 4), i);
});

/** A 32-byte secret as 26 words, separated by single spaces. */
export function outOfBandToWords(secret: Uint8Array): string {
  return symbolsOf(secret)
    .map((s) => WORDS[s]!)
    .join(" ");
}

/** The secret back from its words (or their first four letters), any case, spaces, commas or dashes between. */
export function outOfBandFromWords(typed: string): Bytes {
  const words = typed.toLowerCase().split(/[\s,.-]+/).filter(Boolean);
  if (words.length !== OUT_OF_BAND_WORDS) throw new PairKeyError(`An out-of-band secret is ${OUT_OF_BAND_WORDS} words, not ${words.length}`);
  const symbols = words.map((w, i) => {
    const s = BY_PREFIX.get(w);
    if (s === undefined) throw new PairKeyError(`Word ${i + 1} isn't on the list`);
    return s;
  });
  return secretOf(symbols);
}

// ---- The code (for a QR code) --------------------------------------------------------------

/** A 32-byte secret as "PNW-OOB1:" and 58 base32 characters. */
export function outOfBandToCode(secret: Uint8Array): string {
  let acc = 0;
  let bits = 0;
  let out = "";
  for (const s of symbolsOf(secret)) {
    acc = (acc << 11) | s;
    bits += 11;
    while (bits >= 5) {
      out += ALPHABET[(acc >> (bits - 5)) & 31];
      bits -= 5;
      acc &= (1 << bits) - 1;
    }
  }
  out += ALPHABET[(acc << (5 - bits)) & 31]; // the last bit, padded with four zero bits
  return CODE_PREFIX + out;
}

/** The secret back from its code, as scanned or typed. */
export function outOfBandFromCode(typed: string): Bytes {
  const upper = typed.trim().toUpperCase();
  if (!upper.startsWith(CODE_PREFIX)) throw new PairKeyError(`An out-of-band code starts ${CODE_PREFIX}`);
  const clean = upper.slice(CODE_PREFIX.length).replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (clean.length !== CODE_CHARS) throw new PairKeyError(`An out-of-band code has ${CODE_CHARS} characters after ${CODE_PREFIX}`);
  const symbols: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of clean) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new PairKeyError("An out-of-band code has a character that isn't in it");
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 11) {
      symbols.push((acc >> (bits - 11)) & 0x7ff);
      bits -= 11;
      acc &= (1 << bits) - 1;
    }
  }
  if (bits !== 4 || acc !== 0) throw new PairKeyError("A word or character is wrong: the check doesn't match");
  return secretOf(symbols);
}
