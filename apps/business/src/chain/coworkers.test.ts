// Coworkers: the key only two of them can make, the safety code they compare,
// and a conversation through a fake mailbox that only plain messages enter.
import { describe, expect, it } from "vitest";
import { MailboxError, partiesKeyFromHex, seal } from "@pnw/mailbox";
import { validateIdentity } from "../books/directory";
import { COWORKER_TYPES, type Thread, type ThreadBody, type ThreadItem, addToThread, emptyThread, skipIncoming } from "../books/thread";
import { emptyWork, updateCoworker } from "../books/work";
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

describe("what a coworker sends, into the vault", () => {
  it("keeps every kind the reader takes: a report notice, an event's key and an answer, group chats", async () => {
    const [ana, bo] = await Promise.all([newIdentity("Ana"), newIdentity("Bo")]);
    const key = await pairKey(ana, bo.publicKey);
    const box = fakeMailbox();
    const anaSide = mySide(ana.publicKey, bo.publicKey);
    const bodies: ThreadBody[] = [
      { type: "text", text: "Lunch?" },
      { type: "report_notice", messageId: "1".repeat(32), category: "spam" },
      { type: "event_key", circleId: "f".repeat(16), epoch: 0, key: "c3".repeat(32) },
      { type: "event_answer", eventId: "2".repeat(32), rev: 1, title: "Site walkthrough", answer: "yes", note: "" },
      { type: "group", groupId: "a".repeat(16), name: "Crew", admin: ana.publicKey, members: [{ name: "Ana", publicKey: ana.publicKey }, { name: "Bo", publicKey: bo.publicKey }] },
      { type: "group_text", groupId: "a".repeat(16), text: "Hi all" },
    ];
    for (const [i, body] of bodies.entries()) await postToThread({ client: box, partiesKey: key, from: anaSide, nextOut: i, body, kinds: COWORKER_KINDS });
    // Bo's vault: each one goes through the same update the message check uses, which checks the whole work file.
    let work = emptyWork("Bo");
    const r = await readThread({
      client: box,
      partiesKey: key,
      reader: mySide(bo.publicKey, ana.publicKey),
      thread: undefined,
      kinds: COWORKER_KINDS,
      accept: coworkerAccepts,
      store: async (item) => void (work = updateCoworker(work, ana.publicKey, { businessKey: "b2".repeat(32), name: "Ana" }, (t) => ({ ...t, ...addToThread(t, item) }))),
      skip: async () => {},
    });
    expect(r.failed).toBeUndefined();
    expect(work.coworkers?.[ana.publicKey]?.items.map((i) => i.body.type)).toEqual(bodies.map((b) => b.type));
    // Nothing the reader takes is something the vault refuses.
    expect(COWORKER_TYPES.every((t) => coworkerAccepts({ type: t } as ThreadBody))).toBe(true);
  });
});
