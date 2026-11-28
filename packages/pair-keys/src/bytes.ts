// Small byte helpers shared by the modules here. Nothing here logs a value.

export type Bytes = Uint8Array<ArrayBuffer>;

export const HEX = /^(?:[0-9a-f]{2})*$/;

export function fromHex(hex: string, what: string): Bytes {
  if (typeof hex !== "string" || !HEX.test(hex)) throw new PairKeyError(`${what} must be lower-case hex`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A two-byte big-endian length, then the bytes: every variable part of a transcript is framed this way. */
export function framed(b: Uint8Array): Bytes {
  if (b.length > 0xffff) throw new PairKeyError("A part is too long to frame");
  return concat(new Uint8Array([b.length >> 8, b.length & 0xff]), b);
}

/** Zeroes what JavaScript lets us zero: the bytes we hold. Strings and the engine's own copies can't be. */
export function wipe(...parts: (Uint8Array | ArrayBuffer | undefined)[]): void {
  for (const p of parts) if (p) (p instanceof ArrayBuffer ? new Uint8Array(p) : p).fill(0);
}

export class PairKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairKeyError";
  }
}
