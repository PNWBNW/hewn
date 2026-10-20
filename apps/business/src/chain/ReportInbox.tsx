"use client";

// ---------------------------------------------------------------------------
// Hewn's report inbox (chain/report.ts): every report sent to Hewn's account,
// newest first, read from Shield's letters each time it's opened. Settings
// shows it only when these books are linked to that account, and Shield opens
// the letters only for it. Nothing is kept in the books and nothing is logged.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { cn } from "@pnw/ui/utils";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { shortAddress } from "@/books/rail";
import { REPORT_LABEL, notifiesSender } from "@/books/report";
import { BRAND } from "@/brand";
import { ShieldStatus } from "./ShieldStatus";
import { useLetters } from "./letter_reader";
import { type ReceivedReport, openReports } from "./report";

const stamp = (iso: string) => new Date(iso).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function ReportInbox({ onClose }: { onClose: () => void }) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
        <Inbox onClose={onClose} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

function Inbox({ onClose }: { onClose: () => void }) {
  const { state, route, connect, error: shieldError, address, letters, wallet } = useLetters();
  const [reports, setReports] = useState<ReceivedReport[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !!letters && address === BRAND.reportsAccount;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await openReports((program, plaintext) => wallet.requestRecords(program, plaintext)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    if (ready && reports === null && !loading) void load();
  }, [ready, reports, loading, load]);

  if (!letters) {
    return (
      <>
        <ShieldStatus state={state} route={route} connect={connect} onClose={onClose} />
        {shieldError && <p className="text-sm text-destructive">{shieldError}</p>}
      </>
    );
  }
  if (!ready) {
    return (
      <>
        <p className="text-sm">Reports open only in Hewn&apos;s account ({shortAddress(BRAND.reportsAccount)}).</p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={onClose}>
          Close
        </Button>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{reports === null ? "Reading reports…" : `${reports.length} ${reports.length === 1 ? "report" : "reports"}`}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={loading} onClick={() => void load()}>
            <RefreshCw aria-hidden className={cn(loading && "animate-spin")} />
            {loading ? "Reading…" : "Check"}
          </Button>
          <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <FormError message={error} />
      {reports?.length === 0 && <p className="text-sm text-muted-foreground">No reports yet.</p>}
      <ol className="flex flex-col gap-3">
        {reports?.map(({ report: r, reporter, transactionId }) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-md border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{REPORT_LABEL[r.category]}</span>
              <span className="text-xs text-muted-foreground">{stamp(r.reportedAt)}</span>
            </div>
            <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">About</dt>
              <dd className="break-all">
                {r.about.name}
                {r.about.account && <span className="font-mono"> · {r.about.account}</span>}
              </dd>
              <dt className="text-muted-foreground">Reported by</dt>
              <dd className="break-all font-mono">{reporter ?? "Shield didn't say"}</dd>
              <dt className="text-muted-foreground">Sender told</dt>
              <dd>{notifiesSender(r.category) ? "Yes, if the notice went" : "No (harassment)"}</dd>
              <dt className="text-muted-foreground">Report id</dt>
              <dd className="font-mono">{r.id}</dd>
              {transactionId && (
                <>
                  <dt className="text-muted-foreground">Transaction</dt>
                  <dd className="break-all font-mono">{transactionId}</dd>
                </>
              )}
            </dl>
            <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-4 bg-muted/50 px-3 py-2">{r.message.text}</blockquote>
            <p className="text-xs text-muted-foreground">Sent {stamp(r.message.sentAt)}</p>
            {r.note && <p className="whitespace-pre-wrap break-words">Note: {r.note}</p>}
          </li>
        ))}
      </ol>
    </>
  );
}
