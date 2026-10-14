"use client";

// Drives the single Shield adapter: no picker modal, one button. Shared by
// every panel in src/chain; nothing outside it may import this file.

import { useEffect, useState } from "react";
import { Network, WalletReadyState, useWallet } from "@pnw/wallet/wallet-provider";
import { errorMessage } from "@/books/AuthCard";

export type ShieldState = { kind: "missing" } | { kind: "ready" } | { kind: "connecting" } | { kind: "connected"; address: string };

export function useShield() {
  const wallet = useWallet();
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
