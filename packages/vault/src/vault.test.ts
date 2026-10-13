import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { DB_NAME, IndexedDbStore, MemoryStore } from "./store";
import {
  type SealedAttachment,
  type VaultRecord,
  KDF_ITERATIONS,
  changePassphrase,
  createVault,
  exportBackup,
  parseBackup,
  sha256Hex,
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
    expect(restored.attachments).toEqual([]);
    expect(await (await unlockVault(restored.record, PASS)).read()).toBe("books");
  });

  it("version 2 carries the sealed attachments, still encrypted, and they open after restore", async () => {
    const s = await createVault(PASS, "books", FAST);
    const photo = bytes(5000);
    const sealed = await s.sealAttachment("att-1", photo);
    const file = exportBackup(s.record, [sealed]);
    expect(JSON.parse(file)).toMatchObject({ format: "pnw-vault-backup", version: 2 });
    expect(file).not.toContain(b64(photo.subarray(0, 300)));
    const restored = parseBackup(file);
    const opened = await unlockVault(restored.record, PASS);
    expect(await opened.openAttachment(restored.attachments[0]!)).toEqual(photo);
  });

  it("still restores version-1 files (the bare record)", async () => {
    const s = await createVault(PASS, "old books", FAST);
    const v1 = JSON.stringify(s.record, null, 2);
    const restored = parseBackup(v1);
    expect(restored.attachments).toEqual([]);
    expect(await (await unlockVault(restored.record, PASS)).read()).toBe("old books");
  });

  it("rejects files that aren't backups", async () => {
    const s = await createVault(PASS, "books", FAST);
    const v2 = JSON.parse(exportBackup(s.record));
    for (const bad of [
      "",
      "{}",
      "[1,2]",
      '{"format":"pnw-vault","version":2}',
      JSON.stringify({ ...v2, record: { ...v2.record, format: "x" } }),
      JSON.stringify({ ...v2, attachments: [{ id: "a:b", iv: "", data: "" }] }),
    ]) {
      expect(() => parseBackup(bad), bad).toThrow(code("NOT_A_VAULT"));
    }
    expect(() => parseBackup(JSON.stringify({ ...v2, version: 3 }))).toThrow(/newer version/);
  });
});

/** Deterministic test bytes. */
function bytes(n: number, seed = 7): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

function b64(u: Uint8Array): string {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}

describe("attachments", () => {
  it("round-trip with the same data key, and fresh IVs each time", async () => {
    const s = await createVault(PASS, "books", FAST);
    const photo = bytes(300_000);
    const a = await s.sealAttachment("att-1", photo);
    const b = await s.sealAttachment("att-1", photo);
    expect(a.iv).not.toBe(b.iv);
    expect(await s.openAttachment(a)).toEqual(photo);
    // The same key after a fresh unlock (it's the data key, not a per-file key).
    expect(await (await unlockVault(s.record, PASS)).openAttachment(a)).toEqual(photo);
    expect(JSON.stringify(a)).not.toContain(b64(photo.subarray(0, 300)));
  });

  it("fail in another vault, under another id or in the payload slot", async () => {
    const s = await createVault(PASS, "books", { ...FAST, id: "a" });
    const other = await createVault(PASS, "books", { ...FAST, id: "b" });
    const sealed = await s.sealAttachment("att-1", bytes(100));
    await expect(other.openAttachment(sealed)).rejects.toThrow(code("CORRUPT"));
    await expect(s.openAttachment({ ...sealed, id: "att-2" })).rejects.toThrow(code("CORRUPT"));
    // Same vault id and key, but sealed as data: the role in the associated data differs.
    await expect(unlockVault({ ...s.record, payload: { iv: sealed.iv, data: sealed.data } }, PASS)).rejects.toThrow(code("CORRUPT"));
    await expect(s.sealAttachment("bad:id", bytes(1))).rejects.toThrow(code("CORRUPT"));
  });

  it("detect tampering", async () => {
    const s = await createVault(PASS, "books", FAST);
    const sealed = await s.sealAttachment("att-1", bytes(1000));
    const raw = atob(sealed.data);
    const flipped = raw.slice(0, 500) + String.fromCharCode(raw.charCodeAt(500) ^ 1) + raw.slice(501);
    await expect(s.openAttachment({ ...sealed, data: btoa(flipped) })).rejects.toThrow(code("CORRUPT"));
    await expect(s.openAttachment({ ...sealed, data: btoa(raw.slice(0, -1)) })).rejects.toThrow(code("CORRUPT"));
  });

  it("can't be sealed or opened once locked", async () => {
    const s = await createVault(PASS, "books", FAST);
    const sealed = await s.sealAttachment("att-1", bytes(10));
    s.lock();
    await expect(s.openAttachment(sealed)).rejects.toThrow();
    await expect(s.sealAttachment("att-2", bytes(10))).rejects.toThrow();
  });

  it("hashes with SHA-256", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
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

    it(`${name}: keeps sealed attachments per vault, and replaces them all on restore`, async () => {
      const store = make();
      const s = await createVault(PASS, "books", { ...FAST, id: `a-${name}` });
      await store.save(s.record);
      const one = await s.sealAttachment("att-1", bytes(10, 1));
      const two = await s.sealAttachment("att-2", bytes(10, 2));
      await store.saveAttachment(s.id, one);
      await store.saveAttachment(s.id, two);
      await store.saveAttachment("someone-else", { ...one, data: "x" });
      expect(await store.loadAttachment(s.id, "att-1")).toEqual(one);
      expect((await store.listAttachments(s.id)).map((a) => a.id).sort()).toEqual(["att-1", "att-2"]);
      await store.removeAttachment(s.id, "att-1");
      expect(await store.loadAttachment(s.id, "att-1")).toBeNull();
      const three = await s.sealAttachment("att-3", bytes(10, 3));
      await store.replace(s.record, [two, three]);
      expect((await store.listAttachments(s.id)).map((a) => a.id).sort()).toEqual(["att-2", "att-3"]);
      await store.replace(s.record, []);
      expect(await store.listAttachments(s.id)).toEqual([]);
      await store.saveAttachment(s.id, one);
      await store.remove(s.id);
      expect(await store.listAttachments(s.id)).toEqual([]);
      expect(await store.listAttachments("someone-else")).toHaveLength(1);
    });
  }

  it("indexeddb: upgrades a version-1 database in place, keeping the books", async () => {
    const factory = new IDBFactory();
    const s = await createVault(PASS, "books from v1", { ...FAST, id: "default" });
    // What the previous release created: version 1, the vaults store only.
    await new Promise<void>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("vaults", { keyPath: "id" });
      req.onsuccess = () => {
        const tx = req.result.transaction("vaults", "readwrite");
        tx.objectStore("vaults").put(s.record);
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    const store = new IndexedDbStore(factory);
    expect(await (await unlockVault((await store.load("default"))!, PASS)).read()).toBe("books from v1");
    const sealed: SealedAttachment = await s.sealAttachment("att-1", bytes(64));
    await store.saveAttachment("default", sealed);
    expect(await store.loadAttachment("default", "att-1")).toEqual(sealed);
  });
});
