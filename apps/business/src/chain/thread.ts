// ---------------------------------------------------------------------------
// The thread between a business and one person, through the mailbox. Each
// side writes its own numbered slots (kind `thread_b` for the business,
// `thread_w` for the person), sealed with the pair's parties key, and reads
// the other side's from its next unread slot up to the first empty one.
// Two sequences, not one shared: neither side ever writes where the other
// might, and a receiver dropping what it has read never leaves a hole in a
// sequence it still scans.
//
// A business and one person write to each other as letters on chain
// (chain/letters.ts `letterThread`: the same slots, each a letter to the other
// side); coworkers still go through the mailbox. Each message is deflated
// before it is sealed when that makes it smaller (chain/compress.ts), so a
// counter-offer with its whole letter still fits on one page.
//
// Between a business and a person it hired, the conversation moves from the
// agreement's key to keys made by handshake (books/key_ring.ts): each pair's
// key has its own slots, a stream, and a reader reads the agreement's stream
// and every pair's it holds both halves of.
//
// The messages themselves, and what each side may send, are books/thread.ts.
// Nothing here logs a key, a lookup or a message.
// ---------------------------------------------------------------------------

import { MAX_PAYLOAD_BYTES, MailboxError, type MailboxClient, lookupId, open, partiesKeyFromHex, seal } from "@pnw/mailbox";
import type { FeeMode } from "@pnw/wallet/fee-mode";
import { packPayload, unpackPayload } from "./compress";
import { sendReceipt } from "./receipts";
import { type KeyRing, emptyRing, noteReceived, sendPlan } from "../books/key_ring";
import { GROUP_TYPES, type Side, type Thread, type ThreadBody, type ThreadItem, type ThreadMessage, ThreadError, addToThread, emptyThread, newMessageId, skipIncoming, validateMessage } from "../books/thread";
import { pairKeyHex, pairStreams, sendingKey } from "./key_ring";

export const THREAD_KINDS: Record<Side, string> = { business: "thread_b", worker: "thread_w" };

const other = (side: Side): Side => (side === "business" ? "worker" : "business");

/** How many taken slots a send steps over before giving up (another device of the same side, or an earlier try). */
const MAX_TAKEN = 8;

/** Which kinds each side writes to; coworker threads use their own (chain/coworkers.ts). */
export type ThreadKinds = Record<Side, string>;

export type PostInput = {
  /** The mailbox, or a letter box (chain/letters.ts) to the other side. */
  client: { put(lookup: string, envelope: Uint8Array, options?: { keepUntil?: string; feeMode?: FeeMode }): Promise<unknown> };
  /** How a letter's fee is paid, as chosen next to the send button. */
  feeMode?: FeeMode;
  partiesKey: string;
  from: Side;
  kinds?: ThreadKinds;
  /** A fixed id, so one group message sent to each member is the same message everywhere. */
  id?: string;
  /** The sender's next unused slot on the agreement's stream (Thread.nextOut). */
  nextOut: number;
  /**
   * Between a business and a person it hired: the conversation's key ring (Thread.ring; null when it
   * has none yet). The send goes on the stream it says, under that stream's key, carrying a key half
   * when one is due. Left out for every other conversation.
   */
  ring?: KeyRing | null;
  body: ThreadBody;
  now?: () => Date;
};

/**
 * Seals one message into the sender's next free slot. A slot already taken
 * is stepped over (the receiver keeps a message id once). Returns the
 * message as the sender's vault keeps it; throws on any other failure.
 */
export async function postToThread({ client, partiesKey, from, nextOut, body, now, kinds, id, feeMode, ring }: PostInput): Promise<ThreadItem> {
  const plan = ring === undefined ? {} : sendPlan(ring ?? undefined);
  const raw: Record<string, unknown> = { version: 1, id: id ?? newMessageId(), from, sentAt: (now ?? (() => new Date()))().toISOString(), body };
  if (plan.half) raw.half = plan.half;
  const message: ThreadMessage = validateMessage(raw, from);
  const kind = (kinds ?? THREAD_KINDS)[from];
  // Answering a handshake: the message goes inside, under the new pair's key (books/thread.ts "sealed").
  const answering = plan.half?.answers ? ring?.pairs.find((p) => p.mine.publicKey === plan.half!.publicKey && p.theirs) : undefined;
  const innerKey = answering ? partiesKeyFromHex(await pairKeyHex(partiesKey, answering)) : null;
  const sending = await sendingKey(partiesKey, ring ?? undefined, plan.via);
  const first = plan.via ? sending.nextOut! : nextOut;
  const key = partiesKeyFromHex(sending.key);
  try {
    for (let seq = first; seq < first + MAX_TAKEN; seq++) {
      const bytes = await wireBytes(message, innerKey, kind, seq);
      const sealed = await seal(key, kind, seq, bytes);
      try {
        await (feeMode ? client.put(sealed.lookup, sealed.envelope, { feeMode }) : client.put(sealed.lookup, sealed.envelope));
        return { ...message, mine: true, seq, ...(plan.via ? { via: plan.via } : {}) };
      } catch (e) {
        if (!(e instanceof MailboxError && e.code === "CONFLICT")) throw e;
      }
    }
  } finally {
    key.fill(0);
    innerKey?.fill(0);
  }
  throw new ThreadError("Couldn't find a free slot for the message; try again");
}

const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(""));
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * What a message's letter carries: the message itself, or, answering a handshake, only its id, time
 * and half outside, and the message sealed inside under the new pair's key, bound to this slot.
 */
async function wireBytes(message: ThreadMessage, innerKey: Uint8Array | null, kind: string, seq: number): Promise<Uint8Array> {
  if (!innerKey) {
    const bytes = await packPayload(new TextEncoder().encode(JSON.stringify(message)));
    if (bytes.length > MAX_PAYLOAD_BYTES) throw new ThreadError("That message is too long to send");
    return bytes;
  }
  const { half, ...rest } = message;
  const inner = await seal(innerKey, kind, seq, await packPayload(new TextEncoder().encode(JSON.stringify(rest))));
  const outer: ThreadMessage = validateMessage({ version: 1, id: message.id, from: message.from, sentAt: message.sentAt, body: { type: "sealed", inner: toBase64(inner.envelope) }, half }, message.from);
  const bytes = await packPayload(new TextEncoder().encode(JSON.stringify(outer)));
  if (bytes.length > MAX_PAYLOAD_BYTES) throw new ThreadError("That message is too long to send");
  return bytes;
}

/**
 * Opens a sealed message's inside with the pair its half makes (`ring` as it stands once the half is
 * noted). Throws when the pair isn't one this side holds both halves of, or the inside doesn't open.
 */
export async function openSealed(outer: ThreadMessage, ring: KeyRing, partiesKey: string, kind: string, seq: number, from: Side): Promise<ThreadMessage> {
  if (outer.body.type !== "sealed" || !outer.half?.answers) throw new ThreadError("That isn't a sealed message");
  const pair = ring.pairs.find((p) => p.theirs === outer.half!.publicKey && p.mine.publicKey === outer.half!.answers);
  if (!pair) throw new ThreadError("A sealed message under a key this side never started");
  return openInner(outer, await pairKeyHex(partiesKey, pair), kind, seq, from);
}

/** Opens a sealed message's inside with `innerKeyHex`; the inside must be the same message. */
export async function openInner(outer: ThreadMessage, innerKeyHex: string, kind: string, seq: number, from: Side): Promise<ThreadMessage> {
  if (outer.body.type !== "sealed") throw new ThreadError("That isn't a sealed message");
  const k = partiesKeyFromHex(innerKeyHex);
  try {
    const inner = validateMessage(JSON.parse(new TextDecoder().decode(await unpackPayload(await open(k, kind, seq, fromBase64(outer.body.inner))))), from);
    if (inner.id !== outer.id || inner.body.type === "sealed") throw new ThreadError("A sealed message's inside isn't the message");
    return { ...inner, ...(outer.half ? { half: outer.half } : {}) };
  } finally {
    k.fill(0);
  }
}

export type ReadInput = {
  /** With `put`, a receipt goes back for each message kept (receipts.ts). */
  client: Pick<MailboxClient, "get" | "drop"> & Partial<Pick<MailboxClient, "put">>;
  partiesKey: string;
  /** Who is reading: their thread's incoming side is the other one. */
  reader: Side;
  kinds?: ThreadKinds;
  /** Which kinds of message this thread takes; anything else is skipped. Default: all. */
  accept?: (body: ThreadMessage["body"]) => boolean;
  thread: Thread | undefined;
  /**
   * Between a business and a person it hired: read every key pair's stream too, and keep the key
   * halves messages carry. Left out for every other conversation, whose messages' halves are dropped.
   */
  twin?: true;
  /** Keeps one message in the vault (and moves its stream's slot on: books/thread.ts `addToThread`). Called before its pin is dropped. */
  store: (item: ThreadItem) => Promise<void>;
  /** Moves past a slot that couldn't be read, on the agreement's stream or a pair's (`via`). */
  skip: (seq: number, via?: string) => Promise<void>;
  now?: () => string;
  /** The most slots read in one go. */
  limit?: number;
};

export type ReadResult = {
  received: ThreadItem[];
  skipped: { seq: number; message: string }[];
  /** The host has no mailbox (503): nothing was read. */
  off: boolean;
  /** A read failed for another reason; it stopped there. */
  failed?: string;
};

/** Reads every new message from the other side, on every stream it holds a key for. Never throws; the result says what happened. */
export async function readThread({ client, partiesKey, reader, thread, store, skip, now, limit, kinds, accept, twin }: ReadInput): Promise<ReadResult> {
  const from = other(reader);
  const kind = (kinds ?? THREAD_KINDS)[from];
  const stamp = now ?? (() => new Date().toISOString());
  const result: ReadResult = { received: [], skipped: [], off: false };
  // What has been read so far, so a key half read early opens a stream later in the same check.
  let local = thread ?? emptyThread();
  const done = new Set<string>();
  const streams: { via?: string; key: string; nextIn: number }[] = [{ key: partiesKey, nextIn: local.nextIn }];
  if (twin) streams.push(...(await pairStreams(partiesKey, local.ring)));
  for (let s = 0; s < streams.length; s++) {
    const stream = streams[s]!;
    done.add(stream.via ?? "");
    const key = partiesKeyFromHex(stream.key);
    try {
      let seq = stream.nextIn;
      for (let read = 0; read < (limit ?? 100); read++, seq++) {
        const lookup = lookupId(key, kind, seq);
        let bytes: Uint8Array | null;
        try {
          bytes = await client.get(lookup);
        } catch (e) {
          if (e instanceof MailboxError && e.code === "NOT_CONFIGURED") result.off = true;
          else result.failed = e instanceof Error ? e.message : "The mailbox couldn't be read";
          return result;
        }
        if (!bytes) break; // the end of their side on this stream
        let item: ThreadItem;
        try {
          let message = validateMessage(JSON.parse(new TextDecoder().decode(await unpackPayload(await open(key, kind, seq, bytes)))), from);
          // An answer to a handshake: its inside opens with the pair its half makes.
          if (message.body.type === "sealed") {
            if (!twin) throw new ThreadError("A sealed message belongs to a conversation with a handshake");
            const noted = noteReceived(local.ring ?? emptyRing(), { seq, ...(stream.via ? { via: stream.via } : {}), ...(message.half ? { half: message.half } : {}), receivedAt: stamp() });
            message = await openSealed(message, noted, partiesKey, kind, seq, from);
          }
          // Group chat kinds only travel between coworkers, under their own filter.
          const allowed = accept ?? ((b: ThreadMessage["body"]) => !GROUP_TYPES.includes(b.type));
          if (!allowed(message.body)) throw new ThreadError("That kind of message doesn't belong in this conversation");
          // A key half counts only in a conversation that has a handshake.
          if (!twin) delete message.half;
          // A send time is what the sender wrote; one in the future becomes the time it arrived, so it can't stay "latest" for ever.
          const receivedAt = stamp();
          item = { ...message, ...(Date.parse(message.sentAt) > Date.parse(receivedAt) ? { sentAt: receivedAt } : {}), mine: false, seq, receivedAt, ...(stream.via ? { via: stream.via } : {}) };
        } catch (e) {
          result.skipped.push({ seq, message: e instanceof Error ? e.message : "The message couldn't be read" });
          await skip(seq, stream.via);
          local = skipIncoming(local, seq, stream.via);
          continue; // the pin stays: nothing of it is in the vault
        }
        await store(item); // in the vault first…
        local = addToThread(local, item);
        result.received.push(item);
        await client.drop(lookup).catch(() => {}); // …then the pin goes
        if (client.put && !stream.via) await sendReceipt({ put: client.put.bind(client) }, partiesKey, kind, seq); // the sender learns it arrived
      }
    } finally {
      key.fill(0);
    }
    // An answer read just now opens a new pair's stream: read it in this same check.
    if (twin) for (const next of await pairStreams(partiesKey, local.ring)) if (!done.has(next.via) && !streams.some((x) => x.via === next.via)) streams.push(next);
  }
  return result;
}

/** My messages the other side hasn't been heard to receive yet, as receipts to look for (receipts.ts). The latest `most`. */
export function awaitingReceipts(thread: Thread | undefined, partiesKey: string, me: Side, most = 20, kinds: ThreadKinds = THREAD_KINDS): { partiesKey: string; kind: string; seq: number; target: number }[] {
  return (thread?.items ?? [])
    .filter((i) => i.mine && !i.receivedAt && !i.via)
    .slice(-most)
    .map((i) => ({ partiesKey, kind: kinds[me], seq: i.seq, target: i.seq }));
}
