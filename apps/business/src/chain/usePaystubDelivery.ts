"use client";

// Sends one paystub through the mailbox and writes the outcome to the vault.
// Shared by the pay panel (right after a paycheck settles) and the paystub
// view (Resend). The send reads the latest vault copy, so a delivery never
// starts from a stale paycheck, and the result is applied onto whatever the
// vault holds by then, so settlements landing at the same time are kept.

import { useCallback, useMemo, useRef, useState } from "react";
import { MailboxClient, MailboxError } from "@pnw/mailbox";
import type { PaycheckDelivery } from "@pnw/payroll";
import { useOpenBooks } from "@/books/BooksProvider";
import { deliverPaystub, isMailboxOff, recordDelivery } from "./deliver";

export const MAILBOX_OFF_MESSAGE = "Paystub delivery is off on this server";

export function usePaystubDelivery() {
  const { updateCompany } = useOpenBooks();
  const client = useMemo(() => new MailboxClient(), []);
  // Once the server has said it has no mailbox (503), nothing more is sent
  // this session: every later send fails the same way without a request.
  const [off, setOff] = useState(false);
  const offRef = useRef(false);

  const send = useCallback(
    async (runId: string, workerId: string): Promise<PaycheckDelivery> => {
      if (offRef.current) throw new MailboxError("NOT_CONFIGURED", MAILBOX_OFF_MESSAGE);
      const current = await updateCompany((c) => c);
      try {
        const { delivery } = await deliverPaystub({ company: current, runId, workerId, client });
        await updateCompany((c) => recordDelivery(c, runId, workerId, delivery));
        return delivery;
      } catch (e) {
        if (isMailboxOff(e)) {
          offRef.current = true;
          setOff(true);
        }
        throw e;
      }
    },
    [client, updateCompany],
  );

  return { send, off };
}
