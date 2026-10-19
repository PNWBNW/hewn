"use client";

// ---------------------------------------------------------------------------
// Settings → "Check Shield history": runs the read-only probe (history_probe.ts)
// and shows its report, with a Copy button so it can be pasted into a chat.
// It reads; it never signs, posts or stores anything.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { ENV } from "@pnw/config/env";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { todayIso } from "@/books/display";
import { shortAddress } from "@/books/rail";
import { ShieldStatus } from "./ShieldStatus";
import { decryptTransition, fetchExplorerTransaction } from "./decrypt";
import { type Opened, reportText, runProbe, summariseOpened } from "./history_probe";
import { useShield } from "./shield";

export default function HistoryProbe({ onClose }: { onClose: () => void }) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-4 rounded-md border bg-muted/40 p-4">
        <ProbeFlow onClose={onClose} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

const fetchTransaction = (id: string) => fetchExplorerTransaction(id, ENV.ALEO_ENDPOINT);

/** Decrypts one transition with a transition view key and says how much of it could be read. */
async function openTransition(transition: unknown, tvk: string): Promise<Opened> {
  return summariseOpened(await decryptTransition(transition, tvk));
}

function ProbeFlow({ onClose }: { onClose: () => void }) {
  const { rail } = useOpenBooks();
  const { state, route, connect, error: connectError, wallet } = useShield();
  const [report, setReport] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const address = state.kind === "connected" ? state.address : null;
  const mismatch = address !== null && rail !== null && address !== rail.address;

  async function run() {
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const r = await runProbe({
        wallet: {
          requestRecords: (p, all) => wallet.requestRecords(p, all),
          requestTransactionHistory: (p) => wallet.requestTransactionHistory(p),
          transitionViewKeys: (id) => wallet.transitionViewKeys(id),
        },
        fetchTransaction,
        open: openTransition,
      });
      setReport(reportText(r, todayIso()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  async function copy() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the text and copy it instead.");
    }
  }

  return (
    <>
      <div>
        <h3 className="text-sm font-semibold">Check Shield history</h3>
        <p className="text-xs text-muted-foreground">
          Reads what Shield can tell the books about past transfers. It only reads: nothing is signed, posted or saved. The report holds counts
          and field names, never an account, an amount or a transaction id.
        </p>
      </div>

      {!address ? (
        <ShieldStatus state={state} route={route} connect={connect} onClose={onClose} />
      ) : mismatch && rail ? (
        <>
          <p className="text-sm">
            Shield is signed in to a different account ({shortAddress(address)}) than the one linked to these books ({shortAddress(rail.address)}).
            Switch accounts in Shield, then try again.
          </p>
          <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
            Close
          </Button>
        </>
      ) : (
        <>
          {report && <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-card p-3 text-xs leading-5">{report}</pre>}
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-11 sm:min-h-9" disabled={running} onClick={() => void run()}>
              {running ? "Checking… approve in Shield if asked" : report ? "Check again" : "Run the check"}
            </Button>
            {report && (
              <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => void copy()}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copied" : "Copy report"}
              </Button>
            )}
            <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )}
      <FormError message={error ?? connectError} />
    </>
  );
}
