"use client";

// Sends one paystub as a letter to the person (deliver.ts; one Shield
// approval) and writes the outcome to the vault. Shared by the pay panel
// (once the payments are done) and the paystub view (Resend). The send reads
// the latest vault copy, so a delivery never starts from a stale paycheck,
// and the result is applied onto whatever the vault holds by then, so
// settlements landing at the same time are kept.

import { useCallback } from "react";
import type { PaycheckDelivery } from "@pnw/payroll";
import { useOpenBooks } from "@/books/BooksProvider";
import { linkFor } from "@/books/rail";
import { DeliveryError, deliverPaystub, recordDelivery } from "./deliver";
import { LetterBox, type LetterWallet } from "./letters";

/** `wallet`: Shield, connected to the account linked to these books. */
export function usePaystubDelivery(wallet: LetterWallet) {
  const { updateCompany } = useOpenBooks();
  return useCallback(
    async (runId: string, workerId: string): Promise<PaycheckDelivery> => {
      const current = await updateCompany((c) => c);
      const to = current.rail ? linkFor(current.rail, workerId)?.address : undefined;
      if (!to) throw new DeliveryError("This person has no account on the rail yet: Settings → Import team");
      const { delivery } = await deliverPaystub({ company: current, runId, workerId, client: new LetterBox({ wallet, to }) });
      await updateCompany((c) => recordDelivery(c, runId, workerId, delivery));
      return delivery;
    },
    [wallet, updateCompany],
  );
}
