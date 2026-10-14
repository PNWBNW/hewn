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

const hours = (seq: number, over: Partial<ReceivedHours> = {}): ReceivedHours => ({
  agreementId: AGREEMENT,
  seq,
  lookup: LOOKUP,
  receivedAt: "2026-10-12T09:00:00.000Z",
  workerId: "wkr-1",
  weekStart: PAYLOAD.weekStart,
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

  it("is refused without the time it was sent", () => {
    expect(() => validateTimesheetPayload({ ...PAYLOAD, sentAt: undefined }, AGREEMENT)).toThrow(/sent/);
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
    expect(nextHoursSeq(bumpHoursSeq(m, AGREEMENT, 1), AGREEMENT)).toBe(4);
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
