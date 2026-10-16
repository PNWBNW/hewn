"use client";

// Checking every conversation at once, for the Messages list (the business's
// side): each team member's new messages (thread.ts), as letters on chain
// once Shield is connected (letter_reader.ts), and from the old mailbox.
// (A changed coworker directory is sent from the Messages page, by hand:
// each copy is a letter, SendDirectory.tsx.) Runs once when Shield has had
// its moment to reconnect, and reports back; it draws nothing itself.
// Nothing here logs a key, a lookup or a message.

import { useEffect, useMemo, useRef } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { useOpenBooks } from "@/books/BooksProvider";
import { emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { addToThread, skipIncoming } from "@/books/thread";
import { useLetters } from "./letter_reader";
import { letterThread } from "./letters";
import { readThread } from "./thread";

export type MessagesCheckProps = { onFinished: (message: string | null) => void };

export default function MessagesCheck(props: MessagesCheckProps) {
  return (
    <AleoWalletProviderWrapper>
      <Check {...props} />
    </AleoWalletProviderWrapper>
  );
}

function Check({ onFinished }: MessagesCheckProps) {
  const { rail, mailbox, updateCompany } = useOpenBooks();
  const { settled, letters, wallet } = useLetters();
  const client = useMemo(() => new MailboxClient(), []);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !rail || !settled) return;
    started.current = true;
    (async () => {
      for (const link of rail.links) {
        if (!link.partiesKey || (link.status !== "linked" && link.status !== "offered")) continue;
        const partiesKey = link.partiesKey;
        const r = await readThread({
          client: letters ? letterThread(wallet, link.address, { letters, mailbox: client }).reader : client,
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
        if (r.off) return onFinished("Connect Shield (open a conversation) to check for messages.");
        if (r.failed) return onFinished(`Couldn't finish checking: ${r.failed}`);
      }
      onFinished(null);
    })().catch((e: unknown) => onFinished(e instanceof Error ? e.message : "Couldn't check for messages"));
  }, [rail, mailbox, client, updateCompany, onFinished, settled, letters, wallet]);

  return null;
}
