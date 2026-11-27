// What this page is waiting on Shield, on a phone, to approve (the `pair` route: a computer without
// the extension, paired over the relay with the code from ShieldPairing.tsx).
//
// On a phone the adapter opens Shield for each approval; on a computer nothing can, so the page
// says plainly "open Shield on your phone to approve" while one is waiting. Every send and
// signature goes through useShield() (shield.ts), which marks it here; the note in ShieldPairing
// reads it. A count, not a list: nothing about the request is kept, only that one is waiting.

type Listener = () => void;

let waiting = 0;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** How many approvals are waiting on the phone right now. */
export function approvalsWaiting(): number {
  return waiting;
}

/** For useSyncExternalStore: called whenever the count changes. */
export function subscribeApprovals(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Marks `work` as waiting on an approval on the phone until it settles, whichever way. Returns what
 * `work` returns, or throws what it throws, unchanged.
 */
export async function awaitingPhone<T>(work: () => Promise<T>): Promise<T> {
  waiting += 1;
  notify();
  try {
    return await work();
  } finally {
    waiting -= 1;
    notify();
  }
}
