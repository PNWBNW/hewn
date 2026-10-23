"use client";

// Events with guests (books/shared_events.ts), on either side, inside the
// event pop-up (EventPanel.tsx):
//   - one this account organizes: what's been sent, each guest's answer, and
//     Send, Edit, Cancel event or Delete;
//   - an invitation: who it's from, the guest list, and Going, Maybe or Not
//     going;
// and the "Waiting for your answer" list at the top of a Schedule page.
// Sending and answering are letters through Shield (chain/SendEvent.tsx,
// chain/AnswerEvent.tsx), loaded only when tapped.

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CalendarClock, Send, Trash2, Pencil, XCircle } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@pnw/ui/dialog";
import { cn } from "@pnw/ui/utils";
import { FormError, errorMessage } from "./AuthCard";
import { useOpenBooks } from "./BooksProvider";
import { todayIso } from "./display";
import { EventDetailsList, eventWhen } from "./EventDetailsList";
import { myAnswerIn, organizerAccount, threadOfContact } from "./event_contacts";
import {
  ANSWER_LABEL,
  type CalendarEvent,
  type GuestAnswer,
  type Invite,
  answerCounts,
  answersFor,
  canDelete,
  cancelHosted,
  contactRef,
  deleteHosted,
  emptyCalendar,
  gaveKey,
  hideInvite,
  inviteKey,
  needsSend,
  putHosted,
  sharedCalendarEvents,
  waitingInvites,
} from "./shared_events";
import { EVENT_ANSWERS, type EventAnswer } from "./thread";

const loading = () => <p className="text-sm text-muted-foreground">Loading…</p>;
const SendEvent = dynamic(() => import("@/chain/SendEvent"), { ssr: false, loading });
const AnswerEvent = dynamic(() => import("@/chain/AnswerEvent"), { ssr: false, loading });
/** Who the chain says the organizer's account belongs to (chain/confirmed_names.tsx). */
const ConfirmedFrom = dynamic(() => import("@/chain/confirmed_names"), { ssr: false });

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** How a guest's answer reads: to the current version, to an earlier one, or none yet. */
function answerLine(a: GuestAnswer | undefined, since: number): string {
  if (a && answerCounts(a, since)) return ANSWER_LABEL[a.answer];
  return a ? `Answered before it changed (${ANSWER_LABEL[a.answer].toLowerCase()})` : "No answer yet";
}

/** One event this account organizes. */
export function HostedView({ id, onEdit, onDone }: { id: string; onEdit: () => void; onDone: () => void }) {
  const { calendar, mailbox, work, updateCompany } = useOpenBooks();
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState<"cancel" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const event = calendar?.hosted.find((e) => e.id === id);
  if (!event) return <p className="text-sm text-muted-foreground">That event isn&apos;t in these books any more.</p>;

  const threadOf = (c: Parameters<typeof threadOfContact>[0]) => threadOfContact(c, { mailbox, work });
  const answers = answersFor(event, threadOf);
  const circle = calendar?.circles[event.scope];
  const missing = event.sent && circle && !event.cancelled ? event.guests.filter((g) => !gaveKey(threadOf(g.contact), circle)) : [];
  const changed = needsSend(event);
  const tally = EVENT_ANSWERS.map((k) => [k, event.guests.filter((g) => answers.get(contactRef(g.contact))?.answer === k && answerCounts(answers.get(contactRef(g.contact)), event.since)).length] as const);
  const waiting = event.guests.length - tally.reduce((n, [, c]) => n + c, 0);

  const status = event.cancelled
    ? changed
      ? "Called off. The guests haven't been told yet."
      : "Called off. The guests were told."
    : !event.sent
      ? "Not sent yet: nobody knows about it until you send it."
      : changed
        ? "Changed since you sent it. Send the changes so the guests have them."
        : `Sent ${shortDate(event.sent.at)}.${missing.length > 0 ? ` ${missing.map((g) => g.name).join(", ")} ${missing.length === 1 ? "hasn't" : "haven't"} got it yet.` : ""}`;
  const sendLabel = event.cancelled ? "Tell the guests it's off" : !event.sent ? "Send invitations" : changed ? "Send the changes" : "Send to them";

  async function apply(change: "cancel" | "delete") {
    setError(null);
    try {
      await updateCompany((c) => {
        const cal = c.calendar ?? emptyCalendar();
        return { ...c, calendar: change === "delete" ? deleteHosted(cal, id) : putHosted(cal, cancelHosted(event!)) };
      });
      setConfirming(null);
      if (change === "delete") onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <DialogHeader className="pr-10 text-left">
        <DialogTitle className={cn(event.cancelled && "line-through")}>{event.details.title}</DialogTitle>
        <DialogDescription>{status}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <EventDetailsList details={event.details} />
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            Guests ·{" "}
            {[...tally.filter(([, n]) => n > 0).map(([k, n]) => `${n} ${ANSWER_LABEL[k].toLowerCase()}`), ...(waiting > 0 ? [`${waiting} not answered`] : [])].join(", ")}
          </h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {event.guests.map((g) => {
              const a = answers.get(contactRef(g.contact));
              return (
                <li key={contactRef(g.contact)} className="flex flex-col">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate">{g.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{answerLine(a, event.since)}</span>
                  </span>
                  {a && answerCounts(a, event.since) && a.note && <span className="text-xs text-muted-foreground">“{a.note}”</span>}
                </li>
              );
            })}
          </ul>
        </section>
        {sending && <SendEvent eventId={event.id} onClose={() => setSending(false)} />}
      </div>
      <FormError message={error} />
      {!sending && (
        <DialogFooter className="mt-2 flex-wrap gap-2">
          {confirming ? (
            <>
              <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setConfirming(null)}>
                Keep it
              </Button>
              <Button variant="destructive" className="min-h-11 sm:min-h-9" onClick={() => void apply(confirming)}>
                {confirming === "delete" ? "Delete the event" : "Call it off"}
              </Button>
            </>
          ) : (
            <>
              {canDelete(event) && (
                <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setConfirming("delete")}>
                  <Trash2 aria-hidden />
                  Delete
                </Button>
              )}
              {event.sent && !event.cancelled && (
                <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setConfirming("cancel")}>
                  <XCircle aria-hidden />
                  Cancel event
                </Button>
              )}
              {!event.cancelled && (
                <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={onEdit}>
                  <Pencil aria-hidden />
                  Edit
                </Button>
              )}
              {(changed || missing.length > 0) && (
                <Button className="min-h-11 sm:min-h-9" onClick={() => setSending(true)}>
                  <Send aria-hidden />
                  {sendLabel}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      )}
    </>
  );
}

/** One invitation this account received. */
export function InviteView({ inviteKey: key, onDone }: { inviteKey: string; onDone: () => void }) {
  const { calendar, mailbox, work, rail, updateCompany } = useOpenBooks();
  const [answering, setAnswering] = useState<EventAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invite = calendar?.invites.find((i) => inviteKey(i) === key);
  if (!invite) return <p className="text-sm text-muted-foreground">That invitation isn&apos;t in these books any more.</p>;
  const mine = myAnswerIn({ mailbox, work })(invite);
  const counts = answerCounts(mine, invite.since);

  const status =
    invite.status === "cancelled"
      ? `Called off by ${invite.organizer}.`
      : invite.status === "removed"
        ? `${invite.organizer} took you off the guest list.`
        : mine && counts
          ? `You said: ${ANSWER_LABEL[mine.answer].toLowerCase()}.`
          : mine
            ? "It changed since you answered: answer again."
            : "Waiting for your answer.";

  async function hide() {
    setError(null);
    try {
      await updateCompany((c) => ({ ...c, calendar: hideInvite(c.calendar ?? emptyCalendar(), key) }));
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <DialogHeader className="pr-10 text-left">
        <DialogTitle className={cn(invite.status !== "open" && "line-through")}>{invite.details.title}</DialogTitle>
        <DialogDescription>
          From {invite.organizer}. {status}
        </DialogDescription>
        <OrganizerName invite={invite} books={{ work, rail }} />
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <EventDetailsList details={invite.details} />
        {counts && mine?.note && <p className="text-sm text-muted-foreground">Your note: “{mine.note}”</p>}
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Guests, as of {shortDate(invite.sentAt)}</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {invite.guests.map((g) => (
              <li key={g.who} className="flex items-baseline justify-between gap-3">
                <span className={cn("truncate", g.who === invite.me && "font-medium")}>
                  {g.name}
                  {g.who === invite.me && " (you)"}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{g.answer ? ANSWER_LABEL[g.answer] : ""}</span>
              </li>
            ))}
          </ul>
        </section>
        {answering && <AnswerEvent invite={key} answer={answering} onClose={() => setAnswering(null)} />}
      </div>
      <FormError message={error} />
      {!answering && (
        <DialogFooter className="mt-2 flex-wrap gap-2">
          {invite.status === "open" ? (
            [...EVENT_ANSWERS].reverse().map((a) => (
              <Button key={a} variant={counts && mine?.answer === a ? "default" : "outline"} className="min-h-11 sm:min-h-9" onClick={() => setAnswering(a)}>
                {ANSWER_LABEL[a]}
              </Button>
            ))
          ) : (
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => void hide()}>
              Remove from my calendar
            </Button>
          )}
        </DialogFooter>
      )}
    </>
  );
}

/** The registered name the chain confirms for the account an invitation came from. */
function OrganizerName({ invite, books }: { invite: Invite; books: Parameters<typeof organizerAccount>[1] }) {
  const from = organizerAccount(invite.from, books);
  return from ? <ConfirmedFrom account={from.account} expect={from.expect} /> : null;
}

/** Invitations waiting for this account's answer, at the top of a Schedule page. Nothing when there are none. */
export function InvitationsWaiting({ onOpen }: { onOpen: (key: string) => void }) {
  const { calendar, mailbox, work, rail } = useOpenBooks();
  const waiting = waitingInvites(calendar, myAnswerIn({ mailbox, work }), todayIso());
  if (waiting.length === 0) return null;
  return (
    <section aria-label="Waiting for your answer" className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-card p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <CalendarClock aria-hidden className="size-4" />
        Waiting for your answer
      </h2>
      <ul className="flex flex-col divide-y">
        {waiting.map((i) => (
          <li key={inviteKey(i)} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{i.details.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {eventWhen(i.details)} · from {i.organizer}
              </span>
              <OrganizerName invite={i} books={{ work, rail }} />
            </span>
            <Button size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={() => onOpen(inviteKey(i))}>
              Answer
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Everything for the calendar that isn't a shift: personal events, the ones this account organizes, and its invitations. */
export function useCalendarEvents(): CalendarEvent[] {
  const { events, calendar, mailbox, work } = useOpenBooks();
  return useMemo(
    () => [...events.map((e): CalendarEvent => ({ ...e, kind: "personal" })), ...sharedCalendarEvents(calendar, myAnswerIn({ mailbox, work }))],
    [events, calendar, mailbox, work],
  );
}
