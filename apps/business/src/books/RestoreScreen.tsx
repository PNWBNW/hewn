"use client";

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { AuthCard, Field, FormError, errorMessage, inputClass } from "./AuthCard";
import { useBooks } from "./BooksProvider";

export function RestoreScreen({ onCancel, replacing }: { onCancel: () => void; replacing: boolean }) {
  const { restore } = useBooks();
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AuthCard
      title="Restore from a backup"
      subtitle="Open a backup file you downloaded from PNW Ledger, on this or another device."
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            await restore(await file.text(), passphrase);
          } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Backup file">
          <input
            type="file"
            accept=".pnwbooks,application/json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border-0 file:bg-secondary file:px-4 file:text-sm file:font-medium"
          />
        </Field>
        <Field label="Passphrase for that backup">
          <input
            className={inputClass}
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        {replacing && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            Restoring replaces the books currently saved on this device. Download a backup of them first if you
            might need them.
          </p>
        )}
        <FormError message={error} />
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="h-11 flex-1" onClick={onCancel} disabled={busy}>
            Back
          </Button>
          <Button type="submit" className="h-11 flex-1" disabled={busy || !file || !passphrase}>
            {busy ? "Checking…" : "Restore"}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
