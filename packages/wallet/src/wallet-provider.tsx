"use client";

import { type ReactNode, useEffect, useMemo, useRef } from "react";
import {
  AleoWalletProvider,
  useWallet,
} from "@provablehq/aleo-wallet-adaptor-react";
import { WalletReadyState } from "@provablehq/aleo-wallet-standard";
import { Network } from "@provablehq/aleo-types";
import { DecryptPermission } from "@provablehq/aleo-wallet-adaptor-core";
import { ShieldWalletAdapter } from "@provablehq/aleo-wallet-adaptor-shield";
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
  // Letters on chain (no imports; deployed 2026-10-16): Shield must know it to find and decrypt letters.
  PROGRAMS.letters.hewn_letters,
  // Depends on freezelist
  external.usdcx,
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
 * Mobile wallet connection works via the wallet's in-app browser:
 * the dApp opens inside the wallet app's webview, where window.shield
 * gets injected and the adapter detects INSTALLED.
 *
 * When a LOADABLE wallet fails to connect from a regular mobile browser,
 * this component redirects to the wallet's in-app browser URL, loading
 * our dApp inside the wallet so the normal connect flow can proceed.
 */
function WalletMobileRedirectHandler() {
  const { wallet, connected } = useWallet();
  const lastWalletRef = useRef<{
    name: string;
    url: string | undefined;
    readyState: WalletReadyState;
  } | null>(null);

  useEffect(() => {
    if (wallet && wallet.readyState === WalletReadyState.LOADABLE) {
      lastWalletRef.current = {
        name: wallet.adapter.name,
        url: wallet.adapter.url,
        readyState: wallet.readyState,
      };
    }

    // Wallet was deselected after a LOADABLE selection → connect failed
    if (!wallet && !connected && lastWalletRef.current) {
      const { name, url } = lastWalletRef.current;
      lastWalletRef.current = null;

      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (!isMobile) return;

      // Build the in-app browser URL so our dApp loads inside the wallet
      const dAppUrl = encodeURIComponent(window.location.href);
      const redirectUrl = getMobileWalletUrl(name, dAppUrl, url);
      if (redirectUrl) {
        window.location.href = redirectUrl;
      }
    }

    if (connected) {
      lastWalletRef.current = null;
    }
  }, [wallet, connected]);

  return null;
}

/**
 * Returns the in-app browser URL for a given wallet on mobile.
 * Each wallet app has its own URL scheme to load a dApp in its webview.
 */
function getMobileWalletUrl(
  walletName: string,
  encodedDAppUrl: string,
  fallbackUrl: string | undefined,
): string | undefined {
  const name = walletName.toLowerCase();

  if (name.includes("shield")) {
    // Shield: use Android intent to open the app directly.
    // If the Shield app is installed, this deep-links into it.
    // The user can then navigate to the dApp URL in Shield's browser.
    // Fallback: open Shield website to download
    return fallbackUrl || "https://www.shield.app/";
  }

  return fallbackUrl;
}

/**
 * Aleo wallet provider — matches the official pattern from
 * aleo-dev-toolkit-react-app.vercel.app/wallet.
 *
 * Adapter: Shield only (decision 2026-10-13; other Aleo wallets dropped), so
 * there is no picker modal: the official react-ui package (and its stylesheet,
 * which pulls a Google font and so trips a strict CSP) is not used.
 */
export function AleoWalletProviderWrapper({
  children,
}: {
  children: ReactNode;
}) {
  const wallets = useMemo(() => [new ShieldWalletAdapter()], []);

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
      <WalletMobileRedirectHandler />
      {children}
    </AleoWalletProvider>
  );
}
