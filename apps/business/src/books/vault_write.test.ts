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
