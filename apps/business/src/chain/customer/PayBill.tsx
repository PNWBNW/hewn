"use client";

// ---------------------------------------------------------------------------
// Paying a bill from Shield (docs/CUSTOMERS.md, Step 1): exactly the bill's
// amount as a private USDCx transfer to the business's account, through the
// same pay queue payroll uses (pay_shield.ts), so a reload resumes and a
// payment whose outcome isn't known is never sent again on its own. Once it settles,
// a payment message tells the business which invoice it paid and with which
// transfer (one more approval); the business records it only when its own
// account shows the transfer. The customer brings their own USDCx.
// Nothing here logs an account, an amount or a record.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { formatCents } from "@pnw/ledger";
import type { Settlement } from "@pnw/payroll";
import { Button } from "@pnw/ui/button";
import { readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useCustomer } from "@/books/BooksProvider";
import type { BillView } from "@/books/bill";
import { updateConnectionThread } from "@/books/connections";
import { billKey, markPaymentTold, setBillPayment } from "@/books/customer";
import { shortAddress } from "@/books/rail";
import { addToThread, emptyThread } from "@/books/thread";
import { BRAND } from "@/brand";
import { CLIENT_KINDS, connectionKey } from "../clients";
import { ShieldNeeded } from "../clients/ShieldNeeded";
import { useLetters } from "../letter_reader";
import { letterThread } from "../letters";
import { postToThread } from "../thread";
import { TxLink } from "../TxLink";
import { useShield } from "../shield";
import { payOne, railWalletOf } from "./pay_shield";

export default function PayBill({ view }: { view: BillView }) {
  return (
    <AleoWalletProviderWrapper>
      <Pay view={view} />
    </AleoWalletProviderWrapper>
  );
}

function Pay({ view }: { view: BillView }) {
  const { rail, customer, updateCustomer, currentCompany } = useCustomer();
  const letters = useLetters();
  const shield = useShield();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = billKey(view.address, view.bill.id);
  const payment = customer.payments?.[key];
  const running = useRef(false);
  if (!rail) return null;
  const amount = `$${formatCents(BigInt(view.bill.total))}`;
  const start = { address: view.address, invoiceId: view.bill.id, number: view.bill.number, cents: view.bill.total };
  const write = (s: Settlement) => updateCustomer((c) => setBillPayment(c, start, s));

  async function pay() {
    if (running.current || !letters.address) return;
    running.current = true;
    setBusy("pay");
    setError(null);
    setConfirming(false);
    try {
      // Start (or resume) from what the vault holds, so a payment already on its way is watched, not sent again.
      const latest = (await updateCustomer((c) => setBillPayment(c, start, c.payments?.[key]?.settlement.status === "failed" ? { status: "pending" } : (c.payments?.[key]?.settlement ?? { status: "pending" }))))
        .payments![key]!;
      const r = await payOne({ wallet: railWalletOf(shield.wallet, letters.address), key, to: view.address, cents: BigInt(latest.cents), settlement: latest.settlement, write });
      if (r.transactionId) await tell(r.transactionId);
      else if (r.failure) setError(r.failure);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  /** Tells the business which invoice was paid and with which transfer: one message, one approval. */
  async function tell(transactionId: string) {
    setBusy("tell");
    setError(null);
    try {
      if (!letters.letters) throw new Error("Connect Shield first");
      const conn = currentCompany()?.customer?.businesses?.[view.address];
      if (!conn) throw new Error("You're not connected with that business any more");
      const { writer } = letterThread(letters.wallet, view.address, { letters: letters.letters });
      const item = await postToThread({
        client: writer,
        partiesKey: await connectionKey(conn),
        from: "worker",
        nextOut: conn.thread?.nextOut ?? 0,
        body: { type: "payment", invoiceId: view.bill.id, number: view.bill.number, amount: view.bill.total, transactionId },
        kinds: CLIENT_KINDS,
        feeMode: readFeeMode(),
      });
      const at = new Date().toISOString();
      await updateCustomer((c) => markPaymentTold({ ...c, businesses: updateConnectionThread(c.businesses ?? {}, view.address, (t) => addToThread(t, item), emptyThread) }, key, at));
    } catch (e) {
      setError(`Paid, but the business wasn't told yet: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function payAgain() {
    setError(null);
    try {
      await write({ status: "failed", failure: "Marked to pay again after checking Shield" });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const s = payment?.settlement;
  let body;
  if (!letters.letters) {
    body = <ShieldNeeded {...letters} linked={rail.address} what="pay this bill" />;
  } else if (s?.status === "settled") {
    body = (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-money-positive">Paid {amount} from Shield{s.settledAt ? ` on ${new Date(s.settledAt).toLocaleDateString()}` : ""}.</p>
        {s.reference && <TxLink id={s.reference} network={rail.network} />}
        {payment?.toldAt ? (
          <p className="text-xs text-muted-foreground">{view.business} was told; it shows in their books once they record it.</p>
        ) : (
          <Button variant="outline" className="min-h-11 self-start sm:min-h-9" disabled={busy !== null || !s.reference} onClick={() => void tell(s.reference!)}>
            {busy === "tell" ? "Sending…" : `Tell ${view.business} it's paid`}
          </Button>
        )}
      </div>
    );
  } else if (s?.status === "pending" && (s.reference || s.attempt || s.failure)) {
    body = (
      <div className="flex flex-col gap-2">
        <p className="text-sm">{s.failure ?? "This payment is on its way."}</p>
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11 sm:min-h-9" disabled={busy !== null} onClick={() => void pay()}>
            {busy === "pay" ? "Checking…" : "Check on it"}
          </Button>
          {s.failure && (
            <Button variant="ghost" className="min-h-11 sm:min-h-9" disabled={busy !== null} onClick={() => void payAgain()}>
              I checked Shield: it didn&apos;t go
            </Button>
          )}
        </div>
      </div>
    );
  } else if (confirming) {
    body = (
      <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
        <p className="text-sm">
          Pay <span className="font-medium">{amount}</span> in USDCx from Shield to {view.business}.{BRAND.nameSuffix} ({shortAddress(view.address)}) for invoice{" "}
          {view.bill.number}?
        </p>
        <p className="text-xs text-muted-foreground">
          A private transfer: nobody but the two of you sees the amount or who paid whom. You need {amount} in USDCx in Shield, plus the network fee
          {readFeeMode() === "private" ? " (paid privately)" : ""}. Then one more approval tells the business it&apos;s paid.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button className="min-h-11 sm:min-h-9" onClick={() => void pay()}>
            Pay {amount}
          </Button>
          <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  } else {
    body = (
      <Button className="min-h-11 self-start sm:min-h-9" disabled={busy !== null} onClick={() => setConfirming(true)}>
        {busy === "pay" ? "Paying… approve it in Shield" : `Pay ${amount} from Shield`}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {s?.status === "failed" && <p className="text-sm text-destructive">The last try didn&apos;t go through: {s.failure}</p>}
      {body}
      <FormError message={error} />
    </div>
  );
}
