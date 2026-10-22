"use client";

// Checking every conversation at once, for the Messages list (the business's
// side): each team member's new messages (thread.ts), as letters on chain
// once Shield is connected (letter_reader.ts), then the invitations from the
// people who gave this business their calendar's key (events.ts).
// (A changed coworker directory is sent from the Messages page, by hand:
// each copy is a letter, SendDirectory.tsx.) Runs once when Shield has had
// its moment to reconnect, and reports back; it draws nothing itself.
// Nothing here logs a key, a lookup or a message.

import { useEffect, useRef } from "react";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { useOpenBooks } from "@/books/BooksProvider";
import { applicantWorkerId } from "@/books/jobs";
import { type Mailbox, emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { addToThread, skipIncoming } from "@/books/thread";
import { businessListening, checkEvents } from "./events";
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
  const { rail, mailbox, jobs, calendar, updateCompany } = useOpenBooks();
  const { settled, letters, wallet } = useLetters();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !rail || !settled) return;
    started.current = true;
    (async () => {
      if (!letters) return onFinished("Connect Shield (open a conversation) to check for messages.");
      // Team members and people with an offer out, then everyone who applied to a posting (their conversations are filed under the posting).
      const people = [
        ...rail.links.filter((l) => l.partiesKey && (l.status === "linked" || l.status === "offered")).map((l) => ({ partiesKey: l.partiesKey!, address: l.address, workerId: l.workerId })),
        ...(jobs?.postings ?? []).flatMap((p) => (p.applicants ?? []).map((a) => ({ partiesKey: a.partiesKey, address: a.address, workerId: applicantWorkerId(a.partiesKey) }))),
      ];
      let latest: Mailbox | null | undefined = mailbox;
      for (const link of people) {
        const partiesKey = link.partiesKey;
        const r = await readThread({
          client: letterThread(wallet, link.address, { letters }).reader,
          partiesKey,
          reader: "business",
          thread: threadFor(mailbox, partiesKey),
          store: async (item) => {
            latest = (await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), partiesKey, link.workerId, (t) => addToThread(t, item)) }))).mailbox;
          },
          skip: async (seq) => {
            await updateCompany((c) => ({ ...c, mailbox: updateThread(c.mailbox ?? emptyMailbox(), partiesKey, link.workerId, (t) => skipIncoming(t, seq)) }));
          },
        });
        if (r.off) return onFinished("Connect Shield (open a conversation) to check for messages.");
        if (r.failed) return onFinished(`Couldn't finish checking: ${r.failed}`);
      }
      // Invitations, now that any new calendar keys are in.
      await checkEvents(letters, businessListening(rail, latest), calendar, updateCompany);
      onFinished(null);
    })().catch((e: unknown) => onFinished(e instanceof Error ? e.message : "Couldn't check for messages"));
  }, [rail, mailbox, jobs, calendar, updateCompany, onFinished, settled, letters, wallet]);

  return null;
}
