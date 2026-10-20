// ---------------------------------------------------------------------------
// The team calendar (Joshua, 2026-10-20): everyone at a business sees the same
// schedule, everyone's shifts and on-call days. The business publishes a week
// once, as one or more posts in its "Team schedule" announcement channel
// (books/channels.ts), so it costs a Shield approval per eight people per post
// rather than one per person. A post carries part of the week (a big team
// takes several, all with one `publishId`); a week shows once all its parts
// are in.
//
// Each person on it is named as the business names them, and tagged with
// `whoOf(partiesKey)`: a one-way value from the secret the two of them share,
// so each person finds their own row and nobody can work back to the key.
//
// Each person still confirms their own part, with a `schedule_answer` in
// their own conversation naming the publish. A republish that leaves their
// days as they were keeps their confirmation. Weeks published to one person
// before the team calendar existed (a `schedule` message in their thread)
// still count.
// ---------------------------------------------------------------------------

import { lookupId, partiesKeyFromHex } from "@pnw/mailbox";
import { type PublishedWeek, type ScheduleDay, type ScheduleWeek, ScheduleError, addDays, sameWeek, scheduleWeekOf, validateScheduleWeek } from "./schedule";
import type { Thread, ThreadItem } from "./thread";

export type TeamPerson = { who: string; name: string; days: ScheduleDay[] };

/** One post's share of a published week. */
export type TeamPart = { weekStart: string; publishId: string; part: number; parts: number; people: TeamPerson[] };

/** A published week, all its parts together. */
export type TeamWeek = { weekStart: string; publishId: string; sentAt: string; people: TeamPerson[] };

/** A post as either side keeps it, for what the calendar needs. */
export type TeamPost = { sentAt: string; schedule?: TeamPart };

/** Someone going on a publish, as the business knows them: who, their name, the key they share, their days. */
export type TeamEntry = { workerId: string; name: string; partiesKey: string; days: ScheduleDay[] };

export const MAX_TEAM_PARTS = 32;
const WHO = /^[0-9a-f]{16}$/;
const ID = /^[0-9a-f]{32}$/;

/** A person's tag on the team calendar: one-way from the secret they share with the business. */
export function whoOf(partiesKey: string): string {
  const key = partiesKeyFromHex(partiesKey);
  try {
    return lookupId(key, "team_schedule_who", 0).slice(0, 16);
  } finally {
    key.fill(0);
  }
}

export function validateTeamPart(raw: unknown): TeamPart {
  const t = raw as Partial<TeamPart> | null;
  if (!t || typeof t !== "object") throw new ScheduleError("A team schedule must be an object");
  if (typeof t.publishId !== "string" || !ID.test(t.publishId)) throw new ScheduleError("A team schedule needs its publish id");
  if (!Number.isInteger(t.parts) || t.parts! < 1 || t.parts! > MAX_TEAM_PARTS) throw new ScheduleError("A team schedule says how many parts it has");
  if (!Number.isInteger(t.part) || t.part! < 0 || t.part! >= t.parts!) throw new ScheduleError("A team schedule's part is out of range");
  if (!Array.isArray(t.people) || t.people.length > 200) throw new ScheduleError("A team schedule's people must be a list");
  const people = t.people.map((p) => {
    const x = p as Partial<TeamPerson> | null;
    if (!x || typeof x !== "object" || typeof x.who !== "string" || !WHO.test(x.who)) throw new ScheduleError("Each person on the schedule needs their tag");
    if (typeof x.name !== "string" || !x.name.trim() || [...x.name].length > 80) throw new ScheduleError("Each person on the schedule needs a name");
    const week = validateScheduleWeek({ weekStart: t.weekStart, days: x.days });
    return { who: x.who, name: x.name.trim(), days: week.days };
  });
  if (new Set(people.map((p) => p.who)).size !== people.length) throw new ScheduleError("Someone is on the schedule twice");
  return { weekStart: t.weekStart as string, publishId: t.publishId, part: t.part!, parts: t.parts!, people };
}

/** Every complete published week in these posts, oldest first. */
export function teamWeeks(posts: readonly TeamPost[]): TeamWeek[] {
  const byPublish = new Map<string, { weekStart: string; sentAt: string; parts: number; got: Map<number, TeamPerson[]> }>();
  for (const p of posts) {
    const s = p.schedule;
    if (!s) continue;
    const entry = byPublish.get(s.publishId) ?? { weekStart: s.weekStart, sentAt: p.sentAt, parts: s.parts, got: new Map() };
    if (entry.weekStart !== s.weekStart || entry.parts !== s.parts) continue; // a part that doesn't match its publish is ignored
    entry.got.set(s.part, s.people);
    if (p.sentAt > entry.sentAt) entry.sentAt = p.sentAt;
    byPublish.set(s.publishId, entry);
  }
  const weeks: TeamWeek[] = [];
  for (const [publishId, e] of byPublish) {
    if (e.got.size !== e.parts) continue; // still waiting for a part
    const people = [...e.got.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, ps]) => ps);
    weeks.push({ weekStart: e.weekStart, publishId, sentAt: e.sentAt, people });
  }
  return weeks.sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : a.publishId < b.publishId ? -1 : 1));
}

/** The latest complete publish of a week. */
export const latestTeamWeek = (posts: readonly TeamPost[], weekStart: string): TeamWeek | undefined => teamWeeks(posts).filter((w) => w.weekStart === weekStart).at(-1);

/** Where one person's schedule is read from: their conversation with the business, and the team posts, with their tag. */
export type ScheduleSources = { thread?: Thread | undefined; team?: readonly TeamPost[]; who?: string | undefined };

type AnswerItem = ThreadItem & { body: { type: "schedule_answer"; scheduleId: string; weekStart: string; answer: "confirmed" | "change"; note: string } };
type Candidate = { id: string; week: ScheduleWeek; note: string; sentAt: string; mine: boolean };

/**
 * One person's latest published week, from either source, and their answer: the latest answer they
 * gave for the week, when it was to a publish with the same days as now (a republish that changed
 * other people only keeps it).
 */
export function personWeek(src: ScheduleSources, weekStart: string): PublishedWeek | undefined {
  const candidates: Candidate[] = [];
  for (const i of src.thread?.items ?? []) {
    if (i.body.type === "schedule" && i.body.week.weekStart === weekStart) candidates.push({ id: i.id, week: i.body.week, note: i.body.note, sentAt: i.sentAt, mine: i.mine });
  }
  if (src.who && src.team) {
    for (const w of teamWeeks(src.team)) {
      if (w.weekStart !== weekStart) continue;
      const me = w.people.find((p) => p.who === src.who);
      // Left off a later publish: they have nothing that week.
      candidates.push({ id: w.publishId, week: { weekStart, days: me?.days ?? [] }, note: "", sentAt: w.sentAt, mine: true });
    }
  }
  candidates.sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : 0));
  const current = candidates.at(-1);
  if (!current) return undefined;
  const answers = (src.thread?.items ?? [])
    .filter((i): i is AnswerItem => i.body.type === "schedule_answer" && i.body.weekStart === weekStart)
    .sort((a, b) => (a.sentAt < b.sentAt ? -1 : a.sentAt > b.sentAt ? 1 : a.seq - b.seq));
  const last = answers.at(-1);
  const answeredWeek = last ? candidates.find((c) => c.id === last.body.scheduleId)?.week : undefined;
  const stands = !!last && !!answeredWeek && sameWeek(answeredWeek, current.week);
  return {
    id: current.id,
    week: current.week,
    note: current.note,
    sentAt: current.sentAt,
    mine: current.mine,
    ...(stands ? { answer: { answer: last!.body.answer, note: last!.body.note, at: last!.sentAt, mine: last!.mine } } : {}),
  };
}

/**
 * The days in [start, end] (inclusive) a person is on call in a week they confirmed: what on-call
 * pay is for. A week published but not confirmed, or republished with their days changed and not
 * yet confirmed again, pays nothing until it is.
 */
export function confirmedOnCallDates(src: ScheduleSources | Thread | undefined, start: string, end: string): string[] {
  const sources: ScheduleSources = src && "items" in src ? { thread: src } : (src ?? {});
  const dates: string[] = [];
  for (let week = scheduleWeekOf(start); week <= end; week = addDays(week, 7)) {
    const p = personWeek(sources, week);
    if (p?.answer?.answer !== "confirmed") continue;
    for (const d of p.week.days) if (d.onCall && start <= d.date && d.date <= end) dates.push(d.date);
  }
  return dates;
}

/** The confirmed on-call days in the period no pay run has paid yet. */
export function unpaidOnCallDates(
  src: ScheduleSources | Thread | undefined,
  paid: Record<string, Record<string, string>> | undefined,
  workerId: string,
  start: string,
  end: string,
): string[] {
  const mine = paid?.[workerId] ?? {};
  return confirmedOnCallDates(src, start, end).filter((d) => !mine[d]);
}

// ---- The calendar's view: everyone, day by day ------------------------------------------------

export type CalendarEntry = {
  /** Who: their tag on the team calendar, or the business's id for them (drafts, the business's side). */
  key: string;
  name: string;
  date: string;
  kind: "shift" | "onCall";
  start?: string;
  end?: string;
  /** Not published yet (the business's drafts). */
  draft?: true;
};

/** Every shift and on-call day in a set of weeks, one entry each. */
export function calendarEntries(weeks: readonly { people: readonly { key: string; name: string; days: readonly ScheduleDay[]; draft?: boolean }[] }[]): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const w of weeks) {
    for (const p of w.people) {
      for (const d of p.days) {
        const draft = p.draft ? { draft: true as const } : {};
        if (d.onCall) out.push({ key: p.key, name: p.name, date: d.date, kind: "onCall", ...draft });
        for (const b of d.shifts) out.push({ key: p.key, name: p.name, date: d.date, kind: "shift", start: b.start, end: b.end, ...draft });
      }
    }
  }
  return out;
}
