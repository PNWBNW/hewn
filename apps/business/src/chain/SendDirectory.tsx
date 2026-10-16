"use client";

// ---------------------------------------------------------------------------
// Passing on the coworker directory (books/directory.ts), from the Messages
// page: when who has opted in changed since the list last went out, the new
// list (names, public keys and accounts) goes to each person in it, and an
// empty one to anyone who left. Each copy is a letter in that person's own
// conversation (thread.ts), so Shield asks once per person; the business
// sends it when it chooses, never in the background.
// Nothing here logs a key, a name or an account.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { directoryOutbox } from "@/books/directory";
import { emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { addToThread } from "@/books/thread";
import { FeeChoice } from "./FeeChoice";
import { ShieldStatus } from "./ShieldStatus";
import { useLetters } from "./letter_reader";
import { LetterBox } from "./letters";
import { postToThread } from "./thread";

export default function SendDirectory({ onClose }: { onClose: () => void }) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
        <SendFlow onClose={onClose} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

function SendFlow({ onClose }: { onClose: () => void }) {
  const { rail, mailbox, updateCompany } = useOpenBooks();
  const { state, connect, error: shieldError, letters, wallet, mismatch } = useLetters();
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copies } = directoryOutbox(rail, mailbox);

  if (mismatch) return <p className="text-sm">Shield is on a different account than these books. Switch accounts in Shield, then try again.</p>;
  if (!letters) {
    return (
      <>
        <ShieldStatus state={state} connect={connect} onClose={onClose} />
        {shieldError && <p className="text-sm text-destructive">{shieldError}</p>}
      </>
    );
  }
  if (copies.length === 0) {
    return (
      <>
        <p className="text-sm">Everyone has the latest coworker list.</p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Done
        </Button>
      </>
    );
  }

  async function send() {
    setError(null);
    let failed = 0;
    // The list as it stands at the start; a change while sending goes out next time.
    const latest = await updateCompany((c) => c);
    const { digest, copies: todo } = directoryOutbox(latest.rail, latest.mailbox);
    let box = latest.mailbox ?? emptyMailbox();
    for (const [i, copy] of todo.entries()) {
      setProgress(`Approve ${i + 1} of ${todo.length} in Shield…`);
      try {
        const item = await postToThread({
          client: new LetterBox({ wallet, to: copy.address }),
          feeMode,
          partiesKey: copy.partiesKey,
          from: "business",
          nextOut: threadFor(box, copy.partiesKey)?.nextOut ?? 0,
          body: { type: "directory", entries: copy.entries },
        });
        box = updateThread(box, copy.partiesKey, copy.workerId, (t) => addToThread(t, item));
        await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), copy.partiesKey, copy.workerId, (t) => addToThread(t, item)) }));
      } catch (e) {
        failed++;
        setError(errorMessage(e));
      }
    }
    if (failed === 0) await updateCompany((c) => ({ ...c, mailbox: { ...(c.mailbox ?? emptyMailbox()), directorySent: digest } }));
    setProgress(null);
    if (failed === 0) onClose();
  }

  const busy = progress !== null;
  return (
    <>
      <p className="text-sm">
        Who has opted into the coworker directory changed. Send the new list to {copies.length} {copies.length === 1 ? "person" : "people"}: their names, keys
        and accounts, so they can message each other. Shield asks once per person.
      </p>
      {busy ? <p className="text-sm text-muted-foreground">{progress}</p> : <FeeChoice value={feeMode} onChange={setFeeMode} />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : "Send the list"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          Not now
        </Button>
      </div>
    </>
  );
}
