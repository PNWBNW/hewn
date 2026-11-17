# src/updates — the update worker

Step 4 of `docs/HOSTING.md`, the part that runs on a person's device: a service worker for the
static bundle served on the web (GitHub Pages on the app's own domain, later). It makes a host
that changes the app's files noticed instead of silent. It does not make the host trustless: the
browser fetches and replaces the worker itself (below).

| File | What it is |
|---|---|
| `worker.js` | The worker. Plain JavaScript, no library, WebCrypto only. `scripts/update_worker.mjs` writes it into `out/` as `sw.js` with one `CONFIG` line on top: the release keys from `@pnw/brand` and the headers from `src/security/headers.ts` |
| `worker_source.ts` | Builds that text (`workerScript`) and the header list (`workerHeaders`); used by the build script and the tests |
| `register.ts` | Registers `/sw.js` only in the static bundle on the web (`shouldRegister`: never the website build, never inside the desktop app, `src/desktop.ts`), and notices when the browser installs a worker over the running one |
| `UpdateNotice.tsx` | The small, calm notice the page shows then (mounted in `src/app/layout.tsx`) |
| `retire.ts` | The shape of a retirement and of `release-retired.json`; `scripts/retire_release.mjs` signs one |
| `worker.test.ts`, `register.test.ts` | The worker against a simulated browser (a host, Cache Storage, install, activate, fetch and message events), each test with a key made for it; the registration rules |

The same worker in Chromium, against the real bundle: `test/worker/` (`pnpm --filter
@pnw/business test:worker`, after `build:static`; outside `pnpm test`, CI has no browser).

## What the worker does

- **Keeps the last good release on the device.** A release is the bundle with `release.json` and
  `release.sig` at its root (`scripts/release/README.md`). The worker takes one only when
  `release.json`'s digest is its file list's, `release.sig` signs that digest with a key in
  `releaseKeys`, it isn't older (`created`) than the release the device holds, it isn't retired,
  and every file it lists downloads with its listed SHA-256. Until all of that holds it keeps
  serving the release it has. It looks when it installs, when a page opens (at most every five
  minutes), and when a page asks (`{type: "check"}`).
- **The date is release.json's word, outside the signature** (only the file list is signed), so
  "not older" stops a host going back by mistake, not on purpose: a host can relabel an old signed
  release. A bad old release is withdrawn by retiring it (below). A date later than today counts as
  today, so a release dated far ahead can't make the device refuse the next real one.
- **Checks again what it finds on the device.** Its record of the release it holds (and the one
  before) is kept with the release's signature and checked again before it is trusted, and so is
  each retirement it remembers: a worker the host swapped in can write the same storage, and the
  honest worker that replaces it trusts nothing that worker left unsigned.
- **Serves only matching bytes.** Every file it serves is checked against the release's SHA-256,
  from the device or, if the device lost it, from the host; a file that doesn't match is refused
  (502), never served. A path the release doesn't list is answered 404 (the release's `404.html`
  for a page). The release before the current one is kept too, so a page opened before an update
  can still load its own files.
- **Adds the headers a plain file host can't send**: `X-Frame-Options`, `Permissions-Policy`,
  `X-Content-Type-Options`, `Referrer-Policy`, the cross-origin policies, and on a page a
  `Content-Security-Policy` header that is the page's own policy (its meta tag) plus
  `frame-ancestors 'none'`, which a meta tag can't carry. The website's headers, less HSTS (a
  browser takes HSTS only from the network).
- **Retires a bad release under a signature.** `release-retired.json` at the bundle's root lists
  `{digest, key, sig}` entries, each an Ed25519 signature by a release key of the text
  `release-retire:v1:<digest>` (82 bytes, never the 32 digest bytes a release signature covers, so
  neither can stand in for the other). A device that holds a retired release drops it and serves
  nothing (a plain "withdrawn" message; the books stay on the device) until the host publishes a
  release that isn't retired; it remembers every retirement it has seen and never takes a retired
  release again, even from a later worker. The host can withhold a retirement, but can't make one.
- **Until a release key is published** (`releaseKeys` ships empty), it takes nothing and passes
  the host's files through as served, with the headers.

What it costs: taking a release downloads every file of the bundle, about 30 MB today, nearly all
of it the Aleo SDK's WebAssembly, which the chain pages load anyway. Files a new release shares
with the last one are copied on the device, not downloaded again, and a download cut short keeps
what already matched for the next try.

## What it can't do

- **The browser updates the worker itself.** It fetches `sw.js` from the host, at least once a
  day and on navigations, without asking the running worker, and installs whatever differs. A
  hijacked host can replace the worker with one that does anything. So the page watches for it:
  when the browser starts installing a worker over the running one (`updatefound`), or one is
  waiting to take over, `UpdateNotice` says that an update arrived that the app can't check, that
  it is most likely a normal release, and that a person who wants to be sure can wait or check the
  release first (`scripts/release/README.md`). Every release that changes `sw.js` shows it too:
  the notice is honest rather than rare.
- **The first visit trusts the host.** Nothing on the device yet to compare with.
- **A copy framed by another site** gets a worker and storage of its own (browsers partition both
  by the top site), so at least its first load comes straight from the host, without the headers
  this worker adds; the top-page guard (step 1) covers frames.
- It sees only the app's own address: the explorer, the relay and the website's counter are other
  origins, governed by the policy, not by the worker. Once it holds a release it answers anything
  at the app's own address that the release doesn't list with a 404, so a server piece must keep
  an address of its own (step 4 moves the counter to its own service).

## Open: the Cache API and INV-10

A service worker can keep files only in the Cache API or IndexedDB. INV-10's check
(`scripts/check_browser_storage.py`) allows the Cache API nowhere, so it fails on `worker.js`.
What the worker keeps there is the app's own published release files and its record of which
release it holds: public bytes, checked against the signed release, never the books. Whether to
allow this one file is Joshua's decision (a change to the rule's check and to
`docs/INVARIANTS.md`); this branch leaves both as they are.

## Retiring a release (the operator)

On the machine that holds the release key:

```bash
node apps/business/scripts/retire_release.mjs <digest> --key /Volumes/ReleaseKey/release-1.pem --list release-retired.json
```

It asks for the key's passphrase when the file is encrypted, signs, checks the signature against
the key's own public half, adds the entry to the list (one per digest and key) and prints only the
digest and the key id, with a warning when that key isn't in this copy's `releaseKeys` (a worker
built from it wouldn't honour the retirement). Publish `release-retired.json` at the bundle's root on every host, beside
`release.json`, and publish a fixed release: devices that held the retired one serve nothing until
then. `release-retired.json` is self-checking, so it may change after a release is signed; the
worker never serves it from a release.
