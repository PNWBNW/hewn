import { describe, expect, it } from "vitest";
import {
  type ReceivedHours,
  addHours,
  bumpHoursSeq,
  emptyMailbox,
  mailboxFromJson,
  mailboxToJson,
  markHoursRead,
  nextHoursSeq,
  unreadCount,
  validateMailbox,
  validateTimesheetPayload,
} from "./mailbox";

const AGREEMENT = "ab".repeat(32);
const LOOKUP = "cd".repeat(32);
const ENTRY = { date: "2026-10-05", in: "2026-10-05T15:00:00.000Z", out: "2026-10-05T23:30:00.000Z", minutes: 510 };
const PAYLOAD = {
  version: 1,
  kind: "timesheet",
  agreementId: AGREEMENT,
  weekStart: "2026-10-05",
  entries: [ENTRY, { ...ENTRY, date: "2026-10-06", in: "2026-10-06T15:00:00.000Z", out: "2026-10-06T19:00:00.000Z", minutes: 240 }],
  totalMinutes: 750,
  sentAt: "2026-10-11T18:00:00.000Z",
};

/** A week of hours in slot `seq`; each slot is its own week unless `over` says otherwise. */
const hours = (seq: number, over: Partial<ReceivedHours> = {}): ReceivedHours => ({
  agreementId: AGREEMENT,
  seq,
  lookup: LOOKUP,
  receivedAt: "2026-10-12T09:00:00.000Z",
  workerId: "wkr-1",
  weekStart: new Date(Date.UTC(2026, 9, 5 + 7 * seq)).toISOString().slice(0, 10),
  entries: PAYLOAD.entries,
  totalMinutes: PAYLOAD.totalMinutes,
  sentAt: PAYLOAD.sentAt,
  ...over,
});

describe("a timesheet another person sent", () => {
  it("is accepted when it is whole, for this agreement, and adds up", () => {
    expect(validateTimesheetPayload(PAYLOAD, AGREEMENT)).toEqual(PAYLOAD);
  });

  it("drops fields it doesn't know", () => {
    expect(validateTimesheetPayload({ ...PAYLOAD, note: "ignore", entries: [{ ...ENTRY, extra: 1 }], totalMinutes: 510 }, AGREEMENT).entries).toEqual([ENTRY]);
  });

  it("is refused for the wrong agreement, kind, version or week", () => {
    expect(() => validateTimesheetPayload(PAYLOAD, "ff".repeat(32))).toThrow(/different agreement/);
    expect(() => validateTimesheetPayload({ ...PAYLOAD, kind: "paystub" }, AGREEMENT)).toThrow(/isn't a week of hours/);
    expect(() => validateTimesheetPayload({ ...PAYLOAD, version: 2 }, AGREEMENT)).toThrow(/version/);
    expect(() => validateTimesheetPayload({ ...PAYLOAD, weekStart: "next week" }, AGREEMENT)).toThrow(/week/);
    expect(() => validateTimesheetPayload(null, AGREEMENT)).toThrow(/document/);
  });

  it("is refused when the total isn't the sum of the entries (hours can't be inflated)", () => {
    expect(() => validateTimesheetPayload({ ...PAYLOAD, totalMinutes: 751 }, AGREEMENT)).toThrow(/don't add up/);
    expect(() => validateTimesheetPayload({ ...PAYLOAD, totalMinutes: 0 }, AGREEMENT)).toThrow(/don't add up/);
  });

  it("is refused for entries that make no sense", () => {
    const bad = (entries: unknown, totalMinutes = 0) => () => validateTimesheetPayload({ ...PAYLOAD, entries, totalMinutes }, AGREEMENT);
    expect(bad([])).toThrow(/no entries/);
    expect(bad("x")).toThrow(/no entries/);
    expect(bad([{ ...ENTRY, minutes: 1441 }], 1441)).toThrow(/within one day/);
    expect(bad([{ ...ENTRY, minutes: -5 }], -5)).toThrow(/within one day/);
    expect(bad([{ ...ENTRY, minutes: 1.5 }], 1.5)).toThrow(/within one day/);
    expect(bad([{ ...ENTRY, date: "yesterday" }], 510)).toThrow(/date/);
    expect(bad([{ ...ENTRY, in: "never" }], 510)).toThrow(/start and an end/);
    expect(bad(Array.from({ length: 101 }, () => ({ ...ENTRY, minutes: 1 })), 101)).toThrow(/too many/);
    expect(bad([null], 0)).toThrow(/object/);
  });

  it("keeps an entry's long-shift flag, and only as true", () => {
    const long = validateTimesheetPayload({ ...PAYLOAD, entries: [{ ...ENTRY, long: true }, PAYLOAD.entries[1]] }, AGREEMENT);
    expect(long.entries[0]).toEqual({ ...ENTRY, long: true });
    expect(long.entries[1]).not.toHaveProperty("long");
    expect(() => validateTimesheetPayload({ ...PAYLOAD, entries: [{ ...ENTRY, long: "yes" }, PAYLOAD.entries[1]] }, AGREEMENT)).toThrow(/long flag/);
    expect(() => validateTimesheetPayload({ ...PAYLOAD, entries: [{ ...ENTRY, long: false }, PAYLOAD.entries[1]] }, AGREEMENT)).toThrow(/long flag/);
    const kept = addHours(emptyMailbox(), { ...hours(0), entries: long.entries });
    expect(mailboxFromJson(mailboxToJson(kept)).hours[0]?.entries[0]).toEqual({ ...ENTRY, long: true });
  });

  it("keeps an entry's callout flag, and only as true", () => {
    const sent = validateTimesheetPayload({ ...PAYLOAD, entries: [{ ...ENTRY, callout: true }, PAYLOAD.entries[1]] }, AGREEMENT);
    expect(sent.entries[0]).toEqual({ ...ENTRY, callout: true });
    expect(() => validateTimesheetPayload({ ...PAYLOAD, entries: [{ ...ENTRY, callout: 1 }, PAYLOAD.entries[1]] }, AGREEMENT)).toThrow(/callout flag/);
  });

  it("is refused without the time it was sent", () => {
    expect(() => validateTimesheetPayload({ ...PAYLOAD, sentAt: undefined }, AGREEMENT)).toThrow(/sent/);
  });
});

describe("a timesheet's entries are their clock times", () => {
  const one = (entry: Record<string, unknown> & { minutes: number }, weekStart = "2026-10-05") => ({ ...PAYLOAD, weekStart, entries: [entry], totalMinutes: entry.minutes });
  const LA = { startsOn: "monday" as const, timeZone: "America/Los_Angeles" };

  it("counts the minutes between an entry's start and end, not a number beside them", () => {
    expect(() => validateTimesheetPayload(one({ date: "2026-10-05", in: "2026-10-05T17:00:00.000Z", out: "2026-10-06T01:00:00.000Z", minutes: 1440 }), AGREEMENT)).toThrow(/between its start and end/);
    expect(() => validateTimesheetPayload(one({ ...ENTRY, minutes: 509 }), AGREEMENT)).toThrow(/between its start and end/);
    expect(() => validateTimesheetPayload(one({ ...ENTRY, minutes: 511 }), AGREEMENT)).toThrow(/between its start and end/);
    // Seconds past the minute are dropped, as the clock does.
    expect(validateTimesheetPayload(one({ ...ENTRY, out: "2026-10-05T23:30:59.000Z" }), AGREEMENT).entries[0]?.minutes).toBe(510);
    // A clock-in and clock-out at the same moment is an entry of no minutes.
    expect(validateTimesheetPayload(one({ ...ENTRY, out: ENTRY.in, minutes: 0 }), AGREEMENT).totalMinutes).toBe(0);
  });

  it("refuses an entry that ends before it starts", () => {
    expect(() => validateTimesheetPayload(one({ ...ENTRY, in: ENTRY.out, out: ENTRY.in, minutes: 0 }), AGREEMENT)).toThrow(/end after it starts/);
    expect(() => validateTimesheetPayload(one({ ...ENTRY, in: ENTRY.out, out: ENTRY.in, minutes: 510 }), AGREEMENT)).toThrow(/end after it starts/);
  });

  it("keeps every entry inside the week it is sent for", () => {
    const later = { date: "2026-10-12", in: "2026-10-12T15:00:00.000Z", out: "2026-10-12T23:00:00.000Z", minutes: 480 };
    expect(() => validateTimesheetPayload(one(later), AGREEMENT)).toThrow(/outside the week/);
    expect(() => validateTimesheetPayload(one(ENTRY, "2026-10-06"), AGREEMENT)).toThrow(/outside the week/);
    expect(validateTimesheetPayload(one(later, "2026-10-12"), AGREEMENT).weekStart).toBe("2026-10-12");
    // The last day of the week is in it.
    const sunday = { date: "2026-10-11", in: "2026-10-11T15:00:00.000Z", out: "2026-10-11T16:00:00.000Z", minutes: 60 };
    expect(validateTimesheetPayload(one(sunday), AGREEMENT).entries).toHaveLength(1);
  });

  it("dates each entry by the day it started", () => {
    // Far from the day it started, in any zone.
    expect(() => validateTimesheetPayload(one({ date: "2026-10-10", in: "2026-10-05T15:00:00.000Z", out: "2026-10-05T23:30:00.000Z", minutes: 510 }), AGREEMENT)).toThrow(/day it started/);
    // On the agreement's calendar, exactly that day.
    expect(() => validateTimesheetPayload(one({ date: "2026-11-10", in: "2026-09-01T15:00:00.000Z", out: "2026-09-01T23:00:00.000Z", minutes: 480 }, "2026-11-09"), AGREEMENT, LA)).toThrow(/day it started/);
    const evening = { date: "2026-10-06", in: "2026-10-06T03:00:00.000Z", out: "2026-10-06T06:00:00.000Z", minutes: 180 };
    expect(validateTimesheetPayload(one(evening), AGREEMENT).entries).toHaveLength(1); // the zone unknown: a day either side
    expect(() => validateTimesheetPayload(one(evening), AGREEMENT, LA)).toThrow(/day it started/); // 8pm on the 5th in Los Angeles
    expect(validateTimesheetPayload(one({ ...evening, date: "2026-10-05" }), AGREEMENT, LA).entries[0]?.date).toBe("2026-10-05");
    expect(validateTimesheetPayload(PAYLOAD, AGREEMENT, LA)).toEqual(PAYLOAD);
  });

  it("starts the week on the agreement's first day", () => {
    expect(() => validateTimesheetPayload(PAYLOAD, AGREEMENT, { ...LA, startsOn: "sunday" })).toThrow(/first day/);
  });

  it("holds what is already in these books to the rules it arrived under", () => {
    const kept = addHours(emptyMailbox(), { ...hours(0), entries: [{ ...ENTRY, minutes: 1440 }], totalMinutes: 1440 });
    expect(mailboxFromJson(mailboxToJson(kept)).hours[0]?.entries[0]?.minutes).toBe(1440);
  });
});

describe("the mailbox", () => {
  it("keeps a week and moves the next slot past it", () => {
    const m = addHours(emptyMailbox(), hours(0));
    expect(m.hours).toHaveLength(1);
    expect(nextHoursSeq(m, AGREEMENT)).toBe(1);
    expect(nextHoursSeq(m, "other")).toBe(0);
    expect(nextHoursSeq(addHours(m, hours(4)), AGREEMENT)).toBe(5);
  });

  it("never moves a slot backwards, and replaces a slot it already holds", () => {
    let m = addHours(emptyMailbox(), hours(3));
    m = addHours(m, hours(1));
    expect(nextHoursSeq(m, AGREEMENT)).toBe(4);
    m = addHours(m, hours(3, { totalMinutes: 510, entries: [ENTRY] }));
    expect(m.hours.filter((h) => h.seq === 3)).toHaveLength(1);
    expect(m.hours.find((h) => h.seq === 3)?.totalMinutes).toBe(510);
    expect(m.hours.find((h) => h.seq === 3)?.sends).toBeUndefined();
    expect(nextHoursSeq(bumpHoursSeq(m, AGREEMENT, 1), AGREEMENT)).toBe(4);
  });

  it("keeps one card per week: the sends of a week are combined, nothing dropped", () => {
    const week = hours(0).weekStart;
    const monday = { date: "2026-10-05", in: "2026-10-05T15:00:00.000Z", out: "2026-10-05T23:30:00.000Z", minutes: 510 };
    const tuesday = { date: "2026-10-06", in: "2026-10-06T15:00:00.000Z", out: "2026-10-06T19:00:00.000Z", minutes: 240 };
    const wednesday = { date: "2026-10-07", in: "2026-10-07T15:00:00.000Z", out: "2026-10-07T23:00:00.000Z", minutes: 480 };
    // 35 hours sent on Tuesday; called in on Wednesday, the week sent again whole.
    const first = addHours(emptyMailbox(), hours(0, { entries: [monday, tuesday], totalMinutes: 750, sentAt: "2026-10-06T20:00:00.000Z" }));
    const whole = addHours(markHoursRead(first, AGREEMENT, 0), hours(1, { weekStart: week, entries: [monday, tuesday, wednesday], totalMinutes: 1230, sentAt: "2026-10-08T00:00:00.000Z" }));
    expect(whole.hours).toHaveLength(1);
    expect(whole.hours[0]).toMatchObject({ seq: 1, weekStart: week, entries: [monday, tuesday, wednesday], totalMinutes: 1230, sends: 2, sentAt: "2026-10-08T00:00:00.000Z" });
    expect(whole.hours[0]).not.toHaveProperty("read"); // new hours: unread again
    expect(nextHoursSeq(whole, AGREEMENT)).toBe(2);
    // Or only the new day sent: the card still holds the week.
    const part = addHours(first, hours(1, { weekStart: week, entries: [wednesday], totalMinutes: 480, sentAt: "2026-10-08T00:00:00.000Z" }));
    expect(part.hours[0]).toMatchObject({ entries: [monday, tuesday, wednesday], totalMinutes: 1230, sends: 2 });
    // A clock-out moved: the newer word on that stretch counts, once.
    const moved = { ...tuesday, out: "2026-10-06T20:00:00.000Z", minutes: 300 };
    const corrected = addHours(first, hours(1, { weekStart: week, entries: [moved], totalMinutes: 300 }));
    expect(corrected.hours[0]).toMatchObject({ entries: [monday, moved], totalMinutes: 810, sends: 2 });
    // A third send combines again, counting on.
    const third = addHours(part, hours(2, { weekStart: week, entries: [{ ...wednesday, date: "2026-10-08", in: "2026-10-08T15:00:00.000Z", out: "2026-10-08T19:00:00.000Z", minutes: 240 }], totalMinutes: 240 }));
    expect(third.hours[0]).toMatchObject({ seq: 2, totalMinutes: 1470, sends: 3 });
    expect(third.hours[0]!.entries.map((e) => e.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
    // Another week, or another agreement, is its own card.
    expect(addHours(whole, hours(2)).hours).toHaveLength(2);
    expect(addHours(whole, hours(0, { agreementId: "ef".repeat(32) })).hours).toHaveLength(2);
    // An earlier slot turning up after a later one is folded in as the older word.
    const late = addHours(addHours(emptyMailbox(), hours(1, { weekStart: week, entries: [wednesday], totalMinutes: 480 })), hours(0, { entries: [monday], totalMinutes: 510 }));
    expect(late.hours[0]).toMatchObject({ seq: 1, entries: [monday, wednesday], totalMinutes: 990, sends: 2 });
    // A vault saved with the sends apart loads as one card.
    const loaded = mailboxFromJson(mailboxToJson({ ...first, hours: [...first.hours, hours(1, { weekStart: week, entries: [wednesday], totalMinutes: 480 })] }));
    expect(loaded.hours).toHaveLength(1);
    expect(loaded.hours[0]).toMatchObject({ totalMinutes: 1230, sends: 2 });
    expect(() => validateMailbox({ ...first, hours: [{ ...first.hours[0], sends: 1 }] })).toThrow(/at least 2/);
  });

  it("skips a slot that couldn't be kept without adding anything", () => {
    const m = bumpHoursSeq(emptyMailbox(), AGREEMENT, 2);
    expect(m.hours).toEqual([]);
    expect(nextHoursSeq(m, AGREEMENT)).toBe(3);
  });

  it("counts unread weeks and marks them read once", () => {
    let m = addHours(addHours(emptyMailbox(), hours(0)), hours(1));
    expect(unreadCount(m)).toBe(2);
    m = markHoursRead(m, AGREEMENT, 0);
    expect(unreadCount(m)).toBe(1);
    expect(markHoursRead(m, AGREEMENT, 0)).toBe(m);
    expect(markHoursRead(m, AGREEMENT, 99)).toBe(m);
    expect(unreadCount(null)).toBe(0);
  });

  it("round-trips through JSON and refuses what's malformed", () => {
    const m = markHoursRead(addHours(emptyMailbox(), hours(0)), AGREEMENT, 0);
    expect(mailboxFromJson(mailboxToJson(m))).toEqual(m);
    expect(() => validateMailbox({ version: 2, hours: [] })).toThrow(/version/);
    expect(() => validateMailbox({ version: 1, hours: "x" })).toThrow(/list/);
    expect(() => validateMailbox({ version: 1, hours: [hours(0, { lookup: "nope" })] })).toThrow(/64 hex/);
    expect(() => validateMailbox({ version: 1, hours: [hours(0, { totalMinutes: 1 })] })).toThrow(/don't add up/);
    expect(() => validateMailbox({ version: 1, hours: [], nextHours: { a: -1 } })).toThrow(/whole number/);
    expect(() => addHours(emptyMailbox(), hours(0, { workerId: "" }))).toThrow(/team member/);
  });
});

describe("threads in the mailbox", () => {
  const KEY = "ab".repeat(32);
  const counter = {
    version: 1 as const,
    id: "1".repeat(32),
    from: "worker" as const,
    sentAt: "2026-10-16T18:00:00.000Z",
    body: { type: "stands" as const, agreementId: "aa".repeat(32), note: "" },
  };

  it("are kept per person by parties key, survive a save, and refuse a bad one", async () => {
    const { updateThread, threadFor, mailboxFromJson, mailboxToJson, emptyMailbox } = await import("./mailbox");
    const { addToThread } = await import("./thread");
    const item = { ...counter, from: "business" as const, mine: true, seq: 0 };
    const m = updateThread(emptyMailbox(), KEY, "wkr-1", (t) => addToThread(t, item));
    expect(threadFor(m, KEY)).toMatchObject({ workerId: "wkr-1", nextOut: 1, nextIn: 0 });
    expect(mailboxFromJson(mailboxToJson(m))).toEqual(m);
    expect(() => mailboxFromJson(JSON.stringify({ ...m, threads: { nope: threadFor(m, KEY) } }))).toThrow(/parties key/);
    expect(() => mailboxFromJson(JSON.stringify({ ...m, threads: { [KEY]: { ...threadFor(m, KEY), workerId: "" } } }))).toThrow(/team member/);
    // A message only a business may send can't sit in the vault as the worker's.
    expect(() => mailboxFromJson(JSON.stringify({ ...m, threads: { [KEY]: { ...threadFor(m, KEY), items: [{ ...item, from: "worker" }] } } }))).toThrow();
  });
});
