// The letter parser on the generated bindings (docs/VEIL.md step 2), side by side with the hand
// parser it replaced (test/legacy/letters_hand_parser.ts): the same records, the same answers.
// Where the two differ, the difference is written down below, with why.
import { describe, expect, it } from "vitest";
import { handParseLetterRecord } from "../../test/legacy/letters_hand_parser";
import { LETTER_BYTES, LETTER_FIELDS, PAGE_BYTES, PAGE_FIELDS, lookupHalves, packParcel, parseLetterRecord } from "./letters";

const ANA = "aleo1qnr4dkkvkgfqph0vzc3y6z2eu975wnpz2925ntjccd5cfqxtyu8sta57j8";
const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);
const lookupFor = (seed: number) => Array.from({ length: 32 }, (_, i) => ((i * 7 + seed) & 0xff).toString(16).padStart(2, "0")).join("");

/** A record as Shield lists it; `parts` overrides pieces of the plaintext to make it wrong. */
function record(name: string, opts: { lookup?: string; envelope?: Uint8Array; halves?: string[]; fields?: string[]; list?: string; nonce?: boolean; extra?: Record<string, unknown> } = {}) {
  const isPage = name === "Page";
  const [hi, lo] = lookupHalves(opts.lookup ?? lookupFor(3));
  const halves = opts.halves ?? [`${hi}u128`, `${lo}u128`];
  const fields = opts.fields ?? packParcel(opts.envelope ?? bytes(40), isPage ? PAGE_FIELDS : LETTER_FIELDS).map((f) => `${f}field`);
  const list = opts.list ?? (isPage ? "page" : "parcel");
  const nonce = opts.nonce === false ? "" : ",\n  _nonce: 72037856912846704071group.public,\n  _version: 1u8.public";
  const recordPlaintext = `{\n  owner: ${ANA}.private,\n  lookup: [\n${halves.map((h) => `    ${h}.private`).join(",\n")}\n  ],\n  ${list}: [\n${fields.map((f) => `    ${f}.private`).join(",\n")}\n  ]${nonce}\n}`;
  return { recordName: name, recordPlaintext, spent: false, ...opts.extra };
}

const both = (raw: unknown) => ({ generated: parseLetterRecord(raw), hand: handParseLetterRecord(raw) });

describe("the letter parser on generated bindings, beside the hand parser", () => {
  it("read every kind and size of letter the same", () => {
    const sizes = [0, 1, 30, 31, 32, 400, LETTER_BYTES];
    for (const name of ["Letter", "SentLetter"]) {
      for (const [i, n] of sizes.entries()) {
        const r = record(name, { lookup: lookupFor(i), envelope: bytes(n, i), extra: { blockHeight: 12 + i, transactionId: `at1${"q".repeat(58)}`, sender: ANA } });
        const { generated, hand } = both(r);
        expect(generated).not.toBeNull();
        expect(generated).toEqual(hand);
        expect(generated!.envelope).toEqual(bytes(n, i));
      }
    }
    for (const n of [0, LETTER_BYTES + 1, 5000, PAGE_BYTES]) {
      const { generated, hand } = both(record("Page", { envelope: bytes(n) }));
      expect(generated).not.toBeNull();
      expect(generated).toEqual(hand);
    }
  });

  it("read a v1 letter, whose three records are v2's field for field, the same", () => {
    const { generated, hand } = both(record("Letter"));
    expect(generated).toEqual(hand);
  });

  it("both refuse what isn't a letter: other records, missing or wrong-sized fields", () => {
    const refused: unknown[] = [
      null,
      "Letter",
      { recordName: "Letter" },
      { recordName: "Credits", recordPlaintext: record("Letter").recordPlaintext },
      record("Letter", { list: "page" }),
      record("Page", { list: "parcel" }),
      record("Letter", { halves: ["1u128"] }),
      record("Letter", { halves: ["1u128", "2u128", "3u128"] }),
      record("Letter", { fields: Array(LETTER_FIELDS - 1).fill("1field") }),
      record("Letter", { fields: Array(LETTER_FIELDS + 1).fill("1field") }),
      record("Page", { fields: Array(LETTER_FIELDS).fill("1field") }),
      record("Letter", { fields: [`${1n << 248n}field`, ...Array(LETTER_FIELDS - 1).fill("1field")] }),
    ];
    for (const r of refused) expect(both(r)).toEqual({ generated: null, hand: null });
  });

  it("differ only where the generated path is stricter, or where the program's own types make the case impossible", () => {
    // 1. Text without a `_nonce` isn't a record (every record Shield lists has one, and a record
    //    without it can't be spent). The hand parser read the fields anyway; Veil's parseRecord refuses.
    const noNonce = record("Letter", { nonce: false });
    expect(both(noNonce)).toMatchObject({ generated: null, hand: { kind: "letter" } });

    // 2. A lookup half too big for a u128. The hand parser made a lookup of the wrong length from it;
    //    the generated path checks the range.
    const big = record("Letter", { halves: [`${1n << 128n}u128`, "1u128"] });
    expect(both(big).generated).toBeNull();
    expect(both(big).hand?.lookup).toHaveLength(65);

    // 3. The one place the hand parser was stricter: an element written with the wrong type suffix
    //    (a lookup half as a field). The decoders read the number and leave the type to the
    //    program, whose records can't hold anything else; the counts and ranges still apply.
    const [hi, lo] = lookupHalves(lookupFor(3));
    const mistyped = record("Letter", { halves: [`${hi}field`, `${lo}field`] });
    expect(both(mistyped).hand).toBeNull();
    expect(both(mistyped).generated).toEqual(handParseLetterRecord(record("Letter")));
  });
});
