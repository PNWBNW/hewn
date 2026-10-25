"use client";

// ---------------------------------------------------------------------------
// Keeping a backup (books/backup_reminder.ts): a reminder at the top of the
// Dashboard and the worker's Home when none was ever saved or the last is a
// week old, and a Backups card in Settings with the last backup's date and
// whether this browser has agreed to keep the books (@pnw/vault persistence).
// The books live only in this browser, so a backup file is the way back if
// it loses them.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { type Persistence, persistence } from "@pnw/vault";
import { FormError, errorMessage } from "./AuthCard";
import { useOpenBooks } from "./BooksProvider";
import { backupDue } from "./backup_reminder";

function useSaveBackup() {
  const { downloadBackup } = useOpenBooks();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await downloadBackup();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return { save, busy, error };
}

/** The reminder: shown only when a backup is due. */
export function BackupReminder() {
  const { backedUpAt } = useOpenBooks();
  const { save, busy, error } = useSaveBackup();
  const due = backupDue({ backedUpAt: backedUpAt ?? undefined });
  if (!due.due) return null;
  return (
    <section aria-label="Backup" className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <p className="text-sm font-medium">{due.reason === "never" ? "Save a backup of your books" : `Your last backup is ${due.days} days old`}</p>
      <p className="text-xs text-muted-foreground">
        Your books live only in this browser. If it loses them (an app update can), a backup file is the only way back. Keep it somewhere other
        than this phone or computer, like your files or an email to yourself.
      </p>
      <FormError message={error} />
      <Button className="min-h-11 self-start sm:min-h-9" disabled={busy} onClick={() => void save()}>
        <Download aria-hidden className="size-4" />
        {busy ? "Saving…" : "Save a backup"}
      </Button>
    </section>
  );
}

const KEEPS: Record<Persistence, string> = {
  persistent: "This browser has agreed to keep your books until you clear them.",
  best_effort: "This browser may clear your books to free space, or lose them in an update. Keep a recent backup.",
  unsupported: "This browser can't say whether it keeps your books, and an app's own browser can lose them in an update. Keep a recent backup.",
};

/** Settings: the last backup, whether this browser keeps the books, and a button to save one. */
export function BackupCard() {
  const { backedUpAt } = useOpenBooks();
  const { save, busy, error } = useSaveBackup();
  const [keeps, setKeeps] = useState<Persistence | null>(null);
  useEffect(() => {
    let live = true;
    void persistence().then((p) => live && setKeeps(p));
    return () => {
      live = false;
    };
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Backups</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p>
          {backedUpAt
            ? `Last backup: ${new Date(backedUpAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.`
            : "No backup saved from these books yet."}
        </p>
        {keeps && <p className="text-xs text-muted-foreground">{KEEPS[keeps]}</p>}
        <FormError message={error} />
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" disabled={busy} onClick={() => void save()}>
          <Download aria-hidden className="size-4" />
          {busy ? "Saving…" : "Save a backup"}
        </Button>
      </CardContent>
    </Card>
  );
}
