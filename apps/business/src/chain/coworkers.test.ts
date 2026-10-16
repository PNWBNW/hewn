// Coworkers: the key only two of them can make, the safety code they compare,
// and a conversation through a fake mailbox that only plain messages enter.
import { describe, expect, it } from "vitest";
import { MailboxError, partiesKeyFromHex, seal } from "@pnw/mailbox";
import { validateIdentity } from "../books/directory";
import { type Thread, type ThreadItem, addToThread, emptyThread, skipIncoming } from "../books/thread";
import { COWORKER_KINDS, coworkerAccepts, mySide, newIdentity, pairKey, safetyCode } from "./coworkers";
import { postToThread, readThread } from "./thread";

function fakeMailbox() {
  const slots = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    slots,
    async put(lookup: string, envelope: Uint8Array) {
      if (slots.has(lookup)) throw new MailboxError("CONFLICT", "taken");
      slots.set(lookup, new Uint8Array(envelope));
    },
    async get(lookup: string) {
      return slots.get(lookup) ?? null;
    },
    async drop(lookup: string) {
      slots.delete(lookup);
    },
  };
}

describe("coworker keys", () => {
  it("make the same pair key on both sides, and a different one with anyone else", async () => {
    const [ana, bo, cy] = await Promise.all([newIdentity("Ana"), newIdentity("Bo"), newIdentity("Cy")]);
    expect(ana.publicKey).toMatch(/^04[0-9a-f]{128}$/);
    const ab = await pairKey(ana, bo.publicKey);
    expect(ab).toMatch(/^[0-9a-f]{64}$/);
    expect(await pairKey(bo, ana.publicKey)).toBe(ab);
    expect(await pairKey(ana, cy.publicKey)).not.toBe(ab);
    expect(validateIdentity(JSON.parse(JSON.stringify(ana)))).toEqual(ana);
  });

  it("give each side its own slots, and refuse their own key", async () => {
    const [ana, bo] = await Promise.all([newIdentity("Ana"), newIdentity("Bo")]);
    const a = mySide(ana.publicKey, bo.publicKey);
    const b = mySide(bo.publicKey, ana.publicKey);
    expect(new Set([a, b])).toEqual(new Set(["business", "worker"]));
    expect(() => mySide(ana.publicKey, ana.publicKey)).toThrow(/own key/);
    await expect(pairKey(ana, "04nope")).rejects.toThrow(/public key/);
  });

  it("show the same safety code on both phones, and a different one when a key was swapped", async () => {
    const [ana, bo, mallory] = await Promise.all([newIdentity("Ana"), newIdentity("Bo"), newIdentity("M")]);
    const code = await safetyCode(ana.publicKey, bo.publicKey);
    expect(code).toMatch(/^\d{5}( \d{5}){5}$/);
    expect(await safetyCode(bo.publicKey, ana.publicKey)).toBe(code);
    expect(await safetyCode(ana.publicKey, mallory.publicKey)).not.toBe(code);
  });
});

describe("a coworker conversation through the mailbox", () => {
  it("carries plain messages both ways, and skips anything else", async () => {
    const [ana, bo] = await Promise.all([newIdentity("Ana"), newIdentity("Bo")]);
    const key = await pairKey(ana, bo.publicKey);
    const box = fakeMailbox();
    const anaSide = mySide(ana.publicKey, bo.publicKey);
    const boSide = mySide(bo.publicKey, ana.publicKey);
    await postToThread({ client: box, partiesKey: key, from: anaSide, nextOut: 0, body: { type: "text", text: "Lunch?" }, kinds: COWORKER_KINDS });
    // Something that isn't a plain message, in Ana's next slot.
    const forged = await seal(partiesKeyFromHex(key), COWORKER_KINDS[anaSide], 1, new TextEncoder().encode(JSON.stringify({
      version: 1, id: "1".repeat(32), from: anaSide, sentAt: "2026-10-16T12:00:00.000Z",
      body: anaSide === "business" ? { type: "stands", agreementId: "aa".repeat(32), note: "" } : { type: "counter", agreementId: "aa".repeat(32), note: "", proposal: { payType: "hourly", rate: "1", frequency: "weekly", startDate: "2026-11-02", termsText: "x", letter: { description: "", requirements: "", handbook: "", other: "" } } },
    })));
    box.slots.set(forged.lookup, forged.envelope);
    await postToThread({ client: box, partiesKey: key, from: anaSide, nextOut: 2, body: { type: "text", text: "12:30?" }, kinds: COWORKER_KINDS });

    let thread: Thread = emptyThread();
    const r = await readThread({
      client: box,
      partiesKey: key,
      reader: boSide,
      thread,
      kinds: COWORKER_KINDS,
      accept: coworkerAccepts,
      store: async (i: ThreadItem) => void (thread = addToThread(thread, i)),
      skip: async (seq) => void (thread = skipIncoming(thread, seq)),
    });
    expect(r.received.map((i) => (i.body.type === "text" ? i.body.text : i.body.type))).toEqual(["Lunch?", "12:30?"]);
    expect(r.skipped).toEqual([{ seq: 1, message: expect.stringMatching(/doesn't belong/) }]);
    // A business-and-person thread under the same key would use other slots entirely.
    expect(COWORKER_KINDS.business).not.toBe("thread_b");
  });
});
