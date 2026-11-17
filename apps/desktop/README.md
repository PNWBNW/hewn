# apps/desktop — the installable desktop app

The app on a computer, without a website in the path: a [Tauri v2](https://v2.tauri.app) shell that
carries the static bundle (`apps/business/out`, `pnpm --filter @pnw/business build:static`) inside
it and runs it from the app's own origin. Updates are installed only when they are signed with the
operator's update key, so no host, domain or DNS change can alter the code it runs
(`docs/HOSTING.md`, step 3).

**Status (2026-11-17): built and tested on Linux, not yet usable.** Every account needs Shield
(INV-13), and the desktop app can't reach Shield yet: no extension runs inside it, and Shield's
phone app can't scan a pairing code. Until there is a way in, every screen that needs Shield says
so plainly (below) instead of offering a connect that would wait for nothing.

## What's here

| Path | What |
|---|---|
| `src-tauri/Cargo.toml`, `Cargo.lock` | The shell's crates, exact versions, each at least seven days old when pinned (`scripts/check_crate_age.py`) |
| `src-tauri/tauri.conf.json` | Generated from `@pnw/brand` by `scripts/tauri_config.mjs` (`src/tauri_config.ts`); never edit it by hand, a test fails if it differs |
| `src-tauri/src/lib.rs` | The window, the navigation rule, downloads, the plugins |
| `src-tauri/src/links.rs` | Where a link may go: the app's pages stay, web links open in the person's browser, the rest nowhere |
| `src-tauri/src/update.rs` | Checking, downloading and installing updates |
| `src-tauri/tests/update_key.rs` | The updater refuses a package signed with any other key, changed after signing, or signed for another version |
| `src/update_manifest.ts`, `scripts/update_manifest.mjs` | Making `latest.json` for a release, checking every package's signature against the update key first |
| `scripts/sums.mjs` | SHA-256 of each installer, for the release page |
| `src-tauri/icons/` | Not committed: made from `brand/source/hewn-icon.png` by `pnpm --filter @pnw/desktop icons` |
| `.github/workflows/desktop.yml` | Unsigned installers for macOS, Windows and Linux, on a `v*` tag or by hand |

## How it is locked down

- **The same security policy as the website.** Each page carries the bundle's policy in its meta
  tag (`apps/business/scripts/static_csp.mjs`); Tauri adds none of its own (`csp: null`), so there
  is one policy, word for word the bundle's: scripts from the app only, connections to the app, the
  explorer, Shield's relay and the website's traction counter, WebAssembly compiled but no `eval`.
- **No bridge from the pages to the app.** No capability is granted to any window, there is no
  `window.__TAURI__`, and the policy itself refuses the bridge's address. The two plugins (the
  updater, and the opener that hands web links to the browser) are called from Rust only.
- **The window shows only the app.** A web link (`https:`, `mailto:`) opens in the person's own
  browser; `http:`, `file:`, other apps' links (`shield:`) and anything else go nowhere; no link gets
  a new window. A download is saved to the Downloads folder only when one of the app's own pages
  made it (a backup file, a report).
- **No service worker.** The bundle asks `mayRegisterServiceWorker()`
  (`apps/business/src/desktop.ts`) before registering one, which is never inside the desktop app:
  the updater is the app's way of taking new files.
- **No developer tools** in a release build.

## The app's origin, and what it means

| System | Origin | Engine | Where the books live |
|---|---|---|---|
| macOS | `tauri://localhost` | WKWebView (Safari's) | `~/Library/WebKit/com.hewnaccounting.desktop/` |
| Linux | `tauri://localhost` | WebKitGTK | `~/.local/share/com.hewnaccounting.desktop/` |
| Windows | `https://tauri.localhost` | WebView2 (Edge's) | `%LOCALAPPDATA%\com.hewnaccounting.desktop\EBWebView\` |

Windows would use `http://tauri.localhost` by default; the app asks for the `https` form
(`useHttpsScheme`), so the policy's `upgrade-insecure-requests` can't turn the app's own requests
into ones that fail. **Neither the origin nor the identifier may change after the first release**:
the browser engine keeps IndexedDB (the books) under them, and a change would leave the books
behind. Both come from `BRAND.desktop.id` and this configuration.

- **IndexedDB** is the app's own, apart from any browser on the same computer: books on the website
  and books in the desktop app are separate. Moving books in uses the existing backup file and
  recovery key. Uninstalling may delete the app's data (the Windows uninstaller offers to): back up
  first. Tested here: the vault's storage, AES-GCM, PBKDF2 at 600,000 rounds (about 100 ms), a
  non-extractable key kept in IndexedDB ("stay logged in"), Ed25519 in WebCrypto, and data kept
  across a restart.
- **WebAssembly** compiles under `'wasm-unsafe-eval'` and `eval` stays refused (tested on
  WebKitGTK; WebView2 is Chromium, which supports the same; WKWebView on macOS untested).
- **The traction counter** answers only requests from the website itself and sends no cross-site
  permission, so the desktop app's visits aren't counted and its traction page can't load the
  numbers (the page says it couldn't). That is unchanged on purpose: whether the counter moves to its
  own service and admits the app's origin is step 4's decision (`docs/HOSTING.md`).

## Shield inside the desktop app

`useShield()` (`apps/business/src/chain/shield.ts`) knows when it runs in the desktop app
(`useDesktopApp()`): the route is `none`, `connect` and `restart` do nothing, and the state is
`missing`, so no screen ever shows "Connecting…". Every screen that would say "install the Shield
extension" says instead that the desktop app can't reach Shield yet and to use the website for
now (`ShieldMissing` and `SHIELD_NOT_IN_DESKTOP` in `chain/ShieldStatus.tsx`), with a link to the
website where an account starts (setup, finding your books), which opens in the browser.

When Shield's phone app can scan a pairing code, the desktop app will show the pairing link as a QR
code and the relay it already allows carries the rest (`docs/HOSTING.md`, step 3).

## Building

Needs Node 22 and pnpm (the workspace), Rust (stable), and the Tauri command line at the pinned
version: `cargo install tauri-cli --version 2.12.4 --locked`. On Linux, the web view's libraries:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev patchelf
```

Then:

```bash
pnpm install --frozen-lockfile
pnpm --filter @pnw/business build:static   # the bundle the app carries
pnpm --filter @pnw/desktop icons           # icons from brand/source
cd apps/desktop && cargo tauri build       # installers under src-tauri/target/release/bundle/
cd src-tauri && cargo test --locked        # links and the update key
pnpm --filter @pnw/desktop test            # the configuration and the manifest maker
```

After changing `BRAND` (the name, `desktop.id`, `desktop.updateKey`, `sourceUrl`), run
`node scripts/tauri_config.mjs --write`. After changing `Cargo.toml`, pin crates at least seven days
old: `RUSTC_BOOTSTRAP=1 cargo -Zunstable-options generate-lockfile --publish-time <a date seven days back>`,
then `python3 -I scripts/check_crate_age.py`.

## Two kinds of signing

| What | Who checks it | Key | Where it lives |
|---|---|---|---|
| **Operating-system signing**: Apple Developer ID and notarization, a Windows code-signing certificate | macOS and Windows, when the installer is opened: "who made this?" | Certificates bought from Apple ($99 a year) and a Windows certificate authority | May live in CI as secrets (the slots are in `desktop.yml`, commented out) |
| **The update key** | The app itself, before it installs any update: "did the operator release this?" | A minisign key made by the operator | Only on the operator's own machine (or a hardware key). Never in CI, GitHub, Vercel or a chat (INV-06) |

The operating systems' check keeps a stranger's installer from posing as the app; the update key
keeps everyone, the certificate holders and GitHub included, from changing an installed app. Unsigned
installers work today: macOS asks the person to open it from System Settings, Windows SmartScreen
warns. Linux has no system check; its installers are listed with their SHA-256 sums.

**One key or two?** The release key (`scripts/release`, Ed25519, signs the bundle's digest) and the
update key (minisign) are both Ed25519 underneath, but their formats differ: minisign signs a
BLAKE2b-512 digest of the file, wraps the signature with a key id and a signed comment, and
`cargo tauri signer` keeps the secret half in its own encrypted file. One raw key could be
converted to serve both, but only with tooling of our own around the secret key. **Recommended:
two keys, held the same way** (offline, each with a spare kept apart). They sign different things
(the bundle's digest anyone can check against the anchor; the installer packages the app installs),
a mistake with one doesn't expose the other, and each can be replaced on its own: a new update key
reaches installed apps in an update signed with the old one.

## Releasing

1. Joshua makes the update key, once, on his own machine:
   `cargo tauri signer generate -w ~/.tauri/hewn-update.key` (with a password). He adds the public
   half (the `.pub` file's content, one base64 line) to `BRAND.desktop.updateKey` in
   `packages/brand/src/index.ts`, runs `node apps/desktop/scripts/tauri_config.mjs --write`, and
   merges that. Until then the app checks for no updates, and a tag refuses to build.
2. Set the version in `apps/desktop/package.json`, merge, and push a tag `v<version>`. The
   workflow builds unsigned installers for macOS (universal), Windows (MSI and setup .exe) and
   Linux (AppImage, .deb, .rpm), with `SHA256SUMS-*.txt`, as the run's artifacts.
3. On his machine, he downloads them and signs each update package with the version bound:
   `cargo tauri signer sign -f ~/.tauri/hewn-update.key --app-version <version> <file>` for
   `Hewn.app.tar.gz`, the `.msi`, the `-setup.exe`, the `.AppImage`, the `.deb` and the `.rpm`.
4. `node apps/desktop/scripts/update_manifest.mjs <version> "<notes>" <the signed files>` checks
   every signature against `BRAND.desktop.updateKey` and writes `latest.json`.
5. He makes the GitHub release `v<version>` and uploads the installers, the `.sig` files,
   `latest.json` and the sums. Installed apps find `latest.json` at
   `<sourceUrl>/releases/latest/download/latest.json`, download their package, check it, and
   install it when the person closes the app.

The update's signature must name its version (`requireSignedVersion`), so an older signed release
can't be served as a newer one; an attacker who controls the release page can only withhold
updates.

## Verified, and not

Verified on Linux (Ubuntu 24.04, WebKitGTK, headless under Xvfb), 2026-11-17: the debug and
release builds; the `.deb`, `.rpm` and AppImage bundles; the release app opening the bundle's front
page, moving between screens, and saying on "Find your books" that it can't reach Shield yet; a
probe page under the bundle's exact policy (the storage and WebCrypto results above, WebAssembly
compiled and `eval` refused, the explorer reachable, an outside host refused by the policy, the
bridge to the app refused); the shell's tests; and `update_manifest` checking a signature made by
`cargo tauri signer` itself. Not verified here: macOS and Windows (the workflow builds them; they
need a run and a person to open them), Shield's relay over WebSocket (this sandbox's network refuses
that host; the policy allows it), an update installed end to end from a real release, and
operating-system signing.
