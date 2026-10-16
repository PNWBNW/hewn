"use client";

// Drives the single Shield adapter: no picker modal, one button. Shared by
// every panel in src/chain; nothing outside it may import this file.
//
// Every transaction the app sends goes through the wallet this returns, so
// this is where the fee mode applies (@pnw/wallet/fee-mode): each call's fee
// is paid from public or private ALEO as the person chose for that send
// (`feeMode` on the call, from a choice next to its send button), or else as
// this device's switch says at the moment of sending.

import { useEffect, useState } from "react";
import { type FeeMode, readFeeMode, withFeeMode } from "@pnw/wallet/fee-mode";
import { Network, WalletReadyState, useWallet } from "@pnw/wallet/wallet-provider";
import { errorMessage } from "@/books/AuthCard";

export type ShieldState = { kind: "missing" } | { kind: "ready" } | { kind: "connecting" } | { kind: "connected"; address: string };

export function useShield() {
  const adaptor = useWallet();
  const wallet = {
    ...adaptor,
    executeTransaction: (opts: Parameters<typeof adaptor.executeTransaction>[0] & { feeMode?: FeeMode }) => {
      const { feeMode, ...call } = opts;
      return adaptor.executeTransaction(withFeeMode(call, feeMode ?? readFeeMode()));
    },
  };
  const shield = wallet.wallets[0]; // Shield is the only adapter registered
  const [asked, setAsked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detected = shield?.readyState === WalletReadyState.INSTALLED || shield?.readyState === WalletReadyState.LOADABLE;

  // Selecting is one render and connecting the next: the adaptor's connect()
  // reads the selected wallet from its own state.
  useEffect(() => {
    if (!asked || !wallet.wallet || wallet.connected || wallet.connecting) return;
    setAsked(false);
    wallet.connect(Network.TESTNET).catch((e: unknown) => setError(errorMessage(e)));
  }, [asked, wallet]);

  const connect = () => {
    if (!shield) return;
    setError(null);
    setAsked(true);
    wallet.selectWallet(shield.adapter.name);
  };

  const state: ShieldState =
    wallet.connected && wallet.address
      ? { kind: "connected", address: wallet.address }
      : wallet.connecting || asked
        ? { kind: "connecting" }
        : detected
          ? { kind: "ready" }
          : { kind: "missing" };

  return { state, connect, error, wallet };
}
