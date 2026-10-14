"use client";

// Reading the business's mailbox: runs the scan (mailbox_scan.ts) once when
// it mounts and reports back; it draws nothing itself. Needs no Shield: the
// parties keys are in the vault. Each week of hours is written to the vault
// before its pin is dropped. Nothing here logs a key, a lookup or an hour.

import { useEffect, useMemo, useRef } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { useOpenBooks } from "@/books/BooksProvider";
import { addHours, bumpHoursSeq, emptyMailbox } from "@/books/mailbox";
import { MAILBOX_OFF_MESSAGE, scanHours } from "./mailbox_scan";

export type CheckOutcome = { received: number; skipped: number; message?: string };

export type MailboxCheckProps = { onFinished: (outcome: CheckOutcome) => void };

export default function MailboxCheck({ onFinished }: MailboxCheckProps) {
  const { rail, mailbox, updateCompany } = useOpenBooks();
  const client = useMemo(() => new MailboxClient(), []);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !rail) return;
    started.current = true;
    void scanHours({
      rail,
      mailbox,
      client,
      store: async (item) => {
        await updateCompany((c) => ({ ...c, mailbox: addHours(c.mailbox ?? emptyMailbox(), item) }));
      },
      skip: async (agreementId, seq) => {
        await updateCompany((c) => ({ ...c, mailbox: bumpHoursSeq(c.mailbox ?? emptyMailbox(), agreementId, seq) }));
      },
    }).then(
      (r) =>
        onFinished({
          received: r.received.length,
          skipped: r.skipped.length,
          ...(r.off ? { message: MAILBOX_OFF_MESSAGE } : r.failed ? { message: `Couldn't finish checking: ${r.failed}` } : {}),
        }),
      (e: unknown) => onFinished({ received: 0, skipped: 0, message: e instanceof Error ? e.message : "The mailbox couldn't be read" }),
    );
  }, [rail, mailbox, client, updateCompany, onFinished]);

  return null;
}
