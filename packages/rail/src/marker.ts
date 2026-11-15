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
// id (`ListedMarker`). Two devices can mark the same payment at nearly the
// same moment. Each reads the markers again once its own is listed, and the
// later one stands down (`beaten`): a marker comes second when one before it
// that stands holds a live line for one of its payees over a period that
// overlaps its own. That is decided once, from the markers before it, so a
// marker listed later never changes it. A marker that came second decides
// nothing: the device that sent it pays nothing from it, its lines are not
// live, and the records it replaces are not given up. That includes a record
// one of its lines names from a try made before it was sent: no other device
// is told of it, so only a copy of the books that holds it as the payment's
// attempt keeps to it. A line is live when its marker stands and no line of a
// standing marker replaces it. For a payment, the lines against it
// are the ones to the same payee over a period that overlaps its own
// (`decideLines`):
//
//   - none: the payment is fresh, and is marked before it is asked for;
//   - any at another amount, even one whose marker came second: refused.
//     The same person is already being paid something else for that period,
//     or the books on two devices disagree about what;
//   - else the earliest live one decides. If it names a record, only that
//     record pays this payment, on any device, so the network lets one
//     transfer through; a payment already holding a different record is
//     refused. If it names none, it is a later line of a chained run: the
//     device that sent the marker goes on with it, and any other device
//     leaves it alone (it is in progress elsewhere), to be settled only by
//     looking for the payment itself. When no line against it is live (each
//     one's marker came second), the payment is fresh.
//
// A payment is matched by payee, period and amount, so two payments to one
// account over one period are not told apart: both read the same lines. A
// caller doesn't mark a run that holds two.
//
// A marker holds at most `MAX_MARKER_LINES` lines. A run that pays more
// people is marked in several, sent together or one after another as its
// payments go out (the caller chooses when). Their payees don't repeat, so
// none comes second to another, and each reads as a chained run of its own:
// the device that sent it goes on with its lines, and another device only
// with a line that names a record.
//
// A marker's text names each payee's account and pay, so it leaves the
// device only sealed with the books' own key. The rules trust every marker
// they are given (a line's `replaces` gives up that record whatever its
// payee), so a caller lists only markers sealed with these books.
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
   * holds for it. `since`: the height its marker was accepted at. A payment first asked for in
   * that run is no older; one whose record was set aside on an earlier try may be, so a caller that
   * holds an earlier height for it looks from there.
   */
  | { workerId: string; kind: "resume"; marker: string; since: number; tag?: string }
  /**
   * The earliest line for it names no record and its marker was sent from another device: it is in
   * progress there, and nothing is sent for it from here. `since` as for "resume". `start`: the
   * record that run's first payment spends, when its marker names one: the record the marker
   * started from, or the one a live line now pays that payment from in its place.
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

type Period = { from: string; until: string };
/** Two periods share at least a day. */
const overlaps = (a: Period, b: Period): boolean => a.from <= b.until && b.from <= a.until;

const linesOf = ({ marker, height, txId }: ListedMarker): LiveLine[] => marker.lines.map((line) => ({ ...line, from: marker.from, until: marker.until, marker: marker.id, height, txId }));
const replacedIn = (marker: RunMarker): string[] => marker.lines.flatMap((line) => (line.replaces !== undefined ? [line.replaces] : []));

/**
 * The listed markers read in order, each once (a marker listed twice counts where it comes first).
 * Each is judged when its turn comes, against the markers before it that stand: it came second when
 * one of them holds a line live at that point (one no standing marker so far replaces, nor a line of
 * its own) for one of its payees over a period that overlaps its own. Nothing listed after a marker
 * changes its verdict.
 *
 * `lines`: every line of every marker read, earliest marker first and in each marker's own order,
 * less those a line of a standing marker replaces; the lines of a marker that came second are among
 * them, for their amounts. `second`: the ids of the markers that came second. `replacedBy`: for each
 * record a standing marker gave up, the record its replacing line names, if it names one.
 */
function readMarkers(listed: readonly ListedMarker[]): { lines: LiveLine[]; second: Set<string>; replacedBy: Map<string, string | undefined>; markers: ListedMarker[] } {
  const markers: ListedMarker[] = [];
  const read = new Set<string>();
  const second = new Set<string>();
  const standing: LiveLine[] = [];
  const replacedBy = new Map<string, string | undefined>();
  const live = (line: LiveLine, also: ReadonlySet<string> = new Set()) => line.tag === undefined || (!replacedBy.has(line.tag) && !also.has(line.tag));
  for (const l of orderMarkers(listed)) {
    if (read.has(l.marker.id)) continue;
    read.add(l.marker.id);
    markers.push(l);
    const its = new Set(replacedIn(l.marker));
    const payees = new Set(l.marker.lines.map((line) => line.to));
    if (standing.some((line) => payees.has(line.to) && overlaps(line, l.marker) && live(line, its))) {
      second.add(l.marker.id);
      continue;
    }
    for (const line of l.marker.lines) if (line.replaces !== undefined && !replacedBy.has(line.replaces)) replacedBy.set(line.replaces, line.tag);
    standing.push(...linesOf(l));
  }
  return { lines: markers.flatMap(linesOf).filter((line) => live(line)), second, replacedBy, markers };
}

/**
 * Every line of every listed marker that stands (`beaten`) and that no line of a standing marker
 * replaces: earliest marker first, in each marker's own order.
 */
export function liveLines(listed: readonly ListedMarker[]): LiveLine[] {
  const { lines, second } = readMarkers(listed);
  return lines.filter((line) => !second.has(line.marker));
}

// ---- What a device does with each payment -----------------------------------------------

/**
 * For each payment a run still owes, what the markers listed say (the rules are at the top of this
 * file). `own`: the ids of the markers this device sent itself.
 */
export function decideLines(listed: readonly ListedMarker[], payments: readonly MarkedPayment[], own: Iterable<string> = []): LineDecision[] {
  const { lines, second, replacedBy, markers } = readMarkers(listed);
  const mine = new Set(own);
  /** The record a marker's chained run spends first: the one it started from, followed through any line that took its place. */
  const startOf = (id: string): string | undefined => {
    const marker = markers.find((l) => l.marker.id === id)?.marker;
    let tag = marker ? startingTag(marker) : undefined;
    for (const seen = new Set<string>(); tag !== undefined && replacedBy.has(tag) && !seen.has(tag); ) {
      seen.add(tag);
      tag = replacedBy.get(tag);
    }
    return tag;
  };
  return payments.map((p): LineDecision => {
    const { workerId } = p;
    // The lines to this payee over a period that overlaps this one, less the record the person chose to pay again from.
    const against = lines.filter((l) => l.to === p.to && overlaps(l, p) && !(l.tag !== undefined && l.tag === p.replaces));
    if (against.some((l) => l.minor !== p.minor)) return { workerId, kind: "refused", why: "other-amount" };
    // A line whose marker came second decides nothing: the device that sent it paid nothing from it.
    const first = against.find((l) => !second.has(l.marker));
    if (!first) return { workerId, kind: "fresh" };
    const at = { marker: first.marker, since: first.height };
    if (first.tag !== undefined) {
      if (p.attempt !== undefined && p.attempt !== first.tag) return { workerId, kind: "refused", why: "other-record" };
      return { workerId, kind: "resume", ...at, tag: first.tag };
    }
    if (mine.has(first.marker)) return { workerId, kind: "resume", ...at };
    const start = startOf(first.marker);
    return { workerId, kind: "elsewhere", ...at, ...(start !== undefined ? { start } : {}) };
  });
}

/**
 * Whether the marker with this id came second: a marker accepted before it, that stands, held a live
 * line for one of its payees over a period that overlaps its own when it was accepted. The device
 * that sent it then pays nothing for this run and drops the records it set aside for it (one held
 * from an earlier try that may still land stays held, as the queue keeps it). Every line of the
 * marker is read, so a marker holds only the payments `decideLines` called fresh: one that repeats a
 * payment already marked reads as beaten by it. A marker that came second stays so, whatever is
 * listed after it. Throws when no marker with this id is listed.
 */
export function beaten(listed: readonly ListedMarker[], id: string): boolean {
  if (!listed.some((l) => l.marker.id === id)) throw new RailError("That marker isn't listed");
  return readMarkers(listed).second.has(id);
}
