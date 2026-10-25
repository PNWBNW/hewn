// ---------------------------------------------------------------------------
// Reading every connected conversation's new messages at once (the customer's
// bills, and next the business's payments): each connection's slots, under
// its own key, kept one message at a time. Nothing here logs a key, a lookup
// or a message.
// ---------------------------------------------------------------------------

import { type Connection, connectedIn } from "@/books/connections";
import type { Connections } from "@/books/connections";
import type { Side, ThreadItem } from "@/books/thread";
import { CLIENT_KINDS, clientAccepts, connectionKey } from "../clients";
import { type LetterBox, type LetterWallet, letterThread } from "../letters";
import { readThread } from "../thread";

export type CheckInput = {
  conns: Connections | undefined;
  /** Who is reading: "business", or "worker" for the customer. */
  reader: Side;
  letters: LetterBox;
  wallet: LetterWallet;
  store: (address: string, item: ThreadItem) => Promise<void>;
  skip: (address: string, seq: number) => Promise<void>;
};

/** Reads each connected conversation; how many new messages came in, and the first trouble, if any. */
export async function checkConnections({ conns, reader, letters, wallet, store, skip }: CheckInput): Promise<{ received: number; failed?: string }> {
  letters.refresh();
  let received = 0;
  let failed: string | undefined;
  for (const c of connectedIn(conns) as Connection[]) {
    let partiesKey: string;
    try {
      partiesKey = await connectionKey(c);
    } catch {
      continue;
    }
    const r = await readThread({
      client: letterThread(wallet, c.address, { letters }).reader,
      partiesKey,
      reader,
      thread: c.thread,
      kinds: CLIENT_KINDS,
      accept: clientAccepts,
      store: (item) => store(c.address, item),
      skip: (seq) => skip(c.address, seq),
    });
    received += r.received.length;
    if (r.failed && !failed) failed = r.failed;
  }
  return { received, ...(failed ? { failed } : {}) };
}
