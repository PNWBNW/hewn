"use client";

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { parseBackup } from "@pnw/vault";
import { AuthCard, Field, FormError, PassphraseInput, errorMessage, inputClass } from "./AuthCard";
import { BRAND } from "@/brand";
import { LEGACY_VAULT_ID } from "./account";
import { useBooks } from "./BooksProvider";

export function RestoreScreen({ onCancel, replacing }: { onCancel: () => void; replacing: boolean }) {
  const { restore } = useBooks();
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

  const ready = text !== null && passphrase !== "" && (legacy || username.trim() !== "");

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
            await restore(text, legacy ? null : username, passphrase);
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
        <Field label="Passphrase for that backup">
          <PassphraseInput value={passphrase} onChange={setPassphrase} />
        </Field>
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
