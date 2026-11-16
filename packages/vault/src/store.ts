// ---------------------------------------------------------------------------
// Where sealed records live. Only ciphertext ever reaches storage.
// IndexedDB in the browser; an in-memory store for tests and previews.
//
// Attachments are kept in their own object store, one sealed blob each, so
// saving the books never rewrites them.
//
// "Stay logged in" keeps one remembered session per device, in two rows: the
// vault id, the open data key as the browser's own non-extractable CryptoKey
// (it can be used to decrypt, never read out or copied) and when it expires;
// and, in a row of its own with no key in it, the last time the session was
// used. The key's row is written once, when the session is remembered, and
// only deleted after that: the time moves without the key being read out or
// written back, so a write of the time can't bring back a session that a
// Log out deleted meanwhile. Only vault.ts writes or reads either row
// (remember / resumeSession / noteSeen / forgetSession).
//
// Database versions:
//   1  vaults
//   2  + attachments (keyed "<vault id>/<attachment id>", indexed by vault)
//   3  + session (the remembered session's row, "current"; since 2026-11-14 its
//        last-used time in a second row, "seen")
// ---------------------------------------------------------------------------

import type { SealedAttachment, VaultRecord } from "./vault";

/**
 * A session kept for "stay logged in": the open data key (non-extractable) and its expiry.
 * `seenAt` is the latest time this device used it; it only moves forward, so a clock set back
 * to before it doesn't reopen the books (resumeSession). Sessions kept before 2026-11-11 have
 * none, and aren't reopened.
 */
export type RememberedSession = { vaultId: string; key: CryptoKey; expiresAt: string; seenAt?: string };

/** The later of two times a session was used; one that isn't a time counts as none. */
function laterSeen(a: unknown, b: unknown): string | undefined {
  const times = [a, b].filter((t): t is string => typeof t === "string" && Number.isFinite(Date.parse(t)));
  return times.sort((x, y) => Date.parse(y) - Date.parse(x))[0];
}

export interface VaultStore {
  load(id: string): Promise<VaultRecord | null>;
  save(record: VaultRecord): Promise<void>;
  /** Removes the record and every attachment that belongs to it. */
  remove(id: string): Promise<void>;
  loadAttachment(vaultId: string, attachmentId: string): Promise<SealedAttachment | null>;
  saveAttachment(vaultId: string, sealed: SealedAttachment): Promise<void>;
  removeAttachment(vaultId: string, attachmentId: string): Promise<void>;
  listAttachments(vaultId: string): Promise<SealedAttachment[]>;
  /** Replaces a vault's record and all of its attachments in one step (restoring a backup). */
  replace(record: VaultRecord, attachments: SealedAttachment[]): Promise<void>;
  /** The one remembered session on this device, if any, with the last time it was used. Use resumeSession, not this. */
  loadRemembered(): Promise<RememberedSession | null>;
  /** Keeps a session: its key and expiry in one row, its last-used time in another. The only call that writes a key. */
  saveRemembered(remembered: RememberedSession): Promise<void>;
  /**
   * Moves the remembered session's last-used time forward to `seenAt`. The key is neither read out
   * nor written. Does nothing when no session is kept (one deleted meanwhile stays deleted) or the
   * time kept is already later. Resolves whether a session is kept.
   */
  markRememberedSeen(seenAt: string): Promise<boolean>;
  /** Deletes the remembered session, its last-used time with it. */
  clearRemembered(): Promise<void>;
}

export class MemoryStore implements VaultStore {
  #records = new Map<string, VaultRecord>();
  #attachments = new Map<string, Map<string, SealedAttachment>>();
  #remembered: Omit<RememberedSession, "seenAt"> | null = null;
  #seenAt: string | undefined;

  async loadRemembered(): Promise<RememberedSession | null> {
    if (!this.#remembered) return null;
    return { ...this.#remembered, ...(this.#seenAt === undefined ? {} : { seenAt: this.#seenAt }) };
  }
  async saveRemembered({ seenAt, ...kept }: RememberedSession) {
    this.#remembered = kept;
    this.#seenAt = seenAt;
  }
  async markRememberedSeen(seenAt: string) {
    if (!this.#remembered) return false;
    this.#seenAt = laterSeen(this.#seenAt, seenAt);
    return true;
  }
  async clearRemembered() {
    this.#remembered = null;
    this.#seenAt = undefined;
  }

  #of(vaultId: string) {
    let m = this.#attachments.get(vaultId);
    if (!m) this.#attachments.set(vaultId, (m = new Map()));
    return m;
  }

  async load(id: string) {
    return this.#records.get(id) ?? null;
  }
  async save(record: VaultRecord) {
    this.#records.set(record.id, structuredClone(record));
  }
  async remove(id: string) {
    this.#records.delete(id);
    this.#attachments.delete(id);
  }
  async loadAttachment(vaultId: string, attachmentId: string) {
    const a = this.#of(vaultId).get(attachmentId);
    return a ? structuredClone(a) : null;
  }
  async saveAttachment(vaultId: string, sealed: SealedAttachment) {
    this.#of(vaultId).set(sealed.id, structuredClone(sealed));
  }
  async removeAttachment(vaultId: string, attachmentId: string) {
    this.#of(vaultId).delete(attachmentId);
  }
  async listAttachments(vaultId: string) {
    return [...this.#of(vaultId).values()].map((a) => structuredClone(a));
  }
  async replace(record: VaultRecord, attachments: SealedAttachment[]) {
    this.#records.set(record.id, structuredClone(record));
    this.#attachments.set(record.id, new Map(attachments.map((a) => [a.id, structuredClone(a)])));
  }
}

export const DB_NAME = "pnw_ledger";
export const DB_VERSION = 3;
const VAULTS = "vaults";
const ATTACHMENTS = "attachments";
const SESSION = "session";
const SLOT = "current";
const SEEN_SLOT = "seen";
const BY_VAULT = "by_vault";

type StoredAttachment = SealedAttachment & { key: string; vaultId: string };
/** The key's row. Releases from 2026-11-11 to 2026-11-14 kept the last-used time in it; nothing writes it there now. */
type StoredSession = { slot: typeof SLOT; vaultId: string; key: CryptoKey; expiresAt: string; seenAt?: unknown };
type StoredSeen = { slot: typeof SEEN_SLOT; seenAt?: unknown };

const keyOf = (vaultId: string, attachmentId: string) => `${vaultId}/${attachmentId}`;
const toStored = (vaultId: string, a: SealedAttachment): StoredAttachment => ({ ...a, key: keyOf(vaultId, a.id), vaultId });
const fromStored = ({ id, iv, data }: StoredAttachment): SealedAttachment => ({ id, iv, data });

export class IndexedDbStore implements VaultStore {
  #db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = globalThis.indexedDB) {}

  #open(): Promise<IDBDatabase> {
    this.#db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        // Each step runs once, in order, from whatever version this device had.
        const db = req.result;
        const from = event.oldVersion;
        if (from < 1 && !db.objectStoreNames.contains(VAULTS)) db.createObjectStore(VAULTS, { keyPath: "id" });
        if (from < 2 && !db.objectStoreNames.contains(ATTACHMENTS)) {
          db.createObjectStore(ATTACHMENTS, { keyPath: "key" }).createIndex(BY_VAULT, "vaultId");
        }
        if (from < 3 && !db.objectStoreNames.contains(SESSION)) db.createObjectStore(SESSION, { keyPath: "slot" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.#db;
  }

  /** Runs `op` in one transaction over `stores`; resolves with its result once committed. */
  async #tx<T>(stores: string[], mode: IDBTransactionMode, op: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const req = op(tx);
      tx.oncomplete = () => resolve((req ? req.result : undefined) as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /** Deletes every attachment of `vaultId` inside an open transaction. */
  #clearAttachments(tx: IDBTransaction, vaultId: string): void {
    const cursor = tx.objectStore(ATTACHMENTS).index(BY_VAULT).openKeyCursor(IDBKeyRange.only(vaultId));
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      tx.objectStore(ATTACHMENTS).delete(c.primaryKey);
      c.continue();
    };
  }

  async load(id: string): Promise<VaultRecord | null> {
    return ((await this.#tx([VAULTS], "readonly", (tx) => tx.objectStore(VAULTS).get(id))) as VaultRecord | undefined) ?? null;
  }

  async save(record: VaultRecord): Promise<void> {
    await this.#tx([VAULTS], "readwrite", (tx) => tx.objectStore(VAULTS).put(record));
  }

  async remove(id: string): Promise<void> {
    await this.#tx([VAULTS, ATTACHMENTS], "readwrite", (tx) => {
      tx.objectStore(VAULTS).delete(id);
      this.#clearAttachments(tx, id);
    });
  }

  async loadAttachment(vaultId: string, attachmentId: string): Promise<SealedAttachment | null> {
    const found = (await this.#tx([ATTACHMENTS], "readonly", (tx) => tx.objectStore(ATTACHMENTS).get(keyOf(vaultId, attachmentId)))) as
      | StoredAttachment
      | undefined;
    return found ? fromStored(found) : null;
  }

  async saveAttachment(vaultId: string, sealed: SealedAttachment): Promise<void> {
    await this.#tx([ATTACHMENTS], "readwrite", (tx) => tx.objectStore(ATTACHMENTS).put(toStored(vaultId, sealed)));
  }

  async removeAttachment(vaultId: string, attachmentId: string): Promise<void> {
    await this.#tx([ATTACHMENTS], "readwrite", (tx) => tx.objectStore(ATTACHMENTS).delete(keyOf(vaultId, attachmentId)));
  }

  async listAttachments(vaultId: string): Promise<SealedAttachment[]> {
    const all = (await this.#tx([ATTACHMENTS], "readonly", (tx) =>
      tx.objectStore(ATTACHMENTS).index(BY_VAULT).getAll(IDBKeyRange.only(vaultId)),
    )) as StoredAttachment[];
    return all.map(fromStored);
  }

  async replace(record: VaultRecord, attachments: SealedAttachment[]): Promise<void> {
    await this.#tx([VAULTS, ATTACHMENTS], "readwrite", (tx) => {
      tx.objectStore(VAULTS).put(record);
      // Attachments not in the backup go; the backup's are written. A kept key is only ever overwritten.
      const store = tx.objectStore(ATTACHMENTS);
      const keep = new Set(attachments.map((a) => keyOf(record.id, a.id)));
      const cursor = store.index(BY_VAULT).openKeyCursor(IDBKeyRange.only(record.id));
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        if (!keep.has(String(c.primaryKey))) store.delete(c.primaryKey);
        c.continue();
      };
      for (const a of attachments) store.put(toStored(record.id, a));
    });
  }

  async loadRemembered(): Promise<RememberedSession | null> {
    // Both rows in one transaction, so the time read belongs to the session read.
    const rows: { seen?: IDBRequest<StoredSeen | undefined> } = {};
    const found = (await this.#tx([SESSION], "readonly", (tx) => {
      rows.seen = tx.objectStore(SESSION).get(SEEN_SLOT);
      return tx.objectStore(SESSION).get(SLOT);
    })) as StoredSession | undefined;
    if (!found) return null;
    const seenAt = laterSeen(found.seenAt, rows.seen?.result?.seenAt);
    return { vaultId: found.vaultId, key: found.key, expiresAt: found.expiresAt, ...(seenAt === undefined ? {} : { seenAt }) };
  }

  async saveRemembered({ seenAt, ...kept }: RememberedSession): Promise<void> {
    await this.#tx([SESSION], "readwrite", (tx) => {
      const rows = tx.objectStore(SESSION);
      rows.put({ slot: SLOT, ...kept } satisfies StoredSession);
      if (seenAt === undefined) rows.delete(SEEN_SLOT);
      else rows.put({ slot: SEEN_SLOT, seenAt } satisfies StoredSeen);
    });
  }

  async markRememberedSeen(seenAt: string): Promise<boolean> {
    // One transaction: whether a session is kept, and the time written only if one is. The key's
    // row is looked for by its key (the slot's name), so the CryptoKey in it is never read out.
    let kept = false;
    await this.#tx([SESSION], "readwrite", (tx) => {
      const rows = tx.objectStore(SESSION);
      const session = rows.getKey(SLOT);
      session.onsuccess = () => {
        if (session.result === undefined) return;
        kept = true;
        const was = rows.get(SEEN_SLOT) as IDBRequest<StoredSeen | undefined>;
        was.onsuccess = () => {
          if (laterSeen(was.result?.seenAt, seenAt) === seenAt) rows.put({ slot: SEEN_SLOT, seenAt } satisfies StoredSeen);
        };
      };
    });
    return kept;
  }

  async clearRemembered(): Promise<void> {
    await this.#tx([SESSION], "readwrite", (tx) => {
      tx.objectStore(SESSION).delete(SLOT);
      tx.objectStore(SESSION).delete(SEEN_SLOT);
    });
  }
}
