"use client";

// ---------------------------------------------------------------------------
// The business's side of changing hours by agreement (books/hours_change.ts):
// question a shift it received (a note, and the times it thinks are right if
// it has them), or answer the person's request for a revision (accept, or
// decline with a note). One sealed letter to the person, one Shield
// approval. Nothing changes on the card until both sides have agreed.
// Nothing here logs a key, a time or a note.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { segmentsOf } from "@/books/hours";
import { MAX_CHANGE_NOTE, type Stretch, validateHoursAnswer, validateHoursChange } from "@/books/hours_change";
import { emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { linkFor, shortAddress } from "@/books/rail";
import { type ThreadBody, addToThread } from "@/books/thread";
import { FeeChoice } from "./FeeChoice";
import { ShieldStatus } from "./ShieldStatus";
import { useLetters } from "./letter_reader";
import { LetterBox } from "./letters";
import { pick, toLocalInput } from "./hours_inputs";
import { postToThread } from "./thread";

export type HoursChangeMode =
  | { kind: "question"; agreementId: string; shift: Stretch; timeZone: string }
  | { kind: "answer"; changeId: string; answer: "accepted" | "declined" };

export type HoursChangeProps = { workerId: string; workerName: string; partiesKey: string; mode: HoursChangeMode; onClose: (sent: boolean) => void };

export default function HoursChange(props: HoursChangeProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
        <Flow {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

function Flow({ workerId, workerName, partiesKey, mode, onClose }: HoursChangeProps) {
  const { rail, mailbox, updateCompany } = useOpenBooks();
  const { state, route, connect, error: shieldError, address, mismatch, letters, wallet } = useLetters();
  const [start, setStart] = useState(mode.kind === "question" ? toLocalInput(mode.shift.in) : "");
  const [end, setEnd] = useState(mode.kind === "question" ? toLocalInput(mode.shift.out) : "");
  const [withTimes, setWithTimes] = useState(true);
  const [note, setNote] = useState("");
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const to = rail ? linkFor(rail, workerId)?.address : undefined;

  if (!to) return <FormError message="This person isn't on your team any more." />;
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

  /** The letter's body, checked the way the person's app will check it. */
  function body(): ThreadBody {
    if (mode.kind === "answer") return validateHoursAnswer({ changeId: mode.changeId, answer: mode.answer, note });
    const raw: Record<string, unknown> = { agreementId: mode.agreementId, shift: mode.shift, note };
    if (withTimes) {
      const inAt = pick(start, mode.shift.in);
      const outAt = pick(end, mode.shift.out);
      if (Date.parse(outAt) <= Date.parse(inAt)) throw new Error("The shift has to end after it starts");
      if (inAt === mode.shift.in && outAt === mode.shift.out) throw new Error("Those are the times they sent; change them, or leave the times out and just ask");
      raw.proposed = { in: inAt, out: outAt, segments: segmentsOf(inAt, outAt, mode.timeZone) };
    }
    return validateHoursChange(raw);
  }

  async function send() {
    if (!to) return;
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
        client: new LetterBox({ wallet, to }),
        feeMode,
        partiesKey,
        from: "business",
        nextOut: threadFor(mailbox, partiesKey)?.nextOut ?? 0,
        ring: threadFor(mailbox, partiesKey)?.ring ?? null,
        body: b,
      });
      await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), partiesKey, workerId, (t) => addToThread(t, item)) }));
      onClose(true);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const declining = mode.kind === "answer" && mode.answer === "declined";
  return (
    <>
      <p className="text-sm">
        {mode.kind === "question"
          ? `Ask ${workerName} about this shift. Nothing changes until they agree.`
          : mode.answer === "accepted"
            ? `Accept ${workerName}'s revision: the shift changes on both sides to the times they asked for.`
            : `Keep the shift as it is, and tell ${workerName} why.`}
      </p>
      {mode.kind === "question" && (
        <>
          <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-8">
            <input type="checkbox" className="size-4 accent-[var(--hewn-green)]" checked={withTimes} onChange={(e) => setWithTimes(e.target.checked)} />
            Suggest the times you think are right
          </label>
          {withTimes && (
            <div className="flex flex-wrap gap-3">
              <Field label="Started">
                <input className={inputClass} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
              </Field>
              <Field label="Ended">
                <input className={inputClass} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
              </Field>
            </div>
          )}
        </>
      )}
      <Field
        label={mode.kind === "question" ? "What's wrong with the hours" : declining ? "Why it stays as it is" : "A note (optional)"}
        hint={mode.kind === "question" ? "Like: the gate log has you leaving at 4:30." : undefined}
      >
        <textarea className={`${inputClass} h-auto min-h-16 py-2`} rows={2} maxLength={MAX_CHANGE_NOTE} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {mode.kind === "question" && <p className="text-xs text-muted-foreground">Until they answer, this shift waits out of pay runs, unless you choose to pay it as sent.</p>}
      {busy ? (
        <p className="text-sm text-muted-foreground">Approve it in Shield; it&apos;s on the network in about a minute.</p>
      ) : (
        <FeeChoice value={feeMode} onChange={setFeeMode} />
      )}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : mode.kind === "question" ? "Send" : mode.answer === "accepted" ? "Accept" : "Keep it"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => onClose(false)}>
          Cancel
        </Button>
      </div>
    </>
  );
}
