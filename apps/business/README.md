# apps/business — the Hewn app

The whole product in one Next.js app: the business side (books, payroll, schedule, hours, hiring,
messages) and the worker side (home, schedule, hours, offers, paystubs). A Shield account holds one
kind of account, and the app shell shows the right navigation for it. Everything a person keeps
lives in an encrypted vault in their browser; messages travel as letters on chain, and the only
server piece counts visits by country.

## Two builds

| Build | Command | What it makes |
|---|---|---|
| The website | `pnpm build` | Served by Next.js at www.hewnaccounting.com (app.hewnaccounting.com doesn't resolve yet), with the server pieces (`src/app/api/*.server.ts`) and the per-request security policy (`src/proxy.ts`) |
| The static bundle | `pnpm build:static` (`HEWN_STATIC=1`) | Plain files in `out/` for the installable app (`apps/desktop` carries them). The policy is stamped into each page by `scripts/static_csp.mjs`, and the bundle reaches the server pieces on the website by full address (`src/api_base.ts`) |

Server-only files end in `.server.ts`, an extension only the website build looks at, so the bundle
never contains a route handler. CI builds both.

The bundle is also what a release signs (`scripts/release/README.md`), so two clean builds of one
commit must give the same bytes. `node scripts/release/build.mjs` builds it in a fixed environment
with the commit as Next.js's build id (`HEWN_BUILD_ID`, read by `next.config.ts`) instead of a
random one, shows that commit as the version while the books open, and writes `release.json`.
A plain `build:static` keeps a random id (`src/release_build_id.test.ts`).

- The request proxy stays `src/proxy.ts`; the static export tolerates it.
- Client code reaches the server pieces only through `src/api_base.ts` (`apiUrl("/api/…")`), which
  names the website by its full address in the bundle.
- In the bundle a pathname may end in `/`: compare pathnames through `canonicalPath`
  (`src/shell/AppShell.tsx`), never as raw strings.
- A page names the conversation or bill it has open in the fragment (`#with=…`), never the query:
  `useHashParams` and `HashLink` (`src/shell/hash_params.ts`) on the page, a
  `<Link href="/messages#client=…" prefetch={false}>` from another one.
- No server holds messages: the old mailbox server is retired (2026-10-22; `archive/README.md`
  names the commit that holds it), and every message is a letter on chain sent from the user's wallet.

## The top-page guard

No one can show the app inside their own page, on any host, in either build
(`docs/THREAT_MODEL.md` T3). The stylesheet hides every page (`globals.css` imports
`@pnw/security/frame_guard.css`) and `src/instrumentation-client.ts` shows it, only when the page
is the top page. Next.js runs that file before it hydrates the page, which is as early as the
app's own code can run without a script tag in the markup or an inline script. A frame that runs
scripts, sandboxed or not, stays hidden; a frame sandboxed without scripts, or a browser with
JavaScript off, shows only the note at the top of `src/app/layout.tsx`. The guard never moves the
top window. `<html>` carries `suppressHydrationWarning` because the guard's mark is added before
hydration on purpose. Run so far in Chromium only (Firefox and Safari not yet); the note relies on
the `scripting` media feature (Chrome 120, Firefox 113, Safari 17), so an older browser with
JavaScript off shows a blank page instead.

What it costs: nothing is drawn until the scripts have loaded. First paint of `/` in the static
bundle, median of five loads in Chromium, with and without the guard's rule
(`test/frames`, 2026-11-17):

| Machine | With the guard | Without | Blank for longer by |
|---|---|---|---|
| This machine (a fast computer, local server) | 80 ms | 60 ms | 20 ms |
| Processor slowed 4× | 256 ms | 120 ms | 136 ms |
| Processor slowed 4×, slow 4G (150 ms, 1.6 Mbit/s) | 1988 ms | 264 ms | 1724 ms |

The app can't be used before its scripts run in any case, so the guard moves when the first
screen appears, not when the app is ready; a repeat visit has the scripts cached. In the browser,
the `top-page-shown` performance mark says when the page was shown.

Search engines that run scripts (Google, Bing) load a page as the top page, so they see it whole;
the raw HTML still carries every word, the title and the link-preview tags for those that don't.
Checked 2026-11-17: a fresh Chromium load of `/` as the top page shows the page, and nothing
(no `robots.txt`) keeps a crawler from the scripts under `/_next/`.

The stack: Next.js 16.4.6 (moved up for security fixes, most recently GHSA-mfr8-8qww-v76h), React 19.3.1,
pnpm, vitest (tests beside their source as `*.test.ts`), and one path alias, `@/` for `src/`.

## The source, folder by folder

| Folder | What's in it |
|---|---|
| `src/app/` | The routes, one folder per page: `/` (dashboard), `transactions`, `sales`, `expenses`, `payroll` (with its run), `projects`, `reports`, `taxes`, `jobs`, `messages`, `settings`; the worker side under `work/`; the public `board`, `traction`, `card` (a name's card, for anyone) and `out-of-the-basement` (Joshua's paper on how Hewn was built, linked from the front page); the server pieces under `api/` |
| `src/cards/` | The cards as the app draws them, on top of `packages/art`: a business's map, a worker's land, a paystub's rings. See its README. |
| `src/books/` | Everything about the books that needs no chain: the vault session, the company, the models behind each screen (hours, schedule, thread, mailbox, jobs, hiring…), pure functions with their tests beside them. See its README. |
| `src/chain/` | Everything that touches Aleo: Shield, letters, offers, pay, the registry, the job board. Loaded only by the pages that need it, through `import("@/chain/…")`. See its README. |
| `src/legal/` | The terms and the privacy page, and the small print every screen shares ("Testnet · provided as is", the note beside worked-out figures). The one folder outside `src/chain` that may name the chain and the wallet. |
| `src/shell/` | The app shell: navigation, section views, page views, and the page's fragment (`hash_params.ts`), which names the conversation or bill a page has open |
| `src/security/` | The content security policy for both builds, with tests; the test that the top-page guard is wired in; and the test that keeps a page's links naming what is open in the fragment, never the query |
| `src/traction/` | The public traction map and the visit counter that feeds it |
| `src/paper/` | The paper's text and figures (`basement.ts`, generated from its draft with the PDF in `public/papers/`; regenerate both, never edit by hand) and its journal-style CSS |
| `src/api_base.ts`, `src/brand.ts`, `src/proxy.ts` | Where the server pieces are for this build; the brand re-export; the per-request policy |
| `src/desktop.ts` | Whether the page runs inside the desktop app (`apps/desktop`), by its origin: no service worker there (`mayRegisterServiceWorker`, asked by whatever registers one), and the chain screens say Shield can't be reached from it yet |
| `src/fiat_boundary.test.ts` | The test that keeps chain code inside `src/chain` and chain words off a fiat user's screens |
| `src/instrumentation-client.ts` | The first of the app's code to run in the browser: the top-page guard (above) |
| `test/frames/` | The top-page guard in Chromium, outside `pnpm test` (CI has no browser): the static bundle served with no headers, as the top page and framed from another origin (no sandbox, `sandbox`, `sandbox="allow-scripts"`), and what the guard costs in blank time |
| `test/devnode/` | End-to-end tests against a local Aleo node, outside `pnpm test`: Hewn's letters, agreements and a three-worker payroll run against the deployed programs' bytecode (the stablecoin a stand-in). See its README. |
| `public/brand/` | Generated by `brand/build_assets.py`; never edited by hand |
| `public/traction/world.json` | Country outlines for the traction map, projected ahead of time |
| `scripts/static_csp.mjs` | Stamps the policy into the static bundle's pages |

The rule the folders enforce: `books` never imports `chain`, and nothing outside `chain` imports a
wallet or Aleo package. A test fails if it does.

## Deploying

Vercel builds the website from this folder (`vercel.json`). Since 2026-11-06 it deploys only when
we mean it to, once per batch (`scripts/vercel_ignore.mjs`, Vercel's "Ignored Build Step"):

- **`main` deploys on a release:** a merge whose title says `[deploy]` (the pull request's title,
  which becomes the squash commit's). Merges without it wait and go out together with the next
  release, so several pull requests cost one build.
- **A release builds only what changed** since that project's last deployment: this folder,
  `packages/`, the lockfile or the workspace files. When it can't tell (more merges since the last
  deployment than Vercel's shallow clone holds), it builds.
- **Other branches** get no preview unless the pushed commit's title says `[preview]` (to try
  something on a phone, say the wallet with Shield).

Only the title counts, so a description can mention the tokens freely. The marketing site
(`apps/site`) follows the same rule with its own folders. Until a release, the live app is the
last one deployed: say "release" and the next merge carries `[deploy]`.

## Settings

None are needed to run. `.env.example` lists the optional ones: the courier's pinning key
(`PINATA_JWT`) and gateway, both server-side only. On Vercel, connecting an Upstash Redis store adds
the traction counter's settings; without it, the traction page says counting is off.

## Locally

```bash
pnpm --filter @pnw/business dev          # http://localhost:3000
pnpm --filter @pnw/business test         # this app's tests
pnpm --filter @pnw/business test:devnode # letters, agreements, a payroll run against a local Aleo node (about 3 minutes)
pnpm --filter @pnw/business test:frames  # the top-page guard in Chromium (after build:static; needs playwright on NODE_PATH)
pnpm --filter @pnw/business build        # the website
pnpm --filter @pnw/business build:static # the installable bundle, in out/
```
