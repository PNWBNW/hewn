// ---------------------------------------------------------------------------
// The coworker directory (Joshua, 2026-10-16): team members at one business
// can find each other and talk privately, only if each of them opts in.
//
// Opting in, the person's app makes a key pair for that business (a separate
// one per business, so nobody can tie them across employers) and sends the
// business a `directory_join` message in their thread: the name they want
// coworkers to see and their public key. The business passes on the list of
// everyone who opted in (`directory`), to each of them. Two coworkers then
// derive a key only they hold (chain/coworkers.ts); the business relays
// public keys and never sees it. Because the business relays the keys, it
// could swap one; a safety code, compared in person, rules that out.
//
// Confirmed names (Joshua, 2026-10-23, the twin-curve way): letters are sealed
// to an account, so a swapped key alone reads nothing; the business would have
// to list an account of its own for a coworker. The app shows, next to each
// coworker, the registered name the chain says owns their account
// (chain/coworker_names.ts), and the business can't make that read as someone
// else's. Kept here a day at a time, so an account is looked up once a day.
//
// Messages between coworkers go as letters on chain, so each entry also
// carries the person's account on the network (Joshua, 2026-10-16: shared on opting in).
// The business adds it from its own link to that person (the account the
// offer went to), never from what the join message says. Lists sent before
// this have no accounts; those coworkers can't be messaged until the
// business sends the list again.
//
// Pure: no I/O, no React.
// ---------------------------------------------------------------------------

import type { Mailbox } from "./mailbox";
import type { Rail } from "./rail";
import { COWORKER_TYPES, PUBLIC_KEY, type Thread, type ThreadItem, validateThread } from "./thread";

export type DirectoryEntry = { name: string; publicKey: string; address?: string };

/** The business's side: who opted in, from the latest join or leave in each linked person's thread. */
export function businessDirectory(rail: Rail | null | undefined, mailbox: Mailbox | null | undefined): (DirectoryEntry & { address: string; workerId: string; partiesKey: string })[] {
  const out: (DirectoryEntry & { address: string; workerId: string; partiesKey: string })[] = [];
  for (const link of rail?.links ?? []) {
    if (link.status !== "linked" || !link.partiesKey) continue;
    const thread = mailbox?.threads?.[link.partiesKey];
    let entry: DirectoryEntry | null = null;
    for (const item of thread?.items ?? []) {
      if (item.mine) continue;
      if (item.body.type === "directory_join") entry = { name: item.body.name, publicKey: item.body.publicKey };
      if (item.body.type === "directory_leave") entry = null;
    }
    if (entry) out.push({ ...entry, address: link.address, workerId: link.workerId, partiesKey: link.partiesKey });
  }
  // One entry per key, whatever someone sends.
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.publicKey) ? false : (seen.add(e.publicKey), true)));
}

/**
 * Linked people who left the directory (or were never in it) but were last
 * sent a list with people in it: they get an empty one, so their app forgets
 * the others.
 */
export function owedEmptyDirectory(rail: Rail | null | undefined, mailbox: Mailbox | null | undefined): { workerId: string; partiesKey: string; address: string }[] {
  const listed = new Set(businessDirectory(rail, mailbox).map((e) => e.workerId));
  const out: { workerId: string; partiesKey: string; address: string }[] = [];
  for (const link of rail?.links ?? []) {
    if (!link.partiesKey || listed.has(link.workerId)) continue;
    let lastSent: number | null = null;
    for (const item of mailbox?.threads?.[link.partiesKey]?.items ?? []) if (item.mine && item.body.type === "directory") lastSent = item.body.entries.length;
    if (lastSent !== null && lastSent > 0) out.push({ workerId: link.workerId, partiesKey: link.partiesKey, address: link.address });
  }
  return out;
}

/** A fingerprint of a directory, to tell whether it changed since it was last sent. */
export const directoryDigest = (entries: readonly DirectoryEntry[]): string =>
  JSON.stringify([...entries].map((e) => [e.publicKey, e.name, e.address ?? ""]).sort((a, b) => (a[0]! < b[0]! ? -1 : 1)));

/** One copy of the list to send: to whom, through which conversation, and what it says. */
export type DirectoryCopy = { workerId: string; partiesKey: string; address: string; entries: DirectoryEntry[] };

/**
 * What the business owes its team when who's in the directory changed since
 * it last sent it: the list to everyone in it, and an empty one to anyone who
 * left. Empty when nothing changed.
 */
export function directoryOutbox(rail: Rail | null | undefined, mailbox: Mailbox | null | undefined): { digest: string; copies: DirectoryCopy[] } {
  const listed = businessDirectory(rail, mailbox);
  const digest = directoryDigest(listed);
  if (digest === (mailbox?.directorySent ?? directoryDigest([]))) return { digest, copies: [] };
  const entries = listed.map(({ name, publicKey, address }) => ({ name, publicKey, address }));
  return {
    digest,
    copies: [
      ...listed.map((e) => ({ workerId: e.workerId, partiesKey: e.partiesKey, address: e.address, entries })),
      ...owedEmptyDirectory(rail, mailbox).map((o) => ({ ...o, entries: [] })),
    ],
  };
}

/** The person's side: the latest list the business sent through this thread. */
export function coworkersFrom(thread: Thread | undefined): DirectoryEntry[] {
  let latest: DirectoryEntry[] = [];
  for (const item of thread?.items ?? []) if (!item.mine && item.body.type === "directory") latest = item.body.entries;
  return latest;
}

/** A short, stable tag for a coworker: the start of their public key (after the 04 prefix). Safe in an address bar. */
export const coworkerTag = (publicKey: string): string => publicKey.slice(2, 18);

// ---- The person's vault -------------------------------------------------------

/** The person's key pair for one business's directory. The private half never leaves the vault. */
export type Identity = { publicKey: string; privateKey: JsonWebKey; createdAt: string; listed: boolean; name: string };

/** A conversation with one coworker, by their public key. */
export type CoworkerThread = Thread & {
  /** The business they share (its parties key with this person). */
  businessKey: string;
  name: string;
  /** When this person confirmed the safety code with them in person. */
  verifiedAt?: string;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const HEX64 = /^[0-9a-f]{64}$/;

export class DirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectoryError";
  }
}

export function validateIdentity(raw: unknown): Identity {
  if (!isObject(raw)) throw new DirectoryError("An identity must be an object");
  if (typeof raw.publicKey !== "string" || !PUBLIC_KEY.test(raw.publicKey)) throw new DirectoryError("An identity needs its public key");
  const jwk = raw.privateKey;
  if (!isObject(jwk) || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.d !== "string" || typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new DirectoryError("An identity needs its private key");
  }
  if (!isStamp(raw.createdAt)) throw new DirectoryError("An identity needs the time it was made");
  if (typeof raw.listed !== "boolean") throw new DirectoryError("An identity must say whether it's listed");
  if (typeof raw.name !== "string" || [...raw.name].length > 60) throw new DirectoryError("A directory name is at most 60 characters");
  return { publicKey: raw.publicKey, privateKey: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d }, createdAt: raw.createdAt, listed: raw.listed, name: raw.name };
}

export function validateCoworkerThread(raw: unknown): CoworkerThread {
  if (!isObject(raw)) throw new DirectoryError("A coworker thread must be an object");
  const thread = validateThread(raw);
  // Between coworkers, only what a coworker may send (the same list the reader takes).
  if (thread.items.some((i: ThreadItem) => !COWORKER_TYPES.includes(i.body.type))) throw new DirectoryError("That kind of message doesn't travel between coworkers");
  if (typeof raw.businessKey !== "string" || !HEX64.test(raw.businessKey)) throw new DirectoryError("A coworker thread needs its business");
  if (typeof raw.name !== "string" || [...raw.name].length > 60) throw new DirectoryError("A coworker's name is at most 60 characters");
  const out: CoworkerThread = { ...thread, businessKey: raw.businessKey, name: raw.name };
  if (raw.verifiedAt !== undefined) {
    if (!isStamp(raw.verifiedAt)) throw new DirectoryError("Verified must be a time");
    out.verifiedAt = raw.verifiedAt;
  }
  return out;
}

/** A registered name as the chain confirmed it for an account, and when; `kind` is there for a business's (a person's has none). */
export type ConfirmedName = { name: string; checkedAt: string; kind?: "business" };

/** How long a confirmed name is shown before the chain is asked again. */
export const CONFIRM_AGAIN_MS = 24 * 60 * 60 * 1000;
/** The most accounts kept; past it the longest unchecked go first. */
export const MAX_CONFIRMED_NAMES = 2_000;
const REGISTERED_NAME = /^[a-z0-9_]{3,16}$/;

export function validateConfirmedName(raw: unknown): ConfirmedName {
  if (!isObject(raw)) throw new DirectoryError("A confirmed name must be an object");
  if (typeof raw.name !== "string" || !REGISTERED_NAME.test(raw.name)) throw new DirectoryError("A confirmed name is a registered name");
  if (!isStamp(raw.checkedAt)) throw new DirectoryError("A confirmed name needs the time it was checked");
  if (raw.kind !== undefined && raw.kind !== "business") throw new DirectoryError("A confirmed name is a person's or a business's");
  return raw.kind === "business" ? { name: raw.name, checkedAt: raw.checkedAt, kind: "business" } : { name: raw.name, checkedAt: raw.checkedAt };
}

/** Whether to ask the chain again: never asked, a day old, or stamped in the future. */
export function confirmAgainDue(kept: ConfirmedName | undefined, now: number): boolean {
  if (!kept) return true;
  const at = Date.parse(kept.checkedAt);
  return !Number.isFinite(at) || at > now || now - at >= CONFIRM_AGAIN_MS;
}
