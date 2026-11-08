"use client";

// Drives the single Shield adapter: no picker modal, one button. Shared by
// every panel in src/chain; nothing outside it may import this file.
//
// Every transaction the app sends goes through the wallet this returns, so
// this is where the fee mode applies (@pnw/wallet/fee-mode): each call's fee
// is paid from public or private ALEO as the person chose for that send
// (`feeMode` on the call, from a choice next to its send button), or else as
// this device's switch says at the moment of sending.
//
// Three ways in (@pnw/wallet/wallet-provider): the extension on a computer and
// Shield's own browser on a phone both inject Shield into the page; a plain
// phone browser pairs with the Shield app over its relay instead. The route
// decides the wording and whether the app can be reached at all.

import { useEffect, useState } from "react";
import { type FeeMode, readFeeMode, withFeeMode } from "@pnw/wallet/fee-mode";
import { Network, WalletReadyState, shieldWakeUrl, useWallet } from "@pnw/wallet/wallet-provider";
import { errorMessage } from "@/books/AuthCard";
import { type ShieldRoute, isPairingCancelled, isPhone, mayReconnect, shieldRoute } from "./shield_route";

export type { ShieldRoute };

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
  const [reconnect, setReconnect] = useState(false); // restart: a fresh connect waits for the old pairing to go
  const [error, setError] = useState<string | null>(null);
  // Over the relay, the Shield app leaves whenever it is in the background and
  // answers reads only once it is open again. Injected Shield is always there.
  const [present, setPresent] = useState(true);

  const route = shieldRoute(shield?.readyState, isPhone());

  // Selecting is one render and connecting the next: the adaptor's connect()
  // reads the selected wallet from its own state. On the relay route that
  // connect also opens the Shield app, which the browser allows only shortly
  // after the tap that asked for it.
  useEffect(() => {
    if (!asked || !wallet.wallet || wallet.connected || wallet.connecting) return;
    setAsked(false);
    wallet.connect(Network.TESTNET).catch((e: unknown) => {
      const message = errorMessage(e);
      if (!isPairingCancelled(message)) setError(message);
    });
  }, [asked, wallet]);

  // Presence, relay only: the adapter says when the app comes and goes.
  useEffect(() => {
    const adapter = shield?.adapter;
    if (!adapter || route !== "relay" || !wallet.connected) return;
    const onPresence = (value: boolean) => setPresent(value);
    const onActive = () => setPresent(true);
    adapter.on("walletPresenceChanged", onPresence);
    adapter.on("walletActive", onActive);
    if ("isWalletPresent" in adapter && typeof adapter.isWalletPresent === "function") {
      void (adapter.isWalletPresent as () => Promise<boolean>)().then(setPresent, () => undefined);
    }
    return () => {
      adapter.off("walletPresenceChanged", onPresence);
      adapter.off("walletActive", onActive);
      setPresent(true);
    };
  }, [shield?.adapter, route, wallet.connected]);

  const connect = () => {
    if (!shield) return;
    setError(null);
    setAsked(true);
    wallet.selectWallet(shield.adapter.name);
  };

  /**
   * Forgets this browser's pairing and asks Shield afresh. Over the relay, a remembered pairing
   * whose channel is gone (Shield's side cancelled or dropped it) leaves a connect waiting up to
   * five minutes for an app that will never come, and without a tap the browser won't open it.
   * Tearing the pairing down ends that wait; the connect that follows runs from the tap.
   */
  const restart = async () => {
    if (!shield) return;
    setError(null);
    setReconnect(true);
    try {
      await adaptor.disconnect();
    } catch {
      // Nothing was connected: there is nothing to tear down.
    }
  };

  // The fresh connect is asked for only once the provider shows the old pairing gone; see
  // mayReconnect. The connect that follows still runs within the tap's few seconds.
  useEffect(() => {
    if (!shield) return;
    if (!mayReconnect({ pending: reconnect, selected: Boolean(wallet.wallet), connected: wallet.connected, connecting: wallet.connecting, disconnecting: wallet.disconnecting })) return;
    setReconnect(false);
    setAsked(true);
    wallet.selectWallet(shield.adapter.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on the provider's state, not on each new wallet object
  }, [reconnect, wallet.wallet, wallet.connected, wallet.connecting, wallet.disconnecting]);

  const state: ShieldState =
    wallet.connected && wallet.address
      ? { kind: "connected", address: wallet.address }
      : wallet.connecting || asked
        ? { kind: "connecting" }
        : route !== "none"
          ? { kind: "ready" }
          : { kind: "missing" };

  /** Connected over the relay, but the Shield app is in the background: reads wait until it opens. */
  const away = route === "relay" && state.kind === "connected" && !present;

  /** The link that brings Shield to the front for this site's pairing (with its relay channel). */
  const wakeUrl = () => shieldWakeUrl(shield?.adapter);

  return { state, route, away, connect, restart, wakeUrl, error, wallet };
}
