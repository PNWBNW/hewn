"use client";

// ---------------------------------------------------------------------------
// Answering a published week (books/schedule.ts): confirm it, or ask for a
// change with a note saying what. One letter on chain to the business, sealed
// to the two of you: one Shield approval. Nothing here logs a key or a note.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { MAX_SCHEDULE_NOTE } from "@/books/schedule";
import { addToThread } from "@/books/thread";
import { updateWorkThread, workThread } from "@/books/work";
import { FeeChoice } from "../FeeChoice";
import { LetterBox } from "../letters";
import { postToThread } from "../thread";
import { ShieldGate, WorkShieldProvider, useWorkShield } from "./WorkShield";

export type AnswerScheduleProps = {
  partiesKey: string;
  employerAddress: string;
  employer: string;
  scheduleId: string;
  weekStart: string;
  answer: "confirmed" | "change";
  onClose: (sent: boolean) => void;
};

export default function AnswerSchedule(props: AnswerScheduleProps) {
  return (
    <WorkShieldProvider>
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
        <ShieldGate onClose={() => props.onClose(false)}>{() => <AnswerFlow {...props} />}</ShieldGate>
      </div>
    </WorkShieldProvider>
  );
}

function AnswerFlow({ partiesKey, employerAddress, employer, scheduleId, weekStart, answer, onClose }: AnswerScheduleProps) {
  const { work, updateWork } = useWork();
  const { wallet } = useWorkShield();
  const [note, setNote] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const asking = answer === "change";

  async function send() {
    if (asking && !note.trim()) {
      setError("Say what needs to change");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const item = await postToThread({
        client: new LetterBox({ wallet, to: employerAddress }),
        feeMode,
        partiesKey,
        from: "worker",
        nextOut: workThread(work, partiesKey)?.nextOut ?? 0,
        body: { type: "schedule_answer", scheduleId, weekStart, answer, note },
      });
      await updateWork((w) => updateWorkThread(w, partiesKey, (t) => addToThread(t, item)));
      onClose(true);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <p className="text-sm">{asking ? `Ask ${employer} to change this week.` : `Confirm this week with ${employer}.`}</p>
      <Field label={asking ? "What needs to change" : "A note (optional)"} hint={asking ? "Like: I can't do Thursday; could I swap to Friday?" : undefined}>
        <textarea className={`${inputClass} h-auto min-h-16 py-2`} rows={2} maxLength={MAX_SCHEDULE_NOTE} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground">It goes as a sealed letter on the network that only the two of you can open: one approval in Shield.</p>
      {busy ? <p className="text-sm text-muted-foreground">Approve it in Shield; it&apos;s on the network in about a minute.</p> : <FeeChoice value={feeMode} onChange={setFeeMode} />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : asking ? "Send" : "Confirm"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => onClose(false)}>
          Cancel
        </Button>
      </div>
    </>
  );
}
