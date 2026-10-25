"use client";

// ---------------------------------------------------------------------------
// Payments customers made from Shield (books/client_payments.ts): reads each
// connected customer's conversation for payment messages, then lists the ones
// not in the books yet. One is recorded only once this business's own Shield
// account shows the transfer for that amount (For review); the customer's
// word alone records nothing. Shown on Sales → Invoices. Nothing here logs
// an account, an amount or a letter.
// ---------------------------------------------------------------------------

import { useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { formatCents } from "@pnw/ledger";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { paymentsToRecord, recordClientPayment } from "@/books/client_payments";
import { updateConnectionThread } from "@/books/connections";
import { addToThread, emptyThread, skipIncoming } from "@/books/thread";
import { BRAND } from "@/brand";
import { useLetters } from "../letter_reader";
import { checkConnections } from "./checkConnections";
import { ShieldNeeded } from "./ShieldNeeded";

export default function ClientPayments() {
  return (
    <AleoWalletProviderWrapper>
      <Payments />
    </AleoWalletProviderWrapper>
  );
}

function Payments() {
  const { sales, clients, review, rail, currentCompany, updateCompany } = useOpenBooks();
  const shield = useLetters();
  const { letters, wallet } = shield;
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!rail) return null;
  const waiting = paymentsToRecord({ clients: clients ?? undefined, sales, review: review ?? undefined });
  const names = new Map(sales.customers.map((c) => [c.id, c.name]));

  async function check() {
    if (!letters) return;
    setBusy("check");
    setError(null);
    try {
      const r = await checkConnections({
        conns: currentCompany()?.clients,
        reader: "business",
        letters,
        wallet,
        store: async (address, item) => {
          await updateCompany((c) => ({ ...c, clients: updateConnectionThread(c.clients ?? {}, address, (t) => addToThread(t, item), emptyThread) }));
        },
        skip: async (address, seq) => {
          await updateCompany((c) => ({ ...c, clients: updateConnectionThread(c.clients ?? {}, address, (t) => skipIncoming(t, seq), emptyThread) }));
        },
      });
      if (r.failed) setError(r.failed);
      setSaid(r.received === 0 ? "Nothing new from customers." : `${r.received} new from customers.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function record(transactionId: string) {
    setBusy(transactionId);
    setError(null);
    try {
      await updateCompany((c) => recordClientPayment(c, transactionId));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Payments from customers on {BRAND.name}</h2>
        {letters && (
          <Button variant="ghost" size="sm" className="ml-auto min-h-11 sm:min-h-8" disabled={busy !== null} onClick={() => void check()}>
            <RefreshCw aria-hidden className="size-4" />
            {busy === "check" ? "Checking…" : "Check"}
          </Button>
        )}
      </div>
      {!letters && <ShieldNeeded {...shield} linked={rail.address} what="check for customers' payments" />}
      {waiting.length === 0 ? (
        <p className="text-xs text-muted-foreground">{said ?? "When a customer pays a bill from Shield, it shows here to record against its invoice."}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {waiting.map((p) => (
            <li key={p.transactionId} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
              <span className="min-w-0 flex-1 text-sm">
                {names.get(p.customerId) ?? "A customer"} paid {p.number} · ${formatCents(p.cents)}
                {p.problem && <span className="block text-xs text-muted-foreground">{p.problem}</span>}
              </span>
              {p.seen ? (
                <Button size="sm" className="min-h-11 sm:min-h-8" disabled={busy !== null} onClick={() => void record(p.transactionId)}>
                  {busy === p.transactionId ? "Recording…" : `Record payment for ${p.number}`}
                </Button>
              ) : (
                <Link href="/transactions" className="text-xs underline underline-offset-4">
                  For review
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      <FormError message={error} />
    </section>
  );
}
