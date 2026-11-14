// ---------------------------------------------------------------------------
// The run marker: a note a device leaves before it pays a run, and how any
// device with the same books reads the notes that are there.
//
// A marker names what a run is about to pay: for each payment the payee's
// account and the amount, over the run's pay period. It names no person, no
// run and no team member id (a restored copy of the books numbers those
// differently), so a payment is matched by payee, period and amount alone.
//
// A line may also name a record, by its tag (`recordTag`, queue.ts): the
// record set aside for that payment. A run is paid one payment at a time,
// each from what the last one left, so when the marker is written only the
// first payment has a record; the lines after it name none. `replaces` on a
// line names the tag of an earlier line that it takes the place of, written
// when the person chose to pay again from another record.
//
// Markers are ordered by the block each was accepted in, then by transaction
// id (`ListedMarker`). A line is live unless a listed line replaces it. For
// a payment, the lines against it are the live ones to the same payee over a
// period that overlaps its own (`decideLines`):
//
//   - none: the payment is fresh, and is marked before it is asked for;
//   - any at another amount: refused. The same person is already being paid
//     something else for that period;
//   - else the earliest decides. If it names a record, only that record pays
//     this payment, on any device, so the network lets one transfer through;
//     a payment already holding a different record is refused. If it names
//     none, it is a later line of a chained run: the device that sent the
//     marker goes on with it, and any other device leaves it alone (it is in
//     progress elsewhere), to be settled only by looking for the payment
//     itself.
//
// Two devices can mark the same payment at nearly the same moment. Each reads
// the markers again once its own is listed, and the later one stands down
// (`beaten`).
//
// Everything here is a pure function of what it is given: nothing is read
// from a wallet, the network or a clock, and nothing is logged. Sending a
// marker and listing the ones there belong to the caller.
// ---------------------------------------------------------------------------

import { RailError } from "./types";

export const MARKER_VERSION = 1;
/** The most payments one marker names. */
export const MAX_MARKER_LINES = 64;

export type MarkerLine = {
  /** The payee's account. */
  to: string;
  /** USDCx minor units. In the marker's text, a whole number in decimal. */
  minor: bigint;
  /** The tag of the record set aside for this payment (`recordTag`), when it has one. */
  tag?: string;
  /** The tag of an earlier line this one takes the place of. */
  replaces?: string;
};

export type RunMarker = {
  v: typeof MARKER_VERSION;
  /** 32 hex characters: 128 random bits (`newMarkerId`). */
  id: string;
  /** The run's pay period, first and last day, as `YYYY-MM-DD`. Every line is for this period. */
  from: string;
  until: string;
  lines: MarkerLine[];
};

/** A marker as it was found on chain: the block that accepted it and its transaction. */
export type ListedMarker = { marker: RunMarker; height: number; txId: string };

/** One line of a listed marker, with its marker's period and place in the order. */
export type LiveLine = MarkerLine & { from: string; until: string; marker: string; height: number; txId: string };

/** A payment a run still owes, as the rules read it. */
export type MarkedPayment = {
  workerId: string;
  /** The payee's account. */
  to: string;
  /** USDCx minor units. */
  minor: bigint;
  /** The run's pay period. */
  from: string;
  until: string;
  /** The tag of the record this device has set aside for it, if any. */
  attempt?: string;
  /** The tag of the record the person chose to stop waiting on (pay again). */
  replaces?: string;
};

export type LineDecision =
  /** No live line covers it: it is marked, then paid. */
  | { workerId: string; kind: "fresh" }
  /**
   * The earliest line for it is one to go on with here. With `tag`, only by spending that record.
   * Without, it is a line of this device's own chained run and keeps whatever record the device
   * holds for it. `since`: the height its marker was accepted at; no payment for it is older.
   */
  | { workerId: string; kind: "resume"; marker: string; since: number; tag?: string }
  /**
   * The earliest line for it names no record and its marker was sent from another device: it is in
   * progress there, and nothing is sent for it from here. `start`: the record that run started
   * from, when its marker names one.
   */
  | { workerId: string; kind: "elsewhere"; marker: string; since: number; start?: string }
  /**
   * Not paid from here. "other-amount": a live line pays the same payee another amount for a period
   * that overlaps this one. "other-record": the earliest line names a record, and this payment
   * already holds a different one.
   */
  | { workerId: string; kind: "refused"; why: "other-amount" | "other-record" };

// ---- The format ------------------------------------------------------------------

const HEX_32 = /^[0-9a-f]{32}$/;
const ADDRESS = /^aleo1[02-9ac-hj-np-z]{58}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^[1-9]\d{0,38}$/;
const MAX_AMOUNT = 2n ** 128n - 1n;
const MARKER_KEYS = ["v", "id", "from", "until", "lines"];
const LINE_KEYS = ["to", "minor", "tag", "replaces"];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTag = (v: unknown): v is string => typeof v === "string" && HEX_32.test(v);
const isDay = (v: unknown): v is string => {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  const date = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
};
const onlyKeys = (o: Record<string, unknown>, allowed: readonly string[]): boolean => Object.keys(o).every((k) => allowed.includes(k));

const refuse = (what: string): never => {
  throw new RailError(`Not a run marker: ${what}`);
};

/** Checks a marker whose amounts may be text (as read) or bigint (as held), and returns it as held. Throws on anything off. */
function checked(raw: unknown): RunMarker {
  if (!isObject(raw)) return refuse("it isn't an object");
  if (!onlyKeys(raw, MARKER_KEYS)) return refuse("it has a field a marker doesn't");
  if (raw.v !== MARKER_VERSION) return refuse("its version isn't one this app reads");
  if (!isTag(raw.id)) return refuse("its id isn't 32 hex characters");
  if (!isDay(raw.from) || !isDay(raw.until)) return refuse("its period isn't two dates");
  if (raw.from > raw.until) return refuse("its period ends before it starts");
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) return refuse("it has no lines");
  if (raw.lines.length > MAX_MARKER_LINES) return refuse(`it has more than ${MAX_MARKER_LINES} lines`);
  const tags = new Set<string>();
  const lines = raw.lines.map((line: unknown): MarkerLine => {
    if (!isObject(line) || !onlyKeys(line, LINE_KEYS)) return refuse("a line has a field a line doesn't");
    if (typeof line.to !== "string" || !ADDRESS.test(line.to)) return refuse("a line's payee isn't an account");
    // As read, an amount is decimal text: a bare number is refused (it can't hold every amount exactly).
    const minor = typeof line.minor === "bigint" ? line.minor : typeof line.minor === "string" && AMOUNT.test(line.minor) ? BigInt(line.minor) : null;
    if (minor === null || minor <= 0n || minor > MAX_AMOUNT) return refuse("a line's amount isn't a whole number above zero");
    if (line.tag !== undefined && !isTag(line.tag)) return refuse("a line's record tag isn't 32 hex characters");
    if (line.replaces !== undefined && !isTag(line.replaces)) return refuse("a line replaces something that isn't a record tag");
    if (line.tag !== undefined && line.tag === line.replaces) return refuse("a line replaces itself");
    if (line.tag !== undefined && tags.has(line.tag)) return refuse("two lines name one record");
    if (line.tag !== undefined) tags.add(line.tag);
    return { to: line.to, minor, ...(line.tag !== undefined ? { tag: line.tag } : {}), ...(line.replaces !== undefined ? { replaces: line.replaces } : {}) };
  });
  return { v: MARKER_VERSION, id: raw.id, from: raw.from, until: raw.until, lines };
}

/** A fresh marker id: 128 random bits, as 32 hex characters. */
export function newMarkerId(): string {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The marker as text: its fields in a fixed order, amounts as decimal text. Throws on a marker `decodeMarker` would refuse. */
export function encodeMarker(marker: RunMarker): string {
  const m = checked(marker);
  return JSON.stringify({
    v: m.v,
    id: m.id,
    from: m.from,
    until: m.until,
    lines: m.lines.map((l) => ({ to: l.to, minor: l.minor.toString(), ...(l.tag !== undefined ? { tag: l.tag } : {}), ...(l.replaces !== undefined ? { replaces: l.replaces } : {}) })),
  });
}

/**
 * Reads a marker from text. Strict: an unknown field, a line too many, or any field that isn't
 * exactly what a marker holds, and it throws (`RailError`); nothing is guessed or repaired.
 */
export function decodeMarker(text: string): RunMarker {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse("it isn't JSON");
  }
  return checked(raw);
}

/** The record a chained run started from: the first one its marker's lines name, if any does. */
export const startingTag = (marker: RunMarker): string | undefined => marker.lines.find((l) => l.tag !== undefined)?.tag;

// ---- Which comes first, and what is live -----------------------------------------------

/** The markers, earliest first: by the block each was accepted in, then by transaction id. The list given is left as it is. */
export function orderMarkers(listed: readonly ListedMarker[]): ListedMarker[] {
  return [...listed].sort((a, b) => a.height - b.height || (a.txId < b.txId ? -1 : a.txId > b.txId ? 1 : 0));
}

/** Every line of every listed marker that no listed line replaces, earliest marker first, in each marker's own order. */
export function liveLines(listed: readonly ListedMarker[]): LiveLine[] {
  const replaced = new Set(listed.flatMap((l) => l.marker.lines.flatMap((line) => (line.replaces !== undefined ? [line.replaces] : []))));
  return orderMarkers(listed).flatMap(({ marker, height, txId }) =>
    marker.lines.filter((line) => line.tag === undefined || !replaced.has(line.tag)).map((line) => ({ ...line, from: marker.from, until: marker.until, marker: marker.id, height, txId })),
  );
}

type Period = { from: string; until: string };
/** Two periods share at least a day. */
const overlaps = (a: Period, b: Period): boolean => a.from <= b.until && b.from <= a.until;

// ---- What a device does with each payment -----------------------------------------------

/**
 * For each payment a run still owes, what the markers listed say (the rules are at the top of this
 * file). `own`: the ids of the markers this device sent itself.
 */
export function decideLines(listed: readonly ListedMarker[], payments: readonly MarkedPayment[], own: Iterable<string> = []): LineDecision[] {
  const live = liveLines(listed);
  const mine = new Set(own);
  const starts = new Map(listed.map((l) => [l.marker.id, startingTag(l.marker)] as const));
  return payments.map((p): LineDecision => {
    const { workerId } = p;
    // The live lines to this payee over a period that overlaps this one, less the record the person chose to pay again from.
    const against = live.filter((l) => l.to === p.to && overlaps(l, p) && !(l.tag !== undefined && l.tag === p.replaces));
    const first = against[0];
    if (!first) return { workerId, kind: "fresh" };
    if (against.some((l) => l.minor !== p.minor)) return { workerId, kind: "refused", why: "other-amount" };
    const at = { marker: first.marker, since: first.height };
    if (first.tag !== undefined) {
      if (p.attempt !== undefined && p.attempt !== first.tag) return { workerId, kind: "refused", why: "other-record" };
      return { workerId, kind: "resume", ...at, tag: first.tag };
    }
    if (mine.has(first.marker)) return { workerId, kind: "resume", ...at };
    const start = starts.get(first.marker);
    return { workerId, kind: "elsewhere", ...at, ...(start !== undefined ? { start } : {}) };
  });
}

/**
 * Whether the marker with this id came second: a marker accepted before it holds a live line for
 * one of its payees over a period that overlaps its own. The device that sent it then pays nothing
 * for this run and drops the records it set aside. Throws when no marker with this id is listed.
 */
export function beaten(listed: readonly ListedMarker[], id: string): boolean {
  const ordered = orderMarkers(listed);
  const at = ordered.findIndex((l) => l.marker.id === id);
  if (at < 0) throw new RailError("That marker isn't listed");
  const mine = ordered[at]!.marker;
  const earlier = new Set(ordered.slice(0, at).map((l) => l.marker.id));
  return liveLines(listed).some((l) => earlier.has(l.marker) && overlaps(l, mine) && mine.lines.some((line) => line.to === l.to));
}
