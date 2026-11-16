import { describe, expect, it } from "vitest";
import { MemoryStore, createVault, unlockVault } from "@pnw/vault";
import { CHANGED_ELSEWHERE, replaceOver, saveOver } from "./vault_write";

const PASS = "copper lantern meadow orbit thistle";

/** A tab: its own session on the stored books, and the IV of what it last read or wrote. */
async function openTab(store: MemoryStore, id: string) {
  const session = await unlockVault((await store.load(id))!, PASS);
  return { session, last: session.record.payload.iv as string | null };
}

describe("two tabs on the same books", () => {
  it("lets the first write through and refuses the stale one, until that tab reloads", async () => {
    const store = new MemoryStore();
    const first = await createVault(PASS, '{"n":0}');
    await store.save(first.record);
    const a = await openTab(store, first.id);
    const b = await openTab(store, first.id);

    a.last = await saveOver(store, a.session, '{"n":1}', a.last, undefined);
    await expect(saveOver(store, b.session, '{"n":2}', b.last, undefined)).rejects.toThrow(CHANGED_ELSEWHERE);
    expect(await (await unlockVault((await store.load(first.id))!, PASS)).read()).toBe('{"n":1}'); // b changed nothing

    const reloaded = await openTab(store, first.id);
    reloaded.last = await saveOver(store, reloaded.session, '{"n":2}', reloaded.last, undefined);
    expect(await (await unlockVault((await store.load(first.id))!, PASS)).read()).toBe('{"n":2}');
    // And the tab that wrote first is the stale one now.
    await expect(saveOver(store, a.session, '{"n":3}', a.last, undefined)).rejects.toThrow(CHANGED_ELSEWHERE);
  }, 60_000);

  it("checks and writes under one lock across tabs when the browser has one", async () => {
    const store = new MemoryStore();
    const first = await createVault(PASS, "{}");
    await store.save(first.record);
    const a = await openTab(store, first.id);
    const held: string[] = [];
    const locks = { request: async <T,>(name: string, cb: () => Promise<T>) => (held.push(name), cb()) };
    await saveOver(store, a.session, '{"n":1}', a.last, locks);
    expect(held).toEqual([`hewn-vault-${first.id}`]);
  }, 60_000);
});

describe("a recovery key made while the books are open", () => {
  it("is written with the books, so a stale tab can't save over it, and it then sets a new passphrase", async () => {
    const { addRecovery } = await import("@pnw/vault");
    const { accountSecret, findAccounts, recoverAccounts, vaultIdFor } = await import("./account");
    const FAST = { iterations: 1_000 };
    const store = new MemoryStore();
    const secret = accountSecret("ana", PASS);
    const id = await vaultIdFor("ana", "business");
    await store.save((await createVault(secret, '{"n":0}', { id, ...FAST })).record);
    const tab = async () => {
      const session = await unlockVault((await store.load(id))!, secret);
      return { session, last: session.record.payload.iv as string | null };
    };
    const a = await tab();
    const b = await tab();

    // What the app does on Settings → Make a recovery key (BooksProvider `replaceSlots`).
    const { record, code } = await addRecovery(a.session.record, secret);
    const next = await unlockVault(record, secret);
    a.last = await saveOver(store, next, '{"n":0}', a.last, undefined);
    expect((await store.load(id))!.recovery).toBeDefined();
    // The other tab, still holding the record without the key, can't write it back.
    await expect(saveOver(store, b.session, '{"n":1}', b.last, undefined)).rejects.toThrow(CHANGED_ELSEWHERE);
    // The tab that made it keeps the key on every later write.
    a.last = await saveOver(store, next, '{"n":2}', a.last, undefined);
    expect((await store.load(id))!.recovery?.createdAt).toBe(record.recovery!.createdAt);

    // Then the passphrase is forgotten.
    const found = await recoverAccounts(store, "ana", code, "a whole new phrase!", FAST);
    expect(await found[0]!.session.read()).toBe('{"n":2}');
    await expect(findAccounts(store, "ana", PASS, FAST)).rejects.toThrow();
  }, 60_000);
});

describe("a backup file restored with the recovery key while the books are open elsewhere", () => {
  it("is written as a new save of the books, so the open tab stops instead of saving the old passphrase's record back", async () => {
    const { addRecovery, exportBackup, parseBackup, resetWithRecovery } = await import("@pnw/vault");
    const { accountSecret, vaultIdFor } = await import("./account");
    const FAST = { iterations: 1_000 };
    const NEXT = "a whole new phrase!";
    const store = new MemoryStore();
    const secret = accountSecret("ana", PASS);
    const id = await vaultIdFor("ana", "business");
    const made = await addRecovery((await createVault(secret, '{"n":0}', { id, ...FAST })).record, secret);
    await store.save(made.record);
    // A backup of the books exactly as they are stored, and a tab open on them.
    const file = exportBackup((await store.load(id))!, []);
    const session = await unlockVault((await store.load(id))!, secret);
    const tab = { session, last: session.record.payload.iv as string | null };

    // What the app does on Restore → from a file, with the recovery key (BooksProvider `restoreWithRecovery`).
    const backup = parseBackup(file);
    const next = accountSecret("ana", NEXT);
    const s = await unlockVault(await resetWithRecovery(backup.record, made.code, next, FAST), next);
    const json = await s.read();
    await replaceOver(store, s, json, backup.attachments, undefined);

    await expect(saveOver(store, tab.session, '{"n":1}', tab.last, undefined)).rejects.toThrow(CHANGED_ELSEWHERE);
    expect(await (await unlockVault((await store.load(id))!, next)).read()).toBe('{"n":0}');
    await expect(unlockVault((await store.load(id))!, secret)).rejects.toThrow();
    // And the provider does write the books again before it replaces them.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const provider = readFileSync(join(__dirname, "BooksProvider.tsx"), "utf8");
    const restore = provider.slice(provider.indexOf("const restoreWithRecovery = useCallback("), provider.indexOf("const restoreFromAccount = useCallback("));
    expect(restore).toContain("await replaceOver(store, s, json, backup.attachments);");
    expect(restore).not.toContain("store.replace(");
  }, 60_000);
});

/** Web Locks as the browser runs them: one holder per name at a time, the others wait their turn. */
function tabLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const held: string[] = [];
  return {
    held,
    request<T>(name: string, cb: () => Promise<T>): Promise<T> {
      const run = (tails.get(name) ?? Promise.resolve()).then(() => (held.push(name), cb()));
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

describe("a backup file restored with the recovery key while another tab is saving", () => {
  it("lands after that save, so the restored books keep the new passphrase and the tab's next save is refused", async () => {
    const { addRecovery, exportBackup, parseBackup, resetWithRecovery } = await import("@pnw/vault");
    const { accountSecret, vaultIdFor } = await import("./account");
    const FAST = { iterations: 1_000 };
    const store = new MemoryStore();
    const secret = accountSecret("ana", PASS);
    const next = accountSecret("ana", "a whole new phrase!");
    const id = await vaultIdFor("ana", "business");
    const made = await addRecovery((await createVault(secret, '{"n":0}', { id, ...FAST })).record, secret);
    await store.save(made.record);
    const file = exportBackup((await store.load(id))!, []);
    const session = await unlockVault((await store.load(id))!, secret);
    const tab = { session, last: session.record.payload.iv as string | null };
    const locks = tabLocks();

    // The restore, up to its write (BooksProvider `restoreWithRecovery`).
    const backup = parseBackup(file);
    const s = await unlockVault(await resetWithRecovery(backup.record, made.code, next, FAST), next);
    const json = await s.read();

    // The tab's save has read the stored record and passed its check when the restore writes.
    const load = store.load.bind(store);
    let restoring: Promise<string> | null = null;
    store.load = async (vaultId: string) => {
      const record = await load(vaultId);
      if (!restoring) {
        restoring = replaceOver(store, s, json, backup.attachments, locks);
        await new Promise((r) => setTimeout(r, 50)); // time enough for a write that doesn't wait
      }
      return record;
    };
    tab.last = await saveOver(store, tab.session, '{"n":1}', tab.last, locks);
    await restoring;

    // The restored books are what is stored: the new passphrase opens them, the old one doesn't.
    expect(await (await unlockVault((await store.load(id))!, next)).read()).toBe('{"n":0}');
    await expect(unlockVault((await store.load(id))!, secret)).rejects.toThrow();
    // And the tab, holding the old passphrase's record, can't save it back.
    await expect(saveOver(store, tab.session, '{"n":2}', tab.last, locks)).rejects.toThrow(CHANGED_ELSEWHERE);
    await expect(unlockVault((await store.load(id))!, secret)).rejects.toThrow();
    // Both writes took the one lock.
    expect(locks.held.slice(0, 2)).toEqual([`hewn-vault-${id}`, `hewn-vault-${id}`]);
  }, 60_000);
});
