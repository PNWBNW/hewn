import { describe, expect, it } from "vitest";
import { VaultError, addRecovery, createVault, keySlotsOf, openKeySlots, openKeySlotsWithRecovery, resetWithRecovery, unlockVault } from "./vault";

const SECRET = "hewn:v1\nalder\ncorrect horse battery staple";
const opts = { id: "acct-slots", iterations: 1000 };

describe("a vault's key slots, for backups kept elsewhere", () => {
  it("hold no books, and the passphrase opens them into a session that rebuilds the same vault", async () => {
    const made = await createVault(SECRET, JSON.stringify({ books: "october" }), opts);
    const piece = await made.sealAttachment("bb-0-0", new TextEncoder().encode("a backup piece"));
    const slots = keySlotsOf(made.record);
    expect(JSON.stringify(slots)).not.toContain(made.record.payload.data);
    expect(Object.keys(slots).sort()).toEqual(["id", "kdf", "wrappedKey"]);

    const session = await openKeySlots(JSON.parse(JSON.stringify(slots)), SECRET);
    expect(new TextDecoder().decode(await session.openAttachment(piece))).toBe("a backup piece");
    const rebuilt = await session.write(JSON.stringify({ books: "restored" }));
    // The rebuilt vault opens with the same passphrase, its keys unchanged.
    expect(rebuilt.wrappedKey).toEqual(made.record.wrappedKey);
    expect(await (await unlockVault(rebuilt, SECRET)).read()).toContain("restored");
  });

  it("refuses the wrong passphrase, and a slots-only session can't read books it was never given", async () => {
    const made = await createVault(SECRET, "{}", opts);
    await expect(openKeySlots(keySlotsOf(made.record), "hewn:v1\nalder\nwrong passphrase here")).rejects.toMatchObject({ code: "WRONG_PASSPHRASE" });
    const session = await openKeySlots(keySlotsOf(made.record), SECRET);
    await expect(session.read()).rejects.toBeInstanceOf(VaultError);
  });

  it("open with the recovery key too, and the restore then sets a new passphrase", async () => {
    const made = await createVault(SECRET, "{}", opts);
    const { record, code } = await addRecovery(made.record, SECRET);
    const piece = await made.sealAttachment("bb-0-0", new TextEncoder().encode("piece"));
    const slots = keySlotsOf(record);
    expect(slots.recovery).toBeDefined();

    const session = await openKeySlotsWithRecovery(slots, code);
    expect(new TextDecoder().decode(await session.openAttachment(piece))).toBe("piece");
    const written = await session.write(JSON.stringify({ books: "restored" }));
    const reset = await resetWithRecovery(written, code, "hewn:v1\nalder\na brand new passphrase 42!", { iterations: 1000 });
    expect(await (await unlockVault(reset, "hewn:v1\nalder\na brand new passphrase 42!")).read()).toContain("restored");

    await expect(openKeySlotsWithRecovery(slots, "AAAA-BBBB-CCCC-DDDD")).rejects.toMatchObject({ code: "WRONG_RECOVERY_KEY" });
    await expect(openKeySlotsWithRecovery(keySlotsOf(made.record), code)).rejects.toMatchObject({ code: "WRONG_RECOVERY_KEY" });
  });
});
