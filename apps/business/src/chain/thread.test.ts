// The thread through a fake mailbox: each side writes its own slots, reads the
// other's, keeps before it drops, and refuses what the other side may not send.
import { describe, expect, it } from "vitest";
import { MailboxError, lookupId, openReceipt, partiesKeyFromHex, receiptLookup, seal } from "@pnw/mailbox";
import { type Proposal, type Thread, type ThreadItem, addToThread, emptyThread, skipIncoming } from "../books/thread";
import { THREAD_KINDS, awaitingReceipts, postToThread, readThread } from "./thread";

const KEY = "ab".repeat(32);
const A = "aa".repeat(32);
const PROPOSAL: Proposal = { payType: "hourly", rate: "3400", frequency: "biweekly", startDate: "2026-11-09", termsText: "Carpenter.", letter: { description: "", requirements: "", handbook: "", other: "" } };
const NOW = () => new Date("2026-10-16T18:00:00.000Z");

function fakeMailbox() {
  const slots = new Map<string, Uint8Array<ArrayBuffer>>();
  const order: string[] = [];
  return {
    slots,
    order,
    async put(lookup: string, envelope: Uint8Array) {
      if (slots.has(lookup)) throw new MailboxError("CONFLICT", "taken");
      slots.set(lookup, new Uint8Array(envelope));
    },
    async get(lookup: string) {
      return slots.get(lookup) ?? null;
    },
    async drop(lookup: string) {
      order.push("drop");
      slots.delete(lookup);
    },
  };
}

/** One side's vault: the thread, updated as the read asks. */
function side() {
  let thread: Thread = emptyThread();
  return {
    get thread() {
      return thread;
    },
    keep: (item: ThreadItem) => (thread = addToThread(thread, item)),
    store: async (item: ThreadItem) => void (thread = addToThread(thread, item)),
    skip: async (seq: number) => void (thread = skipIncoming(thread, seq)),
  };
}

describe("the thread through the mailbox", () => {
  it("carries a request for changes to the business and an answer back, each side in its own slots", async () => {
    const box = fakeMailbox();
    const worker = side();
    const business = side();
    worker.keep(await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "counter", agreementId: A, proposal: PROPOSAL, note: "34?" }, now: NOW }));
    expect([...box.slots.keys()]).toEqual([lookupId(partiesKeyFromHex(KEY), THREAD_KINDS.worker, 0)]);

    const got = await readThread({ client: box, partiesKey: KEY, reader: "business", thread: business.thread, store: async (i) => { box.order.push("store"); await business.store(i); }, skip: business.skip, now: () => "2026-10-16T19:00:00.000Z" });
    expect(got.received).toHaveLength(1);
    expect(box.order).toEqual(["store", "drop"]);
    expect(business.thread.items[0]).toMatchObject({ mine: false, seq: 0, receivedAt: "2026-10-16T19:00:00.000Z", body: { type: "counter", proposal: PROPOSAL, note: "34?" } });
    expect(business.thread.nextIn).toBe(1);

    business.keep(await postToThread({ client: box, partiesKey: KEY, from: "business", nextOut: business.thread.nextOut, body: { type: "stands", agreementId: A, note: "Budget's set." }, now: () => new Date("2026-10-16T20:00:00.000Z") }));
    const back = await readThread({ client: box, partiesKey: KEY, reader: "worker", thread: worker.thread, store: worker.store, skip: worker.skip });
    expect(back.received.map((i) => i.body.type)).toEqual(["stands"]);
    expect(worker.thread.items.map((i) => [i.body.type, i.mine])).toEqual([["counter", true], ["stands", false]]);
    // Reading again finds nothing new.
    expect((await readThread({ client: box, partiesKey: KEY, reader: "worker", thread: worker.thread, store: worker.store, skip: worker.skip })).received).toEqual([]);
  });

  it("takes a message dated in the future as sent when it arrived, and keeps what arrived together in its slots' order", async () => {
    const box = fakeMailbox();
    const business = side();
    await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "text", text: "From next year" }, now: () => new Date("2027-10-16T18:00:00.000Z") });
    await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 1, body: { type: "text", text: "From today" }, now: NOW });
    await readThread({ client: box, partiesKey: KEY, reader: "business", thread: business.thread, store: business.store, skip: business.skip, now: () => "2026-10-16T19:00:00.000Z" });
    expect(business.thread.items.map((i) => [i.body.type === "text" ? i.body.text : "", i.sentAt])).toEqual([
      ["From next year", "2026-10-16T19:00:00.000Z"],
      ["From today", "2026-10-16T18:00:00.000Z"],
    ]);
  });

  it("puts a message where it arrived, whatever past time is written on it", async () => {
    const box = fakeMailbox();
    const business = side();
    await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "text", text: "The first one" }, now: () => new Date("2026-10-16T18:00:00.000Z") });
    await readThread({ client: box, partiesKey: KEY, reader: "business", thread: business.thread, store: business.store, skip: business.skip, now: () => "2026-10-16T19:00:00.000Z" });
    business.keep(await postToThread({ client: box, partiesKey: KEY, from: "business", nextOut: 0, body: { type: "text", text: "My answer" }, now: () => new Date("2026-10-16T20:00:00.000Z") }));
    // Sent after the answer, dated a fortnight before everything.
    await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 1, body: { type: "text", text: "Dated before the first" }, now: () => new Date("2026-10-02T08:00:00.000Z") });
    await readThread({ client: box, partiesKey: KEY, reader: "business", thread: business.thread, store: business.store, skip: business.skip, now: () => "2026-10-16T21:00:00.000Z" });
    expect(business.thread.items.map((i) => (i.body.type === "text" ? i.body.text : ""))).toEqual(["The first one", "My answer", "Dated before the first"]);
    // The time written on it is kept to show, and decides nothing.
    expect(business.thread.items.at(-1)).toMatchObject({ sentAt: "2026-10-02T08:00:00.000Z", receivedAt: "2026-10-16T21:00:00.000Z" });
  });

  it("steps over a slot that's already taken", async () => {
    const box = fakeMailbox();
    await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "counter", agreementId: A, proposal: PROPOSAL, note: "" } });
    const second = await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "counter", agreementId: A, proposal: PROPOSAL, note: "again" } });
    expect(second.seq).toBe(1);
  });

  it("takes a second letter under an id already here as nothing new, and says so when it says something else", async () => {
    const box = fakeMailbox();
    const business = side();
    const first = await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "text", text: "Twenty hours a week." }, now: NOW });
    await readThread({ client: box, partiesKey: KEY, reader: "business", thread: business.thread, store: business.store, skip: business.skip });
    // The same id again in the next two slots: once word for word (a letter sent twice), once reworded.
    await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 1, id: first.id, body: { type: "text", text: "Twenty hours a week." }, now: NOW });
    await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 2, id: first.id, body: { type: "text", text: "Forty hours a week." }, now: NOW });
    const r = await readThread({ client: box, partiesKey: KEY, reader: "business", thread: business.thread, store: business.store, skip: business.skip });
    expect(r.received).toEqual([]);
    expect(r.skipped).toEqual([{ seq: 2, message: expect.stringMatching(/reused the id/) }]);
    expect(business.thread.items.map((i) => (i.body.type === "text" ? i.body.text : ""))).toEqual(["Twenty hours a week."]);
    expect(business.thread.nextIn).toBe(3); // both slots are used up; neither is read again
    for (const seq of [0, 1, 2]) expect(box.slots.has(lookupId(partiesKeyFromHex(KEY), THREAD_KINDS.worker, seq))).toBe(false); // and their pins are gone
  });

  it("skips a slot that holds something the other side may not send, and moves on", async () => {
    const box = fakeMailbox();
    const key = partiesKeyFromHex(KEY);
    // A "stands" in the worker's slots: only a business may send one.
    const forged = await seal(key, THREAD_KINDS.worker, 0, new TextEncoder().encode(JSON.stringify({ version: 1, id: "0".repeat(32), from: "worker", sentAt: "2026-10-16T18:00:00.000Z", body: { type: "stands", agreementId: A, note: "" } })));
    box.slots.set(forged.lookup, forged.envelope);
    await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 1, body: { type: "counter", agreementId: A, proposal: PROPOSAL, note: "" } });
    const business = side();
    const r = await readThread({ client: box, partiesKey: KEY, reader: "business", thread: business.thread, store: business.store, skip: business.skip });
    expect(r.skipped).toEqual([{ seq: 0, message: expect.stringMatching(/can't send/) }]);
    expect(r.received.map((i) => i.seq)).toEqual([1]);
    expect(box.slots.has(forged.lookup)).toBe(true); // a skipped pin is left alone
    expect(business.thread.nextIn).toBe(2);
  });

  it("says so when the mailbox is off or fails", async () => {
    const off = { get: async () => { throw new MailboxError("NOT_CONFIGURED", "off"); }, drop: async () => {} };
    const s = side();
    expect(await readThread({ client: off, partiesKey: KEY, reader: "business", thread: undefined, store: s.store, skip: s.skip })).toEqual({ received: [], skipped: [], off: true });
    const down = { get: async () => { throw new MailboxError("REQUEST_FAILED", "failed (502)"); }, drop: async () => {} };
    expect(await readThread({ client: down, partiesKey: KEY, reader: "business", thread: undefined, store: s.store, skip: s.skip })).toMatchObject({ failed: "failed (502)" });
    const full = { put: async () => { throw new MailboxError("CONFLICT", "taken"); } };
    await expect(postToThread({ client: full, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "counter", agreementId: A, proposal: PROPOSAL, note: "" } })).rejects.toThrow(/free slot/);
  });
});

describe("messages and their receipts", () => {
  it("a message read here sends a receipt back, and the sender knows which to look for", async () => {
    const box = fakeMailbox();
    const worker = side();
    worker.keep(await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "text", text: "Running late" }, now: NOW }));
    expect(awaitingReceipts(worker.thread, KEY, "worker")).toEqual([{ partiesKey: KEY, kind: THREAD_KINDS.worker, seq: 0, target: 0 }]);
    const business = side();
    await readThread({ client: box, partiesKey: KEY, reader: "business", thread: business.thread, store: business.store, skip: business.skip });
    const key = partiesKeyFromHex(KEY);
    const receipt = box.slots.get(receiptLookup(key, THREAD_KINDS.worker, 0));
    expect(receipt).toBeDefined();
    expect((await openReceipt(key, THREAD_KINDS.worker, 0, receipt!)).version).toBe(1);
  });
});

describe("group chat kinds", () => {
  it("are refused in a business-and-person thread", async () => {
    const box = fakeMailbox();
    await postToThread({ client: box, partiesKey: KEY, from: "business", nextOut: 0, body: { type: "group_text", groupId: "1".repeat(16), text: "sneaky" } });
    const s = side();
    const r = await readThread({ client: box, partiesKey: KEY, reader: "worker", thread: s.thread, store: s.store, skip: s.skip });
    expect(r.received).toEqual([]);
    expect(r.skipped).toEqual([{ seq: 0, message: expect.stringMatching(/doesn't belong/) }]);
  });
});
