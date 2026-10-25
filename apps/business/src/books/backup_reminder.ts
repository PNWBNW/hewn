// ---------------------------------------------------------------------------
// When to remind someone to save a backup. The books live only in this
// browser's storage, and a browser can lose it: Shield's own browser lost
// every site's storage in an app update on 2026-10-23, and with it the books
// of everyone who had no backup file. So the app asks for a backup right after
// setup and again a week after the last one.
//
// The time of the last backup is kept in the vault (Company.backedUpAt), never
// in plain browser storage, and travels with the books.
//
// Pure: no React, no storage.
// ---------------------------------------------------------------------------

import type { Company } from "./company";

/** How long a backup counts as recent. */
export const BACKUP_EVERY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BackupDue =
  /** A backup was saved within the week. */
  | { due: false }
  /** No backup was ever saved from these books. */
  | { due: true; reason: "never" }
  /** The last one is older than a week. */
  | { due: true; reason: "stale"; days: number };

export function backupDue(company: Pick<Company, "backedUpAt">, now: Date = new Date()): BackupDue {
  if (!company.backedUpAt) return { due: true, reason: "never" };
  const days = Math.floor((now.getTime() - Date.parse(company.backedUpAt)) / DAY_MS);
  return days >= BACKUP_EVERY_DAYS ? { due: true, reason: "stale", days } : { due: false };
}

/** The books, noting that a backup was just saved. */
export const markBackedUp = <C extends Company>(company: C, at: string = new Date().toISOString()): C => ({ ...company, backedUpAt: at });
