// The handshake between a business and a person it hired, end to end over a
// fake chain whose letters stay where they are (books/key_ring.ts has how it
// goes): who writes where, under which key, and what someone holding only the
// agreement's key can still open.
import { describe, expect, it } from "vitest";
import { open, partiesKeyFromHex } from "@pnw/mailbox";
import { addHalves, emptyRing, isTwinSealed, noteReceived, pairId, validateKeyRing } from "../books/key_ring";
import { type Side, type Thread, type ThreadItem, addToThread, emptyThread, skipIncoming } from "../books/thread";
import { makeHalves, newHalf, pairKeyHex } from "./key_ring";
import { postToThread, readThread } from "./thread";

const KEY = "ab".repeat(32);
const at = (m: number) => () => new Date(Date.UTC(2026, 9, 23, 12, m));

/** Letters on chain: nothing is dropped once read. */
function chain() {
  const slots = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    slots,
    async put(lookup: string, envelope: Uint8Array) {
      slots.set(lookup, new Uint8Array(envelope));
    },
    async get(lookup: string) {
      return slots.get(lookup) ?? null;
    },
    async drop() {},
  };
}

/** One side's books: its copy of the conversation. */
function party(side: Side, box: ReturnType<typeof chain>, twin = true) {
  let thread: Thread = emptyThread();
  let minute = 0;
  return {
    get thread() {
      return thread;
    },
    set thread(t: Thread) {
      thread = t;
    },
    /** What the conversation's checks do before a send: make the halves it needs. */
    async prepare() {
      const made = await makeHalves(thread.ring);
      if (made) thread = { ...thread, ring: addHalves(thread.ring, made, at(minute)().toISOString()) };
    },
    async say(text: string) {
      if (twin) await this.prepare();
      const item = await postToThread({ client: box, partiesKey: KEY, from: side, nextOut: thread.nextOut, ...(twin ? { ring: thread.ring ?? null } : {}), body: { type: "text", text }, now: at(++minute) });
      thread = addToThread(thread, item);
      return item;
    },
    async check() {
      const r = await readThread({
        client: box,
        partiesKey: KEY,
        reader: side,
        thread,
        ...(twin ? { twin: true as const } : {}),
        store: async (i: ThreadItem) => void (thread = addToThread(thread, i)),
        skip: async (seq: number, via?: string) => void (thread = skipIncoming(thread, seq, via)),
        now: () => at(++minute)().toISOString(),
      });
      return r.received.map((i) => (i.body.type === "text" ? i.body.text : i.body.type));
    },
    texts: () => thread.items.map((i) => (i.body.type === "text" ? i.body.text : "")),
  };
}

describe("the handshake", () => {
  it("moves a conversation from the agreement's key to one only the two sides can make, without an extra letter", async () => {
    const box = chain();
    const business = party("business", box);
    const worker = party("worker", box);

    // The business's first message carries its half, under the agreement's key.
    const first = await business.say("Welcome aboard");
    expect(first.half?.publicKey).toMatch(/^04/);
    expect(first.via).toBeUndefined();

    // The person reads it, answers with their own half, on the same stream, then writes under the new key.
    expect(await worker.check()).toEqual(["Welcome aboard"]);
    const answer = await worker.say("Thanks!");
    expect(answer.half?.answers).toBe(first.half?.publicKey);
    expect(answer.via).toBeUndefined();
    expect(isTwinSealed(worker.thread.ring)).toBe(true);
    const sealed = await worker.say("See you Monday");
    expect(sealed.via).toBe(worker.thread.ring?.out);
    expect(sealed.half).toBeUndefined();

    // The business reads the answer and, in the same check, the message under the new key.
    expect(await business.check()).toEqual(["Thanks!", "See you Monday"]);
    expect(isTwinSealed(business.thread.ring)).toBe(true);
    const reply = await business.say("Monday it is");
    expect(reply.via).toBe(business.thread.ring?.out);
    expect(reply.half).toBeUndefined();
    expect(await worker.check()).toEqual(["Monday it is"]);

    // Both made the same key, and nobody sent it: one letter for each of the 4 messages (and the 2
    // receipts the agreement's stream always had), nothing more.
    const b = business.thread.ring!.pairs.find((p) => p.theirs)!;
    const w = worker.thread.ring!.pairs.find((p) => p.theirs)!;
    expect(await pairKeyHex(KEY, b)).toBe(await pairKeyHex(KEY, w));
    expect(box.slots.size).toBe(4 + 2);
    expect(business.texts()).toEqual(["Welcome aboard", "Thanks!", "See you Monday", "Monday it is"]);
  });

  it("leaves someone holding only the agreement's key (a view key) with the letters from before the switch, and nothing after", async () => {
    const box = chain();
    const business = party("business", box);
    const worker = party("worker", box);
    await business.say("Welcome aboard");
    await worker.check();
    await worker.say("Thanks!");
    await worker.say("My bank details changed");
    await business.check();
    await business.say("Got it");

    // An onlooker with the agreement's key reads both sides' agreement streams.
    const onlookerAsBusiness = party("business", box, false);
    const onlookerAsWorker = party("worker", box, false);
    expect(await onlookerAsBusiness.check()).toEqual(["Thanks!"]);
    expect(await onlookerAsWorker.check()).toEqual(["Welcome aboard"]);
    // No letter after the switch opens with the agreement's key.
    const agreementKey = partiesKeyFromHex(KEY);
    let opened = 0;
    for (const [, envelope] of box.slots) {
      for (const kind of ["thread_b", "thread_w"]) {
        for (let seq = 0; seq < 4; seq++) {
          try {
            await open(agreementKey, kind, seq, envelope);
            opened++;
          } catch {
            // not under this key
          }
        }
      }
    }
    expect(opened).toBe(2);
  });

  it("keeps working with someone whose app doesn't take part: everything stays under the agreement's key", async () => {
    const box = chain();
    const business = party("business", box);
    const old = party("worker", box, false);
    await business.say("One");
    expect(await old.check()).toEqual(["One"]);
    await old.say("Two");
    expect(await business.check()).toEqual(["Two"]);
    const again = await business.say("Three");
    expect(again.via).toBeUndefined();
    expect(again.half?.publicKey).toBe(business.thread.ring!.pairs[0]!.mine.publicKey); // still asking, harmlessly
    expect(await old.check()).toEqual(["Three"]);
    expect(isTwinSealed(business.thread.ring)).toBe(false);
  });

  it("settles when both sides start at once: each answers the other, and both read everything", async () => {
    const box = chain();
    const business = party("business", box);
    const worker = party("worker", box);
    await business.say("B1");
    await worker.say("W1");
    expect(await business.check()).toEqual(["W1"]);
    expect(await worker.check()).toEqual(["B1"]);
    await business.say("B2");
    await worker.say("W2");
    await business.say("B3");
    await worker.say("W3");
    expect(await business.check()).toEqual(["W2", "W3"]);
    expect(await worker.check()).toEqual(["B2", "B3"]);
    expect(isTwinSealed(business.thread.ring) && isTwinSealed(worker.thread.ring)).toBe(true);
    await business.say("B4");
    await worker.say("W4");
    expect(await worker.check()).toEqual(["B4"]);
    expect(await business.check()).toEqual(["W4"]);
  });

  it("lets a side that lost its keys start again: the other answers on the agreement's stream", async () => {
    const box = chain();
    const business = party("business", box);
    const worker = party("worker", box);
    await business.say("Hello");
    await worker.check();
    await worker.say("Hi");
    await business.check();
    // The person's books come back from an old file: the conversation, but not its keys.
    worker.thread = { ...worker.thread, ring: undefined };
    await business.say("Lost on the way to you");
    expect(await worker.check()).toEqual([]);
    await worker.say("I'm back");
    expect(await business.check()).toEqual(["I'm back"]);
    await business.say("Welcome back");
    expect(await worker.check()).toEqual(["Welcome back"]);
    const sealed = await worker.say("Under a fresh key");
    expect(sealed.via).toBe(worker.thread.ring?.out);
    expect(await business.check()).toEqual(["Under a fresh key"]);
  });
});

describe("what a key half can and can't do", () => {
  it("is ignored when it answers a half this side never made", async () => {
    const stranger = await newHalf();
    const mine = await newHalf();
    const ring = addHalves(emptyRing(), { start: mine }, "2026-10-23T12:00:00.000Z");
    const after = noteReceived(ring, { seq: 0, half: { publicKey: stranger.publicKey, answers: (await newHalf()).publicKey } });
    expect(after.out).toBeUndefined();
    expect(after.pairs[0]!.theirs).toBeUndefined();
  });

  it("answers a start once, however many copies of it arrive", async () => {
    const start = (await newHalf()).publicKey;
    let ring = emptyRing();
    for (let seq = 0; seq < 3; seq++) ring = noteReceived(ring, { seq, half: { publicKey: start } });
    expect(ring.toAnswer).toEqual([{ publicKey: start, on: "agreement" }]);
    const made = await makeHalves(ring);
    ring = addHalves(ring, made!, "2026-10-23T12:00:00.000Z");
    expect(ring.toAnswer).toBeUndefined();
    ring = noteReceived(ring, { seq: 3, half: { publicKey: start } });
    expect(ring.pairs).toHaveLength(1);
    expect(ring.toAnswer).toBeUndefined();
  });

  it("isn't put in twice from an older copy of the conversation", async () => {
    const made = await makeHalves(undefined);
    const ring = addHalves(undefined, made!, "2026-10-23T12:00:00.000Z");
    expect(addHalves(ring, (await makeHalves(undefined))!, "2026-10-23T12:01:00.000Z").pairs).toHaveLength(1);
  });

  it("makes a message with a malformed half unreadable, not believed", async () => {
    const box = chain();
    const business = party("business", box);
    const sealed = await postToThread({ client: box, partiesKey: KEY, from: "worker", nextOut: 0, body: { type: "text", text: "hi" } });
    // Re-seal the same slot with a half that isn't a public key.
    const { seal } = await import("@pnw/mailbox");
    const { packPayload } = await import("./compress");
    const bad = await seal(partiesKeyFromHex(KEY), "thread_w", 0, await packPayload(new TextEncoder().encode(JSON.stringify({ version: 1, id: sealed.id, from: "worker", sentAt: sealed.sentAt, body: { type: "text", text: "hi" }, half: { publicKey: "not-a-key" } }))));
    box.slots.clear();
    await box.put(bad.lookup, bad.envelope);
    expect(await business.check()).toEqual([]);
    expect(business.thread.ring).toBeUndefined();
    expect(business.thread.nextIn).toBe(1);
  });

  it("is dropped in a conversation that has no handshake (coworkers, applicants)", async () => {
    const box = chain();
    const worker = party("worker", box);
    await worker.say("hello");
    const other = party("business", box, false);
    await other.check();
    expect(other.thread.items[0]!.half).toBeUndefined();
    expect(other.thread.ring).toBeUndefined();
  });

  it("keeps a ring honest: writing under a pair needs both halves", async () => {
    const ring = addHalves(undefined, (await makeHalves(undefined))!, "2026-10-23T12:00:00.000Z");
    expect(() => validateKeyRing({ ...ring, out: pairId(ring.pairs[0]!) })).toThrow();
    expect(() => validateKeyRing({ pairs: [{ ...ring.pairs[0]!, mine: { publicKey: "04", privateKey: {} } }] })).toThrow();
  });
});
