import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IndexedDbStore, MemoryStore } from "./store";
import {
  type VaultRecord,
  KDF_ITERATIONS,
  changePassphrase,
  createVault,
  exportBackup,
  parseBackup,
  unlockVault,
} from "./vault";

// Low rounds keep tests fast; production default is checked separately.
const FAST = { iterations: 1_000 };
const PASS = "correct horse battery";
const code = (c: string) => expect.objectContaining({ code: c });

describe("vault", () => {
  it("defaults to 600k PBKDF2 rounds", async () => {
    expect(KDF_ITERATIONS).toBe(600_000);
    const s = await createVault(PASS, "x", {});
    expect(s.record.kdf.iterations).toBe(600_000);
  });

  it("round-trips contents with the right passphrase", async () => {
    const s = await createVault(PASS, "the books", FAST);
    const reopened = await unlockVault(s.record, PASS);
    expect(await reopened.read()).toBe("the books");
  });

  it("stores no plaintext", async () => {
    const s = await createVault(PASS, "Acme Plumbing payroll 4,321.00", FAST);
    const stored = JSON.stringify(s.record);
    expect(stored).not.toContain("Acme");
    expect(stored).not.toContain("4,321");
    expect(stored).not.toContain(PASS);
  });

  it("refuses a wrong passphrase", async () => {
    const s = await createVault(PASS, "x", FAST);
    await expect(unlockVault(s.record, "correct horse battery!")).rejects.toThrow(code("WRONG_PASSPHRASE"));
  });

  it("refuses a short passphrase at creation", async () => {
    await expect(createVault("short", "x", FAST)).rejects.toThrow(code("WEAK_PASSPHRASE"));
  });

  it("treats visually identical passphrases the same (Unicode normalization)", async () => {
    const composed = "café au lait!"; // é as one code point
    const decomposed = "café au lait!"; // e + combining accent
    const s = await createVault(composed, "x", FAST);
    expect(await (await unlockVault(s.record, decomposed)).read()).toBe("x");
  });

  it("uses a fresh IV for every save", async () => {
    const s = await createVault(PASS, "same", FAST);
    const first = s.record.payload.iv;
    await s.write("same");
    expect(s.record.payload.iv).not.toBe(first);
  });

  it("detects a tampered payload", async () => {
    const s = await createVault(PASS, "x", FAST);
    const bytes = atob(s.record.payload.data);
    const flipped = String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1);
    const forged: VaultRecord = { ...s.record, payload: { ...s.record.payload, data: btoa(flipped) } };
    await expect(unlockVault(forged, PASS)).rejects.toThrow(code("CORRUPT"));
  });

  it("can't move ciphertext between vaults", async () => {
    const a = await createVault(PASS, "A's books", { ...FAST, id: "a" });
    const b = await createVault(PASS, "B's books", { ...FAST, id: "b" });
    // Put A's payload inside B's record: the associated data no longer matches.
    await expect(unlockVault({ ...b.record, payload: a.record.payload }, PASS)).rejects.toThrow(code("CORRUPT"));
  });

  it("can't be read once locked", async () => {
    const s = await createVault(PASS, "x", FAST);
    s.lock();
    expect(s.locked).toBe(true);
    await expect(s.read()).rejects.toThrow(code("WRONG_PASSPHRASE"));
  });

  it("never exposes an exportable data key", async () => {
    const s = await createVault(PASS, "x", FAST);
    const key = (s as unknown as Record<string, unknown>)["key"];
    expect(key).toBeUndefined(); // private field, not a property
    expect(Object.keys(s)).toEqual([]);
  });

  it("changes passphrase without re-encrypting the books", async () => {
    const s = await createVault(PASS, "books", FAST);
    const next = await changePassphrase(s.record, PASS, "a brand new phrase", FAST);
    expect(next.payload).toEqual(s.record.payload);
    expect(await (await unlockVault(next, "a brand new phrase")).read()).toBe("books");
    await expect(unlockVault(next, PASS)).rejects.toThrow(code("WRONG_PASSPHRASE"));
    await expect(changePassphrase(s.record, "wrong wrong wrong", "whatever123", FAST)).rejects.toThrow(code("WRONG_PASSPHRASE"));
  });
});

describe("backups", () => {
  it("export → import on a fresh device opens with the same passphrase", async () => {
    const s = await createVault(PASS, "books", FAST);
    const file = exportBackup(s.record);
    const restored = parseBackup(file);
    expect(await (await unlockVault(restored, PASS)).read()).toBe("books");
  });

  it("rejects files that aren't backups", () => {
    for (const bad of ["", "{}", "[1,2]", '{"format":"pnw-vault","version":2}']) {
      expect(() => parseBackup(bad), bad).toThrow(code("NOT_A_VAULT"));
    }
  });
});

describe("stores", () => {
  for (const [name, make] of [
    ["memory", () => new MemoryStore()],
    ["indexeddb", () => new IndexedDbStore()],
  ] as const) {
    it(`${name}: saves, loads and removes sealed records`, async () => {
      const store = make();
      const s = await createVault(PASS, "books", { ...FAST, id: `t-${name}` });
      expect(await store.load(s.id)).toBeNull();
      await store.save(s.record);
      const loaded = await store.load(s.id);
      expect(await (await unlockVault(loaded!, PASS)).read()).toBe("books");
      await store.remove(s.id);
      expect(await store.load(s.id)).toBeNull();
    });
  }
});
