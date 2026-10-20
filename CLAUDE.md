# CLAUDE.md — Hewn

Read this whole file at the start of every session, then follow **Session start** below.

## What this is

**Hewn** (formerly "PNW Ledger"): a clean-room, open-source rebuild of QuickBooks Advanced (minus AI and support features) on top of
Joshua Day's existing Aleo ZK payroll stack (PNW — Proven National Workers). Same mental model
bookkeepers already know, our own screens and code. Never copy QuickBooks screens, icons, text or
layouts; match what it *does*, not how it *looks*.

Three operating modes on one codebase: **fiat** (default, encrypted local vault, bank does the money),
**anchored** (same, plus period roots anchored on Aleo), **settled** (USDCx on Aleo, the existing payroll
stack). The double-entry core is identical in all three.

Brand: **Hewn** (hewnaccounting.com; the app at app.hewnaccounting.com), tagline "honest books, grounded and
true." The name, tagline, colours, asset paths and the app/site URLs live only in `packages/brand`
(`@pnw/brand`; `apps/business/src/brand.ts` is a re-export of it); never hard-code the product name
elsewhere (packages say "this app"). Source art and the asset build script live in `brand/`; never
hand-edit the generated files in `apps/*/public/brand/` (the app and the marketing site
`apps/site` serve byte-identical copies). Internal package names stay `@pnw/*` (PNW is the
company and protocol namespace).

`BUILD_PLAN.md` (repo root) is the spec: phases, deliverables, exit criteria. `PROGRESS.md` is the log.

## Session start

1. Read `BUILD_PLAN.md` and the last few entries of `PROGRESS.md` (it is long; the newest entries
   are at the end).
2. Find the current phase (first phase with an unchecked exit criterion). Report to Joshua in
   10 lines or fewer: current phase, what's done, what's next, any blocker. Then propose **one** task
   aimed at **one** exit criterion, and wait for his go-ahead before writing code.

## Where to look

Every folder with more than a few files has a README saying what is in it and how it fits: the
root `README.md` has the map, `docs/README.md` indexes the design documents, `packages/README.md`
the layering, `apps/business/README.md` the app and its two builds, `archive/README.md` what was
retired and why. `CONTRIBUTING.md` and `SECURITY.md` are for people arriving from outside. The Leo
programs are in `pnw_mvp_v2` (a submodule, fetched over HTTPS), which has its own `CLAUDE.md`.

## Non-negotiable rules

**Privacy floor**
- Anything tied to an individual — wages, withholdings, W-4 data, bank details, paystubs, worker
  address — is private in every mode and can never be made public. Enforce it in the circuit or the
  vault, not only the UI.
- No private data on any server, ever. No database. Plaintext lives in the browser session only.
- Public Aleo mappings hold only hashes, commitments and block heights. Never a plaintext amount,
  account name, memo or identity.
- Aggregates publish only as proofs, with a minimum group size (no single-worker inference).
- **One exception: testnet traction counts (Joshua, 2026-10-19).** Two totals per country since launch
  (visits, visitors) in a small Upstash store, nothing else: no dates, no addresses, no ids. A
  visitor is decided on the device (it remembers it was counted) and only yes/no is sent. Published
  on `/traction` only for countries with at least 5 visitors, cached for a day
  (`apps/business/src/app/api/traction/counts.ts`). Nothing else may be stored this way.

**Keys and storage**
- Never commit private keys, view keys, `.env` files or seed phrases. Never print them in logs.
- The vault key is derived from the user's unlock secret: **email + passphrase** together in fiat
  mode (no wallet needed; `apps/business/src/books/account.ts`: the secret is the normalised email
  and the passphrase, the vault id a hash of role + email, so one email can hold a business and a
  worker account), and, later, a Shield wallet signature over a domain-separated message once a
  wallet is linked. It is never stored in plaintext and never leaves the vault module; the one
  exception is "stay logged in" (Joshua, 2026-10-15): the open data key, as a non-extractable
  `CryptoKey`, kept in IndexedDB for at most 24 hours from login, forgotten on Log out
  (`@pnw/vault` `remember` / `resumeSession` / `forgetSession`). There is no
  server account: no email is sent, nothing is verified remotely, and a lost passphrase is
  unrecoverable until the planned recovery key exists. Scheme (`@pnw/vault`): a random AES-256-GCM
  data key encrypts the books; the unlock secret (PBKDF2-SHA256, 600k rounds) only wraps that key,
  so a recovery key, a wallet unlock or per-member access later just adds another wrapped copy.
- localStorage is not a book of record. Durable data goes in the encrypted IndexedDB vault.

**Boundaries**
- Every on-chain write is signed in the user's wallet through the `wallet` package's executor, so
  the wallet shows what is being signed. Program and transition names come from `pnw-adapter`
  (never hard-coded elsewhere). The CLI adapter / Path B (pasted private key) is legacy: the
  `coordinator` package that carried it is gone (2026-10-14; the pay queue in `rail` is the wallet
  path), and no new code or screen may use `pnw-adapter`'s CLI adapter. Nothing calls `snarkos` or the SDK execute path directly.
- **Every account is on the registry (Joshua, 2026-10-15).** Setup links a Shield account and
  registers a `name.hewn` (a worker also creates the profile behind it); the app shell keeps an
  unfinished account on `/settings/setup` (`books/setup.ts`). Team members, customers and vendors are
  added only by finding their registered name (on mainnet, by Aleo address too: free-tier names are
  random, though public, `BUILD_PLAN.md` "Mainnet names"). **One kind of account per Shield account** (Joshua,
  2026-10-15): a wallet holding a business's name can't link to or register a worker account, and
  the reverse (business and personal money never share a wallet); the same email may hold both
  kinds, each with its own Shield account (`chain/account_kind.ts`; the mainnet registrar will
  enforce it on chain). This replaces "fiat first": a wallet is now required
  to get in. What stays: the ledger core, vault, reports and payroll never import `wallet`,
  `pnw-adapter`, `rail` or `records`; chain code lives in `src/chain` and loads only on the pages
  that need it (`fiat_boundary.test.ts`; the CSP is one policy for the whole app since 2026-10-15,
  `docs/THREAT_MODEL.md` T3). The books keep working offline
  once an account is set up.
- Extension modules may never touch posting logic or the vault key.
- Mode upgrades (fiat → anchored → settled) are one-way, show exactly what goes on-chain, and require
  a second wallet signature after a review screen. Never flip a mode as a side effect.

**Leo programs**
- Deployed programs are immutable. Never edit a deployed program in place; ship a new version and a
  migration. `config/testnet.manifest.json` is the source of truth for what's live.
- Superseded program versions go to `src/layer1/archive/` or `src/layer2/archive/` in
  `pnw_mvp_v2`, unchanged, with a row in that folder's README.
- Any new or changed Leo program: say so explicitly before starting, so Joshua can switch the session
  to Fable 5.1 at high effort. Include negative tests (inputs that must fail).

## Working agreement

- One task, one exit criterion, one PR. Don't bundle.
- Don't build new screens or a new app version without Joshua's explicit greenlight. Planning,
  inspection and tests are fine anytime.
- Production revisions get a decimal version in the filename (v1.1, v1.2, …). Joshua decides when the
  whole number bumps.
- End of every task: run the tests, append a dated entry to `PROGRESS.md` (what changed, test counts,
  tx hashes if any), tick any exit criteria met in `BUILD_PLAN.md`, commit, open a PR, stop.
- Joshua mostly works from his phone: lead with the result, keep reports short, put detail in
  `PROGRESS.md` rather than chat.
- If something in the existing code contradicts this file or the build plan, stop and ask. Don't
  silently pick one.

## Known facts about the existing stack

- Portal: Next.js 16.1.6, React 19.2.3, pnpm, vitest (tests at `src/**/*.test.ts`; path aliases
  `@/src`, `@/components`, `@/app`). Monorepo is on Next.js 16.3.8 (security fixes). Wallet adapters
  `@provablehq/aleo-wallet-adapter-*` (renamed from `-adaptor-` on 2026-10-19: core 1.1.2, react
  1.3.1, shield 1.3.0, standard 1.4.0, types 1.1.0) — pin exactly. **Shield is the only wallet**;
  don't add other adapters. `@provablehq/sdk` 0.10.1.
- **Three ways in to Shield, one adapter** (`packages/wallet/src/wallet-provider.tsx`, Joshua,
  2026-10-19): the extension on a computer and Shield's own browser on a phone both inject Shield
  into the page; a plain phone browser (the third way) pairs with the Shield app over Shield's
  relay: `connect()` opens the app with a `shield://` link, every approval opens it again, and
  answers come back sealed end to end through `wss://relay.shield.app` (the one host besides the
  explorer in the app's CSP; pinned in both places). A computer without the extension has no way
  in yet (Shield's app can't scan a pairing code). Over the relay the app answers reads only while
  it is open; `src/chain/shield.ts` exposes `route` and `away` for the wording and an "Open Shield"
  link. Not yet tried on a real phone.
- **Two builds of the business app** (2026-10-19): the website (`pnpm build`) and the static
  bundle for the installable app (`pnpm --filter @pnw/business build:static`, `HEWN_STATIC=1`:
  `output: export`, pages as folders, the policy stamped into each page, `apps/business/out/`).
  Server-only files end in `.server.ts` (the route handlers under `src/app/api`), an extension only
  the website build sees; the proxy stays `proxy.ts` (the export tolerates it). Client code reaches
  the server pieces through `src/api_base.ts` (`apiUrl("/api/…")`, the website by full address in
  the bundle) and builds the mailbox client only through `src/chain/mailbox_client.ts`. Pathnames
  may end in `/` in the bundle: compare them through `canonicalPath` (`shell/AppShell.tsx`). CI
  builds both.
- Security baseline: `docs/THREAT_MODEL.md`. CI blocks on tests, build and `pnpm audit` (moderate+).
  New dependencies must be at least 7 days old (`minimumReleaseAge`).
- Leo programs (Leo v4 syntax) live in `pnw_mvp_v2/src/layer1`, `src/layer2`, `src/stubs`.
- Shield wallet: `privateFee: false` was required on every `executeTransaction` (proof generation
  silently failed without it, most likely because the test accounts held no private ALEO to pay
  with). Private fees by default is the goal (Joshua, 2026-10-16); being tested behind the
  dashboard's per-device switch, which `chain/shield.ts` applies to every call. Its browser WASM
  prover drops multi-program proofs, so payroll runs as four sequential transactions (verify →
  transfer → receipts → audit) rather than the monolithic `payroll_core_v2::execute_payroll`.
- USDCx `transfer_private` needs a Sealance Poseidon4 Merkle exclusion proof, tree depth 16, built
  client-side via `SealanceMerkleTree`.
- Explorer REST base is `https://api.explorer.provable.com/v2`; `snarkos developer execute/deploy`
  need `--network 1` for testnet.
- The double-pay item in `pnw_mvp_v2/docs/NOTES.md` is stale per Joshua; ignore it unless a test
  shows otherwise.
- The Julia tax service is retired (`archive/pnw_payroll_engine/`). `packages/tax-engine` is the
  only tax engine.
- Retired code goes to `archive/` with a row in `archive/README.md`, never deleted silently
  (2026-10-20): the Julia engine, the salvage script, and four salvaged packages nothing uses
  (`persistence`, `w4-crypto`, `pdf`, `nft-art`). The old portal repository is retired; its README
  and `CLAUDE.md` point here.
- Licence: **AGPL-3.0-only** since 2026-10-15 (Joshua), for this repo and `pnw_mvp_v2`; text in `LICENSE`.
  Every package says `"license": "AGPL-3.0-only"`. The app and the site link to the source
  (`BRAND.sourceUrl`); keep that link. The Hewn name and logo are not licensed.
