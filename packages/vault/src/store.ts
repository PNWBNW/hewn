// ---------------------------------------------------------------------------
// Where sealed records live. Only ciphertext ever reaches storage.
// IndexedDB in the browser; an in-memory store for tests and previews.
// ---------------------------------------------------------------------------

import type { VaultRecord } from "./vault";

export interface VaultStore {
  load(id: string): Promise<VaultRecord | null>;
  save(record: VaultRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryStore implements VaultStore {
  #records = new Map<string, VaultRecord>();
  async load(id: string) {
    return this.#records.get(id) ?? null;
  }
  async save(record: VaultRecord) {
    this.#records.set(record.id, structuredClone(record));
  }
  async remove(id: string) {
    this.#records.delete(id);
  }
}

const DB_NAME = "pnw_ledger";
const STORE = "vaults";

export class IndexedDbStore implements VaultStore {
  #db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = globalThis.indexedDB) {}

  #open(): Promise<IDBDatabase> {
    this.#db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.#db;
  }

  async #run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async load(id: string): Promise<VaultRecord | null> {
    return ((await this.#run("readonly", (s) => s.get(id))) as VaultRecord | undefined) ?? null;
  }

  async save(record: VaultRecord): Promise<void> {
    await this.#run("readwrite", (s) => s.put(record));
  }

  async remove(id: string): Promise<void> {
    await this.#run("readwrite", (s) => s.delete(id));
  }
}
