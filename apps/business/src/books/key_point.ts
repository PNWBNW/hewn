// ---------------------------------------------------------------------------
// A public key half as the conversations use it: an uncompressed P-256 point
// (`04` + x + y, 65 bytes, lower-case hex). The shape alone says nothing about
// whether the two numbers are a point on the curve, and a key that isn't one
// can't be used for anything later, so a half from the other side is checked
// here, as the browser's WebCrypto would take it, before it is kept: the pattern first,
// then an import. Keys already in the books are not checked again on load
// (the books still open); the places that use them keep a failure to the one
// conversation it belongs to. Nothing here logs a key.
// ---------------------------------------------------------------------------

/** The shape of a public half: `04` + x + y, hex. */
export const PUBLIC_KEY_SHAPE = /^04[0-9a-f]{128}$/;

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

const bytesOf = (hex: string): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Whether `hex` is a P-256 public key WebCrypto takes: the shape, and a point on the curve. */
export async function isP256Point(hex: unknown): Promise<boolean> {
  if (typeof hex !== "string" || !PUBLIC_KEY_SHAPE.test(hex)) return false;
  try {
    await globalThis.crypto.subtle.importKey("raw", bytesOf(hex), ECDH, true, []);
    return true;
  } catch {
    return false;
  }
}

export class KeyPointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyPointError";
  }
}

/** Throws unless `hex` is a P-256 public key; `what` names it in the message ("their key half"). */
export async function assertP256Point(hex: unknown, what: string): Promise<string> {
  if (!(await isP256Point(hex))) throw new KeyPointError(`${what.charAt(0).toUpperCase()}${what.slice(1)} isn't a usable public key`);
  return hex as string;
}
