// The wrapper's own behaviour around the module: its sizes, what it refuses, implicit rejection,
// a changed public key, the module's shape (no imports, four functions), that the bytes it loads
// are the committed build, and that nothing of a key or a secret stays in the module's memory.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HQC5_WASM_BASE64, HQC5_WASM_BYTES, HQC5_WASM_SHA256 } from "./hqc5_wasm";
import {
  ALGORITHM,
  CIPHERTEXT_BYTES,
  ENCAPSULATION_RANDOM_BYTES,
  HqcError,
  IMPLEMENTATION,
  PUBLIC_KEY_BYTES,
  SECRET_KEY_BYTES,
  SEED_BYTES,
  SHARED_SECRET_BYTES,
  decapsulate,
  encapsulate,
  isHqc5PublicKey,
  keygen,
} from "./index";
import { hqc5, run } from "./module";

const ROOT = join(__dirname, "..");
const seed = (fill: number) => new Uint8Array(SEED_BYTES).fill(fill);
const random = (fill: number) => new Uint8Array(ENCAPSULATION_RANDOM_BYTES).fill(fill);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe("HQC-5's sizes", () => {
  it("are the specification's for the category-5 level", async () => {
    expect([PUBLIC_KEY_BYTES, SECRET_KEY_BYTES, CIPHERTEXT_BYTES, SHARED_SECRET_BYTES, SEED_BYTES, ENCAPSULATION_RANDOM_BYTES]).toEqual([7237, 32, 14421, 32, 32, 48]);
    expect(ALGORITHM).toBe("HQC-5");
    expect(IMPLEMENTATION).toBe("HQC-5, specification v5.1, reference v5.1.0 of 2026-10-26");
    const { publicKey, secretKey } = await keygen(seed(1));
    const { cipherText, sharedSecret } = await encapsulate(publicKey);
    expect([publicKey.length, secretKey.length, cipherText.length, sharedSecret.length]).toEqual([7237, 32, 14421, 32]);
  });

  it("keep the secret key as the seed itself", async () => {
    const s = randomBytes(SEED_BYTES);
    expect(same((await keygen(s)).secretKey, s)).toBe(true);
  });
});

describe("a round trip", () => {
  it("agrees on the secret, with fresh randomness each time", async () => {
    const { publicKey, secretKey } = await keygen(randomBytes(SEED_BYTES));
    const a = await encapsulate(publicKey);
    const b = await encapsulate(publicKey);
    expect(same(a.cipherText, b.cipherText)).toBe(false);
    expect(same(a.sharedSecret, b.sharedSecret)).toBe(false);
    expect(same(await decapsulate(secretKey, a.cipherText), a.sharedSecret)).toBe(true);
    expect(same(await decapsulate(secretKey, b.cipherText), b.sharedSecret)).toBe(true);
  });

  it("is repeatable from fixed randomness, and a seed makes one key pair", async () => {
    const one = await keygen(seed(7));
    const two = await keygen(seed(7));
    expect(same(one.publicKey, two.publicKey)).toBe(true);
    const a = await encapsulate(one.publicKey, random(3));
    const b = await encapsulate(one.publicKey, random(3));
    expect(same(a.cipherText, b.cipherText) && same(a.sharedSecret, b.sharedSecret)).toBe(true);
    expect(same((await keygen(seed(8))).publicKey, one.publicKey)).toBe(false);
  });

  it("leaves the caller's inputs as they were", async () => {
    const s = seed(9);
    const r = random(5);
    const { publicKey, secretKey } = await keygen(s);
    const pk = publicKey.slice();
    const { cipherText } = await encapsulate(publicKey, r);
    const ct = cipherText.slice();
    await decapsulate(secretKey, cipherText);
    expect([same(s, seed(9)), same(r, random(5)), same(publicKey, pk), same(cipherText, ct)]).toEqual([true, true, true, true]);
  });
});

describe("what is refused", () => {
  const refused = async (p: Promise<unknown>, message: RegExp) => {
    const e = await p.then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(e).toBeInstanceOf(HqcError);
    expect((e as Error).message).toMatch(message);
  };

  it("a seed, key, ciphertext or randomness of the wrong length", async () => {
    const { publicKey, secretKey } = await keygen(seed(2));
    const { cipherText } = await encapsulate(publicKey, random(1));
    await refused(keygen(new Uint8Array(31)), /^The seed must be 32 bytes, not 31$/);
    await refused(keygen(new Uint8Array(33)), /^The seed must be 32 bytes, not 33$/);
    await refused(keygen(new Uint8Array(0)), /^The seed must be 32 bytes, not 0$/);
    await refused(encapsulate(publicKey.subarray(1)), /^The public key must be 7237 bytes, not 7236$/);
    await refused(encapsulate(new Uint8Array([...publicKey, 0])), /^The public key must be 7237 bytes, not 7238$/);
    await refused(encapsulate(publicKey, new Uint8Array(47)), /^The encapsulation randomness must be 48 bytes, not 47$/);
    await refused(encapsulate(publicKey, new Uint8Array(49)), /^The encapsulation randomness must be 48 bytes, not 49$/);
    await refused(decapsulate(secretKey.subarray(1), cipherText), /^The secret key must be 32 bytes, not 31$/);
    await refused(decapsulate(secretKey, cipherText.subarray(1)), /^The ciphertext must be 14421 bytes, not 14420$/);
    await refused(decapsulate(secretKey, new Uint8Array([...cipherText, 0])), /^The ciphertext must be 14421 bytes, not 14422$/);
  });

  it("the arguments the wrong way round, or not bytes at all", async () => {
    const { publicKey, secretKey } = await keygen(seed(2));
    const { cipherText } = await encapsulate(publicKey);
    await refused(decapsulate(cipherText, secretKey), /^The secret key must be 32 bytes, not 14421$/);
    await refused(keygen("00".repeat(32) as unknown as Uint8Array), /^The seed must be a Uint8Array$/);
    await refused(encapsulate(Array.from(publicKey) as unknown as Uint8Array), /^The public key must be a Uint8Array$/);
    await refused(decapsulate(secretKey, undefined as unknown as Uint8Array), /^The ciphertext must be a Uint8Array$/);
  });

  it("errors that name no secret: the message says what and how long, never the bytes", async () => {
    const s = randomBytes(31);
    const e = (await keygen(s).then(
      () => undefined,
      (err: unknown) => err,
    )) as Error;
    expect(e).toBeInstanceOf(HqcError);
    expect(e.message).not.toContain(s.toString("hex"));
    expect(e.message).not.toContain(s.toString("base64"));
    expect(e.message).not.toMatch(/[0-9a-f]{16}/i);
  });
});

describe("implicit rejection", () => {
  it("a changed ciphertext gives a different secret, never an exception", async () => {
    const { publicKey, secretKey } = await keygen(seed(4));
    const { cipherText, sharedSecret } = await encapsulate(publicKey, random(6));
    // u's first and last bytes (the last carries 5 bits and 3 of padding), v's, and the salt's.
    for (const [at, bit] of [[0, 0], [7204, 0], [7204, 7], [7205, 3], [14404, 1], [14405, 2], [14420, 7]] as const) {
      const changed = cipherText.slice();
      changed[at]! ^= 1 << bit;
      const secret = await decapsulate(secretKey, changed);
      expect(secret, `byte ${at}, bit ${bit}`).toHaveLength(SHARED_SECRET_BYTES);
      expect(same(secret, sharedSecret), `byte ${at}, bit ${bit}`).toBe(false);
      expect(same(await decapsulate(secretKey, changed), secret), `byte ${at}: rejection is deterministic`).toBe(true);
    }
    expect(same(await decapsulate(secretKey, cipherText), sharedSecret)).toBe(true);
  });

  it("another key's secret key gives a different secret", async () => {
    const { publicKey } = await keygen(seed(10));
    const other = await keygen(seed(11));
    const { cipherText, sharedSecret } = await encapsulate(publicKey);
    expect(same(await decapsulate(other.secretKey, cipherText), sharedSecret)).toBe(false);
  });

  it("an all-zero or random ciphertext still gives 32 bytes", async () => {
    const { secretKey } = await keygen(seed(12));
    expect(await decapsulate(secretKey, new Uint8Array(CIPHERTEXT_BYTES))).toHaveLength(32);
    expect(await decapsulate(secretKey, randomBytes(CIPHERTEXT_BYTES))).toHaveLength(32);
  });
});

describe("a changed public key", () => {
  it("is refused when its unused bits aren't zero", async () => {
    const { publicKey } = await keygen(seed(13));
    expect(isHqc5PublicKey(publicKey)).toBe(true);
    for (const bit of [5, 6, 7]) {
      const changed = publicKey.slice();
      changed[PUBLIC_KEY_BYTES - 1]! |= 1 << bit;
      expect(isHqc5PublicKey(changed)).toBe(false);
      await expect(encapsulate(changed)).rejects.toThrow(/^The public key isn't an HQC-5 key: its unused bits aren't zero$/);
    }
    expect(isHqc5PublicKey(new Uint8Array(PUBLIC_KEY_BYTES - 1))).toBe(false);
  });

  it("otherwise encapsulates to a secret the real key's owner doesn't get", async () => {
    const { publicKey, secretKey } = await keygen(seed(14));
    // The seed that makes h (byte 0), and s (its first byte and its last used bit).
    for (const [at, bit] of [[0, 0], [31, 7], [32, 0], [PUBLIC_KEY_BYTES - 1, 4]] as const) {
      const changed = publicKey.slice();
      changed[at]! ^= 1 << bit;
      const { cipherText, sharedSecret } = await encapsulate(changed, random(8));
      const honest = await encapsulate(publicKey, random(8));
      expect(same(sharedSecret, honest.sharedSecret), `byte ${at}`).toBe(false);
      expect(same(await decapsulate(secretKey, cipherText), sharedSecret), `byte ${at}`).toBe(false);
    }
  });
});

describe("the module", () => {
  const embedded = Buffer.from(HQC5_WASM_BASE64, "base64");

  it("is the committed build: dist/hqc5.wasm, its SHA-256 file and the embedded bytes agree", () => {
    const file = readFileSync(join(ROOT, "dist", "hqc5.wasm"));
    const pinned = readFileSync(join(ROOT, "dist", "hqc5.wasm.sha256"), "utf8");
    expect(pinned).toBe(`${HQC5_WASM_SHA256}  hqc5.wasm\n`);
    expect(createHash("sha256").update(file).digest("hex")).toBe(HQC5_WASM_SHA256);
    expect(embedded.equals(file)).toBe(true);
    expect(embedded.length).toBe(HQC5_WASM_BYTES);
  });

  it("imports nothing and exports its memory and four functions only", () => {
    const module = new WebAssembly.Module(embedded);
    expect(WebAssembly.Module.imports(module)).toEqual([]);
    expect(WebAssembly.Module.exports(module)).toEqual([
      { name: "memory", kind: "memory" },
      { name: "hqc5_layout", kind: "function" },
      { name: "hqc5_keygen", kind: "function" },
      { name: "hqc5_encaps", kind: "function" },
      { name: "hqc5_decaps", kind: "function" },
    ]);
    expect(WebAssembly.Module.customSections(module, "name")).toEqual([]);
  });

  it("has a fixed memory: its stack first, then the buffers, none overlapping", async () => {
    const m = await hqc5();
    const size = m.exports.memory.buffer.byteLength;
    expect(size).toBe(10 * 65536);
    expect(() => m.exports.memory.grow(1)).toThrow();
    expect(m.stackLow).toBe(0);
    expect(m.stackHigh).toBe(512 * 1024);
    expect([m.pk, m.ct, m.sk, m.ss, m.rnd].every((at) => at >= m.stackHigh && at < size)).toBe(true);
  });

  it("holds nothing of a key or a secret after each call: every buffer and the stack are zero", async () => {
    const m = await hqc5();
    const zero = () => new Uint8Array(m.exports.memory.buffer).subarray(0, m.rnd + ENCAPSULATION_RANDOM_BYTES).every((b, i) => b === 0 || (i >= m.stackHigh && i < m.pk));
    const { publicKey, secretKey } = await keygen(randomBytes(SEED_BYTES));
    expect(zero()).toBe(true);
    const { cipherText } = await encapsulate(publicKey);
    expect(zero()).toBe(true);
    await decapsulate(secretKey, cipherText);
    expect(zero()).toBe(true);
    const changed = cipherText.slice();
    changed[100]! ^= 1;
    await decapsulate(secretKey, changed);
    expect(zero()).toBe(true);
  });

  it("is scrubbed and replaced after a trap, and the next call works", async () => {
    const m = await hqc5();
    expect(() =>
      run(
        m,
        "decaps",
        (mem) => mem.fill(0xff, m.sk, m.sk + SECRET_KEY_BYTES),
        () => {
          throw new WebAssembly.RuntimeError("unreachable");
        },
      ),
    ).toThrow(/^HQC-5 decaps stopped in the module$/);
    expect(new Uint8Array(m.exports.memory.buffer).subarray(m.sk, m.sk + SECRET_KEY_BYTES).every((b) => b === 0)).toBe(true);
    expect(await hqc5()).not.toBe(m);
    const { publicKey, secretKey } = await keygen(seed(15));
    const { cipherText, sharedSecret } = await encapsulate(publicKey);
    expect(same(await decapsulate(secretKey, cipherText), sharedSecret)).toBe(true);
  });
});
