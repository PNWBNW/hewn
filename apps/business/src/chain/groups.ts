// ---------------------------------------------------------------------------
// Group chats through the mailbox (books/groups.ts has the model): each
// message, setup or leave goes to every other member through the private
// conversation the two share (chain/coworkers.ts), with one id for all the
// copies. One member who can't be reached doesn't stop the rest; the result
// says who got it. Nothing here logs a key or a message.
// ---------------------------------------------------------------------------

import type { MailboxClient } from "@pnw/mailbox";
import type { DirectoryEntry, Identity } from "../books/directory";
import { type ThreadBody, type ThreadItem, addToThread, newMessageId } from "../books/thread";
import { type Work, updateCoworker } from "../books/work";
import { COWORKER_KINDS, mySide, pairKey } from "./coworkers";
import { postToThread } from "./thread";

export type FanOutResult = { sent: { publicKey: string; name: string; item: ThreadItem }[]; failed: { name: string; message: string }[] };

/** Sends one message to each of `to` (never to myself), the same id everywhere. */
export async function fanOut(client: Pick<MailboxClient, "put">, work: Work, identity: Identity, to: readonly DirectoryEntry[], body: ThreadBody): Promise<FanOutResult> {
  const id = newMessageId();
  const result: FanOutResult = { sent: [], failed: [] };
  for (const m of to) {
    if (m.publicKey === identity.publicKey) continue;
    try {
      const key = await pairKey(identity, m.publicKey);
      const item = await postToThread({
        client,
        partiesKey: key,
        from: mySide(identity.publicKey, m.publicKey),
        nextOut: work.coworkers?.[m.publicKey]?.nextOut ?? 0,
        body,
        kinds: COWORKER_KINDS,
        id,
      });
      result.sent.push({ publicKey: m.publicKey, name: m.name, item });
    } catch (e) {
      result.failed.push({ name: m.name, message: e instanceof Error ? e.message : "It didn't go out" });
    }
  }
  return result;
}

/** Keeps the copies that went out, each in the conversation it went through. */
export const keepSent = (w: Work, businessKey: string, r: FanOutResult): Work =>
  r.sent.reduce((acc, s) => updateCoworker(acc, s.publicKey, { businessKey, name: s.name }, (t) => ({ ...t, ...addToThread(t, s.item) })), w);
