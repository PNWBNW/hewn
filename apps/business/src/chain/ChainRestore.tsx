"use client";

// ---------------------------------------------------------------------------
// "Kept with your Shield account": the books back from the letters this
// account sent itself (docs/CHAIN_BACKUP.md, part 3; chain/books_backup.ts).
// For a browser that lost its storage, or a new device: connect the same
// Shield account, give the username and the passphrase (or the recovery key
// and a new passphrase), and the books are rebuilt into this device's vault.
//
// Only letters this account sent itself count. The pieces are opened inside
// the books' provider; nothing here logs a key, a lookup, an address or a letter.
// ---------------------------------------------------------------------------

import { useMemo, useRef, useState } from "react";
import { CloudDownload } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { Field, FormError, PassphraseInput, errorMessage, inputClass } from "@/books/AuthCard";
import { useBooks } from "@/books/BooksProvider";
import { NewPassphraseFields, newPassphraseReady } from "@/books/NewPassphrase";
import { shortAddress } from "@/books/rail";
import { restoreBackup } from "./books_backup";
import { ownReader, restoreNotes } from "./chain_restore";
import { LetterBox, type LetterWallet } from "./letters";
import { useShield } from "./shield";

type Props = { username?: string; replacing: boolean; onCancel: () => void };

export default function ChainRestore(props: Props) {
  return (
    <AleoWalletProviderWrapper>
      <Restore {...props} />
    </AleoWalletProviderWrapper>
  );
}

type Done = { notes: string[]; open: () => Promise<void> };

function Restore({ username: initialUsername = "", replacing, onCancel }: Props) {
  const { restoreFromAccount } = useBooks();
  const { state, connect, error: shieldError, wallet: shield } = useShield();
  const latest = useRef(shield);
  latest.current = shield;
  const wallet = useMemo<LetterWallet>(
    () => ({
      executeTransaction: (o) => latest.current.executeTransaction(o),
      transactionStatus: (id) => latest.current.transactionStatus(id),
      requestRecords: (program, plaintext) => latest.current.requestRecords(program, plaintext),
    }),
    [],
  );
  const address = state.kind === "connected" ? state.address : null;

  const [username, setUsername] = useState(initialUsername);
  const [passphrase, setPassphrase] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const name = username.trim().toLowerCase();
  const ready = address !== null && name !== "" && (recovering ? code.trim() !== "" && newPassphraseReady(next, confirm, name) : passphrase !== "");

  async function find() {
    if (!address || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const box = new LetterBox({ wallet });
      const read = ownReader((lookup) => box.getAll(lookup), address);
      const report = await restoreFromAccount(
        (normalized, openSlots) => restoreBackup({ read, username: normalized, address, openSlots }),
        username,
        recovering ? { code, next } : { passphrase },
      );
      if (!report) {
        setError(`No backup kept with ${shortAddress(address)} for that username. Check the username, and that Shield is on the account you backed up with.`);
        setBusy(false);
        return;
      }
      const notes = restoreNotes(report);
      if (notes.length === 0) {
        await report.open();
        return;
      }
      setDone({ notes, open: report.open });
      setBusy(false);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-money-positive">Your books are back on this device.</p>
        {done.notes.map((n) => (
          <p key={n} className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {n}
          </p>
        ))}
        <FormError message={error} />
        <Button
          className="h-11"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await done.open();
            } catch (e) {
              setError(errorMessage(e));
              setBusy(false);
            }
          }}
        >
          Open your books
        </Button>
      </div>
    );
  }

  let shieldPart;
  if (state.kind === "missing") {
    shieldPart = <p className="rounded-md border bg-muted px-3 py-2 text-sm">Open this page in the Shield app, or with the Shield extension, to find your books.</p>;
  } else if (!address) {
    shieldPart = (
      <Button type="button" variant="outline" className="h-11" disabled={state.kind === "connecting"} onClick={connect}>
        {state.kind === "connecting" ? "Connecting…" : "Connect Shield"}
      </Button>
    );
  } else {
    shieldPart = <p className="text-sm text-muted-foreground">Looking with {shortAddress(address)}. If that isn't the account you backed up with, switch accounts in Shield.</p>;
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void find();
      }}
    >
      {shieldPart}
      <FormError message={shieldError} />
      <Field label="Username" hint="The username of the account you backed up (its email, if it was made with one).">
        <input
          className={inputClass}
          type="text"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={254}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </Field>
      {recovering ? (
        <>
          <Field label="Recovery key" hint="The one made for this account before it was backed up.">
            <input
              className={`${inputClass} font-mono text-sm uppercase`}
              type="text"
              name="recovery-key"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={40}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <NewPassphraseFields username={name} passphrase={next} onPassphrase={setNext} confirm={confirm} onConfirm={setConfirm} />
        </>
      ) : (
        <Field label="Passphrase">
          <PassphraseInput value={passphrase} onChange={setPassphrase} />
        </Field>
      )}
      <button
        type="button"
        className="-mt-2 inline-flex min-h-11 items-center self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        onClick={() => {
          setRecovering((r) => !r);
          setError(null);
        }}
      >
        {recovering ? "Use the passphrase instead" : "Forgot the passphrase? Use your recovery key"}
      </button>
      {replacing && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          If this account already has books on this device, restoring replaces them. Save a backup of them first if you might need them.
        </p>
      )}
      <FormError message={error} />
      <div className="flex gap-3">
        <Button type="button" variant="outline" className="h-11 flex-1" onClick={onCancel} disabled={busy}>
          Back
        </Button>
        <Button type="submit" className="h-11 flex-1" disabled={busy || !ready}>
          <CloudDownload aria-hidden className="size-4" />
          {busy ? "Looking…" : "Find my books"}
        </Button>
      </div>
    </form>
  );
}
