"use client";

// ---------------------------------------------------------------------------
// The customer's businesses, checked for what's new: invoices, voids and
// messages from each connected business (chain/clients/checkConnections.ts),
// kept in the vault. Runs once Shield is connected, and on Check again.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useCustomer } from "@/books/BooksProvider";
import { updateConnectionThread } from "@/books/connections";
import { addToThread, emptyThread, skipIncoming } from "@/books/thread";
import { checkConnections } from "../clients/checkConnections";
import { ShieldNeeded } from "../clients/ShieldNeeded";
import { useLetters } from "../letter_reader";

export default function BillsCheck() {
  return (
    <AleoWalletProviderWrapper>
      <Check />
    </AleoWalletProviderWrapper>
  );
}

function Check() {
  const { customer, rail, updateCustomer } = useCustomer();
  const shield = useLetters();
  const { letters, wallet } = shield;
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const latest = useRef(customer);
  latest.current = customer;

  const run = useCallback(async () => {
    if (!letters) return;
    setBusy(true);
    setError(null);
    try {
      const r = await checkConnections({
        conns: latest.current.businesses,
        reader: "worker",
        letters,
        wallet,
        store: async (address, item) => {
          await updateCustomer((c) => ({ ...c, businesses: updateConnectionThread(c.businesses ?? {}, address, (t) => addToThread(t, item), emptyThread) }));
        },
        skip: async (address, seq) => {
          await updateCustomer((c) => ({ ...c, businesses: updateConnectionThread(c.businesses ?? {}, address, (t) => skipIncoming(t, seq), emptyThread) }));
        },
      });
      if (r.failed) setError(r.failed);
      setSaid(r.received === 0 ? "Nothing new." : `${r.received} new ${r.received === 1 ? "message" : "messages"}.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [letters, wallet, updateCustomer]);

  useEffect(() => {
    if (!letters || started.current) return;
    started.current = true;
    void run();
  }, [letters, run]);

  if (!rail) return null;
  if (!letters) return <ShieldNeeded {...shield} linked={rail.address} what="check for new bills" />;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" disabled={busy} onClick={() => void run()}>
        <RefreshCw aria-hidden className="size-4" />
        {busy ? "Checking…" : "Check for new bills"}
      </Button>
      {said && !busy && <span className="text-xs text-muted-foreground">{said}</span>}
      <FormError message={error} />
    </div>
  );
}
