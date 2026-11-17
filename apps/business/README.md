# apps/business — the Hewn app

The whole product in one Next.js app: the business side (books, payroll, schedule, hours, hiring,
messages) and the worker side (home, schedule, hours, offers, paystubs). A Shield account holds one
kind of account, and the app shell shows the right navigation for it. Everything a person keeps
lives in an encrypted vault in their browser; messages travel as letters on chain, and the only
server piece counts visits by country.

## Two builds

| Build | Command | What it makes |
|---|---|---|
| The website | `pnpm build` | Served by Next.js on Vercel at www.hewnaccounting.com (app.hewnaccounting.com doesn't resolve yet), with the one server piece, the traction counter (`src/app/api/*.server.ts`), and the per-request security policy (`src/proxy.ts`). Once the app moves to GitHub Pages, it stays on Vercel as the counter's own address, where every page and public file answers 404 (`src/security/counter_host.ts`; the framework's own script files, which the request proxy never sees, are still served there) |
| The static bundle | `pnpm build:static` (`HEWN_STATIC=1`) | Plain files in `out/`: what GitHub Pages serves on the app's domain (`.github/workflows/pages.yml`) and what the desktop app will carry. The policy is stamped into each page by `scripts/static_csp.mjs`, and the bundle reaches the counter by full address (`BRAND.counterUrl`, `src/api_base.ts`), the one extra origin its policy names |

Server-only files end in `.server.ts`, an extension only the website build looks at, so the bundle
never contains a route handler. CI builds both.

- The request proxy stays `src/proxy.ts`; the static export tolerates it.
- Client code reaches the counter only through `src/api_base.ts` (`apiUrl("/api/…")`), which
  names it by its full address in the bundle (`BRAND.counterUrl`, from `@pnw/brand`; the app's own
  address until a domain of its own points at the counter).
- The counter (`src/app/api/traction/counts.ts`) answers cross-site requests only from the app's
  own origins: its address (`BRAND.appUrl`) and the desktop app's (`tauri://localhost`,
  `http://tauri.localhost`). The count is JSON, so the browser asks first: `OPTIONS /api/count`
  grants POST with a `Content-Type` header to those origins alone, never credentials. What is sent
  and stored doesn't change (INV-05): yes or no, two counts a country. Before 2026-11-17 the bundle
  sent no count that arrived: its browser's preflight got no permission, and the handler took
  same-origin requests only.
- In the bundle a pathname may end in `/`: compare pathnames through `canonicalPath`
  (`src/shell/AppShell.tsx`), never as raw strings.
- No server holds messages: the old mailbox server is retired (2026-10-22; `archive/README.md`
  names the commit that holds it), and every message is a letter on chain sent from the user's wallet.

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
| `src/shell/` | The app shell: navigation, section views, page views |
| `src/security/` | The content security policy for both builds; what Pages needs (`pages.ts`: the CNAME, never a shared origin); the counter's own address answering only the counter (`counter_host.ts`); with tests |
| `src/traction/` | The public traction map and the visit counter that feeds it |
| `src/paper/` | The paper's text and figures (`basement.ts`, generated from its draft with the PDF in `public/papers/`; regenerate both, never edit by hand) and its journal-style CSS |
| `src/api_base.ts`, `src/brand.ts`, `src/proxy.ts` | Where the server pieces are for this build; the brand re-export; the per-request policy |
| `src/fiat_boundary.test.ts` | The test that keeps chain code inside `src/chain` and chain words off a fiat user's screens |
| `test/devnode/` | End-to-end tests against a local Aleo node, outside `pnpm test`: Hewn's letters, agreements and a three-worker payroll run against the deployed programs' bytecode (the stablecoin a stand-in). See its README. |
| `public/brand/` | Generated by `brand/build_assets.py`; never edited by hand |
| `public/traction/world.json` | Country outlines for the traction map, projected ahead of time |
| `scripts/static_csp.mjs` | Stamps the policy into the static bundle's pages |
| `scripts/pages_files.mjs` | Adds the CNAME file to the static bundle for GitHub Pages; refuses a shared origin, warns while the counter has no address of its own |

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

**GitHub Pages** (`.github/workflows/pages.yml`, `docs/HOSTING.md` step 4) follows the same rule
(`isRelease` in `scripts/vercel_ignore.mjs`): on a release, or when started by hand from `main`, it
builds the static bundle, adds the CNAME file and publishes it with GitHub's own Pages actions;
only its deploy job holds the write permission. The bundle is served only on the app's own domain,
never from the shared `pnwbnw.github.io` origin, and this repository's one Pages site is the app's
(the map is published from a repository of its own, `docs/map/README.md`). Until the domain's DNS
points at Pages, www.hewnaccounting.com is still Vercel; the switch is a settings change, in order:

1. The top-page guard (`docs/HOSTING.md` step 1) merged and released first: Pages sends none of
   our headers, and the guard is what keeps the app out of another site's frame there. And any
   `NEXT_PUBLIC_*` setting the Vercel project has is set in the Pages workflow too (the workflow
   sets none, so the bundle takes the defaults: testnet, the brand's addresses).
2. A domain for the counter on the Vercel project (say `count.hewnaccounting.com`), and
   `counterUrl` in `packages/brand` set to it (or `NEXT_PUBLIC_COUNTER_URL` on both builds).
3. The map's own repository set up and published (`docs/map/README.md`), since this repository's
   Pages address forwards to the app's domain from then on. Then the domain verified for the
   organisation on GitHub, and the custom domain and "Enforce HTTPS" in this repository's Pages
   settings, with Pages published by GitHub Actions.
4. A release (`[deploy]`), or the Pages workflow run by hand; then `www` pointed at Pages in DNS.

Only the title counts, so a description can mention the tokens freely. The marketing site
(`apps/site`) follows the same rule with its own folders. Until a release, the live app is the
last one deployed: say "release" and the next merge carries `[deploy]`.

## Settings

None are needed to run. `NEXT_PUBLIC_COUNTER_URL` (optional, both builds) overrides where the
counter is, as `NEXT_PUBLIC_APP_URL` does the app's address. `.env.example` lists the optional ones: the courier's pinning key
(`PINATA_JWT`) and gateway, both server-side only. On Vercel, connecting an Upstash Redis store adds
the traction counter's settings; without it, the traction page says counting is off.

## Locally

```bash
pnpm --filter @pnw/business dev          # http://localhost:3000
pnpm --filter @pnw/business test         # this app's tests
pnpm --filter @pnw/business test:devnode # letters, agreements, a payroll run against a local Aleo node (about 3 minutes)
pnpm --filter @pnw/business build        # the website
pnpm --filter @pnw/business build:static # the installable bundle, in out/
```
