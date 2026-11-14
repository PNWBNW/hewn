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

/**
 * Whether a connect failed because this page cancelled it (`restart` in shield.ts tears the
 * pairing down on purpose): the adapter reports "Shield pairing was cancelled", and that is not
 * an error to show.
 */
export function isPairingCancelled(message: string): boolean {
  return /cancel/i.test(message);
}

/**
 * Shield refuses a call to a program it was not asked to allow when this site connected ("<id> is
 * not in the allowed programs, request it when connect"). The list it is asked for grows with the
 * app (`WALLET_PROGRAMS` in @pnw/wallet), and a connection made before a program joined the list
 * keeps the old one. The cure is the person's: connect again. This says so in their words, or
 * returns null for any other error.
 */
export function notAllowedProgramHint(message: string): string | null {
  if (!/not in the allowed programs/i.test(message)) return null;
  return "Shield was connected to this site before this part of it existed, so it hasn't been asked to allow it. In Shield, disconnect this site, then connect again here and try once more. Nothing was sent.";
}

/**
 * Whether a fresh connect may be asked for yet: only once the provider shows the old pairing
 * gone. Asking straight after the disconnect lets the provider fold "forget the wallet" and
 * "pick it again" into one update, so it never sees the change, keeps showing the closed pairing
 * as connected, and never connects (seen 2026-11-08 on Joshua's phone). The provider also skips
 * forgetting the wallet on a disconnect once the page has seen a beforeunload, which every
 * shield:// link fires, so `restart` selects no wallet itself; this then waits for that to land.
 */
export function mayReconnect(input: { pending: boolean; selected: boolean; connected: boolean; connecting: boolean; disconnecting: boolean }): boolean {
  return input.pending && !input.selected && !input.connected && !input.connecting && !input.disconnecting;
}
