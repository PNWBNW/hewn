"use client";

// Checking for new paystubs: runs the mailbox scan (inbox.ts) for every
// accepted agreement the moment it opens, writing each paystub to the vault
// before its pin is dropped, then reads the receipts for weeks of hours this
// person sent (receipts.ts). Needs no Shield: the parties keys are in the
// vault. Nothing here logs a key, a lookup or a document.

import { useEffect, useRef, useState } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { Button } from "@pnw/ui/button";
import { FormError } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { addPaystub, bumpWorkSeq } from "@/books/work";
import { readReceipts, recordWorkReceipts, workAwaiting } from "../receipts";
import { INBOX_OFF_MESSAGE, type ScanResult, scanPaystubs } from "./inbox";

export type InboxPanelProps = { onClose: () => void };

export default function InboxPanel({ onClose }: InboxPanelProps) {
  const { work, updateWork } = useWork();
  const [result, setResult] = useState<ScanResult | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const client = new MailboxClient();
    const awaiting = workAwaiting(work);
    void scanPaystubs({
      work,
      client,
      store: async (p) => {
        await updateWork((w) => addPaystub(w, p));
      },
      skip: async (agreementId, seq) => {
        await updateWork((w) => bumpWorkSeq(w, agreementId, "paystub", seq));
      },
    }).then(async (r) => {
      if (!r.off && !r.failed && awaiting.length > 0) {
        await readReceipts(client, awaiting, async (heard) => {
          await updateWork((w) => recordWorkReceipts(w, heard));
        });
      }
      setResult(r);
    });
  }, [work, updateWork]);

  const scanned = work.agreements.filter((a) => a.status !== "pending").length;

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-4">
      {result === null ? (
        <p className="text-sm text-muted-foreground">{scanned === 0 ? "No agreements to check yet. Accept an offer first." : "Checking for new paystubs…"}</p>
      ) : result.off ? (
        <p className="text-sm text-muted-foreground">{INBOX_OFF_MESSAGE}</p>
      ) : (
        <>
          <p className="text-sm">
            {result.received.length === 0 ? "No new paystubs." : `${result.received.length} new ${result.received.length === 1 ? "paystub" : "paystubs"} arrived.`}
          </p>
          {result.skipped.map((s) => (
            <FormError key={`${s.agreementId}:${s.seq}`} message={`One document couldn't be read and was skipped: ${s.message}`} />
          ))}
          <FormError message={result.failed ? `Couldn't finish checking: ${result.failed}` : null} />
        </>
      )}
      <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
