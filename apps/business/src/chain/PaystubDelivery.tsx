"use client";

// The delivery line on a settled rail paystub: when it last went to the
// person, and a Resend (a fresh envelope in the next mailbox slot). Loaded
// by the paystub view through a dynamic import, so a paystub paid outside
// the app never loads this code.

import { useState } from "react";
import type { Paycheck } from "@pnw/payroll";
import { Button } from "@pnw/ui/button";
import { errorMessage } from "@/books/AuthCard";
import { isMailboxOff } from "./deliver";
import { MAILBOX_OFF_MESSAGE, usePaystubDelivery } from "./usePaystubDelivery";

export type PaystubDeliveryProps = { runId: string; paycheck: Paycheck };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function PaystubDelivery({ runId, paycheck }: PaystubDeliveryProps) {
  const { send, off } = usePaystubDelivery();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (paycheck.settlement.status !== "settled") return null;
  const sent = paycheck.delivery;

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await send(runId, paycheck.workerId);
    } catch (e) {
      setError(isMailboxOff(e) ? null : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{busy ? "Sending paystub…" : sent ? `Paystub sent ${when(sent.sentAt)}` : "Paystub not sent"}</span>
      {error && <span className="text-money-negative">· {error}</span>}
      {off ? (
        <span>· {MAILBOX_OFF_MESSAGE}</span>
      ) : (
        !busy && (
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void resend()}>
            {sent ? "Resend paystub" : "Send paystub"}
          </Button>
        )
      )}
    </div>
  );
}
