# Pairing a computer with Shield on a phone

What we found on 2026-11-17 about reaching Shield from a computer without the extension (the
desktop app's blocker, `docs/HOSTING.md` step 3), what this package and the app now do about it,
what is still unknown, and what to ask Provable. Line numbers are in the installed
`@provablehq/aleo-wallet-adapter-shield` 1.5.0 (`src/`, the newest on npm, published 2026-10-27)
unless another file is named.

## Short answer

The adapter and the relay protocol were built for this: a computer shows the pairing link as a QR
code, the phone pairs over the relay, and every later request goes over the sealed channel. What is
missing is on the phone: **Shield's app has no scanner for the pairing link, and the link is a
`shield://` custom-scheme link, not a universal link**, so it depends on the phone's own camera
offering to open Shield. Provable says so in the adapter's README. iPhones' camera is reported to
open custom-scheme links for an installed app; Android's cameras vary. So the path is **feasible
but not reliable on every phone**, and it is built behind detection with the extension kept on
offer, waiting on a test on real phones and on Provable.

## How pairing works (the evidence)

- **The link.** `relay/transport.ts:151-208` `connect()`: a fresh channel id
  (`crypto.randomUUID()`, :170), an ephemeral secp256k1 key pair for the page (:171) and a 32-byte
  pairing secret (:172; `relay/protocol.ts:319-328`). `buildConnectUrl` (`protocol.ts:558-576`)
  puts `channelId`, `pubkey` (the page's public key), `relay`, `origin`, `secret` and `v=1` in the
  query string of `shield://connect` (`remoteDefaults.ts:16`). On a fresh pairing it also bundles
  the first request, the `connect` with every program asked for, as `req` (transport :195-205;
  `protocol.ts:549-556` allows that only for `connect` and only on a custom scheme). For Hewn's 25
  programs the link is about 1,400 characters with `req`, about 290 without (a version 13 QR code at level M).
- **The secret.** Travels only in the link, never over the relay. The Shield app joins the relay
  channel and publishes its own ephemeral key with an HMAC-SHA256, keyed by the secret, over
  version, channel, origin and both public keys (`protocol.ts:349-362`). The page drops a handshake
  whose MAC fails and pins the first one that passes for the pairing's life
  (`transport.ts:433-459`, key pinning at :444-452). Everything after is ECIES-sealed to the
  peer's key, signed by the sender and sequence-numbered (`protocol.ts:268-317`).
- **Same device or not.** The adapter decides by user agent (`isMobileUserAgent.ts`: android,
  iphone, ipad, ipod). On a computer it does not navigate: it hands the link to the page
  (`remote.ts:144`, `onConnectUrl` with `sameDevice: false`) and stamps `dapp.sameDevice: false`
  into the connect (`remote.ts:103-108`). Through `ShieldWalletAdapter` the link becomes the
  `connectUrl` event (`ShieldWalletAdapter.ts:333-355`), which the React provider keeps as
  `pairingUrl` / `pairingSameDevice` (`@provablehq/aleo-wallet-adapter-react` 1.5.0,
  `dist/index.mjs:105-106, 151-156`). Without a listener a desktop connect is refused rather than
  left hanging (:343-352).
- **The bundled request on a computer.** The protocol says the bundle is "deliberately absent on
  the cross-device QR path" (`protocol.ts:516-518`) and that the QR is "the binding constraint"
  (:156-160), but the transport bundles it whenever the pairing is fresh. It also publishes the same
  request over the channel as soon as the app's handshake lands (`transport.ts:457`, idempotent:
  the app drops a second copy as a replay). So the page can show the link without `req`; that is
  what `desktopPairingLink` does.
- **Waiting.** A connect waits five minutes for the app (`remote.ts:42`), each request five
  minutes for an answer (`transport.ts:76`). The app forgets a session 12 hours after pairing
  (`remoteSession.ts:118`).
- **Approvals.** `needsApproval` (`remoteSession.ts:229-251`) names the requests Shield shows an
  approval for. On a phone the adapter opens `shield://wake?channelId=…` for each
  (`remote.ts:285-298`, `remoteSession.ts:212-221`); on a computer it opens nothing ("Same-device
  only: on the QR path the wallet is on another phone", :285). The request waits on the channel
  until Shield is opened; this package's README records reads waiting and then being answered when
  Shield was opened by hand on a phone (2026-11-08).
- **What the app can supply.** `remote.onConnectUrl` (always called) and `fireDeeplink: false`
  (`types.ts:130-144`) let a page present the link itself; `remote.transport` replaces the
  transport (tests). There is no hook for the wake: it is `window.location.href`, phone only.
  `deeplinkBase` must be a custom scheme: an `http(s)` base throws, because the secret is in the
  query string and a phone without the app would send it to the fallback web server
  (`remoteDefaults.ts:58-86`).
- **What Shield documents.** The adapter's README, "Remote (relay) fallback": "**Desktop QR
  scanning is not wired up yet.** The connect URL uses the `shield://` custom scheme (the app
  declares no universal links), and the app's QR scanner currently only reads addresses. A phone
  camera therefore cannot reliably act on a scanned pairing code." (`README.md:70-74`).
  `remoteDefaults.ts:12-16`: "Universal links are not configured on the app yet, so
  `https://app.shield.app/connect` will not open it." `protocol.ts:434-451` plans the https form
  with every parameter in the fragment (ProvableHQ/shield-relay#12). Provable's QR screen is
  `WalletPairingQR` in `@provablehq/aleo-wallet-adapter-react-ui` 1.3.3 (it depends on
  `qrcode.react`); we don't use that package (its stylesheet breaks the strict policy). Shield's
  public changelog (aleo.org/shield/changelog, newest 1.19.1) mentions no pairing code or scanner.
- **What phones document.** Neither Apple nor Google documents what the camera does with a QR
  code holding a custom-scheme link. Developer reports: the iPhone camera shows a banner and opens
  the app registered for the scheme when tapped; on Android it depends on the camera app (Google
  Lens, Samsung's camera), with reports of it working on one phone and not another. Unverified by
  us on a device.

## What is built (behind detection)

- `src/qr.ts`: a small QR encoder (byte mode, versions 1 to 40, all four levels), so the page runs
  no new third-party code. Its test decodes every version and level with an independent reader
  (jsQR, a dev dependency only).
- `src/desktop_pairing.ts`: `desktopPairingLink` turns the adapter's link into the one shown,
  without `req`, and refuses anything but a well-formed Shield pairing link on Shield's relay for
  this page's origin. Its test runs the adapter's own transport against a simulated Shield app:
  pairing through the shown link, the connect going over the sealed channel, a second handshake
  (a photo of the code) refused after Shield pairs, and the race before it.
- In the app (`apps/business/src/chain`): the `pair` route (a computer, no extension, the adapter
  able to pair), `ShieldPairing.tsx` (the code after a tap, the steps, the warning, Cancel, and
  "Open Shield on your phone to approve" while an approval waits), mounted by every chain panel's
  provider (`ShieldProvider.tsx`).
- `docs/THREAT_MODEL.md` T3: what someone who photographs the code could do, and for how long.

## Not verified

- That Shield's release app pairs from a link opened by a phone's camera, with `sameDevice: false`
  and no `req` (the protocol's cross-device path; never run on a device by us).
- That the iPhone camera and Android cameras (Lens, Samsung) offer to open `shield://` links.
- That Shield, opened by hand, shows an approval that has waited on the channel for minutes, and
  how long the relay keeps channel history.
- That Shield's release build accepts the desktop app's origin (Tauri serves `tauri://localhost`
  on macOS and Linux and `http://tauri.localhost` on Windows unless set to https; the adapter's
  README says a release build refuses an `http://` origin).

## The ask for Provable

1. **Let Shield's scanner read a pairing link.** The app's scanner reads addresses only; reading a
   `shield://connect?…` code would make this work on every phone, whatever its camera does.
2. **Universal links and App Links** for the https form with the parameters in the fragment
   (shield-relay#12), so a phone's camera opens Shield, and lift the custom-scheme check in the
   adapter once the app parses the fragment.
3. **Confirm the cross-device path in the release app:** a link without `req`, `sameDevice:
   false`, the connect sent over the channel after the handshake.
4. **A way to reach the phone for approvals from a computer:** a notification when a request
   waits on a cross-device pairing, or confirmation that opening Shield by hand always shows it,
   and for how long the relay keeps a waiting request.
5. **A short check both screens show after the handshake** (a few words or digits derived from
   both keys), so a person can see that the Shield that paired is theirs; it closes the window a
   photographed code leaves open.
6. **Which page origins the release build pairs with**, so an installed desktop app's origin is
   accepted (above).
