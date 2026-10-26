// ---------------------------------------------------------------------------
// One payment from the customer's Shield account to a business's, through the
// pay queue payroll uses (@pnw/rail): a reload resumes, and a payment whose
// outcome isn't known is never sent again on its own. Shared by paying a bill
// (PayBill) and paying a business without one (PayBusiness). Every step of the
// transfer is written through `write` before the next, so the vault always
// holds where it stands. Nothing here logs an account, an amount or a record.
// ---------------------------------------------------------------------------

import type { Settlement } from "@pnw/payroll";
import { type PayQueueEvent, type RailWallet, explorerNetwork, runPayQueue } from "@pnw/rail";
import type { useShield } from "../shield";

export function railWalletOf(wallet: ReturnType<typeof useShield>["wallet"], address: string): RailWallet {
  return {
    address,
    requestRecords: (program, all) => wallet.requestRecords(program, all),
    executeTransaction: async (opts) => {
      const r = await wallet.executeTransaction(opts);
      if (!r?.transactionId) throw new Error("Shield didn't take the payment");
      return r;
    },
    transactionStatus: (id) => wallet.transactionStatus(id),
  };
}

export type PayOne = {
  wallet: RailWallet;
  /** The queue's id for this payment: the same on every try. */
  key: string;
  /** The business's account. */
  to: string;
  cents: bigint;
  /** Where it stands in the vault now. */
  settlement: Settlement;
  write: (s: Settlement) => Promise<unknown>;
};

/** Sends it, or checks on it if it's already on its way: the transfer once settled, or why not; neither when there was nothing left to send. */
export async function payOne({ wallet, key, to, cents, settlement, write }: PayOne): Promise<{ transactionId?: string; failure?: string }> {
  const onProgress = (e: PayQueueEvent) => {
    if (e.kind === "sent") void write({ status: "pending", reference: e.reference, ...(e.attempt ? { attempt: e.attempt } : {}) });
    if (e.kind === "settled") void write({ status: "settled", reference: e.transactionId, settledAt: new Date().toISOString(), ...(e.height !== undefined ? { height: e.height } : {}) });
    if (e.kind === "failed") void write({ status: "failed", failure: e.failure, ...(e.attempt ? { attempt: e.attempt } : {}) });
    if (e.kind === "unconfirmed") void write({ status: "pending", failure: e.failure, ...(e.reference ? { reference: e.reference } : {}), ...(e.attempt ? { attempt: e.attempt } : {}) });
  };
  const result = await runPayQueue({
    wallet,
    network: explorerNetwork(),
    run: { id: key, mode: "rail", paychecks: [{ workerId: key, net: cents, settlement }] },
    links: new Map([[key, to]]),
    onProgress,
    beforeSend: async (_who, attempt) => {
      await write({ status: "pending", attempt });
    },
  });
  const settled = result.settled[0];
  if (settled) return { transactionId: settled.transactionId };
  const failure = result.failed[0]?.failure ?? result.unconfirmed[0]?.failure;
  return failure ? { failure } : {};
}
