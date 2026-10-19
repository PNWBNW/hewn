"use client";

// Sending one week to one employer as a letter on chain (timesheet.ts; one
// Shield approval, with its fee choice), and recording it in the vault.
// A slot already sent under counts as sent.

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useWork } from "@/books/BooksProvider";
import { formatMinutes, sendableMinutes } from "@/books/hours";
import { shortAddress } from "@/books/rail";
import { agreementFor, recordTimesheet, sentWeek } from "@/books/work";
import { BRAND } from "@/brand";
import { FeeChoice } from "../FeeChoice";
import { LetterBox } from "../letters";
import { ShieldGate, WorkShieldProvider, useWorkShield } from "./WorkShield";
import { sendTimesheet } from "./timesheet";

export type SendTimesheetPanelProps = { agreementId: string; weekStart: string; onClose: () => void };

export default function SendTimesheetPanel(props: SendTimesheetPanelProps) {
  return (
    <WorkShieldProvider>
      <ShieldGate onClose={props.onClose}>{() => <SendFlow {...props} />}</ShieldGate>
    </WorkShieldProvider>
  );
}

function SendFlow({ agreementId, weekStart, onClose }: SendTimesheetPanelProps) {
  const { work, updateWork } = useWork();
  const { wallet } = useWorkShield();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const agreement = agreementFor(work, agreementId);
  const already = sentWeek(work, agreementId, weekStart);
  const minutes = sendableMinutes(work, agreementId, weekStart, new Date());
  const employer = agreement?.employerName ? `${agreement.employerName}.${BRAND.nameSuffix}` : agreement ? shortAddress(agreement.employerAddress) : "";

  async function send() {
    if (!agreement) return;
    setBusy(true);
    setError(null);
    try {
      const latest = await updateWork((w) => w);
      const { sent } = await sendTimesheet({ work: latest, agreementId, weekStart, feeMode, client: new LetterBox({ wallet, to: agreement.employerAddress }) });
      await updateWork((w) => recordTimesheet(w, sent));
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {done ? (
        <p className="text-sm">
          Sent to {employer}: {formatMinutes(minutes)} for the week of {weekStart}. These shifts are confirmed and theirs to change now.
        </p>
      ) : (
        <>
          <p className="text-sm">
            {already ? "Update" : "Send"} the weekly timecard for the week of {weekStart} to <span className="font-medium">{employer}</span>: {formatMinutes(minutes)}?
            {already && ` You sent it before (${formatMinutes(already.totalMinutes)}); this update adds what's new to that week's card on their side.`} Once sent,
            these shifts are confirmed and theirs to change.
          </p>
          <p className="text-xs text-muted-foreground">
            It goes as a sealed letter on the network that only {employer} can open: one approval in Shield.
          </p>
          {busy ? <p className="text-sm text-muted-foreground">Approve it in Shield; it&apos;s on the network in about a minute.</p> : <FeeChoice value={feeMode} onChange={setFeeMode} />}
        </>
      )}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        {!done && (
          <Button className="min-h-11 sm:min-h-9" disabled={busy || minutes === 0} onClick={() => void send()}>
            {busy ? "Sending…" : already ? "Update" : "Send"}
          </Button>
        )}
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
          {done ? "Done" : "Cancel"}
        </Button>
      </div>
    </>
  );
}
