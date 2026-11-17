// Pairing a computer without the Shield extension with the Shield app on a phone
// (packages/wallet/DESKTOP_PAIRING.md has the evidence and what is still unknown).
//
// On a computer the adapter does not open anything: its relay connect emits the pairing link
// (`connectUrl`, which the React provider keeps as `pairingUrl`, with `pairingSameDevice` false)
// and waits up to five minutes for the Shield app to join the relay channel and answer. This
// module turns that link into the one the page shows as a QR code, for the phone's camera to
// open in Shield, and refuses anything that isn't a well-formed Shield pairing link on Shield's
// relay, so the code on screen can only ever pair with this page through that relay.
//
// The link is a secret while it waits: it carries the pairing secret, and whoever opens it first
// pairs (docs/THREAT_MODEL.md T3). It is shown only on the pairing screen, never logged, stored or
// sent; nothing here prints it, and the errors name no part of it. The adapter's own copy of an
// unfinished pairing is forgotten when the app next opens (`forgetUnfinishedPairing`).

import { DEFAULT_SHIELD_DEEPLINK_BASE } from "@provablehq/aleo-wallet-adapter-shield";
import { SHIELD_RELAY_ORIGIN } from "./wallet-provider";

/**
 * How long a pairing link waits for Shield before the connect gives up: the adapter's
 * `DEFAULT_PAIRING_TIMEOUT_MS` (its remote wallet, not exported; a test pins it to the installed
 * source). After that the link pairs with nothing: the page has left the channel and forgotten
 * its keys.
 */
export const PAIRING_WAIT_MS = 5 * 60 * 1000;

/**
 * Where the adapter's relay transport keeps this browser's pairing (`STORAGE_KEY` in its
 * `relay/transport.ts`; a test pins it to the installed source): the channel, the page's relay key
 * and the pairing secret, written as soon as a connect starts, before Shield has joined.
 */
export const SHIELD_SESSION_KEY = "shield:remote-session";

/**
 * Where the wallet provider remembers that Shield was chosen (`@provablehq/aleo-wallet-adapter-react`'s
 * default `localStorageKey`; a test pins it): while it is set, every panel connects as it mounts.
 */
export const SELECTED_WALLET_KEY = "walletName";

/**
 * Forgets a pairing an earlier page started and never finished, so a new visit never shows the old
 * code again. The adapter keeps the unfinished pairing when a page closes or reloads while it waits,
 * and the next connect resumes it with the same secret and a fresh five-minute wait: a code
 * photographed on the earlier visit would pair with the new one. A finished pairing (Shield's key
 * recorded) is kept, so a reload still finds Shield. The choice of Shield goes with an unfinished
 * pairing, so no panel starts a new one by itself: the person asks again with a tap. Returns
 * whether one was forgotten.
 *
 * For a computer only, once per page load, before any connect: on a phone the page is often
 * reloaded while Shield is open for the pairing, and must find it on return.
 */
export function forgetUnfinishedPairing(storage: Pick<Storage, "getItem" | "removeItem"> | undefined): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(SHIELD_SESSION_KEY);
    if (raw === null) return false;
    let paired = false;
    try {
      const session = JSON.parse(raw) as { walletPublicKey?: unknown } | null;
      paired = typeof session?.walletPublicKey === "string" && session.walletPublicKey !== "";
    } catch {
      // Unreadable: the adapter would ignore it too.
    }
    if (paired) return false;
    storage.removeItem(SHIELD_SESSION_KEY);
    storage.removeItem(SELECTED_WALLET_KEY);
    return true;
  } catch {
    return false; // storage blocked: nothing was kept to forget
  }
}

/** The parameters a v1 Shield pairing link carries, in the adapter's order. `req` is dropped. */
const PARAMS = ["channelId", "pubkey", "relay", "origin", "secret", "v"] as const;

const SHAPES: Record<(typeof PARAMS)[number], RegExp> = {
  channelId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  pubkey: /^0[23][0-9a-f]{64}$/i, // compressed secp256k1
  relay: /^wss:\/\/relay\.shield\.app$/,
  // An origin, no path: https for the website; the desktop app's own scheme for its bundle. Shield
  // decides which origins it will pair with (its release build refuses plain http).
  origin: /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]+$/i,
  secret: /^[0-9a-f]{64}$/i, // 32 bytes
  v: /^1$/,
};

/**
 * The link to show as a QR code, or null when there is nothing to show: no link, a same-device
 * pairing (a phone, where the adapter opens Shield itself), or anything but a well-formed Shield
 * pairing link on Shield's relay for `expectedOrigin` (when given).
 *
 * The adapter's link also carries the first request (`req`, the connect with every program the app
 * asks for), which the protocol bundles for a phone that can't send it after opening Shield. A
 * computer stays awake and sends that same request over the channel once Shield joins (the
 * protocol's cross-device path), so it is dropped here: the code shrinks from about 1,400
 * characters to about 300, which a phone camera reads at a glance.
 */
export function desktopPairingLink(pairingUrl: string | null | undefined, sameDevice: boolean, expectedOrigin?: string): string | null {
  if (!pairingUrl || sameDevice) return null;
  let url: URL;
  try {
    url = new URL(pairingUrl);
  } catch {
    return null;
  }
  const base = new URL(DEFAULT_SHIELD_DEEPLINK_BASE);
  if (url.protocol !== base.protocol || url.host !== base.host || (url.pathname !== "" && url.pathname !== "/") || url.hash !== "") return null;
  const keys = [...url.searchParams.keys()];
  if (keys.some((k) => k !== "req" && !(PARAMS as readonly string[]).includes(k))) return null;
  if (new Set(keys).size !== keys.length) return null;
  const out = new URL(DEFAULT_SHIELD_DEEPLINK_BASE);
  for (const key of PARAMS) {
    const value = url.searchParams.get(key);
    if (value === null || !SHAPES[key].test(value)) return null;
    out.searchParams.set(key, value);
  }
  if (url.searchParams.get("relay") !== SHIELD_RELAY_ORIGIN) return null;
  if (expectedOrigin !== undefined && url.searchParams.get("origin") !== expectedOrigin) return null;
  return out.toString();
}
