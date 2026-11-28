// HQC-5 against the HQC team's own 100 known-answer vectors (fixtures/PQCkemKAT_32.rsp, their
// kats/ref/hqc-5 at v5.1.0): every public key, secret key, ciphertext and shared secret, exactly.
//
// The vectors carry each test's 48-byte DRBG seed, not the bytes the scheme drew, so the generator
// is re-run here as NIST's PQCgenKAT does (the reference's lib/nist-rng/rng.c): AES-256 CTR_DRBG
// (SP 800-90A without derivation function), seeded first with the bytes 0..47 to make the 100
// seeds, then reseeded with each one. A test then draws 32 bytes (the KEM seed), 32 (m) and 16
// (the salt), in three separate calls, as hqc_kem_keygen and hqc_kem_encaps do.
import { createCipheriv, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CIPHERTEXT_BYTES, PUBLIC_KEY_BYTES, SECRET_KEY_BYTES, SHARED_SECRET_BYTES, decapsulate, encapsulate, isHqc5PublicKey, keygen } from "./index";

const ROOT = join(__dirname, "..");
const KAT = readFileSync(join(ROOT, "fixtures", "PQCkemKAT_32.rsp"));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "vendor", "manifest.json"), "utf8")) as {
  upstream: { commit: string };
  fixtures: { path: string; upstream_path: string; sha256: string; vectors: number }[];
};
// The official file's SHA-256 as the task that added it found it upstream (and the manifest pins).
const KAT_SHA256 = "e5066df4ec3dbe012d60a4a66ce5e0c2f1996d11af8a8eb66333f15b51095edb";

/** AES-256 CTR_DRBG as NIST's rng.c: no derivation function, no reseed, no personalisation. */
class CtrDrbg {
  private key = Buffer.alloc(32);
  private v = Buffer.alloc(16);

  constructor(entropy: Uint8Array) {
    if (entropy.length !== 48) throw new Error("the DRBG takes 48 bytes of entropy");
    this.update(entropy);
  }

  private block(): Buffer {
    for (let j = 15; j >= 0; j--) {
      if (this.v[j] === 0xff) this.v[j] = 0;
      else {
        this.v[j]!++;
        break;
      }
    }
    const aes = createCipheriv("aes-256-ecb", this.key, null);
    aes.setAutoPadding(false);
    return aes.update(this.v);
  }

  private update(provided: Uint8Array | null): void {
    const temp = Buffer.concat([this.block(), this.block(), this.block()]);
    if (provided) for (let i = 0; i < 48; i++) temp[i]! ^= provided[i]!;
    this.key = temp.subarray(0, 32);
    this.v = Buffer.from(temp.subarray(32, 48));
  }

  /** One call of randombytes(x, n): whole blocks, the last one cut, then the state's update. */
  generate(n: number): Uint8Array {
    const out = Buffer.alloc(n);
    for (let at = 0; at < n; at += 16) this.block().copy(out, at, 0, Math.min(16, n - at));
    this.update(null);
    return new Uint8Array(out);
  }
}

type Vector = { count: number; seed: string; pk: string; sk: string; ct: string; ss: string };

function parse(text: string): Vector[] {
  const out: Vector[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const fields = Object.fromEntries(
      block
        .split("\n")
        .map((line) => line.match(/^(\w+) = ([0-9A-F]*)$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => [m[1]!, m[2]!]),
    );
    if (fields.count === undefined) continue;
    out.push({ count: Number(fields.count), seed: fields.seed!, pk: fields.pk!, sk: fields.sk!, ct: fields.ct!, ss: fields.ss! });
  }
  return out;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex").toUpperCase();
const VECTORS = parse(KAT.toString("utf8"));

describe("HQC-5's known-answer file", () => {
  it("is the official one, as the manifest pins it", () => {
    const digest = createHash("sha256").update(KAT).digest("hex");
    expect(digest).toBe(KAT_SHA256);
    const entry = MANIFEST.fixtures.find((f) => f.path === "fixtures/PQCkemKAT_32.rsp");
    expect(entry).toMatchObject({ upstream_path: "kats/ref/hqc-5/PQCkemKAT_32.rsp", sha256: KAT_SHA256, vectors: 100 });
    expect(KAT.toString("utf8").startsWith("# HQC-5\n")).toBe(true);
  });

  it("holds 100 vectors, counted 0 to 99, at HQC-5's sizes", () => {
    expect(VECTORS.map((v) => v.count)).toEqual([...Array(100).keys()]);
    for (const v of VECTORS) {
      expect([v.seed.length, v.pk.length, v.sk.length, v.ct.length, v.ss.length]).toEqual([96, PUBLIC_KEY_BYTES * 2, SECRET_KEY_BYTES * 2, CIPHERTEXT_BYTES * 2, SHARED_SECRET_BYTES * 2]);
    }
  });

  it("has the seeds NIST's generator makes from the bytes 0..47 (the DRBG here is the KAT's)", () => {
    const master = new CtrDrbg(Uint8Array.from({ length: 48 }, (_, i) => i));
    for (const v of VECTORS) expect(hex(master.generate(48)), `count ${v.count}`).toBe(v.seed);
  });
});

describe("HQC-5 gives the official answers", () => {
  it.each(VECTORS)("count $count: the key pair, the ciphertext and the shared secret, both ways", async (v) => {
    const drbg = new CtrDrbg(Buffer.from(v.seed, "hex"));
    const seed = drbg.generate(32);
    const { publicKey, secretKey } = await keygen(seed);
    expect(hex(publicKey)).toBe(v.pk);
    expect(hex(secretKey)).toBe(v.sk);
    expect(isHqc5PublicKey(publicKey)).toBe(true);
    const random = new Uint8Array([...drbg.generate(32), ...drbg.generate(16)]);
    const { cipherText, sharedSecret } = await encapsulate(publicKey, random);
    expect(hex(cipherText)).toBe(v.ct);
    expect(hex(sharedSecret)).toBe(v.ss);
    expect(hex(await decapsulate(secretKey, cipherText))).toBe(v.ss);
  });
});
