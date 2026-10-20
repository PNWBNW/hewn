// ---------------------------------------------------------------------------
// Where each side reads one person's schedule from (books/team_schedule.ts):
// the business, from its conversation with them and its "Team schedule"
// channel; the person, from their conversation with the business and the
// channels that business added them to. Pure.
// ---------------------------------------------------------------------------

import { type Mailbox, channelFor, threadFor } from "./mailbox";
import type { Schedule, ScheduleDay } from "./schedule";
import { type ScheduleSources, type TeamPost, personWeek, teamWeeks, whoOf } from "./team_schedule";
import type { Thread } from "./thread";
import { type Work, type WorkAgreement, workThread } from "./work";

/** One person's row on the calendar for one week. */
export type CalendarPerson = { key: string; name: string; days: ScheduleDay[]; draft?: boolean };
export type CalendarWeek = { weekStart: string; people: CalendarPerson[] };

/** Someone whose own conversation can add to the calendar (weeks published to them alone, before the team calendar). */
type Own = { key: string; name?: string; sources: ScheduleSources; thread: Thread | undefined };

/** The latest team publish of every week, then each person's own latest from either source on top. */
function calendarWeeks(posts: readonly TeamPost[], own: readonly Own[]): Map<string, Map<string, CalendarPerson>> {
  const weeks = new Map<string, Map<string, CalendarPerson>>();
  const weekOf = (ws: string) => weeks.get(ws) ?? weeks.set(ws, new Map()).get(ws)!;
  for (const w of teamWeeks(posts)) weeks.set(w.weekStart, new Map(w.people.map((p) => [p.who, { key: p.who, name: p.name, days: p.days }])));
  for (const o of own) {
    const starts = new Set([...weeks.keys(), ...(o.thread?.items ?? []).flatMap((i) => (i.body.type === "schedule" ? [i.body.week.weekStart] : []))]);
    for (const ws of starts) {
      const p = personWeek(o.sources, ws);
      if (!p) continue;
      const week = weekOf(ws);
      if (p.week.days.length > 0) week.set(o.key, { key: o.key, name: o.name ?? week.get(o.key)?.name ?? "You", days: p.week.days });
      else week.delete(o.key);
    }
  }
  return weeks;
}

const toList = (weeks: Map<string, Map<string, CalendarPerson>>): CalendarWeek[] =>
  [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([weekStart, people]) => ({ weekStart, people: [...people.values()] }));

/** Someone on the team, as the business's calendar needs them. */
export type CalendarMember = { workerId: string; name: string; partiesKey?: string | undefined };

/**
 * The business's calendar: what it published, and its drafts on top (marked, and in place of what
 * was published for that person that week). Each person is keyed by their tag when they have one,
 * so their published days and their drafts share a colour.
 */
export function businessCalendar(mailbox: Mailbox | null | undefined, schedule: Schedule | null | undefined, members: readonly CalendarMember[]): CalendarWeek[] {
  const keyOf = new Map(members.map((m) => [m.workerId, m.partiesKey ? whoOf(m.partiesKey) : m.workerId]));
  const own = members.flatMap((m): Own[] =>
    m.partiesKey ? [{ key: keyOf.get(m.workerId)!, name: m.name, sources: businessSources(mailbox, schedule, m.partiesKey), thread: threadFor(mailbox, m.partiesKey) }] : [],
  );
  const weeks = calendarWeeks(businessTeamPosts(mailbox, schedule), own);
  for (const m of members) {
    for (const [ws, draft] of Object.entries(schedule?.drafts[m.workerId] ?? {})) {
      const week = weeks.get(ws) ?? weeks.set(ws, new Map()).get(ws)!;
      const key = keyOf.get(m.workerId)!;
      week.set(key, { key, name: m.name, days: draft.days, draft: true });
    }
  }
  return toList(weeks);
}

/** A person's calendar for one business: what it published to the team, their own weeks on top (named as the business names them). */
export function workCalendar(work: Work, agreement: Pick<WorkAgreement, "partiesKey">): CalendarWeek[] {
  const sources = workSources(work, agreement);
  return toList(calendarWeeks(workTeamPosts(work, agreement), [{ key: sources.who!, sources, thread: sources.thread }]));
}

/** The business's team posts: its "Team schedule" channel's. */
export const businessTeamPosts = (mailbox: Mailbox | null | undefined, schedule: Schedule | null | undefined): TeamPost[] =>
  schedule?.channelId ? (channelFor(mailbox, schedule.channelId)?.posts ?? []) : [];

/** The business's view of one person: their conversation, the team posts, their tag. */
export function businessSources(mailbox: Mailbox | null | undefined, schedule: Schedule | null | undefined, partiesKey: string | undefined): ScheduleSources {
  if (!partiesKey) return {};
  return { thread: threadFor(mailbox, partiesKey), team: businessTeamPosts(mailbox, schedule), who: whoOf(partiesKey) };
}

/** The team posts from one business, as the person received them (every channel that business added them to). */
export const workTeamPosts = (work: Work, agreement: Pick<WorkAgreement, "partiesKey">): TeamPost[] =>
  (work.channels ?? []).filter((c) => c.partiesKey === agreement.partiesKey).flatMap((c) => c.posts);

/** The person's view of their own schedule with one business. */
export const workSources = (work: Work, agreement: Pick<WorkAgreement, "partiesKey">): ScheduleSources => ({
  thread: workThread(work, agreement.partiesKey),
  team: workTeamPosts(work, agreement),
  who: whoOf(agreement.partiesKey),
});
