// What a version 2 pairing puts on the wire, measured from a real one, against what a letter and a
// page carry (`apps/business/src/chain/letters.ts`, read as text: this package doesn't import the
// app). README.md states the same numbers; a change in either fails here first.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fromHex } from "./bytes";
import { PendingPairV2, answerPairV2 } from "./pair_key";

const LETTERS = readFileSync(join(__dirname, "..", "..", "..", "apps", "business", "src", "chain", "letters.ts"), "utf8");
const constant = (name: string): number => {
  const m = LETTERS.match(new RegExp(`export const ${name} = (\\d+);`));
  if (!m) throw new Error(`letters.ts no longer says ${name}`);
  return Number(m[1]);
};
const FIELD_BYTES = constant("FIELD_BYTES");
const LETTER_BYTES = constant("LETTER_FIELDS") * FIELD_BYTES - 2;
const PAGE_BYTES = constant("PAGE_FIELDS") * FIELD_BYTES - 2;
const base64 = (n: number) => Math.ceil(n / 3) * 4;
const pages = (n: number) => Math.ceil(n / PAGE_BYTES);

describe("the sizes of a version 2 pairing", () => {
  it("reads a letter's and a page's room from letters.ts as it computes them", () => {
    expect(LETTERS).toMatch(/export const LETTER_BYTES = LETTER_FIELDS \* FIELD_BYTES - 2;/);
    expect(LETTERS).toMatch(/export const PAGE_BYTES = PAGE_FIELDS \* FIELD_BYTES - 2;/);
    expect(LETTER_BYTES).toBe(1052);
    expect(PAGE_BYTES).toBe(7934);
  });

  it("is a half of 1,642 bytes and an answer of 1,642: each past a letter, each one page, even as base64", async () => {
    const pending = await PendingPairV2.create();
    const half = fromHex(pending.half, "h").length;
    const { answer: hex } = await answerPairV2({ partiesKey: "ab".repeat(32), half: pending.half });
    const answer = fromHex(hex, "a").length;
    pending.discard();
    expect(half).toBe(3 + (3 + 65) + (3 + 1568));
    expect(half).toBe(1642);
    expect(answer).toBe(1642);
    expect([base64(half), base64(answer)]).toEqual([2192, 2192]);
    for (const n of [half, answer, base64(half), base64(answer)]) {
      expect(n).toBeGreaterThan(LETTER_BYTES);
      expect(pages(n)).toBe(1);
    }
    // Before the answer was trimmed it carried the responder's whole half (1,641 bytes then) and
    // the ciphertexts (1,573): 3,214 bytes. It now carries 1,572 bytes fewer.
    expect(3214 - answer).toBe(1572);
  });
});
