"use client";

// ---------------------------------------------------------------------------
// Sending an event to its guests (books/shared_events.ts), from either side:
//
//   1. The calendar's key, to each guest who hasn't it yet: one letter each,
//      in the conversation the two already share. Once per guest.
//   2. The event: one post (more for a long guest list) sealed with that key,
//      to every guest at once and to anyone just taken off the list, one
//      Shield approval for each eight.
//
// With nothing new to send, it reaches only the guests who still haven't the
// key (an earlier send couldn't give it to them). Nothing here logs a key, a
// name or an account.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { threadOfContact } from "@/books/event_contacts";
import { shortAddress } from "@/books/rail";
import {
  type Guest,
  type HostedEvent,
  type SharedCalendar,
  answersFor,
  contactRef,
  emptyCalendar,
  ensureCircle,
  eventWho,
  gaveKey,
  markSent,
  needsSend,
  postGuests,
  putHosted,
  recipientsOf,
  usedSlot,
} from "@/books/shared_events";
import { useEventReach } from "./event_reach";
import { eventParts, postEvent, sendEventKeys } from "./events";
import { FeeChoice } from "./FeeChoice";
import { ShieldStatus } from "./ShieldStatus";
import { useLetters } from "./letter_reader";
import { MANY, ManyLetterBox } from "./letters";

export type SendEventProps = { eventId: string; onClose: (sent: boolean) => void };

export default function SendEvent(props: SendEventProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
        <SendFlow {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

/** Who still needs the calendar's key, and who a send goes to. */
function plan(event: HostedEvent, holds: (g: Guest) => boolean): { keys: Guest[]; to: Guest[]; fresh: boolean } {
  const fresh = needsSend(event);
  const missing = event.guests.filter((g) => !holds(g));
  return { keys: event.cancelled ? [] : missing, to: fresh ? recipientsOf(event) : missing, fresh };
}

function SendFlow({ eventId, onClose }: SendEventProps) {
  const { role, rail, books, mailbox, work, calendar, updateCompany } = useOpenBooks();
  const { state, route, connect, error: shieldError, address, mismatch, letters, wallet } = useLetters();
  const { conversationKey, reachFor } = useEventReach(wallet);
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const event = calendar?.hosted.find((e) => e.id === eventId);
  if (!event) return <FormError message="That event isn't in these books any more." />;
  const circle = calendar?.circles[event.scope];
  const holds = (g: Guest) => !!circle && gaveKey(threadOfContact(g.contact, { mailbox, work }), circle);
  const { keys, to, fresh } = plan(event, holds);
  const approvals = Math.ceil(Math.max(1, to.length) / MANY);

  if (mismatch && address) {
    return (
      <>
        <p className="text-sm">
          Shield is signed in to a different account ({shortAddress(address)}) than the one linked to these books. Switch accounts in Shield, then try again.
        </p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => onClose(false)}>
          Close
        </Button>
      </>
    );
  }
  if (!letters || !address) {
    return (
      <>
        <ShieldStatus state={state} route={route} connect={connect} onClose={() => onClose(false)} />
        {shieldError && <p className="text-sm text-destructive">{shieldError}</p>}
      </>
    );
  }
  if (to.length === 0) return <p className="text-sm text-muted-foreground">Everyone has the latest; there&apos;s nothing to send.</p>;

  const save = async (change: (c: SharedCalendar) => SharedCalendar) => (await updateCompany((c) => ({ ...c, calendar: change(c.calendar ?? emptyCalendar()) }))).calendar!;
  const organizer = (role === "worker" ? work?.identities?.[event.scope]?.name || work?.displayName : rail?.businessName ?? books.settings.businessName) || "Someone you work with";

  async function send() {
    if (!event || !address) return;
    setError(null);
    try {
      // 1. The calendar's key, made the first time, to each guest who hasn't it.
      let cal = await save((c) => ensureCircle(c, event.scope).calendar);
      let circle = cal.circles[event.scope]!;
      const failed = new Set<string>();
      if (keys.length > 0) {
        setStage(`Giving ${keys.length === 1 ? keys[0]!.name : `${keys.length} guests`} your calendar's key: approve one letter each in Shield…`);
        const reaches = await Promise.all(keys.map(async (g) => ({ ...(await reachFor(g.contact, g.name, g.address)), ref: contactRef(g.contact) })));
        const out = await sendEventKeys(reaches, circle, feeMode);
        for (const f of out.failed) failed.add(f.ref);
      }
      const recipients = to.filter((g) => !failed.has(contactRef(g.contact)));
      if (recipients.length === 0) throw new Error("Nobody could be given your calendar's key, so the event can't reach anyone yet. Try again.");

      // 2. The event, in as many parts as the guest list needs, to everyone at once.
      const tags = new Map<string, string>();
      for (const g of event.guests) tags.set(contactRef(g.contact), eventWho(await conversationKey(g.contact)));
      const answers = answersFor(event, (c) => threadOfContact(c, { mailbox, work }));
      const head = { organizer: organizer.slice(0, 60), details: event.details, ...(event.cancelled ? { cancelled: true as const } : {}) };
      const parts = await eventParts({ eventId: event.id, rev: event.rev, since: event.since, head }, postGuests(event, (g) => tags.get(contactRef(g.contact))!, answers));
      const box = new ManyLetterBox({ wallet, to: recipients.map((g) => g.address), self: address });
      for (const part of parts) {
        setStage(parts.length > 1 ? `Sending part ${part.part + 1} of ${parts.length}: approve it in Shield…` : "Sending the event: approve it in Shield…");
        const seq = await postEvent(box, circle, part, feeMode);
        cal = await save((c) => usedSlot(c, event.scope, seq));
        circle = cal.circles[event.scope]!;
      }
      if (fresh) await save((c) => putHosted(c, markSent(c.hosted.find((h) => h.id === event.id) ?? event)));
      if (failed.size > 0) {
        const names = keys.filter((g) => failed.has(contactRef(g.contact))).map((g) => g.name);
        setError(`Sent. Couldn't give ${names.join(", ")} your calendar's key; open the event and send again to reach them.`);
        setStage(null);
        return;
      }
      onClose(true);
    } catch (e) {
      setError(errorMessage(e));
      setStage(null);
    }
  }

  const what = event.cancelled ? "the cancellation" : !fresh ? "the event" : event.sent ? "the changes" : "the invitations";
  return (
    <>
      <p className="text-sm">
        Send {what} to {to.length === 1 ? to[0]!.name : `${to.length} people`}.{" "}
        {!fresh && "They didn't have your calendar's key when it last went out."}
      </p>
      <p className="text-xs text-muted-foreground">
        {keys.length > 0 && `First, ${keys.length} ${keys.length === 1 ? "letter gives" : "letters give"} your calendar's key (one Shield approval each, once per person). `}
        The event itself is about {approvals} {approvals === 1 ? "approval" : "approvals"} (one for each eight people), sealed so only the guests can read it.
      </p>
      {stage ? <p className="text-sm text-muted-foreground">{stage}</p> : <FeeChoice value={feeMode} onChange={setFeeMode} />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={stage !== null} onClick={() => void send()}>
          {stage ? "Sending…" : "Send"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={stage !== null} onClick={() => onClose(false)}>
          {error?.startsWith("Sent") ? "Done" : "Cancel"}
        </Button>
      </div>
    </>
  );
}
