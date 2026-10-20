"use client";

// Schedule, under Payroll (Joshua, 2026-10-20): a week at a time, one card per
// team member, each day with two layers: shift blocks with their hours, and
// on call for the whole day. Edits are drafts in the vault; Publish sends the
// person their week (chain/PublishSchedule.tsx) and they confirm it or ask for
// a change. Answers are read with the rest of the team's letters, when the
// tab opens and on "Check now".

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, Copy, Plus, RefreshCw, X } from "lucide-react";
import type { Worker } from "@pnw/payroll";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { todayIso } from "@/books/display";
import { formatMinutes } from "@/books/hours";
import { threadFor } from "@/books/mailbox";
import { mailboxLinks } from "@/books/mailbox_feed";
import { linkFor } from "@/books/rail";
import {
  STATUS_LABEL,
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
  publishedWeek,
  scheduleDays,
  scheduleWeekOf,
  setDraft,
  shiftWeek,
  weekShiftMinutes,
  weekStatus,
  withDay,
} from "@/books/schedule";
import { dayLabel } from "../work/shared";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const MailboxCheck = dynamic(() => import("@/chain/MailboxCheck"), { ssr: false });
const PublishSchedule = dynamic(() => import("@/chain/PublishSchedule"), { ssr: false, loading });

type Checking = { state: "idle" } | { state: "running"; run: number } | { state: "done"; message?: string };

export function Schedule() {
  const { payroll, rail } = useOpenBooks();
  const [weekStart, setWeekStart] = useState(() => scheduleWeekOf(todayIso()));
  const canCheck = mailboxLinks(rail).length > 0;
  const [check, setCheck] = useState<Checking>(canCheck ? { state: "running", run: 0 } : { state: "idle" });
  const finished = useCallback((o: { message?: string }) => setCheck({ state: "done", ...(o.message ? { message: o.message } : {}) }), []);
  useEffect(() => {
    if (canCheck) setCheck((c) => (c.state === "idle" ? { state: "running", run: 0 } : c));
  }, [canCheck]);
  const team = payroll.workers.filter((w) => w.active);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" aria-label="Earlier week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <span className="text-sm font-medium">
            {dayLabel(weekStart)} – {dayLabel(addDays(weekStart, 6))}
          </span>
          <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" aria-label="Later week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight aria-hidden className="size-4" />
          </Button>
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
      <p className="text-xs text-muted-foreground">
        Each day has two layers: shifts with their hours, and on call for the whole day. Publish sends the person their week; it counts once they confirm it.
      </p>
      {team.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add someone to your team first.</p>
      ) : (
        team.map((w) => <PersonWeek key={`${w.id}:${weekStart}`} worker={w} weekStart={weekStart} />)
      )}
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

function PersonWeek({ worker, weekStart }: { worker: Worker; weekStart: string }) {
  const { rail, mailbox, schedule, updateCompany } = useOpenBooks();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = rail ? linkFor(rail, worker.id) : undefined;
  const reachable = link?.status === "linked" && !!link.partiesKey;
  const thread = link?.partiesKey ? threadFor(mailbox, link.partiesKey) : undefined;
  const published = publishedWeek(thread, weekStart);
  const draft = draftOf(schedule, worker.id, weekStart);
  const week = draft ?? published?.week ?? emptyWeek(weekStart);
  const status = weekStatus(draft, published);
  // The week before, for "Copy last week": its draft, or what was published.
  const lastWeekStart = addDays(weekStart, -7);
  const lastWeek = draftOf(schedule, worker.id, lastWeekStart) ?? publishedWeek(thread, lastWeekStart)?.week;

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
            {reachable && (status === "draft" || status === "changed") && !publishing && (
              <Button size="sm" className="min-h-11 sm:min-h-8" onClick={() => setPublishing(true)}>
                {status === "changed" ? "Publish the changes" : "Publish"}
              </Button>
            )}
          </div>
        </div>
        {!reachable && week.days.length > 0 && (
          <p className="text-xs text-muted-foreground">{worker.name} gets their schedule once they&apos;ve accepted an offer (Jobs → Offers). Until then it stays a draft.</p>
        )}
        {publishing && (
          <PublishSchedule
            workerId={worker.id}
            workerName={worker.name}
            week={week}
            onClose={(sent) => {
              setPublishing(false);
              // Published: the draft has done its job; what was sent now lives in the conversation.
              if (sent) void save(emptyWeek(weekStart));
            }}
          />
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
