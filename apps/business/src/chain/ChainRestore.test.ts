import { describe, expect, it } from "vitest";
import { addAccount, createBooks, postEntry } from "@pnw/ledger";
import { MemoryStore, addRecovery, createVault, openKeySlots, unlockVault } from "@pnw/vault";
import { accountSecret, vaultIdFor } from "../books/account";
import { type AccountUnlock, fileIdsIn, restoreIntoVault, restoredCompany } from "../books/account_restore";
import { stateHash } from "../books/books_backup";
import { type Company, companyFromJson, companyToJson, emptyCompany } from "../books/company";
import { type Page, planBackup, restoreBackup, sealerOf } from "./books_backup";
import { ownReader, restoreNotes } from "./chain_restore";
import type { LetterRecord } from "./letters";

const USER = "alder";
const PASS = "correct horse battery staple";
const ADDR = "aleo1" + "a".repeat(58);
const OTHER = "aleo1" + "b".repeat(58);
const NOW = "2026-10-26T12:00:00.000Z";

async function setup() {
  let books = createBooks({ businessName: "Restore Co", fiscalYearStartMonth: 1 });
  const s = addAccount(books, { name: "Sales", type: "income" });
  const k = addAccount(s.books, { name: "Checking", type: "bank" });
  books = k.books;
  for (let i = 0; i < 4; i++) {
    books = postEntry(books, { date: "2026-10-16", memo: `Job ${i}`, lines: [{ accountId: k.account.id, debit: BigInt(1000 + i) }, { accountId: s.account.id, credit: BigInt(1000 + i) }] }).books;
  }
  const company: Company = { ...emptyCompany(books), username: USER };
  const id = await vaultIdFor(USER, "business");
  const session = await createVault(accountSecret(USER, PASS), companyToJson(company), { id, iterations: 1000 });
  return { session, company, id };
}

/** The account's letters to itself, after a backup sent its pages. */
async function backedUp(session: Awaited<ReturnType<typeof setup>>["session"], company: Company) {
  const box = new Map<string, Uint8Array>();
  const plan = (await planBackup({ sealer: sealerOf(session), company, username: USER, address: ADDR, state: null }))!;
  plan.pages.forEach((p: Page) => box.set(p.lookup, p.envelope));
  return { box, plan, read: async (lookup: string) => box.get(lookup) ?? null };
}

const finder = (read: (lookup: string) => Promise<Uint8Array | null>, address = ADDR) => (username: string, openSlots: Parameters<typeof restoreBackup>[0]["openSlots"]) =>
  restoreBackup({ read, username, address, openSlots });

describe("restoring the books from the backup kept with the account", () => {
  it("writes the books into a new device's vault, opening with the same username and passphrase", async () => {
    const { session, company, id } = await setup();
    const { read, plan } = await backedUp(session, company);
    const store = new MemoryStore(); // a browser that lost everything
    const out = (await restoreIntoVault(store, finder(read), "Alder", { passphrase: PASS }, NOW))!;
    expect(out.report).toEqual({ applied: 1, found: 1, missingFiles: 0 });

    const record = (await store.load(id))!;
    const back = companyFromJson(await (await unlockVault(record, accountSecret(USER, PASS))).read());
    expect(await stateHash(back)).toBe(await stateHash(company));
    expect(back.backedUpAt).toBe(NOW);
    expect(back.chainBackup).toEqual(plan.next); // carries on where the backup left off
    // Nothing changed since: the next backup has nothing to send.
    expect(await planBackup({ sealer: sealerOf(out.session), company: back, username: USER, address: ADDR, state: back.chainBackup! })).toBeNull();
  });

  it("with the recovery key, sets the new passphrase, and starts the next backup afresh", async () => {
    const { session, company, id } = await setup();
    const { record, code } = await addRecovery(session.record, accountSecret(USER, PASS));
    const withKey = await openKeySlots({ id: record.id, kdf: record.kdf, wrappedKey: record.wrappedKey, recovery: record.recovery }, accountSecret(USER, PASS));
    const { read } = await backedUp(withKey, company);
    const store = new MemoryStore();
    const next = "a brand new passphrase, five words";
    const out = (await restoreIntoVault(store, finder(read), USER, { code, next }, NOW))!;
    expect(out.report.applied).toBe(1);

    const saved = (await store.load(id))!;
    await expect(unlockVault(saved, accountSecret(USER, PASS))).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
    const back = companyFromJson(await (await unlockVault(saved, accountSecret(USER, next))).read());
    expect(await stateHash(back)).toBe(await stateHash(company));
    expect(back.chainBackup).toBeUndefined();
  });

  it("refuses a weak new passphrase before reading anything", async () => {
    let asked = false;
    await expect(
      restoreIntoVault(new MemoryStore(), async () => ((asked = true), null), USER, { code: "X", next: "short" }),
    ).rejects.toThrow();
    expect(asked).toBe(false);
  });

  it("says plainly when the passphrase or recovery key is wrong, and writes nothing", async () => {
    const { session, company, id } = await setup();
    const { read } = await backedUp(session, company);
    const store = new MemoryStore();
    const wrong: AccountUnlock = { passphrase: "not the passphrase at all" };
    await expect(restoreIntoVault(store, finder(read), USER, wrong)).rejects.toThrow("That username and passphrase don't open this backup");
    expect(await store.load(id)).toBeNull();
  });

  it("finds nothing under another username or another account", async () => {
    const { session, company } = await setup();
    const { read } = await backedUp(session, company);
    expect(await restoreIntoVault(new MemoryStore(), finder(read), "birch", { passphrase: PASS })).toBeNull();
    expect(await restoreIntoVault(new MemoryStore(), finder(read, OTHER), USER, { passphrase: PASS })).toBeNull();
  });

  it("keeps this device's files for these books, drops any it can't open, and counts the ones missing", async () => {
    const { session, company, id } = await setup();
    const withFiles = { ...company, books: { ...company.books, settings: { ...company.books.settings } } } as Company;
    // Two files referenced; one is on this device, sealed with the same key.
    (withFiles as unknown as { extra: unknown }).extra = [{ attachmentId: "att-here" }, { attachmentId: "att-gone" }];
    const here = await session.sealAttachment("att-here", new Uint8Array([1, 2, 3]));
    const stranger = await (await createVault("someone else", "{}", { id, iterations: 1000 })).sealAttachment("att-stranger", new Uint8Array([9]));
    const store = new MemoryStore();
    await store.saveAttachment(id, here);
    await store.saveAttachment(id, stranger);
    const { read } = await backedUp(session, company);
    const out = (await restoreIntoVault(store, async (u, open) => {
      const found = await finder(read)(u, open);
      return found && { ...found, company: withFiles };
    }, USER, { passphrase: PASS }))!;
    expect(out.report.missingFiles).toBe(1);
    expect((await store.listAttachments(id)).map((a) => a.id)).toEqual(["att-here"]);
  });
});

describe("the pieces around it", () => {
  it("reads only letters the account sent itself", async () => {
    const mine: LetterRecord = { kind: "letter", lookup: "l", envelope: Uint8Array.of(1), sender: ADDR };
    const theirs: LetterRecord = { kind: "letter", lookup: "l", envelope: Uint8Array.of(2), sender: OTHER };
    const unknown: LetterRecord = { kind: "letter", lookup: "l", envelope: Uint8Array.of(3) };
    expect(await ownReader(async () => [theirs, unknown, mine], ADDR)("l")).toEqual(Uint8Array.of(1));
    expect(await ownReader(async () => [theirs, unknown], ADDR)("l")).toBeNull();
  });

  it("names every file id the books refer to", () => {
    const c = { a: [{ attachmentId: "x" }, { deep: { attachmentId: "y" } }], b: { attachmentId: "x" } } as unknown as Company;
    expect([...fileIdsIn(c)].sort()).toEqual(["x", "y"]);
  });

  it("records the backup as current, unless a new passphrase means a fresh one", () => {
    const state = { chain: 0, seq: 0 } as never;
    const company = { chainBackup: { old: true } } as unknown as Company;
    expect(restoredCompany({ company, state }, { newPassphrase: false, now: NOW })).toEqual({ backedUpAt: NOW, chainBackup: state });
    expect(restoredCompany({ company, state }, { newPassphrase: true, now: NOW })).toEqual({ backedUpAt: NOW });
  });

  it("says what a partial restore left out, and nothing when it's whole", () => {
    expect(restoreNotes({ applied: 3, found: 3, missingFiles: 0 })).toEqual([]);
    const notes = restoreNotes({ applied: 2, found: 4, stopped: { at: 2, reason: "a piece is missing" }, missingFiles: 1 });
    expect(notes[0]).toContain("as of backup 2 of 4");
    expect(notes[1]).toContain("1 receipt or bill file isn't on this device");
  });
});
