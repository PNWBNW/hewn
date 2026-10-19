// ---------------------------------------------------------------------------
// Applying to a posting (docs/JOB_BOARD.md), the private part of the job
// board. The two have no key in common yet, so the first letter makes one:
//
//   hiring key:   ECDH P-256, made by the business for each posting; the
//                 public half rides in the posting's body on the board, the
//                 private half stays in the business's vault
//   applying:     the person makes a one-time key pair, derives
//                 HKDF-SHA256(ECDH(one-time, hiring), salt
//                 "PNW::APPLICATION::v1", info = posting id ‖ one-time
//                 public ‖ hiring public) → the pair's parties key, and
//                 sends one letter to the business under the posting's
//                 application lookup: the one-time public key in the clear,
//                 then the application sealed under that key (the letter
//                 record itself is already encrypted to the business)
//   lookup:       SHA-256("PNW::APPLICATION::v1" ‖ posting id), the same
//                 for every applicant, so the business reads every letter
//                 under it (LetterBox.getAll); each account can send one
//   after:        the business derives the same key from the one-time
//                 public key and its private half, and the two talk in an
//                 ordinary thread (chain/thread.ts) under that key: the
//                 person's side from slot 1 (the application was slot 0),
//                 the business's from slot 0
//
// Nothing here logs a key, a lookup or an application.
// ---------------------------------------------------------------------------

import { MailboxError, open, partiesKeyFromHex, seal } from "@pnw/mailbox";
import type { HiringKey } from "../books/jobs";
import { PUBLIC_KEY, type ThreadItem, type ThreadMessage, ThreadError, validateMessage } from "../books/thread";
import { packPayload, unpackPayload } from "./compress";
import { PAGE_BYTES } from "./letters";

export const APPLICATION_SALT = "PNW::APPLICATION::v1";
/** The document kind the application is sealed as (slot 0 of the person's side). */
export const APPLICATION_KIND = "application";
/** The person's first slot after the application. */
export const APPLICATION_SEQ = 0;

const subtle = () => globalThis.crypto.subtle;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const utf8 = (s: string) => new TextEncoder().encode(s);
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const hexToBytes = (h: string): Uint8Array<ArrayBuffer> => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));
const POSTING_ID = /^[0-9]{1,78}$/;
/** An uncompressed P-256 point: 65 bytes. */
const POINT_BYTES = 65;

export class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationError";
  }
}

const checkPostingId = (id: string): string => {
  if (!POSTING_ID.test(id) || /^0+$/.test(id)) throw new ApplicationError("The posting id isn't valid");
  return id;
};
const checkPoint = (publicKey: string, what: string): string => {
  if (!PUBLIC_KEY.test(publicKey)) throw new ApplicationError(`The ${what} isn't a valid key`);
  return publicKey;
};

/** Where every application to a posting is addressed: the same lookup for every applicant. */
export async function applicationLookup(postingId: string): Promise<string> {
  const digest = await subtle().digest("SHA-256", new Uint8Array([...utf8(APPLICATION_SALT), ...utf8(checkPostingId(postingId))]));
  return hex(digest);
}

/** A fresh hiring key pair for one posting. */
export async function newHiringKey(): Promise<HiringKey> {
  const pair = await subtle().generateKey(ECDH, true, ["deriveBits"]);
  const publicKey = hex(await subtle().exportKey("raw", pair.publicKey));
  const jwk = await subtle().exportKey("jwk", pair.privateKey);
  return { publicKey, privateKey: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d } };
}

/** The parties key from one side's private half and the other's public half: the same from either side. */
async function derive(privateKey: JsonWebKey, theirPublic: string, postingId: string, oneTimePublic: string, hiringPublic: string): Promise<string> {
  const priv = await subtle().importKey("jwk", { ...privateKey, ext: true }, ECDH, false, ["deriveBits"]);
  const pub = await subtle().importKey("raw", hexToBytes(theirPublic), ECDH, false, []);
  const shared = await subtle().deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const material = await subtle().importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const info = new Uint8Array([...utf8(postingId), ...hexToBytes(oneTimePublic), ...hexToBytes(hiringPublic)]);
  const bits = await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: utf8(APPLICATION_SALT), info }, material, 256);
  return hex(bits);
}

/** The applicant's side: a one-time key pair and the parties key it makes with the posting's hiring key. The one-time private half is dropped. */
export async function applicantKey(hiringPublicKey: string, postingId: string): Promise<{ partiesKey: string; oneTimePublicKey: string }> {
  checkPoint(hiringPublicKey, "posting's hiring key");
  checkPostingId(postingId);
  const pair = await subtle().generateKey(ECDH, true, ["deriveBits"]);
  const oneTimePublicKey = hex(await subtle().exportKey("raw", pair.publicKey));
  const jwk = await subtle().exportKey("jwk", pair.privateKey);
  const partiesKey = await derive(jwk, hiringPublicKey, postingId, oneTimePublicKey, hiringPublicKey);
  return { partiesKey, oneTimePublicKey };
}

/** The business's side: the same parties key, from the posting's private half and the one-time public key in the letter. */
export async function businessKey(hiring: HiringKey, oneTimePublicKey: string, postingId: string): Promise<string> {
  checkPoint(oneTimePublicKey, "applicant's key");
  return derive(hiring.privateKey, oneTimePublicKey, checkPostingId(postingId), oneTimePublicKey, hiring.publicKey);
}

/** The letter's parcel: the one-time public key in the clear, then the application sealed under the parties key. */
export async function packApplication(partiesKey: string, oneTimePublicKey: string, message: ThreadMessage): Promise<Uint8Array<ArrayBuffer>> {
  if (message.body.type !== "application" || message.from !== "worker") throw new ApplicationError("That isn't an application");
  const point = hexToBytes(checkPoint(oneTimePublicKey, "one-time key"));
  const bytes = await packPayload(utf8(JSON.stringify(validateMessage(message, "worker"))));
  const key = partiesKeyFromHex(partiesKey);
  try {
    const sealed = await seal(key, APPLICATION_KIND, APPLICATION_SEQ, bytes);
    const parcel = new Uint8Array(POINT_BYTES + sealed.envelope.length);
    parcel.set(point, 0);
    parcel.set(sealed.envelope, POINT_BYTES);
    if (parcel.length > PAGE_BYTES) throw new ApplicationError("The application is too long to send; shorten the resume");
    return parcel;
  } finally {
    key.fill(0);
  }
}

export type OpenedApplication = { partiesKey: string; oneTimePublicKey: string; message: ThreadMessage & { body: Extract<ThreadMessage["body"], { type: "application" }> } };

/** The business opens one application letter with the posting's hiring key. Throws on anything an applicant's app couldn't have sent. */
export async function unpackApplication(hiring: HiringKey, postingId: string, parcel: Uint8Array): Promise<OpenedApplication> {
  if (parcel.length <= POINT_BYTES) throw new ApplicationError("That isn't an application");
  const oneTimePublicKey = hex(parcel.subarray(0, POINT_BYTES));
  const partiesKey = await businessKey(hiring, oneTimePublicKey, postingId);
  const key = partiesKeyFromHex(partiesKey);
  let message: ThreadMessage;
  try {
    const bytes = await open(key, APPLICATION_KIND, APPLICATION_SEQ, parcel.subarray(POINT_BYTES));
    message = validateMessage(JSON.parse(new TextDecoder().decode(await unpackPayload(bytes))), "worker");
  } catch (e) {
    if (e instanceof MailboxError || e instanceof ThreadError || e instanceof SyntaxError) throw new ApplicationError("That application couldn't be opened");
    throw e;
  } finally {
    key.fill(0);
  }
  if (message.body.type !== "application") throw new ApplicationError("That isn't an application");
  if (message.body.postingId !== postingId) throw new ApplicationError("That application is for another posting");
  return { partiesKey, oneTimePublicKey, message: message as OpenedApplication["message"] };
}

/** The application as the person's thread keeps it: slot 0 of their side, so the conversation goes on from slot 1. */
export const applicationItem = (message: ThreadMessage, mine: boolean, receivedAt?: string): ThreadItem => ({ ...message, mine, seq: APPLICATION_SEQ, ...(receivedAt ? { receivedAt } : {}) });
