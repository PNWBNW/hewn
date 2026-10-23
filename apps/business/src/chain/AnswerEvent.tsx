"use client";

// ---------------------------------------------------------------------------
// Answering an invitation (books/shared_events.ts): going, maybe or not going,
// with an optional note, as one letter in this account's own conversation with
// the organizer, sealed to the two of them: one Shield approval. Nothing here
// logs a key or a note.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { shortAddress } from "@/books/rail";
import { ANSWER_LABEL, inviteKey } from "@/books/shared_events";
import { type EventAnswer, MAX_EVENT_ANSWER_NOTE } from "@/books/thread";
import { useEventReach } from "./event_reach";
import { FeeChoice } from "./FeeChoice";
import { ShieldStatus } from "./ShieldStatus";
import { useLetters } from "./letter_reader";
import { postToThread } from "./thread";

export type AnswerEventProps = { invite: string; answer: EventAnswer; onClose: (sent: boolean) => void };

export default function AnswerEvent(props: AnswerEventProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
        <AnswerFlow {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

function AnswerFlow({ invite: key, answer, onClose }: AnswerEventProps) {
  const { calendar } = useOpenBooks();
  const { state, route, connect, error: shieldError, address, mismatch, letters, wallet } = useLetters();
  const { addressOf, reachFor } = useEventReach(wallet);
  const [note, setNote] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invite = calendar?.invites.find((i) => inviteKey(i) === key);
  if (!invite) return <FormError message="That invitation isn't in these books any more." />;
  const to = addressOf(invite.from);
  if (!to) return <FormError message={`There's no way to write to ${invite.organizer} from here any more.`} />;
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

  async function send() {
    if (!invite || !to) return;
    setBusy(true);
    setError(null);
    try {
      const reach = await reachFor(invite.from, invite.organizer, to);
      const item = await postToThread({
        client: reach.client,
        feeMode,
        partiesKey: reach.conversationKey,
        from: reach.from,
        ...(reach.kinds ? { kinds: reach.kinds } : {}),
        nextOut: reach.nextOut,
        ...(reach.ring !== undefined ? { ring: reach.ring } : {}),
        body: { type: "event_answer", eventId: invite.eventId, rev: invite.rev, title: invite.details.title, answer, note },
      });
      await reach.keep(item);
      onClose(true);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <p className="text-sm">
        Tell {invite.organizer}: <span className="font-medium">{ANSWER_LABEL[answer]}</span>.
      </p>
      <Field label="A note (optional)">
        <textarea className={`${inputClass} h-auto min-h-16 py-2`} rows={2} maxLength={MAX_EVENT_ANSWER_NOTE} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground">It goes as a sealed letter on the network that only the two of you can open: one approval in Shield.</p>
      {busy ? <p className="text-sm text-muted-foreground">Approve it in Shield; it&apos;s on the network in about a minute.</p> : <FeeChoice value={feeMode} onChange={setFeeMode} />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : "Send"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => onClose(false)}>
          Cancel
        </Button>
      </div>
    </>
  );
}
