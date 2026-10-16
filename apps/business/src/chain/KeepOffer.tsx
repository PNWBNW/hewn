"use client";

// ---------------------------------------------------------------------------
// Answering a request for changes by keeping the offer as it is: a note, sent
// through the mailbox sealed to the two of you. Nothing is signed and the
// offer on the chain doesn't change; the person can still accept it or ask
// again. Nothing here logs a key or a note.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { MAX_NOTE_CHARS, addToThread } from "@/books/thread";
import { postToThread } from "./thread";

export type KeepOfferProps = { workerId: string; workerName: string; partiesKey: string; agreementId: string; onClose: () => void };

export default function KeepOffer({ workerId, workerName, partiesKey, agreementId, onClose }: KeepOfferProps) {
  const { mailbox, updateCompany } = useOpenBooks();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const item = await postToThread({
        client: new MailboxClient(),
        partiesKey,
        from: "business",
        nextOut: threadFor(mailbox, partiesKey)?.nextOut ?? 0,
        body: { type: "stands", agreementId, note },
      });
      await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), partiesKey, workerId, (t) => addToThread(t, item)) }));
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
      <p className="text-sm">Keep the offer to {workerName} as it is. They can still accept it, or ask again.</p>
      <Field label="A note to them (optional)" hint="Why it stays as it is, or anything else they should know.">
        <textarea className={`${inputClass} h-auto min-h-20 py-2`} rows={3} maxLength={MAX_NOTE_CHARS} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : "Send"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
