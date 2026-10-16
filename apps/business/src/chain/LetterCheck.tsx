"use client";

// ---------------------------------------------------------------------------
// Settings → "Send a test letter": one real letter to this account itself
// through hewn_letters_v1 (letter_check.ts), and a short report of what it
// cost, how long it took and whether Shield found it, with a Copy button.
// One Shield approval; the letter says nothing about anyone.
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
import { fetchExplorerTransaction } from "./decrypt";
import { letterCheckReport, runLetterCheck } from "./letter_check";
import { useShield } from "./shield";

export default function LetterCheck({ onClose }: { onClose: () => void }) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-4 rounded-md border bg-muted/40 p-4">
        <CheckFlow onClose={onClose} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

function CheckFlow({ onClose }: { onClose: () => void }) {
  const { rail } = useOpenBooks();
  const { state, connect, error: connectError, wallet } = useShield();
  const [report, setReport] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const address = state.kind === "connected" ? state.address : null;
  const mismatch = address !== null && rail !== null && address !== rail.address;

  async function run() {
    if (!address) return;
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const r = await runLetterCheck({ wallet, address, fetchTransaction: (id) => fetchExplorerTransaction(id, ENV.ALEO_ENDPOINT) });
      setReport(letterCheckReport(r, todayIso()));
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
        <h3 className="text-sm font-semibold">Send a test letter</h3>
        <p className="text-xs text-muted-foreground">
          Sends one sealed letter to this account itself, on the network, and reports what it cost, how long it took and whether Shield found it.
          Shield asks you to approve once; the fee is paid the way the dashboard&apos;s fee switch says. If Shield says it doesn&apos;t know the
          letters program, disconnect this app in Shield and connect again.
        </p>
      </div>

      {!address ? (
        <ShieldStatus state={state} connect={connect} onClose={onClose} />
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
          {running && <p className="text-xs text-muted-foreground">Approve in Shield, then wait: proving, the network and Shield finding it can take a few minutes.</p>}
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-11 sm:min-h-9" disabled={running} onClick={() => void run()}>
              {running ? "Sending…" : report ? "Send another" : "Send it"}
            </Button>
            {report && (
              <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => void copy()}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copied" : "Copy report"}
              </Button>
            )}
            <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={running} onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )}
      <FormError message={error ?? connectError} />
    </>
  );
}
