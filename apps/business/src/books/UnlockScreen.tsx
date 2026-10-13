"use client";

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { AuthCard, Field, FormError, errorMessage, inputClass } from "./AuthCard";
import { useBooks } from "./BooksProvider";

export function UnlockScreen({ onRestore }: { onRestore: () => void }) {
  const { unlock } = useBooks();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AuthCard title="Unlock your books" subtitle="Enter the passphrase you chose when you set up these books.">
      <form
        className="flex flex-col gap-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await unlock(passphrase);
          } catch (err) {
            setError(errorMessage(err));
            setBusy(false);
          }
        }}
      >
        <Field label="Passphrase">
          <input
            className={inputClass}
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </Field>
        <FormError message={error} />
        <Button type="submit" className="h-11" disabled={busy || !passphrase}>
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
        <button type="button" onClick={onRestore} className="text-sm text-muted-foreground underline underline-offset-4">
          Restore from a backup file instead
        </button>
      </form>
    </AuthCard>
  );
}
