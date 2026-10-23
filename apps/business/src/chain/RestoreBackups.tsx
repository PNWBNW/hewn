"use client";

// ---------------------------------------------------------------------------
// Restoring conversations from their backups on chain (chain/conversation_backup.ts),
// on a device whose books don't have them: Shield finds this account's letters
// to itself, the username and passphrase open the ones that are backups, and
// each brings back its conversation up to the point both sides agreed, into
// the same thread. A conversation these books don't know yet (its agreement
// not imported) is counted, not guessed at. Nothing here logs a passphrase,
// a key or a message.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Archive } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage, inputClass } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { emptyMailbox, updateThread } from "@/books/mailbox";
import { type ThreadItem, addToThread } from "@/books/thread";
import { updateWorkThread } from "@/books/work";
import { readBackups, restoreHistory } from "./conversation_backup";
import { useLetters } from "./letter_reader";
import { letterReader } from "./letters";

export default function RestoreBackups() {
  return (
    <AleoWalletProviderWrapper>
      <RestoreView />
    </AleoWalletProviderWrapper>
  );
}

function RestoreView() {
  const { role, work, rail, backupKey, updateCompany } = useOpenBooks();
  const { letters, address, connect, state } = useLetters();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    if (!letters || !address) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // Not checked against these books: the passphrase that sealed a backup may be an older one.
      const key = await backupKey(passphrase, address, false);
      const backups = await readBackups({ read: letterReader(letters, address).get, key });
      if (backups.length === 0) {
        setResult("No backups opened with that passphrase. Use the one you had when each backup was made.");
        return;
      }
      let messages = 0;
      let conversations = 0;
      let unknown = 0;
      for (const backup of backups) {
        const workerId = role === "worker" ? null : rail?.links.find((l) => l.partiesKey === backup.partiesKey)?.workerId;
        const known = role === "worker" ? work?.agreements.some((a) => a.partiesKey === backup.partiesKey) : !!workerId;
        if (!known) {
          unknown++;
          continue;
        }
        const items: ThreadItem[] = [];
        messages += await restoreHistory({
          backup,
          theirs: letterReader(letters, backup.peer).get,
          mine: (lookup) => letters.getSent(lookup),
          store: async (item) => void items.push(item),
        });
        // One save for the whole conversation; each message is kept once, however many backups hold it.
        await updateCompany((c) => {
          if (role === "worker") return { ...c, work: updateWorkThread(c.work!, backup.partiesKey, (t) => items.reduce(addToThread, t)) };
          return { ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), backup.partiesKey, workerId!, (t) => items.reduce(addToThread, t)) };
        });
        conversations++;
      }
      setPassphrase("");
      setResult(
        `Brought back ${messages} ${messages === 1 ? "message" : "messages"} from ${conversations} ${conversations === 1 ? "backup" : "backups"}.` +
          (unknown > 0 ? ` ${unknown} ${unknown === 1 ? "is" : "are"} for a conversation these books don't have yet: import the agreement first, then restore again.` : ""),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-xs text-muted-foreground">
        Backups you and the other side agreed to are letters to your own account. On a new device, your passphrase opens them and brings each conversation back,
        up to the point you both agreed.
      </p>
      {!letters ? (
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" disabled={state.kind === "connecting"} onClick={connect}>
          Connect Shield
        </Button>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void restore();
          }}
        >
          <label className="text-xs font-medium" htmlFor="restore-passphrase">
            Your passphrase
          </label>
          <input id="restore-passphrase" type="password" autoComplete="current-password" className={inputClass} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          <Button type="submit" className="min-h-11 self-start sm:min-h-9" disabled={busy || !passphrase}>
            <Archive aria-hidden /> {busy ? "Restoring…" : "Restore"}
          </Button>
        </form>
      )}
      {result && (
        <p className="text-xs" role="status">
          {result}
        </p>
      )}
      <FormError message={error} />
    </div>
  );
}
