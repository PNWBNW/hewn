// ---------------------------------------------------------------------------
// Shared events (Joshua, 2026-10-22): an event with guests. A business invites
// people on its team; a person invites their employer and coworkers at that
// job (one job per event, so nothing ties two employers together).
//
// How it travels, all as letters (chain/events.ts):
//   - The organizer keeps a random key for its invitations (a `Circle`: one
//     for a business, one per job for a person). Each guest gets it once, as
//     an `event_key` message in the conversation the two already share
//     (books/thread.ts), sealed with that conversation's key.
//   - Each invitation, change or cancellation is one post sealed with the
//     circle's key into the organizer's next slot (kind `evt_<epoch>`), sent
//     to every guest at once (one Shield approval for each eight). A big
//     guest list goes in parts, all naming the same event and revision.
//   - A guest answers going, maybe or not going with an `event_answer` in
//     their own conversation with the organizer.
//
// Only the organizer may post: a guest holds the circle's key too, so a
// reader keeps a post only when the letter's sender (which only its owner can
// see) is the organizer's account. Guests see the guest list, each tagged one
// way from the key they share with the organizer (`eventWho`), so each finds
// their own row. A change to what, when or where asks everyone again; a
// change to the guest list alone doesn't.
//
// Pure: no I/O, no React. The posts' sizes and the letters are chain/events.ts.
// ---------------------------------------------------------------------------

import { lookupId, partiesKeyFromHex } from "@pnw/mailbox";
import { type EventDetails, EventError, validateDetails } from "./events";
import { type EventAnswer, EVENT_ANSWERS, type Thread, type ThreadItem } from "./thread";

/** A shared event's notes travel in a letter, so they're shorter than a personal event's. */
export const MAX_SHARED_NOTES = 500;
export const MAX_GUESTS = 200;
export const MAX_EVENT_PARTS = 16;
const MAX_HOSTED = 1_000;
const MAX_INVITES = 2_000;
const MAX_PENDING = 200;
const MAX_REV = 0xffff_ffff;

export const ANSWER_LABEL: Record<EventAnswer, string> = { yes: "Going", maybe: "Maybe", no: "Not going" };

const ID = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const WHO = /^[0-9a-f]{12}$/;
const PUBLIC_KEY = /^04[0-9a-f]{128}$/;
const ADDRESS = /^aleo1[02-9ac-hj-np-z]{58}$/;

export class SharedEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SharedEventError";
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const isCount = (v: unknown, max = MAX_REV): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
const isRev = (v: unknown): v is number => isCount(v) && v >= 1;

// ---- Who's who -----------------------------------------------------------------

/**
 * The conversation an organizer and a guest already share: a business and a
 * person it hired (their parties key, from either side), or two coworkers
 * (the business they share, as the person's parties key with it, and the
 * other one's public key).
 */
export type Contact = { via: "pair"; partiesKey: string } | { via: "coworker"; businessKey: string; publicKey: string };

/** A stable name for a conversation. */
export const contactRef = (c: Contact): string => (c.via === "pair" ? `p:${c.partiesKey}` : `c:${c.publicKey}`);

export function validateContact(raw: unknown): Contact {
  if (!isObject(raw)) throw new SharedEventError("A contact must be an object");
  if (raw.via === "pair") {
    if (typeof raw.partiesKey !== "string" || !HEX64.test(raw.partiesKey)) throw new SharedEventError("A contact needs its conversation");
    return { via: "pair", partiesKey: raw.partiesKey };
  }
  if (raw.via === "coworker") {
    if (typeof raw.businessKey !== "string" || !HEX64.test(raw.businessKey)) throw new SharedEventError("A coworker needs the job you share");
    if (typeof raw.publicKey !== "string" || !PUBLIC_KEY.test(raw.publicKey)) throw new SharedEventError("A coworker needs their public key");
    return { via: "coworker", businessKey: raw.businessKey, publicKey: raw.publicKey };
  }
  throw new SharedEventError("A contact is a conversation with someone you work with");
}

/** A guest's tag on the guest list: one way from the key the guest and the organizer share, so the guest finds their own row and nobody works back to the key. */
export function eventWho(conversationKey: string): string {
  const key = partiesKeyFromHex(conversationKey);
  try {
    return lookupId(key, "event_who", 0).slice(0, 12);
  } finally {
    key.fill(0);
  }
}

/** Someone the organizer invites: the name the organizer shows, their account, and how the two of them talk. */
export type Guest = { name: string; address: string; contact: Contact };

const guestName = (v: unknown): string => {
  if (typeof v !== "string" || !v.trim() || [...v].length > 60) throw new SharedEventError("A guest's name is 1 to 60 characters");
  return v.trim();
};

function validateGuest(raw: unknown): Guest {
  if (!isObject(raw)) throw new SharedEventError("A guest must be an object");
  if (typeof raw.address !== "string" || !ADDRESS.test(raw.address)) throw new SharedEventError("A guest needs their account");
  return { name: guestName(raw.name), address: raw.address, contact: validateContact(raw.contact) };
}

function guests(raw: unknown, min: number): Guest[] {
  if (!Array.isArray(raw) || raw.length < min || raw.length > MAX_GUESTS) throw new SharedEventError(`An event has ${min} to ${MAX_GUESTS} guests`);
  const seen = new Set<string>();
  return raw.map(validateGuest).filter((g) => (seen.has(contactRef(g.contact)) ? false : (seen.add(contactRef(g.contact)), true)));
}

// ---- The organizer's side ------------------------------------------------------------

/** The organizer's key for its invitations, numbered, and its next free slot. */
export type Circle = { id: string; epoch: number; key: string; nextOut: number };

/** An event this account organizes. */
export type HostedEvent = {
  id: string;
  /** Goes up with every change; the guests always have the latest one sent. */
  rev: number;
  /** The revision what, when or where last changed: answers to it or later still count. */
  since: number;
  /** The circle it goes out under: "" for a business, the job's parties key for a person. */
  scope: string;
  details: EventDetails;
  guests: Guest[];
  cancelled?: true;
  /** The revision last sent, the guests it named, and when. */
  sent?: { rev: number; guests: Guest[]; at: string };
  createdAt: string;
  updatedAt: string;
};

/** An event this account was invited to. */
export type Invite = {
  eventId: string;
  /** The conversation it came through, and the circle it was sealed under. */
  from: Contact;
  circleId: string;
  /** The organizer's name, as they gave it. */
  organizer: string;
  rev: number;
  since: number;
  details: EventDetails;
  guests: PostGuest[];
  /** This account's tag on the guest list. */
  me: string;
  /** Open, called off by the organizer, or this account taken off the list. */
  status: "open" | "cancelled" | "removed";
  sentAt: string;
  receivedAt: string;
  /** Put away from the calendar by this account (one called off, say). Kept, so reading it again doesn't bring it back. */
  hidden?: true;
};

/** A guest as a post names them: their name, their tag, and their answer when the organizer had one. */
export type PostGuest = { name: string; who: string; answer?: EventAnswer };

/** One letter's share of an event: part 0 carries who invites and what; every part carries some of the guest list. */
export type EventPost = {
  version: 1;
  id: string;
  sentAt: string;
  eventId: string;
  rev: number;
  since: number;
  part: number;
  parts: number;
  head?: { organizer: string; details: EventDetails; cancelled?: true };
  guests: PostGuest[];
};

/** A part that came before the rest of its revision. */
type Pending = EventPost & { from: Contact; circleId: string };

/** Everything about shared events this account keeps, in its encrypted books. */
export type SharedCalendar = {
  /** Its own circles, by scope. */
  circles: Record<string, Circle>;
  hosted: HostedEvent[];
  invites: Invite[];
  pending: Pending[];
  /** Where reading each circle it was given goes on from: `${contactRef}|${circleId}|${epoch}` → next slot. */
  reads: Record<string, number>;
};

export const emptyCalendar = (): SharedCalendar => ({ circles: {}, hosted: [], invites: [], pending: [], reads: {} });

// ---- Checking --------------------------------------------------------------------------

const details = (raw: unknown) => {
  try {
    return validateDetails(raw, MAX_SHARED_NOTES);
  } catch (e) {
    throw new SharedEventError(e instanceof EventError ? e.message : "The event isn't valid");
  }
};

function validateCircle(raw: unknown): Circle {
  if (!isObject(raw)) throw new SharedEventError("A circle must be an object");
  if (typeof raw.id !== "string" || !HEX16.test(raw.id)) throw new SharedEventError("A circle needs its id");
  if (!isCount(raw.epoch, 999_999) || typeof raw.key !== "string" || !HEX64.test(raw.key)) throw new SharedEventError("A circle needs its key");
  if (!isCount(raw.nextOut)) throw new SharedEventError("A circle's next slot must be a whole number");
  return { id: raw.id, epoch: raw.epoch, key: raw.key, nextOut: raw.nextOut };
}

function validateHosted(raw: unknown): HostedEvent {
  if (!isObject(raw)) throw new SharedEventError("An event must be an object");
  if (typeof raw.id !== "string" || !ID.test(raw.id)) throw new SharedEventError("An event needs an id");
  if (!isRev(raw.rev) || !isRev(raw.since) || raw.since > raw.rev) throw new SharedEventError("An event needs its revision");
  if (typeof raw.scope !== "string" || (raw.scope !== "" && !HEX64.test(raw.scope))) throw new SharedEventError("An event needs the circle it goes out under");
  if (!isStamp(raw.createdAt) || !isStamp(raw.updatedAt)) throw new SharedEventError("An event needs when it was made");
  const event: HostedEvent = { id: raw.id, rev: raw.rev, since: raw.since, scope: raw.scope, details: details(raw.details), guests: guests(raw.guests, 1), createdAt: raw.createdAt, updatedAt: raw.updatedAt };
  if (raw.cancelled !== undefined) {
    if (raw.cancelled !== true) throw new SharedEventError("Cancelled must be true");
    event.cancelled = true;
  }
  if (raw.sent !== undefined) {
    const s = raw.sent;
    if (!isObject(s) || !isRev(s.rev) || s.rev > event.rev || !isStamp(s.at)) throw new SharedEventError("An event's last send isn't valid");
    event.sent = { rev: s.rev, guests: guests(s.guests, 1), at: s.at };
  }
  return event;
}

function validatePostGuest(raw: unknown): PostGuest {
  if (!isObject(raw)) throw new SharedEventError("A guest must be an object");
  if (typeof raw.who !== "string" || !WHO.test(raw.who)) throw new SharedEventError("A guest needs their tag");
  const g: PostGuest = { name: guestName(raw.name), who: raw.who };
  if (raw.answer !== undefined) {
    if (!EVENT_ANSWERS.includes(raw.answer as EventAnswer)) throw new SharedEventError("A guest's answer is yes, maybe or no");
    g.answer = raw.answer as EventAnswer;
  }
  return g;
}

/** Checks a post that arrived: every field in shape, the head on part 0 and nowhere else. */
export function validateEventPost(raw: unknown): EventPost {
  if (!isObject(raw)) throw new SharedEventError("An event post must be an object");
  if (raw.version !== 1) throw new SharedEventError("Unknown event post version");
  if (typeof raw.id !== "string" || !ID.test(raw.id)) throw new SharedEventError("An event post needs an id");
  if (!isStamp(raw.sentAt)) throw new SharedEventError("An event post needs the time it was sent");
  if (typeof raw.eventId !== "string" || !ID.test(raw.eventId)) throw new SharedEventError("An event post names its event");
  if (!isRev(raw.rev) || !isRev(raw.since) || raw.since > raw.rev) throw new SharedEventError("An event post names its revision");
  if (!isCount(raw.parts, MAX_EVENT_PARTS) || raw.parts < 1) throw new SharedEventError("An event post says how many parts it has");
  if (!isCount(raw.part) || raw.part >= raw.parts) throw new SharedEventError("An event post's part is out of range");
  if (!Array.isArray(raw.guests) || raw.guests.length > MAX_GUESTS) throw new SharedEventError("An event post's guests must be a list");
  const post: EventPost = { version: 1, id: raw.id, sentAt: raw.sentAt, eventId: raw.eventId, rev: raw.rev, since: raw.since, part: raw.part, parts: raw.parts, guests: raw.guests.map(validatePostGuest) };
  if (raw.part === 0) {
    const h = raw.head;
    if (!isObject(h)) throw new SharedEventError("An event post's first part says what the event is");
    const head: NonNullable<EventPost["head"]> = { organizer: guestName(h.organizer), details: details(h.details) };
    if (h.cancelled !== undefined) {
      if (h.cancelled !== true) throw new SharedEventError("Cancelled must be true");
      head.cancelled = true;
    }
    post.head = head;
  } else if (raw.head !== undefined) {
    throw new SharedEventError("Only an event post's first part says what the event is");
  }
  return post;
}

function validateInvite(raw: unknown): Invite {
  if (!isObject(raw)) throw new SharedEventError("An invitation must be an object");
  if (typeof raw.eventId !== "string" || !ID.test(raw.eventId)) throw new SharedEventError("An invitation names its event");
  if (typeof raw.circleId !== "string" || !HEX16.test(raw.circleId)) throw new SharedEventError("An invitation names its circle");
  if (!isRev(raw.rev) || !isRev(raw.since) || raw.since > raw.rev) throw new SharedEventError("An invitation names its revision");
  if (raw.status !== "open" && raw.status !== "cancelled" && raw.status !== "removed") throw new SharedEventError("An invitation is open, cancelled or removed");
  if (!isStamp(raw.sentAt) || !isStamp(raw.receivedAt)) throw new SharedEventError("An invitation needs when it came");
  if (!Array.isArray(raw.guests) || raw.guests.length > MAX_GUESTS) throw new SharedEventError("An invitation's guests must be a list");
  if (typeof raw.me !== "string" || !WHO.test(raw.me)) throw new SharedEventError("An invitation needs this account's tag");
  if (raw.hidden !== undefined && raw.hidden !== true) throw new SharedEventError("Hidden must be true");
  return {
    eventId: raw.eventId,
    from: validateContact(raw.from),
    circleId: raw.circleId,
    organizer: guestName(raw.organizer),
    rev: raw.rev,
    since: raw.since,
    details: details(raw.details),
    guests: raw.guests.map(validatePostGuest),
    me: raw.me,
    status: raw.status,
    sentAt: raw.sentAt,
    receivedAt: raw.receivedAt,
    ...(raw.hidden ? { hidden: true as const } : {}),
  };
}

function validatePending(raw: unknown): Pending {
  const post = validateEventPost(raw);
  const r = raw as Record<string, unknown>;
  if (typeof r.circleId !== "string" || !HEX16.test(r.circleId)) throw new SharedEventError("A waiting part names its circle");
  return { ...post, from: validateContact(r.from), circleId: r.circleId };
}

/** Checks the calendar from the vault. */
export function validateCalendar(raw: unknown): SharedCalendar {
  if (!isObject(raw)) throw new SharedEventError("The shared calendar must be an object");
  if (!isObject(raw.circles)) throw new SharedEventError("The circles must be a map");
  const circles: Record<string, Circle> = {};
  for (const [scope, c] of Object.entries(raw.circles)) {
    if (scope !== "" && !HEX64.test(scope)) throw new SharedEventError("A circle's scope isn't valid");
    circles[scope] = validateCircle(c);
  }
  if (!Array.isArray(raw.hosted) || raw.hosted.length > MAX_HOSTED) throw new SharedEventError(`At most ${MAX_HOSTED} events you organize`);
  if (!Array.isArray(raw.invites) || raw.invites.length > MAX_INVITES) throw new SharedEventError(`At most ${MAX_INVITES} invitations`);
  if (!Array.isArray(raw.pending) || raw.pending.length > MAX_PENDING) throw new SharedEventError("Too many waiting parts");
  if (!isObject(raw.reads) || !Object.values(raw.reads).every((n) => isCount(n))) throw new SharedEventError("The reading places must be whole numbers");
  const hosted = new Map<string, HostedEvent>();
  for (const e of raw.hosted.map(validateHosted)) hosted.set(e.id, e);
  const invites = new Map<string, Invite>();
  for (const i of raw.invites.map(validateInvite)) invites.set(inviteKey(i), i);
  return { circles, hosted: [...hosted.values()], invites: [...invites.values()], pending: raw.pending.map(validatePending), reads: { ...(raw.reads as Record<string, number>) } };
}

export const calendarToJson = (c: SharedCalendar): string => JSON.stringify(validateCalendar(c));
export const calendarFromJson = (text: string): SharedCalendar => validateCalendar(JSON.parse(text));

// ---- Organizing ------------------------------------------------------------------------------

const randomHex = (bytes: number) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

/** The circle for `scope`, made the first time. */
export function ensureCircle(cal: SharedCalendar, scope: string): { calendar: SharedCalendar; circle: Circle } {
  const existing = cal.circles[scope];
  if (existing) return { calendar: cal, circle: existing };
  const circle: Circle = { id: randomHex(8), epoch: 0, key: randomHex(32), nextOut: 0 };
  return { calendar: { ...cal, circles: { ...cal.circles, [scope]: circle } }, circle };
}

/** Moves a circle's slot past one it posted in. */
export function usedSlot(cal: SharedCalendar, scope: string, seq: number): SharedCalendar {
  const c = cal.circles[scope];
  if (!c) throw new SharedEventError("That circle isn't here");
  return { ...cal, circles: { ...cal.circles, [scope]: { ...c, nextOut: Math.max(c.nextOut, seq + 1) } } };
}

const sameDetails = (a: EventDetails, b: EventDetails) => JSON.stringify(details(a)) === JSON.stringify(details(b));

/** A new event with guests, not sent yet. */
export function newHosted(scope: string, what: EventDetails, invited: readonly Guest[], now: Date = new Date()): HostedEvent {
  const stamp = now.toISOString();
  return validateHosted({ id: randomHex(16), rev: 1, since: 1, scope, details: what, guests: invited, createdAt: stamp, updatedAt: stamp });
}

/** The event changed: a new revision; what, when or where changing asks everyone again. Nothing changed, the same event back. */
export function editHosted(event: HostedEvent, what: EventDetails, invited: readonly Guest[], now: Date = new Date()): HostedEvent {
  if (event.cancelled) throw new SharedEventError("A cancelled event can't change");
  const moved = !sameDetails(event.details, what);
  const next = validateHosted({ ...event, details: what, guests: invited });
  const list = (gs: readonly Guest[]) => JSON.stringify(gs.map((g) => [contactRef(g.contact), g.name]).sort());
  if (!moved && list(next.guests) === list(event.guests)) return event;
  const rev = event.sent && event.sent.rev === event.rev ? event.rev + 1 : event.rev;
  return { ...next, rev, since: moved ? rev : event.since, updatedAt: now.toISOString() };
}

/** Called off: one last revision tells everyone. */
export function cancelHosted(event: HostedEvent, now: Date = new Date()): HostedEvent {
  if (event.cancelled) return event;
  const rev = event.sent && event.sent.rev === event.rev ? event.rev + 1 : event.rev;
  return { ...event, rev, cancelled: true, updatedAt: now.toISOString() };
}

/** Whether the guests haven't heard the latest. A cancelled event nobody was ever told about needs nothing. */
export const needsSend = (e: HostedEvent): boolean => (e.sent ? e.sent.rev < e.rev : !e.cancelled);

/** Everyone a send goes to: the guests now, and anyone the last send named who has since been taken off (so they hear it). */
export function recipientsOf(e: HostedEvent): Guest[] {
  const out = new Map(e.guests.map((g) => [contactRef(g.contact), g]));
  for (const g of e.sent?.guests ?? []) if (!out.has(contactRef(g.contact))) out.set(contactRef(g.contact), g);
  return [...out.values()];
}

/** The latest revision went out. */
export const markSent = (e: HostedEvent, at: Date = new Date()): HostedEvent => ({ ...e, sent: { rev: e.rev, guests: e.guests, at: at.toISOString() } });

export function putHosted(cal: SharedCalendar, e: HostedEvent): SharedCalendar {
  const clean = validateHosted(e);
  const rest = cal.hosted.filter((h) => h.id !== clean.id);
  if (rest.length >= MAX_HOSTED) throw new SharedEventError(`At most ${MAX_HOSTED} events you organize`);
  return { ...cal, hosted: [...rest, clean] };
}

/** An event can go from the books once nobody needs to hear about it: never sent, or its cancellation sent. */
export const canDelete = (e: HostedEvent): boolean => !e.sent || (!!e.cancelled && !needsSend(e));

export function deleteHosted(cal: SharedCalendar, id: string): SharedCalendar {
  const e = cal.hosted.find((h) => h.id === id);
  if (e && !canDelete(e)) throw new SharedEventError("Cancel the event first, so the guests hear about it");
  return { ...cal, hosted: cal.hosted.filter((h) => h.id !== id) };
}

/** The guest list as a post names it: each guest's tag (from `whoOf`, the key the organizer shares with them) and their answer to the current revision. */
export function postGuests(e: HostedEvent, whoOf: (g: Guest) => string, answers: ReadonlyMap<string, GuestAnswer>): PostGuest[] {
  return e.guests.map((g) => {
    const a = answers.get(contactRef(g.contact));
    return { name: g.name, who: whoOf(g), ...(a && a.rev >= e.since ? { answer: a.answer } : {}) };
  });
}

// ---- Answers ---------------------------------------------------------------------------------

export type GuestAnswer = { answer: EventAnswer; note: string; rev: number; at: string };

type AnswerItem = ThreadItem & { body: Extract<ThreadItem["body"], { type: "event_answer" }> };

/** The latest answer about `eventId` in one conversation: theirs (`mine` false) or this account's. */
export function answerIn(thread: Thread | undefined, eventId: string, mine: boolean): GuestAnswer | undefined {
  const a = thread?.items.filter((i): i is AnswerItem => i.mine === mine && i.body.type === "event_answer" && i.body.eventId === eventId).at(-1);
  return a ? { answer: a.body.answer, note: a.body.note, rev: a.body.rev, at: a.sentAt } : undefined;
}

/** Each guest's latest answer, by conversation. */
export function answersFor(e: HostedEvent, threadOf: (c: Contact) => Thread | undefined): Map<string, GuestAnswer> {
  const out = new Map<string, GuestAnswer>();
  for (const g of e.guests) {
    const a = answerIn(threadOf(g.contact), e.id, false);
    if (a) out.set(contactRef(g.contact), a);
  }
  return out;
}

/** Whether an answer still counts: given to the current version of what, when and where. */
export const answerCounts = (a: GuestAnswer | undefined, since: number): boolean => !!a && a.rev >= since;

// ---- Being invited ---------------------------------------------------------------------------

export const inviteKey = (i: { from: Contact; eventId: string }): string => `${contactRef(i.from)}|${i.eventId}`;

/** Where reading one circle's key goes on from. */
export const readKey = (from: Contact, circleId: string, epoch: number): string => `${contactRef(from)}|${circleId}|${epoch}`;

/** A circle key this account was given: through which conversation, and the organizer's account there. */
export type HeldKey = { from: Contact; circleId: string; epoch: number; key: string };

/** The circle keys that came in one conversation, latest per circle and number. */
export function keysIn(from: Contact, thread: Thread | undefined): HeldKey[] {
  const out = new Map<string, HeldKey>();
  for (const i of thread?.items ?? []) {
    if (i.mine || i.body.type !== "event_key") continue;
    out.set(`${i.body.circleId}|${i.body.epoch}`, { from, circleId: i.body.circleId, epoch: i.body.epoch, key: i.body.key });
  }
  return [...out.values()];
}

/** Whether this account already gave `circle`'s current key in a conversation. */
export const gaveKey = (thread: Thread | undefined, circle: Circle): boolean =>
  !!thread?.items.some((i) => i.mine && i.body.type === "event_key" && i.body.circleId === circle.id && i.body.epoch === circle.epoch);

/**
 * Keeps one post that arrived through `from` under circle `circleId`. A
 * revision shows once all its parts are in; an older revision than the one
 * kept changes nothing. `me` is this account's tag with that organizer.
 */
export function receivePost(cal: SharedCalendar, from: Contact, circleId: string, post: EventPost, me: string, receivedAt: string): SharedCalendar {
  const clean = validateEventPost(post);
  const ref = contactRef(from);
  const key = inviteKey({ from, eventId: clean.eventId });
  const current = cal.invites.find((i) => inviteKey(i) === key);
  if (current && current.rev >= clean.rev) return cal;
  const same = (p: Pending) => contactRef(p.from) === ref && p.eventId === clean.eventId;
  const parts = [...cal.pending.filter((p) => same(p) && p.rev === clean.rev && p.part !== clean.part), { ...clean, from, circleId }];
  if (parts.length < clean.parts || !parts.every((p) => p.parts === clean.parts)) {
    const pending = [...cal.pending.filter((p) => !(same(p) && p.rev === clean.rev && p.part === clean.part)), { ...clean, from, circleId }].slice(-MAX_PENDING);
    return { ...cal, pending };
  }
  parts.sort((a, b) => a.part - b.part);
  const head = parts[0]!.head!;
  const list = parts.flatMap((p) => p.guests);
  const invited = list.some((g) => g.who === me);
  const status: Invite["status"] = head.cancelled ? "cancelled" : invited ? "open" : "removed";
  // Taken off, or called off, before this account ever saw it: nothing to show.
  const pending = cal.pending.filter((p) => !(same(p) && p.rev <= clean.rev));
  if (!current && status !== "open") return { ...cal, pending };
  // A change brings one put away back, unless it's called off or this account was taken off.
  const hidden = current?.hidden && status !== "open" ? { hidden: true as const } : {};
  const invite: Invite = { eventId: clean.eventId, from, circleId, organizer: head.organizer, rev: clean.rev, since: clean.since, details: head.details, guests: list, me, status, sentAt: clean.sentAt, receivedAt, ...hidden };
  return { ...cal, pending, invites: [...cal.invites.filter((i) => inviteKey(i) !== key), validateInvite(invite)] };
}

/** Puts an invitation away from the calendar (it stays in the books, so reading it again doesn't bring it back). */
export function hideInvite(cal: SharedCalendar, key: string): SharedCalendar {
  return { ...cal, invites: cal.invites.map((i) => (inviteKey(i) === key ? { ...i, hidden: true as const } : i)) };
}

/** Moves reading a circle's key past slot `seq`. */
export const readPast = (cal: SharedCalendar, key: string, seq: number): SharedCalendar => ({ ...cal, reads: { ...cal.reads, [key]: Math.max(cal.reads[key] ?? 0, seq + 1) } });

/** Open invitations this account hasn't answered (or whose time or place changed since it did), soonest first. */
export function waitingInvites(cal: SharedCalendar | null | undefined, myAnswer: (i: Invite) => GuestAnswer | undefined, today: string): Invite[] {
  return (cal?.invites ?? [])
    .filter((i) => i.status === "open" && !i.hidden && !answerCounts(myAnswer(i), i.since) && lastDay(i.details) >= today)
    .sort((a, b) => (a.details.date < b.details.date ? -1 : a.details.date > b.details.date ? 1 : 0));
}

const lastDay = (d: EventDetails) => (d.allDay ? (d.endDate ?? d.date) : d.date);

// ---- On the calendar ---------------------------------------------------------------------------

/** One thing on the calendar that isn't a shift: a personal event, one this account organizes, or one it's invited to. */
export type CalendarEvent = EventDetails & {
  /** Unique on the calendar: the personal event's id, `h:` and the event's id, or `i:` and the invitation's key. */
  id: string;
  kind: "personal" | "hosting" | "invited";
  /** Invited and not answered yet (or asked again): drawn dashed. */
  unanswered?: true;
  /** Called off: drawn struck through, so someone who was going sees it. */
  cancelled?: true;
};

/**
 * The shared events to draw: what this account organizes (struck through once
 * called off), and its invitations: not the ones it declined or was taken off,
 * and a called-off one only when it hadn't said no.
 */
export function sharedCalendarEvents(cal: SharedCalendar | null | undefined, myAnswer: (i: Invite) => GuestAnswer | undefined): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const e of cal?.hosted ?? []) out.push({ ...e.details, id: `h:${e.id}`, kind: "hosting", ...(e.cancelled ? { cancelled: true as const } : {}) });
  for (const i of cal?.invites ?? []) {
    if (i.status === "removed" || i.hidden) continue;
    const a = myAnswer(i);
    if (a?.answer === "no" && (i.status === "cancelled" || answerCounts(a, i.since))) continue;
    if (i.status === "cancelled") out.push({ ...i.details, id: `i:${inviteKey(i)}`, kind: "invited", cancelled: true });
    else out.push({ ...i.details, id: `i:${inviteKey(i)}`, kind: "invited", ...(answerCounts(a, i.since) ? {} : { unanswered: true as const }) });
  }
  return out;
}
