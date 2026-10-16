// ---------------------------------------------------------------------------
// Coworkers talking privately (books/directory.ts has the directory).
//
//   key pair:   ECDH P-256, made on the person's device, one per business;
//               the private half is kept in the vault and never sent
//   pair key:   HKDF-SHA256(ECDH(mine, theirs), salt "PNW::COWORKER::v1",
//               info = the two public keys, lower first) → 32 bytes, used as
//               the mailbox key for the two of them; nobody else can make it,
//               the business included
//   sides:      the lower public key writes `cw_a`, the higher `cw_b`
//               (carried as the thread's "business"/"worker" sides; only
//               plain messages are accepted between coworkers)
//   safety:     SHA-256("PNW::SAFETY::v1" ‖ lower ‖ higher) as 6 groups of 5
//               digits; the same on both phones unless a key was swapped
//
// Nothing here logs a key or a message.
// ---------------------------------------------------------------------------

import type { Identity } from "../books/directory";
import { PUBLIC_KEY, type Side, type ThreadBody } from "../books/thread";
import type { ThreadKinds } from "./thread";

export const COWORKER_KINDS: ThreadKinds = { business: "cw_a", worker: "cw_b" };

/** Between coworkers: plain messages only. */
export const coworkerAccepts = (body: ThreadBody): boolean => body.type === "text";

const subtle = () => globalThis.crypto.subtle;
const hexToBytes = (h: string): Uint8Array<ArrayBuffer> => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

function checkKey(publicKey: string): string {
  if (!PUBLIC_KEY.test(publicKey)) throw new Error("That isn't a coworker's public key");
  return publicKey;
}

/** A fresh key pair for one business's directory. */
export async function newIdentity(name: string, now: Date = new Date()): Promise<Identity> {
  const pair = await subtle().generateKey(ECDH, true, ["deriveBits"]);
  const publicKey = hex(await subtle().exportKey("raw", pair.publicKey));
  const jwk = await subtle().exportKey("jwk", pair.privateKey);
  return { publicKey, privateKey: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d }, createdAt: now.toISOString(), listed: false, name };
}

/** Which side of the thread I write: the lower public key is side a. */
export function mySide(mine: string, theirs: string): Side {
  if (checkKey(mine) === checkKey(theirs)) throw new Error("That's your own key");
  return mine < theirs ? "business" : "worker";
}

/** The key only the two of us can make: 64 hex characters. */
export async function pairKey(me: Identity, theirs: string): Promise<string> {
  checkKey(theirs);
  const priv = await subtle().importKey("jwk", { ...me.privateKey, ext: true }, ECDH, false, ["deriveBits"]);
  const pub = await subtle().importKey("raw", hexToBytes(theirs), ECDH, false, []);
  const shared = await subtle().deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const [lo, hi] = [me.publicKey, theirs].sort();
  const material = await subtle().importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const info = new Uint8Array([...hexToBytes(lo!), ...hexToBytes(hi!)]);
  const bits = await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("PNW::COWORKER::v1"), info }, material, 256);
  return hex(bits);
}

/** The safety code two coworkers compare in person: 30 digits in 6 groups. The same for both of them. */
export async function safetyCode(a: string, b: string): Promise<string> {
  const [lo, hi] = [checkKey(a), checkKey(b)].sort();
  const input = new Uint8Array([...new TextEncoder().encode("PNW::SAFETY::v1"), ...hexToBytes(lo!), ...hexToBytes(hi!)]);
  const digest = new Uint8Array(await subtle().digest("SHA-256", input));
  const groups: string[] = [];
  for (let g = 0; g < 6; g++) {
    // 5 bytes per group, as a number mod 100000: five digits.
    let n = 0;
    for (let i = 0; i < 5; i++) n = (n * 256 + digest[g * 5 + i]!) % 100_000;
    groups.push(n.toString().padStart(5, "0"));
  }
  return groups.join(" ");
}
