// The pieces of "Kept with your Shield account" (chain/ChainRestore.tsx) that need no screen.

import type { AccountRestoreReport } from "@/books/account_restore";
import type { ReadOwn } from "./books_backup";
import type { LetterRecord } from "./letters";

/** The backup's pieces are letters this account sent to itself: anything else under the same lookup is ignored. */
export function ownReader(getAll: (lookup: string) => Promise<LetterRecord[]>, address: string): ReadOwn {
  return async (lookup) => (await getAll(lookup)).find((r) => r.sender === address)?.envelope ?? null;
}

/** What to tell the person about a restore that didn't bring back everything; null when it did. */
export function restoreNotes(report: AccountRestoreReport): string[] {
  const notes: string[] = [];
  if (report.stopped) {
    notes.push(
      `Your books are back as of backup ${report.applied} of ${report.found}: the next one couldn't be used (${report.stopped.reason}). Anything after it needs entering again; back up once they're open.`,
    );
  }
  if (report.missingFiles > 0) {
    notes.push(
      `${report.missingFiles} receipt or bill ${report.missingFiles === 1 ? "file isn't" : "files aren't"} on this device. Files travel only in backup files: restore one of those to bring them back.`,
    );
  }
  return notes;
}
