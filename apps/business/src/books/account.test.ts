import { describe, expect, it } from "vitest";
import { MemoryStore, addRecovery, createVault, exportBackup, parseBackup, sha256Hex, unlockVault } from "@pnw/vault";
import {
  LEGACY_VAULT_ID,
  NO_MATCH_MESSAGE,
  NO_RECOVERY_MATCH_MESSAGE,
  AccountError,
  accountSecret,
  checkAccountPassphrase,
  findAccounts,
  hasLegacyVault,
  legacyOpen,
  normalizeUsername,
  recoverAccounts,
  usernameConflict,
  vaultIdFor,
} from "./account";

// Low rounds keep the tests fast; the production default is checked in the vault's own tests.
const FAST = { iterations: 1_000 };
const PASS = "correct horse battery";

/** Makes an account the way the app does: vault id from the username, secret from username + passphrase. */
async function makeAccount(store: MemoryStore, email: string, role: "business" | "worker" | "customer", passphrase = PASS, contents = `${role} books`) {
  const e = normalizeUsername(email);
  const s = await createVault(accountSecret(e, passphrase), contents, { id: await vaultIdFor(e, role), ...FAST });
  await store.save(s.record);
  return s;
}

describe("normalizeUsername, with an email (how accounts were made before usernames)", () => {
  it("trims and lower-cases", () => {
    expect(normalizeUsername("  Ana.Ruiz@Example.COM \n")).toBe("ana.ruiz@example.com");
  });

  it("folds look-alike Unicode forms (NFKC), so the same address always means the same account", () => {
    expect(normalizeUsername("ＡＮＡ@ＥＸＡＭＰＬＥ．ＣＯＭ")).toBe("ana@example.com"); // full-width
    expect(normalizeUsername("ana@example.com　")).toBe("ana@example.com"); // ideographic space
    expect(normalizeUsername("José@example.com")).toBe(normalizeUsername("José@example.com")); // e + accent vs é
    expect(normalizeUsername("JosÉ@example.com")).toBe("josé@example.com");
  });

  it("is idempotent, so normalising twice changes nothing", () => {
    for (const raw of ["Ana@Example.com", "ＡＮＡ@ＥＸＡＭＰＬＥ．ＣＯＭ", "JosÉ@Exämple.org", "İ@example.com"]) {
      const once = normalizeUsername(raw);
      expect(normalizeUsername(once)).toBe(once);
    }
  });

  it("refuses what is neither an address nor a username", () => {
    for (const bad of ["", "   ", "an", "ana@", "@example.com", "ana@example", "ana@@example.com", "a na@example.com", "ana@exa mple.com", "ana@example.com, bo@example.com"]) {
      expect(() => normalizeUsername(bad), bad).toThrow(AccountError);
    }
  });

  it("allows a 254-character email and refuses 255", () => {
    const at = (n: number) => `${"a".repeat(n - "@example.com".length)}@example.com`;
    expect(normalizeUsername(at(254))).toHaveLength(254);
    expect(() => normalizeUsername(at(255))).toThrow(/A username is/);
  });
});

describe("normalizeUsername", () => {
  it("takes 3 to 32 letters, numbers, dots, dashes and underscores, lower-cased", () => {
    expect(normalizeUsername("  Copper.Fox_22 ")).toBe("copper.fox_22");
    expect(normalizeUsername("ana")).toBe("ana");
    expect(normalizeUsername("josé-ruiz")).toBe("josé-ruiz");
    expect(normalizeUsername("ＣＯＰＰＥＲ")).toBe("copper"); // full-width folds (NFKC)
    expect(normalizeUsername("x".repeat(32))).toHaveLength(32);
  });

  it("refuses too short, too long, spaces and symbols", () => {
    for (const bad of ["ab", "x".repeat(33), "copper fox", "copper!", "copper/fox", "cop\nper", "<b>", "ana@"]) {
      expect(() => normalizeUsername(bad), bad).toThrow(/A username is 3 to 32/);
    }
  });

  it("is idempotent", () => {
    for (const raw of ["Copper.Fox", "ＣＯＰＰＥＲ", "José-Ruiz"]) {
      const once = normalizeUsername(raw);
      expect(normalizeUsername(once)).toBe(once);
    }
  });
});

describe("vaultIdFor", () => {
  it("is stable, and pinned so a change in the scheme can't pass unnoticed", async () => {
    const id = await vaultIdFor("ana@example.com", "business");
    expect(id).toBe(await vaultIdFor("ana@example.com", "business"));
    const expected = (await sha256Hex(new TextEncoder().encode("hewn:acct:v1:business:ana@example.com"))).slice(0, 32);
    expect(id).toBe(`acct-${expected}`);
    expect(id).toMatch(/^acct-[0-9a-f]{32}$/);
  });

  it("differs by role and by email, so one email can hold both kinds", async () => {
    const business = await vaultIdFor("ana@example.com", "business");
    const worker = await vaultIdFor("ana@example.com", "worker");
    const other = await vaultIdFor("bo@example.com", "business");
    expect(new Set([business, worker, other]).size).toBe(3);
  });

  it("never carries the email in the clear, and never collides with the old id", async () => {
    const id = await vaultIdFor("ana@example.com", "worker");
    expect(id).not.toContain("ana");
    expect(id).not.toBe(LEGACY_VAULT_ID);
  });
});

describe("accountSecret", () => {
  it("changes with either the email or the passphrase", () => {
    const base = accountSecret("ana@example.com", PASS);
    expect(accountSecret("bo@example.com", PASS)).not.toBe(base);
    expect(accountSecret("ana@example.com", PASS + "!")).not.toBe(base);
    expect(base).toBe(`hewn:v1\nana@example.com\n${PASS}`);
  });

  it("folds the passphrase to NFKC so the same typing always opens the same vault", () => {
    expect(accountSecret("ana@example.com", "café au lait!")).toBe(accountSecret("ana@example.com", "café au lait!"));
  });

  it("can't be confused by moving text between the email and the passphrase: no email holds the newline that separates them", () => {
    expect(() => normalizeUsername("a@b.co\nx")).toThrow(AccountError);
    expect(() => normalizeUsername("ana\nx")).toThrow(AccountError);
    expect(accountSecret("a@b.co", "x\ny@z.co")).not.toBe(accountSecret("a@b.cox", "y@z.co"));
  });
});

describe("checkAccountPassphrase", () => {
  it("holds a new passphrase to the rules, not the secret with the email in it", () => {
    expect(() => checkAccountPassphrase("river acid!")).toThrow(/at least 12/);
    expect(() => checkAccountPassphrase("copper lantern river ninth")).not.toThrow();
    expect(() => checkAccountPassphrase("Password123!")).toThrow(/common password/);
    expect(() => checkAccountPassphrase("jane.doe 2026 river!", "jane.doe@example.com")).toThrow(/username/);
    expect(() => checkAccountPassphrase("copperfox 2026 river!", "copper.fox")).toThrow(/username/);
    expect(() => checkAccountPassphrase("🌲 pine 🌲 cone 🌲")).not.toThrow();
  });
});

describe("an account vault", () => {
  it("is not opened by the passphrase alone, even with the file in hand", async () => {
    const store = new MemoryStore();
    const s = await makeAccount(store, "ana@example.com", "business");
    await expect(unlockVault(s.record, PASS)).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
    await expect(unlockVault(s.record, accountSecret("bo@example.com", PASS))).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
    expect(await (await unlockVault(s.record, accountSecret("ana@example.com", PASS))).read()).toBe("business books");
  });

  it("keeps the email out of the stored record and the backup file", async () => {
    const store = new MemoryStore();
    const s = await makeAccount(store, "ana@example.com", "business", PASS, "Ana's Plumbing");
    const stored = JSON.stringify(s.record);
    expect(stored).not.toContain("ana@example.com");
    expect(stored).not.toContain("Plumbing");
    expect(exportBackup(s.record)).not.toContain("ana@example.com");
  });
});

describe("findAccounts", () => {
  it("opens the account for the right email and passphrase", async () => {
    const store = new MemoryStore();
    await makeAccount(store, "ana@example.com", "business");
    const found = await findAccounts(store, "ana@example.com", PASS, FAST);
    expect(found.map((f) => f.role)).toEqual(["business"]);
    expect(await found[0]!.session.read()).toBe("business books");
  });

  it("treats the email as the person typed it: case, spaces and look-alike forms", async () => {
    const store = new MemoryStore();
    await makeAccount(store, "ana@example.com", "business");
    const found = await findAccounts(store, "  ANA@Example.com ", PASS, FAST);
    expect(found).toHaveLength(1);
  });

  it("gives the same generic answer for a wrong email, a wrong passphrase and an empty device", async () => {
    const store = new MemoryStore();
    await makeAccount(store, "ana@example.com", "business");
    const messages: string[] = [];
    for (const [email, pass, s] of [
      ["bo@example.com", PASS, store],
      ["ana@example.com", "not the passphrase", store],
      ["ana@example.com", PASS, new MemoryStore()],
    ] as const) {
      const err = await findAccounts(s, email, pass, FAST).catch((e) => e);
      expect(err).toBeInstanceOf(AccountError);
      messages.push(err.message);
    }
    expect(new Set(messages)).toEqual(new Set([NO_MATCH_MESSAGE]));
  });

  it("does not open the account with the passphrase of another email", async () => {
    const store = new MemoryStore();
    await makeAccount(store, "ana@example.com", "business", PASS);
    await makeAccount(store, "bo@example.com", "business", "another long passphrase");
    await expect(findAccounts(store, "ana@example.com", "another long passphrase", FAST)).rejects.toThrow(NO_MATCH_MESSAGE);
    await expect(findAccounts(store, "bo@example.com", PASS, FAST)).rejects.toThrow(NO_MATCH_MESSAGE);
  });

  it("returns both accounts when one email and passphrase open a business and a worker account", async () => {
    const store = new MemoryStore();
    await makeAccount(store, "ana@example.com", "business");
    await makeAccount(store, "ana@example.com", "worker");
    const found = await findAccounts(store, "ana@example.com", PASS, FAST);
    expect(found.map((f) => f.role)).toEqual(["business", "worker"]);
    expect(await found[0]!.session.read()).toBe("business books");
    expect(await found[1]!.session.read()).toBe("worker books");
  });

  it("opens only the account whose passphrase it is, when the two differ", async () => {
    const store = new MemoryStore();
    await makeAccount(store, "ana@example.com", "business", PASS);
    await makeAccount(store, "ana@example.com", "worker", "a different worker passphrase");
    expect((await findAccounts(store, "ana@example.com", PASS, FAST)).map((f) => f.role)).toEqual(["business"]);
    expect((await findAccounts(store, "ana@example.com", "a different worker passphrase", FAST)).map((f) => f.role)).toEqual(["worker"]);
  });

  it("refuses a username that can't be one, with its own message", async () => {
    await expect(findAccounts(new MemoryStore(), "an", PASS, FAST)).rejects.toThrow(/A username is/);
  });

  it("opens an account made with a username, and an email account exactly as before", async () => {
    const store = new MemoryStore();
    await makeAccount(store, "Copper.Fox", "business");
    await makeAccount(store, "ana@example.com", "worker");
    expect((await findAccounts(store, " copper.fox ", PASS, FAST)).map((f) => f.role)).toEqual(["business"]);
    expect((await findAccounts(store, "Ana@Example.com", PASS, FAST)).map((f) => f.role)).toEqual(["worker"]);
    // An email account's vault id and secret are the ones it was made with.
    expect(await vaultIdFor(normalizeUsername("Ana@Example.com"), "worker")).toBe(
      `acct-${(await sha256Hex(new TextEncoder().encode("hewn:acct:v1:worker:ana@example.com"))).slice(0, 32)}`,
    );
  });

  it("does not open books from before accounts", async () => {
    const store = new MemoryStore();
    await store.save((await createVault(PASS, "old books", { id: LEGACY_VAULT_ID, ...FAST })).record);
    await expect(findAccounts(store, "ana@example.com", PASS, FAST)).rejects.toThrow(NO_MATCH_MESSAGE);
  });
});

describe("books from before accounts", () => {
  it("are found by their old id and opened with the passphrase alone", async () => {
    const store = new MemoryStore();
    expect(await hasLegacyVault(store)).toBe(false);
    await store.save((await createVault(PASS, "old books", { id: LEGACY_VAULT_ID, ...FAST })).record);
    expect(await hasLegacyVault(store)).toBe(true);
    const session = await legacyOpen(store, PASS, FAST);
    expect(await session.read()).toBe("old books");
  });

  it("say the passphrase is wrong, and say the same when there are no old books", async () => {
    const store = new MemoryStore();
    await store.save((await createVault(PASS, "old books", { id: LEGACY_VAULT_ID, ...FAST })).record);
    const wrong = await legacyOpen(store, "wrong passphrase", FAST).catch((e) => e);
    expect(wrong).toBeInstanceOf(AccountError);
    const empty = await legacyOpen(new MemoryStore(), PASS, FAST).catch((e) => e);
    expect(empty).toBeInstanceOf(AccountError);
    expect(empty.message).toBe(wrong.message);
  });

  it("an account backup keeps its own id; an old backup is told apart by the old id", async () => {
    const store = new MemoryStore();
    const acct = await makeAccount(store, "ana@example.com", "business");
    const legacy = await createVault(PASS, "old books", { id: LEGACY_VAULT_ID, ...FAST });
    expect(parseBackup(exportBackup(acct.record)).record.id).toBe(await vaultIdFor("ana@example.com", "business"));
    expect(parseBackup(exportBackup(legacy.record)).record.id).toBe(LEGACY_VAULT_ID);
  });
});

describe("recoverAccounts (a forgotten passphrase)", () => {
  const NEXT = "a new phrase, written down";
  async function withRecovery(store: MemoryStore, username: string, role: "business" | "worker") {
    const s = await makeAccount(store, username, role);
    const { record, code } = await addRecovery(s.record, accountSecret(normalizeUsername(username), PASS));
    await store.save(record);
    return code;
  }

  it("sets a new passphrase with the username and recovery key, saves it, and the old one stops working", async () => {
    const store = new MemoryStore();
    const code = await withRecovery(store, "ana", "business");
    const found = await recoverAccounts(store, " Ana ", code, NEXT, FAST);
    expect(found.map((f) => f.role)).toEqual(["business"]);
    expect(await found[0]!.session.read()).toBe("business books");
    expect((await findAccounts(store, "ana", NEXT, FAST)).map((f) => f.role)).toEqual(["business"]);
    await expect(findAccounts(store, "ana", PASS, FAST)).rejects.toThrow(NO_MATCH_MESSAGE);
    // The key keeps working for the next time.
    expect((await recoverAccounts(store, "ana", code, "and another new phrase!", FAST)).length).toBe(1);
  });

  it("resets only the account the key belongs to when a username holds both kinds", async () => {
    const store = new MemoryStore();
    const workerCode = await withRecovery(store, "ana", "worker");
    await withRecovery(store, "ana", "business");
    const found = await recoverAccounts(store, "ana", workerCode, NEXT, FAST);
    expect(found.map((f) => f.role)).toEqual(["worker"]);
    expect((await findAccounts(store, "ana", PASS, FAST)).map((f) => f.role)).toEqual(["business"]);
  });

  it("must fail with one message whatever was wrong, and changes nothing", async () => {
    const store = new MemoryStore();
    const code = await withRecovery(store, "ana", "business");
    await makeAccount(store, "bob", "business"); // no recovery key
    const before = JSON.stringify(await store.load(await vaultIdFor("ana", "business")));
    await expect(recoverAccounts(store, "nobody", code, NEXT, FAST)).rejects.toThrow(NO_RECOVERY_MATCH_MESSAGE);
    await expect(recoverAccounts(store, "bob", code, NEXT, FAST)).rejects.toThrow(NO_RECOVERY_MATCH_MESSAGE);
    await expect(recoverAccounts(store, "ana", code.replace(/^./, (c) => (c === "A" ? "B" : "A")), NEXT, FAST)).rejects.toThrow(NO_RECOVERY_MATCH_MESSAGE);
    await expect(recoverAccounts(store, "ana", code, "short", FAST)).rejects.toMatchObject({ code: "WEAK_PASSPHRASE" });
    expect(JSON.stringify(await store.load(await vaultIdFor("ana", "business")))).toBe(before);
  });
});

describe("what a username can hold (Joshua, 2026-10-26)", () => {
  it("holds a person's worker and customer accounts together, each opening with the one login", async () => {
    const store = new MemoryStore();
    await makeAccount(store, "rowan", "worker");
    expect(await usernameConflict(store, "rowan", "customer")).toBeNull();
    await makeAccount(store, "rowan", "customer");
    const found = await findAccounts(store, "rowan", PASS, FAST);
    expect(found.map((f) => f.role).sort()).toEqual(["customer", "worker"]);
  });

  it("refuses a business on a person's username, and a person's account on a business's", async () => {
    const store = new MemoryStore();
    await makeAccount(store, "rowan", "customer");
    expect(await usernameConflict(store, "rowan", "business")).toMatch(/A business needs a username of its own/);
    await makeAccount(store, "cedar_co", "business");
    expect(await usernameConflict(store, "cedar_co", "worker")).toMatch(/belongs to a business/);
    expect(await usernameConflict(store, "cedar_co", "customer")).toMatch(/belongs to a business/);
    expect(await usernameConflict(store, "fresh", "business")).toBeNull();
  });

  it("keeps opening a business and a worker made on one username under the old rule", async () => {
    const store = new MemoryStore();
    await makeAccount(store, "old_pair", "business");
    await makeAccount(store, "old_pair", "worker");
    expect((await findAccounts(store, "old_pair", PASS, FAST)).map((f) => f.role).sort()).toEqual(["business", "worker"]);
  });

  it("gives a customer account its own vault, apart from the worker's", async () => {
    expect(await vaultIdFor("rowan", "customer")).not.toBe(await vaultIdFor("rowan", "worker"));
  });
});
