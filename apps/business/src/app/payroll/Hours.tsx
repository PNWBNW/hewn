"use client";

// Hours, under Payroll: the weeks the team has sent from their Hours page,
// newest first, one card per week (the sends of a week are combined,
// books/mailbox.ts), each opening to its shifts. They are read from the team's letters when
// the tab opens and on "Check now" and kept in the encrypted vault.
//
// Changing hours takes both sides (books/hours_change.ts): the business can
// question a shift (nothing changes until the person agrees), and answers the
// person's requests for a revision. A shift the person edited before sending
// says so, and what it was.

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useOpenBooks } from "@/books/BooksProvider";
import { formatMinutes, overtimeSplit } from "@/books/hours";
import { type HoursChange as Change, type Stretch, changeFor, hoursChanges, wholeShifts } from "@/books/hours_change";
import { markHoursRead, threadFor, unreadCount } from "@/books/mailbox";
import { type HoursItem, hoursFeed, mailboxLinks } from "@/books/mailbox_feed";
import { linkFor } from "@/books/rail";
import { payRulesFor } from "@/books/timecard_pay";
import { clock, dayLabel, when } from "../work/shared";

// Fetched only once there is a linked team member whose weeks could arrive.
const MailboxCheck = dynamic(() => import("@/chain/MailboxCheck"), { ssr: false });
const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const HoursChange = dynamic(() => import("@/chain/HoursChange"), { ssr: false, loading });

/** A shift's day and times on this device, "Tue, Oct 20 7:00 AM – 3:30 PM". */
const span = (s: Stretch) => `${new Date(s.in).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${clock(s.in)} – ${clock(s.out)}`;

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

      <OpenChanges />

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
  // Overtime under their offer's work week (time and a half after 40 a week without one): the same split payroll pays.
  const rules = payRulesFor(rail, item.workerId);
  const split = overtimeSplit(h.entries, rules);
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
            {split.overtime > 0 && ` (${formatMinutes(split.overtime)} overtime at ${rules.overtimeRate}×)`} · {when(item.at)}
            {h.sends && ` · ${h.sends} sends combined`}
            {h.entries.some((e) => e.paid) && (h.entries.every((e) => e.paid) ? " · Paid" : ` · ${h.entries.filter((e) => e.paid).length} of ${h.entries.length} stretches paid`)}
            {longShifts > 0 && <span className="text-warning"> · {longShifts === 1 ? "1 long shift" : `${longShifts} long shifts`} to review</span>}
            {!h.read && " · New"}
          </span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">Details</span>
      </summary>
      <ul className="mt-2 flex flex-col divide-y rounded-md bg-muted/40 px-3 text-xs">
        {wholeShifts(h.entries).map((shift) => (
          <ShiftRow key={shift.in} item={item} shift={shift} />
        ))}
      </ul>
    </details>
  );
}

/** The person's conversation with the business, its changes to hours, and how to reach them. */
function useChanges(workerId: string) {
  const { rail, mailbox } = useOpenBooks();
  const link = rail ? linkFor(rail, workerId) : undefined;
  const partiesKey = link?.status === "linked" ? link.partiesKey : undefined;
  return { partiesKey, changes: partiesKey ? hoursChanges(threadFor(mailbox, partiesKey)) : [] };
}

/** One shift on a card: its times, what it was if it moved, where a change to it stands, and Question. */
function ShiftRow({ item, shift }: { item: HoursItem; shift: { in: string; out: string; entries: HoursItem["hours"]["entries"] } }) {
  const { rail } = useOpenBooks();
  const { partiesKey, changes } = useChanges(item.workerId);
  const [asking, setAsking] = useState(false);
  const first = shift.entries[0]!;
  const minutes = shift.entries.reduce((t, e) => t + e.minutes, 0);
  const paid = shift.entries.some((e) => e.paid);
  const change = changeFor(changes, item.hours.agreementId, shift);
  const open = change && !change.answer;
  const same = (a: string, b: string) => Date.parse(a) === Date.parse(b);
  const vouched =
    first.change === "agreed" &&
    changes.some((c) => c.answer?.answer === "accepted" && c.body.agreementId === item.hours.agreementId && c.body.proposed && same(c.body.proposed.in, shift.in) && same(c.body.proposed.out, shift.out));
  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex justify-between gap-3">
        <span>
          {dayLabel(first.date)}
          {first.long && <span className="ml-2 rounded-sm bg-warning/15 px-1.5 py-0.5 text-warning">Long shift, confirmed by {item.workerName}: review before paying</span>}
          {first.callout && <span className="ml-2 rounded-sm bg-primary/15 px-1.5 py-0.5 font-medium text-primary">Callout</span>}
          {paid && <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5">Paid {dayLabel(shift.entries.find((e) => e.paid)!.paid!.payDate)}</span>}
        </span>
        <span className="text-muted-foreground">
          {clock(shift.in)} – {clock(shift.out)}
        </span>
        <span className="tabular-nums">{formatMinutes(minutes)}</span>
      </div>
      {first.was && first.change && (
        // "Agreed" only when the conversation shows the business accepting these very times; otherwise it's their edit.
        <p className={vouched ? "text-muted-foreground" : "text-warning"}>
          {vouched ? "Changed as you both agreed" : `Edited by ${item.workerName} before sending`}; it was {span(first.was)}.
        </p>
      )}
      {change && <ChangeLine change={change} who={item.workerName} />}
      {!open && !paid && partiesKey && !asking && (
        <Button variant="outline" size="sm" className="min-h-11 self-start sm:min-h-7" onClick={() => setAsking(true)}>
          Question these hours
        </Button>
      )}
      {asking && partiesKey && (
        <HoursChange
          workerId={item.workerId}
          workerName={item.workerName}
          partiesKey={partiesKey}
          mode={{ kind: "question", agreementId: item.hours.agreementId, shift: { in: shift.in, out: shift.out }, timeZone: payRulesFor(rail, item.workerId).timeZone }}
          onClose={() => setAsking(false)}
        />
      )}
    </li>
  );
}

/** Where one change stands, in a line. */
function ChangeLine({ change, who }: { change: Change; who: string }) {
  const times = change.body.proposed ? ` to ${clock(change.body.proposed.in)} – ${clock(change.body.proposed.out)}` : "";
  if (change.from === "business") {
    if (!change.answer) return <p className="text-muted-foreground">You questioned this shift{times}: waiting for {who}. It waits out of pay runs until they answer.</p>;
    return change.answer.answer === "accepted" ? (
      <p className="text-money-positive">{who} agreed{times ? `: changed${times}` : ""}.</p>
    ) : (
      <p className="text-muted-foreground">
        {who} kept it as sent: {change.answer.note}
      </p>
    );
  }
  if (!change.answer) return <p className="text-warning">{who} asked for a revision{times}: see Changes to hours above.</p>;
  return <p className="text-muted-foreground">{change.answer.answer === "accepted" ? `You accepted ${who}'s revision${times}.` : `You kept it as it was: ${change.answer.note}`}</p>;
}

/** Every change to hours still waiting: the person's requests to answer, and the business's own questions. */
function OpenChanges() {
  const { payroll, rail, mailbox } = useOpenBooks();
  const open = payroll.workers.flatMap((w) => {
    const link = rail ? linkFor(rail, w.id) : undefined;
    if (link?.status !== "linked" || !link.partiesKey) return [];
    return hoursChanges(threadFor(mailbox, link.partiesKey))
      .filter((c) => !c.answer)
      .map((c) => ({ c, workerId: w.id, name: w.name, partiesKey: link.partiesKey! }));
  });
  if (open.length === 0) return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <h3 className="text-sm font-semibold">Changes to hours</h3>
        <ul className="divide-y">
          {open.map((o) => (
            <OpenChange key={o.c.id} {...o} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function OpenChange({ c, workerId, name, partiesKey }: { c: Change; workerId: string; name: string; partiesKey: string }) {
  const [answering, setAnswering] = useState<{ kind: "answer"; changeId: string; answer: "accepted" | "declined" } | null>(null);
  const p = c.body.proposed;
  return (
    <li className="flex flex-col gap-2 py-3 text-sm">
      <p>
        {c.from === "worker" ? (
          <>
            <span className="font-medium">{name}</span> asks to change {span(c.body.shift)}
            {p && <> to {span(p)}</>}.
          </>
        ) : (
          <>
            You asked <span className="font-medium">{name}</span> about {span(c.body.shift)}
            {p && <>, suggesting {span(p)}</>}. Waiting for their answer.
          </>
        )}
      </p>
      <p className="text-muted-foreground">“{c.body.note}”</p>
      {c.from === "worker" && !answering && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="min-h-11 sm:min-h-8" onClick={() => setAnswering({ kind: "answer", changeId: c.id, answer: "accepted" })}>
            Accept
          </Button>
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setAnswering({ kind: "answer", changeId: c.id, answer: "declined" })}>
            Decline
          </Button>
        </div>
      )}
      {answering && <HoursChange workerId={workerId} workerName={name} partiesKey={partiesKey} mode={answering} onClose={() => setAnswering(null)} />}
    </li>
  );
}
