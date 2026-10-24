import { describe, expect, it } from "vitest";
import { MemoryStore, createVault, unlockVault } from "@pnw/vault";
import { CHANGED_ELSEWHERE, saveOver } from "./vault_write";

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
