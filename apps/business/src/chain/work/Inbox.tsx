"use client";

// Checking for new paystubs: connects Shield, then runs the scan (inbox.ts)
// over this account's letters (then the old mailbox) for every accepted
// agreement, writing each paystub to the vault. Letters need no receipts; a
// receipt read for weeks of hours sent through the old mailbox still runs
// when the mailbox is on. Nothing here logs a key, a lookup or a document.

import { useEffect, useRef, useState } from "react";
import { appMailbox } from "../mailbox_client";
import { Button } from "@pnw/ui/button";
import { FormError } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { addPaystub, bumpWorkSeq } from "@/books/work";
import { LetterBox, lettersThenMailbox } from "../letters";
import { readReceipts, recordWorkReceipts, workAwaiting } from "../receipts";
import { ShieldGate, WorkShieldProvider, useWorkShield } from "./WorkShield";
import { type ScanResult, scanPaystubs } from "./inbox";

export type InboxPanelProps = { onClose: () => void };

export default function InboxPanel({ onClose }: InboxPanelProps) {
  return (
    <WorkShieldProvider>
      <ShieldGate onClose={onClose}>{() => <InboxFlow onClose={onClose} />}</ShieldGate>
    </WorkShieldProvider>
  );
}

function InboxFlow({ onClose }: InboxPanelProps) {
  const { work, updateWork } = useWork();
  const { wallet } = useWorkShield();
  const [result, setResult] = useState<ScanResult | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const mailbox = appMailbox();
    const letters = lettersThenMailbox(new LetterBox({ wallet }), mailbox);
    const awaiting = workAwaiting(work);
    void scanPaystubs({
      work,
      client: { get: letters.get, drop: (lookup) => mailbox.drop(lookup).catch(() => {}) },
      store: async (p) => {
        await updateWork((w) => addPaystub(w, p));
      },
      skip: async (agreementId, seq) => {
        await updateWork((w) => bumpWorkSeq(w, agreementId, "paystub", seq));
      },
    }).then(async (r) => {
      if (!r.failed && awaiting.length > 0) {
        // Weeks of hours sent through the old mailbox; a mailbox that's off has none to report.
        await readReceipts(mailbox, awaiting, async (heard) => {
          await updateWork((w) => recordWorkReceipts(w, heard));
        }).catch(() => {});
      }
      setResult(r);
    });
  }, [work, updateWork, wallet]);

  const scanned = work.agreements.filter((a) => a.status !== "pending").length;

  return (
    <>
      {result === null ? (
        <p className="text-sm text-muted-foreground">{scanned === 0 ? "No agreements to check yet. Accept an offer first." : "Checking for new paystubs…"}</p>
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
    </>
  );
}
