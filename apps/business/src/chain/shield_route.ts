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

/** How long after the tap the wake link fires: the request first, then the app (the adapter's own reasoning, with room for a read's first hashes). */
export const WAKE_DELAY_MS = 300;

/**
 * Brings the Shield app to the front over the relay. The adapter does this for
 * approvals only (`needsApproval` in its remote wallet); a read sent while the
 * app is in the background waits on the channel, and nothing happens on screen.
 * So a screen about to read while the app is away opens it itself. Call it from
 * the tap that asked, since the browser opens another app only on a person's
 * action; the link fires a moment later so the request is on the wire first. `url` is
 * `useShield().wakeUrl()`, which names this site's relay channel: without it Shield opens but
 * says the connection expired.
 */
export function openShield(url: string, deps: { navigate?: (url: string) => void; after?: (fn: () => void, ms: number) => void } = {}): void {
  const navigate = deps.navigate ?? ((to: string) => { window.location.href = to; });
  const after = deps.after ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms); });
  after(() => navigate(url), WAKE_DELAY_MS);
}

/**
 * Whether a connect failed because this page cancelled it (`restart` in shield.ts tears the
 * pairing down on purpose): the adapter reports "Shield pairing was cancelled", and that is not
 * an error to show.
 */
export function isPairingCancelled(message: string): boolean {
  return /cancel/i.test(message);
}
