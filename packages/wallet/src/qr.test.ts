import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { type QrErrorCorrection, alignmentPositions, dataCapacity, encodeQr, qrSvgPath } from "./qr";

/** Draws the code as RGBA pixels (with the four-module quiet zone) and reads it back with jsQR. */
function decode(text: string, ecl: QrErrorCorrection, scale = 3): { data: string; version: number } | null {
  const code = encodeQr(text, ecl);
  const border = 4;
  const side = (code.size + border * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (!code.modules[y][x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const p = (((y + border) * scale + dy) * side + (x + border) * scale + dx) * 4;
          pixels[p] = pixels[p + 1] = pixels[p + 2] = 0;
        }
      }
    }
  }
  const read = jsQR(pixels, side, side, { inversionAttempts: "dontInvert" });
  return read ? { data: read.data, version: read.version } : null;
}

/** A deterministic text of exactly `bytes` ASCII bytes. */
function textOf(bytes: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789-_.~:/?=&%";
  let out = "";
  for (let i = 0; i < bytes; i++) out += alphabet[(i * 7 + 3) % alphabet.length];
  return out;
}

const LEVELS: QrErrorCorrection[] = ["L", "M", "Q", "H"];

/** The byte-mode capacity of a version at a level (mode and count bits taken out). */
function byteCapacity(version: number, ecl: QrErrorCorrection): number {
  return Math.floor((dataCapacity(version, ecl) * 8 - 4 - (version < 10 ? 8 : 16)) / 8);
}

describe("QR encoder", () => {
  it("draws codes an independent reader decodes, at every version and level, filled to the brim", () => {
    for (const ecl of LEVELS) {
      for (let version = 1; version <= 40; version++) {
        const text = textOf(byteCapacity(version, ecl));
        const code = encodeQr(text, ecl);
        expect(code.version, `${ecl} v${version}`).toBe(version);
        expect(code.size).toBe(version * 4 + 17);
        // jsQR 1.4.0's own table puts version 23's fourth alignment pattern at 74, where the
        // standard puts it at 78 (checked below), so it reads those modules as data and misreads
        // every code of that version; level L has too little error correction to absorb it. M, Q
        // and H at version 23 still decode. The pairing link is a version 10 to 13 code.
        if (ecl === "L" && version === 23) continue;
        const read = decode(text, ecl, version > 30 ? 2 : 3);
        expect(read?.data, `${ecl} v${version}`).toBe(text);
        expect(read?.version).toBe(version);
      }
    }
  }, 120_000);

  it("puts the alignment patterns where the standard's table does", () => {
    expect(alignmentPositions(1)).toEqual([]);
    expect(alignmentPositions(2)).toEqual([6, 18]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(14)).toEqual([6, 26, 46, 66]);
    expect(alignmentPositions(23)).toEqual([6, 30, 54, 78, 102]);
    expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });

  it("chooses the next version up when one byte more is asked", () => {
    for (const ecl of LEVELS) {
      for (const version of [1, 9, 10, 26, 27]) {
        expect(encodeQr(textOf(byteCapacity(version, ecl) + 1), ecl).version).toBe(version + 1);
      }
    }
  });

  it("encodes text as UTF-8 and keeps it whole", () => {
    const text = "Hewn – honest books · ✓ 漢字";
    expect(decode(text, "M")?.data).toBe(text);
  });

  it("decodes short and empty texts", () => {
    for (const text of ["", "a", "shield://connect"]) expect(decode(text, "M")?.data).toBe(text);
  });

  it("refuses text longer than any code holds, without naming it", () => {
    const text = `secret=${"f".repeat(3000)}`;
    expect(() => encodeQr(text, "L")).toThrow(RangeError);
    try {
      encodeQr(text, "L");
    } catch (e) {
      expect((e as Error).message).not.toContain("secret");
    }
  });

  it("is deterministic", () => {
    expect(encodeQr("same text", "Q")).toEqual(encodeQr("same text", "Q"));
  });

  it("draws one path square per dark module, inside the quiet zone", () => {
    const code = encodeQr("hello", "M");
    const { d, viewBox } = qrSvgPath(code);
    expect(viewBox).toBe(code.size + 8);
    const dark = code.modules.flat().filter(Boolean).length;
    expect(d.match(/M/g)?.length).toBe(dark);
    expect(d.startsWith("M4,4")).toBe(true); // the top-left finder's corner, after the 4-module border
  });
});
