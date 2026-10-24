// The recovery key (vault.ts addRecovery / resetWithRecovery, recovery_code.ts): a forgotten
// passphrase replaced, and every way the code must fail.

import { describe, expect, it } from "vitest";
import { formatRecoveryCode, parseRecoveryCode } from "./recovery_code";
import { addRecovery, changePassphrase, createVault, exportBackup, parseBackup, removeRecovery, resetWithRecovery, unlockVault } from "./vault";

const FAST = { iterations: 1_000 };
const PASS = "correct horse battery";
const NEXT = "a brand new phrase";
const code = (c: string) => expect.objectContaining({ code: c });

describe("the recovery code", () => {
  it("is 28 characters in seven groups and reads back, forgiving case, spaces and look-alikes", async () => {
    const secret = new Uint8Array(16).map((_, i) => i * 17);
    const text = await formatRecoveryCode(secret);
    expect(text).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/);
    expect(await parseRecoveryCode(text)).toEqual(secret);
    expect(await parseRecoveryCode(` ${text.toLowerCase().replace(/-/g, " ")} `)).toEqual(secret);
    expect(await parseRecoveryCode(text.replace(/1/g, "l").replace(/0/g, "O"))).toEqual(secret);
  });

  it("refuses a typo, a wrong length or a stray letter before any key work", async () => {
    const text = await formatRecoveryCode(new Uint8Array(16).fill(7));
    const flip = (t: string, i: number) => t.slice(0, i) + (t[i] === "A" ? "B" : "A") + t.slice(i + 1);
    let caught = 0;
    for (let i = 0; i < text.length; i++) if (text[i] !== "-" && (await parseRecoveryCode(flip(text, i))) === null) caught++;
    expect(caught).toBeGreaterThanOrEqual(26); // the check byte misses about 1 typo in 256
    expect(await parseRecoveryCode(text.slice(0, -1))).toBeNull();
    expect(await parseRecoveryCode(text + "A")).toBeNull();
    expect(await parseRecoveryCode(text.replace(/.$/, "U"))).toBeNull();
  });
});

describe("a recovery key for the books", () => {
  it("replaces a forgotten passphrase without re-encrypting the books, and keeps working after", async () => {
    const s = await createVault(PASS, "the books", FAST);
    const { record, code: key } = await addRecovery(s.record, PASS, "2026-10-24T10:00:00.000Z");
    expect(record.recovery?.createdAt).toBe("2026-10-24T10:00:00.000Z");
    expect(record.payload).toEqual(s.record.payload);
    expect(JSON.stringify(record)).not.toContain(key.replace(/-/g, ""));
    // The passphrase still opens it as before.
    expect(await (await unlockVault(record, PASS)).read()).toBe("the books");
    const reset = await resetWithRecovery(record, key, NEXT, FAST);
    expect(reset.payload).toEqual(record.payload);
    expect(await (await unlockVault(reset, NEXT)).read()).toBe("the books");
    await expect(unlockVault(reset, PASS)).rejects.toThrow(code("WRONG_PASSPHRASE"));
    expect(await (await unlockVault(await resetWithRecovery(reset, key, "a third phrase now", FAST), "a third phrase now")).read()).toBe("the books");
  });

  it("travels in backups and survives a passphrase change", async () => {
    const s = await createVault(PASS, "books", FAST);
    const { record, code: key } = await addRecovery(s.record, PASS);
    const restored = parseBackup(exportBackup(await changePassphrase(record, PASS, "changed phrase here", FAST))).record;
    expect(await (await unlockVault(await resetWithRecovery(restored, key, NEXT, FAST), NEXT)).read()).toBe("books");
  });

  it("must fail: a wrong passphrase can't make one, and a mistyped, other books', replaced or removed key opens nothing", async () => {
    const s = await createVault(PASS, "books", FAST);
    await expect(addRecovery(s.record, "not the passphrase")).rejects.toThrow(code("WRONG_PASSPHRASE"));
    const first = await addRecovery(s.record, PASS);
    const second = await addRecovery(first.record, PASS);
    await expect(resetWithRecovery(second.record, first.code, NEXT, FAST)).rejects.toThrow(code("WRONG_RECOVERY_KEY"));
    await expect(resetWithRecovery(second.record, "ABCD-EFGH", NEXT, FAST)).rejects.toThrow(code("WRONG_RECOVERY_KEY"));
    // Another vault's key, and the same key on a copy of this record under another id.
    const other = await addRecovery((await createVault(PASS, "other", FAST)).record, PASS);
    await expect(resetWithRecovery(second.record, other.code, NEXT, FAST)).rejects.toThrow(code("WRONG_RECOVERY_KEY"));
    await expect(resetWithRecovery({ ...second.record, id: "elsewhere" }, second.code, NEXT, FAST)).rejects.toThrow(code("WRONG_RECOVERY_KEY"));
    // Books without one, and after it was taken away (which takes the passphrase).
    await expect(resetWithRecovery(s.record, second.code, NEXT, FAST)).rejects.toThrow(code("WRONG_RECOVERY_KEY"));
    await expect(removeRecovery(second.record, "not the passphrase")).rejects.toThrow(code("WRONG_PASSPHRASE"));
    const removed = await removeRecovery(second.record, PASS);
    expect(removed.recovery).toBeUndefined();
    await expect(resetWithRecovery(removed, second.code, NEXT, FAST)).rejects.toThrow(code("WRONG_RECOVERY_KEY"));
    // A weak new passphrase is refused before anything else.
    await expect(resetWithRecovery(second.record, second.code, "short", FAST)).rejects.toThrow(code("WEAK_PASSPHRASE"));
  });

  it("refuses a record whose recovery slot isn't one", async () => {
    const s = await createVault(PASS, "books", FAST);
    const { record } = await addRecovery(s.record, PASS);
    const broken = { ...record, recovery: { ...record.recovery!, kdf: "PBKDF2" } };
    expect(() => parseBackup(exportBackup(broken as never))).toThrow(code("NOT_A_VAULT"));
  });
});
