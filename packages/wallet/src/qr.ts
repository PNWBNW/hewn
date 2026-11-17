// A small QR code encoder: text in, a grid of dark and light modules out, then an SVG path.
//
// Written here rather than taken from npm so the app's pages run no new third-party code
// (docs/THREAT_MODEL.md T3) for the one thing that needs it: showing Shield's pairing link to a
// phone camera (./desktop_pairing.ts). Byte mode only (the text as UTF-8), versions 1 to 40, all four
// error-correction levels, the eight masks scored by the standard's penalty rules. It follows
// ISO/IEC 18004 as laid out in Project Nayuki's reference encoder (MIT); the test decodes what this
// draws with an independent reader (jsQR, a dev dependency only) at every version and level.
//
// Pure: no DOM, no randomness, nothing logged. What it is given may be a secret (a pairing link),
// so it is never stored or printed here.

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

/** The modules, row by row: `true` is dark. Square, 21 + 4 × (version − 1) on a side. */
export interface QrCode {
  version: number;
  size: number;
  modules: boolean[][];
}

const FORMAT_BITS: Record<QrErrorCorrection, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Error-correction codewords per block, and the number of blocks, by level and version (index 0 unused).
const ECC_PER_BLOCK: Record<QrErrorCorrection, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const NUM_BLOCKS: Record<QrErrorCorrection, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/** Modules left for data and error correction once every fixed pattern is drawn. */
/** One entry of the tables above; the version is always 1 to 40 here. */
function table(rows: Record<QrErrorCorrection, number[]>, ecl: QrErrorCorrection, version: number): number {
  return rows[ecl][version]!;
}

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** How many 8-bit data codewords a code of this version and level holds. */
export function dataCapacity(version: number, ecl: QrErrorCorrection): number {
  return Math.floor(rawDataModules(version) / 8) - table(ECC_PER_BLOCK, ecl, version) * table(NUM_BLOCKS, ecl, version);
}

export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.floor((version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

// --- Reed-Solomon over GF(2^8), modulus x^8 + x^4 + x^3 + x^2 + 1 ---

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j] = result[j]! ^ result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] = result[i]! ^ gfMultiply(coef, factor);
    });
  }
  return result;
}

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

/** The smallest version that holds `byteLength` bytes in byte mode at this level, or 0 if none does. */
function chooseVersion(byteLength: number, ecl: QrErrorCorrection): number {
  for (let version = 1; version <= 40; version++) {
    const countBits = version < 10 ? 8 : 16;
    if (4 + countBits + byteLength * 8 <= dataCapacity(version, ecl) * 8) return version;
  }
  return 0;
}

/**
 * Encodes `text` as a QR code in byte mode. Throws if it is longer than a version-40 code holds at
 * this level (2953 bytes at L). The message never names the text.
 */
export function encodeQr(text: string, ecl: QrErrorCorrection = "M"): QrCode {
  const bytes = Array.from(new TextEncoder().encode(text));
  const version = chooseVersion(bytes.length, ecl);
  if (version === 0) throw new RangeError(`too long for a QR code (${bytes.length} bytes)`);
  const capacityBits = dataCapacity(version, ecl) * 8;

  // Mode indicator, character count, the bytes, terminator, padding.
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) append(b, 8);
  append(0, Math.min(4, capacityBits - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) append(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));

  const codewords = addEccAndInterleave(data, version, ecl);
  return drawCode(version, ecl, codewords);
}

function addEccAndInterleave(data: number[], version: number, ecl: QrErrorCorrection): number[] {
  const numBlocks = table(NUM_BLOCKS, ecl, version);
  const blockEccLen = table(ECC_PER_BLOCK, ecl, version);
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      // The padding byte added to each short block is not a codeword.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

function drawCode(version: number, ecl: QrErrorCorrection, codewords: number[]): QrCode {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y]![x] = dark;
    isFunction[y]![x] = true;
  };

  // Timing patterns, then the three finder patterns over them, then alignment patterns.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finders: Array<[number, number]> = [[3, 3], [size - 4, 3], [3, size - 4]];
  for (const [cx, cy] of finders) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const align = alignmentPositions(version);
  const numAlign = align.length;
  for (let i = 0; i < numAlign; i++) {
    for (let j = 0; j < numAlign; j++) {
      // The three corners already hold finder patterns.
      if ((i === 0 && j === 0) || (i === 0 && j === numAlign - 1) || (i === numAlign - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(align[i]! + dx, align[j]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  drawFormatBits(set, size, ecl, 0); // reserves the format areas; redrawn with the chosen mask below
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }

  // The codewords, in two-column zigzags from the bottom right, skipping the vertical timing column.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y]![x] && i < codewords.length * 8) {
          modules[y]![x] = getBit(codewords[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
    }
  }

  // Every mask decodes; the standard picks the one with the lowest penalty.
  let best: boolean[][] | null = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = modules.map((row) => row.slice());
    applyMask(candidate, isFunction, mask);
    drawFormatBits((x, y, dark) => (candidate[y]![x] = dark), size, ecl, mask);
    const penalty = penaltyScore(candidate);
    if (penalty < bestPenalty) {
      best = candidate;
      bestPenalty = penalty;
    }
  }
  return { version, size, modules: best as boolean[][] };
}

function drawFormatBits(set: (x: number, y: number, dark: boolean) => void, size: number, ecl: QrErrorCorrection, mask: number): void {
  const data = (FORMAT_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i <= 5; i++) set(8, i, getBit(bits, i));
  set(8, 7, getBit(bits, 6));
  set(8, 8, getBit(bits, 7));
  set(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, getBit(bits, i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, getBit(bits, i));
  set(8, size - 8, true); // the dark module
}

function applyMask(modules: boolean[][], isFunction: boolean[][], mask: number): void {
  const size = modules.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFunction[y]![x]) continue;
      let invert: boolean;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (invert) modules[y]![x] = !modules[y]![x];
    }
  }
}

/** The standard's four penalty rules: runs, 2×2 blocks, finder-like patterns, dark/light balance. */
export function penaltyScore(modules: boolean[][]): number {
  const size = modules.length;
  let penalty = 0;
  const line = (get: (i: number) => boolean) => {
    let runColor = get(0);
    let runLength = 1;
    for (let i = 1; i < size; i++) {
      if (get(i) === runColor) {
        runLength++;
      } else {
        if (runLength >= 5) penalty += 3 + (runLength - 5);
        runColor = get(i);
        runLength = 1;
      }
    }
    if (runLength >= 5) penalty += 3 + (runLength - 5);
    // 1:1:3:1:1 dark-light-dark-dark-dark-light-dark with four light modules on one side.
    const finder = [true, false, true, true, true, false, true];
    for (let i = 0; i + 7 <= size; i++) {
      if (!finder.every((dark, k) => get(i + k) === dark)) continue;
      const lightBefore = i >= 4 && [1, 2, 3, 4].every((k) => !get(i - k));
      const lightAfter = i + 11 <= size && [7, 8, 9, 10].every((k) => !get(i + k));
      if (lightBefore || lightAfter) penalty += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => modules[y]![x]!);
  for (let x = 0; x < size; x++) line((y) => modules[y]![x]!);
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y]![x];
      if (c === modules[y]![x + 1] && c === modules[y + 1]![x] && c === modules[y + 1]![x + 1]) penalty += 3;
    }
  }
  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  penalty += Math.max(0, k) * 10;
  return penalty;
}

/**
 * One SVG path for the dark modules, in module units, offset by a light border (the "quiet zone";
 * the standard asks for four modules). Drawn as `<path d=… />` on a light square of `size + 2 × border`.
 */
export function qrSvgPath(code: QrCode, border = 4): { d: string; viewBox: number } {
  const parts: string[] = [];
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.modules[y]![x]) parts.push(`M${x + border},${y + border}h1v1h-1z`);
    }
  }
  return { d: parts.join(""), viewBox: code.size + border * 2 };
}
