// ---------------------------------------------------------------------------
// Packed bytes, as employer_agreement_v5 carries them (pnw_mvp_v2
// docs/migrations/2026-10-23-agreement-v5.md, "Packed bytes"): 32 bytes travel
// as `[u128; 2]` and 64 as `[u128; 4]`, the high word first, the way
// hewn_letters_v2 packs a lookup. v4's records and inputs are `[u8; N]`
// byte arrays; both forms are read here. Pure, nothing logged.
// ---------------------------------------------------------------------------

const HEX = /^[0-9a-f]*$/;
const WORD = 1n << 128n;

const bare = (hex: string): string => (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();

/** 32 or 64 bytes of hex as the program's packed input: `[hi u128, …, lo u128]`. */
export function packedWords(hex: string, words: 2 | 4): string {
  const clean = bare(hex);
  if (clean.length !== words * 32 || !HEX.test(clean)) throw new Error(`Expected ${words * 16} bytes of hex`);
  const parts: string[] = [];
  for (let i = 0; i < words; i++) parts.push(`${BigInt(`0x${clean.slice(i * 32, (i + 1) * 32)}`)}u128`);
  return `[${parts.join(", ")}]`;
}

/** A `[u8; N]` byte array as the program takes it: `[ 12u8, 255u8, … ]`. */
export function byteWords(hex: string): string {
  const clean = bare(hex);
  if (clean.length % 2 !== 0 || !HEX.test(clean)) throw new Error("Expected whole bytes of hex");
  const bytes: string[] = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(`${parseInt(clean.slice(i, i + 2), 16)}u8`);
  return "[ " + bytes.join(", ") + " ]";
}

/**
 * A record's array field as lower-case hex, whether it is a `[u8; N]` byte array (v4) or packed
 * `u128` words (v5); null when the field is absent, malformed, or not `bytes` long when a length
 * is given.
 */
export function arrayFieldHex(plaintext: string, field: string, bytes?: number): string | null {
  const section = plaintext.match(new RegExp(`${field}:\\s*\\[([^\\]]*)\\]`));
  if (!section?.[1]) return null;
  const u8s = section[1].match(/\d+u8\b/g);
  if (u8s && u8s.length > 0) {
    if (bytes !== undefined && u8s.length !== bytes) return null;
    const values = u8s.map((b) => parseInt(b, 10));
    if (values.some((v) => v > 255)) return null;
    return values.map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  const words = section[1].match(/\d+u128\b/g);
  if (!words || words.length === 0) return null;
  if (bytes !== undefined && words.length * 16 !== bytes) return null;
  let out = "";
  for (const w of words) {
    const n = BigInt(w.slice(0, -4));
    if (n >= WORD) return null;
    out += n.toString(16).padStart(32, "0");
  }
  return out;
}
