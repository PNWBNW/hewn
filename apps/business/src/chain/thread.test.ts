// The thread through a fake mailbox: each side writes its own slots, reads the
// other's, keeps before it drops, and refuses what the other side may not send.
import { describe, expect, it } from "vitest";
import { MailboxError, lookupId, partiesKeyFromHex, seal } from "@pnw/mailbox";
import { type Proposal, type Thread, type ThreadItem, addToThread, emptyThread, skipIncoming } from "../books/thread";
import { THREAD_KINDS, postToThread, readThread } from "./thread";

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

  it("steps over a slot that's already taken", async () => {
    const box = fakeMailbox();
    await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "counter", agreementId: A, proposal: PROPOSAL, note: "" } });
    const second = await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "counter", agreementId: A, proposal: PROPOSAL, note: "again" } });
    expect(second.seq).toBe(1);
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
