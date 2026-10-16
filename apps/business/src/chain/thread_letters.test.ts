// The thread between a business and one person over letters on chain: a fake
// network that turns each `send` / `send_page` into the records Shield would
// list, and each side's wallet reading only what it owns.
import { describe, expect, it } from "vitest";
import { MailboxError, partiesKeyFromHex, seal } from "@pnw/mailbox";
import { type Proposal, type Thread, type ThreadItem, addToThread, emptyThread, newMessageId, skipIncoming } from "../books/thread";
import { LETTERS_PROGRAM, LetterBox, type LetterWallet, SEND_PAGE_FUNCTION, letterThread } from "./letters";
import { packPayload } from "./compress";
import { THREAD_KINDS, postToThread, readThread } from "./thread";

const KEY = "ab".repeat(32);
const A = "aa".repeat(32);
const BUSINESS = "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px";
const WORKER = "aleo1" + "w".repeat(58);
const fast = { sleep: async () => {}, pollMs: 1 };

/** The network: every letter sent, as the records it made. */
function network() {
  const records: { owner: string; name: "Letter" | "SentLetter" | "Page"; lookup: string; parcel: string }[] = [];
  const calls: { function: string; feeMode?: string }[] = [];
  const wallet = (me: string): LetterWallet => ({
    async executeTransaction(o) {
      if (o.program !== LETTERS_PROGRAM) throw new Error("not a letter");
      calls.push({ function: o.function, ...(o.feeMode ? { feeMode: o.feeMode } : {}) });
      const [to, lookup, parcel] = o.inputs as [string, string, string];
      if (o.function === SEND_PAGE_FUNCTION) records.push({ owner: to, name: "Page", lookup, parcel });
      else records.push({ owner: to, name: "Letter", lookup, parcel }, { owner: me, name: "SentLetter", lookup, parcel });
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
          return { recordName: r.name, recordPlaintext: `{\n  owner: ${r.owner}.private,\n  lookup: [\n${halves}\n  ],\n  ${list}: [\n${fields}\n  ],\n  _nonce: 1group.public,\n  _version: 1u8.public\n}`, spent: false };
        });
    },
  });
  return { records, calls, wallet };
}

/** The old mailbox, off on this host (as on Joshua's). */
const mailboxOff = {
  async get(): Promise<Uint8Array<ArrayBuffer> | null> {
    throw new MailboxError("NOT_CONFIGURED", "off");
  },
  async drop(): Promise<void> {
    throw new MailboxError("NOT_CONFIGURED", "off");
  },
};

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
    const toWorker = letterThread(net.wallet(BUSINESS), WORKER, { mailbox: mailboxOff, execute: fast });
    business.keep(await postToThread({ client: toWorker.writer, feeMode: "private", partiesKey: KEY, from: "business", nextOut: 0, body: { type: "text", text: "Welcome aboard" } }));
    expect(net.calls).toEqual([{ function: "send", feeMode: "private" }]); // the fee choice travels with the call

    const workerSide = letterThread(net.wallet(WORKER), BUSINESS, { mailbox: mailboxOff, execute: fast });
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
    const workerSide = letterThread(net.wallet(WORKER), BUSINESS, { mailbox: mailboxOff, execute: fast });
    await postToThread({ client: workerSide.writer, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "counter", agreementId: A, proposal, note: "34?" } });
    expect(net.calls.map((c) => c.function)).toEqual([SEND_PAGE_FUNCTION]);

    const business = side();
    await readThread({ client: letterThread(net.wallet(BUSINESS), WORKER, { mailbox: mailboxOff, execute: fast }).reader, partiesKey: KEY, reader: "business", thread: business.thread, store: business.store, skip: business.skip });
    expect(business.thread.items[0]?.body).toMatchObject({ type: "counter", proposal, note: "34?" });
  });

  it("steps over a slot this account already used from another device", async () => {
    const net = network();
    const phone = letterThread(net.wallet(BUSINESS), WORKER, { mailbox: mailboxOff, execute: fast });
    const laptop = letterThread(net.wallet(BUSINESS), WORKER, { mailbox: mailboxOff, execute: fast });
    await postToThread({ client: phone.writer, partiesKey: KEY, from: "business", nextOut: 0, body: { type: "text", text: "From the phone" } });
    // The laptop's vault still says slot 0 is next.
    const item = await postToThread({ client: laptop.writer, partiesKey: KEY, from: "business", nextOut: 0, body: { type: "text", text: "From the laptop" } });
    expect(item.seq).toBe(1);
    expect(net.calls).toHaveLength(2); // the taken slot cost no transaction

    const worker = side();
    await readThread({ client: letterThread(net.wallet(WORKER), BUSINESS, { mailbox: mailboxOff, execute: fast }).reader, partiesKey: KEY, reader: "worker", thread: worker.thread, store: worker.store, skip: worker.skip });
    expect(worker.thread.items.map((i) => i.body)).toEqual([
      { type: "text", text: "From the phone" },
      { type: "text", text: "From the laptop" },
    ]);
  });

  it("still reads a message sent through the old mailbox, uncompressed", async () => {
    const net = network();
    const key = partiesKeyFromHex(KEY);
    const old = await seal(key, THREAD_KINDS.business, 0, new TextEncoder().encode(JSON.stringify({ version: 1, id: newMessageId(), from: "business", sentAt: "2026-10-01T00:00:00.000Z", body: { type: "text", text: "Before letters" } })));
    const mailbox = {
      get: async (lookup: string) => (lookup === old.lookup ? old.envelope : null),
      drop: async () => {},
    };
    const worker = side();
    await readThread({ client: letterThread(net.wallet(WORKER), BUSINESS, { mailbox, execute: fast }).reader, partiesKey: KEY, reader: "worker", thread: worker.thread, store: worker.store, skip: worker.skip });
    expect(worker.thread.items.map((i) => i.body)).toEqual([{ type: "text", text: "Before letters" }]);
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
