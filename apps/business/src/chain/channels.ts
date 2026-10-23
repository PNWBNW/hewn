// ---------------------------------------------------------------------------
// Announcement channels (books/channels.ts has the model), as letters on chain.
//
//   key out:   a `channel` message in each member's own thread (thread.ts),
//              sealed with that pair's parties key: one letter each
//   posts:     sealed with the channel key, kind `ann_<epoch>`, slots only the
//              business writes, deflated when that's smaller; one copy to
//              every member through send_many (letters.ts `ManyLetterBox`:
//              one approval for each eight)
//   receipts:  only through the old mailbox (a letter in a block has
//              arrived): each reader's app seals one with its own parties
//              key, kind `ch_<channel>_<epoch>`
//
// Nothing here logs a key, a lookup or a post.
// ---------------------------------------------------------------------------

import { MAX_PAYLOAD_BYTES, MailboxError, type MailboxClient, lookupId, open, partiesKeyFromHex, seal } from "@pnw/mailbox";
import {
  type BusinessChannel,
  type ChannelPost,
  ChannelError,
  type PostItem,
  type WorkChannel,
  postKind,
  postReceiptKind,
  validatePost,
} from "../books/channels";
import type { FeeMode } from "@pnw/wallet/fee-mode";
import { type Thread, type ThreadItem, newMessageId } from "../books/thread";
import { packPayload, unpackPayload } from "./compress";
import { type Awaiting, type Heard, readReceipts, sendReceipt } from "./receipts";
import { type PostInput, postToThread } from "./thread";

const MAX_TAKEN = 8;

/** One member to reach through their own thread (and, for letters, at their account). */
export type Member = { workerId: string; partiesKey: string; thread: Thread | undefined; address?: string };

export type KeyOutResult = { sent: { workerId: string; partiesKey: string; item: ThreadItem }[]; failed: { workerId: string; message: string }[] };

/**
 * Sends the channel's current key to each member, or tells them they've been
 * taken out (`left`), as a message in their own thread. One failure doesn't
 * stop the rest; the result says who got it.
 */
export async function sendChannelKey(
  clientFor: (m: Member) => PostInput["client"],
  ch: BusinessChannel,
  members: readonly Member[],
  left = false,
  feeMode?: FeeMode,
): Promise<KeyOutResult> {
  const result: KeyOutResult = { sent: [], failed: [] };
  for (const m of members) {
    try {
      const item = await postToThread({
        client: clientFor(m),
        ...(feeMode ? { feeMode } : {}),
        partiesKey: m.partiesKey,
        from: "business",
        nextOut: m.thread?.nextOut ?? 0,
        ring: m.thread?.ring ?? null,
        body: left ? { type: "channel_left", channelId: ch.id, name: ch.name } : { type: "channel", channelId: ch.id, name: ch.name, epoch: ch.epoch, key: ch.key },
      });
      result.sent.push({ workerId: m.workerId, partiesKey: m.partiesKey, item });
    } catch (e) {
      result.failed.push({ workerId: m.workerId, message: e instanceof Error ? e.message : "It didn't go out" });
    }
  }
  return result;
}

/** Seals one post with the channel key into the next free slot. Returns it as the business keeps it. */
export async function postToChannel(
  client: PostInput["client"],
  ch: BusinessChannel,
  text: string,
  now: Date = new Date(),
  feeMode?: FeeMode,
  extra: Pick<ChannelPost, "schedule"> = {},
): Promise<PostItem> {
  const post: ChannelPost = validatePost({ version: 1, id: newMessageId(), sentAt: now.toISOString(), text, ...extra });
  const bytes = await packPayload(new TextEncoder().encode(JSON.stringify(post)));
  if (bytes.length > MAX_PAYLOAD_BYTES) throw new ChannelError("That post is too long to send");
  const key = partiesKeyFromHex(ch.key);
  try {
    for (let seq = ch.nextOut; seq < ch.nextOut + MAX_TAKEN; seq++) {
      const sealed = await seal(key, postKind(ch.epoch), seq, bytes);
      try {
        await (feeMode ? client.put(sealed.lookup, sealed.envelope, { feeMode }) : client.put(sealed.lookup, sealed.envelope));
        return { ...post, epoch: ch.epoch, seq };
      } catch (e) {
        if (!(e instanceof MailboxError && e.code === "CONFLICT")) throw e;
      }
    }
  } finally {
    key.fill(0);
  }
  throw new ChannelError("Couldn't find a free slot for the post; try again");
}

export type SeenTarget = { epoch: number; seq: number; workerId: string };

/** The receipts to look for: the latest `most` posts, from each member who hasn't been seen to read them. */
export function awaitingSeen(ch: BusinessChannel, keys: ReadonlyMap<string, string>, most = 5): Awaiting<SeenTarget>[] {
  const out: Awaiting<SeenTarget>[] = [];
  for (const p of ch.posts.slice(-most)) {
    for (const workerId of ch.members) {
      const partiesKey = keys.get(workerId);
      if (!partiesKey || p.seenBy?.[workerId]) continue;
      out.push({ partiesKey, kind: postReceiptKind(ch.id, p.epoch), seq: p.seq, target: { epoch: p.epoch, seq: p.seq, workerId } });
    }
  }
  return out;
}

/** Reads those receipts; `record` keeps them before they're dropped. */
export const readSeen = (client: Pick<MailboxClient, "get" | "drop">, waiting: Awaiting<SeenTarget>[], record: (heard: Heard<SeenTarget>[]) => Promise<void>) =>
  readReceipts(client, waiting, record);

export type ReadPostsResult = { received: PostItem[]; skipped: { epoch: number; seq: number; message: string }[]; off: boolean; failed?: string };

/**
 * Reads every new post of one channel, under each key it was given, from the
 * next unread slot to the first empty one. Posts stay pinned (others read
 * them too). With `put`, a receipt goes to the business through this
 * person's own thread key. Never throws.
 */
export async function readChannel({
  client,
  channel,
  store,
  skip,
  now,
  limit,
}: {
  client: Pick<MailboxClient, "get"> & Partial<Pick<MailboxClient, "put">>;
  channel: WorkChannel;
  store: (item: PostItem) => Promise<void>;
  skip: (epoch: number, seq: number) => Promise<void>;
  now?: () => string;
  limit?: number;
}): Promise<ReadPostsResult> {
  const stamp = now ?? (() => new Date().toISOString());
  const result: ReadPostsResult = { received: [], skipped: [], off: false };
  for (const [e, hex] of Object.entries(channel.keys).sort(([a], [b]) => Number(a) - Number(b))) {
    const epoch = Number(e);
    const kind = postKind(epoch);
    const key = partiesKeyFromHex(hex);
    try {
      let seq = channel.nextIn[e] ?? 0;
      for (let read = 0; read < (limit ?? 100); read++, seq++) {
        let bytes: Uint8Array | null;
        try {
          bytes = await client.get(lookupId(key, kind, seq));
        } catch (err) {
          if (err instanceof MailboxError && err.code === "NOT_CONFIGURED") result.off = true;
          else result.failed = err instanceof Error ? err.message : "The mailbox couldn't be read";
          return result;
        }
        if (!bytes) break;
        let item: PostItem;
        try {
          const post = validatePost(JSON.parse(new TextDecoder().decode(await unpackPayload(await open(key, kind, seq, bytes)))));
          item = { ...post, epoch, seq, receivedAt: stamp() };
        } catch (err) {
          result.skipped.push({ epoch, seq, message: err instanceof Error ? err.message : "The post couldn't be read" });
          await skip(epoch, seq);
          continue;
        }
        await store(item);
        result.received.push(item);
        if (client.put) await sendReceipt({ put: client.put.bind(client) }, channel.partiesKey, postReceiptKind(channel.id, epoch), seq);
      }
    } finally {
      key.fill(0);
    }
  }
  return result;
}
