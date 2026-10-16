"use client";

// ---------------------------------------------------------------------------
// Asking for changes to an offer (Joshua, 2026-10-16): the person edits a copy
// of the terms, sees exactly what they're asking to change, adds a note, and
// sends it through the mailbox, sealed to the two of them. Nothing is signed:
// the offer on the chain stays as it is until the business answers by keeping
// it or sending a revised one. Nothing here logs a key or a term.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { Button } from "@pnw/ui/button";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { ChangeList } from "@/books/NegotiationView";
import { ProposalEditor, type ProposalDraft, draftOf, proposalFromDraft } from "@/books/ProposalEditor";
import { MAX_NOTE_CHARS, addToThread, proposalChanges, proposalOf } from "@/books/thread";
import { type Terms, updateWorkThread, workThread } from "@/books/work";
import { postToThread } from "../thread";

export type CounterOfferProps = { agreementId: string; partiesKey: string; terms: Terms; employer: string; onClose: (sent: boolean) => void };

export default function CounterOffer({ agreementId, partiesKey, terms, employer, onClose }: CounterOfferProps) {
  const { work, updateWork } = useWork();
  const original = useMemo(() => proposalOf({ ...terms, ...(terms.version === 2 ? { letter: terms.letter } : {}) }), [terms]);
  const [draft, setDraft] = useState<ProposalDraft>(() => draftOf(original));
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = proposalFromDraft(draft);
  const changes = "proposal" in parsed ? proposalChanges(original, parsed.proposal) : [];

  async function send() {
    if (!("proposal" in parsed)) return;
    setBusy(true);
    setError(null);
    try {
      const item = await postToThread({
        client: new MailboxClient(),
        partiesKey,
        from: "worker",
        nextOut: workThread(work, partiesKey)?.nextOut ?? 0,
        body: { type: "counter", agreementId, proposal: parsed.proposal, note },
      });
      await updateWork((w) => updateWorkThread(w, partiesKey, (t) => addToThread(t, item)));
      onClose(true);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (reviewing && "proposal" in parsed) {
    return (
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
        <h4 className="text-sm font-semibold">What you&apos;re asking {employer} to change</h4>
        <ChangeList changes={changes} wantsLabel="You'd like" />
        {note.trim() && <p className="whitespace-pre-wrap text-xs">Your note: {note}</p>}
        <p className="text-xs text-muted-foreground">
          It goes to their mailbox, sealed to the two of you. Nothing is signed: they can keep the offer as it is or send you a revised one to accept.
        </p>
        <FormError message={error} />
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void send()}>
            {busy ? "Sending…" : "Send to " + employer}
          </Button>
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => setReviewing(false)}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
      <h4 className="text-sm font-semibold">Ask for changes</h4>
      <p className="text-xs text-muted-foreground">Change what you&apos;d like to see in the offer. They&apos;ll see exactly what you changed.</p>
      <ProposalEditor value={draft} onChange={setDraft} />
      <Field label="A note to them (optional)" hint={`Up to ${MAX_NOTE_CHARS.toLocaleString("en-US")} characters.`}>
        <textarea className={`${inputClass} h-auto min-h-20 py-2`} rows={3} maxLength={MAX_NOTE_CHARS} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <FormError message={"problem" in parsed ? parsed.problem : null} />
      {"proposal" in parsed && changes.length === 0 && !note.trim() && <p className="text-xs text-muted-foreground">Change something, or write a note, to send.</p>}
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={"problem" in parsed || (changes.length === 0 && !note.trim())} onClick={() => setReviewing(true)}>
          Review
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => onClose(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
