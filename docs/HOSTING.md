---
status: plan
updated: 2026-11-17
summary: Who can change the code a person runs, and the plan to make that checkable: a guard against framing, signed and anchored releases, an installable signed desktop app (the priority, waiting on a way to reach Shield from a computer app), the website on GitHub Pages with a service worker that checks updates, and later a hardened native client on GPUI with snarkVM.
---

# Hosting and verifiable releases

Joshua, 2026-11-17: make the code people run checkable, and make an installable, signed desktop
app the priority. This note is the plan; nothing in it is built yet. Each step is its own pull
request with its own exit criterion, and the steps that change where or how the app is delivered
wait for Joshua's go-ahead.

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

**The blocker: reaching Shield from a desktop app.** A desktop app runs its own copy of a browser
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

Until Shield answers, steps 1, 2 and 4 go ahead: the desktop app needs step 2's releases in any
case. If the answer takes long, a checking browser extension (below) gives computers with the
Shield extension most of the same protection.

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
- **What it needs first:** a native way to reach Shield (the JavaScript adapter can't run there): a
  documented relay protocol, or a Rust library from Provable for pairing and requests. The ask to
  Provable covers this along with the pairing code for step 3.
- **What it costs:** every screen written again in Rust, and two interfaces kept from then on (the
  website stays). GPUI is before its 1.0 and shaped around Zed's needs; its Windows support is newer
  and it has no phones.
- **When:** once the Tauri app has shipped, Shield offers a native path, and GPUI is stable enough;
  the first piece could be a native verifier (releases, anchors, period proofs) before any screen.

## Order

1. Step 1, the guard: small, independent, worth having now.
2. Ask Provable about a pairing code for Shield's phone app (this week; it gates step 3).
3. Step 2, signed and anchored releases: everything else builds on them.
4. Step 3, the desktop app, as soon as there is a way to Shield.
5. Step 4, GitHub Pages with the worker, once releases exist.

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

- Ask Provable for a pairing code the Shield phone app can scan, or a desktop way in, and a native
  (Rust) way to reach Shield for the hardened client?
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
