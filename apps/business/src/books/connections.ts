// ---------------------------------------------------------------------------
// A business and a customer connected (docs/CUSTOMERS.md, Step 1). Before
// anything passes between them, each side sends the other a hello: its
// registered name and a fresh public key. Once both hellos are in, each side
// makes the same pair key from its own private key and the other's public
// one (the coworkers' key exchange), and everything after it (messages,
// invoices, payments) is sealed under that key. Either side may start: a
// business connecting a customer it added, or a customer reaching a business
// it found by name.
//
// The private key is kept here, in the vault, and never sent. A hello holds
// nothing secret. Kept on both sides, keyed by the other side's account:
// the business's under `Company.clients`, the customer's under
// `CustomerSide.businesses`.
//
// Pure: no I/O, no React. Anything that arrived is checked before it's kept.
// ---------------------------------------------------------------------------

import type { Half } from "./key_ring";
import { validateHalf } from "./key_ring";
import { PUBLIC_KEY, type Thread, type ThreadItem, validateThread } from "./thread";

/** Who said hello. */
export type HelloSide = "business" | "customer";

/** What a hello carries: who it's from and their public key. Nothing secret. */
export type Hello = { v: 1; type: "hello"; side: HelloSide; name: string; nameHash: string; publicKey: string };

export type Connection = {
  /** The other side's account. */
  address: string;
  /** Their registered name, as their hello or a lookup gave it (checked against the registry). */
  name: string;
  nameHash: string;
  /** My key pair for this connection; the private half never leaves the vault. */
  mine?: Half;
  /** When my hello went out. */
  helloAt?: string;
  /** Their public key, from their hello. */
  theirs?: string;
  /** When their hello arrived. */
  receivedAt?: string;
  /** I turned their request down; their later hellos are ignored until I connect myself. */
  ignored?: true;
  /** On a business's side: the customer record this connection belongs to, once there is one. */
  customerId?: string;
  /** The conversation, once connected. */
  thread?: Thread;
  /** What was said before the connection ended or its key changed: bills, agreements and payments stay readable. */
  past?: ThreadItem[];
  /** When the connection last ended (either side disconnected). */
  endedAt?: string;
  /** Their keys from connections that ended: a hello carrying one is an old letter, not a new request. */
  retired?: string[];
};

export type Connections = Record<string, Connection>;

export type ConnectionState =
  /** Both hellos are in: messages can go both ways. */
  | "connected"
  /** They said hello; I haven't answered. */
  | "asked"
  /** I said hello; waiting for theirs. */
  | "waiting"
  /** Neither yet (a customer added by name, not connected). */
  | "none"
  /** I turned their request down, or I disconnected. */
  | "ignored"
  /** They disconnected; either side can connect again. */
  | "ended";

export function connectionState(c: Connection | undefined): ConnectionState {
  if (!c) return "none";
  if (c.mine && c.theirs) return "connected";
  if (c.ignored) return "ignored";
  if (c.theirs) return "asked";
  if (c.mine && c.helloAt) return "waiting";
  if (c.endedAt) return "ended";
  return "none";
}

export const MAX_CONNECTIONS = 500;
/** The most messages kept from before a connection ended or changed key. */
export const MAX_PAST = 2_000;
const MAX_RETIRED = 32;
const ADDRESS = /^aleo1[02-9ac-hj-np-z]{58}$/;
const NAME = /^[a-z0-9_]{1,32}$/;
const FIELD = /^\d{1,78}$/;

export class ConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionError";
  }
}

const iso = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** A hello as it arrived; throws when it isn't one. */
export function validateHello(raw: unknown): Hello {
  const r = raw as Record<string, unknown> | null;
  if (!r || r.v !== 1 || r.type !== "hello") throw new ConnectionError("That isn't a hello");
  if (r.side !== "business" && r.side !== "customer") throw new ConnectionError("A hello says whether it's from a business or a customer");
  if (typeof r.name !== "string" || !NAME.test(r.name) || typeof r.nameHash !== "string" || !FIELD.test(r.nameHash)) throw new ConnectionError("A hello needs a registered name");
  if (typeof r.publicKey !== "string" || !PUBLIC_KEY.test(r.publicKey)) throw new ConnectionError("A hello needs a public key");
  return { v: 1, type: "hello", side: r.side, name: r.name, nameHash: r.nameHash, publicKey: r.publicKey };
}

export function validateConnection(raw: unknown): Connection {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r.address !== "string" || !ADDRESS.test(r.address)) throw new ConnectionError("A connection needs the other side's account");
  if (typeof r.name !== "string" || !NAME.test(r.name) || typeof r.nameHash !== "string" || !FIELD.test(r.nameHash)) throw new ConnectionError("A connection needs a registered name");
  const out: Connection = { address: r.address, name: r.name, nameHash: r.nameHash };
  if (r.mine !== undefined) out.mine = validateHalf(r.mine);
  if (r.helloAt !== undefined) {
    if (!iso(r.helloAt)) throw new ConnectionError("A connection's hello time is damaged");
    out.helloAt = r.helloAt;
  }
  if (r.theirs !== undefined) {
    if (typeof r.theirs !== "string" || !PUBLIC_KEY.test(r.theirs)) throw new ConnectionError("A connection's public key is damaged");
    out.theirs = r.theirs;
  }
  if (r.receivedAt !== undefined) {
    if (!iso(r.receivedAt)) throw new ConnectionError("A connection's arrival time is damaged");
    out.receivedAt = r.receivedAt;
  }
  if (r.ignored === true) out.ignored = true;
  if (r.customerId !== undefined) {
    if (typeof r.customerId !== "string" || r.customerId === "") throw new ConnectionError("A connection's customer is damaged");
    out.customerId = r.customerId;
  }
  if (r.thread !== undefined) out.thread = validateThread(r.thread);
  if (r.past !== undefined) {
    if (!Array.isArray(r.past) || r.past.length > MAX_PAST) throw new ConnectionError("A connection's history is damaged");
    out.past = validateThread({ items: r.past, nextIn: 0, nextOut: 0 }).items;
  }
  if (r.retired !== undefined) {
    if (!Array.isArray(r.retired) || r.retired.length > MAX_RETIRED || !r.retired.every((k) => typeof k === "string" && PUBLIC_KEY.test(k))) throw new ConnectionError("A connection's old keys are damaged");
    out.retired = [...r.retired] as string[];
  }
  if (r.endedAt !== undefined) {
    if (!iso(r.endedAt)) throw new ConnectionError("A connection's end time is damaged");
    out.endedAt = r.endedAt;
  }
  return out;
}

export function validateConnections(raw: unknown): Connections {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ConnectionError("The connections are damaged");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_CONNECTIONS) throw new ConnectionError("Too many connections");
  const out: Connections = {};
  for (const [address, c] of entries) {
    const v = validateConnection(c);
    if (v.address !== address) throw new ConnectionError("A connection is filed under the wrong account");
    out[address] = v;
  }
  return out;
}

/**
 * Starts (or restarts) my side: my key pair and when my hello went out. Answering their request
 * clears an earlier "ignored". A new key pair replaces the old one only when there wasn't one, so
 * a hello sent twice still carries the key I keep.
 */
export function noteHelloSent(conns: Connections, who: { address: string; name: string; nameHash: string; customerId?: string }, mine: Half, at: string): Connections {
  const before = conns[who.address];
  if (!before && Object.keys(conns).length >= MAX_CONNECTIONS) throw new ConnectionError("Too many connections");
  const { ignored: _ignored, ...rest } = before ?? { address: who.address, name: who.name, nameHash: who.nameHash };
  const next: Connection = { ...rest, mine: before?.mine ?? mine, helloAt: at };
  if (who.customerId ?? before?.customerId) next.customerId = (who.customerId ?? before?.customerId)!;
  return { ...conns, [who.address]: validateConnection(next) };
}

/** Keeps my key pair before my hello goes out, so a hello that arrives is always one I can answer. */
export function keepMine(conns: Connections, who: { address: string; name: string; nameHash: string }, mine: Half): Connections {
  const before = conns[who.address];
  if (before?.mine) return conns;
  if (!before && Object.keys(conns).length >= MAX_CONNECTIONS) throw new ConnectionError("Too many connections");
  return { ...conns, [who.address]: validateConnection({ ...(before ?? { address: who.address, name: who.name, nameHash: who.nameHash }), mine }) };
}

/**
 * A hello from `sender` (the account the letter came from, which only it could send as). The name
 * must already be checked against the registry. A newer key replaces an older one, and the
 * conversation starts again under it, since the old key can no longer be made on their side.
 */
export function noteHelloReceived(conns: Connections, sender: string, hello: Hello, at: string): Connections {
  const before = conns[sender];
  if (!before && Object.keys(conns).length >= MAX_CONNECTIONS) return conns; // full: nothing new is taken
  if (before?.theirs === hello.publicKey || before?.retired?.includes(hello.publicKey)) return conns;
  const base: Connection = before ?? { address: sender, name: hello.name, nameHash: hello.nameHash };
  const { thread: old, ...rest } = base;
  const next: Connection = { ...rest, name: hello.name, nameHash: hello.nameHash, theirs: hello.publicKey, receivedAt: at };
  // A new key from them means a new conversation; what was said before is kept as history.
  if (old?.items.length) next.past = [...(base.past ?? []), ...old.items].slice(-MAX_PAST);
  return { ...conns, [sender]: validateConnection(next) };
}

/** Turns a request down: kept, so the same hello doesn't ask again. */
export function ignoreConnection(conns: Connections, address: string): Connections {
  const c = conns[address];
  if (!c) throw new ConnectionError("No request from that account");
  return { ...conns, [address]: { ...c, ignored: true } };
}

/** Ties a business's connection to the customer record it belongs to. */
export function linkCustomer(conns: Connections, address: string, customerId: string): Connections {
  const c = conns[address];
  if (!c) throw new ConnectionError("No connection with that account");
  return { ...conns, [address]: { ...c, customerId } };
}

/**
 * Applies a change to one connection's conversation. A disconnect in it (sent by either side) ends
 * the connection there and then: see `endConnection`.
 */
export function updateConnectionThread(conns: Connections, address: string, change: (t: Thread) => Thread, empty: () => Thread): Connections {
  const c = conns[address];
  if (!c) throw new ConnectionError("No connection with that account");
  const thread = change(c.thread ?? empty());
  const ended = thread.items.find((i) => i.body.type === "disconnect");
  const next = { ...conns, [address]: { ...c, thread } };
  return ended ? endConnection(next, address, { byMe: ended.mine, at: ended.receivedAt ?? ended.sentAt }) : next;
}

/**
 * Ends a connection: both keys are dropped, so nothing more can be sealed or read under them, and
 * what was said is kept as history. When I ended it, their later hellos are ignored until I connect
 * again; when they did, either side may.
 */
export function endConnection(conns: Connections, address: string, { byMe, at }: { byMe: boolean; at: string }): Connections {
  const c = conns[address];
  if (!c) throw new ConnectionError("No connection with that account");
  const { mine: _m, theirs: _t, helloAt: _h, receivedAt: _r, thread, ignored: _i, ...rest } = c;
  const past = [...(c.past ?? []), ...(thread?.items ?? [])].slice(-MAX_PAST);
  const retired = [...(c.retired ?? []), ...(c.theirs ? [c.theirs] : [])].slice(-MAX_RETIRED);
  const next: Connection = { ...rest, endedAt: at, ...(past.length ? { past } : {}), ...(retired.length ? { retired } : {}), ...(byMe ? { ignored: true as const } : {}) };
  return { ...conns, [address]: validateConnection(next) };
}

/** Everything said in a connection, history first. */
export const itemsOf = (c: Pick<Connection, "past" | "thread"> | undefined): ThreadItem[] => [...(c?.past ?? []), ...(c?.thread?.items ?? [])];

/** The connections that asked and haven't been answered or turned down: newest first. */
export const requestsIn = (conns: Connections | undefined): Connection[] =>
  Object.values(conns ?? {})
    .filter((c) => connectionState(c) === "asked")
    .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));

/** The connected ones, by name. */
export const connectedIn = (conns: Connections | undefined): Connection[] =>
  Object.values(conns ?? {})
    .filter((c) => connectionState(c) === "connected")
    .sort((a, b) => a.name.localeCompare(b.name));
