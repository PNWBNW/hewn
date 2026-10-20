"use client";

// ---------------------------------------------------------------------------
// Publishing one person's week (books/schedule.ts): the shift blocks and the
// on-call days, with an optional note, sent as a letter on chain sealed to
// the two of you (one Shield approval). They confirm it or ask for a change
// from their Schedule page. Nothing here logs a key, a time or a note.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { linkFor, shortAddress } from "@/books/rail";
import { MAX_SCHEDULE_NOTE, type ScheduleWeek, onCallDays, weekShiftMinutes } from "@/books/schedule";
import { formatMinutes } from "@/books/hours";
import { addToThread } from "@/books/thread";
import { FeeChoice } from "./FeeChoice";
import { ShieldStatus } from "./ShieldStatus";
import { useLetters } from "./letter_reader";
import { LetterBox } from "./letters";
import { postToThread } from "./thread";

export type PublishScheduleProps = { workerId: string; workerName: string; week: ScheduleWeek; onClose: (sent: boolean) => void };

export default function PublishSchedule(props: PublishScheduleProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
        <PublishFlow {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

function PublishFlow({ workerId, workerName, week, onClose }: PublishScheduleProps) {
  const { rail, mailbox, updateCompany } = useOpenBooks();
  const { state, route, connect, error: shieldError, address, mismatch, letters, wallet } = useLetters();
  const [note, setNote] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = rail ? linkFor(rail, workerId) : undefined;

  if (!link || link.status !== "linked" || !link.partiesKey) return <FormError message={`${workerName} has to accept an offer before a schedule can reach them.`} />;
  const partiesKey = link.partiesKey;
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
  if (!letters) {
    return (
      <>
        <ShieldStatus state={state} route={route} connect={connect} onClose={() => onClose(false)} />
        {shieldError && <p className="text-sm text-destructive">{shieldError}</p>}
      </>
    );
  }

  async function send() {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      const item = await postToThread({
        client: new LetterBox({ wallet, to: link.address }),
        feeMode,
        partiesKey,
        from: "business",
        nextOut: threadFor(mailbox, partiesKey)?.nextOut ?? 0,
        body: { type: "schedule", week, note },
      });
      await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), partiesKey, workerId, (t) => addToThread(t, item)) }));
      onClose(true);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const days = onCallDays(week);
  return (
    <>
      <p className="text-sm">
        Send {workerName} their week: {formatMinutes(weekShiftMinutes(week))} of shifts{days > 0 ? `, on call ${days === 1 ? "1 day" : `${days} days`}` : ""}. They confirm it
        or ask for a change.
      </p>
      <Field label="A note to them (optional)">
        <textarea className={`${inputClass} h-auto min-h-16 py-2`} rows={2} maxLength={MAX_SCHEDULE_NOTE} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground">It goes as a sealed letter on the network that only the two of you can open: one approval in Shield.</p>
      {busy ? <p className="text-sm text-muted-foreground">Approve it in Shield; it&apos;s on the network in about a minute.</p> : <FeeChoice value={feeMode} onChange={setFeeMode} />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : "Publish"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => onClose(false)}>
          Cancel
        </Button>
      </div>
    </>
  );
}
