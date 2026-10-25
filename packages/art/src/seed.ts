// ---------------------------------------------------------------------------
// The randomness every card is drawn from. A card is a pure function of its
// inputs: the same name and record always draw the same card, so the only
// randomness is a seeded generator, never Math.random or a clock. The
// renderer is versioned: a change to the art ships as the next version, and a
// card issued under this one is always drawn with it (docs/HEWN_ART.md).
// ---------------------------------------------------------------------------

/** The art version this package draws. Bump with any change to what a card looks like. */
export const ART_VERSION = 1;

/** mulberry32: a small, fast generator with a 32-bit state. Returns numbers in [0, 1). */
export function mulberry(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the string's UTF-16 code units: the seed a label (a name, a record) gives. */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A generator seeded by a label. */
export const rng = (label: string): (() => number) => mulberry(seedOf(label));

export type Rgb = [number, number, number];

/** `#rrggbb` to its channels. */
export function rgbOf(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error("Not a colour");
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** Channels to `#rrggbb`. */
export function hexOf([r, g, b]: Rgb): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** The colour `t` of the way from `a` to `b` (both `#rrggbb`), as `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return hexOf([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}
