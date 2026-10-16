"use client";

// Checking every conversation at once, for the Messages list (the business's
// side): each team member's new messages (thread.ts), as letters on chain
// once Shield is connected (letter_reader.ts), and from the old mailbox;
// then, if who has opted into the coworker directory changed, the new list
// goes to each of them (books/directory.ts). Runs once when Shield has had
// its moment to reconnect, and reports back; it draws nothing itself.
// Nothing here logs a key, a lookup or a message.

import { useEffect, useMemo, useRef } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { useOpenBooks } from "@/books/BooksProvider";
import { emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { addToThread, skipIncoming } from "@/books/thread";
import { businessDirectory, directoryDigest, owedEmptyDirectory } from "@/books/directory";
import type { Mailbox } from "@/books/mailbox";
import { useLetters } from "./letter_reader";
import { letterThread } from "./letters";
import { postToThread, readThread } from "./thread";

/** The threads from `from`, laid over `into` (the rest of `into` stays as it is). */
const updateThreadsFrom = (into: Mailbox, from: Mailbox): Mailbox => ({ ...into, threads: { ...into.threads, ...from.threads } });

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
      // The coworker directory: passed on whenever who's in it changes.
      const latest = await updateCompany((c) => c);
      const entries = businessDirectory(latest.rail, latest.mailbox);
      const digest = directoryDigest(entries);
      if (digest !== (latest.mailbox?.directorySent ?? directoryDigest([]))) {
        const list = entries.map(({ name, publicKey }) => ({ name, publicKey }));
        let failed = 0;
        let mailbox = latest.mailbox ?? emptyMailbox();
        // Everyone listed gets the new list; anyone who left gets an empty one.
        const to = [...entries.map((e) => ({ ...e, list })), ...owedEmptyDirectory(latest.rail, latest.mailbox).map((o) => ({ ...o, list: [] }))];
        for (const e of to) {
          try {
            const item = await postToThread({ client, partiesKey: e.partiesKey, from: "business", nextOut: threadFor(mailbox, e.partiesKey)?.nextOut ?? 0, body: { type: "directory", entries: e.list } });
            mailbox = updateThread(mailbox, e.partiesKey, e.workerId, (t) => addToThread(t, item));
          } catch {
            failed++;
          }
        }
        const sent = mailbox;
        await updateCompany((c) => ({ ...c, mailbox: { ...updateThreadsFrom(c.mailbox ?? emptyMailbox(), sent), ...(failed === 0 ? { directorySent: digest } : {}) } }));
      }
      onFinished(null);
    })().catch((e: unknown) => onFinished(e instanceof Error ? e.message : "Couldn't check for messages"));
  }, [rail, mailbox, client, updateCompany, onFinished, settled, letters, wallet]);

  return null;
}
