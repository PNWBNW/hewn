// ---------------------------------------------------------------------------
// Saving the books when more than one tab or window has them open (2026-10-22,
// the security review): each tab remembers the record it last read or wrote,
// by its payload's IV (fresh on every write). A write first checks that the
// stored record is still that one and refuses if another tab wrote since,
// rather than overwrite it; checking and writing happen under one lock
// across the browser's tabs (Web Locks), so two tabs can't both pass the
// check. Without this, the second of two tabs paying one run would pay it
// again, and any two tabs would undo each other's work.
// ---------------------------------------------------------------------------

import type { VaultSession, VaultStore } from "@pnw/vault";

export const CHANGED_ELSEWHERE = "These books changed in another tab or window, so nothing was saved here. Reload this page to carry on.";

type Locks = { request<T>(name: string, callback: () => Promise<T>): Promise<T> };

const browserLocks = (): Locks | undefined => (typeof navigator !== "undefined" ? (navigator.locks as Locks | undefined) : undefined);

/**
 * Encrypts `json` and saves it over the stored record, if that record is still the one this tab
 * last saw (`lastIv`). Returns the new record's IV, to pass next time. Throws CHANGED_ELSEWHERE when
 * another tab wrote first; nothing is saved then.
 */
export async function saveOver(
  store: Pick<VaultStore, "load" | "save">,
  session: VaultSession,
  json: string,
  lastIv: string | null,
  locks: Locks | undefined = browserLocks(),
): Promise<string> {
  const write = async () => {
    const stored = await store.load(session.id);
    if (stored && lastIv && stored.payload.iv !== lastIv) throw new Error(CHANGED_ELSEWHERE);
    const record = await session.write(json);
    await store.save(record);
    return record.payload.iv;
  };
  return locks ? locks.request(`hewn-vault-${session.id}`, write) : write();
}
