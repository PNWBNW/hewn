"use client";

// ---------------------------------------------------------------------------
// Invoices to customers on the app (books/bill.ts): every sent invoice whose
// customer is connected and hasn't had it yet, and every one voided since it
// went. Sending is one message in the conversation the two share, one Shield
// approval. Shown on Sales → Invoices. Nothing here logs an account, an
// amount or a letter.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Send } from "lucide-react";
import { formatCents } from "@pnw/ledger";
import { invoiceTotals } from "@pnw/sales";
import { Button } from "@pnw/ui/button";
import { readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { billOf, invoicesToDeliver } from "@/books/bill";
import { updateConnectionThread } from "@/books/connections";
import { type ThreadBody, addToThread, emptyThread } from "@/books/thread";
import { BRAND } from "@/brand";
import { CLIENT_KINDS, connectionKey } from "../clients";
import { useLetters } from "../letter_reader";
import { letterThread } from "../letters";
import { postToThread } from "../thread";
import { ShieldNeeded } from "./ShieldNeeded";

export default function DeliverInvoices() {
  return (
    <AleoWalletProviderWrapper>
      <Deliver />
    </AleoWalletProviderWrapper>
  );
}

function Deliver() {
  const { sales, clients, rail, currentCompany, updateCompany } = useOpenBooks();
  const shield = useLetters();
  const { letters, wallet } = shield;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const due = invoicesToDeliver(sales, clients ?? undefined);
  if (!rail || due.length === 0) return null;
  const names = new Map(sales.customers.map((c) => [c.id, c.name]));

  async function deliver(d: (typeof due)[number]) {
    const key = `${d.address}:${d.invoice.id}`;
    setBusy(key);
    setError(null);
    try {
      if (!letters) throw new Error("Connect Shield first");
      const conn = currentCompany()?.clients?.[d.address];
      if (!conn) throw new Error("That customer isn't connected any more");
      const body: ThreadBody = d.send === "invoice" ? { type: "invoice", bill: billOf(d.invoice, conn) } : { type: "invoice_void", id: d.invoice.id, number: d.invoice.number };
      const { writer } = letterThread(wallet, d.address, { letters });
      const item = await postToThread({ client: writer, partiesKey: await connectionKey(conn), from: "business", nextOut: conn.thread?.nextOut ?? 0, body, kinds: CLIENT_KINDS, feeMode: readFeeMode() });
      await updateCompany((c) => ({ ...c, clients: updateConnectionThread(c.clients ?? {}, d.address, (t) => addToThread(t, item), emptyThread) }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">To send to customers on {BRAND.name}</h2>
      <p className="text-xs text-muted-foreground">They see it under Bills, sealed to the two of you. Each is one approval in Shield.</p>
      {!letters && <ShieldNeeded {...shield} linked={rail.address} what="send invoices" />}
      <ul className="divide-y rounded-md border">
        {due.map((d) => {
          const key = `${d.address}:${d.invoice.id}`;
          return (
            <li key={key} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {d.send === "void" ? "Void " : ""}
                {d.invoice.number} · {names.get(d.invoice.customerId) ?? "A customer"}
                {d.send === "invoice" && <span className="text-muted-foreground"> · ${formatCents(invoiceTotals(d.invoice).total)}</span>}
              </span>
              <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={!letters || busy !== null} onClick={() => void deliver(d)}>
                <Send aria-hidden className="size-4" />
                {busy === key ? "Sending…" : d.send === "void" ? "Tell them" : "Send"}
              </Button>
            </li>
          );
        })}
      </ul>
      <FormError message={error} />
    </section>
  );
}
