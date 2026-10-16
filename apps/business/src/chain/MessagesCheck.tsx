"use client";

// Checking every conversation at once, for the Messages list (the business's
// side): each team member's new messages (thread.ts), with a receipt back for
// each. Runs once when it mounts and reports back; it draws nothing itself.
// Needs no Shield. Nothing here logs a key, a lookup or a message.

import { useEffect, useMemo, useRef } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { useOpenBooks } from "@/books/BooksProvider";
import { emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { addToThread, skipIncoming } from "@/books/thread";
import { readThread } from "./thread";

export type MessagesCheckProps = { onFinished: (message: string | null) => void };

export default function MessagesCheck({ onFinished }: MessagesCheckProps) {
  const { rail, mailbox, updateCompany } = useOpenBooks();
  const client = useMemo(() => new MailboxClient(), []);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !rail) return;
    started.current = true;
    (async () => {
      for (const link of rail.links) {
        if (!link.partiesKey || (link.status !== "linked" && link.status !== "offered")) continue;
        const partiesKey = link.partiesKey;
        const r = await readThread({
          client,
          partiesKey,
          reader: "business",
          thread: threadFor(mailbox, partiesKey),
          store: async (item) => {
            await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), partiesKey, link.workerId, (t) => addToThread(t, item)) }));
          },
          skip: async (seq) => {
            await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), partiesKey, link.workerId, (t) => skipIncoming(t, seq)) }));
          },
        });
        if (r.off) return onFinished("Messages are off on this server.");
        if (r.failed) return onFinished(`Couldn't finish checking: ${r.failed}`);
      }
      onFinished(null);
    })().catch((e: unknown) => onFinished(e instanceof Error ? e.message : "Couldn't check for messages"));
  }, [rail, mailbox, client, updateCompany, onFinished]);

  return null;
}
