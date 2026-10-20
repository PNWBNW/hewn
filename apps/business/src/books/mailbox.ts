// ---------------------------------------------------------------------------
// The business's mailbox: what other people have sent it, kept in the vault.
// Today that is a team member's week of hours (the timesheet payload built
// in hours.ts, a contract with the person's side of the app). Offers sent
// and paystubs delivered are not copied here: the feed (mailbox_feed.ts)
// reads them from the rail links and the pay runs, which already hold them.
//
// Everything that arrives comes from another person's device, so it is
// checked field by field before it is kept, and nothing is trusted for its
// own claims: the total must equal the sum of the entries, the minutes of
// each entry must fit in a day, and the document must name the agreement
// whose key opened it.
//
// Nothing here talks to the network. Reading the mailbox lives in
// src/chain/mailbox_scan.ts, loaded only when the page asks.
// ---------------------------------------------------------------------------

import type { TimesheetPayload } from "./hours";
import { type Thread, emptyThread, validateThread } from "./thread";
import { type BusinessChannel, validateBusinessChannel } from "./channels";

/** One stretch as received, and, once a pay run has paid it, which run and when (books/timecard_pay.ts). */
export type ReceivedEntry = TimesheetPayload["entries"][number] & { paid?: { runId: string; payDate: string } };

/** A week of hours a team member sent, as it arrived. */
export type ReceivedHours = {
  agreementId: string;
  /** The slot it came from, in the agreement's `timesheet` mailbox. */
  seq: number;
  lookup: string;
  /** When this device opened it. */
  receivedAt: string;
  /** The team member, by the books' id. */
  workerId: string;
  /** The first day of the work week, YYYY-MM-DD, on the agreement's calendar (books/hours.ts). */
  weekStart: string;
  entries: ReceivedEntry[];
  totalMinutes: number;
  /** When the sender sent it. */
  sentAt: string;
  /** Opened under Payroll → Hours. Missing means unread. */
  read?: boolean;
  /** How many sends of this week this card combines, when more than one (books/mailbox.ts `combinePerWeek`). */
  sends?: number;
};

/** The conversation with one team member (books/thread.ts), and who they are in these books. */
export type BusinessThread = Thread & { workerId: string };

export type Mailbox = {
  version: 1;
  hours: ReceivedHours[];
  /** The next unread `timesheet` slot, per agreement id. Missing means 0. */
  nextHours?: Record<string, number>;
  /** One thread per person, by the pair's parties key (the same for every offer between the two). */
  threads?: Record<string, BusinessThread>;
  /** Announcement channels (books/channels.ts). */
  channels?: BusinessChannel[];
  /** The coworker directory as it was last sent out (books/directory.ts `directoryDigest`). */
  directorySent?: string;
};

export class MailboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailboxError";
  }
}

export const emptyMailbox = (): Mailbox => ({ version: 1, hours: [] });

const MAX_SEQ = 0xffff_ffff;
const MAX_ENTRIES = 100;
const MINUTES_IN_DAY = 24 * 60;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOOKUP = /^[0-9a-f]{64}$/;

const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isStamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const isSeq = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_SEQ;
const isMinutes = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/** The entries of a timesheet: bounded, well-formed, in whole minutes. */
/** The entries of a week; `kept` ones (from this vault, not the wire) may carry which pay run paid them. */
function validateEntries(raw: unknown, kept = false): ReceivedEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new MailboxError("The hours have no entries");
  if (raw.length > MAX_ENTRIES) throw new MailboxError("The hours have too many entries");
  return raw.map((e) => {
    const x = e as Partial<ReceivedEntry> | null;
    if (!x || typeof x !== "object") throw new MailboxError("Every entry must be an object");
    if (!isDate(x.date)) throw new MailboxError("Every entry needs a date");
    if (!isStamp(x.in) || !isStamp(x.out)) throw new MailboxError("Every entry needs a start and an end time");
    if (!isMinutes(x.minutes, MINUTES_IN_DAY)) throw new MailboxError("An entry's minutes must be a whole number within one day");
    if (x.long !== undefined && x.long !== true) throw new MailboxError("An entry's long flag can only be true");
    if (x.callout !== undefined && x.callout !== true) throw new MailboxError("An entry's callout flag can only be true");
    // `long`: a shift past the longest shift in the terms, which the sender confirmed (books/hours.ts).
    // `callout`: clocked in as a callout, paid at the overtime rate with the agreed minimum (books/timecard_pay.ts).
    const entry: ReceivedEntry = { date: x.date, in: x.in, out: x.out, minutes: x.minutes, ...(x.long ? { long: true as const } : {}), ...(x.callout ? { callout: true as const } : {}) };
    if (kept && x.paid !== undefined) {
      const p = x.paid as Partial<NonNullable<ReceivedEntry["paid"]>> | null;
      if (!p || typeof p !== "object" || typeof p.runId !== "string" || !p.runId || !isDate(p.payDate)) throw new MailboxError("A paid entry names the pay run and its date");
      entry.paid = { runId: p.runId, payDate: p.payDate };
    }
    return entry;
  });
}

/**
 * Checks a timesheet the other person sent. It must be a version 1 timesheet
 * for exactly this agreement, and its total must be the sum of its entries.
 */
export function validateTimesheetPayload(raw: unknown, agreementId: string): TimesheetPayload {
  const p = raw as Partial<TimesheetPayload> | null;
  if (!p || typeof p !== "object") throw new MailboxError("The hours aren't a document");
  if (p.version !== 1) throw new MailboxError("Unknown hours version");
  if (p.kind !== "timesheet") throw new MailboxError("That document isn't a week of hours");
  if (p.agreementId !== agreementId) throw new MailboxError("The hours are for a different agreement");
  if (!isDate(p.weekStart)) throw new MailboxError("The hours need a week");
  const entries = validateEntries(p.entries);
  const sum = entries.reduce((t, e) => t + e.minutes, 0);
  if (p.totalMinutes !== sum) throw new MailboxError("The hours don't add up");
  if (!isStamp(p.sentAt)) throw new MailboxError("The hours need the time they were sent");
  return { version: 1, kind: "timesheet", agreementId, weekStart: p.weekStart, entries, totalMinutes: sum, sentAt: p.sentAt };
}

function validateReceived(raw: unknown): ReceivedHours {
  const h = raw as Partial<ReceivedHours> | null;
  if (!h || typeof h !== "object") throw new MailboxError("Each week of hours must be an object");
  if (typeof h.agreementId !== "string" || !h.agreementId) throw new MailboxError("Each week of hours needs an agreement");
  if (typeof h.workerId !== "string" || !h.workerId) throw new MailboxError("Each week of hours needs a team member");
  if (!isSeq(h.seq)) throw new MailboxError("A slot must be a whole number");
  if (typeof h.lookup !== "string" || !LOOKUP.test(h.lookup)) throw new MailboxError("A lookup must be 64 hex characters");
  if (!isStamp(h.receivedAt)) throw new MailboxError("Each week of hours needs the time it arrived");
  if (!isDate(h.weekStart)) throw new MailboxError("Each week of hours needs a week");
  const entries = validateEntries(h.entries, true);
  if (h.totalMinutes !== entries.reduce((t, e) => t + e.minutes, 0)) throw new MailboxError("The hours don't add up");
  if (!isStamp(h.sentAt)) throw new MailboxError("Each week of hours needs the time it was sent");
  if (h.read !== undefined && typeof h.read !== "boolean") throw new MailboxError("Read must be true or false");
  if (h.sends !== undefined && (!Number.isInteger(h.sends) || (h.sends as number) < 2)) throw new MailboxError("Sends must be a whole number of at least 2");
  const clean: ReceivedHours = {
    agreementId: h.agreementId,
    seq: h.seq,
    lookup: h.lookup,
    receivedAt: h.receivedAt,
    workerId: h.workerId,
    weekStart: h.weekStart,
    entries,
    totalMinutes: h.totalMinutes as number,
    sentAt: h.sentAt,
  };
  if (h.read) clean.read = true;
  if (h.sends) clean.sends = h.sends;
  return clean;
}

/** Two stretches of time that share a moment, or are the same stretch (two zero-length ones at one instant). */
const overlaps = (a: { in: string; out: string }, b: { in: string; out: string }): boolean => (a.in < b.out && b.in < a.out) || (a.in === b.in && a.out === b.out);

/**
 * One card per week (Joshua, 2026-10-19): the sends of one week, same
 * agreement, are combined, nothing dropped. Someone who sends 35 hours and is
 * called in the next day sends the week again; the week's card then holds
 * both. The newer send is the person's latest word on any stretch it covers:
 * its entries go in whole, and from the earlier sends only the stretches the
 * newer ones don't overlap (a week sent again whole therefore stays as sent;
 * a shift whose clock-out moved is counted once, as moved). The card carries
 * the latest slot and says how many sends it combines. A combined card is new
 * (unread) again. Slots are folded in order, so what arrives late is still
 * the older word.
 */
function combinePerWeek(items: ReceivedHours[]): ReceivedHours[] {
  const byWeek = new Map<string, ReceivedHours>();
  for (const item of [...items].sort((a, b) => a.seq - b.seq)) {
    const key = `${item.agreementId}:${item.weekStart}`;
    const kept = byWeek.get(key);
    if (!kept || kept.seq === item.seq) {
      byWeek.set(key, item);
      continue;
    }
    // A stretch a pay run has already paid stays as paid; a newer send over it is not counted again.
    const paid = kept.entries.filter((e) => e.paid);
    const fresh_ = item.entries.filter((n) => !paid.some((p) => overlaps(p, n)));
    const entries = [...fresh_, ...kept.entries.filter((e) => e.paid || !item.entries.some((n) => overlaps(e, n)))].sort((a, b) => (a.in < b.in ? -1 : a.in > b.in ? 1 : 0));
    const { read: _read, ...fresh } = item;
    byWeek.set(key, { ...fresh, entries, totalMinutes: entries.reduce((t, e) => t + e.minutes, 0), sends: (kept.sends ?? 1) + 1 });
  }
  return [...byWeek.values()];
}

export function validateMailbox(raw: unknown): Mailbox {
  const m = raw as Partial<Mailbox> | null;
  if (!m || typeof m !== "object") throw new MailboxError("The mailbox must be an object");
  if (m.version !== 1) throw new MailboxError("Unknown mailbox version");
  if (!Array.isArray(m.hours)) throw new MailboxError("The mailbox's hours must be a list");
  const bySlot = new Map<string, ReceivedHours>();
  for (const item of m.hours.map(validateReceived)) bySlot.set(`${item.agreementId}:${item.seq}`, item);
  const mailbox: Mailbox = { version: 1, hours: combinePerWeek([...bySlot.values()]) };
  if (m.nextHours !== undefined) {
    const n = m.nextHours as Record<string, unknown> | null;
    if (!n || typeof n !== "object" || Array.isArray(n)) throw new MailboxError("The next slots must be an object");
    const clean: Record<string, number> = {};
    for (const [id, seq] of Object.entries(n)) {
      if (!isSeq(seq)) throw new MailboxError("A slot must be a whole number");
      clean[id] = seq;
    }
    if (Object.keys(clean).length > 0) mailbox.nextHours = clean;
  }
  if (m.threads !== undefined) {
    const t = m.threads as Record<string, unknown> | null;
    if (!t || typeof t !== "object" || Array.isArray(t)) throw new MailboxError("The threads must be an object");
    const clean: Record<string, BusinessThread> = {};
    for (const [key, raw] of Object.entries(t)) {
      if (!LOOKUP.test(key)) throw new MailboxError("A thread is filed under a parties key");
      const workerId = (raw as { workerId?: unknown } | null)?.workerId;
      if (typeof workerId !== "string" || !workerId) throw new MailboxError("A thread needs its team member");
      clean[key] = { ...validateThread(raw), workerId };
    }
    if (Object.keys(clean).length > 0) mailbox.threads = clean;
  }
  if (m.directorySent !== undefined) {
    if (typeof m.directorySent !== "string" || m.directorySent.length > 200_000) throw new MailboxError("The directory fingerprint must be text");
    mailbox.directorySent = m.directorySent;
  }
  if (m.channels !== undefined) {
    if (!Array.isArray(m.channels)) throw new MailboxError("The channels must be a list");
    const byId = new Map<string, BusinessChannel>();
    for (const c of m.channels.map(validateBusinessChannel)) byId.set(c.id, c);
    if (byId.size > 0) mailbox.channels = [...byId.values()];
  }
  return mailbox;
}

export const mailboxToJson = (m: Mailbox): string => JSON.stringify(validateMailbox(m));
export const mailboxFromJson = (text: string): Mailbox => validateMailbox(JSON.parse(text));

/** The next `timesheet` slot to read for an agreement (0 before anything arrived). */
export const nextHoursSeq = (m: Mailbox, agreementId: string): number => m.nextHours?.[agreementId] ?? 0;

/** Moves an agreement's next slot past `used`. Never moves backwards. */
export function bumpHoursSeq(m: Mailbox, agreementId: string, used: number): Mailbox {
  if (!isSeq(used)) throw new MailboxError("A slot must be a whole number");
  return validateMailbox({ ...m, nextHours: { ...m.nextHours, [agreementId]: Math.max(nextHoursSeq(m, agreementId), used + 1) } });
}

/**
 * Keeps one week of hours and moves its agreement's next slot past it. One card per week: a week
 * sent again is combined into its card (`combinePerWeek`); a slot already kept is replaced.
 */
export function addHours(m: Mailbox, item: ReceivedHours): Mailbox {
  const fresh = validateReceived(item);
  const rest = m.hours.filter((h) => !(h.agreementId === fresh.agreementId && h.seq === fresh.seq));
  return bumpHoursSeq({ ...m, hours: combinePerWeek([...rest, fresh]) }, fresh.agreementId, fresh.seq);
}

/** Marks one week of hours as opened. Unknown slots leave the mailbox as it was. */
export function markHoursRead(m: Mailbox, agreementId: string, seq: number): Mailbox {
  if (!m.hours.some((h) => h.agreementId === agreementId && h.seq === seq && !h.read)) return m;
  return validateMailbox({ ...m, hours: m.hours.map((h) => (h.agreementId === agreementId && h.seq === seq ? { ...h, read: true } : h)) });
}

export const unreadCount = (m: Mailbox | null | undefined): number => m?.hours.filter((h) => !h.read).length ?? 0;

/** The thread with the person whose agreements use `partiesKey`, if there is one. */
export const threadFor = (m: Mailbox | null | undefined, partiesKey: string): BusinessThread | undefined => m?.threads?.[partiesKey];

/** Applies `change` to the thread with one person (a new one if there was none). */
export function updateThread(m: Mailbox, partiesKey: string, workerId: string, change: (t: Thread) => Thread): Mailbox {
  const before = threadFor(m, partiesKey) ?? { ...emptyThread(), workerId };
  const after = change(before);
  return validateMailbox({ ...m, threads: { ...m.threads, [partiesKey]: { ...after, workerId: before.workerId } } });
}

/** Adds or replaces one channel. */
export const putChannel = (m: Mailbox, ch: BusinessChannel): Mailbox =>
  validateMailbox({ ...m, channels: [...(m.channels ?? []).filter((c) => c.id !== ch.id), ch] });

export const channelFor = (m: Mailbox | null | undefined, id: string): BusinessChannel | undefined => m?.channels?.find((c) => c.id === id);
