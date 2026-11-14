import { describe, expect, it } from "vitest";
import { addAccount, createBooks, postEntry } from "@pnw/ledger";
import { MemoryStore, type VaultSession, addRecovery, createVault, keySlotsOf, openKeySlots, openKeySlotsWithRecovery, removeRecovery, unlockVault } from "@pnw/vault";
import { accountSecret, recoverAccounts, vaultIdFor } from "../books/account";
import { MAX_CHANGES, stateHash, validateChainState } from "../books/books_backup";
import { type Company, companyToJson, emptyCompany } from "../books/company";
import { type ChainState, type Page, finderKey, pageLookup, planBackup, restoreBackup, sealerOf, slotsHash } from "./books_backup";
import { LETTER_BYTES, PAGE_BYTES } from "./letters";

const USER = "alder";
const ADDR = "aleo1" + "a".repeat(58);
const SECRET = "hewn:v1\nalder\ncorrect horse battery staple";

async function setup(): Promise<{ session: VaultSession; company: Company; bank: string; sales: string }> {
  let books = createBooks({ businessName: "Backup Co", fiscalYearStartMonth: 1 });
  const s = addAccount(books, { name: "Sales", type: "income" });
  const k = addAccount(s.books, { name: "Checking", type: "bank" });
  books = k.books;
  const company = emptyCompany(books);
  const session = await createVault(SECRET, companyToJson(company), { id: "acct-backup", iterations: 1000 });
  return { session, company, bank: k.account.id, sales: s.account.id };
}

/** Entries that vary like real ones (a different note and amount each), so the books don't compress to nothing. */
const sell = (c: Company, bank: string, sales: string, n: number, from = 0): Company => {
  let books = c.books;
  for (let i = from; i < from + n; i++) {
    const note = Array.from({ length: 6 }, (_, j) => ((i + 1) * 2654435761 * (j + 7)) % 4294967291).map((x) => x.toString(36)).join(" ");
    books = postEntry(books, { date: "2026-10-16", memo: `Job ${i} for Alder: ${note}`, lines: [{ accountId: bank, debit: BigInt(1000 + ((i * 7919) % 99000)) }, { accountId: sales, credit: BigInt(1000 + ((i * 7919) % 99000)) }] }).books;
  }
  return { ...c, books };
};

/** This account's letters to itself, as the wallet would find them. */
function letters() {
  const box = new Map<string, Uint8Array>();
  return { box, send: (pages: Page[]) => pages.forEach((p) => box.set(p.lookup, p.envelope)), read: async (lookup: string) => box.get(lookup) ?? null };
}

const withPassphrase = (secret: string) => (slots: Parameters<typeof openKeySlots>[0]) => openKeySlots(slots, secret);

async function backUp(session: VaultSession, company: Company, state: ChainState | null, send: (p: Page[]) => void) {
  const plan = await planBackup({ sealer: sealerOf(session), company, username: USER, address: ADDR, state });
  if (!plan) return null;
  send(plan.pages);
  return plan;
}

describe("backing the books up as letters to the account itself", () => {
  it("restores the books from a snapshot, opened with the passphrase", async () => {
    const { session, company, bank, sales } = await setup();
    const books = sell(company, bank, sales, 5);
    const l = letters();
    const plan = (await backUp(session, books, null, l.send))!;
    expect(plan).toMatchObject({ kind: "snapshot", chain: 0, seq: 0 });
    expect(plan.pages).toHaveLength(1);
    // Sealed: nothing of the books reads in the letters.
    const all = [...l.box.values()].map((e) => new TextDecoder().decode(e)).join("");
    expect(all).not.toContain("Alder");
    expect(all).not.toContain("Backup Co");

    const out = (await restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withPassphrase(SECRET) }))!;
    expect(out.applied).toBe(1);
    expect(await stateHash(out.company)).toBe(await stateHash(books));
    expect(out.state).toMatchObject({ chain: 0, seq: 0 });
  });

  it("adds changes to the chain, nothing when nothing changed, and restores through them", async () => {
    const { session, company, bank, sales } = await setup();
    const l = letters();
    let books = sell(company, bank, sales, 100);
    let state = (await backUp(session, books, null, l.send))!.next;
    expect(await planBackup({ sealer: sealerOf(session), company: books, username: USER, address: ADDR, state })).toBeNull();
    books = sell(books, bank, sales, 2, 100);
    const c1 = (await backUp(session, books, state, l.send))!;
    expect(c1).toMatchObject({ kind: "change", chain: 0, seq: 1 });
    state = c1.next;
    books = sell(books, bank, sales, 1, 102);
    state = (await backUp(session, books, state, l.send))!.next;

    const out = (await restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withPassphrase(SECRET) }))!;
    expect(out.applied).toBe(3);
    expect(await stateHash(out.company)).toBe(await stateHash(books));
    expect(out.state).toMatchObject({ chain: 0, seq: 2, mark: state.mark });
  });

  it("splits big books into pages that each fit one, and says what they cost", async () => {
    const { session, company, bank, sales } = await setup();
    const books = sell(company, bank, sales, 600);
    const l = letters();
    const plan = (await backUp(session, books, null, l.send))!;
    expect(plan.pages.length).toBeGreaterThan(1);
    expect(plan.pages.every((p) => p.envelope.length <= PAGE_BYTES)).toBe(true);
    expect(plan.fullPages).toBeGreaterThan(0);
    expect(plan.fee).toBeGreaterThan(0);
    const out = (await restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withPassphrase(SECRET) }))!;
    expect(await stateHash(out.company)).toBe(await stateHash(books));
    // A small change after it fits one letter.
    const change = (await planBackup({ sealer: sealerOf(session), company: sell(books, bank, sales, 1, 600), username: USER, address: ADDR, state: plan.next }))!;
    expect(change).toMatchObject({ kind: "change", letters: 1, fullPages: 0 });
    expect(change.pages[0]!.envelope.length).toBeLessThanOrEqual(LETTER_BYTES);
  });

  it("refuses the wrong passphrase, and opens with the recovery key", async () => {
    const { session, company, bank, sales } = await setup();
    const { record, code } = await addRecovery(session.record, SECRET);
    const withKey = await openKeySlots({ id: record.id, kdf: record.kdf, wrappedKey: record.wrappedKey, recovery: record.recovery }, SECRET);
    await withKey.write(companyToJson(company));
    const books = sell(company, bank, sales, 2);
    const l = letters();
    await backUp(withKey, books, null, l.send);
    await expect(restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withPassphrase("hewn:v1\nalder\nnot the passphrase") })).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
    const out = (await restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: (slots) => openKeySlotsWithRecovery(slots, code) }))!;
    expect(await stateHash(out.company)).toBe(await stateHash(books));
  });

  it("finds nothing for another username or account, or when there is no backup", async () => {
    const { session, company } = await setup();
    const l = letters();
    await backUp(session, company, null, l.send);
    expect(await restoreBackup({ read: l.read, username: "birch", address: ADDR, openSlots: withPassphrase(SECRET) })).toBeNull();
    expect(await restoreBackup({ read: l.read, username: USER, address: "aleo1" + "b".repeat(58), openSlots: withPassphrase(SECRET) })).toBeNull();
    expect(await restoreBackup({ read: letters().read, username: USER, address: ADDR, openSlots: withPassphrase(SECRET) })).toBeNull();
    expect(await finderKey(USER, ADDR)).not.toBe(await finderKey("birch", ADDR));
  });

  it("stops at a missing page, keeping the books as of the piece before", async () => {
    const { session, company, bank, sales } = await setup();
    const l = letters();
    let books = sell(company, bank, sales, 100);
    let state = (await backUp(session, books, null, l.send))!.next;
    books = sell(books, bank, sales, 1, 100);
    const kept = books;
    state = (await backUp(session, books, state, l.send))!.next;
    books = sell(books, bank, sales, 1, 101);
    const lost = (await backUp(session, books, state, l.send))!;
    expect(lost.kind).toBe("change");
    books = sell(books, bank, sales, 1, 102);
    await backUp(session, books, lost.next, l.send);
    l.box.delete(lost.pages[0]!.lookup);

    const out = (await restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withPassphrase(SECRET) }))!;
    expect(out.applied).toBe(2);
    expect(await stateHash(out.company)).toBe(await stateHash(kept));
  });

  it("starts a new chain after 12 changes, restores from the newest, and falls back when its snapshot is cut short", async () => {
    const { session, company, bank, sales } = await setup();
    const l = letters();
    let books = sell(company, bank, sales, 300);
    let state = (await backUp(session, books, null, l.send))!.next;
    for (let i = 0; i < MAX_CHANGES; i++) {
      books = sell(books, bank, sales, 1, 300 + i);
      state = (await backUp(session, books, state, l.send))!.next;
    }
    expect(state).toMatchObject({ chain: 0, seq: MAX_CHANGES });
    const before = books;
    books = sell(books, bank, sales, 1, 400);
    const fresh = (await backUp(session, books, state, l.send))!;
    expect(fresh).toMatchObject({ kind: "snapshot", chain: 1, seq: 0 });

    const newest = (await restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withPassphrase(SECRET) }))!;
    expect(newest.state.chain).toBe(1);
    expect(await stateHash(newest.company)).toBe(await stateHash(books));

    // The newest snapshot loses a page: the chain before it still restores, in full.
    const finder = await finderKey(USER, ADDR);
    const last = fresh.pages.length - 1;
    l.box.delete(await pageLookup(finder, 1, 0, last));
    const fallback = (await restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withPassphrase(SECRET) }))!;
    expect(fallback.state.chain).toBe(0);
    expect(await stateHash(fallback.company)).toBe(await stateHash(before));
  });

  it("starts a new chain when a backup cut off partway left its pages behind", async () => {
    const { session, company, bank, sales } = await setup();
    const l = letters();
    let books = sell(company, bank, sales, 100);
    const state = (await backUp(session, books, null, l.send))!.next;
    books = sell(books, bank, sales, 1, 100);
    const taken = async (lookup: string) => l.box.has(lookup);
    // The change was sent once but the books never recorded it: its slot is taken.
    const cut = (await planBackup({ sealer: sealerOf(session), company: books, username: USER, address: ADDR, state }))!;
    expect(cut).toMatchObject({ kind: "change", chain: 0, seq: 1 });
    l.send(cut.pages);
    const retry = (await planBackup({ sealer: sealerOf(session), company: books, username: USER, address: ADDR, state, taken }))!;
    expect(retry).toMatchObject({ kind: "snapshot", chain: 1, seq: 0 });
    l.send(retry.pages);
    const out = (await restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withPassphrase(SECRET) }))!;
    expect(out.state.chain).toBe(1);
    expect(await stateHash(out.company)).toBe(await stateHash(books));
  });
});

describe("a change to the books' key slots", () => {
  const withRecovery = (code: string) => (slots: Parameters<typeof openKeySlots>[0]) => openKeySlotsWithRecovery(slots, code);

  it("after a new recovery key, the next backup is a full copy on a new chain, and the new key opens it", async () => {
    const { session: first, company, bank, sales } = await setup();
    const a = await addRecovery(first.record, SECRET);
    let session = await unlockVault(a.record, SECRET);
    const l = letters();
    let books = sell(company, bank, sales, 100);
    const state = (await backUp(session, books, null, l.send))!.next;

    // A new recovery key replaces the first (there is one slot), then an entry is posted.
    const b = await addRecovery(session.record, SECRET);
    session = await unlockVault(b.record, SECRET);
    books = sell(books, bank, sales, 1, 100);
    const plan = (await backUp(session, books, state, l.send))!;
    expect(plan).toMatchObject({ kind: "snapshot", chain: 1, seq: 0 });

    const out = (await restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withRecovery(b.code) }))!;
    expect(out.state.chain).toBe(1);
    expect(out.company.books.entries).toHaveLength(101);
    expect(await stateHash(out.company)).toBe(await stateHash(books));
    // The key it replaced doesn't open the newest backup.
    await expect(restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withRecovery(a.code) })).rejects.toMatchObject({ code: "WRONG_RECOVERY_KEY" });
    // The passphrase didn't change, and still does.
    expect((await restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withPassphrase(SECRET) }))!.state.chain).toBe(1);
  });

  it("after a passphrase reset with the recovery key, the next backup is a full copy the new passphrase opens", async () => {
    const { company, bank, sales } = await setup();
    const store = new MemoryStore();
    const secret = accountSecret(USER, "correct horse battery staple");
    const created = await createVault(secret, companyToJson(company), { id: await vaultIdFor(USER, "business"), iterations: 1000 });
    const { record, code } = await addRecovery(created.record, secret);
    await store.save(record);
    const l = letters();
    let books = sell(company, bank, sales, 100);
    const state = (await backUp(await unlockVault(record, secret), books, null, l.send))!.next;

    const next = "a new phrase, written down";
    const [found] = await recoverAccounts(store, USER, code, next, { iterations: 1000 });
    books = sell(books, bank, sales, 1, 100);
    const plan = (await backUp(found!.session, books, state, l.send))!;
    expect(plan).toMatchObject({ kind: "snapshot", chain: 1, seq: 0 });

    const out = (await restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withPassphrase(accountSecret(USER, next)) }))!;
    expect(out.state.chain).toBe(1);
    expect(await stateHash(out.company)).toBe(await stateHash(books));
    await expect(restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withPassphrase(secret) })).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
  });

  it("plans a full copy after a key change even when the books didn't change, and when a recovery key was taken away", async () => {
    const { session: first, company, bank, sales } = await setup();
    const a = await addRecovery(first.record, SECRET);
    const session = await unlockVault(a.record, SECRET);
    const l = letters();
    const books = sell(company, bank, sales, 20);
    const state = (await backUp(session, books, null, l.send))!.next;
    expect(await backUp(session, books, state, l.send)).toBeNull();

    const without = await unlockVault(await removeRecovery(session.record, SECRET), SECRET);
    const plan = (await backUp(without, books, state, l.send))!;
    expect(plan).toMatchObject({ kind: "snapshot", chain: 1, seq: 0 });
    // Once that copy is sent there is nothing more to send.
    expect(await backUp(without, books, plan.next, l.send)).toBeNull();
    await expect(restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withRecovery(a.code) })).rejects.toMatchObject({ code: "WRONG_RECOVERY_KEY" });
  });

  it("plans a full copy from a chain state saved before the slots were recorded", async () => {
    const { session, company, bank, sales } = await setup();
    const l = letters();
    let books = sell(company, bank, sales, 100);
    const { slots: _, ...older } = (await backUp(session, books, null, l.send))!.next;
    expect(validateChainState(older).slots).toBeUndefined();
    books = sell(books, bank, sales, 1, 100);
    const plan = (await backUp(session, books, older, l.send))!;
    expect(plan).toMatchObject({ kind: "snapshot", chain: 1, seq: 0 });
    expect(plan.next.slots).toBe(await slotsHash(sealerOf(session).slots));
  });

  it("keeps adding changes to the same chain while the slots stay the same, on this device and after a restore", async () => {
    const { session, company, bank, sales } = await setup();
    const l = letters();
    let books = sell(company, bank, sales, 100);
    const snap = (await backUp(session, books, null, l.send))!;
    expect(snap.next.slots).toBe(await slotsHash(keySlotsOf(session.record)));
    books = sell(books, bank, sales, 1, 100);
    const change = (await backUp(session, books, snap.next, l.send))!;
    expect(change).toMatchObject({ kind: "change", chain: 0, seq: 1 });
    expect(change.next.slots).toBe(snap.next.slots);

    // Restored with the passphrase, the vault has the same slots, so the chain carries on.
    const out = (await restoreBackup({ read: l.read, username: USER, address: ADDR, openSlots: withPassphrase(SECRET) }))!;
    expect(out.state.slots).toBe(snap.next.slots);
    books = sell(books, bank, sales, 1, 101);
    expect(await backUp(out.session, books, out.state, l.send)).toMatchObject({ kind: "change", chain: 0, seq: 2 });
  });

  it("hashes the slots the same whatever order their fields come in, and differently once one changes", async () => {
    const { session } = await setup();
    const slots = keySlotsOf(session.record);
    const hash = await slotsHash(slots);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const reordered = { wrappedKey: { data: slots.wrappedKey.data, iv: slots.wrappedKey.iv }, kdf: { salt: slots.kdf.salt, iterations: slots.kdf.iterations, name: slots.kdf.name }, id: slots.id };
    expect(await slotsHash(reordered)).toBe(hash);
    expect(await slotsHash(JSON.parse(JSON.stringify(slots)))).toBe(hash);
    const { record } = await addRecovery(session.record, SECRET);
    expect(await slotsHash(keySlotsOf(record))).not.toBe(hash);
  });

  it("reads a chain state back with or without its slots hash, and refuses one that isn't 64 lower-case hex", async () => {
    const { session, company } = await setup();
    const state = (await backUp(session, company, null, () => {}))!.next;
    expect(validateChainState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    const { slots: _, ...older } = state;
    expect(validateChainState(older)).toEqual(older);
    for (const slots of ["A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), "", 7, null, { hash: "a".repeat(64) }]) {
      expect(() => validateChainState({ ...state, slots }), String(slots)).toThrow("The backup's place isn't readable");
    }
  });
});
