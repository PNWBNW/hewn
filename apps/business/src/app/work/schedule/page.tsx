"use client";

// Schedule, for a person who works for a business (Joshua, 2026-10-20): the
// week their employer published, day by day, with both layers: the shifts
// and their hours, and the days they're on call. They confirm it or ask for a
// change (chain/work/AnswerSchedule.tsx). New weeks arrive with their
// messages, read when the page opens and on "Check now".

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { todayIso } from "@/books/display";
import { formatMinutes } from "@/books/hours";
import { addDays, blockLabel, dayOf, onCallDays, publishedWeek, scheduleDays, scheduleWeekOf, weekShiftMinutes } from "@/books/schedule";
import { activeAgreements, workThread } from "@/books/work";
import { PageHeader } from "@/shell/SectionView";
import { dayLabel, employerLabel, when } from "../shared";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const MessagesCheck = dynamic(() => import("@/chain/work/MessagesCheck"), { ssr: false });
const AnswerSchedule = dynamic(() => import("@/chain/work/AnswerSchedule"), { ssr: false, loading });

export default function SchedulePage() {
  const { work } = useWork();
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

  const thread = agreement ? workThread(work, agreement.partiesKey) : undefined;
  const published = publishedWeek(thread, weekStart);
  const week = published?.week;
  const days = week ? onCallDays(week) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Schedule" summary="Your shifts and on-call days, as your employer published them. Confirm each week, or ask for a change." />
      {agreements.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Accept an offer first; your schedule shows here once your employer publishes it.{" "}
          <Link href="/work/offers" className="underline underline-offset-4">
            Offers
          </Link>
        </p>
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

          <Card>
            <CardContent className="flex flex-col gap-3 pt-6">
              {!published || !week ? (
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
    </div>
  );
}
