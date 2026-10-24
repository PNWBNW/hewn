"use client";

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { parseBackup } from "@pnw/vault";
import { AuthCard, Field, FormError, PassphraseInput, errorMessage, inputClass } from "./AuthCard";
import { BRAND } from "@/brand";
import { LEGACY_VAULT_ID } from "./account";
import { useBooks } from "./BooksProvider";
import { NewPassphraseFields, newPassphraseReady } from "./NewPassphrase";

export function RestoreScreen({ onCancel, replacing }: { onCancel: () => void; replacing: boolean }) {
  const { restore, restoreWithRecovery } = useBooks();
  // Forgot the backup's passphrase: the recovery key sets a new one as it restores.
  const [recovering, setRecovering] = useState(false);
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [username, setUsername] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | null) {
    setError(null);
    setText(null);
    setLegacy(false);
    if (!file) return;
    try {
      const contents = await file.text();
      // A backup made before accounts needs only the passphrase; the file says which kind it is.
      setLegacy(parseBackup(contents).record.id === LEGACY_VAULT_ID);
      setText(contents);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const withKey = recovering && !legacy;
  const ready =
    text !== null &&
    (withKey ? username.trim() !== "" && code.trim() !== "" && newPassphraseReady(next, confirm, username.trim().toLowerCase()) : passphrase !== "" && (legacy || username.trim() !== ""));

  return (
    <AuthCard
      title="Restore from a backup"
      subtitle={`Open a backup file you downloaded from ${BRAND.name}, on this or another device.`}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (text === null || !ready) return;
          setBusy(true);
          setError(null);
          try {
            if (withKey) await restoreWithRecovery(text, username, code, next);
            else await restore(text, legacy ? null : username, passphrase);
          } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Backup file">
          <input
            type="file"
            accept={`.${BRAND.backupExtension},application/json`}
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border-0 file:bg-secondary file:px-4 file:text-sm file:font-medium"
          />
        </Field>
        {legacy ? (
          <p className="rounded-md border bg-muted px-3 py-2 text-sm">
            This backup was made before accounts, so it opens with the passphrase alone.
          </p>
        ) : (
          <Field label="Username" hint="The username of the account this backup belongs to (its email, if it was made with one).">
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
        )}
        {withKey ? (
          <>
            <Field label="Recovery key" hint="The one made for this account before the backup was downloaded.">
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
            <NewPassphraseFields username={username.trim().toLowerCase()} passphrase={next} onPassphrase={setNext} confirm={confirm} onConfirm={setConfirm} />
          </>
        ) : (
          <Field label="Passphrase for that backup">
            <PassphraseInput value={passphrase} onChange={setPassphrase} />
          </Field>
        )}
        {!legacy && (
          <button
            type="button"
            className="-mt-2 inline-flex min-h-11 items-center self-start text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            onClick={() => {
              setRecovering((r) => !r);
              setError(null);
            }}
          >
            {recovering ? "Use the passphrase instead" : "Forgot that passphrase? Use your recovery key"}
          </button>
        )}
        {replacing && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            If this account already has books on this device, restoring replaces them. Download a backup of them
            first if you might need them.
          </p>
        )}
        <FormError message={error} />
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={onCancel} disabled={busy}>
            Back
          </Button>
          <Button type="submit" className="h-11 flex-1" disabled={busy || !ready}>
            {busy ? "Checking…" : "Restore"}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
