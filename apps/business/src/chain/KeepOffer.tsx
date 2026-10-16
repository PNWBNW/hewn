"use client";

// ---------------------------------------------------------------------------
// Answering a request for changes by keeping the offer as it is: a note, sent
// as a letter on chain sealed to the two of you (one Shield approval). The
// offer on the chain doesn't change; the person can still accept it or ask
// again. Nothing here logs a key or a note.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { Field, FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { linkFor, shortAddress } from "@/books/rail";
import { MAX_NOTE_CHARS, addToThread } from "@/books/thread";
import { FeeChoice } from "./FeeChoice";
import { ShieldStatus } from "./ShieldStatus";
import { useLetters } from "./letter_reader";
import { LetterBox } from "./letters";
import { postToThread } from "./thread";

export type KeepOfferProps = { workerId: string; workerName: string; partiesKey: string; agreementId: string; onClose: () => void };

export default function KeepOffer(props: KeepOfferProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
        <KeepFlow {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

function KeepFlow({ workerId, workerName, partiesKey, agreementId, onClose }: KeepOfferProps) {
  const { rail, mailbox, updateCompany } = useOpenBooks();
  const { state, connect, error: shieldError, address, mismatch, letters, wallet } = useLetters();
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
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Close
        </Button>
      </>
    );
  }
  if (!letters) {
    return (
      <>
        <ShieldStatus state={state} connect={connect} onClose={onClose} />
        {shieldError && <p className="text-sm text-destructive">{shieldError}</p>}
      </>
    );
  }

  async function send() {
    if (!to) return;
    setBusy(true);
    setError(null);
    try {
      const item = await postToThread({
        client: new LetterBox({ wallet, to }),
        feeMode,
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
    <>
      <p className="text-sm">Keep the offer to {workerName} as it is. They can still accept it, or ask again.</p>
      <Field label="A note to them (optional)" hint="Why it stays as it is, or anything else they should know.">
        <textarea className={`${inputClass} h-auto min-h-20 py-2`} rows={3} maxLength={MAX_NOTE_CHARS} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {busy ? (
        <p className="text-sm text-muted-foreground">Approve it in Shield; it&apos;s on the network in about a minute.</p>
      ) : (
        <FeeChoice value={feeMode} onChange={setFeeMode} />
      )}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : "Send"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </>
  );
}
