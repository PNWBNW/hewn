// The thread between a business and one person over letters on chain: a fake
// network that turns each `send` / `send_page` into the records Shield would
// list, and each side's wallet reading only what it owns.
import { describe, expect, it } from "vitest";
import { type Proposal, type Thread, type ThreadItem, addToThread, emptyThread, skipIncoming } from "../books/thread";
import { LETTERS_PROGRAM, LetterBox, type LetterWallet, ManyLetterBox, SEND_MANY_FUNCTION, SEND_PAGE_FUNCTION, letterReader, letterThread } from "./letters";
import { addReceivedPost, newChannel, skipPost } from "../books/channels";
import { type Work, emptyWork, updateWorkThread, workThread } from "../books/work";
import { postToChannel, readChannel, sendChannelKey } from "./channels";
import { packPayload } from "./compress";
import { postToThread, readThread } from "./thread";

const KEY = "ab".repeat(32);
const A = "aa".repeat(32);
const BUSINESS = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const WORKER = "aleo1" + "w".repeat(58);
const fast = { sleep: async () => {}, pollMs: 1 };

/** The network: every letter sent, as the records it made. */
function network() {
  // Each record remembers who sent it: Shield shows its owner the sender.
  const records: { owner: string; name: "Letter" | "SentLetter" | "Page"; lookup: string; parcel: string; from: string }[] = [];
  const calls: { function: string; feeMode?: string }[] = [];
  const wallet = (me: string): LetterWallet => ({
    async executeTransaction(o) {
      if (o.program !== LETTERS_PROGRAM) throw new Error("not a letter");
      calls.push({ function: o.function, ...(o.feeMode ? { feeMode: o.feeMode } : {}) });
      const [to, lookup, parcel] = o.inputs as [string, string, string];
      if (o.function === SEND_PAGE_FUNCTION) records.push({ owner: to, name: "Page", lookup, parcel, from: me });
      else if (o.function === SEND_MANY_FUNCTION) {
        for (const each of to.slice(1, -1).split(", ")) records.push({ owner: each, name: "Letter", lookup, parcel, from: me });
        records.push({ owner: me, name: "SentLetter", lookup, parcel, from: me });
      } else records.push({ owner: to, name: "Letter", lookup, parcel, from: me }, { owner: me, name: "SentLetter", lookup, parcel, from: me });
      return { transactionId: "shield_1" };
    },
    async transactionStatus() {
      return { status: "accepted", transactionId: "at1" + "x".repeat(58) };
    },
    async requestRecords(program) {
      if (program !== LETTERS_PROGRAM) return [];
      return records
        .filter((r) => r.owner === me)
        .map((r) => {
          const halves = r.lookup.replace(/[[\]]/g, "").split(", ").map((h) => `    ${h}.private`).join(",\n");
          const fields = r.parcel.replace(/[[\]]/g, "").split(", ").map((f) => `    ${f}.private`).join(",\n");
          const list = r.name === "Page" ? "page" : "parcel";
          return { recordName: r.name, recordPlaintext: `{\n  owner: ${r.owner}.private,\n  lookup: [\n${halves}\n  ],\n  ${list}: [\n${fields}\n  ],\n  _nonce: 1group.public,\n  _version: 1u8.public\n}`, spent: false, sender: r.from };
        });
    },
  });
  return { records, calls, wallet };
}

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

describe("the thread over letters", () => {
  it("carries a message each way, with no receipts and no mailbox", async () => {
    const net = network();
    const business = side();
    const worker = side();
    const toWorker = letterThread(net.wallet(BUSINESS), WORKER, { execute: fast });
    business.keep(await postToThread({ client: toWorker.writer, feeMode: "private", partiesKey: KEY, from: "business", nextOut: 0, body: { type: "text", text: "Welcome aboard" } }));
    expect(net.calls).toEqual([{ function: "send", feeMode: "private" }]); // the fee choice travels with the call

    const workerSide = letterThread(net.wallet(WORKER), BUSINESS, { execute: fast });
    expect("put" in workerSide.reader).toBe(false); // so no receipt goes back
    const r = await readThread({ client: workerSide.reader, partiesKey: KEY, reader: "worker", thread: worker.thread, store: worker.store, skip: worker.skip });
    expect([r.off, r.failed, r.skipped]).toEqual([false, undefined, []]);
    expect(worker.thread.items.map((i) => i.body)).toEqual([{ type: "text", text: "Welcome aboard" }]);
    expect(net.calls).toHaveLength(1); // reading sent nothing

    worker.keep(await postToThread({ client: workerSide.writer, partiesKey: KEY, from: "worker", nextOut: worker.thread.nextOut, body: { type: "text", text: "Thanks!" } }));
    toWorker.refresh();
    await readThread({ client: toWorker.reader, partiesKey: KEY, reader: "business", thread: business.thread, store: business.store, skip: business.skip });
    expect(business.thread.items.map((i) => [i.mine, i.body])).toEqual([
      [true, { type: "text", text: "Welcome aboard" }],
      [false, { type: "text", text: "Thanks!" }],
    ]);
  });

  it("sends a counter-offer with a long letter as one compressed page", async () => {
    const net = network();
    const letter = Array.from({ length: 330 }, (_, i) => `Section ${i}: the crew starts at seven and wraps by three.`).join("\n");
    const proposal: Proposal = { payType: "hourly", rate: "3400", frequency: "biweekly", startDate: "2026-11-09", termsText: "Carpenter.", letter: { description: letter, requirements: "", handbook: "", other: "" } };
    expect(letter.length).toBeGreaterThan(18_000); // far past one page uncompressed
    const workerSide = letterThread(net.wallet(WORKER), BUSINESS, { execute: fast });
    await postToThread({ client: workerSide.writer, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "counter", agreementId: A, proposal, note: "34?" } });
    expect(net.calls.map((c) => c.function)).toEqual([SEND_PAGE_FUNCTION]);

    const business = side();
    await readThread({ client: letterThread(net.wallet(BUSINESS), WORKER, { execute: fast }).reader, partiesKey: KEY, reader: "business", thread: business.thread, store: business.store, skip: business.skip });
    expect(business.thread.items[0]?.body).toMatchObject({ type: "counter", proposal, note: "34?" });
  });

  it("steps over a slot this account already used from another device", async () => {
    const net = network();
    const phone = letterThread(net.wallet(BUSINESS), WORKER, { execute: fast });
    const laptop = letterThread(net.wallet(BUSINESS), WORKER, { execute: fast });
    await postToThread({ client: phone.writer, partiesKey: KEY, from: "business", nextOut: 0, body: { type: "text", text: "From the phone" } });
    // The laptop's vault still says slot 0 is next.
    const item = await postToThread({ client: laptop.writer, partiesKey: KEY, from: "business", nextOut: 0, body: { type: "text", text: "From the laptop" } });
    expect(item.seq).toBe(1);
    expect(net.calls).toHaveLength(2); // the taken slot cost no transaction

    const worker = side();
    await readThread({ client: letterThread(net.wallet(WORKER), BUSINESS, { execute: fast }).reader, partiesKey: KEY, reader: "worker", thread: worker.thread, store: worker.store, skip: worker.skip });
    expect(worker.thread.items.map((i) => i.body)).toEqual([
      { type: "text", text: "From the phone" },
      { type: "text", text: "From the laptop" },
    ]);
  });

  it("refuses a slot already sent under, before Shield is asked", async () => {
    const net = network();
    const box = new LetterBox({ wallet: net.wallet(BUSINESS), to: WORKER, execute: fast });
    const envelope = await packPayload(new TextEncoder().encode("{}"));
    await box.put(A, envelope);
    await expect(box.put(A, envelope)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(net.calls).toHaveLength(1);
  });
});

describe("announcements over letters", () => {
  const ANA = { workerId: "wkr-ana", partiesKey: "a1".repeat(32), address: "aleo1" + "w".repeat(58) };
  const BO = { workerId: "wkr-bo", partiesKey: "b2".repeat(32), address: "aleo1" + "x".repeat(58) };

  /** A person's app: their thread with the business (where the channel key comes), then the channel's posts. */
  async function personReads(net: ReturnType<typeof network>, me: typeof ANA): Promise<Work> {
    let w: Work = emptyWork("Person");
    // Only the business's letters count, in the thread and in the channel.
    const reader = letterReader(new LetterBox({ wallet: net.wallet(me.address) }), BUSINESS);
    await readThread({
      client: reader,
      partiesKey: me.partiesKey,
      reader: "worker",
      thread: workThread(w, me.partiesKey),
      store: async (item) => void (w = updateWorkThread(w, me.partiesKey, (t) => addToThread(t, item))),
      skip: async (seq) => void (w = updateWorkThread(w, me.partiesKey, (t) => skipIncoming(t, seq))),
    });
    for (const channel of w.channels ?? []) {
      await readChannel({
        client: reader,
        channel,
        store: async (item) => void (w = { ...w, channels: (w.channels ?? []).map((c) => (c.id === channel.id ? addReceivedPost(c, item) : c)) }),
        skip: async (epoch, seq) => void (w = { ...w, channels: (w.channels ?? []).map((c) => (c.id === channel.id ? skipPost(c, epoch, seq) : c)) }),
      });
    }
    return w;
  }

  it("gives each member the key in a letter, then reaches all of them with one send_many", async () => {
    const net = network();
    const biz = net.wallet(BUSINESS);
    const ch = newChannel("Everyone", [ANA.workerId, BO.workerId]);
    const keys = await sendChannelKey((m) => new LetterBox({ wallet: biz, to: m.address!, execute: fast }), ch, [ANA, BO].map((m) => ({ ...m, thread: undefined })));
    expect(keys.failed).toEqual([]);
    expect(net.calls.map((c) => c.function)).toEqual(["send", "send"]); // one letter each

    const post = await postToChannel(new ManyLetterBox({ wallet: biz, to: [ANA.address, BO.address], self: BUSINESS, execute: fast }), ch, "Shift swap board is up.", new Date(), "private");
    expect(net.calls.slice(2)).toEqual([{ function: SEND_MANY_FUNCTION, feeMode: "private" }]); // one approval for both

    for (const person of [ANA, BO]) {
      const w = await personReads(net, person);
      expect(w.channels?.[0]?.posts.map((p) => [p.id, p.text])).toEqual([[post.id, "Shift swap board is up."]]);
    }
  });

  it("believes a post only from the business: a member holding the key can't pass as it, or hide the next real post", async () => {
    const net = network();
    const biz = net.wallet(BUSINESS);
    const ch = newChannel("Team schedule", [ANA.workerId, BO.workerId]);
    await sendChannelKey((m) => new LetterBox({ wallet: biz, to: m.address!, execute: fast }), ch, [ANA, BO].map((m) => ({ ...m, thread: undefined })));
    // Ana has the channel's key too: she seals a fake into the business's next slot and sends it to Bo from her own account.
    await postToChannel(new LetterBox({ wallet: net.wallet(ANA.address), to: BO.address, execute: fast }), ch, "Everyone off Friday, says the boss.", new Date());
    // Then the business's real post goes to that same slot.
    const real = await postToChannel(new ManyLetterBox({ wallet: biz, to: [ANA.address, BO.address], self: BUSINESS, execute: fast }), ch, "Friday is on as planned.", new Date());
    const w = await personReads(net, BO);
    expect(w.channels?.[0]?.posts.map((p) => p.text)).toEqual(["Friday is on as planned."]);
    expect(w.channels?.[0]?.posts[0]?.id).toBe(real.id);
  });
});
