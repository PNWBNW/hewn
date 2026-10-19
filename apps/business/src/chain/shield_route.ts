// How this page reaches Shield (three ways in, @pnw/wallet/wallet-provider).
// Pure: the hook in shield.ts feeds it the adapter's ready state and the device.

import { WalletReadyState } from "@pnw/wallet/wallet-provider";

/**
 * - `injected`: the extension, or Shield's own browser; always reachable.
 * - `relay`: a plain phone browser; the Shield app is opened by a link and answers over the relay.
 * - `none`: a computer without the extension. The relay is not an option there yet: Shield's app
 *   can't scan a pairing code, so the only way in is to install the extension.
 */
export type ShieldRoute = "injected" | "relay" | "none";

/** The adapter reports LOADABLE wherever the relay could pair; only a phone can act on the link. */
export function shieldRoute(readyState: WalletReadyState | undefined, phone: boolean): ShieldRoute {
  if (readyState === WalletReadyState.INSTALLED) return "injected";
  if (readyState === WalletReadyState.LOADABLE && phone) return "relay";
  return "none";
}

/** The same check the adapter makes before it fires the Shield link. */
export function isPhone(): boolean {
  return typeof navigator !== "undefined" && /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}
