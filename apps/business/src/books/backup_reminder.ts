// ---------------------------------------------------------------------------
// When to remind someone to save a backup. The books live only in this
// browser's storage, and a browser can lose it: Shield's own browser lost
// every site's storage in an app update on 2026-10-23, and with it the books
// of everyone who had no backup file. So the app asks for a backup right after
// setup, a week after the last one, after each pay run and when a month is
// closed (Joshua, 2026-10-26: each of those occasions).
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
  | { due: true; reason: "stale"; days: number }
  /** A pay run was posted since the last one. */
  | { due: true; reason: "pay_run" }
  /** A month was closed since the last one. */
  | { due: true; reason: "closed"; through: string };

export function backupDue(company: Partial<Pick<Company, "backedUpAt" | "books" | "payroll">>, now: Date = new Date()): BackupDue {
  if (!company.backedUpAt) return { due: true, reason: "never" };
  const since = Date.parse(company.backedUpAt);
  const closed = company.books?.events.filter((e) => e.kind === "closed" && Date.parse(e.at) > since).at(-1);
  if (closed && closed.kind === "closed") return { due: true, reason: "closed", through: closed.through };
  if (company.books && company.payroll) {
    const runEntries = new Set(company.payroll.runs.flatMap((r) => r.entryIds));
    if (company.books.entries.some((e) => runEntries.has(e.id) && Date.parse(e.postedAt) > since)) return { due: true, reason: "pay_run" };
  }
  const days = Math.floor((now.getTime() - since) / DAY_MS);
  return days >= BACKUP_EVERY_DAYS ? { due: true, reason: "stale", days } : { due: false };
}

/** What the reminder says for each reason. */
export function dueHeadline(due: Exclude<BackupDue, { due: false }>): string {
  switch (due.reason) {
    case "never":
      return "Save a backup of your books";
    case "stale":
      return `Your last backup is ${due.days} days old`;
    case "pay_run":
      return "You ran payroll since your last backup";
    case "closed":
      return `You closed ${due.through} since your last backup`;
  }
}

/** The books, noting that a backup was just saved. */
export const markBackedUp = <C extends Company>(company: C, at: string = new Date().toISOString()): C => ({ ...company, backedUpAt: at });
