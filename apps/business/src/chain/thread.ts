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
// The messages themselves, and what each side may send, are books/thread.ts.
// Nothing here logs a key, a lookup or a message.
// ---------------------------------------------------------------------------

import { MAX_PAYLOAD_BYTES, MailboxError, type MailboxClient, lookupId, open, partiesKeyFromHex, seal } from "@pnw/mailbox";
import type { FeeMode } from "@pnw/wallet/fee-mode";
import { packPayload, unpackPayload } from "./compress";
import { sendReceipt } from "./receipts";
import { GROUP_TYPES, type Side, type Thread, type ThreadBody, type ThreadItem, type ThreadMessage, ThreadError, newMessageId, validateMessage } from "../books/thread";

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
  /** The sender's next unused slot (Thread.nextOut). */
  nextOut: number;
  body: ThreadBody;
  now?: () => Date;
};

/**
 * Seals one message into the sender's next free slot. A slot already taken
 * is stepped over (the receiver keeps a message id once). Returns the
 * message as the sender's vault keeps it; throws on any other failure.
 */
export async function postToThread({ client, partiesKey, from, nextOut, body, now, kinds, id, feeMode }: PostInput): Promise<ThreadItem> {
  const message: ThreadMessage = validateMessage({ version: 1, id: id ?? newMessageId(), from, sentAt: (now ?? (() => new Date()))().toISOString(), body }, from);
  const bytes = await packPayload(new TextEncoder().encode(JSON.stringify(message)));
  if (bytes.length > MAX_PAYLOAD_BYTES) throw new ThreadError("That message is too long to send");
  const kind = (kinds ?? THREAD_KINDS)[from];
  const key = partiesKeyFromHex(partiesKey);
  try {
    for (let seq = nextOut; seq < nextOut + MAX_TAKEN; seq++) {
      const sealed = await seal(key, kind, seq, bytes);
      try {
        await (feeMode ? client.put(sealed.lookup, sealed.envelope, { feeMode }) : client.put(sealed.lookup, sealed.envelope));
        return { ...message, mine: true, seq };
      } catch (e) {
        if (!(e instanceof MailboxError && e.code === "CONFLICT")) throw e;
      }
    }
  } finally {
    key.fill(0);
  }
  throw new ThreadError("Couldn't find a free slot for the message; try again");
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
  /** Keeps one message in the vault (and moves the slot on). Called before its pin is dropped. */
  store: (item: ThreadItem) => Promise<void>;
  /** Moves past a slot that couldn't be read. */
  skip: (seq: number) => Promise<void>;
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

/** Reads every new message from the other side. Never throws; the result says what happened. */
export async function readThread({ client, partiesKey, reader, thread, store, skip, now, limit, kinds, accept }: ReadInput): Promise<ReadResult> {
  const from = other(reader);
  const kind = (kinds ?? THREAD_KINDS)[from];
  const stamp = now ?? (() => new Date().toISOString());
  const result: ReadResult = { received: [], skipped: [], off: false };
  const key = partiesKeyFromHex(partiesKey);
  try {
    let seq = thread?.nextIn ?? 0;
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
      if (!bytes) break; // the end of their side
      let item: ThreadItem;
      try {
        const message = validateMessage(JSON.parse(new TextDecoder().decode(await unpackPayload(await open(key, kind, seq, bytes)))), from);
        // Group chat kinds only travel between coworkers, under their own filter.
        const allowed = accept ?? ((b: ThreadMessage["body"]) => !GROUP_TYPES.includes(b.type));
        if (!allowed(message.body)) throw new ThreadError("That kind of message doesn't belong in this conversation");
        // A send time is what the sender wrote; one in the future becomes the time it arrived, so it can't stay "latest" for ever.
        const receivedAt = stamp();
        item = { ...message, ...(Date.parse(message.sentAt) > Date.parse(receivedAt) ? { sentAt: receivedAt } : {}), mine: false, seq, receivedAt };
      } catch (e) {
        result.skipped.push({ seq, message: e instanceof Error ? e.message : "The message couldn't be read" });
        await skip(seq);
        continue; // the pin stays: nothing of it is in the vault
      }
      await store(item); // in the vault first…
      result.received.push(item);
      await client.drop(lookup).catch(() => {}); // …then the pin goes
      if (client.put) await sendReceipt({ put: client.put.bind(client) }, partiesKey, kind, seq); // the sender learns it arrived
    }
  } finally {
    key.fill(0);
  }
  return result;
}

/** My messages the other side hasn't been heard to receive yet, as receipts to look for (receipts.ts). The latest `most`. */
export function awaitingReceipts(thread: Thread | undefined, partiesKey: string, me: Side, most = 20, kinds: ThreadKinds = THREAD_KINDS): { partiesKey: string; kind: string; seq: number; target: number }[] {
  return (thread?.items ?? [])
    .filter((i) => i.mine && !i.receivedAt)
    .slice(-most)
    .map((i) => ({ partiesKey, kind: kinds[me], seq: i.seq, target: i.seq }));
}
