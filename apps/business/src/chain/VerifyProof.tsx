"use client";

// ---------------------------------------------------------------------------
// Check a period proof (docs/AUDIT_DESIGN.md §4, the verifier), for anyone: an accountant, an
// auditor, the business itself. The file is read on this device and never sent anywhere. The
// offline checks (@pnw/ledger `checkPeriodProof`) recompute every entry and the root; the chain
// checks (./period_check) then look the root up in payroll_audit_log and each payment's
// transaction on the explorer: public reads of things already public.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { CircleCheck, CircleX, FileUp } from "lucide-react";
import { type PeriodProof, type ProofCheck, checkPeriodProof, readPeriodProof } from "@pnw/ledger";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { type ChainCheck, chainChecks } from "./period_check";
import { TxLink } from "./TxLink";
import { pickerAccept } from "@/books/save_file";

type Line = Pick<ProofCheck | ChainCheck, "ok" | "label" | "detail">;
type Result = {
  proof: PeriodProof;
  offline: Line[];
  chain: Line[] | null;
  chainError?: string;
  entries: number;
  payments: number;
};

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function Checks({ lines }: { lines: Line[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {lines.map((c) => (
        <li key={c.label} className="flex items-start gap-2 text-sm">
          {c.ok ? <CircleCheck aria-label="Passes" className="mt-0.5 size-4 shrink-0 text-money-positive" /> : <CircleX aria-label="Fails" className="mt-0.5 size-4 shrink-0 text-destructive" />}
          <span>
            {c.label}
            {c.detail && <span className="block text-xs text-muted-foreground">{c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function VerifyProof() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(file: File) {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const proof = readPeriodProof(await file.text());
      const offline = checkPeriodProof(proof);
      const base: Result = { proof, offline: offline.checks, chain: null, entries: offline.entries, payments: offline.payments };
      setResult(base);
      if (offline.root) {
        try {
          setResult({ ...base, chain: await chainChecks(proof, offline.root) });
        } catch (e) {
          setResult({ ...base, chainError: e instanceof Error ? e.message : "The network couldn't be read" });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file couldn't be read");
    } finally {
      setBusy(false);
    }
  }

  const passed = result && result.offline.every((c) => c.ok) && result.chain && result.chain.every((c) => c.ok);
  const failed = result && (result.offline.some((c) => !c.ok) || (result.chain && result.chain.some((c) => !c.ok)));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm hover:bg-muted/50">
            <FileUp aria-hidden className="size-4" />
            {busy ? "Checking…" : "Choose a proof file"}
            <input
              type="file"
              accept={pickerAccept("json")}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void check(f);
                e.target.value = "";
              }}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            The file is read on this device and never uploaded. To check the anchor, only the period&apos;s fingerprint and the payments&apos;
            transaction ids are looked up on Aleo&apos;s public explorer.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {result.proof.business || "A business"}: {day(result.proof.start)} to {day(result.proof.end)}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {result.entries} {result.entries === 1 ? "entry" : "entries"} and {result.payments} {result.payments === 1 ? "payment" : "payments"}. Made{" "}
              {day(result.proof.madeAt)}.
            </p>
            {passed && <p className="text-sm font-medium text-money-positive">Complete and unchanged since it was closed and anchored.</p>}
            {failed && <p className="text-sm font-medium text-destructive">This proof doesn&apos;t check out. What failed is marked below.</p>}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">The file</h3>
              <Checks lines={result.offline} />
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">On Aleo</h3>
              {result.chain ? (
                <Checks lines={result.chain} />
              ) : result.chainError ? (
                <p className="text-sm text-destructive">{result.chainError}. Try again in a moment.</p>
              ) : result.offline.every((c) => c.ok) ? (
                <p className="text-sm text-muted-foreground">Reading the network…</p>
              ) : (
                <p className="text-sm text-muted-foreground">Not checked: the file has to pass first.</p>
              )}
            </section>
            {result.proof.closes.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Closes of this range, newest first</h3>
                <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {result.proof.closes.map((c) => (
                    <li key={`${c.root}:${c.closedAt}`} className="flex flex-col">
                      <span>
                        {day(c.start)} to {day(c.end)}: closed {day(c.closedAt)}
                        {c.reopenedAt ? `, reopened ${day(c.reopenedAt)}` : ""}
                        {c.root === result.proof.root ? " (this proof)" : ""}
                      </span>
                      {c.anchorTx ? <TxLink id={c.anchorTx} /> : <span>Not anchored</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
