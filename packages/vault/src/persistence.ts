// ---------------------------------------------------------------------------
// Asking the browser to keep the vault. By default a site's storage is "best
// effort": when the device runs short of space, the browser may clear it
// without asking. A persistent grant (`navigator.storage.persist()`) keeps it
// until the person clears it themselves.
//
// What this can't do: stop an app that embeds a browser (Shield's, say) from
// wiping its own browser's data on an update, which is how books were lost on
// 2026-10-23. Many embedded browsers don't grant persistence at all. So the
// answer is shown to the person (Settings) and backups stay the real safety net.
//
// Nothing is stored or sent: the browser keeps the grant itself.
// ---------------------------------------------------------------------------

/** The part of `navigator.storage` this needs; injectable for tests. */
export type StorageManagerLike = { persisted?: () => Promise<boolean>; persist?: () => Promise<boolean> };

/** Whether this browser keeps the vault: granted, not granted (it may be cleared), or it can't say. */
export type Persistence = "persistent" | "best_effort" | "unsupported";

const browserStorage = (): StorageManagerLike | undefined =>
  (globalThis as { navigator?: { storage?: StorageManagerLike } }).navigator?.storage;

/** What this browser has granted, without asking for anything. */
export async function persistence(storage: StorageManagerLike | undefined = browserStorage()): Promise<Persistence> {
  if (!storage?.persisted) return "unsupported";
  try {
    return (await storage.persisted()) ? "persistent" : "best_effort";
  } catch {
    return "unsupported";
  }
}

/**
 * Asks for a persistent grant once storage isn't already persistent. Quiet in most browsers (they
 * decide by how the site is used); never throws.
 */
export async function requestPersistence(storage: StorageManagerLike | undefined = browserStorage()): Promise<Persistence> {
  const now = await persistence(storage);
  if (now !== "best_effort" || !storage?.persist) return now;
  try {
    return (await storage.persist()) ? "persistent" : "best_effort";
  } catch {
    return "best_effort";
  }
}
