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

Brand: **Hewn** (hewnaccounting.com; the app at www.hewnaccounting.com for now, since
app.hewnaccounting.com doesn't resolve yet, 2026-10-21), tagline "honest books, grounded and
true." The name, tagline, colours, asset paths and the app/site URLs live only in `packages/brand`
(`@pnw/brand`; `apps/business/src/brand.ts` is a re-export of it); never hard-code the product name
elsewhere (packages say "this app"). Source art and the asset build script live in `brand/`; never
hand-edit the generated files in `apps/*/public/brand/` (the app and the marketing site
`apps/site` serve byte-identical copies). Internal package names stay `@pnw/*` (PNW is the
company and protocol namespace).

`BUILD_PLAN.md` (repo root) is the spec: phases, deliverables, exit criteria. The log is one file
per day in `progress/`; `PROGRESS.md` is its generated index.

## Session start

1. Read the **Now** block at the top of `BUILD_PLAN.md` (it ends at `## Scope`), the phase it
   names, and the last few entries of the newest file in `progress/` (files are named by date;
   within a day, entries run oldest to newest, so the newest are at the end). You don't need
   `PROGRESS.md`, the index. About 5k tokens in all.
2. The current phase is the one the Now block names (not the first phase with an open box: older
   phases keep leftovers that wait on other things). Report to Joshua in 10 lines or fewer: current
   phase, what's done, what's next, any blocker. Then propose **one** task aimed at **one** exit
   criterion, and wait for his go-ahead before writing code. When the work moves, update the Now
   block in the same PR.

## Where to look

Every folder with more than a few files has a README saying what is in it and how it fits: the
root `README.md` has the map, `docs/README.md` indexes the design documents, `packages/README.md`
the layering, `apps/business/README.md` the app and its two builds, `archive/README.md` what was
retired and why. `CONTRIBUTING.md` and `SECURITY.md` are for people arriving from outside. The Leo
programs are in `pnw_mvp_v2` (a submodule, fetched over HTTPS), which has its own `CLAUDE.md`.

## Non-negotiable rules

Each rule carries an id; `docs/INVARIANTS.md` says where each is enforced, the check that proves
it, and the threats it answers (CI keeps the two in step: `scripts/check_invariants.py`).

**Privacy floor**
- Anything tied to an individual — wages, withholdings, W-4 data, bank details, paystubs, worker
  address — is private in every mode and can never be made public. Enforce it in the circuit or the
  vault, not only the UI. (INV-01)
- No private data on any server, ever. No database. Plaintext lives in the browser session only. (INV-02)
- Public Aleo mappings hold only hashes, commitments and block heights. Never a plaintext amount,
  account name, memo or identity. (INV-03)
- Aggregates publish only as proofs, with a minimum group size (no single-worker inference). (INV-04)
- **One exception: testnet traction counts (Joshua, 2026-10-19).** Two totals per country since launch
  (visits, visitors) in a small Upstash store, nothing else: no dates, no addresses, no ids. A
  visitor is decided on the device (it remembers it was counted) and only yes/no is sent. Published
  on `/traction` only for countries with at least 5 visitors, cached for a day
  (`apps/business/src/app/api/traction/counts.ts`). Nothing else may be stored this way. (INV-05)

**Keys and storage**
- Never commit private keys, view keys, `.env` files or seed phrases. Never print them in logs. (INV-06)
- The vault key is derived from the user's unlock secret: **username + passphrase** together in
  fiat mode (no wallet needed; `apps/business/src/books/account.ts`: the secret is the normalised
  username and the passphrase, the vault id a hash of role + username, so one username can hold a
  business and a worker account; usernames replaced emails on 2026-10-21 (Joshua), and an email is
  still a valid username, so accounts made with one open unchanged), and, later, a Shield wallet
  signature over a domain-separated message once a wallet is linked. It is never stored in plaintext and never leaves the vault module; the one
  exception is "stay logged in" (Joshua, 2026-10-15): the open data key, as a non-extractable
  `CryptoKey`, kept in IndexedDB for at most 24 hours from login, forgotten on Log out
  (`@pnw/vault` `remember` / `resumeSession` / `forgetSession`). There is no
  server account: nothing is sent anywhere, nothing is verified remotely, and a lost passphrase is
  replaced only with the account's recovery key (2026-10-24, Settings; `@pnw/vault` `addRecovery`,
  `resetWithRecovery`), if one was made. Scheme (`@pnw/vault`): a random AES-256-GCM
  data key encrypts the books; the unlock secret (PBKDF2-SHA256, 600k rounds) only wraps that key,
  so a recovery key, a wallet unlock or per-member access later just adds another wrapped copy.
  (INV-07, INV-08, INV-09)
- localStorage is not a book of record. Durable data goes in the encrypted IndexedDB vault. (INV-10)

**Boundaries**
- Every on-chain write is signed in the user's wallet through the `wallet` package's executor, so
  the wallet shows what is being signed. Program and transition names come from `pnw-adapter`
  (never hard-coded elsewhere). The CLI adapter / Path B (pasted private key) is legacy: the
  `coordinator` package that carried it is gone (2026-10-14; the pay queue in `rail` is the wallet
  path), and no new code or screen may use `pnw-adapter`'s CLI adapter. Nothing calls `snarkos` or the SDK execute path directly.
  (INV-11, INV-12)
- **Every account is on the registry (Joshua, 2026-10-15).** Setup links a Shield account and
  registers a `name.hewn` (a worker also creates the profile behind it); the app shell keeps an
  unfinished account on `/settings/setup` (`books/setup.ts`). Team members, customers and vendors are
  added only by finding their registered name (on mainnet, by Aleo address too: free-tier names are
  random, though public, `docs/MAINNET_NAMES.md`). **One kind of account per Shield account** (Joshua,
  2026-10-15): a wallet holding a business's name can't link to or register a worker account, and
  the reverse (business and personal money never share a wallet); the same email may hold both
  kinds, each with its own Shield account (`chain/account_kind.ts`; the mainnet registrar will
  enforce it on chain). This replaces "fiat first": a wallet is now required
  to get in. What stays: the ledger core, vault, reports and payroll never import `wallet`,
  `pnw-adapter`, `rail` or `records`; chain code lives in `src/chain` and loads only on the pages
  that need it (`fiat_boundary.test.ts`; the CSP is one policy for the whole app since 2026-10-15,
  `docs/THREAT_MODEL.md` T3). The books keep working offline
  once an account is set up. (INV-13, INV-14, INV-15, INV-16, INV-17)
- Extension modules may never touch posting logic or the vault key. (INV-18)
- Mode upgrades (fiat → anchored → settled) are one-way, show exactly what goes on-chain, and require
  a second wallet signature after a review screen. Never flip a mode as a side effect. (INV-19)

**Leo programs**
- Deployed programs are immutable. Never edit a deployed program in place; ship a new version and a
  migration. `config/testnet.manifest.json` is the source of truth for what's live. (INV-20)
- Superseded program versions go to `src/layer1/archive/` or `src/layer2/archive/` in
  `pnw_mvp_v2`, unchanged, with a row in that folder's README. (INV-21)
- Any new or changed Leo program: say so explicitly before starting, so Joshua can switch the session
  to Fable 5.1 at high effort. Include negative tests (inputs that must fail). (INV-22)

## Working agreement

- One task, one exit criterion, one PR. Don't bundle.
- Don't build new screens or a new app version without Joshua's explicit greenlight. Planning,
  inspection and tests are fine anytime.
- Production revisions get a decimal version in the filename (v1.1, v1.2, …). Joshua decides when the
  whole number bumps.
- End of every task: run the tests, append a dated entry to that day's file in `progress/` (what
  changed, test counts, tx hashes if any) and regenerate the index
  (`python3 -I scripts/progress_index.py --write`), tick any exit criteria met in `BUILD_PLAN.md`,
  commit, open a PR, stop.
- Joshua mostly works from his phone: lead with the result, keep reports short, put detail in
  `progress/` rather than chat.
- If something in the existing code contradicts this file or the build plan, stop and ask. Don't
  silently pick one.

## Known facts about the existing stack

Each fact lives in the README of the thing it describes; this is where to find them.

- **Shield and signing** (Shield only, the pinned adapter versions, the three ways in, fees, why
  nothing is a multi-program proof): `packages/wallet/README.md`.
- **The app's two builds** (website and static bundle, `.server.ts`, `api_base`, `canonicalPath`,
  the stack's versions): `apps/business/README.md`.
- **The packages and their layering**, the stablecoin's exclusion proof: `packages/README.md`.
- **Aleo limits and toolchain**: `docs/ALEO_CONSTRAINTS.md`; the explorer base and `--network 1`:
  `pnw_mvp_v2/CLAUDE.md` (Toolchain). The Leo programs: `pnw_mvp_v2/src/layer1`, `src/layer2`,
  `src/stubs`.
- **Security baseline**: `docs/THREAT_MODEL.md` (CI blocks on tests, build and `pnpm audit`
  moderate+; new dependencies are at least 7 days old, `minimumReleaseAge`).
- **What was retired and why** (the Julia tax service, four salvaged packages, the old portal and
  mailbox): `archive/README.md`. `packages/tax-engine` is the only tax engine.
- The double-pay item in `pnw_mvp_v2/docs/NOTES.md` is stale per Joshua; ignore it unless a test
  shows otherwise.
- Licence: **AGPL-3.0-only** since 2026-10-15 (Joshua), here and in `pnw_mvp_v2`; every package
  says so. The app and the site link to the source (`BRAND.sourceUrl`); keep that link. The Hewn
  name and logo are not licensed.
