"use client";

// Mailbox: everything that has passed between this business and its team, in
// one list, newest first. Offers sent and paystubs delivered are read from
// the books; a team member's weeks of hours are collected from their
// sealed mailbox when the page opens (and on "Check now"), written to the
// encrypted vault, and shown here. Checking needs no Shield. Only "Check for
// a reply" on a waiting offer loads the Shield-backed panel, and only when tapped.

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useOpenBooks } from "@/books/BooksProvider";
import { formatMinutes } from "@/books/hours";
import { markHoursRead, unreadCount } from "@/books/mailbox";
import { type FeedItem, buildFeed, hasWaitingOffer, mailboxLinks } from "@/books/mailbox_feed";
import { PageHeader } from "@/shell/SectionView";
import { clock, dayLabel, when } from "../work/shared";

// Fetched only once there is something to read; nobody without a linked team member downloads it.
const MailboxCheck = dynamic(() => import("@/chain/MailboxCheck"), { ssr: false });
// And only when a reply to an offer is being looked for.
const RailPanel = dynamic(() => import("@/chain/RailPanel"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});

type Checking = { state: "idle" } | { state: "running"; run: number } | { state: "done"; received: number; skipped: number; message?: string };

export default function MailboxPage() {
  const { rail, payroll, mailbox, updateCompany } = useOpenBooks();
  const canCheck = mailboxLinks(rail).length > 0;
  const [check, setCheck] = useState<Checking>(canCheck ? { state: "running", run: 0 } : { state: "idle" });
  const [replying, setReplying] = useState(false);
  const feed = useMemo(() => buildFeed({ rail, payroll, mailbox }), [rail, payroll, mailbox]);
  const unread = unreadCount(mailbox);

  const finished = useCallback((o: { received: number; skipped: number; message?: string }) => setCheck({ state: "done", ...o }), []);

  // Linking a team member while this page is open starts the first check.
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Mailbox"
        summary="Offers you've sent, hours your team sends, and paystubs you've delivered."
        action={
          canCheck && check.state === "done" ? (
            <Button className="min-h-11 sm:min-h-9" onClick={() => setCheck({ state: "running", run: Date.now() })}>
              <RefreshCw aria-hidden />
              Check now
            </Button>
          ) : undefined
        }
      />

      {check.state === "running" && <MailboxCheck key={check.run} onFinished={finished} />}
      {status && (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {status}
          {unread > 0 && check.state === "done" && ` ${unread} unread.`}
        </p>
      )}

      {hasWaitingOffer(rail) && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <p className="text-sm">An offer is waiting for a reply. Once they accept, check here and they&apos;re linked.</p>
            {replying ? (
              <RailPanel mode="import" onClose={() => setReplying(false)} />
            ) : (
              <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => setReplying(true)}>
                Check for a reply
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {feed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet. An offer you send, hours your team sends and paystubs you deliver all land here. Start from Payroll → Team → Send offer.
            </p>
          ) : (
            <ul className="divide-y">
              {feed.map((item) => (
                <li key={item.key} className="py-3 text-sm">
                  <Row item={item} onRead={(h) => void updateCompany((c) => (c.mailbox ? { ...c, mailbox: markHoursRead(c.mailbox, h.agreementId, h.seq) } : c))} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ item, onRead }: { item: FeedItem; onRead: (hours: Extract<FeedItem, { kind: "hours" }>["hours"]) => void }) {
  if (item.kind === "hours") {
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
  const text =
    item.kind === "offer"
      ? { title: `Offer sent to ${item.workerName}`, detail: "Waiting for them to accept." }
      : item.kind === "accepted"
        ? { title: `${item.workerName} accepted your offer`, detail: "They're linked: you can pay them on the rail and send paystubs." }
        : { title: `Paystub sent to ${item.workerName}`, detail: `Pay date ${dayLabel(item.payDate)}.` };
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{text.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{when(item.at)}</span>
      </div>
      <div className="text-xs text-muted-foreground">{text.detail}</div>
    </div>
  );
}
