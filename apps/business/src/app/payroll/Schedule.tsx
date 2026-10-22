"use client";

// Schedule, under Payroll (Joshua, 2026-10-20). Two views:
//   - Calendar: the month as everyone on the team sees it (books/TeamCalendar.tsx),
//     with this device's unpublished drafts shown dashed; tap a day for its hours.
//   - Edit week: a week at a time, one card per team member, each day with two
//     layers: shift blocks with their hours, and on call for the whole day.
// Edits are drafts in the vault; "Publish to the team" sends the week to
// everyone at once (chain/PublishTeamSchedule.tsx), and each person confirms
// their own days or asks for a change. Answers are read with the rest of the
// team's letters, when the tab opens and on "Check now". Events sit on the
// calendar too: personal ones (books/events.ts) only this business sees, and
// ones with guests from the team (books/shared_events.ts), sent from the
// event's pop-up; invitations from people on the team wait at the top for an
// answer (EventPanel.tsx, SharedEventViews.tsx).

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CalendarDays, ChevronLeft, ChevronRight, Copy, PencilLine, Plus, RefreshCw, X } from "lucide-react";
import type { Worker } from "@pnw/payroll";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { todayIso } from "@/books/display";
import { formatMinutes } from "@/books/hours";
import { mailboxLinks } from "@/books/mailbox_feed";
import { linkFor } from "@/books/rail";
import {
  STATUS_LABEL,
  type PublishedWeek,
  type ScheduleDay,
  type ScheduleWeek,
  type WeekStatus,
  addDays,
  blockLabel,
  dayOf,
  draftOf,
  emptySchedule,
  emptyWeek,
  onCallDays,
  scheduleDays,
  scheduleWeekOf,
  setDraft,
  shiftWeek,
  weekShiftMinutes,
  weekStatus,
  withDay,
} from "@/books/schedule";
import { EventPanel, type EventPanelState, panelFor } from "@/books/EventPanel";
import { teamGuests } from "@/books/event_contacts";
import { InvitationsWaiting, useCalendarEvents } from "@/books/SharedEventViews";
import { TeamCalendar } from "@/books/TeamCalendar";
import { type TeamEntry, calendarEntries, personWeek } from "@/books/team_schedule";
import { businessCalendar, businessSources } from "@/books/team_sources";
import { dayLabel } from "../work/shared";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const MailboxCheck = dynamic(() => import("@/chain/MailboxCheck"), { ssr: false });
const PublishTeamSchedule = dynamic(() => import("@/chain/PublishTeamSchedule"), { ssr: false, loading });

type Checking = { state: "idle" } | { state: "running"; run: number } | { state: "done"; message?: string };

/** One person's week as the business sees it: their draft, what was published, and where it stands. */
type Row = { worker: Worker; partiesKey: string | undefined; reachable: boolean; draft: ScheduleWeek | undefined; published: PublishedWeek | undefined; status: WeekStatus };

export function Schedule() {
  const { payroll, rail, mailbox, schedule, events } = useOpenBooks();
  const today = todayIso();
  const [eventPanel, setEventPanel] = useState<EventPanelState>(null);
  const calendarEvents = useCalendarEvents();
  const invitable = useMemo(() => ({ scope: "", guests: teamGuests(rail, payroll.workers) }), [rail, payroll]);
  const [view, setView] = useState<"calendar" | "week">("calendar");
  const [weekStart, setWeekStart] = useState(() => scheduleWeekOf(today));
  const [publishing, setPublishing] = useState(false);
  const canCheck = mailboxLinks(rail).length > 0;
  const [check, setCheck] = useState<Checking>(canCheck ? { state: "running", run: 0 } : { state: "idle" });
  const finished = useCallback((o: { message?: string }) => setCheck({ state: "done", ...(o.message ? { message: o.message } : {}) }), []);
  useEffect(() => {
    if (canCheck) setCheck((c) => (c.state === "idle" ? { state: "running", run: 0 } : c));
  }, [canCheck]);
  useEffect(() => setPublishing(false), [weekStart]);

  const team = useMemo(() => payroll.workers.filter((w) => w.active), [payroll.workers]);
  const members = useMemo(
    () =>
      team.map((w) => {
        const link = rail ? linkFor(rail, w.id) : undefined;
        return { worker: w, partiesKey: link?.status === "linked" ? link.partiesKey : undefined };
      }),
    [team, rail],
  );
  const entries = useMemo(
    () => calendarEntries(businessCalendar(mailbox, schedule, members.map((m) => ({ workerId: m.worker.id, name: m.worker.name, partiesKey: m.partiesKey })))),
    [mailbox, schedule, members],
  );
  const rows: Row[] = members.map(({ worker, partiesKey }) => {
    const published = partiesKey ? personWeek(businessSources(mailbox, schedule, partiesKey), weekStart) : undefined;
    const draft = draftOf(schedule, worker.id, weekStart);
    return { worker, partiesKey, reachable: !!partiesKey, draft, published, status: weekStatus(draft, published) };
  });
  // Everyone reachable with days this week goes on the publish: drafts as drafted, the rest as they were.
  const toPublish: TeamEntry[] = rows.flatMap((r) => {
    const days = (r.draft ?? r.published?.week)?.days ?? [];
    return r.reachable && days.length > 0 ? [{ workerId: r.worker.id, name: r.worker.name, partiesKey: r.partiesKey!, days }] : [];
  });
  const pending = rows.filter((r) => r.reachable && (r.status === "draft" || r.status === "changed")).length;
  const weekLabel = `${dayLabel(weekStart)} – ${dayLabel(addDays(weekStart, 6))}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Schedule view" className="inline-flex rounded-md border p-0.5">
          {(
            [
              ["calendar", "Calendar", CalendarDays],
              ["week", "Edit week", PencilLine],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn("flex min-h-11 items-center gap-1.5 rounded px-3 text-sm sm:min-h-8", view === v ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent")}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {check.state === "running" && <span className="text-xs text-muted-foreground">Checking for answers…</span>}
          {check.state === "done" && check.message && <span className="text-xs text-muted-foreground">{check.message}</span>}
          {canCheck && check.state === "done" && (
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setCheck({ state: "running", run: Date.now() })}>
              <RefreshCw aria-hidden />
              Check now
            </Button>
          )}
        </div>
      </div>
      {check.state === "running" && <MailboxCheck key={check.run} onFinished={finished} />}

      {view === "calendar" ? (
        <>
          <Button variant="outline" size="sm" className="min-h-11 self-start sm:min-h-8" onClick={() => setEventPanel({ kind: "new", date: today })}>
            <Plus aria-hidden />
            New event
          </Button>
          <InvitationsWaiting onOpen={(key) => setEventPanel({ kind: "invite", key })} />
          <TeamCalendar
            entries={entries}
            today={today}
            events={calendarEvents}
            onEvent={(event) => setEventPanel(panelFor(event, events))}
            dayFooter={(date) => (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setEventPanel({ kind: "new", date })}>
                  <Plus aria-hidden />
                  New event
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 self-start sm:min-h-8"
                  onClick={() => {
                    setWeekStart(scheduleWeekOf(date));
                    setView("week");
                  }}
                >
                  <PencilLine aria-hidden />
                  Edit this week
                </Button>
              </div>
            )}
          />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" aria-label="Earlier week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                <ChevronLeft aria-hidden className="size-4" />
              </Button>
              <span className="text-sm font-medium">{weekLabel}</span>
              <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" aria-label="Later week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                <ChevronRight aria-hidden className="size-4" />
              </Button>
            </div>
            {pending > 0 && !publishing && (
              <Button size="sm" className="min-h-11 sm:min-h-8" onClick={() => setPublishing(true)}>
                Publish to the team
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Each day has two layers: shifts with their hours, and on call for the whole day. Publishing sends the week to everyone on the team, so they all see the same
            calendar; each person&apos;s days count once they confirm them.
          </p>
          {publishing && <PublishTeamSchedule weekStart={weekStart} weekLabel={weekLabel} people={toPublish} onClose={() => setPublishing(false)} />}
          {team.length === 0 ? <p className="text-sm text-muted-foreground">Add someone to your team first.</p> : rows.map((r) => <PersonWeek key={`${r.worker.id}:${weekStart}`} row={r} weekStart={weekStart} />)}
        </>
      )}
      <EventPanel state={eventPanel} onClose={() => setEventPanel(null)} invitable={invitable} />
    </div>
  );
}

const STATUS_TONE: Record<WeekStatus, string> = {
  none: "text-muted-foreground",
  draft: "text-warning",
  changed: "text-warning",
  waiting: "text-muted-foreground",
  confirmed: "text-money-positive",
  change_asked: "text-destructive",
};

function PersonWeek({ row, weekStart }: { row: Row; weekStart: string }) {
  const { mailbox, schedule, updateCompany } = useOpenBooks();
  const [error, setError] = useState<string | null>(null);
  const { worker, reachable, draft, published, status } = row;
  const week = draft ?? published?.week ?? emptyWeek(weekStart);
  // The week before, for "Copy last week": its draft, or what was published.
  const lastWeekStart = addDays(weekStart, -7);
  const lastWeek = draftOf(schedule, worker.id, lastWeekStart) ?? (row.partiesKey ? personWeek(businessSources(mailbox, schedule, row.partiesKey), lastWeekStart)?.week : undefined);

  async function save(next: ScheduleWeek) {
    setError(null);
    try {
      await updateCompany((c) => ({ ...c, schedule: setDraft(c.schedule ?? emptySchedule(), worker.id, next) }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const saveDay = (day: ScheduleDay) => {
    try {
      void save(withDay(week, day));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  // Back to what was published: drop the draft.
  const discard = () => void save(emptyWeek(weekStart));

  const days = onCallDays(week);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-medium">{worker.name}</span>
          <span className={cn("text-xs", STATUS_TONE[status])}>{STATUS_LABEL[status]}</span>
        </div>
        {status === "change_asked" && published?.answer?.note && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            <span className="font-medium">{worker.name}:</span> {published.answer.note}
          </p>
        )}
        <ul className="divide-y">
          {scheduleDays(weekStart).map((date) => (
            <DayRow key={date} date={date} day={dayOf(week, date)} onChange={saveDay} />
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
          <span className="text-muted-foreground">
            {formatMinutes(weekShiftMinutes(week))} of shifts{days > 0 ? ` · on call ${days === 1 ? "1 day" : `${days} days`}` : ""}
          </span>
          <div className="flex flex-wrap gap-2">
            {week.days.length === 0 && lastWeek && lastWeek.days.length > 0 && (
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => void save(shiftWeek(lastWeek, weekStart))}>
                <Copy aria-hidden />
                Copy last week
              </Button>
            )}
            {status === "changed" && (
              <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={discard}>
                Undo changes
              </Button>
            )}
          </div>
        </div>
        {!reachable && week.days.length > 0 && (
          <p className="text-xs text-muted-foreground">{worker.name} gets their schedule once they&apos;ve accepted an offer (Jobs → Offers). Until then it stays a draft.</p>
        )}
        <FormError message={error} />
      </CardContent>
    </Card>
  );
}

function DayRow({ date, day, onChange }: { date: string; day: ScheduleDay; onChange: (day: ScheduleDay) => void }) {
  const [adding, setAdding] = useState(false);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("16:30");
  return (
    <li className="flex flex-col gap-2 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="w-24 shrink-0 text-sm font-medium">{dayLabel(date)}</span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {day.shifts.map((b, i) => (
            <span key={`${b.start}-${b.end}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs tabular-nums">
              {blockLabel(b)}
              <button
                type="button"
                aria-label={`Remove the shift ${blockLabel(b)}`}
                className="grid size-6 place-items-center rounded hover:bg-accent"
                onClick={() => onChange({ ...day, shifts: day.shifts.filter((_, j) => j !== i) })}
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          ))}
          {day.onCall && <span className="rounded-md bg-primary/15 px-2 py-1 text-xs font-medium text-primary">On call · 24 h</span>}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex min-h-11 items-center gap-2 text-xs sm:min-h-8">
            <input type="checkbox" className="size-4 accent-[var(--hewn-green)]" checked={day.onCall} onChange={(e) => onChange({ ...day, onCall: e.target.checked })} />
            On call
          </label>
          {!adding && (
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Shift
            </Button>
          )}
        </div>
      </div>
      {adding && (
        <form
          className="flex flex-wrap items-end gap-2 pl-0 sm:pl-24"
          onSubmit={(e) => {
            e.preventDefault();
            onChange({ ...day, shifts: [...day.shifts, { start, end }] });
            setAdding(false);
          }}
        >
          <label className="flex flex-col text-xs text-muted-foreground">
            Starts
            <input type="time" className={cn(inputClass, "w-32")} value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label className="flex flex-col text-xs text-muted-foreground">
            Ends
            <input type="time" className={cn(inputClass, "w-32")} value={end} onChange={(e) => setEnd(e.target.value)} required />
          </label>
          <Button type="submit" size="sm" className="min-h-11 sm:min-h-9">
            Add
          </Button>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      )}
    </li>
  );
}
