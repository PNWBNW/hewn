// The team calendar (books/team_schedule.ts): a week published once to everyone, each person
// finding their own row by a one-way tag and confirming their own days.

import { describe, expect, it } from "vitest";
import type { ScheduleDay } from "./schedule";
import { type TeamPart, type TeamPost, calendarEntries, confirmedOnCallDates, latestTeamWeek, personWeek, teamWeeks, validateTeamPart, whoOf } from "./team_schedule";
import { businessCalendar } from "./team_sources";
import { type Thread, addToThread, emptyThread, validateMessage } from "./thread";

const SUN = "2026-10-25";
const KEY_ANA = "ab".repeat(32);
const KEY_BO = "cd".repeat(32);
const ANA = whoOf(KEY_ANA);
const BO = whoOf(KEY_BO);
const id = (n: number) => n.toString(16).padStart(32, "0");
const DAY_SHIFT: ScheduleDay = { date: "2026-10-26", shifts: [{ start: "07:00", end: "15:30" }], onCall: false };
const ON_CALL: ScheduleDay = { date: "2026-10-27", shifts: [], onCall: true };

const part = (publishId: string, people: TeamPart["people"], n = 0, parts = 1): TeamPart => ({ weekStart: SUN, publishId, part: n, parts, people });
const post = (sentAt: string, schedule: TeamPart): TeamPost => ({ sentAt, schedule });

function answer(t: Thread, n: number, scheduleId: string, a: "confirmed" | "change"): Thread {
  const body = { type: "schedule_answer", scheduleId, weekStart: SUN, answer: a, note: a === "change" ? "Can't do Monday." : "" };
  return addToThread(t, { ...validateMessage({ version: 1, id: id(n), from: "worker", sentAt: `2026-10-2${n}T10:00:00.000Z`, body }, "worker"), mine: true, seq: n });
}

describe("a person's tag", () => {
  it("is fixed for a key, differs between people, and is 16 hex", () => {
    expect(ANA).toMatch(/^[0-9a-f]{16}$/);
    expect(whoOf(KEY_ANA)).toBe(ANA);
    expect(BO).not.toBe(ANA);
  });
});

describe("a team part", () => {
  it("checks its shape", () => {
    const ok = part(id(1), [{ who: ANA, name: " Ana ", days: [DAY_SHIFT] }]);
    expect(validateTeamPart(ok).people[0]!.name).toBe("Ana");
    expect(() => validateTeamPart({ ...ok, publishId: "x" })).toThrow(/publish id/);
    expect(() => validateTeamPart({ ...ok, part: 1 })).toThrow(/out of range/);
    expect(() => validateTeamPart({ ...ok, parts: 33 })).toThrow(/how many parts/);
    expect(() => validateTeamPart({ ...ok, people: [{ who: "nope", name: "Ana", days: [] }] })).toThrow(/tag/);
    expect(() => validateTeamPart({ ...ok, people: [{ who: ANA, name: "", days: [] }] })).toThrow(/name/);
    expect(() => validateTeamPart({ ...ok, people: [ok.people[0], ok.people[0]] })).toThrow(/twice/);
    expect(() => validateTeamPart({ ...ok, people: [{ who: ANA, name: "Ana", days: [{ ...DAY_SHIFT, date: "2026-11-02" }] }] })).toThrow(/in its week/);
  });
});

describe("team weeks", () => {
  it("joins a publish's parts in order and waits for all of them", () => {
    const a = post("2026-10-20T10:00:00.000Z", part(id(1), [{ who: ANA, name: "Ana", days: [DAY_SHIFT] }], 0, 2));
    const b = post("2026-10-20T10:01:00.000Z", part(id(1), [{ who: BO, name: "Bo", days: [ON_CALL] }], 1, 2));
    expect(teamWeeks([a])).toEqual([]);
    const [w] = teamWeeks([b, a, { sentAt: "2026-10-20T09:00:00.000Z" }]);
    expect(w).toMatchObject({ weekStart: SUN, publishId: id(1), sentAt: "2026-10-20T10:01:00.000Z" });
    expect(w!.people.map((p) => p.name)).toEqual(["Ana", "Bo"]);
  });

  it("ignores a part that doesn't match its publish, and the latest publish of a week wins", () => {
    const first = post("2026-10-20T10:00:00.000Z", part(id(1), [{ who: ANA, name: "Ana", days: [DAY_SHIFT] }]));
    const stray = post("2026-10-20T10:00:30.000Z", part(id(1), [{ who: BO, name: "Bo", days: [] }], 1, 2));
    const second = post("2026-10-21T10:00:00.000Z", part(id(2), [{ who: BO, name: "Bo", days: [ON_CALL] }]));
    expect(teamWeeks([first, stray]).map((w) => w.publishId)).toEqual([id(1)]);
    expect(latestTeamWeek([second, first], SUN)!.publishId).toBe(id(2));
    expect(latestTeamWeek([first], "2026-11-01")).toBeUndefined();
  });
});

describe("one person's week from the team calendar", () => {
  const p1 = post("2026-10-20T10:00:00.000Z", part(id(1), [{ who: ANA, name: "Ana", days: [DAY_SHIFT] }, { who: BO, name: "Bo", days: [ON_CALL] }]));

  it("is their row, waiting until they answer", () => {
    expect(personWeek({ team: [p1], who: ANA }, SUN)).toMatchObject({ id: id(1), week: { weekStart: SUN, days: [DAY_SHIFT] } });
    expect(personWeek({ team: [p1], who: ANA }, SUN)!.answer).toBeUndefined();
    expect(personWeek({ team: [p1] }, SUN)).toBeUndefined(); // without their tag, nothing is theirs
  });

  it("keeps their confirmation through a republish that leaves their days alone", () => {
    const thread = answer(emptyThread(), 1, id(1), "confirmed");
    // Bo's days change; Ana's don't.
    const p2 = post("2026-10-21T10:00:00.000Z", part(id(2), [{ who: ANA, name: "Ana", days: [DAY_SHIFT] }, { who: BO, name: "Bo", days: [ON_CALL, { ...ON_CALL, date: "2026-10-28" }] }]));
    expect(personWeek({ thread, team: [p1, p2], who: ANA }, SUN)).toMatchObject({ id: id(2), answer: { answer: "confirmed" } });
    expect(confirmedOnCallDates({ thread, team: [p1, p2], who: ANA }, SUN, "2026-10-31")).toEqual([]);
  });

  it("clears it when their days change, and a later publish without them leaves them nothing", () => {
    const thread = answer(emptyThread(), 1, id(1), "confirmed");
    const changed = post("2026-10-21T10:00:00.000Z", part(id(2), [{ who: ANA, name: "Ana", days: [DAY_SHIFT, ON_CALL] }]));
    expect(personWeek({ thread, team: [p1, changed], who: ANA }, SUN)!.answer).toBeUndefined();
    const without = post("2026-10-22T10:00:00.000Z", part(id(3), [{ who: BO, name: "Bo", days: [ON_CALL] }]));
    expect(personWeek({ thread, team: [p1, without], who: ANA }, SUN)!.week.days).toEqual([]);
  });

  it("pays on call only on days of a week they confirmed", () => {
    const team = [p1];
    expect(confirmedOnCallDates({ team, who: BO }, SUN, "2026-10-31")).toEqual([]);
    const thread = answer(emptyThread(), 1, id(1), "confirmed");
    expect(confirmedOnCallDates({ thread, team, who: BO }, SUN, "2026-10-31")).toEqual(["2026-10-27"]);
    expect(confirmedOnCallDates({ thread: answer(thread, 2, id(1), "change"), team, who: BO }, SUN, "2026-10-31")).toEqual([]);
  });
});

describe("the calendar's entries", () => {
  it("lists each shift and on-call day once, drafts marked", () => {
    const entries = calendarEntries([
      { people: [{ key: ANA, name: "Ana", days: [{ ...DAY_SHIFT, onCall: true }] }] },
      { people: [{ key: BO, name: "Bo", days: [ON_CALL], draft: true }] },
    ]);
    expect(entries).toEqual([
      { key: ANA, name: "Ana", date: "2026-10-26", kind: "onCall" },
      { key: ANA, name: "Ana", date: "2026-10-26", kind: "shift", start: "07:00", end: "15:30" },
      { key: BO, name: "Bo", date: "2026-10-27", kind: "onCall", draft: true },
    ]);
  });
});

describe("the business's calendar", () => {
  it("shows a draft in place of what was published, under the same person", () => {
    const schedule = { version: 1 as const, drafts: { w1: { [SUN]: { weekStart: SUN, days: [ON_CALL] } } } };
    const weeks = businessCalendar(null, schedule, [
      { workerId: "w1", name: "Ana", partiesKey: KEY_ANA },
      { workerId: "w2", name: "Cy" },
    ]);
    expect(weeks).toEqual([{ weekStart: SUN, people: [{ key: ANA, name: "Ana", days: [ON_CALL], draft: true }] }]);
  });
});
