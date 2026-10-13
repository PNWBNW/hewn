# CLAUDE.md — Plumb

Read this whole file at the start of every session, then follow **Session start** below.

## What this is

**Plumb** (formerly "PNW Ledger"): a clean-room, open-source rebuild of QuickBooks Advanced (minus AI and support features) on top of
Joshua Day's existing Aleo ZK payroll stack (PNW — Proven National Workers). Same mental model
bookkeepers already know, our own screens and code. Never copy QuickBooks screens, icons, text or
layouts; match what it *does*, not how it *looks*.

Three operating modes on one codebase: **fiat** (default, encrypted local vault, bank does the money),
**anchored** (same, plus period roots anchored on Aleo), **settled** (USDCx on Aleo, the existing payroll
stack). The double-entry core is identical in all three.

Brand: working name **Plumb** (taken; final name TBD by Joshua), tagline "honest books, grounded and
true." The name, tagline, colours and asset paths live only in `apps/business/src/brand.ts`; never
hard-code the product name elsewhere (packages say "this app"). Source art and the asset build
script live in `brand/`; never hand-edit the generated files in `apps/business/public/brand/`.
Internal package names stay `@pnw/*` (PNW is the company and protocol namespace).

`BUILD_PLAN.md` (repo root) is the spec: phases, deliverables, exit criteria. `PROGRESS.md` is the log.

## Session start

1. Read `BUILD_PLAN.md` and `PROGRESS.md`.
2. If `PROGRESS.md` does not exist, this is the first session: run **First session** below.
3. Otherwise: find the current phase (first phase with an unchecked exit criterion). Report to Joshua in
   10 lines or fewer: current phase, what's done, what's next, any blocker. Then propose **one** task
   aimed at **one** exit criterion, and wait for his go-ahead before writing code.

## First session (bootstrap)

1. Work on branch `monorepo` in `PNWBNW/pnw`. Create it if it doesn't exist.
2. Clone the source repos over **HTTPS** into a scratch dir (the `.gitmodules` URLs are SSH and fail here):
   - https://github.com/PNWBNW/pnw_employment_portal_v1 (Next.js portal, ~33k lines TS)
   - https://github.com/PNWBNW/pnw_mvp_v2 (Leo programs, adapters, scripts; has its own CLAUDE.md
     and docs/NOTES.md worth reading for on-chain detail)
3. Baseline: install the portal with **pnpm** using its `pnpm-lock.yaml` (`npm ci` fails — there is
   no package-lock) and run its vitest suite unchanged. Record pass/fail counts in `PROGRESS.md`.
4. Inspect `src/persistence/` in the portal (`draft_encryptor`, `key_provider`, `draft_integrity`,
   with tests). Report how much of the Phase 1 encrypted vault it already covers.
5. Create `PROGRESS.md` with the baseline results and the persistence findings.
6. Stop and report. Do not start scaffolding until Joshua says go.

## Non-negotiable rules

**Privacy floor**
- Anything tied to an individual — wages, withholdings, W-4 data, bank details, paystubs, worker
  address — is private in every mode and can never be made public. Enforce it in the circuit or the
  vault, not only the UI.
- No private data on any server, ever. No database. Plaintext lives in the browser session only.
- Public Aleo mappings hold only hashes, commitments and block heights. Never a plaintext amount,
  account name, memo or identity.
- Aggregates publish only as proofs, with a minimum group size (no single-worker inference).

**Keys and storage**
- Never commit private keys, view keys, `.env` files or seed phrases. Never print them in logs.
- The vault key is derived from the user's unlock secret: a passphrase in fiat mode (no wallet
  needed), or a Shield wallet signature over a domain-separated message once a wallet is linked. It
  is never stored in plaintext and never leaves the vault module. Scheme (`@pnw/vault`): a random
  AES-256-GCM data key encrypts the books; the unlock secret (PBKDF2-SHA256, 600k rounds) only wraps
  that key, so a wallet unlock or per-member access later just adds another wrapped copy.
- localStorage is not a book of record. Durable data goes in the encrypted IndexedDB vault.

**Boundaries**
- Every on-chain write is signed in the user's wallet through the `wallet` package's executor, so
  the wallet shows what is being signed. Program and transition names come from `pnw-adapter`
  (never hard-coded elsewhere). The CLI adapter / Path B (pasted private key) is legacy:
  it stays in `coordinator` for now so its tests keep running, but no new code or screen may use it,
  and it is removed when the coordinator tests are rewritten around the wallet path. Nothing calls `snarkos` or the SDK execute path directly.
- **Fiat first; chain is optional.** The whole product must work with no wallet, no network and no
  Aleo package loaded. The ledger core, vault, reports and fiat payroll never import `wallet`,
  `pnw-adapter`, `coordinator` or `records`; those are opt-in adapters for anchored/settled modes,
  loaded only after the user upgrades a business.
- Extension modules may never touch posting logic or the vault key.
- Mode upgrades (fiat → anchored → settled) are one-way, show exactly what goes on-chain, and require
  a second wallet signature after a review screen. Never flip a mode as a side effect.

**Leo programs**
- Deployed programs are immutable. Never edit a deployed program in place; ship a new version and a
  migration. `config/testnet.manifest.json` is the source of truth for what's live.
- Superseded program versions go to `programs/archive/`, unchanged.
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
  `@/src`, `@/components`, `@/app`). Monorepo is on Next.js 16.3.8 (security fixes). Wallet adaptors
  `@provablehq/aleo-wallet-adaptor-*` at `0.3.0-alpha.3` — pin exactly, expect breakage. **Shield is
  the only wallet**; don't add other adaptors. `@provablehq/sdk` 0.10.1.
- Security baseline: `docs/THREAT_MODEL.md`. CI blocks on tests, build and `pnpm audit` (moderate+).
  New dependencies must be at least 7 days old (`minimumReleaseAge`).
- Leo programs (Leo v4 syntax) live in `pnw_mvp_v2/src/layer1`, `src/layer2`, `src/stubs`.
- Shield wallet: `privateFee: false` is required on every `executeTransaction` or proof generation
  silently fails. Its browser WASM prover drops multi-program proofs, so payroll runs as four
  sequential transactions (verify → transfer → receipts → audit) rather than the monolithic
  `payroll_core_v2::execute_payroll`.
- USDCx `transfer_private` needs a Sealance Poseidon4 Merkle exclusion proof, tree depth 16, built
  client-side via `SealanceMerkleTree`.
- Explorer REST base is `https://api.explorer.provable.com/v2`; `snarkos developer execute/deploy`
  need `--network 1` for testnet.
- The double-pay item in `pnw_mvp_v2/docs/NOTES.md` is stale per Joshua; ignore it unless a test
  shows otherwise.
- The Julia tax service (`pnw_payroll_engine/`) is retired. The TypeScript engine
  (`src/lib/tax-engine.ts`) is the only tax engine.
- Current licence is proprietary (PNW Smart Contract License v1.7). Don't change it; it's revisited
  after the build.
