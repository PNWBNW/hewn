"use client";

// Hours, under Payroll: the weeks the team has sent from their Hours page,
// newest first, each opening to its days. They are read from the team's
// letters when the tab opens and on "Check now", kept in the encrypted vault,
// and fill in the next pay run.

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useOpenBooks } from "@/books/BooksProvider";
import { formatMinutes } from "@/books/hours";
import { markHoursRead, unreadCount } from "@/books/mailbox";
import { type HoursItem, hoursFeed, mailboxLinks } from "@/books/mailbox_feed";
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
              Nothing yet. The weeks your team sends from their Hours page land here, and fill in the next pay run.
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
  const h = item.hours;
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open && !h.read) onRead(h);
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-baseline justify-between gap-3 sm:min-h-0">
        <span className="min-w-0">
          <span className={cn("font-medium", !h.read && "text-primary")}>{item.workerName}</span> sent hours for the week of {dayLabel(h.weekStart)}
          <span className="block text-xs text-muted-foreground">
            {formatMinutes(h.totalMinutes)} · {when(item.at)}
            {!h.read && " · New"}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">Details</span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1 rounded-md bg-muted/40 p-3 text-xs">
        {h.entries.map((e, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span>{dayLabel(e.date)}</span>
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
