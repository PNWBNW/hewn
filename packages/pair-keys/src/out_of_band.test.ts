import { WORDS } from "@pnw/vault/passphrase-words";
import { describe, expect, it } from "vitest";
import {
  CODE_PREFIX,
  OUT_OF_BAND_WORDS,
  checkOutOfBand,
  newOutOfBand,
  outOfBandFromCode,
  outOfBandFromWords,
  outOfBandToCode,
  outOfBandToWords,
  syndrome,
} from "./out_of_band";

const SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

describe("an out-of-band secret", () => {
  it("is 32 random bytes when made", () => {
    const a = newOutOfBand();
    const b = newOutOfBand();
    expect(a).toHaveLength(32);
    expect(a).not.toEqual(b);
    expect(() => checkOutOfBand(a)).not.toThrow();
  });

  it("is refused when shorter than 32 bytes, longer than 64, or one byte repeated", () => {
    expect(() => checkOutOfBand(new Uint8Array(31).fill(1))).toThrow(/at least 32 bytes/);
    expect(() => checkOutOfBand(new Uint8Array(0))).toThrow(/at least 32 bytes/);
    expect(() => checkOutOfBand(new Uint8Array(65).fill(1))).toThrow(/at most 64/);
    expect(() => checkOutOfBand(new Uint8Array(32))).toThrow(/one byte repeated/);
    expect(() => checkOutOfBand(new Uint8Array(32).fill(0xff))).toThrow(/one byte repeated/);
    expect(() => checkOutOfBand("ab".repeat(32) as unknown as Uint8Array)).toThrow(/bytes/);
    expect(() => outOfBandToWords(new Uint8Array(40).fill(3).map((x, i) => x + i))).toThrow(/32-byte/);
  });
});

describe("the words", () => {
  it("round-trip, as 26 words of the BIP-39 list", () => {
    const words = outOfBandToWords(SECRET);
    const list = words.split(" ");
    expect(list).toHaveLength(OUT_OF_BAND_WORDS);
    for (const w of list) expect(WORDS).toContain(w);
    expect(outOfBandFromWords(words)).toEqual(SECRET);
    for (let i = 0; i < 20; i++) {
      const s = newOutOfBand();
      expect(outOfBandFromWords(outOfBandToWords(s))).toEqual(s);
    }
  });

  it("forgive case, extra spaces, commas, dashes and words typed by their first four letters", () => {
    const list = outOfBandToWords(SECRET).split(" ");
    expect(outOfBandFromWords(`  ${list.map((w) => w.toUpperCase()).join(",  ")}\n`)).toEqual(SECRET);
    expect(outOfBandFromWords(list.map((w) => w.slice(0, 4)).join("-"))).toEqual(SECRET);
  });

  it("catch every single changed word", () => {
    const list = outOfBandToWords(SECRET).split(" ");
    let tried = 0;
    for (let i = 0; i < list.length; i++) {
      for (const w of WORDS) {
        if (w === list[i]) continue;
        const typed = [...list];
        typed[i] = w;
        expect(() => outOfBandFromWords(typed.join(" ")), `word ${i + 1} as ${w}`).toThrow(/check doesn't match/);
        tried += 1;
      }
    }
    expect(tried).toBe(26 * 2047);
  });

  it("catch two changed words (a sample: the code's distance guarantees all of them)", () => {
    const list = outOfBandToWords(SECRET).split(" ");
    const rand = (n: number) => globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! % n;
    for (let t = 0; t < 3000; t++) {
      const i = rand(26);
      const j = (i + 1 + rand(25)) % 26;
      const typed = [...list];
      typed[i] = WORDS[(WORDS.indexOf(list[i]!) + 1 + rand(2047)) % 2048]!;
      typed[j] = WORDS[(WORDS.indexOf(list[j]!) + 1 + rand(2047)) % 2048]!;
      expect(() => outOfBandFromWords(typed.join(" "))).toThrow(/check doesn't match/);
    }
  });

  it("catch two swapped words, a missing or an extra word, and a word not on the list", () => {
    const list = outOfBandToWords(SECRET).split(" ");
    for (let i = 0; i + 1 < list.length; i++) {
      if (list[i] === list[i + 1]) continue;
      const typed = [...list];
      [typed[i], typed[i + 1]] = [typed[i + 1]!, typed[i]!];
      expect(() => outOfBandFromWords(typed.join(" "))).toThrow(/check doesn't match/);
    }
    expect(() => outOfBandFromWords(list.slice(1).join(" "))).toThrow(/26 words, not 25/);
    expect(() => outOfBandFromWords([...list, "zoo"].join(" "))).toThrow(/26 words, not 27/);
    expect(() => outOfBandFromWords([...list.slice(0, 3), "hewnx", ...list.slice(4)].join(" "))).toThrow(/Word 4 isn't on the list/);
  });

  it("rest on a code of distance 3: both checks are zero for a good word list", () => {
    // Every symbol is a word's index; a codeword has c(α) = c(α²) = 0 in GF(2¹¹).
    const symbols = outOfBandToWords(SECRET)
      .split(" ")
      .map((w) => WORDS.indexOf(w));
    expect(syndrome(symbols, 1)).toBe(0);
    expect(syndrome(symbols, 2)).toBe(0);
    const changed = [...symbols];
    changed[0] = changed[0]! ^ 1;
    expect(syndrome(changed, 1)).not.toBe(0);
  });
});

describe("the code (for a QR code)", () => {
  it("round-trips, in the QR alphanumeric set", () => {
    const code = outOfBandToCode(SECRET);
    expect(code.startsWith(CODE_PREFIX)).toBe(true);
    expect(code).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
    expect(code.length).toBe(CODE_PREFIX.length + 58);
    expect(outOfBandFromCode(code)).toEqual(SECRET);
    for (let i = 0; i < 20; i++) {
      const s = newOutOfBand();
      expect(outOfBandFromCode(outOfBandToCode(s))).toEqual(s);
    }
  });

  it("forgives case, spaces, dashes and I, L, O for 1, 1, 0", () => {
    const code = outOfBandToCode(SECRET);
    const body = code.slice(CODE_PREFIX.length);
    const grouped = body.match(/.{1,4}/g)!.join("-").toLowerCase();
    expect(outOfBandFromCode(` ${CODE_PREFIX.toLowerCase()}${grouped} `)).toEqual(SECRET);
    expect(outOfBandFromCode(CODE_PREFIX + body.replace(/1/g, "L").replace(/0/g, "O"))).toEqual(SECRET);
  });

  it("catches every single changed character", () => {
    const code = outOfBandToCode(SECRET);
    const body = code.slice(CODE_PREFIX.length);
    for (let i = 0; i < body.length; i++) {
      for (const c of ALPHABET) {
        if (c === body[i]) continue;
        const typed = body.slice(0, i) + c + body.slice(i + 1);
        expect(() => outOfBandFromCode(CODE_PREFIX + typed), `character ${i + 1} as ${c}`).toThrow(/check doesn't match/);
      }
    }
  });

  it("refuses another prefix, the wrong length and a stray character", () => {
    const body = outOfBandToCode(SECRET).slice(CODE_PREFIX.length);
    expect(() => outOfBandFromCode(body)).toThrow(/starts PNW-OOB1:/);
    expect(() => outOfBandFromCode(CODE_PREFIX + body.slice(1))).toThrow(/58 characters/);
    expect(() => outOfBandFromCode(CODE_PREFIX + "U" + body.slice(1))).toThrow(/isn't in it/);
  });
});
