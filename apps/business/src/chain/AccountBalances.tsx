"use client";

// ---------------------------------------------------------------------------
// The dashboard's balances card: ALEO and USDCx held by the account linked to
// these books, read on their own instead of typed in (balances.ts).
//
// The public part needs no Shield: it is read from the explorer as soon as
// the dashboard opens. The private part is the account's own records, which
// only Shield can read, so it shows once Shield is connected to the linked
// account (Shield reconnects on its own after the first time).
//
// Display only: nothing is posted to the books. No address or record is logged.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { errorMessage } from "@/books/AuthCard";
import { shortAddress } from "@/books/rail";
import {
  type CoinBalance,
  CREDITS_PROGRAM,
  USDCX_PROGRAM,
  explorerMappingRead,
  formatSixDecimals,
  privateCredits,
  privateTokens,
  publicCredits,
  publicTokens,
  totalOf,
} from "./balances";
import { useShield } from "./shield";

export type AccountBalancesProps = { address: string };

export default function AccountBalances(props: AccountBalancesProps) {
  return (
    <AleoWalletProviderWrapper>
      <BalancesCard {...props} />
    </AleoWalletProviderWrapper>
  );
}

type Public = { aleo: bigint; usdcx: bigint };
type Private = { aleo: bigint; usdcx: bigint };

function BalancesCard({ address }: AccountBalancesProps) {
  const { state, connect, error: connectError, wallet } = useShield();
  const [pub, setPub] = useState<Public | null>(null);
  const [priv, setPriv] = useState<Private | null>(null);
  const [pubError, setPubError] = useState<string | null>(null);
  const [privError, setPrivError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  const connected = state.kind === "connected" ? state.address : null;
  const mismatch = connected !== null && connected !== address;

  // Public balances: the explorer, for the linked account, whatever Shield is doing.
  useEffect(() => {
    let live = true;
    const read = explorerMappingRead();
    setPubError(null);
    Promise.all([publicCredits(address, read), publicTokens(address, read)]).then(
      ([aleo, usdcx]) => live && setPub({ aleo, usdcx }),
      (e: unknown) => live && setPubError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [address, round]);

  // Private balances: the linked account's own records, through Shield.
  useEffect(() => {
    if (!connected || mismatch) return;
    let live = true;
    setPrivError(null);
    Promise.all([wallet.requestRecords(CREDITS_PROGRAM, true), wallet.requestRecords(USDCX_PROGRAM, true)]).then(
      ([credits, tokens]) => live && setPriv({ aleo: privateCredits(credits ?? []), usdcx: privateTokens(tokens ?? []) }),
      (e: unknown) => live && setPrivError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
    // `wallet` changes identity on every render; the account and the round are what matter.
  }, [connected, mismatch, round]);

  const refresh = useCallback(() => setRound((r) => r + 1), []);

  const privateRead = connected !== null && !mismatch;
  const coins: { label: string; unit: string; balance: CoinBalance; money: boolean }[] = [
    { label: "ALEO", unit: "ALEO", balance: { private: privateRead ? (priv?.aleo ?? null) : null, public: pub?.aleo ?? null }, money: false },
    { label: "USDCx", unit: "USDCx", balance: { private: privateRead ? (priv?.usdcx ?? null) : null, public: pub?.usdcx ?? null }, money: true },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">Shield account</CardTitle>
          <p className="truncate text-xs text-muted-foreground">{shortAddress(address)} · read from the network, not the books</p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 sm:size-9" onClick={refresh} aria-label="Refresh balances">
          <RefreshCw aria-hidden className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {coins.map((c) => {
            const total = totalOf(c.balance);
            const shown = total ?? c.balance.public;
            return (
              <div key={c.label} className="rounded-md border p-3">
                <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{c.label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {shown === null ? <span className="text-muted-foreground">…</span> : `${c.money ? "$" : ""}${formatSixDecimals(shown)}`}
                  {!c.money && shown !== null && <span className="ml-1 text-sm font-normal text-muted-foreground">{c.unit}</span>}
                </dd>
                <dd className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {part("Private", c.balance.private)} · {part("Public", c.balance.public)}
                </dd>
              </div>
            );
          })}
        </dl>

        {pubError && <p className="text-xs text-money-negative">Couldn&apos;t read the public balances: {pubError}</p>}
        {privError && <p className="text-xs text-money-negative">Couldn&apos;t read the private balances: {privError}</p>}
        {connectError && <p className="text-xs text-money-negative">{connectError}</p>}

        {mismatch ? (
          <p className="text-xs text-muted-foreground">
            Shield is signed in to a different account ({shortAddress(connected)}). Switch to {shortAddress(address)} in Shield to see the private balances.
          </p>
        ) : state.kind === "missing" ? (
          <p className="text-xs text-muted-foreground">Open this page in the Shield app, or install the Shield extension, to see the private balances.</p>
        ) : state.kind === "connecting" ? (
          <p className="text-xs text-muted-foreground">Connecting… approve the request in Shield.</p>
        ) : state.kind === "ready" ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button className="min-h-11 sm:min-h-9" onClick={connect}>
              Connect Shield
            </Button>
            <span className="text-xs text-muted-foreground">to see the private balances</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const part = (label: string, minor: bigint | null) => (
  <span className={cn(minor === null && "opacity-70")}>
    {label} {minor === null ? "—" : formatSixDecimals(minor)}
  </span>
);
