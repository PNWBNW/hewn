import { describe, expect, it } from "vitest";
import {
  type Contact,
  type EventPost,
  type Guest,
  type HostedEvent,
  type Invite,
  answerCounts,
  answersFor,
  calendarFromJson,
  calendarToJson,
  canDelete,
  cancelHosted,
  contactRef,
  deleteHosted,
  editHosted,
  emptyCalendar,
  ensureCircle,
  eventWho,
  hideInvite,
  inviteKey,
  gaveKey,
  keysIn,
  markSent,
  needsSend,
  newHosted,
  postGuests,
  putHosted,
  readKey,
  readPast,
  receivePost,
  recipientsOf,
  sharedCalendarEvents,
  usedSlot,
  validateCalendar,
  validateEventPost,
  waitingInvites,
} from "./shared_events";
import { type Thread, type ThreadItem, emptyThread, validateMessage } from "./thread";

const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);
const KEY_C = "c3".repeat(32);
const ADDR = (c: string) => `aleo1${c.repeat(58)}`;
const pair = (partiesKey: string): Contact => ({ via: "pair", partiesKey });
const maria: Guest = { name: "Maria", address: ADDR("q"), contact: pair(KEY_A) };
const sam: Guest = { name: "Sam", address: ADDR("p"), contact: pair(KEY_B) };
const lee: Guest = { name: "Lee", address: ADDR("z"), contact: { via: "coworker", businessKey: KEY_C, publicKey: `04${"d".repeat(128)}` } };
const meeting = { title: "Site walkthrough", date: "2026-10-28", allDay: false, start: "09:00", end: "10:00", place: "1420 Elm St" };
const at = (iso: string) => new Date(iso);

const post = (over: Partial<EventPost> = {}): EventPost => ({
  version: 1,
  id: "e".repeat(32),
  sentAt: "2026-10-22T16:00:00.000Z",
  eventId: "1".repeat(32),
  rev: 1,
  since: 1,
  part: 0,
  parts: 1,
  head: { organizer: "Day Construction", details: meeting },
  guests: [
    { name: "Maria", who: eventWho(KEY_A) },
    { name: "Sam", who: eventWho(KEY_B), answer: "yes" },
  ],
  ...over,
});

const answer = (eventId: string, rev: number, ans: "yes" | "maybe" | "no", mine: boolean, sentAt = "2026-10-22T17:00:00.000Z"): ThreadItem => ({
  ...validateMessage({ version: 1, id: sentAt.replace(/\D/g, "").padEnd(32, "0").slice(0, 32), from: mine ? "worker" : "business", sentAt, body: { type: "event_answer", eventId, rev, title: "Site walkthrough", answer: ans, note: "" } }, mine ? "worker" : "business"),
  mine,
  seq: 0,
});
const threadWith = (...items: ThreadItem[]): Thread => ({ ...emptyThread(), items });

describe("a guest's tag", () => {
  it("is twelve hex characters, the same for the same key and different for another", () => {
    expect(eventWho(KEY_A)).toMatch(/^[0-9a-f]{12}$/);
    expect(eventWho(KEY_A)).toBe(eventWho(KEY_A));
    expect(eventWho(KEY_A)).not.toBe(eventWho(KEY_B));
  });
});

describe("an event post", () => {
  it("takes a first part with what the event is, and later parts with guests only", () => {
    expect(validateEventPost(post())).toEqual(post());
    const second = post({ part: 1, parts: 2, guests: [{ name: "Lee", who: "0".repeat(12) }] });
    delete second.head;
    expect(validateEventPost(second).head).toBeUndefined();
  });

  it("refuses what an organizer's app couldn't have sent", () => {
    expect(() => validateEventPost(post({ part: 1, parts: 2 }))).toThrow("first part");
    expect(() => validateEventPost({ ...post(), head: undefined })).toThrow("says what the event is");
    expect(() => validateEventPost(post({ part: 2, parts: 2 }))).toThrow("out of range");
    expect(() => validateEventPost(post({ rev: 1, since: 2 }))).toThrow("revision");
    expect(() => validateEventPost(post({ guests: [{ name: "Maria", who: "zz" }] }))).toThrow("tag");
    expect(() => validateEventPost({ ...post(), guests: [{ name: "Maria", who: eventWho(KEY_A), answer: "sure" }] })).toThrow("yes, maybe or no");
    expect(() => validateEventPost(post({ head: { organizer: "X", details: { ...meeting, link: "javascript:alert(1)" } } }))).toThrow("https");
    expect(() => validateEventPost(post({ head: { organizer: "X", details: { ...meeting, notes: "n".repeat(501) } } }))).toThrow("at most 500");
    expect(() => validateEventPost({ ...post(), version: 2 })).toThrow("version");
  });
});

describe("organizing", () => {
  const first = newHosted("", meeting, [maria, sam], at("2026-10-22T15:00:00Z"));

  it("keeps changes before the first send in revision 1", () => {
    expect(first).toMatchObject({ rev: 1, since: 1, scope: "" });
    expect(needsSend(first)).toBe(true);
    const moved = editHosted(first, { ...meeting, start: "10:00", end: "11:00" }, [maria, sam]);
    expect(moved).toMatchObject({ rev: 1, since: 1 });
  });

  it("after a send, a new time asks everyone again; a new guest alone doesn't", () => {
    const sent = markSent(first, at("2026-10-22T16:00:00Z"));
    expect(needsSend(sent)).toBe(false);
    expect(editHosted(sent, meeting, [sam, maria])).toBe(sent); // same people, another order: nothing changed
    const moreGuests = editHosted(sent, meeting, [maria, sam, lee]);
    expect(moreGuests).toMatchObject({ rev: 2, since: 1 });
    const moved = editHosted(sent, { ...meeting, date: "2026-10-29" }, [maria, sam]);
    expect(moved).toMatchObject({ rev: 2, since: 2 });
    expect(needsSend(moved)).toBe(true);
  });

  it("tells someone taken off the list, and everyone when it's called off", () => {
    const sent = markSent(first);
    const without = editHosted(sent, meeting, [maria]);
    expect(recipientsOf(without).map((g) => g.name).sort()).toEqual(["Maria", "Sam"]);
    expect(recipientsOf(markSent(without)).map((g) => g.name)).toEqual(["Maria"]);
    const off = cancelHosted(sent);
    expect(off).toMatchObject({ rev: 2, cancelled: true });
    expect(needsSend(off)).toBe(true);
    expect(() => editHosted(off, meeting, [maria])).toThrow("cancelled");
  });

  it("deletes only what nobody needs to hear about", () => {
    let cal = putHosted(emptyCalendar(), first);
    expect(canDelete(first)).toBe(true);
    const sent = markSent(first);
    cal = putHosted(cal, sent);
    expect(() => deleteHosted(cal, sent.id)).toThrow("Cancel the event first");
    const told = markSent(cancelHosted(sent));
    cal = putHosted(cal, told);
    expect(deleteHosted(cal, sent.id).hosted).toEqual([]);
    // Called off before it was ever sent: nothing to tell.
    expect(needsSend(cancelHosted(first))).toBe(false);
  });

  it("names each guest by their tag, with answers to the current version only", () => {
    const sent = markSent(editHosted(markSent(first), { ...meeting, date: "2026-10-29" }, [maria, sam]));
    const answers = answersFor(sent, (c) => (contactRef(c) === contactRef(maria.contact) ? threadWith(answer(sent.id, 1, "yes", false)) : threadWith(answer(sent.id, 2, "maybe", false))));
    const list = postGuests(sent, (g) => eventWho((g.contact as { partiesKey: string }).partiesKey), answers);
    expect(list).toEqual([
      { name: "Maria", who: eventWho(KEY_A) }, // answered the old time
      { name: "Sam", who: eventWho(KEY_B), answer: "maybe" },
    ]);
  });

  it("has a circle per scope, made once, whose slot moves on", () => {
    const { calendar, circle } = ensureCircle(emptyCalendar(), "");
    expect(circle).toMatchObject({ epoch: 0, nextOut: 0 });
    expect(circle.key).toMatch(/^[0-9a-f]{64}$/);
    expect(ensureCircle(calendar, "").circle).toBe(circle);
    expect(ensureCircle(calendar, KEY_C).circle.id).not.toBe(circle.id);
    expect(usedSlot(calendar, "", 4).circles[""]!.nextOut).toBe(5);
  });
});

describe("being invited", () => {
  const from = pair(KEY_A);
  const me = eventWho(KEY_A);
  const now = "2026-10-22T16:05:00.000Z";

  it("keeps an invitation, and ignores an older revision", () => {
    const cal = receivePost(emptyCalendar(), from, "f".repeat(16), post(), me, now);
    expect(cal.invites).toHaveLength(1);
    expect(cal.invites[0]).toMatchObject({ status: "open", organizer: "Day Construction", rev: 1 });
    const later = receivePost(cal, from, "f".repeat(16), post({ id: "d".repeat(32), rev: 2, since: 2, head: { organizer: "Day Construction", details: { ...meeting, date: "2026-10-29" } } }), me, now);
    expect(later.invites[0]!.details.date).toBe("2026-10-29");
    expect(receivePost(later, from, "f".repeat(16), post(), me, now)).toBe(later);
  });

  it("shows a big guest list once all its parts are in, whatever order they came", () => {
    const p0 = post({ parts: 2, guests: [{ name: "Maria", who: me }] });
    const p1: EventPost = { ...post({ id: "c".repeat(32), part: 1, parts: 2, guests: [{ name: "Sam", who: eventWho(KEY_B) }] }) };
    delete p1.head;
    const half = receivePost(emptyCalendar(), from, "f".repeat(16), p1, me, now);
    expect(half.invites).toEqual([]);
    expect(half.pending).toHaveLength(1);
    const whole = receivePost(half, from, "f".repeat(16), p0, me, now);
    expect(whole.pending).toEqual([]);
    expect(whole.invites[0]!.guests.map((g) => g.name)).toEqual(["Maria", "Sam"]);
  });

  it("marks one taken off the list, or called off; one never invited isn't kept", () => {
    const cal = receivePost(emptyCalendar(), from, "f".repeat(16), post(), me, now);
    const off = receivePost(cal, from, "f".repeat(16), post({ rev: 2, guests: [{ name: "Sam", who: eventWho(KEY_B) }] }), me, now);
    expect(off.invites[0]!.status).toBe("removed");
    const called = receivePost(cal, from, "f".repeat(16), post({ rev: 2, head: { organizer: "Day Construction", details: meeting, cancelled: true } }), me, now);
    expect(called.invites[0]!.status).toBe("cancelled");
    expect(receivePost(emptyCalendar(), from, "f".repeat(16), post(), eventWho(KEY_C), now).invites).toEqual([]);
  });

  it("waits for an answer, and asks again when the time changes", () => {
    const cal = receivePost(emptyCalendar(), from, "f".repeat(16), post(), me, now);
    const invite = cal.invites[0]!;
    const none = () => undefined;
    expect(waitingInvites(cal, none, "2026-10-22")).toHaveLength(1);
    expect(waitingInvites(cal, none, "2026-10-29")).toEqual([]); // it's past
    const yes = { answer: "yes" as const, note: "", rev: 1, at: now };
    expect(waitingInvites(cal, () => yes, "2026-10-22")).toEqual([]);
    expect(answerCounts(yes, 2)).toBe(false);
    const moved: Invite = { ...invite, rev: 2, since: 2 };
    expect(waitingInvites({ ...cal, invites: [moved] }, () => yes, "2026-10-22")).toHaveLength(1);
  });

  it("draws what's going on: unanswered dashed, declined left off, called off struck through", () => {
    const cal = receivePost(putHosted(emptyCalendar(), newHosted("", meeting, [maria])), from, "f".repeat(16), post(), me, now);
    const drawn = (a?: "yes" | "no") => sharedCalendarEvents(cal, () => (a ? { answer: a, note: "", rev: 1, at: now } : undefined));
    expect(drawn().map((e) => [e.kind, !!e.unanswered])).toEqual([
      ["hosting", false],
      ["invited", true],
    ]);
    expect(drawn("no").map((e) => e.kind)).toEqual(["hosting"]);
    const called = { ...cal, invites: [{ ...cal.invites[0]!, status: "cancelled" as const }] };
    expect(sharedCalendarEvents(called, () => undefined).find((e) => e.kind === "invited")).toMatchObject({ cancelled: true });
    // Put away: off the calendar, and reading the old letters again doesn't bring it back.
    const away = hideInvite(called, inviteKey(called.invites[0]!));
    expect(sharedCalendarEvents(away, () => undefined).map((e) => e.kind)).toEqual(["hosting"]);
    expect(receivePost(away, from, "f".repeat(16), post(), me, now)).toBe(away);
  });

  it("finds the keys a conversation carried, and whether this account gave its own", () => {
    const keyItem = (mine: boolean, epoch: number): ThreadItem => ({
      ...validateMessage({ version: 1, id: `${epoch}${mine ? 1 : 0}`.padEnd(32, "a"), from: "business", sentAt: now, body: { type: "event_key", circleId: "f".repeat(16), epoch, key: KEY_C } }, "business"),
      mine,
      seq: epoch,
    });
    const thread = threadWith(keyItem(false, 0), keyItem(false, 1));
    expect(keysIn(from, thread).map((k) => k.epoch)).toEqual([0, 1]);
    expect(gaveKey(threadWith(keyItem(true, 0)), { id: "f".repeat(16), epoch: 0, key: KEY_C, nextOut: 0 })).toBe(true);
    expect(gaveKey(thread, { id: "f".repeat(16), epoch: 0, key: KEY_C, nextOut: 0 })).toBe(false);
  });
});

describe("the calendar in the vault", () => {
  it("round-trips, and refuses what the app couldn't have saved", () => {
    let cal = putHosted(ensureCircle(emptyCalendar(), "").calendar, markSent(newHosted("", meeting, [maria, lee])));
    cal = receivePost(cal, pair(KEY_B), "f".repeat(16), post(), eventWho(KEY_B), "2026-10-22T16:05:00.000Z");
    cal = readPast(cal, readKey(pair(KEY_B), "f".repeat(16), 0), 3);
    expect(calendarFromJson(calendarToJson(cal))).toEqual(cal);
    expect(() => validateCalendar({ ...cal, reads: { x: -1 } })).toThrow("whole numbers");
    const bad: HostedEvent = { ...cal.hosted[0]!, guests: [] };
    expect(() => validateCalendar({ ...cal, hosted: [bad] })).toThrow("guests");
    expect(() => validateCalendar({ ...cal, hosted: [{ ...cal.hosted[0]!, guests: [{ ...maria, address: "aleo1nope" }] }] })).toThrow("account");
    expect(() => validateCalendar({ ...cal, circles: { nope: cal.circles[""] } })).toThrow("scope");
  });
});

describe("the letters a conversation carries", () => {
  const msg = (body: unknown) => validateMessage({ version: 1, id: "a".repeat(32), from: "worker", sentAt: "2026-10-22T16:00:00.000Z", body }, "worker");

  it("takes a calendar key and an answer from either side", () => {
    expect(msg({ type: "event_key", circleId: "f".repeat(16), epoch: 0, key: KEY_A }).body.type).toBe("event_key");
    expect(msg({ type: "event_answer", eventId: "1".repeat(32), rev: 1, title: " Walkthrough ", answer: "maybe", note: " Running late " }).body).toEqual({
      type: "event_answer",
      eventId: "1".repeat(32),
      rev: 1,
      title: "Walkthrough",
      answer: "maybe",
      note: "Running late",
    });
  });

  it("refuses a malformed key or answer", () => {
    expect(() => msg({ type: "event_key", circleId: "f".repeat(16), epoch: 0, key: "short" })).toThrow("64 hex");
    expect(() => msg({ type: "event_key", circleId: "nope", epoch: 0, key: KEY_A })).toThrow("circle");
    expect(() => msg({ type: "event_answer", eventId: "1".repeat(32), rev: 0, title: "W", answer: "yes", note: "" })).toThrow("version");
    expect(() => msg({ type: "event_answer", eventId: "1".repeat(32), rev: 1, title: "W", answer: "sure", note: "" })).toThrow("yes, maybe or no");
    expect(() => msg({ type: "event_answer", eventId: "1".repeat(32), rev: 1, title: "W", answer: "no", note: "n".repeat(501) })).toThrow("500");
  });
});
