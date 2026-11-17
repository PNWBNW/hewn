"use client";

// Drives the single Shield adapter: no picker modal, one button. Shared by
// every panel in src/chain; nothing outside it may import this file.
//
// Every transaction the app sends goes through the wallet this returns, so
// this is where the programs' editions are checked before anything is signed
// (./editions.ts), and where the fee mode applies (@pnw/wallet/fee-mode): each call's fee
// is paid from public or private ALEO as the person chose for that send
// (`feeMode` on the call, from a choice next to its send button), or else as
// this device's switch says at the moment of sending.
//
// Four ways in (@pnw/wallet/wallet-provider): the extension on a computer and
// Shield's own browser on a phone both inject Shield into the page; a plain
// phone browser pairs with the Shield app over its relay instead, and so can a
// computer without the extension, by showing the pairing link as a QR code for
// the phone (`pair`, ShieldPairing.tsx). The route decides the wording and
// whether the app can be reached at all.

import { useEffect, useState } from "react";
import { type FeeMode, readFeeMode, withFeeMode } from "@pnw/wallet/fee-mode";
import { desktopPairingLink } from "@pnw/wallet/desktop-pairing";
import { Network, WalletReadyState, shieldWakeUrl, useWallet } from "@pnw/wallet/wallet-provider";
import { errorMessage } from "@/books/AuthCard";
import { checkEditions } from "./editions";
import { awaitingPhone } from "./phone_approval";
import { type ShieldRoute, isPairingCancelled, isPhone, mayReconnect, overRelay, rethrowSendError, shieldRoute } from "./shield_route";

export type { ShieldRoute };

export type ShieldState = { kind: "missing" } | { kind: "ready" } | { kind: "connecting" } | { kind: "connected"; address: string };

export function useShield() {
  const adaptor = useWallet();
  const shield = adaptor.wallets[0]; // Shield is the only adapter registered
  const route = shieldRoute(shield?.readyState, isPhone());
  // On a computer paired with the phone, nothing can bring Shield to the front: every approval
  // waits until the person opens it on the phone, and ShieldPairing says so while one is waiting.
  const onPhone = <T,>(work: () => Promise<T>) => (route === "pair" ? awaitingPhone(work) : work());
  const wallet = {
    ...adaptor,
    // No `fee` in what a caller may pass: the app never names an amount, so Shield charges its own estimate.
    executeTransaction: async (opts: Omit<Parameters<typeof adaptor.executeTransaction>[0], "fee"> & { feeMode?: FeeMode }) => {
      const { feeMode, ...call } = opts;
      // Before Shield is asked to sign anything: the upgradable programs are still the editions
      // this version of the app was made for (./editions.ts). It throws, and nothing is sent.
      await checkEditions();
      // A connection made before a program joined the list Shield is asked for: say what to do.
      return onPhone(() => adaptor.executeTransaction(withFeeMode(call, feeMode ?? readFeeMode()))).catch(rethrowSendError);
    },
    signMessage: (message: Parameters<typeof adaptor.signMessage>[0]) => onPhone(() => adaptor.signMessage(message)),
  };
  const [asked, setAsked] = useState(false);
  const [reconnect, setReconnect] = useState(false); // restart: a fresh connect waits for the old pairing to go
  const [error, setError] = useState<string | null>(null);
  // Over the relay, the Shield app leaves whenever it is in the background and
  // answers reads only once it is open again. Injected Shield is always there.
  const [present, setPresent] = useState(true);

  // Ask the network for the programs' editions as the page opens, so the check at the moment
  // of sending is already answered.

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
    if (!adapter || !overRelay(route) || !wallet.connected) return;
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
    // The provider forgets a disconnected wallet only from the adapter's disconnect event, and
    // skips that once the page has seen a beforeunload, which every shield:// link fires and which
    // it never resets: after the first trip to Shield, it kept the closed pairing as connected for
    // good (seen 2026-11-08). Selecting no wallet clears it whatever the page has seen.
    wallet.selectWallet(null);
  };

  /**
   * Ends a pairing that is waiting for the phone: the code stops working at once (the page leaves
   * the relay channel and forgets its keys), and nothing reconnects until the person asks.
   */
  const cancel = async () => {
    setAsked(false);
    setReconnect(false);
    try {
      await adaptor.disconnect();
    } catch {
      // Nothing was waiting.
    }
    wallet.selectWallet(null);
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
  const away = overRelay(route) && state.kind === "connected" && !present;

  /**
   * The link that brings Shield to the front for this site's pairing (with its relay channel). Empty
   * on a computer: a `shield://` link opens nothing there, so the person opens Shield on the phone.
   */
  const wakeUrl = () => (route === "pair" ? "" : shieldWakeUrl(shield?.adapter));

  /**
   * The pairing link to show as a QR code while a computer waits for the phone, or null. A secret
   * while it waits (docs/THREAT_MODEL.md T3): ShieldPairing draws it and nothing else may read it.
   */
  const pairing =
    route === "pair" && !wallet.connected && typeof location !== "undefined"
      ? desktopPairingLink(adaptor.pairingUrl, adaptor.pairingSameDevice, location.origin)
      : null;

  return { state, route, away, connect, restart, cancel, wakeUrl, pairing, error, wallet };
}
