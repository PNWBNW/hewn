// The pieces of "Kept with your Shield account" (chain/ChainRestore.tsx) that need no screen.

import type { AccountRestoreReport } from "@/books/account_restore";
import type { ReadOwn } from "./books_backup";
import type { LetterRecord } from "./letters";
import type { ShieldState } from "./shield";
import type { ShieldRoute } from "./shield_route";

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

/** How long "Looking…" may run over the relay before the screen says to open Shield. */
export const AWAY_HINT_MS = 3_000;

/**
 * Whether to show the "Open Shield" line: a read over the relay has waited `AWAY_HINT_MS`.
 * Keyed on time, not on the adapter's presence, which can lag behind the app; injected Shield
 * is always there, so the line never shows for it.
 */
export function awayHint(input: { route: ShieldRoute; busy: boolean; waited: boolean }): boolean {
  return input.route === "relay" && input.busy && input.waited;
}

/** How long "Connecting…" may run over the relay before the screen offers to start the pairing over. */
export const CONNECT_HINT_MS = 10_000;

/**
 * Whether "Find my books" connects afresh before it searches. Over the relay with Shield asleep, a
 * read waits unseen (Shield answers only while open, and a remembered pairing reconnects without
 * asking it anything); a fresh connect makes the adapter open Shield with the request in its link,
 * Shield asks for an approval and then says "Return to your browser" itself, and the search goes
 * out while it is still up. With Shield awake, or injected, the search goes straight out.
 */
export function mustReconnect(route: ShieldRoute, away: boolean): boolean {
  return route === "relay" && away;
}

/** How long a fresh connect may take to start before the search gives up and says so. */
export const RESTART_CAP_MS = 15_000;

/** Where a search that waits on a fresh connect stands: restarting (the old pairing going), connecting, or none. */
export type FindChain = "idle" | "restarting" | "connecting";

/**
 * The next step of a search waiting on a fresh connect, from the connection's state: search once
 * the connect lands, stop when it ends without one (declined in Shield, failed). "Ready" while
 * restarting is the old pairing going, not an end.
 */
export function stepFindChain(chain: FindChain, shield: ShieldState["kind"]): { chain: FindChain; then: "find" | "stop" | null } {
  if (chain === "restarting" && shield === "connecting") return { chain: "connecting", then: null };
  if (chain === "connecting" && shield === "connected") return { chain: "idle", then: "find" };
  if (chain === "connecting" && (shield === "ready" || shield === "missing")) return { chain: "idle", then: "stop" };
  return { chain, then: null };
}
