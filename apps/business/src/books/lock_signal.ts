// ---------------------------------------------------------------------------
// Log out, the idle lock and the end of "stay logged in" close the books in
// every open tab of this app, not only the one they happened in. Each tab
// hears it on one BroadcastChannel (same origin only) and locks itself,
// whatever account it has open; a tab that locks because another told it to
// doesn't pass the word on again. Inside a tab, what a page kept in memory
// for the open books (a conversation's keys, say) is dropped by a listener
// registered here. No books data travels: the message is only {type: "lock"}.
// A browser without BroadcastChannel locks just the tab it is in.
// ---------------------------------------------------------------------------

import { BRAND } from "@/brand";

/** The channel every tab of this app listens on for a lock. */
export const LOCK_CHANNEL = `${BRAND.nameSuffix}:books-closed`;

type LockMessage = { type: "lock" };

const here = new Set<() => void>();
let channel: BroadcastChannel | null | undefined;

/** This tab's channel, made on first use; null where the browser has none. */
function lockChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(LOCK_CHANNEL) : null;
  } catch {
    channel = null;
  }
  // Node keeps a process running while a channel is open; a browser has no such call.
  (channel as { unref?: () => void } | null)?.unref?.();
  return channel;
}

/** Runs `fn` whenever the books close in this tab. Returns the way to stop. */
export function onBooksClosed(fn: () => void): () => void {
  here.add(fn);
  return () => {
    here.delete(fn);
  };
}

/**
 * The books closed in this tab: everything registered with `onBooksClosed` drops what it kept,
 * and, unless this tab is locking because another one said so, every other tab is told to lock.
 */
export function announceBooksClosed({ fromOtherTab = false }: { fromOtherTab?: boolean } = {}): void {
  for (const fn of [...here]) {
    try {
      fn();
    } catch {
      // One listener failing doesn't keep the others' memory.
    }
  }
  if (fromOtherTab) return;
  try {
    lockChannel()?.postMessage({ type: "lock" } satisfies LockMessage);
  } catch {
    // A closed or broken channel: this tab is locked all the same.
  }
}

/** Runs `fn` when another tab of this app closes its books. Returns the way to stop. */
export function listenForOtherTabs(fn: () => void): () => void {
  const ch = lockChannel();
  if (!ch) return () => {};
  const heard = (e: MessageEvent) => {
    if ((e.data as Partial<LockMessage> | null)?.type === "lock") fn();
  };
  ch.addEventListener("message", heard);
  return () => ch.removeEventListener("message", heard);
}
