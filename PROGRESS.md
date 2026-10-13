# PNW Ledger — Progress Log

Dated entries, newest last. Detail lives here; chat reports stay short.

## 2026-10-13 — First session (bootstrap)

**Setup**
- `CLAUDE.md` and `BUILD_PLAN.md` committed to `main` (f33e92c).
- Branch `monorepo` created in `PNWBNW/pnw`.
- Source repos cloned over HTTPS into a scratch dir:
  - `pnw_employment_portal_v1` @ 909660e
  - `pnw_mvp_v2` @ 025ca88

**Portal baseline** (pnpm 10.28.0, `pnpm install --frozen-lockfile`, Node 22, `npx vitest run`, no changes)

| | Passed | Failed | Total |
|---|---|---|---|
| Test files | 14 | 2 | 16 |
| Tests | 160 | 5 | 165 |

Failures (all look like stale tests, not broken code — to confirm before salvage):
- `src/anchor/batch_anchor_finalizer.test.ts` — 4 tests. Test imports `buildCycleNftParams`, which
  `batch_anchor_finalizer.ts` no longer exports (removed in 1795ff2 "payroll UX fixes after first
  successful run"). Fails with `buildCycleNftParams is not a function`.
- `src/coordinator/settlement_coordinator.test.ts` — "passes correct WorkerPayArgs to adapter".
  Expects program `payroll_core.aleo`; adapter now maps to `payroll_core_v2.aleo`
  (`src/lib/pnw-adapter/layer1_adapter.ts:48`).

Phase 0 exit criterion 1 ("existing vitest suite passes inside the monorepo") needs these 5
resolved — fix the tests to match current code, or confirm the code regressed.

**`src/persistence/` vs the Phase 1 vault**

What exists (≈450 lines + 3 test files):
- `key_provider.ts` — `KeyProvider` interface (encrypt/decrypt) and `SessionKeyProvider`:
  AES-256-GCM, random 96-bit IV, non-extractable key, PBKDF2-SHA256 100k with fixed salt
  `PNW::DraftEncryption::v1`. Tested.
- `draft_encryptor.ts` — JSON ↔ encrypted envelope; plaintext metadata (employer addr, epoch, row
  count, timestamp) outside the blob for listing. Tested.
- `draft_integrity.ts` — BLAKE3 Merkle root over rows, bound to employer + epoch; tamper check on
  decrypt. Tested.
- `draft_store.ts` — IndexedDB `pnw_drafts` / store `drafts`, indexes by employer and epoch;
  save / load / list / delete / deleteAll. **No tests.**
- Only consumer: `app/(employer)/payroll/new/page.tsx` (payroll draft save/resume).

Coverage of Phase 1 deliverable 3, roughly **35–40%**:

| Vault requirement | Status |
|---|---|
| AES-256-GCM | ✅ done |
| IndexedDB storage | ✅ done, but payroll-draft-specific schema |
| Tamper detection | ✅ done (GCM tag + Merkle root) |
| Pluggable key source | ✅ `KeyProvider` interface is the right seam |
| Key from Shield wallet signature over a domain-separated message | ❌ derives from the **view key** in the session store. Needs a new `WalletSignatureKeyProvider`; see question below |
| Same wallet opens vault on any device | ⚠️ works today only because the view key is deterministic; must hold for the signature path too (signature must be deterministic, or wrap a random vault key) |
| General ledger vault (accounts, entries, customers, …) | ❌ schema is `PayrollTableRow[]` only |
| Export/import as one encrypted blob | ❌ |
| Optional IPFS pin via Pinata | ❌ not wired to persistence |
| Headless mode (local keypair + passphrase) | ❌ |
| Key never leaves vault module | ⚠️ view key lives in a Zustand session store outside the module |

Plan: extend, don't replace — keep `KeyProvider`, the envelope pattern and integrity hashing;
generalise the store schema; add a wallet-signature key provider, a passphrase provider for
headless mode, and export/import.

Also noted: 19 files still use `localStorage` (sent offers, per-agreement pay state, a
prefixed store). These need to move into the vault during Phase 1.

**Open questions for Joshua**
1. Vault key from a wallet signature: Aleo signatures are Schnorr-style with a random nonce, so the
   same message may sign differently each time — a key derived from it would not reopen the vault on
   a second device. Needs a test against Shield before Phase 1. If non-deterministic, fallback options
   are the view key (today's approach) or an unlock that uses the wallet's record-decrypt. Either way,
   recommend a random vault key wrapped by the wallet-derived key from day one (Phase 6 per-member
   wrapping needs it anyway).
2. The 5 stale tests: OK to update them to current code as part of Phase 0 salvage?

**Status:** stopped per First-session step 6. No scaffolding started.

## 2026-10-13 — Fix 5 stale portal tests (Phase 0, exit criterion 1 prep)

Approved by Joshua. Tests updated to match current code; no source changes.

- `src/anchor/batch_anchor_finalizer.test.ts`: dropped `buildCycleNftParams` (removed in 1795ff2).
  `serializeAnchorInputs` tests now check the 10-input deployed `mint_cycle_nft` signature
  (`[u8; 32]` arrays, `u32` periods, `u16` versions). Added cases for a supplied `doc_hash` and an
  empty manifest. `mintBatchAnchor` now expects `payroll_nfts_v2.aleo` and 10 inputs.
- `src/coordinator/settlement_coordinator.test.ts`: expects `payroll_core_v2.aleo`.

Result: **16/16 files, 166/166 tests passing** (was 160/165; net +1 test). No new lint errors
(4 pre-existing unused-var warnings).

Push access to `pnw_employment_portal_v1` was not granted in this session, so the change is kept as
`salvage/patches/pnw_employment_portal_v1/0001-fix-stale-anchor-and-coordinator-tests.patch`
(`git apply` from the portal root, at 909660e). It gets applied when the packages are salvaged into
the monorepo. The exit criterion itself stays unticked until the suite runs green *inside* the
monorepo.

## 2026-10-13 — Phase 0: salvage packages into the monorepo (exit criterion 1 ✅)

- Portal test fix also landed upstream as PNWBNW/pnw_employment_portal_v1#199.
- pnpm workspace at repo root (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
  root `vitest.config.ts` running every package as a project). Salvaged from portal @ 909660e +
  the #199 test fix, by `salvage/salvage.py` (re-runnable).
- **13 packages**: the 10 in the plan plus `config` and `wallet` (approved), plus `persistence`
  (has tests; it's the base of the Phase 1 vault). Layering in `packages/README.md`; the graph is
  acyclic.
- Moves needed to break the old `pnw-adapter → records → coordinator → records` cycle (no logic
  changes):
  - `credentials_manager`, `roster_credentials_manager`, `roster_tree_builder` (+test):
    pnw-adapter → coordinator. `anchor/batch_anchor_finalizer` (+test) → coordinator.
  - `components/payroll-table/{types,validation}` → `manifest/payroll-table/`.
  - `src/registry/*` → `records/registry/`.
  - Type-only blocks lifted from app stores: `WorkerRecord`, credential types +
    `CREDENTIAL_TYPE_LABELS`, `AuditRequest` → `records/types/`; `W4Data` → `w4-crypto/types/`;
    `PaystubReceipt` → `records/types/` (coordinator re-exports it).
- Hashing decision (Joshua): `commitments` keeps the portal's live `BLAKE3(domain || payload)`.
  The mvp_v2 copy (`domain || 0x00 || payload`) has diverged and is not used. Any separator fix
  goes into a new versioned domain for `gl_core`, not a retrofit.
- External deps pinned to the exact versions resolved in the portal lockfile.

**Results**
- `pnpm build` (strict `tsc --noEmit` per package): 13/13 clean.
- `pnpm test`: **15 files, 156/156 passing**: commitments 12, coordinator 60, manifest 47,
  persistence 17, records 7, wallet 13. The other 10 portal tests are `audit/audit_actions.test`,
  which depends on the app-side audit store and moves with `apps/business`.
- No tests exist upstream for: config, tax-engine, pnw-adapter (beyond the moved roster test),
  handshake, w4-crypto, nft-art, pdf.

**Follow-ups noted, not done**
- `pnw_mvp_v2/portal/src/commitments` should be marked divergent or deleted there.
- ~~Wallet executor bypasses `pnw-adapter`~~ — resolved 2026-10-13: Joshua confirmed the wallet
  is the intended execution path (the wallet shows what is signed). CLAUDE.md and BUILD_PLAN.md
  rules updated to match. Same day: Joshua dropped the private-key fallback entirely (no Path B).
  Removal would mean rewriting most coordinator tests, so per Joshua the fallback code stays for
  now (unused by new code); removal waits for the wallet-path test rewrite.
- Decision 2026-10-13: fiat is the primary product; chain rails are optional. CLAUDE.md now says the
  fiat path never imports `wallet`/`pnw-adapter`/`coordinator`/`records`, and the vault key comes
  from a passphrase in fiat mode (wallet signature only once a wallet is linked).
- Package typecheck excludes test files; `persistence` tests have 2 pre-existing type errors
  (fixture `hours_worked` optional vs required), same as in the portal.
- `apps/`, `programs/` and `programs/archive/` not created yet; that's the next criterion's work.

## 2026-10-13 — Phase 0: business shell (deliverables 1 and 3, fiat-first)

Greenlit by Joshua. PR #7 and portal #199 merged first (merge commits 4fa4d2a, ef1210a).

- `packages/ui`: the portal's 12 `components/ui` primitives (no Radix; React + cva only) plus
  `utils.cn`, and `tokens.css`: PNW brand primitives, light/dark semantic tokens, rail and money
  tokens. Base styles sit in `@layer base` so utilities can override them. Tabs' active state now
  uses `bg-card` (more visible on the new canvas).
- `apps/business`: Next.js 16.1.6 / React 19.2.3 / Tailwind 4, statically rendered. Dashboard
  plus 7 sections (Transactions, Sales, Expenses, Payroll, Projects, Reports, Taxes) driven from
  one config, `src/shell/sections.ts`: tabs, columns, empty-state copy, primary action, and the
  phase that makes it real. Actions are shown disabled with "Arrives in phase N". No data, no
  storage, no network.
- Desktop: fixed rail. Phone: drawer behind a menu button (closes on navigate/Escape), 44px
  targets, no page-level sideways scroll (checked at 390px: scrollWidth 390). Light and dark
  checked by screenshot.
- `apps/business/src/fiat_boundary.test.ts`: fails the build if the app depends on or imports
  `@pnw/wallet`, `@pnw/pnw-adapter`, `@pnw/coordinator`, `@pnw/records`, `@provablehq/*` or
  `aleo-adapters`, or if source contains chain vocabulary (blockchain, Aleo, on-chain, crypto,
  wallet, USDCx, fiat, token, NFT). Verified it fails on a planted probe file.
- `docs/DESIGN_BRIEF.md`: clean-room brief for the shell (principles, layout, list/detail and
  transaction-form patterns, tokens).
- Fixed a regression from PR #7: root `vitest.config.ts` projects glob matched
  `packages/README.md`, so `pnpm test` on main failed at startup. Now globs the config files.

**Results**
- `pnpm test`: 16 files, **159/159** (156 package tests + 3 fiat-boundary).
- `pnpm build`: 14 packages typecheck clean; `next build` for `apps/business` OK (10 static pages).

**Not done / next**
- No exit criterion ticked: criteria 2–3 (testnet payroll, worker paystub) are chain work and
  wait until the fiat flow exists, per Joshua's fiat-first call. Criterion 4 (archive old portal)
  waits for `apps/worker`.
- `apps/worker`, `programs/` + `programs/archive/`, and deleting the Julia engine are still open
  Phase 0 deliverables.

## 2026-10-13 — Phase 1 (pulled ahead): fiat ledger core, `@pnw/ledger`

Greenlit by Joshua (with the security baseline, PR #9). Phase 1 runs ahead of the rest of
Phase 0 by his fiat-first call; nothing in Phase 0 is skipped. Design follows how QuickBooks
*behaves* (account types, system accounts, inactive-not-deleted, automatic retained earnings,
Opening Balance Equity, names on A/R and A/P) with two deliberate differences: the journal is
append-only, and closed periods are enforced, not password-overridable.

- `accounts.ts`: 15 account types mapped to the 5 base types and normal sides; 7 system
  accounts created with the books; sub-accounts up to 5 levels, same base type, no cycles;
  unique names (per parent) and numbers.
- `books.ts`: pure functions over a plain `Books` object. `postEntry`, `reverseEntry`,
  `editEntry` (reverse + linked replacement), `deactivateAccount` (only when empty),
  `closeThrough` / `reopenFrom` (logged) / `lockThrough` (permanent).
- `hash.ts`: each entry hash-chains to the previous; BLAKE3 over a fixed-position canonical
  encoding, domain `PNW::GL::ENTRY::v1` with the 0x00 separator (new versioned domain, per the
  earlier hashing decision). `verifyChain` catches changed, deleted, reordered or re-hashed entries.
- `reports.ts`: trial balance with automatic Retained Earnings rollover (any fiscal-year start),
  net income, normal-side display balances.
- `templates.ts`: service, contractor, retail starter charts.
- `money.ts`: `bigint` cents; strict parser; floats rejected at posting.
- Boundary test: the ledger may depend on `@noble/hashes` only.

**Results**
- `@pnw/ledger`: 47 tests, including negative tests for every rule and 4 fast-check property
  tests (~950 random runs: random balanced entries always post and the TB balances; off by one
  cent is always rejected; reversing everything zeroes every balance; any tampered amount is
  detected). Mutation check: disabling the balance rule fails 3 tests; disabling the locked-period
  reversal rule fails 1.
- Repo: 22 files, **206/206**. `pnpm build` green.

**Not done / next:** encrypted vault persistence for `Books` (Phase 1 deliverable 3), wiring the
shell's Transactions screen to it, events (close/reopen/lock) into the hash chain, opening
balances helper, `gl_core.aleo` (Leo, needs the Fable session switch). No exit criterion
ticked: they need the vault and `gl_core`.
