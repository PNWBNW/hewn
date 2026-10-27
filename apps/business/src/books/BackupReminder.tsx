"use client";

// ---------------------------------------------------------------------------
// Keeping a backup (books/backup_reminder.ts): a reminder at the top of the
// Dashboard and the worker's Home when none was ever saved or the last is a
// week old, and a Backups card in Settings with the last backup's date and
// whether this browser has agreed to keep the books (@pnw/vault persistence).
// The books live only in this browser, so a backup file is the way back if
// it loses them.
//
// A backup saved through the share sheet counts at once. A plain download
// counts only once the person says the file saved: a page can't see whether a
// download landed, and an app's own browser can drop it without a word
// (Shield's did, 2026-10-26).
// ---------------------------------------------------------------------------

import { drawingStep } from "./drawing_step";
import { type ReactNode, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { type Persistence, persistence } from "@pnw/vault";
import { FormError, errorMessage } from "./AuthCard";
import { useOpenBooks } from "./BooksProvider";
import { backupDue, dueHeadline } from "./backup_reminder";

function useSaveBackup() {
  const { downloadBackup, confirmBackupSaved } = useOpenBooks();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** After a download: waiting for the person to say whether the file saved, or told it didn't. */
  const [asking, setAsking] = useState<"saved?" | "not_saved" | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    setAsking(null);
    try {
      if ((await downloadBackup()) === "downloaded") setAsking("saved?");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function answer(saved: boolean) {
    if (!saved) return setAsking("not_saved");
    setBusy(true);
    try {
      await confirmBackupSaved();
      setAsking(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return { save, answer, asking, busy, error };
}

/** The question after a download, and what to do when the file didn't save. */
function DidItSave({ asking, busy, answer }: { asking: "saved?" | "not_saved" | null; busy: boolean; answer: (saved: boolean) => Promise<void> }) {
  if (asking === "saved?") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
        <p className="text-sm">Did the file save? Check your downloads or files for it.</p>
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void answer(true)}>
            Yes, it saved
          </Button>
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void answer(false)}>
            No, I can&apos;t find it
          </Button>
        </div>
      </div>
    );
  }
  if (asking === "not_saved") {
    return (
      <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
        This browser didn&apos;t save it, so your books still have no backup. An app&apos;s own browser often can&apos;t save files. A backup
        kept with your account, which works here, is above: use that instead.
      </p>
    );
  }
  return null;
}

/**
 * The reminder: shown only when a backup is due (books/backup_reminder.ts). `account` is the backup
 * kept with the account (chain/ChainBackup, passed in by the page so these books import nothing of
 * the chain); it comes first, since it works where a file can't.
 */
export function BackupReminder({ account }: { account?: ReactNode }) {
  const { backedUpAt, books, payroll } = useOpenBooks();
  drawingStep("the backup reminder");
  const { save, answer, asking, busy, error } = useSaveBackup();
  const due = backupDue({ backedUpAt: backedUpAt ?? undefined, books, payroll });
  if (!due.due) return null;
  return (
    <section aria-label="Backup" className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <p className="text-sm font-medium">{dueHeadline(due)}</p>
      <p className="text-xs text-muted-foreground">
        Your books live only in this browser. If it loses them (an app update can), a backup is the only way back.
      </p>
      {account}
      <FormError message={error} />
      <Button variant={account ? "outline" : "default"} className="min-h-11 self-start sm:min-h-9" disabled={busy} onClick={() => void save()}>
        <Download aria-hidden className="size-4" />
        {busy ? "Saving…" : "Save a backup file"}
      </Button>
      <DidItSave asking={asking} busy={busy} answer={answer} />
    </section>
  );
}

const KEEPS: Record<Persistence, string> = {
  persistent: "This browser has agreed to keep your books until you clear them.",
  best_effort: "This browser may clear your books to free space, or lose them in an update. Keep a recent backup.",
  unsupported: "This browser can't say whether it keeps your books, and an app's own browser can lose them in an update. Keep a recent backup.",
};

/** Settings: the last backup, whether this browser keeps the books, and the ways to save one (`account`: as for the reminder). */
export function BackupCard({ account }: { account?: ReactNode }) {
  const { backedUpAt } = useOpenBooks();
  const { save, answer, asking, busy, error } = useSaveBackup();
  const [keeps, setKeeps] = useState<Persistence | null>(null);
  useEffect(() => {
    let live = true;
    void persistence().then((p) => live && setKeeps(p));
    return () => {
      live = false;
    };
  }, []);
  return (
    <Card id="backups" className="scroll-mt-20">
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
        {account}
        <FormError message={error} />
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" disabled={busy} onClick={() => void save()}>
          <Download aria-hidden className="size-4" />
          {busy ? "Saving…" : "Save a backup file"}
        </Button>
        <DidItSave asking={asking} busy={busy} answer={answer} />
      </CardContent>
    </Card>
  );
}
