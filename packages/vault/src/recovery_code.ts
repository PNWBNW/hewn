// ---------------------------------------------------------------------------
// The recovery key as people see it: 16 random bytes plus one check byte,
// written as 28 characters of Crockford base32 in seven groups of four
// ("7K3M-…"). No vowels to spell words with, no I, L, O or U to misread;
// reading forgives case, spaces, dashes, and I, L and O typed for 1, 1 and 0.
// The check byte (the first byte of the SHA-256 of the 16) catches almost
// every typo before any key work runs. Pure.
// ---------------------------------------------------------------------------

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_SECRET_BYTES = 16;
const CHARS = 28;

async function checkByte(secret: Uint8Array<ArrayBuffer>): Promise<number> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", secret))[0]!;
}

/** 16 bytes as the code people write down. */
export async function formatRecoveryCode(secret: Uint8Array<ArrayBuffer>): Promise<string> {
  if (secret.length !== RECOVERY_SECRET_BYTES) throw new Error("A recovery key is 16 bytes");
  const bytes = [...secret, await checkByte(secret)];
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  out += ALPHABET[(value << (5 - bits)) & 31]; // the last 4 bits, padded with a zero bit
  return out.match(/.{4}/g)!.join("-");
}

/** The 16 bytes back from a typed code, or null when it isn't one (wrong length, a stray letter, a typo the check byte catches). */
export async function parseRecoveryCode(typed: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const clean = typed.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (clean.length !== CHARS) return null;
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const c of clean) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) return null;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >> (bits - 8)) & 255);
      bits -= 8;
      value &= (1 << bits) - 1;
    }
  }
  if (bytes.length !== RECOVERY_SECRET_BYTES + 1 || value !== 0) return null;
  const secret = new Uint8Array(bytes.slice(0, RECOVERY_SECRET_BYTES));
  return (await checkByte(secret)) === bytes[RECOVERY_SECRET_BYTES] ? secret : null;
}
