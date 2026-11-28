// @pnw/hqc — HQC-5, the HQC team's reference implementation (v5.1.0) compiled to WebAssembly
// (README.md): a key pair from a 32-byte seed, encapsulation, decapsulation. The module imports
// nothing: its randomness is passed in from here (crypto.getRandomValues, or fixed bytes for a
// test), and every buffer it used, its stack included, is zeroed after each call. No network, no
// storage, nothing logged; works the same in a browser and in Node.
import {
  type Bytes,
  CIPHERTEXT_BYTES,
  ENCAPSULATION_RANDOM_BYTES,
  HqcError,
  PUBLIC_KEY_BYTES,
  SECRET_KEY_BYTES,
  SHARED_SECRET_BYTES,
  hqc5,
  run,
} from "./module";

export { CIPHERTEXT_BYTES, ENCAPSULATION_RANDOM_BYTES, HqcError, PUBLIC_KEY_BYTES, SECRET_KEY_BYTES, SHARED_SECRET_BYTES };
export { HQC5_WASM_SHA256 } from "./hqc5_wasm";

export const ALGORITHM = "HQC-5";
/** What this is, as the pair-key format's id 0x03 will name it. */
export const IMPLEMENTATION = "HQC-5, specification v5.1, reference v5.1.0 of 2026-10-26";
/** A key pair's seed. HQC-5's secret key is this seed itself (the reference keeps nothing else). */
export const SEED_BYTES = SECRET_KEY_BYTES;

// The public key is a 32-byte seed, then the vector s of n = 57,637 bits in 7,205 bytes: the last
// byte holds 5 bits, and its top 3 are always zero in a key the scheme makes.
const S_PADDING_MASK = 0xe0;

export type KeyPair = { publicKey: Bytes; secretKey: Bytes };
export type Encapsulation = { cipherText: Bytes; sharedSecret: Bytes };

function bytes(value: unknown, length: number, what: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new HqcError(`${what} must be a Uint8Array`);
  if (value.length !== length) throw new HqcError(`${what} must be ${length} bytes, not ${value.length}`);
  return value;
}

/** True for a public key of the right length whose unused bits are zero, as every key the scheme makes. */
export function isHqc5PublicKey(publicKey: Uint8Array): boolean {
  return publicKey instanceof Uint8Array && publicKey.length === PUBLIC_KEY_BYTES && (publicKey[PUBLIC_KEY_BYTES - 1]! & S_PADDING_MASK) === 0;
}

/** The key pair a 32-byte seed makes (HQC-5's KeyGen from its seed, as the reference's own). */
export async function keygen(seed: Uint8Array): Promise<KeyPair> {
  bytes(seed, SEED_BYTES, "The seed");
  const m = await hqc5();
  return run(
    m,
    "keygen",
    (mem) => mem.set(seed, m.rnd),
    (mem) => ({ publicKey: mem.slice(m.pk, m.pk + PUBLIC_KEY_BYTES), secretKey: mem.slice(m.sk, m.sk + SECRET_KEY_BYTES) }),
  );
}

/**
 * A ciphertext and the shared secret it carries, to a public key. The randomness is fresh from
 * crypto.getRandomValues unless `random` is given: 48 bytes, the message m (32) then the salt (16),
 * the order the reference draws them in. Pass it only to reproduce a known answer: the same
 * randomness twice to one key gives the same secret twice. A key whose unused bits aren't zero is
 * refused.
 */
export async function encapsulate(publicKey: Uint8Array, random?: Uint8Array): Promise<Encapsulation> {
  bytes(publicKey, PUBLIC_KEY_BYTES, "The public key");
  if (!isHqc5PublicKey(publicKey)) throw new HqcError("The public key isn't an HQC-5 key: its unused bits aren't zero");
  if (random !== undefined) bytes(random, ENCAPSULATION_RANDOM_BYTES, "The encapsulation randomness");
  const fresh = random === undefined ? crypto.getRandomValues(new Uint8Array(ENCAPSULATION_RANDOM_BYTES)) : undefined;
  const m = await hqc5();
  try {
    return run(
      m,
      "encaps",
      (mem) => {
        mem.set(publicKey, m.pk);
        mem.set(random ?? fresh!, m.rnd);
      },
      (mem) => ({ cipherText: mem.slice(m.ct, m.ct + CIPHERTEXT_BYTES), sharedSecret: mem.slice(m.ss, m.ss + SHARED_SECRET_BYTES) }),
    );
  } finally {
    fresh?.fill(0);
  }
}

/**
 * The shared secret a ciphertext carries, for the secret key. A ciphertext that wasn't made for this
 * key, or was changed on the way, gives a different, pseudorandom secret rather than an error
 * (HQC's implicit rejection), so a mismatch shows only where the secret is used.
 */
export async function decapsulate(secretKey: Uint8Array, cipherText: Uint8Array): Promise<Bytes> {
  bytes(secretKey, SECRET_KEY_BYTES, "The secret key");
  bytes(cipherText, CIPHERTEXT_BYTES, "The ciphertext");
  const m = await hqc5();
  return run(
    m,
    "decaps",
    (mem) => {
      mem.set(secretKey, m.sk);
      mem.set(cipherText, m.ct);
    },
    (mem) => mem.slice(m.ss, m.ss + SHARED_SECRET_BYTES),
  );
}
