"use client";

// Reading what the team sent: once Shield has had its moment to reconnect
// (letter_reader.ts), first which waiting offers have been accepted, from the
// agreement records in the Shield account (acceptance.ts); then the weeks of
// hours (mailbox_scan.ts), then each person's side of the conversation
// (thread.ts), both from letters on chain and then the old mailbox; then the
// receipts for anything sent through the old mailbox (receipts.ts). Reports
// back; it draws nothing itself. Each week of hours is written to the vault
// before its pin is dropped. Nothing here logs a key, a lookup or an hour.

import { useEffect, useMemo, useRef } from "react";
import { appMailbox } from "./mailbox_client";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { useOpenBooks } from "@/books/BooksProvider";
import { addHours, bumpHoursSeq, emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { hasWaitingOffer } from "@/books/mailbox_feed";
import { addToThread, skipIncoming } from "@/books/thread";
import { checkAcceptances } from "./acceptance";
import { scanHours } from "./mailbox_scan";
import { businessAwaiting, readReceipts, recordBusinessReceipts } from "./receipts";
import { useLetters } from "./letter_reader";
import { letterThread, lettersThenMailbox } from "./letters";
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
  const { rail, payroll, mailbox, updateCompany } = useOpenBooks();
  const { settled, letters, wallet } = useLetters();
  const client = useMemo(() => appMailbox(), []);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !rail || !settled) return;
    started.current = true;
    const awaiting = businessAwaiting({ rail, payroll });
    (async () => {
      // Acceptances first: the waiting offers whose final agreement is now in the Shield account.
      // Shield has to be connected to read them; without it the check says so below.
      let accepted: string[] = [];
      let acceptFailed: string | null = null;
      if (letters) {
        try {
          accepted = (await checkAcceptances({ rail, payroll, requestRecords: wallet.requestRecords, updateCompany })).accepted;
        } catch (e) {
          acceptFailed = e instanceof Error ? e.message : "The agreements couldn't be read";
        }
      }
      // Letters first (once Shield is connected), then the old mailbox; letters need no receipts.
      const reader = letters ? { get: lettersThenMailbox(letters, client).get, drop: (lookup: string) => client.drop(lookup).catch(() => {}) } : client;
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
      if (!r.off && !r.failed) {
        for (const link of rail.links) {
          if (!link.partiesKey) continue;
          const partiesKey = link.partiesKey;
          await readThread({
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
        }
      }
      // Then the receipts for what this business sent through the old mailbox (a mailbox that's off has none).
      if (!r.failed && awaiting.length > 0) {
        await readReceipts(client, awaiting, async (heard) => {
          await updateCompany((c) => recordBusinessReceipts(c, heard));
        });
      }
      const needsShield = !letters && hasWaitingOffer(rail);
      const message = r.off
        ? "Connect Shield to check for what your team sent."
        : r.failed
          ? `Couldn't finish checking: ${r.failed}`
          : acceptFailed
            ? `Couldn't check for a reply to your offer: ${acceptFailed}`
            : needsShield
              ? "Connect Shield to check for a reply to your offer."
              : undefined;
      onFinished({
        received: r.received.length,
        skipped: r.skipped.length,
        ...(accepted.length > 0 ? { accepted } : {}),
        ...(message ? { message } : {}),
      });
    })().catch((e: unknown) => onFinished({ received: 0, skipped: 0, message: e instanceof Error ? e.message : "The mailbox couldn't be read" }));
  }, [rail, payroll, mailbox, client, updateCompany, onFinished, settled, letters, wallet]);

  return null;
}
