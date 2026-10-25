import { describe, expect, it } from "vitest";
import { addAccount, createBooks, postEntry } from "@pnw/ledger";
import { type VaultSession, addRecovery, createVault, openKeySlots, openKeySlotsWithRecovery } from "@pnw/vault";
import { MAX_CHANGES, stateHash } from "../books/books_backup";
import { type Company, companyToJson, emptyCompany } from "../books/company";
import { type ChainState, type Page, finderKey, pageLookup, planBackup, restoreBackup } from "./books_backup";
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
  const plan = await planBackup({ session, company, username: USER, address: ADDR, state });
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
    expect(await planBackup({ session, company: books, username: USER, address: ADDR, state })).toBeNull();
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
    const change = (await planBackup({ session, company: sell(books, bank, sales, 1, 600), username: USER, address: ADDR, state: plan.next }))!;
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
});
