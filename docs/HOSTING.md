---
status: plan
updated: 2026-11-25
summary: Who can change the code a person runs, and the plan to make that checkable: a guard against framing (live), signed and anchored releases (built; the first release waits on Joshua's key), an installable signed desktop app (the priority; built, and Shield's adapter 1.6.0 gives it a way in by pairing with a phone), the website on GitHub Pages with a service worker that checks updates (built, the move waits on decisions), and later a hardened native client on GPUI with snarkVM, whose first piece, a native verifier, is built.
---

# Hosting and verifiable releases

Joshua, 2026-11-17: make the code people run checkable, and make an installable, signed desktop
app the priority. Each step is its own pull request with its own exit criterion, and the steps
that change where or how the app is delivered wait for Joshua's go-ahead.

## Where it stands (2026-11-25)

| Step | Built | What's left for its exit criterion |
| --- | --- | --- |
| 1. The top-page guard | Live since #370 (`apps/business/src/security/frame_guard.test.ts`) | Nothing: met |
| 2. Signed, anchored releases | The tools and the twice-built CI check, #371 (`scripts/release/README.md`) | Joshua makes the release key offline, signs the first release and anchors it on testnet; then the check from a clean machine |
| 3. The desktop app | The Tauri shell, its locked-down window and its signed updater, #372 (`apps/desktop/README.md`); the pairing screen with a QR code, draft #373 | Shield's adapter 1.6.0 (published 2026-11-20) can pair through a code a phone's camera opens (below); #373 moves to it once it is seven days old (2026-11-27, OPS-04), then the test on real phones and computers, then signed installers |
| 4. The website on GitHub Pages | The update worker, #374 (`apps/business/src/updates/README.md`); the Pages build and the counter's own address, draft #375 | Joshua's decisions: GitHub Pages' terms, the DNS change, the counter's address |
| Later: the hardened native client | Its first piece, the native verifier (`apps/native/README.md`), built for Windows in CI | Joshua's run on a real Windows machine and his review of `apps/native/gpui_patches.toml`; screens wait on a native way to reach Shield |


## Why

While someone's books are unlocked, the code in the page can read them. No server holds anyone's
data (INV-02), so a breached host can't leak stored books, but it could serve code that reads them
on the device. Every payment still needs the person's own approval in Shield, which shows what is
signed (INV-11). Today these can change the code a person runs:

| Who | How | Today's guard |
| --- | --- | --- |
| Whoever controls GitHub `main` | A merged change | Joshua's approval on GitHub, a passkey (T3) |
| Vercel, or anyone in the Vercel project | Builds and serves every file; can deploy without GitHub | The Vercel login |
| A hijacked npm package | Built into the app | Exact pins, the lockfile, 7-day release age, the audit (T3) |
| Whoever controls the domain's DNS | Points it at another server with a valid certificate | HSTS for returning visitors only |
| The person's own device | Browser extensions, malware | Nothing a page can do |
| Our own bugs | Input that runs as code | The security policy (T3) |

The security policy already stops code from being added to a running page (T3: no outside script
hosts, nothing from someone else's dashboard). What it can't stop is a host or a domain serving
different files. The fix is to make the files checkable, so that whoever serves them can't change
them unnoticed.

## What a browser can and can't do

- **A page can refuse to be framed** without any header: it stays hidden unless it is the top page
  (step 1). This holds against every framing trick.
- **A page can't prove its own first load.** The first visit trusts whoever served it.
- **A service worker can check later updates of the app's files** against a signature, but **the
  browser updates the service worker itself** from the host, at least once a day, without asking
  it. A hijacked host can replace the worker. The worker can notice a new worker installing and
  warn loudly, and a bad worker is replaced within about a day of the host being fixed, but it
  can't block one. Code pinning in a plain website turns a silent compromise into a noticed one; it
  does not make the host trustless.
- **Only an installed app** (or a browser's own signed-app feature, or a checking browser
  extension) closes that gap: the app on the device checks every update against a key only Joshua
  holds. Hence the desktop app.

## The plan

### Step 1: the top-page guard (any host)

The stylesheet hides the page (`html { display: none }`), and the app's own script shows it only
when `window.top === window.self`. A framed copy stays blank: a sandboxed frame without scripts
never shows it, a frame with scripts sees it is framed and stays hidden. The rule lives in the
stylesheet file and the check in a script file, so the strict policy doesn't change. Storage
partitioning already means a framed copy opens empty (no books, no session), and payments are
approved in Shield's own window, which no page can cover; the guard closes the rest.

- Exit: a test loads the built page inside a frame (with and without `sandbox`) and finds it
  hidden, and finds it shown as the top page. Works on Vercel today and anywhere later.

### Step 2: signed, anchored releases

The static bundle (`pnpm --filter @pnw/business build:static`) is already the whole app as plain
files. A release is that bundle, built from a tagged commit:

1. **Reproducible build.** Two clean builds of the same commit give the same bytes (pinned Node and
   pnpm, the lockfile, no build time or path in the output). CI builds it and publishes the file
   list with each file's SHA-256 and one digest over the list.
2. **Joshua signs the digest** with the release key, on his own machine. The key never goes into
   GitHub, CI, Vercel or a chat (INV-06). An Ed25519 key, kept offline or on a hardware key, with a
   second key stored apart for recovery, both public keys published in the repository.
3. **Anchored on Aleo** through the deployed `payroll_audit_log::anchor_event`, which takes a
   32-byte hash and records the block height (`audit_event_height`). No new Leo program. The
   signature says who released it; the anchor says when, publicly, so a release can't be quietly
   replaced afterwards.
4. **Anyone can check it**: a short page and a script that compare the files they were served with
   the published list, the signature and the anchor.

- Exit: one release built twice with the same digest, signed, anchored on testnet, and checked by
  the script from a clean machine.

### Step 3: the installable desktop app (the priority)

The desktop app carries a signed release from step 2 and runs it on the device. Its updates are
accepted only when they carry Joshua's signature, so no host, domain or DNS can change the code it
runs.

**Reaching Shield from a desktop app: answered by Shield 1.6.0 (2026-11-20).** Provable published
`@provablehq/aleo-wallet-adapter-shield` 1.6.0 with what this step needed (Provable, 2026-11-23):

- **A pairing link a phone's camera opens.** `SHIELD_VERIFIED_DEEPLINK_BASE`
  (`https://connect.shield.app/connect`) is a verified link the phone hands only to the signed Shield
  app. Every connect parameter, the pairing secret included, travels in the fragment after `#`,
  which a browser never sends to any server, so Shield's link host never sees it. The desktop app
  shows the adapter's `connectUrl` as a QR code; the person scans it, confirms in Shield Mobile, and
  opens Shield on the phone to approve each later request. Signing keys stay in Shield. An older
  Shield Mobile that doesn't claim the verified link opens a web page instead of the app, so the
  pairing screen asks for an up-to-date Shield.
- **An origin for an app with no web address.** The desktop app's pages run at `tauri://localhost`
  (or `https://tauri.localhost` on Windows); `remote.origin` declares an HTTPS origin we control
  instead, the website's (`https://www.hewnaccounting.com`), with `appName` "Hewn". Shield Mobile
  shows both. They are self-reported over the relay; Provable wants to explore how Shield could
  verify the requesting app (below, "Verifying the app to Shield").

What the problem was, for the record: a desktop app runs its own copy of a browser
engine, and the Shield extension doesn't run inside it. The relay path is for a phone browser: it
opens the Shield app with a `shield://` link, and a computer can't open the app on someone's phone.
`packages/wallet/README.md` already says it: a computer without the extension has no way in yet,
because Shield's app can't scan a pairing code. Every account needs Shield (INV-13), so the desktop
app can't be used until there is a way in. The options:

| Option | What it takes | Assessment |
| --- | --- | --- |
| **A pairing code Shield's phone app scans** | Shield adds a scanner; the desktop shows the pairing link as a QR code; the relay we already use carries the rest | Best: no extension, approvals on the phone, the same sealed relay. Ask Provable now |
| **Load the Shield extension into an Electron app** | Electron runs only part of the Chrome extension system; a wallet's popups and background worker may not work | Fragile, ties us to the extension's internals; a fallback to test, not to plan on |
| **Hand signing to the person's browser** | The desktop app opens a page in the browser for each approval | Puts the browser back in the path; defeats the purpose |

The first option is what Shield shipped (as a verified link a phone's camera opens, rather than a
scanner in the app). The desktop app still needs step 2's releases for its signed updates.

**Verifying the app to Shield (an idea to work out with Provable).** Today the name and origin the
app declares are self-reported. Step 2 could make them checkable: each release is reproducible,
signed with the release key, and its digest anchored on Aleo, and the release public keys are
published. If the declared origin published those keys (for example under `/.well-known/`), Shield
could check that the connecting app's release is signed by that origin's key and anchored on chain,
and show the origin as verified rather than declared.

**The shell: Tauri** (recommended over Electron).

| | Tauri | Electron |
| --- | --- | --- |
| Size | About 10 MB; uses the system's browser engine | About 100 MB; carries its own Chromium |
| Updates | Built-in updater that refuses an update without a valid signature | `electron-updater`, signatures available |
| Engine | WebView2 (Windows), WebKit (macOS, Linux): must test WebAssembly, IndexedDB and WebCrypto on each | The same Chromium everywhere |
| Extensions | None | Partial Chrome extension support (the fallback above) |

**Signing for each system,** so the operating system trusts the installer: an Apple Developer ID
and notarization for macOS (Apple charges $99 a year), a Windows code-signing certificate (several
routes, priced from a few dollars a month to a few hundred a year; to be checked before buying), and
a signed checksum for the Linux AppImage. These certificates are separate from the release key: the
operating system's check says who built the installer, the release key decides which updates the
app accepts.

**On the device:** the app's books live in its own storage, apart from any browser. Moving books in
uses the existing backup file and recovery key. The security policy names the same hosts as the
website (the explorer, the relay, the traction counter). The app asks no one before starting and
works offline once set up, as the website does.

- Exit: a signed installer for macOS and Windows that sets up an account through Shield, pays a
  run on testnet, and refuses an update signed with any other key.

### Step 4: the website on GitHub Pages

- **GitHub Pages, on the custom domain only.** Every repository in the organisation shares the
  `pnwbnw.github.io` origin (the map already lives at `pnwbnw.github.io/hewn`), and anything there
  counts as the same site: it could read stored data or register a service worker. The app is
  served only from `hewnaccounting.com`, an origin of its own. GitHub already holds the code, so
  serving it from GitHub removes Vercel from the chain rather than adding a company.
- **What is lost:** GitHub Pages sends no headers of ours, so `frame-ancestors`, `X-Frame-Options`
  and `Permissions-Policy` go (the policy itself travels as a meta tag, as the static bundle
  already does). Step 1 replaces the framing headers; Permissions-Policy was a second lock behind
  the policy, and browsers still ask before granting a camera or a location.
- **The traction counter** (`/api/count`, `/api/traction`, INV-05) is the only server piece. It
  moves to a small service of its own (a Vercel or Cloudflare function at its own address) that
  serves no code: at worst it shows wrong numbers on the map, which draws them as text. The two
  endpoints need cross-site permission for the app's origin; they send none today, so the
  installable bundle's visits probably aren't counted now. Before mainnet: keep it with the floor
  of 5 back, or drop it.
- **A service worker** that keeps the last good release, accepts new files only under Joshua's
  signature, and, when a new worker starts installing, tells the person plainly that an update it
  can't check is arriving. Within the limits above, and with a signed way to retire a bad release
  that the host alone can't trigger. It can also add the lost headers to the pages it serves.
- Exit: the app served from GitHub Pages on the custom domain, the counter on its own service, the
  worker refusing an unsigned file and warning on an unsigned worker, in tests and on a device.

### Also possible: a checking browser extension

A small extension, signed through the browser stores, that compares every file the site serves
with the signed release list and shows a clear mark (like Meta's Code Verify for WhatsApp Web). It
protects people who keep using the website on a computer with the Shield extension. Smaller than
the desktop app, weaker than it (the person has to install it, and the store signs it), and a good
answer if Shield's pairing code takes long.

### Later: a hardened native client (Joshua, 2026-11-17)

A second desktop client with no web engine at all, written in Rust on GPUI (the UI framework Zed is
built on), for the accounts with the most at stake: accountants, large payrolls. Planned, not
scheduled.

- **What it closes:** with no browser engine there is no script injection, no third-party script and
  no hostile page code; the whole class T3 guards against is gone, and Rust adds memory safety.
- **snarkVM natively:** the client can use snarkVM, Aleo's own Rust library, directly instead of the
  WebAssembly SDK: decrypting the business's records with its view key, computing commitments and
  hashes, checking period proofs and release anchors, and reading chain state, faster and with fewer
  layers. Signing stays in Shield: the client asks, Shield shows what is signed and signs (INV-11);
  no key moves into the client.
- **What it needs first:** a native way to reach Shield (the JavaScript adapter can't run there).
  Provable's suggestion (2026-11-23): start from a public relay protocol spec with test vectors,
  then see whether a Rust client from them would help.
- **snarkVM versions:** pin the crates to the version snarkOS runs on the target network (mainnet:
  snarkVM 4.13.1, consensus V22, per Provable on 2026-11-23; check again before pinning).
  `snarkvm-console` is the starting point for records, `snarkvm-synthesizer-process` for verifying
  execution proofs.
- **What it costs:** every screen written again in Rust, and two interfaces kept from then on (the
  website stays). GPUI is before its 1.0 and shaped around Zed's needs; its Windows support is newer
  and it has no phones.
- **When:** once the Tauri app has shipped, Shield offers a native path, and GPUI is stable enough.
  Its first piece needs none of that and is built (Joshua, 2026-11-25): the native verifier below.

**Where it stands** (2026-11-25):

| Piece | State |
| --- | --- |
| The native verifier ([`apps/native`](../apps/native/README.md)) | Built: a Rust library and a one-window GPUI app that check a release folder as `verify.mjs` does and a period proof and its anchor as `/verify` does, with snarkVM's console crates recomputing the anchoring transaction's ids. It confirms the release fixture and October's anchor; no keys, no wallet, no signing. Built for Windows in CI (`.github/workflows/native.yml`); a run on a real Windows machine is Joshua's to do |
| GPUI | Through gpui-kit's `gpui-pre` snapshots of Zed's GPUI, held to the seven-day rule and checked file by file against Zed's repository at the commit each names, with the snapshots' few changes reviewed (`apps/native/gpui_patches.toml`) |
| Screens, books, Shield | Not started: they wait on a native way to reach Shield |

## Order

1. Step 1, the guard: done (#370).
2. Ask Provable about a way into Shield from a computer: done, answered by adapter 1.6.0.
3. Step 2: the tools are built (#371); the first signed and anchored release is Joshua's to make.
4. Step 3: #373 moves to 1.6.0 on 2026-11-27, then the test with phones on Windows and macOS.
5. Step 4: built (#374, draft #375), waiting on Joshua's decisions.

## What each step closes

| Who could change the code | After step 1 | After step 2 | After step 3 (desktop) | After step 4 (web) |
| --- | --- | --- | --- | --- |
| Framing a copy of the app | Closed | | | |
| Vercel | | Detectable by anyone who checks | Closed | Gone from the chain |
| DNS or domain | | Detectable | Closed after install | Warned about, healed within a day |
| GitHub serving other files | | Detectable | Closed after install | Warned about |
| A hijacked package | | Unchanged: caught only by review and the T3 guards | Same | Same |
| The person's device | | | | Out of reach of any app |

## Open questions for Joshua

- Whether to propose the release-based app verification (above) to Provable.
- Where the release key lives (a hardware key, or an offline machine), and who holds the second.
- Which systems first for the desktop app: macOS and Windows, Linux later?
- The traction counter on its own service, or ended at the move?

## References

- `docs/THREAT_MODEL.md` T3 (malicious code in the page; the signed-builds item) and T2 (a stolen
  device).
- `packages/wallet/README.md`: Shield's three ways in, and why a computer without the extension
  has none.
- `apps/business/README.md`: the static bundle and `api_base`.
- `docs/OPERATING_COSTS.md`: hosting costs today.
- `docs/CLOSE_PERIOD.md`: anchoring through `payroll_audit_log`.
