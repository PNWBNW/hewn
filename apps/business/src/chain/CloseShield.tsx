"use client";

// ---------------------------------------------------------------------------
// The chain side of closing the books (docs/CLOSE_PERIOD.md): the Shield
// check (the books' Shield account against the linked account's USDCx, as on
// the Dashboard) and the anchor, `payroll_audit_log::anchor_event(root)`,
// signed in Shield. The books close first, then the root is anchored; if the
// anchor fails the books stay closed and `AnchorWithShield` offers it again.
// Nothing here logs an account, an amount or a root.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { CircleCheck, Circle } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import type { AnchorActionProps, CloseActionProps } from "@/books/ClosePanel";
import { reconcileShield } from "@/books/reconcile";
import { USDCX_PROGRAM, explorerMappingRead, privateTokens, publicTokens } from "./balances";
import { anchorCall } from "./close_anchor";
import { useShield } from "./shield";
import { executeAndWait } from "./work/execute";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function CloseWithShield(props: CloseActionProps) {
  return (
    <AleoWalletProviderWrapper>
      <Close {...props} />
    </AleoWalletProviderWrapper>
  );
}

export function AnchorWithShield(props: AnchorActionProps) {
  return (
    <AleoWalletProviderWrapper>
      <Anchor {...props} />
    </AleoWalletProviderWrapper>
  );
}

/** The linked account's USDCx, public and private, in six-decimal minor units; null until both are read. */
function useShieldTotal(address: string | null) {
  const { state, connect, wallet } = useShield();
  const connected = state.kind === "connected" ? state.address : null;
  const mismatch = connected !== null && address !== null && connected !== address;
  const [total, setTotal] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!address || !connected || mismatch) return;
    let live = true;
    setTotal(null);
    setError(null);
    Promise.all([publicTokens(address, explorerMappingRead()), wallet.requestRecords(USDCX_PROGRAM, true)]).then(
      ([pub, records]) => live && setTotal(pub + privateTokens(records ?? [])),
      (e: unknown) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
    // `wallet` changes identity on every render; the account and the round are what matter.
  }, [address, connected, mismatch, round]);
  const refresh = useCallback(() => setRound((r) => r + 1), []);
  return { state, connect, wallet, connected, mismatch, total, error, refresh };
}

function Close({ end, ready, close, anchored }: CloseActionProps) {
  const company = useOpenBooks();
  const address = company.rail?.address ?? null;
  const { state, connect, wallet, connected, mismatch, total, error: readError, refresh } = useShieldTotal(address);
  const [busy, setBusy] = useState<null | "closing" | "anchoring">(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const check = total === null ? null : reconcileShield({ ...company, review: company.review ?? undefined, funds: company.funds ?? undefined, rail: company.rail ?? undefined }, total);
  const matches = check?.kind === "matches";

  async function run() {
    setError(null);
    setDone(null);
    if (!window.confirm("Close the books through this date and anchor its fingerprint? Shield asks you to approve one transaction.")) return;
    setBusy("closing");
    let closed: { end: string; root: string };
    try {
      closed = await close();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
      return;
    }
    setBusy("anchoring");
    try {
      const r = await executeAndWait(wallet, anchorCall(closed.root));
      await anchored(closed.end, r.transactionId);
      setDone("Closed and anchored.");
    } catch (e) {
      setError(`The books are closed, but the fingerprint isn't anchored yet: ${errorMessage(e)} Anchor it from the list of closes.`);
    } finally {
      setBusy(null);
    }
  }

  let line: React.ReactNode;
  if (!connected) {
    line = (
      <Button variant="outline" className="min-h-11 self-start sm:min-h-9" disabled={state.kind === "connecting"} onClick={connect}>
        {state.kind === "connecting" ? "Connecting…" : "Connect Shield to check"}
      </Button>
    );
  } else if (mismatch) {
    line = <span className="text-xs text-muted-foreground">Shield is on another account. Switch to the one these books are linked to.</span>;
  } else if (readError) {
    line = (
      <span className="text-xs text-muted-foreground">
        Couldn&apos;t read the Shield account: {readError}{" "}
        <button type="button" className="underline underline-offset-2" onClick={refresh}>
          Try again
        </button>
      </span>
    );
  } else if (!check) {
    line = <span className="text-xs text-muted-foreground">Reading the Shield account…</span>;
  } else if (!matches) {
    line = <span className="text-xs text-muted-foreground">The books don&apos;t match Shield yet. The Dashboard shows the difference.</span>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2 text-sm">
        {matches ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-money-positive" /> : <Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <span>
          The Shield check says Matches
          {line && <span className="block">{line}</span>}
        </span>
      </div>
      <Button className="min-h-11 self-start sm:min-h-9" disabled={!ready || !matches || busy !== null} onClick={() => void run()}>
        {busy === "closing" ? "Closing…" : busy === "anchoring" ? "Approve in Shield…" : `Close through ${day(end)} and anchor`}
      </Button>
      {done && <p className="text-sm text-money-positive">{done}</p>}
      <FormError message={error} />
    </div>
  );
}

function Anchor({ record, anchored }: AnchorActionProps) {
  const { state, connect, wallet } = useShield();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (state.kind !== "connected") {
    return (
      <Button variant="outline" size="sm" className="min-h-11 self-start sm:min-h-8" disabled={state.kind === "connecting"} onClick={connect}>
        Connect Shield to anchor
      </Button>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 self-start sm:min-h-8"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await executeAndWait(wallet, anchorCall(record.root));
            await anchored(record.end, r.transactionId);
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Approve in Shield…" : "Anchor now"}
      </Button>
      <FormError message={error} />
    </span>
  );
}
