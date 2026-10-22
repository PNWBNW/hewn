// ---------------------------------------------------------------------------
// Personal events (Joshua, 2026-10-22): things a person or a business puts on
// their own calendar that nobody else needs to see (a meeting to go to, a
// supplier visit, a day off). They live only in the encrypted books: nothing
// goes on chain, nothing is sent, no approval. Shared events, with invites
// and answers, come later and are a different thing.
//
// An event is either timed (a date, a start and an end; an end at or before
// the start runs past midnight, as a night shift does) or all day (a first
// and a last date, so a week away is one event). It may carry where it is
// (free text), an online meeting link (https only) and notes. Pure.
// ---------------------------------------------------------------------------

import { addDays } from "./schedule";

export const MAX_EVENT_TITLE = 120;
export const MAX_EVENT_PLACE = 200;
export const MAX_EVENT_LINK = 500;
export const MAX_EVENT_NOTES = 2_000;
/** An all-day event can run for at most a year. */
const MAX_ALL_DAY_DAYS = 366;
/** How many personal events one set of books keeps. */
export const MAX_EVENTS = 2_000;

export type PersonalEvent = {
  id: string;
  title: string;
  /** YYYY-MM-DD: the day it starts. */
  date: string;
  allDay: boolean;
  /** All day: the last day it covers (inclusive), the same as `date` for one day. */
  endDate?: string;
  /** Timed: "HH:MM". An end at or before the start is the next day. */
  start?: string;
  end?: string;
  place?: string;
  link?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export class EventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventError";
  }
}

const ID = /^[0-9a-f]{32}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const chars = (s: string) => [...s].length;
const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function text(raw: unknown, max: number, what: string): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") throw new EventError(`${what} must be text`);
  const s = raw.trim();
  if (!s) return undefined;
  if (chars(s) > max) throw new EventError(`${what} can be at most ${max.toLocaleString("en-US")} characters`);
  return s;
}

/** A link a person can open: https only, so nothing else (a script, a file) hides behind it. */
export function cleanLink(raw: unknown): string | undefined {
  const s = text(raw, MAX_EVENT_LINK, "A link");
  if (!s) return undefined;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    throw new EventError("That link isn't a web address");
  }
  if (url.protocol !== "https:" || !url.hostname.includes(".")) throw new EventError("A link must be an https:// web address");
  return url.toString();
}

/** Checks an event (one being saved, or one read back from the vault) and returns a clean copy. */
export function validateEvent(raw: unknown): PersonalEvent {
  if (!isObject(raw)) throw new EventError("An event must be an object");
  if (typeof raw.id !== "string" || !ID.test(raw.id)) throw new EventError("An event needs an id");
  const title = text(raw.title, MAX_EVENT_TITLE, "A title");
  if (!title) throw new EventError("Give the event a title");
  if (!isDate(raw.date)) throw new EventError("Pick the day it starts");
  if (!isStamp(raw.createdAt) || !isStamp(raw.updatedAt)) throw new EventError("An event needs when it was made");
  const event: PersonalEvent = { id: raw.id, title, date: raw.date, allDay: raw.allDay === true, createdAt: raw.createdAt, updatedAt: raw.updatedAt };
  if (event.allDay) {
    const endDate = raw.endDate === undefined ? raw.date : raw.endDate;
    if (!isDate(endDate)) throw new EventError("Pick the last day");
    if (endDate < event.date) throw new EventError("The last day can't be before the first");
    if (endDate > addDays(event.date, MAX_ALL_DAY_DAYS - 1)) throw new EventError("An all-day event can run for at most a year");
    event.endDate = endDate;
  } else {
    if (typeof raw.start !== "string" || !TIME.test(raw.start)) throw new EventError("Pick when it starts");
    if (typeof raw.end !== "string" || !TIME.test(raw.end)) throw new EventError("Pick when it ends");
    if (raw.start === raw.end) throw new EventError("An event has to end after it starts");
    event.start = raw.start;
    event.end = raw.end;
  }
  const place = text(raw.place, MAX_EVENT_PLACE, "Where it is");
  const link = cleanLink(raw.link);
  const notes = text(raw.notes, MAX_EVENT_NOTES, "Notes");
  if (place) event.place = place;
  if (link) event.link = link;
  if (notes) event.notes = notes;
  return event;
}

/** The events from the vault: each checked, the same id kept once, in the order they happen. */
export function validateEvents(raw: unknown): PersonalEvent[] {
  if (!Array.isArray(raw)) throw new EventError("Events must be a list");
  if (raw.length > MAX_EVENTS) throw new EventError(`At most ${MAX_EVENTS.toLocaleString("en-US")} events`);
  const byId = new Map<string, PersonalEvent>();
  for (const e of raw.map(validateEvent)) byId.set(e.id, e);
  return sortEvents([...byId.values()]);
}

const startKey = (e: PersonalEvent) => `${e.date}T${e.allDay ? "00:00" : e.start}`;
export const sortEvents = (events: readonly PersonalEvent[]): PersonalEvent[] => [...events].sort((a, b) => (startKey(a) < startKey(b) ? -1 : startKey(a) > startKey(b) ? 1 : a.id < b.id ? -1 : 1));

/** Adds an event, or replaces the one with its id. */
export function saveEvent(events: readonly PersonalEvent[], event: PersonalEvent): PersonalEvent[] {
  const clean = validateEvent(event);
  const rest = events.filter((e) => e.id !== clean.id);
  if (rest.length >= MAX_EVENTS) throw new EventError(`At most ${MAX_EVENTS.toLocaleString("en-US")} events`);
  return sortEvents([...rest, clean]);
}

export const deleteEvent = (events: readonly PersonalEvent[], id: string): PersonalEvent[] => events.filter((e) => e.id !== id);

/** A fresh event id: 16 random bytes, hex. */
export function newEventId(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Whether an event touches a day: an all-day one across its days, a timed one on its date (and the next morning when it runs past midnight). */
export function onDay(e: PersonalEvent, day: string): boolean {
  if (e.allDay) return e.date <= day && day <= (e.endDate ?? e.date);
  if (e.date === day) return true;
  return e.date === addDays(day, -1) && e.end! < e.start! && e.end! !== "00:00";
}

// ---- The form ------------------------------------------------------------------------------

/** An event as the form holds it: every field as typed. */
export type EventDraft = { title: string; date: string; allDay: boolean; endDate: string; start: string; end: string; place: string; link: string; notes: string };

export const emptyDraft = (date: string): EventDraft => ({ title: "", date, allDay: false, endDate: date, start: "09:00", end: "10:00", place: "", link: "", notes: "" });

export const draftOf = (e: PersonalEvent): EventDraft => ({
  title: e.title,
  date: e.date,
  allDay: e.allDay,
  endDate: e.endDate ?? e.date,
  start: e.start ?? "09:00",
  end: e.end ?? "10:00",
  place: e.place ?? "",
  link: e.link ?? "",
  notes: e.notes ?? "",
});

/** The event a form holds (a new one, or `existing` changed), or why it can't be one yet. */
export function eventFromDraft(d: EventDraft, existing: PersonalEvent | undefined, now: Date = new Date()): { event: PersonalEvent } | { problem: string } {
  const stamp = now.toISOString();
  try {
    return {
      event: validateEvent({
        id: existing?.id ?? newEventId(),
        title: d.title,
        date: d.date,
        allDay: d.allDay,
        ...(d.allDay ? { endDate: d.endDate || d.date } : { start: d.start, end: d.end }),
        place: d.place,
        link: d.link,
        notes: d.notes,
        createdAt: existing?.createdAt ?? stamp,
        updatedAt: stamp,
      }),
    };
  } catch (e) {
    return { problem: e instanceof Error ? e.message : "That event isn't valid" };
  }
}
