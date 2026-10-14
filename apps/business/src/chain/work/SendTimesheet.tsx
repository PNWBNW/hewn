"use client";

// Sending one week to one employer through the mailbox (timesheet.ts), and
// recording it in the vault. Needs no Shield: the parties key is in the
// vault. 409 counts as sent; 503 is the one-line "delivery is off" message.

import { useState } from "react";
import { MailboxClient } from "@pnw/mailbox";
import { Button } from "@pnw/ui/button";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { formatMinutes, weekMinutes } from "@/books/hours";
import { shortAddress } from "@/books/rail";
import { agreementFor, recordTimesheet, sentWeek } from "@/books/work";
import { BRAND } from "@/brand";
import { isMailboxOff, sendTimesheet } from "./timesheet";

export type SendTimesheetPanelProps = { agreementId: string; weekStart: string; onClose: () => void };

export const TIMESHEET_OFF_MESSAGE = "Timesheet delivery is off on this server";

export default function SendTimesheetPanel({ agreementId, weekStart, onClose }: SendTimesheetPanelProps) {
  const { work, updateWork } = useWork();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [off, setOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const agreement = agreementFor(work, agreementId);
  const already = sentWeek(work, agreementId, weekStart);
  const minutes = weekMinutes(work.punches, agreementId, weekStart, new Date());
  const employer = agreement?.employerName ? `${agreement.employerName}.${BRAND.nameSuffix}` : agreement ? shortAddress(agreement.employerAddress) : "";

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const latest = await updateWork((w) => w);
      const { sent } = await sendTimesheet({ work: latest, agreementId, weekStart, client: new MailboxClient() });
      await updateWork((w) => recordTimesheet(w, sent));
      setDone(true);
    } catch (e) {
      if (isMailboxOff(e)) setOff(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-4">
      {off ? (
        <p className="text-sm text-muted-foreground">{TIMESHEET_OFF_MESSAGE}</p>
      ) : done ? (
        <p className="text-sm">Sent to {employer}: {formatMinutes(minutes)} for the week of {weekStart}.</p>
      ) : (
        <>
          <p className="text-sm">
            Send {formatMinutes(minutes)} for the week of {weekStart} to <span className="font-medium">{employer}</span>?
            {already && ` You sent this week before (${formatMinutes(already.totalMinutes)}); sending again replaces it.`}
          </p>
          <p className="text-xs text-muted-foreground">Only {employer} can open it. The hours leave this device sealed, and nothing else does.</p>
        </>
      )}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        {!done && !off && (
          <Button className="min-h-11 sm:min-h-9" disabled={busy || minutes === 0} onClick={() => void send()}>
            {busy ? "Sending…" : already ? "Send again" : "Send"}
          </Button>
        )}
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          {done || off ? "Done" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}
