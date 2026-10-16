// Announcement channels end to end through a fake mailbox: the key goes out
// in each member's thread, posts are sealed once, readers send receipts, and
// taking someone out moves the channel to a key they never get.
import { describe, expect, it } from "vitest";
import { MailboxError } from "@pnw/mailbox";
import { type BusinessChannel, addOwnPost, applyChannelMessage, markSeen, newChannel, removeMembers, addReceivedPost, skipPost } from "../books/channels";
import { emptyWork, type Work, updateWorkThread, workThread } from "../books/work";
import { type Thread, type ThreadItem, addToThread, emptyThread, skipIncoming } from "../books/thread";
import { awaitingSeen, postToChannel, readChannel, readSeen, sendChannelKey } from "./channels";
import { readThread } from "./thread";

const ANA = { workerId: "wkr-ana", partiesKey: "a1".repeat(32) };
const BO = { workerId: "wkr-bo", partiesKey: "b2".repeat(32) };
const KEYS = new Map([ANA, BO].map((m) => [m.workerId, m.partiesKey]));

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

/** A person's vault: their side of the thread with the business, and the channels it brings. */
async function personReads(box: ReturnType<typeof fakeMailbox>, partiesKey: string, work: Work): Promise<Work> {
  let w = work;
  await readThread({
    client: box,
    partiesKey,
    reader: "worker",
    thread: workThread(w, partiesKey),
    store: async (item) => void (w = updateWorkThread(w, partiesKey, (t) => addToThread(t, item))),
    skip: async (seq) => void (w = updateWorkThread(w, partiesKey, (t) => skipIncoming(t, seq))),
  });
  for (const channel of w.channels ?? []) {
    await readChannel({
      client: box,
      channel,
      store: async (item) => void (w = { ...w, channels: (w.channels ?? []).map((c) => (c.id === channel.id ? addReceivedPost(c, item) : c)) }),
      skip: async (epoch, seq) => void (w = { ...w, channels: (w.channels ?? []).map((c) => (c.id === channel.id ? skipPost(c, epoch, seq) : c)) }),
    });
  }
  return w;
}

describe("announcement channels through the mailbox", () => {
  it("reach everyone in the channel, report who has seen each post, and shut out whoever is taken out", async () => {
    const box = fakeMailbox();
    let ch: BusinessChannel = newChannel("Everyone", [ANA.workerId, BO.workerId]);
    // The business's own side of each thread, as its vault keeps it.
    const mine = new Map<string, Thread>();
    const keep = (r: { sent: { partiesKey: string; item: ThreadItem }[] }) => r.sent.forEach((s) => mine.set(s.partiesKey, addToThread(mine.get(s.partiesKey) ?? emptyThread(), s.item)));
    const out = await sendChannelKey(box, ch, [ANA, BO].map((m) => ({ ...m, thread: undefined })));
    keep(out);
    expect(out.sent).toHaveLength(2);
    expect(out.sent[0]!.item.body).toMatchObject({ type: "channel", channelId: ch.id, name: "Everyone", epoch: 0, key: ch.key });

    ch = addOwnPost(ch, await postToChannel(box, ch, "Site closed Friday for the inspection."));
    let ana = await personReads(box, ANA.partiesKey, emptyWork("Ana"));
    let bo = await personReads(box, BO.partiesKey, emptyWork("Bo"));
    expect(ana.channels?.[0]?.posts.map((p) => p.text)).toEqual(["Site closed Friday for the inspection."]);
    expect(bo.channels?.[0]?.posts).toHaveLength(1);

    // Both read it, so both receipts are there.
    await readSeen(box, awaitingSeen(ch, KEYS), async (heard) => {
      ch = heard.reduce((acc, h) => markSeen(acc, h.target.epoch, h.target.seq, h.target.workerId, h.receivedAt), ch);
    });
    expect(Object.keys(ch.posts[0]!.seenBy ?? {}).sort()).toEqual([ANA.workerId, BO.workerId]);
    expect(awaitingSeen(ch, KEYS)).toEqual([]);

    // Bo leaves: a new key for Ana only; Bo is told.
    ch = removeMembers(ch, [BO.workerId]);
    expect(ch.epoch).toBe(1);
    keep(await sendChannelKey(box, ch, [{ ...BO, thread: mine.get(BO.partiesKey) }], true));
    keep(await sendChannelKey(box, ch, [{ ...ANA, thread: mine.get(ANA.partiesKey) }]));
    expect(mine.get(ANA.partiesKey)?.nextOut).toBe(2);
    ch = addOwnPost(ch, await postToChannel(box, ch, "Bonuses go out Thursday."));
    ana = await personReads(box, ANA.partiesKey, ana);
    bo = await personReads(box, BO.partiesKey, bo);
    expect(ana.channels?.[0]?.posts.map((p) => p.text)).toEqual(["Site closed Friday for the inspection.", "Bonuses go out Thursday."]);
    expect(bo.channels?.[0]?.posts.map((p) => p.text)).toEqual(["Site closed Friday for the inspection."]);
    expect(bo.channels?.[0]?.left).toBe(true);
    expect(Object.keys(bo.channels?.[0]?.keys ?? {})).toEqual(["0"]);
  });

  it("skips a post sealed with a key that isn't the channel's, and steps over a taken slot when posting", async () => {
    const box = fakeMailbox();
    const ch = newChannel("Everyone", [ANA.workerId]);
    const forged = newChannel("Everyone", [ANA.workerId]); // another key, same slot numbers
    await postToChannel(box, { ...forged, id: ch.id }, "Not from the business");
    const posted = await postToChannel(box, ch, "Hello team");
    expect(posted.seq).toBe(0);
    const work = applyChannelMessage([], ANA.partiesKey, { type: "channel", channelId: ch.id, name: ch.name, epoch: 0, key: ch.key });
    const r = await readChannel({ client: box, channel: work[0]!, store: async () => {}, skip: async () => {} });
    expect(r.received.map((p) => p.text)).toEqual(["Hello team"]);

    const again = await postToChannel(box, ch, "Second");
    expect(again.seq).toBe(1);
  });
});
