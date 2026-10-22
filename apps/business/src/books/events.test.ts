import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type EventDraft, type PersonalEvent, cleanLink, deleteEvent, draftOf, emptyDraft, eventFromDraft, onDay, saveEvent, validateEvent, validateEvents } from "./events";
import { TeamCalendar } from "./TeamCalendar";

const NOW = new Date("2026-10-22T15:00:00.000Z");
const ID = "ab".repeat(16);
const base = { id: ID, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };

const timed = (over: Partial<PersonalEvent> = {}): PersonalEvent => validateEvent({ ...base, title: "Site meeting", date: "2026-10-22", allDay: false, start: "09:00", end: "10:00", ...over });

describe("a personal event", () => {
  it("is timed or all day, with what it needs and nothing it doesn't", () => {
    expect(timed()).toEqual({ ...base, title: "Site meeting", date: "2026-10-22", allDay: false, start: "09:00", end: "10:00" });
    const away = validateEvent({ ...base, title: " Away ", date: "2026-10-26", allDay: true, endDate: "2026-10-30", start: "09:00" });
    expect(away).toEqual({ ...base, title: "Away", date: "2026-10-26", allDay: true, endDate: "2026-10-30" });
    expect(validateEvent({ ...base, title: "Day off", date: "2026-10-26", allDay: true }).endDate).toBe("2026-10-26");
  });

  it("keeps where, an https link and notes, and drops empty ones", () => {
    const e = timed({ place: " 1420 Elm St ", link: "zoom.us/j/123", notes: "  " });
    expect(e.place).toBe("1420 Elm St");
    expect(e.link).toBe("https://zoom.us/j/123");
    expect(e).not.toHaveProperty("notes");
  });

  it("refuses what an app couldn't have saved", () => {
    expect(() => timed({ title: "  " })).toThrow("title");
    expect(() => timed({ date: "2026-02-30" })).toThrow("day it starts");
    expect(() => timed({ start: "25:00" })).toThrow("starts");
    expect(() => timed({ start: "09:00", end: "09:00" })).toThrow("end after it starts");
    expect(() => validateEvent({ ...base, title: "x", date: "2026-10-26", allDay: true, endDate: "2026-10-25" })).toThrow("before the first");
    expect(() => validateEvent({ ...base, title: "x", date: "2026-01-01", allDay: true, endDate: "2027-01-02" })).toThrow("at most a year");
    expect(() => timed({ title: "x".repeat(121) })).toThrow("at most 120");
    expect(() => timed({ id: "nope" })).toThrow("id");
  });

  it("only takes https links", () => {
    expect(cleanLink("https://meet.google.com/abc")).toBe("https://meet.google.com/abc");
    for (const bad of ["javascript:alert(1)", "http://zoom.us/j/1", "file:///etc/passwd", "data:text/html,hi", "not a link", "https://localhost"]) {
      expect(() => cleanLink(bad), bad).toThrow();
    }
  });

  it("runs past midnight when it ends before it starts, and shows on the days it touches", () => {
    const late = timed({ start: "22:00", end: "02:00" });
    expect(onDay(late, "2026-10-22")).toBe(true);
    expect(onDay(late, "2026-10-23")).toBe(true);
    expect(onDay(late, "2026-10-24")).toBe(false);
    expect(onDay(timed(), "2026-10-23")).toBe(false);
    const away = validateEvent({ ...base, title: "Away", date: "2026-10-26", allDay: true, endDate: "2026-10-28" });
    expect(["2026-10-25", "2026-10-26", "2026-10-28", "2026-10-29"].map((d) => onDay(away, d))).toEqual([false, true, true, false]);
  });
});

describe("the list of events", () => {
  it("saves new ones in order, replaces by id, and deletes", () => {
    const a = timed();
    const b = timed({ id: "cd".repeat(16), title: "Earlier", start: "07:00", end: "08:00" });
    let list = saveEvent([], a);
    list = saveEvent(list, b);
    expect(list.map((e) => e.title)).toEqual(["Earlier", "Site meeting"]);
    list = saveEvent(list, { ...a, title: "Moved" });
    expect(list.map((e) => e.title)).toEqual(["Earlier", "Moved"]);
    expect(deleteEvent(list, a.id).map((e) => e.id)).toEqual([b.id]);
  });

  it("reads back from the vault, keeping one per id", () => {
    const a = timed();
    expect(validateEvents(JSON.parse(JSON.stringify([a, { ...a, title: "Again" }])))).toEqual([{ ...a, title: "Again" }]);
    expect(() => validateEvents({})).toThrow("list");
  });
});

describe("the form", () => {
  it("makes a new event, edits one in place, and says what's wrong", () => {
    const d: EventDraft = { ...emptyDraft("2026-10-22"), title: "Walkthrough", place: "Elm St" };
    const made = eventFromDraft(d, undefined, NOW);
    if (!("event" in made)) throw new Error(made.problem);
    expect(made.event).toMatchObject({ title: "Walkthrough", date: "2026-10-22", allDay: false, start: "09:00", end: "10:00", place: "Elm St" });
    const later = new Date("2026-10-23T00:00:00.000Z");
    const edited = eventFromDraft({ ...draftOf(made.event), allDay: true, endDate: "2026-10-23" }, made.event, later);
    if (!("event" in edited)) throw new Error(edited.problem);
    expect(edited.event).toMatchObject({ id: made.event.id, allDay: true, endDate: "2026-10-23", createdAt: NOW.toISOString(), updatedAt: later.toISOString() });
    expect(edited.event).not.toHaveProperty("start");
    expect(eventFromDraft({ ...d, title: "" }, undefined, NOW)).toEqual({ problem: "Give the event a title" });
    expect(eventFromDraft({ ...d, link: "javascript:alert(1)" }, undefined, NOW)).toEqual({ problem: "A link must be an https:// web address" });
  });
});

describe("on the calendar", () => {
  it("draws personal events beside shifts in the month", () => {
    const html = renderToStaticMarkup(
      createElement(TeamCalendar, {
        entries: [{ key: "k", name: "Ana Ruiz", date: "2026-10-22", kind: "shift", start: "08:00", end: "16:00" }],
        today: "2026-10-22",
        events: [
          { ...timed(), kind: "personal" },
          { ...validateEvent({ ...base, id: "cd".repeat(16), title: "Away", date: "2026-10-26", allDay: true, endDate: "2026-10-27" }), kind: "personal" },
          { id: "i:walk", kind: "invited", unanswered: true, title: "Walkthrough", date: "2026-10-23", allDay: false, start: "07:00", end: "08:00" },
          { id: "h:pour", kind: "hosting", cancelled: true, title: "Pour", date: "2026-10-24", allDay: false, start: "06:00", end: "07:00" },
        ],
      }),
    );
    expect(html).toContain("9a Site meeting");
    expect(html).toContain("Ana 8a");
    expect(html.match(/>Away</g)).toHaveLength(2);
    expect(html).toContain("Your personal events (only you see them)");
    expect(html).toContain("1 event");
    // Events with guests: their own colour, an unanswered invitation dashed, one called off struck through.
    expect(html).toContain("Events with guests (dashed: waiting for your answer)");
    expect(html).toMatch(/border-dashed[^"]*"[^>]*>7a Walkthrough</);
    expect(html).toMatch(/line-through[^"]*"[^>]*>6a Pour</);
  });
});
