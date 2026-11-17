import { describe, expect, it } from "vitest";
import { KeyPointError, assertP256Point, isP256Point } from "./key_point";

const subtle = globalThis.crypto.subtle;
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

async function realHalf(): Promise<string> {
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return hex(await subtle.exportKey("raw", pair.publicKey));
}

/** The same x, with y moved by one: the right shape, but not on the curve. */
function yPlusOne(key: string): string {
  const bytes = Uint8Array.from(key.match(/../g)!, (b) => parseInt(b, 16));
  for (let i = 64; i >= 33; i--) {
    bytes[i] = (bytes[i]! + 1) & 0xff;
    if (bytes[i] !== 0) break;
  }
  return hex(bytes);
}

describe("a key half is a point", () => {
  it("takes a public key Web Crypto made", async () => {
    const key = await realHalf();
    expect(await isP256Point(key)).toBe(true);
    await expect(assertP256Point(key, "their key half")).resolves.toBe(key);
  });

  it("refuses the same x with another y", async () => {
    const key = await realHalf();
    expect(await isP256Point(yPlusOne(key))).toBe(false);
    await expect(assertP256Point(yPlusOne(key), "their key half")).rejects.toThrow(KeyPointError);
    await expect(assertP256Point(yPlusOne(key), "their key half")).rejects.toThrow("Their key half isn't a usable public key");
  });

  it("refuses a value of the right shape that isn't on the curve", async () => {
    expect(await isP256Point(`04${"f".repeat(128)}`)).toBe(false);
    expect(await isP256Point(`04${"0".repeat(128)}`)).toBe(false);
  });

  it("refuses the wrong length, prefix, case or type", async () => {
    const key = await realHalf();
    expect(await isP256Point(key.slice(0, -2))).toBe(false);
    expect(await isP256Point(`${key}00`)).toBe(false);
    expect(await isP256Point(`03${key.slice(2, 66)}`)).toBe(false);
    expect(await isP256Point(key.toUpperCase())).toBe(false);
    expect(await isP256Point(undefined)).toBe(false);
    expect(await isP256Point(42)).toBe(false);
  });
});
