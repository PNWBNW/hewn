"use client";

import { type ReactNode, useMemo } from "react";
import { AleoWalletProvider, useWallet } from "@provablehq/aleo-wallet-adapter-react";
import { WalletReadyState } from "@provablehq/aleo-wallet-standard";
import { Network } from "@provablehq/aleo-types";
import { DecryptPermission } from "@provablehq/aleo-wallet-adapter-core";
import {
  DEFAULT_SHIELD_DEEPLINK_BASE,
  DEFAULT_SHIELD_RELAY_URL,
  ShieldWalletAdapter,
  type ShieldWalletAdapterConfig,
} from "@provablehq/aleo-wallet-adapter-shield";
import { BRAND } from "@pnw/brand";
import { PROGRAMS } from "@pnw/config/programs";

// Re-exported so src/chain in the app needs no direct dependency on the adaptor packages.
export { useWallet, WalletReadyState, Network };

const { layer1, layer2, external } = PROGRAMS;

/**
 * Every live program the wallet is asked to authorize, from the manifest
 * mirror in @pnw/config (never a literal here, so a redeploy changes one file).
 *
 * Dependency order matters: imports must come before programs that import them.
 * Shield wallet loads programs in order; out-of-order imports cause silent failures.
 */
export const WALLET_PROGRAMS: string[] = [
  "credits.aleo",
  // Leaf programs (no imports from our set)
  external.usdcx_freezelist,
  layer1.employer_license_registry,
  layer1.pnw_name_registry,
  layer1.employer_profiles,
  layer1.worker_profiles,
  layer1.paystub_receipts,
  layer1.payroll_audit_log,
  // Letters on chain (no imports): Shield must know them to find and decrypt letters. v2 sends; v1 is read.
  PROGRAMS.letters.hewn_letters,
  PROGRAMS.letters.hewn_letters_v1,
  // Depends on freezelist
  external.usdcx,
  // Depends on name_registry + stablecoin: the job board (post, update, feature, close)
  PROGRAMS.jobs.hewn_jobs,
  // Depends on stablecoin + registry
  layer1.pnw_name_registrar,
  // Depends on license_registry + name_registry
  layer1.employer_agreement,
  // Depends on stablecoin + agreement + paystub_receipts + payroll_audit_log
  layer1.payroll_core,
  // Router and L2 anchors (payroll_nfts_v2 and credential_nft_v3 import employer_agreement_v4)
  layer1.pnw_router,
  layer2.payroll_nfts,
  layer2.credential_nft,
  layer2.audit_nft,
];

/**
 * Shield's relay, the one host its released app dials. Pinned here rather
 * than left to the adapter's default so the app's security policy and the
 * adapter can never disagree: `apps/business/src/security/headers.ts` names
 * this same origin in connect-src. A test checks it against the adapter.
 */
export const SHIELD_RELAY_ORIGIN = "wss://relay.shield.app";
/** The adapter's own default, re-exported for the test that pins the two together. */
export const SHIELD_RELAY_DEFAULT = DEFAULT_SHIELD_RELAY_URL;

/** Where to get the Shield app or extension. */
export const SHIELD_APP_URL = "https://www.shield.app/";

/**
 * A link that brings the Shield app to the front on a phone (`shield://wake`).
 * Shows an "Open Shield" button when the app is in the background and a read
 * is waiting on it; builds that predate the route ignore the link, so it is
 * safe on every version.
 */
export const SHIELD_OPEN_URL = `${new URL(DEFAULT_SHIELD_DEEPLINK_BASE).protocol}//wake`;

/**
 * Three ways in, one adapter (Joshua, 2026-10-19):
 *
 * 1. The browser extension on a computer: Shield is injected into the page
 *    and wins (`preferExtension`, the default).
 * 2. Shield's own browser on a phone: injected the same way; nothing changes.
 * 3. A plain phone browser, the new route: nothing is injected, so the adapter
 *    pairs with the Shield app over Shield's relay. `connect()` opens the app
 *    with a `shield://` link; every approval afterwards opens it again, and the
 *    answer comes back over the relay, sealed end to end (the relay forwards
 *    ciphertext between the page and the app; the pairing secret travels only
 *    in the link). Sessions last 12 hours, then one tap pairs again.
 *
 * Reads over the relay are answered only while the Shield app is open: it
 * leaves the relay whenever it is in the background. `src/chain/shield.ts`
 * watches for that and offers an "Open Shield" link.
 *
 * The approval screen in Shield shows the name and icon declared here beside
 * the page's origin (it has no page to read over the relay). Display only: the
 * origin stays primary.
 */
export function shieldAdapterConfig(): ShieldWalletAdapterConfig {
  return {
    appName: BRAND.name,
    appIconUrl: `${BRAND.appUrl}${BRAND.assets.icon512}`,
    remote: { relayUrl: SHIELD_RELAY_ORIGIN },
  };
}

/**
 * Aleo wallet provider — matches the official pattern from
 * aleo-dev-toolkit-react-app.vercel.app/wallet.
 *
 * Adapter: Shield only (decision 2026-10-13; other Aleo wallets dropped), so
 * there is no picker modal: the official react-ui package (and its stylesheet,
 * which pulls a Google font and so trips a strict CSP) is not used. On a phone
 * the adapter fires the Shield link itself, so no pairing screen is needed
 * either; a computer without the extension is told to install it
 * (`src/chain/shield.ts`), since Shield's app cannot scan a pairing code yet.
 */
export function AleoWalletProviderWrapper({
  children,
}: {
  children: ReactNode;
}) {
  const wallets = useMemo(() => [new ShieldWalletAdapter(shieldAdapterConfig())], []);

  return (
    <AleoWalletProvider
      wallets={wallets}
      autoConnect={true}
      network={Network.TESTNET}
      // On-chain history (the widest level): the books read the account's own past transfers to
      // fill the "For review" list. Shield refuses requestTransactionHistory at any lower level.
      // What is read stays in this browser (docs/THREAT_MODEL.md, T3).
      decryptPermission={DecryptPermission.OnChainHistory}
      programs={WALLET_PROGRAMS}
      onError={(error) => console.error("[Wallet]", error.message)}
    >
      {children}
    </AleoWalletProvider>
  );
}
