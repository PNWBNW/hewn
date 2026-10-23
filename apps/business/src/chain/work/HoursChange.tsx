"use client";

// ---------------------------------------------------------------------------
// The person's side of changing hours by agreement (books/hours_change.ts):
// "Ask for a revision" of a shift not sent yet (the times they'd like and a
// note), or answer the employer's question about a shift (agree, and the
// shift moves to the times they suggested; or keep it as sent, with a note).
// One sealed letter to the employer, one Shield approval. Nothing here logs
// a key, a time or a note.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { segmentsOf } from "@/books/hours";
import { MAX_CHANGE_NOTE, type Stretch, validateHoursAnswer, validateHoursChange } from "@/books/hours_change";
import { type ThreadBody, addToThread } from "@/books/thread";
import { updateWorkThread, workThread } from "@/books/work";
import { FeeChoice } from "../FeeChoice";
import { pick, toLocalInput } from "../hours_inputs";
import { LetterBox } from "../letters";
import { postToThread } from "../thread";
import { ShieldGate, WorkShieldProvider, useWorkShield } from "./WorkShield";

export type WorkHoursChangeMode =
  | { kind: "ask"; agreementId: string; shift: Stretch; timeZone: string }
  | { kind: "answer"; changeId: string; answer: "accepted" | "declined"; proposed?: Stretch };

export type WorkHoursChangeProps = { partiesKey: string; employerAddress: string; employer: string; mode: WorkHoursChangeMode; onClose: (sent: boolean) => void };

export default function WorkHoursChange(props: WorkHoursChangeProps) {
  return (
    <WorkShieldProvider>
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
        <ShieldGate onClose={() => props.onClose(false)}>{() => <Flow {...props} />}</ShieldGate>
      </div>
    </WorkShieldProvider>
  );
}

function Flow({ partiesKey, employerAddress, employer, mode, onClose }: WorkHoursChangeProps) {
  const { work, updateWork } = useWork();
  const { wallet } = useWorkShield();
  const [start, setStart] = useState(mode.kind === "ask" ? toLocalInput(mode.shift.in) : "");
  const [end, setEnd] = useState(mode.kind === "ask" ? toLocalInput(mode.shift.out) : "");
  const [note, setNote] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The letter's body, checked the way the employer's app will check it. */
  function body(): ThreadBody {
    if (mode.kind === "answer") return validateHoursAnswer({ changeId: mode.changeId, answer: mode.answer, note });
    const inAt = pick(start, mode.shift.in);
    const outAt = pick(end, mode.shift.out);
    if (Date.parse(outAt) <= Date.parse(inAt)) throw new Error("The shift has to end after it starts");
    if (inAt === mode.shift.in && outAt === mode.shift.out) throw new Error("Change the times to what they should be");
    return validateHoursChange({ agreementId: mode.agreementId, shift: mode.shift, proposed: { in: inAt, out: outAt, segments: segmentsOf(inAt, outAt, mode.timeZone) }, note });
  }

  async function send() {
    setError(null);
    let b: ThreadBody;
    try {
      b = body();
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    setBusy(true);
    try {
      const item = await postToThread({
        client: new LetterBox({ wallet, to: employerAddress }),
        feeMode,
        partiesKey,
        from: "worker",
        nextOut: workThread(work, partiesKey)?.nextOut ?? 0,
        ring: workThread(work, partiesKey)?.ring ?? null,
        body: b,
      });
      // Agreeing applies the change here as the thread takes the answer (books/work.ts applyAgreedHours).
      await updateWork((w) => updateWorkThread(w, partiesKey, (t) => addToThread(t, item)));
      onClose(true);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const keeping = mode.kind === "answer" && mode.answer === "declined";
  return (
    <>
      <p className="text-sm">
        {mode.kind === "ask"
          ? `Ask ${employer} to change this shift. You can still send your week while you wait; once it's on a sent week you can't ask any more.`
          : mode.answer === "accepted"
            ? mode.proposed
              ? `Agree with ${employer}: the shift changes to the times they suggested, on both sides.`
              : `Agree with ${employer} about this shift.`
            : `Keep the shift as you sent it, and tell ${employer} why.`}
      </p>
      {mode.kind === "ask" && (
        <div className="flex flex-wrap gap-3">
          <Field label="Started">
            <input className={inputClass} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="Ended">
            <input className={inputClass} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </Field>
        </div>
      )}
      <Field
        label={mode.kind === "ask" ? "What happened" : keeping ? "Why it's right as sent" : "A note (optional)"}
        hint={mode.kind === "ask" ? "Like: I forgot to clock out; I left at 5:00." : undefined}
      >
        <textarea className={`${inputClass} h-auto min-h-16 py-2`} rows={2} maxLength={MAX_CHANGE_NOTE} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <p className="text-xs text-muted-foreground">It goes as a sealed letter on the network that only the two of you can open: one approval in Shield.</p>
      {busy ? <p className="text-sm text-muted-foreground">Approve it in Shield; it&apos;s on the network in about a minute.</p> : <FeeChoice value={feeMode} onChange={setFeeMode} />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : mode.kind === "ask" ? "Send" : mode.answer === "accepted" ? "Agree" : "Keep as sent"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => onClose(false)}>
          Cancel
        </Button>
      </div>
    </>
  );
}
