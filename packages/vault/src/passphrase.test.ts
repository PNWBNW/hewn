// New passphrases (passphrase.ts): the rules, the meter and the suggestion.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MIN_NEW_PASSPHRASE, SUGGESTED_WORDS, checkNewPassphrase, passphraseBits, suggestPassphrase } from "./passphrase";
import { WORDS } from "./passphrase_words";

const EMAIL = "jane.doe@example.com";

describe("the word list", () => {
  it("is the published BIP-39 English list, unchanged", () => {
    expect(WORDS).toHaveLength(2048);
    expect(createHash("sha256").update(`${WORDS.join("\n")}\n`).digest("hex")).toBe("2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda");
  });
});

describe("the rules", () => {
  it("accept long passphrases with a letter and a space or symbol", () => {
    for (const p of ["copper lantern river ninth", "correct horse battery staple", "exile bachelor acid tobacco artwork", "Kx7#mP2$vQ9!"]) {
      expect(checkNewPassphrase(p, EMAIL)).toMatchObject({ ok: true, problems: [] });
    }
  });

  it("need 12 characters, a letter, and a space or symbol", () => {
    expect(MIN_NEW_PASSPHRASE).toBe(12);
    expect(checkNewPassphrase("short one!", EMAIL).problems).toContain("Use at least 12 characters");
    expect(checkNewPassphrase("123456 7890 !!", EMAIL).problems).toContain("Include at least one letter");
    expect(checkNewPassphrase("copperlanternriver", EMAIL).problems).toContain("Include a space or a symbol (a space between words counts)");
  });

  it("refuse what guessing tools try first, even when it meets the rules", () => {
    for (const p of ["Password123!", "P@ssw0rd2024!", "letmein letmein", "iloveyouhewn!", "qwertyuiop!1", "hewnhewnhewn!"]) {
      const r = checkNewPassphrase(p, EMAIL);
      expect(r.ok, p).toBe(false);
    }
    expect(checkNewPassphrase("Password123!", EMAIL).problems).toContain("That's built on a common password; guessing tools try it first");
    expect(checkNewPassphrase("aaaaaaaaaaaa!", EMAIL).problems).toContain("Don't repeat the same character");
  });

  it("refuse a passphrase built from the account's own username or email", () => {
    expect(checkNewPassphrase("jane.doe 2026 river!", EMAIL).problems).toContain("Don't use your username in it");
    expect(checkNewPassphrase("copper.fox 2026 river!", "copperfox").problems).toContain("Don't use your username in it");
    expect(checkNewPassphrase("jane.doe 2026 river!", "someone@else.org").ok).toBe(true);
  });

  it("count characters, not bytes, after normalising", () => {
    expect(checkNewPassphrase("🌲🌲🌲 pine 🌲🌲🌲", EMAIL).problems).not.toContain("Use at least 12 characters");
    expect(checkNewPassphrase("🌲 pine 🌲", EMAIL).problems).toContain("Use at least 12 characters");
  });
});

describe("the meter", () => {
  it("counts list words at 11 bits each and grows with each word", () => {
    expect(passphraseBits("exile bachelor acid tobacco")).toBe(44);
    expect(passphraseBits("exile bachelor acid tobacco artwork")).toBe(55);
    expect(checkNewPassphrase("exile bachelor acid tobacco artwork").strength).toBe("strong");
  });

  it("rates common and patterned passphrases as weak or worse", () => {
    for (const p of ["Password123!", "qwertyuiop!1", "summer 2026!"]) {
      expect(["too weak", "weak"], p).toContain(checkNewPassphrase(p).strength);
    }
  });
});

describe("the suggestion", () => {
  it("is five distinct list words that pass the rules", () => {
    const s = suggestPassphrase();
    const words = s.split(" ");
    expect(words).toHaveLength(SUGGESTED_WORDS);
    expect(new Set(words).size).toBe(SUGGESTED_WORDS);
    for (const w of words) expect(WORDS).toContain(w);
    expect(checkNewPassphrase(s, EMAIL)).toMatchObject({ ok: true, bits: 55 });
  });

  it("differs every time and skips the words that read as jargon", () => {
    expect(suggestPassphrase()).not.toBe(suggestPassphrase());
    // A source that only ever lands on "token" (index 1836) and "coin" (index 363) then others.
    const forced = [1823, 363, 0, 1, 2, 3, 4];
    let i = 0;
    const s = suggestPassphrase((n) => Uint16Array.from({ length: n }, () => forced[i++ % forced.length]!));
    expect(s.split(" ")).not.toContain("token");
    expect(s.split(" ")).not.toContain("coin");
  });
});
