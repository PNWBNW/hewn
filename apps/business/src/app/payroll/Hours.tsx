"use client";

// Hours, under Payroll: the weeks the team has sent from their Hours page,
// newest first, one card per week (the sends of a week are combined,
// books/mailbox.ts), each opening to its days. They are read from the team's letters when
// the tab opens and on "Check now" and kept in the encrypted vault.

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useOpenBooks } from "@/books/BooksProvider";
import { formatMinutes, overtimeSplit } from "@/books/hours";
import { markHoursRead, unreadCount } from "@/books/mailbox";
import { type HoursItem, hoursFeed, mailboxLinks } from "@/books/mailbox_feed";
import { linkFor } from "@/books/rail";
import { clock, dayLabel, when } from "../work/shared";

// Fetched only once there is a linked team member whose weeks could arrive.
const MailboxCheck = dynamic(() => import("@/chain/MailboxCheck"), { ssr: false });

type Checking = { state: "idle" } | { state: "running"; run: number } | { state: "done"; received: number; skipped: number; message?: string };

export function Hours() {
  const { rail, payroll, mailbox, updateCompany } = useOpenBooks();
  const canCheck = mailboxLinks(rail).length > 0;
  const [check, setCheck] = useState<Checking>(canCheck ? { state: "running", run: 0 } : { state: "idle" });
  const feed = useMemo(() => hoursFeed({ rail, payroll, mailbox }), [rail, payroll, mailbox]);
  const unread = unreadCount(mailbox);

  const finished = useCallback((o: { received: number; skipped: number; message?: string }) => setCheck({ state: "done", ...o }), []);
  useEffect(() => {
    if (canCheck) setCheck((c) => (c.state === "idle" ? { state: "running", run: 0 } : c));
  }, [canCheck]);

  const status =
    check.state === "running"
      ? "Checking for new hours…"
      : check.state === "done"
        ? (check.message ??
          (check.received > 0 ? `${check.received} new ${check.received === 1 ? "week" : "weeks"} of hours arrived.` : "Nothing new.") +
            (check.skipped > 0 ? ` ${check.skipped} couldn't be read and ${check.skipped === 1 ? "was" : "were"} skipped.` : ""))
        : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {canCheck && check.state === "done" && (
          <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setCheck({ state: "running", run: Date.now() })}>
            <RefreshCw aria-hidden />
            Check now
          </Button>
        )}
        {status && (
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {status}
            {unread > 0 && check.state === "done" && ` ${unread} unread.`}
          </p>
        )}
      </div>
      {check.state === "running" && <MailboxCheck key={check.run} onFinished={finished} />}

      <Card>
        <CardContent className="pt-6">
          {feed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet. The weeks your team sends from their Hours page land here.
              {!canCheck && " Someone has to be linked first: they accept an offer, from Jobs → Offers."}
            </p>
          ) : (
            <ul className="divide-y">
              {feed.map((item) => (
                <li key={item.key} className="py-3 text-sm">
                  <WeekRow
                    item={item}
                    onRead={(h) => void updateCompany((c) => (c.mailbox ? { ...c, mailbox: markHoursRead(c.mailbox, h.agreementId, h.seq) } : c))}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WeekRow({ item, onRead }: { item: HoursItem; onRead: (hours: HoursItem["hours"]) => void }) {
  const { rail } = useOpenBooks();
  const h = item.hours;
  // Overtime under the work week in their offer's terms: the same split their own Hours page shows.
  const terms = rail ? linkFor(rail, item.workerId)?.terms : undefined;
  const split = terms?.version === 2 && terms.workWeek ? overtimeSplit(h.entries, terms.workWeek) : null;
  const longShifts = h.entries.filter((e) => e.long).length;
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open && !h.read) onRead(h);
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-baseline justify-between gap-3 sm:min-h-0">
        <span className="min-w-0">
          <span className={cn("font-medium", !h.read && "text-primary")}>{item.workerName}</span> sent {h.sends ? "more hours" : "hours"} for the week of{" "}
          {dayLabel(h.weekStart)}
          <span className="block text-xs text-muted-foreground">
            {formatMinutes(h.totalMinutes)}
            {split && split.overtime > 0 && ` (${formatMinutes(split.overtime)} overtime)`} · {when(item.at)}
            {h.sends && ` · ${h.sends} sends combined`}
            {h.entries.some((e) => e.paid) && (h.entries.every((e) => e.paid) ? " · Paid" : ` · ${h.entries.filter((e) => e.paid).length} of ${h.entries.length} stretches paid`)}
            {longShifts > 0 && <span className="text-warning"> · {longShifts === 1 ? "1 long shift" : `${longShifts} long shifts`} to review</span>}
            {!h.read && " · New"}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">Details</span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1 rounded-md bg-muted/40 p-3 text-xs">
        {h.entries.map((e, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>
              {dayLabel(e.date)}
              {e.long && <span className="ml-2 rounded-sm bg-warning/15 px-1.5 py-0.5 text-warning">Long shift, confirmed by {item.workerName}: review before paying</span>}
              {e.paid && <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5">Paid {dayLabel(e.paid.payDate)}</span>}
            </span>
            <span className="text-muted-foreground">
              {clock(e.in)} – {clock(e.out)}
            </span>
            <span className="tabular-nums">{formatMinutes(e.minutes)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
