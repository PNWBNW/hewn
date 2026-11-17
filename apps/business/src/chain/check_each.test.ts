// Checking every conversation in one go: one that can't be read (here, keys kept in the books
// before halves were checked as points, so its key can't be made) is counted and passed over, and
// the next conversation's messages are still read and kept.
import { describe, expect, it } from "vitest";
import { MailboxError } from "@pnw/mailbox";
import { pairId } from "../books/key_ring";
import { type Thread, type ThreadItem, addToThread, emptyThread, skipIncoming } from "../books/thread";
import { checkEach, couldntCheck, together } from "./check_each";
import { newHalf } from "./key_ring";
import { postToThread, readThread } from "./thread";

const ONE = "ab".repeat(32);
const TWO = "cd".repeat(32);

function chain() {
  const slots = new Map<string, Uint8Array<ArrayBuffer>>();
  return {
    async put(lookup: string, envelope: Uint8Array) {
      if (slots.has(lookup)) throw new MailboxError("CONFLICT", "taken");
      slots.set(lookup, new Uint8Array(envelope));
    },
    async get(lookup: string) {
      return slots.get(lookup) ?? null;
    },
    async drop() {},
  };
}

/** A conversation whose ring holds, from before, an other half that has a key's shape but isn't a point. */
async function stuckThread(): Promise<Thread> {
  const mine = await newHalf();
  const theirs = (await newHalf()).publicKey;
  const bad = theirs.slice(0, -2) + ((parseInt(theirs.slice(-2), 16) + 1) & 0xff).toString(16).padStart(2, "0");
  const pair = { mine, theirs: bad, sent: true as const, nextIn: 0, nextOut: 0, createdAt: "2026-11-01T00:00:00.000Z" };
  return { ...emptyThread(), ring: { pairs: [pair], out: pairId(pair) } };
}

describe("checking every conversation", () => {
  it("reads the next conversation when one before it can't be read", async () => {
    const box = chain();
    await postToThread({ client: box, partiesKey: TWO, from: "worker", nextOut: 0, body: { type: "text", text: "Still here" } });
    const books: Record<string, Thread> = { [ONE]: await stuckThread(), [TWO]: emptyThread() };
    const outcome = await checkEach([ONE, TWO], (partiesKey) =>
      readThread({
        client: box,
        partiesKey,
        reader: "business",
        thread: books[partiesKey],
        twin: true,
        store: async (item: ThreadItem) => void (books[partiesKey] = addToThread(books[partiesKey]!, item)),
        skip: async (seq: number, via?: string) => void (books[partiesKey] = skipIncoming(books[partiesKey]!, seq, via)),
      }),
    );
    expect(books[TWO]!.items.map((i) => (i.body.type === "text" ? i.body.text : ""))).toEqual(["Still here"]);
    expect(outcome).toMatchObject({ off: false, failed: 1 });
    expect(couldntCheck(outcome)).toMatch(/^Couldn't check 1 conversation/);
  });

  it("counts a read that failed and goes on; stops only when Shield isn't connected", async () => {
    const seen: number[] = [];
    const failed = await checkEach([1, 2, 3], async (n) => {
      seen.push(n);
      return n === 1 ? { failed: "The mailbox couldn't be read" } : undefined;
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(couldntCheck(failed)).toBe("Couldn't check 1 conversation: The mailbox couldn't be read");

    seen.length = 0;
    const off = await checkEach([1, 2, 3], async (n) => {
      seen.push(n);
      return n === 2 ? { off: true } : undefined;
    });
    expect(seen).toEqual([1, 2]);
    expect(off.off).toBe(true);
  });

  it("says nothing when every conversation was checked, and adds rounds together", async () => {
    const none = await checkEach([1, 2], async () => undefined);
    expect(couldntCheck(none)).toBeNull();
    const two = together({ off: false, failed: 1 }, { off: false, failed: 1, reason: "Gone" });
    expect(couldntCheck(two)).toBe("Couldn't check 2 conversations: Gone");
  });
});
