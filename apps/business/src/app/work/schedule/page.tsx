"use client";

// Schedule, for a person who works for a business (Joshua, 2026-10-20). Two
// views: the team calendar, everyone's shifts and on-call days as the business
// published them, their own standing out (books/TeamCalendar.tsx); and "My
// week", their own days with both layers, which they confirm or ask to change
// (chain/work/AnswerSchedule.tsx). New weeks arrive with their messages, read
// when the page opens and on "Check now". Personal events (books/events.ts,
// EventPanel.tsx) sit on the calendar too, before any job as well: only this
// person sees them, and nothing about them is sent.

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, ListChecks, Plus, RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { todayIso } from "@/books/display";
import { formatMinutes } from "@/books/hours";
import { addDays, blockLabel, dayOf, onCallDays, scheduleDays, scheduleWeekOf, weekShiftMinutes } from "@/books/schedule";
import { EventPanel, type EventPanelState } from "@/books/EventPanel";
import { TeamCalendar } from "@/books/TeamCalendar";
import { calendarEntries, personWeek } from "@/books/team_schedule";
import { workCalendar, workSources } from "@/books/team_sources";
import { activeAgreements } from "@/books/work";
import { PageHeader } from "@/shell/SectionView";
import { dayLabel, employerLabel, when } from "../shared";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const MessagesCheck = dynamic(() => import("@/chain/work/MessagesCheck"), { ssr: false });
const AnswerSchedule = dynamic(() => import("@/chain/work/AnswerSchedule"), { ssr: false, loading });

export default function SchedulePage() {
  const { work, events } = useWork();
  const [eventPanel, setEventPanel] = useState<EventPanelState>(null);
  const agreements = activeAgreements(work);
  const [chosen, setChosen] = useState("");
  const agreement = agreements.find((a) => a.agreementId === chosen) ?? agreements[0];
  const today = todayIso();
  const [weekStart, setWeekStart] = useState(() => scheduleWeekOf(today));
  const [run, setRun] = useState<number | null>(agreements.length > 0 ? 0 : null);
  const [status, setStatus] = useState<string | null>(null);
  const [answering, setAnswering] = useState<"confirmed" | "change" | null>(null);
  const finished = useCallback((message: string | null) => {
    setRun(null);
    setStatus(message ?? "Up to date.");
  }, []);
  useEffect(() => setAnswering(null), [weekStart, chosen]);

  const sources = useMemo(() => (agreement ? workSources(work, agreement) : undefined), [work, agreement]);
  const entries = useMemo(() => (agreement ? calendarEntries(workCalendar(work, agreement)) : []), [work, agreement]);
  const published = sources ? personWeek(sources, weekStart) : undefined;
  const week = published?.week;
  const days = week ? onCallDays(week) : 0;
  // Opens on their own week while this week waits for their answer; on the calendar otherwise.
  const thisWeek = sources ? personWeek(sources, scheduleWeekOf(today)) : undefined;
  const [view, setView] = useState<"calendar" | "mine" | null>(null);
  const shown = view ?? (thisWeek && !thisWeek.answer && thisWeek.week.days.length > 0 ? "mine" : "calendar");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Schedule" summary="Everyone's shifts and on-call days, as your employer published them. Confirm your own each week, or ask for a change." />
      {agreements.length === 0 ? (
        <>
          <p className="text-sm text-muted-foreground">
            Accept an offer first; your schedule shows here once your employer publishes it.{" "}
            <Link href="/work/offers" className="underline underline-offset-4">
              Offers
            </Link>
          </p>
          <Button variant="outline" size="sm" className="min-h-11 self-start sm:min-h-8" onClick={() => setEventPanel({ kind: "new", date: today })}>
            <Plus aria-hidden />
            New event
          </Button>
          <TeamCalendar
            entries={[]}
            today={today}
            events={events}
            onEvent={(event) => setEventPanel({ kind: "view", event })}
            dayFooter={(date) => (
              <Button variant="outline" size="sm" className="min-h-11 self-start sm:min-h-8" onClick={() => setEventPanel({ kind: "new", date })}>
                <Plus aria-hidden />
                New event
              </Button>
            )}
          />
        </>
      ) : (
        <>
          {agreements.length > 1 && (
            <label className="text-sm">
              <span className="text-xs text-muted-foreground">Employer</span>
              <select className={cn(inputClass, "mt-1 sm:w-72")} value={agreement?.agreementId ?? ""} onChange={(e) => setChosen(e.target.value)}>
                {agreements.map((a) => (
                  <option key={a.agreementId} value={a.agreementId}>
                    {employerLabel(a)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Schedule view" className="inline-flex rounded-md border p-0.5">
              {(
                [
                  ["calendar", "Team calendar", CalendarDays],
                  ["mine", "My week", ListChecks],
                ] as const
              ).map(([v, label, Icon]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={shown === v}
                  onClick={() => setView(v)}
                  className={cn("flex min-h-11 items-center gap-1.5 rounded px-3 text-sm sm:min-h-8", shown === v ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent")}
                >
                  <Icon aria-hidden className="size-4" />
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
                {run !== null ? "Checking for your schedule…" : status}
              </span>
              {run === null && (
                <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setRun(Date.now())}>
                  <RefreshCw aria-hidden />
                  Check now
                </Button>
              )}
            </div>
          </div>
          {run !== null && <MessagesCheck key={run} onFinished={finished} />}

          {shown === "calendar" ? (
            <>
              <Button variant="outline" size="sm" className="min-h-11 self-start sm:min-h-8" onClick={() => setEventPanel({ kind: "new", date: today })}>
                <Plus aria-hidden />
                New event
              </Button>
              <TeamCalendar
                entries={entries}
                today={today}
                events={events}
                onEvent={(event) => setEventPanel({ kind: "view", event })}
                {...(sources?.who ? { highlight: sources.who } : {})}
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
                        setView("mine");
                      }}
                    >
                      <ListChecks aria-hidden />
                      My week
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
              <span className="text-sm font-medium">
                {dayLabel(weekStart)} – {dayLabel(addDays(weekStart, 6))}
                {weekStart === scheduleWeekOf(today) && <span className="block text-xs font-normal text-muted-foreground">This week</span>}
              </span>
              <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" aria-label="Later week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                <ChevronRight aria-hidden className="size-4" />
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              {!published || !week || week.days.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing published for this week yet.</p>
              ) : (
                <>
                  <ul className="divide-y">
                    {scheduleDays(weekStart).map((date) => {
                      const day = dayOf(week, date);
                      const empty = day.shifts.length === 0 && !day.onCall;
                      return (
                        <li key={date} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                          <span className={cn("w-24 shrink-0 font-medium", date === today && "text-primary")}>{dayLabel(date)}</span>
                          {empty && <span className="text-muted-foreground">Off</span>}
                          {day.shifts.map((b) => (
                            <span key={`${b.start}-${b.end}`} className="rounded-md bg-muted px-2 py-1 text-xs tabular-nums">
                              {blockLabel(b)}
                            </span>
                          ))}
                          {day.onCall && <span className="rounded-md bg-primary/15 px-2 py-1 text-xs font-medium text-primary">On call · 24 h</span>}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="border-t pt-3 text-sm text-muted-foreground">
                    {formatMinutes(weekShiftMinutes(week))} of shifts{days > 0 ? ` · on call ${days === 1 ? "1 day" : `${days} days`}` : ""} · published {when(published.sentAt)}
                  </p>
                  {published.note && <p className="text-sm">Note from {employerLabel(agreement!)}: {published.note}</p>}
                  {published.answer ? (
                    <p className={cn("text-sm", published.answer.answer === "confirmed" ? "text-money-positive" : "text-muted-foreground")}>
                      {published.answer.answer === "confirmed" ? `You confirmed this week ${when(published.answer.at)}.` : `You asked for a change: ${published.answer.note}`}
                      {published.answer.answer === "change" && " They'll publish it again once it's sorted."}
                    </p>
                  ) : answering && agreement ? (
                    <AnswerSchedule
                      partiesKey={agreement.partiesKey}
                      employerAddress={agreement.employerAddress}
                      employer={employerLabel(agreement)}
                      scheduleId={published.id}
                      weekStart={weekStart}
                      answer={answering}
                      onClose={() => setAnswering(null)}
                    />
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      <Button className="min-h-11 sm:min-h-9" onClick={() => setAnswering("confirmed")}>
                        Confirm this week
                      </Button>
                      <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setAnswering("change")}>
                        Ask for a change
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          </>
          )}
        </>
      )}
      <EventPanel state={eventPanel} onClose={() => setEventPanel(null)} />
    </div>
  );
}
