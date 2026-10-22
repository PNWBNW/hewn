// Shared events end to end through a fake chain: the key goes out in each
// guest's conversation, the event is sealed once to everyone, a guest finds it
// across the gaps left by posts that went to others, and a post sealed with
// the circle's key by anyone but the organizer is never believed.
import { describe, expect, it } from "vitest";
import { MailboxError } from "@pnw/mailbox";
import {
  type Circle,
  type Contact,
  type HostedEvent,
  type PostGuest,
  type SharedCalendar,
  emptyCalendar,
  ensureCircle,
  eventWho,
  keysIn,
  markSent,
  newHosted,
  postGuests,
} from "../books/shared_events";
import { type Thread, addToThread, emptyThread } from "../books/thread";
import { type Listening, READ_AHEAD, eventParts, postEvent, readEvents, sendEventKeys } from "./events";
import type { LetterRecord } from "./letters";
import { LETTER_BYTES } from "./letters";
import { readThread } from "./thread";

const ORGANIZER = `aleo1${"q".repeat(58)}`;
const GUEST = `aleo1${"p".repeat(58)}`;
const MARIA_KEY = "a1".repeat(32);
const SAM_KEY = "b2".repeat(32);
const meeting = { title: "Site walkthrough", date: "2026-10-28", allDay: false, start: "09:00", end: "10:00", place: "1420 Elm St" };
const pair = (partiesKey: string): Contact => ({ via: "pair", partiesKey });

/** The chain as readers see it: every letter under each lookup, with the account that sent it. */
function fakeChain() {
  const letters = new Map<string, LetterRecord[]>();
  const sentBy = (sender: string) => ({
    async put(lookup: string, envelope: Uint8Array) {
      const list = letters.get(lookup) ?? [];
      if (list.some((l) => l.sender === sender)) throw new MailboxError("CONFLICT", "taken");
      letters.set(lookup, [...list, { kind: "letter", lookup, envelope: new Uint8Array(envelope), sender }]);
    },
  });
  return {
    sentBy,
    async getAll(lookup: string) {
      return letters.get(lookup) ?? [];
    },
    async get(lookup: string) {
      return letters.get(lookup)?.[0]?.envelope ?? null;
    },
    async drop() {},
  };
}

async function send(chain: ReturnType<typeof fakeChain>, sender: string, circle: Circle, e: HostedEvent, guests: PostGuest[]): Promise<Circle> {
  let c = circle;
  for (const part of await eventParts({ eventId: e.id, rev: e.rev, since: e.since, head: { organizer: "Day Construction", details: e.details } }, guests)) {
    const seq = await postEvent(chain.sentBy(sender), c, part);
    c = { ...c, nextOut: seq + 1 };
  }
  return c;
}

const guestList = (e: HostedEvent) => postGuests(e, (g) => eventWho((g.contact as { partiesKey: string }).partiesKey), new Map());

describe("event posts", () => {
  it("fit one letter for a small list, and go in parts for a long one", async () => {
    const few: PostGuest[] = [{ name: "Maria", who: eventWho(MARIA_KEY) }];
    const head = { organizer: "Day Construction", details: meeting };
    expect(await eventParts({ eventId: "1".repeat(32), rev: 1, since: 1, head }, few)).toHaveLength(1);
    const many: PostGuest[] = Array.from({ length: 120 }, (_, i) => ({ name: `Crew member number ${i} with a long name`.slice(0, 60), who: eventWho(i.toString(16).padStart(64, "0")) }));
    const parts = await eventParts({ eventId: "1".repeat(32), rev: 1, since: 1, head }, many);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.parts === parts.length)).toBe(true);
    expect(parts.flatMap((p) => p.guests)).toEqual(many);
    expect(parts.slice(1).every((p) => p.head === undefined)).toBe(true);
    // Each part, sealed, fits the letter it goes in.
    const chain = fakeChain();
    let circle = ensureCircle(emptyCalendar(), "").circle;
    for (const p of parts) circle = { ...circle, nextOut: (await postEvent(chain.sentBy(ORGANIZER), circle, p)) + 1 };
    expect(circle.nextOut).toBe(parts.length);
  });

  it("refuses details too long for a letter", async () => {
    await expect(eventParts({ eventId: "1".repeat(32), rev: 1, since: 1, head: { organizer: "X", details: meeting } }, [], new Date(), 120)).rejects.toThrow("too long for one letter");
    expect(LETTER_BYTES).toBeGreaterThan(1_000);
  });
});

describe("an invitation, end to end", () => {
  it("gives each guest the key once, reaches them across gaps, and believes only the organizer", async () => {
    const chain = fakeChain();
    let organizerCal: SharedCalendar = emptyCalendar();
    const made = ensureCircle(organizerCal, "");
    organizerCal = made.calendar;
    let circle = made.circle;

    // 1. The key, in Maria's conversation with the business.
    let orgThread: Thread = emptyThread();
    const keys = await sendEventKeys(
      [{ name: "Maria", conversationKey: MARIA_KEY, from: "business", nextOut: 0, client: chain.sentBy(ORGANIZER), keep: async (item) => void (orgThread = addToThread(orgThread, item)) }],
      circle,
    );
    expect(keys).toEqual({ sent: ["Maria"], failed: [] });
    let mariaThread: Thread = emptyThread();
    await readThread({ client: chain, partiesKey: MARIA_KEY, reader: "worker", thread: mariaThread, store: async (i) => void (mariaThread = addToThread(mariaThread, i)), skip: async () => {} });
    const held = keysIn(pair(MARIA_KEY), mariaThread);
    expect(held).toHaveLength(1);

    // 2. An event for Sam alone, then one for both: Maria's slots have a gap.
    const forSam = newHosted("", { ...meeting, title: "Sam only" }, [{ name: "Sam", address: GUEST, contact: pair(SAM_KEY) }]);
    circle = await send(chain, ORGANIZER, circle, forSam, guestList(forSam));
    const forBoth = newHosted("", meeting, [
      { name: "Maria", address: GUEST, contact: pair(MARIA_KEY) },
      { name: "Sam", address: GUEST, contact: pair(SAM_KEY) },
    ]);
    circle = await send(chain, ORGANIZER, circle, markSent(forBoth), guestList(forBoth));

    // 3. Sam, who holds the key too, forges a cancellation in the next slot.
    const forged = { ...forBoth, rev: 2 };
    const forgedParts = await eventParts({ eventId: forged.id, rev: 2, since: 2, head: { organizer: "Day Construction", details: meeting, cancelled: true } }, guestList(forged));
    await postEvent(chain.sentBy(GUEST), circle, forgedParts[0]!);

    // Maria reads: she only gets the one from the organizer, and the forgery is counted, not kept.
    let mariaCal: SharedCalendar = emptyCalendar();
    const listening: Listening[] = [{ held: held[0]!, organizer: ORGANIZER, me: eventWho(MARIA_KEY) }];
    const save = async (change: (c: SharedCalendar) => SharedCalendar) => void (mariaCal = change(mariaCal));
    const r = await readEvents({ letters: chain, listening, calendar: mariaCal, save });
    expect(r).toMatchObject({ received: 2, forged: 1 });
    // Sam's letter (rev 1 of another event, without her) isn't an invitation for her; the one for both is.
    expect(mariaCal.invites).toHaveLength(1);
    expect(mariaCal.invites[0]).toMatchObject({ eventId: forBoth.id, status: "open", rev: 1 });

    // Reading again changes nothing.
    const before = mariaCal;
    await readEvents({ letters: chain, listening, calendar: mariaCal, save });
    expect(mariaCal.invites).toEqual(before.invites);
  });

  it("looks far enough ahead to find a post after many that went to others", async () => {
    const chain = fakeChain();
    let circle = ensureCircle(emptyCalendar(), "").circle;
    const others = newHosted("", meeting, [{ name: "Sam", address: GUEST, contact: pair(SAM_KEY) }]);
    // A long run of letters to someone else: well past one look-ahead.
    const one = (await eventParts({ eventId: others.id, rev: 1, since: 1, head: { organizer: "Day", details: meeting } }, guestList(others)))[0]!;
    for (let i = 0; i < READ_AHEAD - 1; i++) circle = { ...circle, nextOut: (await postEvent(chain.sentBy(ORGANIZER), circle, one)) + 1 };
    const mine = newHosted("", meeting, [{ name: "Maria", address: GUEST, contact: pair(MARIA_KEY) }]);
    circle = await send(chain, ORGANIZER, circle, mine, guestList(mine));
    let cal: SharedCalendar = emptyCalendar();
    const held = { from: pair(MARIA_KEY), circleId: circle.id, epoch: circle.epoch, key: circle.key };
    await readEvents({ letters: chain, listening: [{ held, organizer: ORGANIZER, me: eventWho(MARIA_KEY) }], calendar: cal, save: async (c) => void (cal = c(cal)) });
    expect(cal.invites.map((i) => i.eventId)).toEqual([mine.id]);
  });

  it("keeps sending keys when one guest can't be reached", async () => {
    const circle = ensureCircle(emptyCalendar(), "").circle;
    const failing = { put: async () => Promise.reject(new Error("Shield said no")) };
    const chain = fakeChain();
    const out = await sendEventKeys(
      [
        { name: "Maria", conversationKey: MARIA_KEY, from: "business", nextOut: 0, client: failing, keep: async () => {} },
        { name: "Sam", conversationKey: SAM_KEY, from: "business", nextOut: 0, client: chain.sentBy(ORGANIZER), keep: async () => {} },
      ],
      circle,
    );
    expect(out).toEqual({ sent: ["Sam"], failed: [{ name: "Maria", ref: "Maria", message: "Shield said no" }] });
  });
});
