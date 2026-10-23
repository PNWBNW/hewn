import { describe, expect, it } from "vitest";
import { validateConversationBackup } from "./conversation_backup";
import { type KeyRing, halvesNeeded, noteBackup, pairsBefore } from "./key_ring";

const backup = {
  version: 1,
  kind: "conversation_backup",
  partiesKey: "ab".repeat(32),
  side: "worker",
  peer: "aleo1" + "b".repeat(58),
  keys: ["cd".repeat(32)],
  requestId: "1".repeat(32),
  madeAt: "2026-10-23T12:00:00.000Z",
};

describe("what a conversation backup holds", () => {
  it("is the conversation and the keys it covers, nothing else", () => {
    expect(validateConversationBackup({ ...backup, extra: "dropped" })).toEqual(backup);
  });

  it("refuses anything that isn't one", () => {
    for (const bad of [
      null,
      { ...backup, kind: "vault" },
      { ...backup, version: 2 },
      { ...backup, partiesKey: "short" },
      { ...backup, side: "admin" },
      { ...backup, peer: "not-an-account" },
      { ...backup, keys: ["nope"] },
      { ...backup, keys: Array.from({ length: 33 }, () => "cd".repeat(32)) },
      { ...backup, requestId: "x" },
      { ...backup, madeAt: "yesterday" },
    ]) {
      expect(() => validateConversationBackup(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("the key ring around a backup", () => {
  const half = (n: string) => ({ publicKey: "04" + n.repeat(128), privateKey: { kty: "EC", crv: "P-256", x: "x", y: "y", d: "d" } });
  const old = { mine: half("1"), theirs: "04" + "2".repeat(128), sent: true as const, nextIn: 3, nextOut: 2, createdAt: "2026-10-23T10:00:00.000Z" };
  const ring: KeyRing = { pairs: [old], out: "1".repeat(16) };

  it("starts fresh keys only on the side that allowed, once", () => {
    expect(halvesNeeded(ring).start).toBe(false);
    const allowed = noteBackup(ring, "a".repeat(32), "2026-10-23T12:00:00.000Z", true);
    expect(halvesNeeded(allowed).start).toBe(true);
    expect(noteBackup(allowed, "a".repeat(32), "2026-10-23T12:05:00.000Z", true)).toBe(allowed);
    const asked = noteBackup(ring, "a".repeat(32), "2026-10-23T12:00:00.000Z", false);
    expect(halvesNeeded(asked).start).toBe(false);
    expect(asked.backups).toEqual([{ requestId: "a".repeat(32), at: "2026-10-23T12:00:00.000Z" }]);
  });

  it("doesn't start again while its fresh start is still waiting for an answer", () => {
    const waiting: KeyRing = { ...noteBackup(ring, "a".repeat(32), "2026-10-23T12:00:00.000Z", true), pairs: [old, { mine: half("3"), nextIn: 0, nextOut: 0, createdAt: "2026-10-23T12:01:00.000Z" }] };
    expect(halvesNeeded(waiting).start).toBe(false);
  });

  it("covers only the pairs made before both agreed", () => {
    const fresh = { mine: half("4"), theirs: "04" + "5".repeat(128), sent: true as const, nextIn: 0, nextOut: 0, createdAt: "2026-10-23T12:10:00.000Z" };
    const after: KeyRing = { pairs: [old, fresh], out: "4".repeat(16) };
    expect(pairsBefore(after, "2026-10-23T12:00:00.000Z")).toEqual([old]);
    expect(pairsBefore(after, "2026-10-23T13:00:00.000Z")).toEqual([fresh, old]);
  });
});
