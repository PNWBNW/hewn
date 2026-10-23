// Backups both sides agree to, end to end over a fake chain (books/conversation_backup.ts has the
// rules): nothing without Allow, the copy covers the conversation only up to the point both
// agreed, the keys refresh without an extra letter, the thread stays whole, and a restore on a
// fresh device brings back exactly what the copy covers.
import { describe, expect, it } from "vitest";
import { MailboxError } from "@pnw/mailbox";
import { conversationBackupKey } from "../books/account";
import { backupRequests, backupStep, canAskBackup } from "../books/conversation_backup";
import { addHalves, isTwinSealed, noteBackup } from "../books/key_ring";
import { type Side, type Thread, type ThreadBody, type ThreadItem, addToThread, emptyThread, newMessageId, skipIncoming } from "../books/thread";
import { backupContents, readBackups, restoreHistory, writeBackup } from "./conversation_backup";
import { makeHalves } from "./key_ring";
import { postToThread, readThread } from "./thread";

const KEY = "ab".repeat(32);
const BUSINESS = "aleo1" + "b".repeat(58);
const WORKER = "aleo1" + "w".repeat(58);
let minute = 0;
const tick = () => new Date(Date.UTC(2026, 9, 23, 12, ++minute));

function chain() {
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
    async drop() {},
  };
}

function party(side: Side, account: string, box: ReturnType<typeof chain>) {
  let thread: Thread = emptyThread();
  const prepare = async () => {
    const made = await makeHalves(thread.ring);
    if (made) thread = { ...thread, ring: addHalves(thread.ring, made, tick().toISOString()) };
  };
  const send = async (body: ThreadBody) => {
    await prepare();
    const item = await postToThread({ client: box, partiesKey: KEY, from: side, nextOut: thread.nextOut, ring: thread.ring ?? null, body, now: tick });
    thread = addToThread(thread, item);
    return item;
  };
  return {
    account,
    get thread() {
      return thread;
    },
    set thread(t: Thread) {
      thread = t;
    },
    say: (text: string) => send({ type: "text", text }),
    send,
    async check() {
      const r = await readThread({
        client: box,
        partiesKey: KEY,
        reader: side,
        thread,
        twin: true,
        store: async (i: ThreadItem) => void (thread = addToThread(thread, i)),
        skip: async (seq: number, via?: string) => void (thread = skipIncoming(thread, seq, via)),
        now: () => tick().toISOString(),
      });
      await prepare();
      return r.received.map((i) => (i.body.type === "text" ? i.body.text : i.body.type));
    },
    /** This side's copy, as the screens make it: the backup letter, then the ring noted. */
    async copy(requestId: string, before: string, refresh: boolean, secret: string) {
      const key = await conversationBackupKey(secret, account, 1000);
      const backup = await backupContents({ partiesKey: KEY, side, peer: side === "business" ? WORKER : BUSINESS, ring: thread.ring, requestId, before, now: tick().toISOString() });
      await writeBackup({ box, read: (l) => box.get(l), key, backup });
      thread = { ...thread, ring: noteBackup(thread.ring, requestId, tick().toISOString(), refresh) };
      return backup;
    },
    texts: () => thread.items.filter((i) => i.body.type === "text").map((i) => (i.body as { text: string }).text),
  };
}

/** Two sides past their handshake, with a few messages under it. */
async function talking() {
  minute = 0;
  const box = chain();
  const business = party("business", BUSINESS, box);
  const worker = party("worker", WORKER, box);
  await business.say("Welcome aboard");
  await worker.check();
  await worker.say("Thanks");
  await worker.say("Sealed one");
  await business.check();
  await business.say("Sealed two");
  await worker.check();
  return { box, business, worker };
}

describe("a backup both sides agree to", () => {
  it("goes ask → allow (the allower's copy, fresh keys riding on the Allow) → the asker's copy, with no extra letter for the refresh", async () => {
    const { box, business, worker } = await talking();
    const firstOut = worker.thread.ring!.out;

    // The person asks.
    const requestId = newMessageId();
    await worker.send({ type: "backup_request", requestId });
    expect(backupStep(backupRequests(worker.thread)[0]!)).toBe("waiting");
    expect(canAskBackup(worker.thread)).toBe(false);

    // The business sees it, allows: its copy first, then the Allow carrying its fresh half.
    await business.check();
    expect(backupStep(backupRequests(business.thread)[0]!)).toBe("answer");
    const allowAt = tick().toISOString();
    const businessCopy = await business.copy(requestId, allowAt, true, "hewn:v1\nday\nbusiness pass");
    const allow = await business.send({ type: "backup_answer", requestId, allow: true });
    expect(allow.half?.publicKey).toMatch(/^04/);
    expect(allow.half?.answers).toBeUndefined();
    expect(backupStep(backupRequests(business.thread)[0]!)).toBe("done");

    // The person sees the Allow and makes their copy.
    await worker.check();
    const request = backupRequests(worker.thread)[0]!;
    expect(backupStep(request)).toBe("copy");
    const workerCopy = await worker.copy(requestId, request.answer!.at, false, "hewn:v1\nana\nworker pass");
    expect(backupStep(backupRequests(worker.thread)[0]!)).toBe("done");

    // The copies cover the one pair made before both agreed.
    expect(businessCopy.keys).toHaveLength(1);
    expect(workerCopy.keys).toEqual(businessCopy.keys);

    // The conversation goes straight on: the person's next message answers the fresh start, and both write under the new keys.
    const letters = box.slots.size;
    await worker.say("Carrying on");
    expect(box.slots.size).toBe(letters + 1);
    expect(await business.check()).toEqual(["Carrying on"]);
    await business.say("Under fresh keys");
    expect(await worker.check()).toEqual(["Under fresh keys"]);
    expect(isTwinSealed(worker.thread.ring)).toBe(true);
    expect(worker.thread.ring!.out).not.toBe(firstOut);

    // Every message stays in the thread, in order, on both sides.
    expect(worker.texts()).toEqual(["Welcome aboard", "Thanks", "Sealed one", "Sealed two", "Carrying on", "Under fresh keys"]);
    expect(business.texts()).toEqual(worker.texts());
  });

  it("restores on a fresh device exactly what the copy covers, both sides' messages, and nothing after", async () => {
    const { box, business, worker } = await talking();
    const requestId = newMessageId();
    await worker.send({ type: "backup_request", requestId });
    await business.check();
    await business.copy(requestId, tick().toISOString(), true, "hewn:v1\nday\nbusiness pass");
    await business.send({ type: "backup_answer", requestId, allow: true });
    await worker.check();
    await worker.copy(requestId, backupRequests(worker.thread)[0]!.answer!.at, false, "hewn:v1\nana\nworker pass");
    await worker.say("After the backup");
    await business.check();
    await business.say("Also after");
    await worker.check();

    // A fresh device: the person's username and passphrase find their copy; the wrong ones find nothing.
    const read = (l: string) => box.get(l);
    expect(await readBackups({ read, key: await conversationBackupKey("hewn:v1\nana\nwrong", WORKER, 1000) })).toEqual([]);
    const [found] = await readBackups({ read, key: await conversationBackupKey("hewn:v1\nana\nworker pass", WORKER, 1000) });
    expect(found?.requestId).toBe(requestId);

    let restored: Thread = emptyThread();
    const count = await restoreHistory({ backup: found!, theirs: read, mine: read, store: async (i) => void (restored = addToThread(restored, i)) });
    const texts = restored.items.filter((i) => i.body.type === "text").map((i) => (i.body as { text: string }).text);
    expect(texts).toEqual(["Welcome aboard", "Thanks", "Sealed one", "Sealed two"]);
    expect(count).toBe(restored.items.length);
    // Their messages and this side's own, each marked as such; no key half survives a restore.
    expect(restored.items.find((i) => i.body.type === "text" && i.body.text === "Thanks")?.mine).toBe(true);
    expect(restored.items.find((i) => i.body.type === "text" && i.body.text === "Welcome aboard")?.mine).toBe(false);
    expect(restored.items.every((i) => !i.half)).toBe(true);
  });

  it("makes no copy and changes no keys when the other side declines", async () => {
    const { box, business, worker } = await talking();
    const out = business.thread.ring!.out;
    const requestId = newMessageId();
    await worker.send({ type: "backup_request", requestId });
    await business.check();
    const decline = await business.send({ type: "backup_answer", requestId, allow: false });
    expect(decline.half).toBeUndefined();
    await worker.check();
    expect(backupStep(backupRequests(worker.thread)[0]!)).toBe("declined");
    expect(canAskBackup(worker.thread)).toBe(true);
    expect(business.thread.ring!.out).toBe(out);
    expect(await readBackups({ read: (l) => box.get(l), key: await conversationBackupKey("hewn:v1\nana\nworker pass", WORKER, 1000) })).toEqual([]);
  });

  it("counts only the first answer, and only from the side that didn't ask", async () => {
    const { business, worker } = await talking();
    const requestId = newMessageId();
    await worker.send({ type: "backup_request", requestId });
    // The asker can't answer its own request.
    await worker.send({ type: "backup_answer", requestId, allow: true });
    expect(backupStep(backupRequests(worker.thread)[0]!)).toBe("waiting");
    await business.check();
    await business.send({ type: "backup_answer", requestId, allow: false });
    await business.send({ type: "backup_answer", requestId, allow: true });
    await worker.check();
    expect(backupStep(backupRequests(worker.thread)[0]!)).toBe("declined");
  });
});
