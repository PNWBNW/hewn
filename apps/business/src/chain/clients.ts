// ---------------------------------------------------------------------------
// A business and a customer connecting (books/connections.ts), on chain.
//
//   hello:     a letter to the other side's account under
//              SHA-256("PNW::HELLO::v1\n" ‖ their account ‖ "\n" ‖ n), n the
//              sender's first unused one, so a hello can be sent again; it
//              holds the sender's name and a fresh P-256 public key, nothing
//              secret, and is readable only by its owner (the letter record)
//   trust:     a hello counts only when the letter says who sent it and the
//              registry gives that account the right kind of name (a
//              business's, or a person's for a customer); the name shown is
//              the registry's, not the one the hello claims
//   pair key:  ECDH of the two keys, HKDF-SHA256 with salt "PNW::CLIENT::v1"
//              (chain/coworkers.ts `pairKey`), the mailbox key for the two
//   sides:     the business writes `cl_b`, the customer `cl_c` (the thread's
//              "business" and "worker" sides); messages, invoices, voids, payments
//
// Nothing here logs a key, an account or a letter.
// ---------------------------------------------------------------------------

import type { Connection, Hello, HelloSide } from "../books/connections";
import { validateHello } from "../books/connections";
import type { Half } from "../books/key_ring";
import type { ThreadBody } from "../books/thread";
import { pairKey } from "./coworkers";
import { type DirectoryEntry, lookupAddress } from "./directory";
import type { LetterRecord } from "./letters";
import type { ThreadKinds } from "./thread";

export const CLIENT_KINDS: ThreadKinds = { business: "cl_b", worker: "cl_c" };

/** What passes between a business and a customer: plain messages, invoices and their voids, and payments. */
export const CLIENT_TYPES: readonly ThreadBody["type"][] = ["text", "invoice", "invoice_void", "payment"];
export const clientAccepts = (body: ThreadBody): boolean => CLIENT_TYPES.includes(body.type);

/** How many hellos one account may send another (each a fresh place); a reader stops at the first empty one. */
export const MAX_HELLOS = 16;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** Where the `n`th hello to `recipient` goes. */
export const helloLookup = async (recipient: string, n: number): Promise<string> =>
  hex(await globalThis.crypto.subtle.digest("SHA-256", enc.encode(`PNW::HELLO::v1\n${recipient}\n${n}`)));

export const packHello = (hello: Hello): Uint8Array<ArrayBuffer> => enc.encode(JSON.stringify(validateHello(hello)));

/** A hello's bytes → the hello, or null when they aren't one. */
export function unpackHello(bytes: Uint8Array): Hello | null {
  try {
    return validateHello(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export type HelloIn = { sender: string; hello: Hello };

/**
 * Every hello sent to this account, the newest from each sender. Reads place after place until one
 * is empty. Letters whose sender Shield doesn't say are left out: a hello is only as good as who sent it.
 */
export async function readHellos(getAll: (lookup: string) => Promise<LetterRecord[]>, me: string): Promise<HelloIn[]> {
  const latest = new Map<string, Hello>();
  for (let n = 0; n < MAX_HELLOS; n++) {
    const records = await getAll(await helloLookup(me, n));
    if (records.length === 0) break;
    for (const r of records) {
      if (!r.sender || r.sender === me) continue;
      const hello = unpackHello(r.envelope);
      if (hello) latest.set(r.sender, hello);
    }
  }
  return [...latest].map(([sender, hello]) => ({ sender, hello }));
}

/** The first place `me` hasn't used for a hello to `recipient`; null when all are used. */
export async function nextHelloPlace(hasSent: (lookup: string) => Promise<boolean>, recipient: string): Promise<string | null> {
  for (let n = 0; n < MAX_HELLOS; n++) {
    const lookup = await helloLookup(recipient, n);
    if (!(await hasSent(lookup))) return lookup;
  }
  return null;
}

const KIND_FOR: Record<HelloSide, DirectoryEntry["kind"]> = { business: "business", customer: "worker" };

/**
 * The registry's word on a hello: the sender's own name, when it is the kind the hello says (a
 * business's, or a person's for a customer); null otherwise. The name the hello claims is never used.
 */
export async function checkHello(
  { sender, hello }: HelloIn,
  find: (address: string) => Promise<DirectoryEntry> = lookupAddress,
): Promise<{ name: string; nameHash: string } | null> {
  try {
    const entry = await find(sender);
    if (entry.address !== sender || entry.kind !== KIND_FOR[hello.side] || !entry.name) return null;
    return { name: entry.name, nameHash: entry.nameHash.replace(/field$/, "") };
  } catch {
    return null;
  }
}

/** The key the two sides seal everything under, once both hellos are in. */
export async function connectionKey(c: Pick<Connection, "mine" | "theirs">): Promise<string> {
  if (!c.mine || !c.theirs) throw new Error("Not connected yet");
  return pairKey(c.mine as Half, c.theirs, "PNW::CLIENT::v1");
}
