// Pairing a computer without the Shield extension with the Shield app on a phone
// (packages/wallet/DESKTOP_PAIRING.md has the evidence and what is still unknown).
//
// On a computer the adapter does not open anything: its relay connect emits the pairing link
// (`connectUrl`, which the React provider keeps as `pairingUrl`, with `pairingSameDevice` false)
// and waits up to five minutes for the Shield app to join the relay channel and answer. On a
// computer that link is Shield's verified link (`SHIELD_VERIFIED_DEEPLINK_BASE`, adapter 1.6.0):
// `https://connect.shield.app/connect#…`, which a phone's camera hands only to the signed Shield
// app, with every parameter after the `#` so no server ever receives the secret. This module
// turns that link into the one the page shows as a QR code, and refuses anything that isn't a
// well-formed Shield pairing link of that form on Shield's relay, so the code on screen can only
// ever pair with this page through that relay.
//
// The link is a secret while it waits: it carries the pairing secret, and whoever opens it first
// pairs (docs/THREAT_MODEL.md T3). It is shown only on the pairing screen, never logged, stored or
// sent; nothing here prints it, and the errors name no part of it. The adapter's own copy of an
// unfinished pairing is forgotten when the app next opens (`forgetUnfinishedPairing`).

import { SHIELD_VERIFIED_DEEPLINK_BASE } from "@provablehq/aleo-wallet-adapter-shield";
import { DECLARED_ORIGIN, SHIELD_RELAY_ORIGIN } from "./wallet-provider";

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
 * The same, where the page declares an origin of its own choosing (the desktop app, DECLARED_ORIGIN):
 * the adapter keeps each declared origin's pairing under its own key (`relayStorage` in its
 * `remoteSession.ts`; a test pins it), so a pairing made for one origin is never resumed for another.
 */
export const DECLARED_SESSION_KEY = `${SHIELD_SESSION_KEY}:${DECLARED_ORIGIN}`;

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
  let forgot = false;
  for (const key of [SHIELD_SESSION_KEY, DECLARED_SESSION_KEY]) {
    try {
      const raw = storage.getItem(key);
      if (raw === null) continue;
      let paired = false;
      try {
        const session = JSON.parse(raw) as { walletPublicKey?: unknown } | null;
        paired = typeof session?.walletPublicKey === "string" && session.walletPublicKey !== "";
      } catch {
        // Unreadable: the adapter would ignore it too.
      }
      if (paired) continue;
      storage.removeItem(key);
      forgot = true;
    } catch {
      // storage blocked: nothing was kept to forget
    }
  }
  if (forgot) {
    try {
      storage.removeItem(SELECTED_WALLET_KEY);
    } catch {
      // as above
    }
  }
  return forgot;
}

/** The parameters a v1 Shield pairing link carries, in the adapter's order. `req` is dropped. */
const PARAMS = ["channelId", "pubkey", "relay", "origin", "secret", "v"] as const;

const SHAPES: Record<(typeof PARAMS)[number], RegExp> = {
  channelId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  pubkey: /^0[23][0-9a-f]{64}$/i, // compressed secp256k1
  relay: /^wss:\/\/relay\.shield\.app$/,
  // An https origin, no path: the website's own, or the one the desktop app declares (the
  // website's, DECLARED_ORIGIN). The adapter accepts no other for the desktop app, and Shield's
  // release build refuses plain http.
  origin: /^https:\/\/[^/?#\s]+$/i,
  secret: /^[0-9a-f]{64}$/i, // 32 bytes
  v: /^1$/,
};

/**
 * The link to show as a QR code, or null when there is nothing to show: no link, a same-device
 * pairing (a phone, where the adapter opens Shield itself), or anything but a well-formed Shield
 * verified pairing link (`https://connect.shield.app/connect`, the parameters after the `#`, none
 * in a query) on Shield's relay for `expectedOrigin` (when given).
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
  const base = new URL(SHIELD_VERIFIED_DEEPLINK_BASE);
  if (url.protocol !== base.protocol || url.host !== base.host || url.pathname !== base.pathname || url.search !== "" || url.username || url.password) return null;
  const params = new URLSearchParams(url.hash.slice(1));
  const keys = [...params.keys()];
  if (keys.some((k) => k !== "req" && !(PARAMS as readonly string[]).includes(k))) return null;
  if (new Set(keys).size !== keys.length) return null;
  const out = new URLSearchParams();
  for (const key of PARAMS) {
    const value = params.get(key);
    if (value === null || !SHAPES[key].test(value)) return null;
    out.set(key, value);
  }
  if (params.get("relay") !== SHIELD_RELAY_ORIGIN) return null;
  if (expectedOrigin !== undefined && params.get("origin") !== expectedOrigin) return null;
  const shown = new URL(SHIELD_VERIFIED_DEEPLINK_BASE);
  shown.hash = out.toString();
  return shown.toString();
}
