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
// Reading posts nothing. The one thing the card writes is the start, and only when tapped and
// confirmed: today's USDCx total becomes the opening balance of the books' Shield account
// (books/opening.ts). No address or record is logged.
//
// It also holds this device's fee switch (@pnw/wallet/fee-mode), next to the private ALEO that
// pays a private fee: while private fees are tested, they are chosen here.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { type FeeMode, readFeeMode, writeFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { Money, todayIso } from "@/books/display";
import { minorToCents, startFromShield } from "@/books/opening";
import { shortAddress } from "@/books/rail";
import { longDate } from "./agreement_draft";
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
import { ShieldAway } from "./ShieldStatus";

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
  const { state, away, connect, error: connectError, wallet } = useShield();
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

        <PrivateFees privateAleo={privateRead ? (priv?.aleo ?? null) : null} />

        {pubError && <p className="text-xs text-money-negative">Couldn&apos;t read the public balances: {pubError}</p>}
        {privError && <p className="text-xs text-money-negative">Couldn&apos;t read the private balances: {privError}</p>}
        {connectError && <p className="text-xs text-money-negative">{connectError}</p>}

        <StartBooks usdcx={privateRead ? totalOf(coins[1]!.balance) : null} />

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
        ) : away ? (
          <ShieldAway what="the private balances" />
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * This device's fee switch. On, every transaction's network fee comes from private ALEO, so the
 * network can't see which account sent it; it never falls back to a public fee on its own.
 */
function PrivateFees({ privateAleo }: { privateAleo: bigint | null }) {
  const [mode, setMode] = useState<FeeMode>(() => readFeeMode());
  const [error, setError] = useState<string | null>(null);
  const on = mode === "private";

  function choose(next: FeeMode) {
    setError(null);
    if (writeFeeMode(next)) setMode(next);
    else setError("This browser won't keep the setting; allow site data and try again.");
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={on} onChange={(e) => choose(e.target.checked ? "private" : "public")} />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">
            Pay network fees privately <span className="font-normal text-muted-foreground">(testing, this device)</span>
          </span>
          <span className="text-xs text-muted-foreground">
            Fees come from your private ALEO, so the network can&apos;t see which account sent a payment, an offer or anything else. Move some ALEO from Public to Private in Shield first.
          </span>
        </span>
      </label>
      {on && privateAleo === 0n && (
        <p className="text-xs text-money-negative">You have no private ALEO, so a fee can&apos;t be paid privately. Move some from Public in Shield, or turn this off.</p>
      )}
      <FormError message={error} />
    </div>
  );
}

/**
 * Starting the books from this account: before, a button (once the USDCx total is fully read) and a
 * confirm step; after, the date the books follow the account from.
 */
function StartBooks({ usdcx }: { usdcx: bigint | null }) {
  const { rail, updateCompany } = useOpenBooks();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!rail) return null;

  if (rail.start) {
    return (
      <p className="text-xs text-muted-foreground">
        Your books follow this account from {longDate(rail.start.date)}. Anything it holds from then on is in the books&apos; Shield account.
      </p>
    );
  }
  if (usdcx === null) {
    return <p className="text-xs text-muted-foreground">Once both balances are read, you can start your books from them.</p>;
  }

  const today = todayIso();
  const cents = minorToCents(usdcx);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await updateCompany((c) => startFromShield(c, { date: today, minor: usdcx!, at: new Date().toISOString() }));
      setConfirming(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <Button className="min-h-11 self-start sm:min-h-9" onClick={() => setConfirming(true)}>
        Start your books from this balance
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <p className="text-sm">
        Your books start on {longDate(today)} with <Money cents={cents} className="font-semibold" /> in the Shield account (private and public
        USDCx together). It goes in as the opening balance, so there is nothing to type and nothing to balance.
      </p>
      <p className="text-xs text-muted-foreground">
        Money that moves in or out of the account after today comes in for you to review. ALEO is fee money and isn&apos;t counted.
      </p>
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => void start()}>
          {busy ? "Starting…" : "Start my books"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const part = (label: string, minor: bigint | null) => (
  <span className={cn(minor === null && "opacity-70")}>
    {label} {minor === null ? "—" : formatSixDecimals(minor)}
  </span>
);
