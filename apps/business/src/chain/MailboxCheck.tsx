"use client";

// Reading the business's mailbox: runs the scan (mailbox_scan.ts) once when
// it mounts, then each person's side of the conversation (thread.ts), then
// the receipts for offers and paystubs it sent (receipts.ts), and reports
// back; it draws nothing itself. Needs no Shield: the parties keys are in the vault. Each week of hours is written to the vault
// before its pin is dropped. Nothing here logs a key, a lookup or an hour.

import { useEffect, useMemo, useRef } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { useOpenBooks } from "@/books/BooksProvider";
import { addHours, bumpHoursSeq, emptyMailbox, threadFor, updateThread } from "@/books/mailbox";
import { addToThread, skipIncoming } from "@/books/thread";
import { MAILBOX_OFF_MESSAGE, scanHours } from "./mailbox_scan";
import { businessAwaiting, readReceipts, recordBusinessReceipts } from "./receipts";
import { readThread } from "./thread";

export type CheckOutcome = { received: number; skipped: number; message?: string };

export type MailboxCheckProps = { onFinished: (outcome: CheckOutcome) => void };

export default function MailboxCheck({ onFinished }: MailboxCheckProps) {
  const { rail, payroll, mailbox, updateCompany } = useOpenBooks();
  const client = useMemo(() => new MailboxClient(), []);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !rail) return;
    started.current = true;
    const awaiting = businessAwaiting({ rail, payroll });
    (async () => {
      const r = await scanHours({
        rail,
        mailbox,
        client,
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
        }
      }
      // Then the receipts for what this business sent: offers still waiting, paystubs delivered.
      if (!r.off && !r.failed && awaiting.length > 0) {
        await readReceipts(client, awaiting, async (heard) => {
          await updateCompany((c) => recordBusinessReceipts(c, heard));
        });
      }
      onFinished({
        received: r.received.length,
        skipped: r.skipped.length,
        ...(r.off ? { message: MAILBOX_OFF_MESSAGE } : r.failed ? { message: `Couldn't finish checking: ${r.failed}` } : {}),
      });
    })().catch((e: unknown) => onFinished({ received: 0, skipped: 0, message: e instanceof Error ? e.message : "The mailbox couldn't be read" }));
  }, [rail, payroll, mailbox, client, updateCompany, onFinished]);

  return null;
}
