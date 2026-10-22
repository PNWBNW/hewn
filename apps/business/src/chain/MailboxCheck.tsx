"use client";

// Reading what the team sent: once Shield has had its moment to reconnect
// (letter_reader.ts), first which waiting offers have been accepted, from the
// agreement records in the Shield account (acceptance.ts); then the weeks of
// hours (mailbox_scan.ts), then each person's side of the conversation
// (thread.ts), both from letters on chain, then the invitations from people
// who gave this business their calendar's key (events.ts). Without Shield there is nothing to
// read, and it says so. Reports back; it draws nothing itself. Nothing here
// logs a key, a lookup or an hour.

import { useEffect, useRef } from "react";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { useOpenBooks } from "@/books/BooksProvider";
import { type Mailbox, addHours, bumpHoursSeq, emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { addToThread, skipIncoming } from "@/books/thread";
import { checkAcceptances } from "./acceptance";
import { businessListening, checkEvents } from "./events";
import { scanHours } from "./mailbox_scan";
import { useLetters } from "./letter_reader";
import { letterReader, letterThread } from "./letters";
import { readThread } from "./thread";

export type CheckOutcome = {
  received: number;
  skipped: number;
  /** Who accepted an offer during this check (their names), if anyone. */
  accepted?: string[];
  message?: string;
};

export type MailboxCheckProps = { onFinished: (outcome: CheckOutcome) => void };

export default function MailboxCheck(props: MailboxCheckProps) {
  return (
    <AleoWalletProviderWrapper>
      <Check {...props} />
    </AleoWalletProviderWrapper>
  );
}

function Check({ onFinished }: MailboxCheckProps) {
  const { rail, payroll, mailbox, calendar, updateCompany } = useOpenBooks();
  const { settled, letters, wallet } = useLetters();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !rail || !settled) return;
    started.current = true;
    (async () => {
      if (!letters) {
        onFinished({ received: 0, skipped: 0, message: "Connect Shield to check for what your team sent." });
        return;
      }
      // Acceptances first: the waiting offers whose final agreement is now in the Shield account.
      // Shield has to be connected to read them; without it the check says so below.
      let accepted: string[] = [];
      let acceptFailed: string | null = null;
      try {
        accepted = (await checkAcceptances({ rail, payroll, requestRecords: wallet.requestRecords, updateCompany })).accepted;
      } catch (e) {
        acceptFailed = e instanceof Error ? e.message : "The agreements couldn't be read";
      }
      const reader = letterReader(letters);
      const r = await scanHours({
        rail,
        mailbox,
        client: reader,
        store: async (item) => {
          await updateCompany((c) => ({ ...c, mailbox: addHours(c.mailbox ?? emptyMailbox(), item) }));
        },
        skip: async (agreementId, seq) => {
          await updateCompany((c) => ({ ...c, mailbox: bumpHoursSeq(c.mailbox ?? emptyMailbox(), agreementId, seq) }));
        },
      });
      // Then each person's side of the conversation (asking for changes to an offer).
      let latest: Mailbox | null | undefined = mailbox;
      if (!r.off && !r.failed) {
        for (const link of rail.links) {
          if (!link.partiesKey) continue;
          const partiesKey = link.partiesKey;
          await readThread({
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
        }
        // Invitations, now that any new calendar keys are in.
        await checkEvents(letters, businessListening(rail, latest), calendar, updateCompany);
      }
      const message = r.off
        ? "Connect Shield to check for what your team sent."
        : r.failed
          ? `Couldn't finish checking: ${r.failed}`
          : acceptFailed
            ? `Couldn't check for a reply to your offer: ${acceptFailed}`
            : undefined;
      onFinished({
        received: r.received.length,
        skipped: r.skipped.length,
        ...(accepted.length > 0 ? { accepted } : {}),
        ...(message ? { message } : {}),
      });
    })().catch((e: unknown) => onFinished({ received: 0, skipped: 0, message: e instanceof Error ? e.message : "Your letters couldn't be read" }));
  }, [rail, payroll, mailbox, calendar, updateCompany, onFinished, settled, letters, wallet]);

  return null;
}
