// ---------------------------------------------------------------------------
// Conversation backups on chain (books/conversation_backup.ts has when they
// happen). A backup is a letter to this account's own account, so only its
// wallet finds and opens the record; inside, the envelope is sealed with a
// key from the account's username and passphrase (books/account.ts
// `conversationBackupKey`), so a view key alone opens nothing:
//
//   lookup    the backup key, kind `conv_backup`, slot n (0, 1, 2, …)
//   holds     the conversation, and the keys of the pairs it covers
//
// Restoring reads every stream those keys open, both sides': the other
// side's letters as received, this side's own from its sent copies.
// Nothing here logs a key, an account or a message.
// ---------------------------------------------------------------------------

import { MailboxError, lookupId, open, partiesKeyFromHex, seal } from "@pnw/mailbox";
import type { FeeMode } from "@pnw/wallet/fee-mode";
import { type ConversationBackup, validateConversationBackup } from "../books/conversation_backup";
import { type KeyRing, pairsBefore } from "../books/key_ring";
import { type Side, type ThreadItem, type ThreadMessage, validateMessage } from "../books/thread";
import { packPayload, unpackPayload } from "./compress";
import { pairKeyHex } from "./key_ring";
import { THREAD_KINDS, openInner } from "./thread";

export const BACKUP_KIND = "conv_backup";
/** The most backup letters one read looks through. */
const MAX_BACKUPS = 512;
/** How many taken slots a write steps over. */
const MAX_TAKEN = 8;

const other = (side: Side): Side => (side === "business" ? "worker" : "business");

/** What a backup made now holds: the conversation, and the keys of the pairs made before `before` (the moment both agreed). */
export async function backupContents(input: { partiesKey: string; side: Side; peer: string; ring: KeyRing | undefined; requestId: string; before: string; now?: string }): Promise<ConversationBackup> {
  const keys: string[] = [];
  for (const p of pairsBefore(input.ring, input.before)) keys.push(await pairKeyHex(input.partiesKey, p));
  return validateConversationBackup({
    version: 1,
    kind: "conversation_backup",
    partiesKey: input.partiesKey,
    side: input.side,
    peer: input.peer,
    keys,
    requestId: input.requestId,
    madeAt: input.now ?? new Date().toISOString(),
  });
}

/** Reads a slot of this account's letters to itself. */
type ReadOwn = (lookup: string) => Promise<Uint8Array | null>;

/** Writes one backup as a letter to this account's own account (`box` sends to it): one Shield approval. Returns its slot. */
export async function writeBackup({
  box,
  read,
  key,
  backup,
  feeMode,
}: {
  box: { put(lookup: string, envelope: Uint8Array, options?: { feeMode?: FeeMode }): Promise<unknown> };
  read: ReadOwn;
  key: string;
  backup: ConversationBackup;
  feeMode?: FeeMode;
}): Promise<number> {
  const bytes = await packPayload(new TextEncoder().encode(JSON.stringify(validateConversationBackup(backup))));
  const k = partiesKeyFromHex(key);
  try {
    // The next free slot: past every backup already there.
    let first = 0;
    while (first < MAX_BACKUPS && (await read(lookupId(k, BACKUP_KIND, first)))) first++;
    for (let seq = first; seq < first + MAX_TAKEN; seq++) {
      const sealed = await seal(k, BACKUP_KIND, seq, bytes);
      try {
        await (feeMode ? box.put(sealed.lookup, sealed.envelope, { feeMode }) : box.put(sealed.lookup, sealed.envelope));
        return seq;
      } catch (e) {
        if (!(e instanceof MailboxError && e.code === "CONFLICT")) throw e;
      }
    }
  } finally {
    k.fill(0);
  }
  throw new MailboxError("CONFLICT", "Couldn't find a free slot for the backup; try again");
}

/** Every backup this account wrote with `key`, oldest first. A wrong passphrase gives a different key, and so none. */
export async function readBackups({ read, key }: { read: ReadOwn; key: string }): Promise<ConversationBackup[]> {
  const out: ConversationBackup[] = [];
  const k = partiesKeyFromHex(key);
  try {
    for (let seq = 0; seq < MAX_BACKUPS; seq++) {
      const bytes = await read(lookupId(k, BACKUP_KIND, seq));
      if (!bytes) break;
      try {
        out.push(validateConversationBackup(JSON.parse(new TextDecoder().decode(await unpackPayload(await open(k, BACKUP_KIND, seq, bytes))))));
      } catch {
        // not a backup this app can read: passed over
      }
    }
  } finally {
    k.fill(0);
  }
  return out;
}

/** A sealed message's inside, opened with whichever of `keys` it was sealed under; throws when none. */
async function openWithAny(outer: ThreadMessage, keys: readonly string[], kind: string, seq: number, from: Side): Promise<ThreadMessage> {
  for (const key of keys) {
    try {
      return await openInner(outer, key, kind, seq, from);
    } catch {
      // not this key
    }
  }
  throw new Error("Sealed under a key this backup doesn't hold");
}

/** A stream's id for a restored pair's key: its first bytes, which name it on this device only. */
const restoredVia = (key: string) => key.slice(0, 16);

/**
 * Reads back the conversation a backup covers: on the agreement's key and each pair's, every slot
 * of both sides from the first, the other side's letters as received (`theirs`), this side's from
 * its sent copies (`mine`). Each message goes to `store` (books/thread.ts `addToThread` keeps each
 * once). Key halves in them are dropped: a restored history never restarts a handshake. Returns how
 * many messages came back.
 */
export async function restoreHistory({
  backup,
  theirs,
  mine,
  store,
  now,
  limit = 1000,
}: {
  backup: ConversationBackup;
  theirs: ReadOwn;
  mine: ReadOwn;
  store: (item: ThreadItem) => Promise<void>;
  now?: () => string;
  limit?: number;
}): Promise<number> {
  const stamp = now ?? (() => new Date().toISOString());
  let count = 0;
  const streams = [...backup.keys.map((key) => ({ key, via: restoredVia(key) as string | undefined })), { key: backup.partiesKey, via: undefined }];
  for (const stream of streams) {
    for (const [from, read, isMine] of [
      [other(backup.side), theirs, false],
      [backup.side, mine, true],
    ] as const) {
      const kind = THREAD_KINDS[from];
      const k = partiesKeyFromHex(stream.key);
      try {
        for (let seq = 0; seq < limit; seq++) {
          const bytes = await read(lookupId(k, kind, seq));
          if (!bytes) break;
          let item: ThreadItem;
          try {
            let message = validateMessage(JSON.parse(new TextDecoder().decode(await unpackPayload(await open(k, kind, seq, bytes)))), from);
            // An answer to a handshake keeps its inside under the pair it made: opened only when the backup holds that pair.
            if (message.body.type === "sealed") message = await openWithAny(message, backup.keys, kind, seq, from);
            delete message.half;
            item = { ...message, mine: isMine, seq, ...(isMine ? {} : { receivedAt: stamp() }), ...(stream.via ? { via: stream.via } : {}) };
          } catch {
            continue; // a slot that doesn't open as a message: passed over
          }
          await store(item);
          count++;
        }
      } finally {
        k.fill(0);
      }
    }
  }
  return count;
}
