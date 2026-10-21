// ---------------------------------------------------------------------------
// What a new passphrase must be, how strong it looks, and a strong one to
// suggest (Joshua, 2026-10-20). The passphrase is the one thing standing
// between a stolen device or backup file and everything in the vault: the
// vault can be copied and guessed at offline, with no lockout, so the rules
// aim at what offline guessing tries first.
//
//   rules:     at least 12 characters, with a letter and a space or symbol
//              (a space counts, so plain words like "copper lantern river"
//              pass); not built on a common password or the account's own
//              username (or email); not one character repeated.
//   meter:     a conservative estimate in bits. Words from the suggestion list
//              count 11 bits each; anything else counts by the characters it
//              uses, less what repeats and runs give away.
//   suggest:   five random words from the BIP-39 list (55 bits), drawn with
//              the platform's random source.
//
// Applies to new passphrases only: an existing vault opens with whatever it
// was made with. Pure apart from the random source; no network.
// ---------------------------------------------------------------------------

import { WORDS } from "./passphrase_words";

export const MIN_NEW_PASSPHRASE = 12;
/** Words in a suggested passphrase: 5 × 11 bits. */
export const SUGGESTED_WORDS = 5;

export type Strength = "too weak" | "weak" | "fair" | "strong" | "very strong";
export type PassphraseCheck = {
  /** True when it meets every rule. */
  ok: boolean;
  /** What's missing or wrong, in words to show; empty when ok. */
  problems: string[];
  /** A conservative estimate of how many guesses it would take, in bits. */
  bits: number;
  strength: Strength;
};

const WORD_SET = new Set(WORDS);

// Suggestions leave out the few list words that read as chain jargon on a fiat screen.
const NOT_SUGGESTED = new Set(["token", "coin"]);

// The first things a guessing tool tries, reduced to bare letters (see `skeleton`).
const COMMON = new Set([
  "password", "passphrase", "passwd", "pass", "qwerty", "qwertyuiop", "asdf", "asdfgh", "asdfghjkl", "zxcvbnm",
  "letmein", "welcome", "admin", "administrator", "login", "iloveyou", "loveyou", "trustno", "secret", "changeme",
  "default", "monkey", "dragon", "master", "shadow", "sunshine", "princess", "football", "baseball", "soccer",
  "hockey", "superman", "batman", "starwars", "whatever", "freedom", "hello", "helloworld", "abc", "abcdef",
  "abcdefg", "abcdefgh", "test", "testing", "guest", "user", "root", "god", "jesus", "money", "summer", "winter",
  "spring", "autumn", "fall", "michael", "jordan", "charlie", "love", "flower", "pokemon", "minecraft", "fortnite",
  "computer", "internet", "google", "facebook", "instagram", "hewn", "hewnaccounting", "accounting", "books",
  "business", "payroll", "pnw", "aleo", "shield",
]);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "i", "+": "t" };

/** The letters a guesser would start from: lower-cased, look-alikes undone (or not), numbers and symbols dropped. */
function skeleton(passphrase: string, undoLookAlikes = true): string {
  const lower = passphrase.toLowerCase();
  const undone = undoLookAlikes ? [...lower].map((c) => LEET[c] ?? c).join("") : lower;
  return undone.replace(/[^\p{L}]/gu, "");
}

/** True when the letters are nothing but common passwords run together ("password", "iloveyouhewn"). */
function onlyCommon(letters: string): boolean {
  if (letters.length === 0) return true;
  const can = new Array<boolean>(letters.length + 1).fill(false);
  can[0] = true;
  for (let i = 0; i < letters.length; i++) {
    if (!can[i]) continue;
    for (const w of COMMON) if (letters.startsWith(w, i)) can[i + w.length] = true;
  }
  return can[letters.length]!;
}

const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890", "abcdefghijklmnopqrstuvwxyz"];

/** Characters that add nothing a guesser wouldn't try: repeats ("aaaa"), and runs along a row or the alphabet ("abcd", "4321"). */
function giveaways(text: string): number {
  const s = text.toLowerCase();
  let lost = 0;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!;
    const b = s[i]!;
    if (a === b) {
      lost++;
      continue;
    }
    if (KEYBOARD_ROWS.some((row) => row.includes(a + b) || [...row].reverse().join("").includes(a + b))) lost++;
  }
  return lost;
}

/** The pool a character is drawn from, for the per-character estimate. */
function poolOf(chars: string[]): number {
  let pool = 0;
  if (chars.some((c) => /[a-z]/.test(c))) pool += 26;
  if (chars.some((c) => /[A-Z]/.test(c))) pool += 26;
  if (chars.some((c) => /[0-9]/.test(c))) pool += 10;
  if (chars.some((c) => c === " ")) pool += 1;
  if (chars.some((c) => /[^\p{L}\p{N}\s]/u.test(c) && c.charCodeAt(0) < 128)) pool += 33;
  if (chars.some((c) => c.charCodeAt(0) >= 128)) pool += 100;
  return Math.max(pool, 1);
}

/** A conservative guess-count estimate, in bits. */
export function passphraseBits(raw: string): number {
  const passphrase = raw.normalize("NFKC");
  // Built from list words? Each counts as one pick from 2,048, whatever separates them.
  const tokens = passphrase.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const listWords = tokens.filter((t) => WORD_SET.has(t));
  if (listWords.length >= 3 && listWords.length === tokens.length) {
    const extra = (passphrase.match(/[0-9]/g)?.length ?? 0) * Math.log2(10);
    return Math.round(listWords.length * Math.log2(WORDS.length) + extra);
  }
  const chars = [...passphrase];
  const effective = Math.max(0, chars.length - giveaways(passphrase));
  let bits = effective * Math.log2(poolOf(chars));
  // A common word inside gives most of itself away.
  const letters = skeleton(passphrase);
  for (const w of COMMON) if (w.length >= 4 && letters.includes(w)) bits -= w.length * 3.5;
  // People don't pick characters at random; halve the textbook figure to stay honest.
  return Math.max(0, Math.round(bits / 2));
}

function strengthOf(bits: number): Strength {
  if (bits < 28) return "too weak";
  if (bits < 40) return "weak";
  if (bits < 50) return "fair";
  if (bits < 64) return "strong";
  return "very strong";
}

/** Checks a new passphrase against the rules, with the account's username (or email) so it can't be built from it. */
export function checkNewPassphrase(raw: string, username = ""): PassphraseCheck {
  const passphrase = raw.normalize("NFKC");
  const chars = [...passphrase];
  const problems: string[] = [];
  if (chars.length < MIN_NEW_PASSPHRASE) problems.push(`Use at least ${MIN_NEW_PASSPHRASE} characters`);
  if (!/\p{L}/u.test(passphrase)) problems.push("Include at least one letter");
  if (!/[^\p{L}\p{N}]/u.test(passphrase)) problems.push("Include a space or a symbol (a space between words counts)");
  const builtOnCommon = [skeleton(passphrase), skeleton(passphrase, false)].some((letters) => letters.length > 0 && onlyCommon(letters));
  if (chars.length > 0 && new Set(chars.map((c) => c.toLowerCase())).size <= 2) problems.push("Don't repeat the same character");
  else if (builtOnCommon) problems.push("That's built on a common password; guessing tools try it first");
  const local = username.toLowerCase().split("@")[0]?.replace(/[^\p{L}\p{N}]/gu, "") ?? "";
  if (local.length >= 4 && passphrase.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").includes(local)) problems.push("Don't use your username in it");
  const bits = passphraseBits(passphrase);
  const strength = strengthOf(bits);
  if (problems.length === 0 && strength === "too weak") problems.push("Too easy to guess; add another word");
  return { ok: problems.length === 0, problems, bits, strength };
}

/** Five random words from the list, separated by spaces: about 55 bits. */
export function suggestPassphrase(random: (n: number) => Uint16Array = (n) => crypto.getRandomValues(new Uint16Array(n))): string {
  const picked: string[] = [];
  while (picked.length < SUGGESTED_WORDS) {
    // 65,536 is a multiple of 2,048, so the low 11 bits are an even pick.
    for (const r of random(SUGGESTED_WORDS)) {
      const word = WORDS[r & 0x7ff]!;
      if (!NOT_SUGGESTED.has(word) && !picked.includes(word) && picked.length < SUGGESTED_WORDS) picked.push(word);
    }
  }
  return picked.join(" ");
}
