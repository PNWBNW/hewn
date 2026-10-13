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

## 2026-10-13 — Security baseline

Greenlit by Joshua along with the ledger core (separate PR). #8 merged first (fd407e9).

- `docs/THREAT_MODEL.md`: assets, trust boundaries, threats T1–T8 with status per mitigation.
- **Dependencies: 47 advisories (3 critical, 19 high) → 0.** Next.js 16.1.6 → 16.3.8, jspdf 4.2.0 →
  4.2.1, vitest 4.1.0 → 4.1.11, all patch releases ≥13 days old. The zod advisory came from the
  Puzzle adaptor; gone with it (below).
- **Shield only** (Joshua): removed Puzzle, Leo, Fox and Soter adaptors from `@pnw/wallet` and
  their mobile-redirect branches. ETH stablecoin/wallet rails added to Deferred.
- **CSP** (`apps/business/src/security/headers.ts`, `src/proxy.ts`): per-request nonce,
  `'strict-dynamic'`, no unsafe-inline/eval in production, `connect-src 'self'`, no framing,
  `base-uri 'none'`; plus nosniff, no-referrer, DENY framing, COOP/CORP, HSTS,
  Permissions-Policy (camera, mic, geolocation, payment, etc. off). Pages now render per request
  so the nonce is fresh (`connection()` in the root layout); no data is rendered server-side.
  Verified in Chromium against `next start`: every framework script carries the nonce, the app
  hydrates and navigates with zero CSP violations, and an injected inline handler, a
  third-party iframe and a `fetch` to another origin are all refused.
- **CI** (`.github/workflows/ci.yml`, first CI for this repo): frozen-lockfile install, tests,
  build, `pnpm audit --audit-level=moderate`; read-only token, no secrets.
- **Dependabot** weekly for npm (minor/patch grouped; `@provablehq/*` excluded, pinned on purpose)
  and GitHub Actions.
- **`minimumReleaseAge: 10080`** in `pnpm-workspace.yaml`: no package version younger than 7 days.
- Fiat-boundary vocabulary check now ignores `crypto.` (the WebCrypto API).
- `salvage/salvage.py` is now historical: packages are owned here, don't re-run it.

**Results**
- `pnpm test`: 17 files, **168/168** (159 + 9 security-header tests).
- `pnpm build`: all green. `pnpm audit`: no known vulnerabilities.

**Follow-ups:** pin Actions to commit SHAs; lint rule banning `dangerouslySetInnerHTML` (none in
use today); signed installable builds before the first external user.
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
- Repo: 22 files, **206/206**. `pnpm build` green. After merging main (#9): 23 files, **215/215**, audit clean.

**Not done / next:** encrypted vault persistence for `Books` (Phase 1 deliverable 3), wiring the
shell's Transactions screen to it, events (close/reopen/lock) into the hash chain, opening
balances helper, `gl_core.aleo` (Leo, needs the Fable session switch). No exit criterion
ticked: they need the vault and `gl_core`.

## 2026-10-13 — Phase 1: encrypted vault + setup, unlock, and working Transactions

Greenlit by Joshua ("build the vault and setup screens").

- **`@pnw/vault`** (new, zero runtime deps, no network): envelope encryption. A random AES-256-GCM
  data key encrypts the books; a PBKDF2-SHA256 key (600k rounds, random 16-byte salt) from the
  passphrase only wraps it. Each ciphertext is bound to its vault id and role with AES-GCM
  associated data. Open data key is non-extractable and held in a private field; `lock()` drops it.
  `changePassphrase` re-wraps the key without re-encrypting the books (the same mechanism later
  gives a wallet unlock and Phase 6 per-member keys). Passphrases are NFKC-normalized, minimum 10
  characters. Backups are the sealed record (`.pnwbooks`); `IndexedDbStore` + `MemoryStore`.
- **`@pnw/ledger`**: `booksToJson` / `booksFromJson` (bigint-safe; loading re-verifies the hash
  chain, so a decrypted file edited outside the app is refused).
- **`apps/business`**:
  - `BooksProvider`: loads/locks/unlocks; every change runs a pure ledger op, then seals and saves
    before the screen updates; updates are serialized so quick edits never race. Auto-lock after
    15 idle minutes. A full page reload locks (by design: the key lives only in memory).
  - Setup (3 steps: business + fiscal year, starter chart or blank, passphrase with "no recovery"
    acknowledgement), Unlock, Restore-from-backup (warns before replacing local books).
  - Rail: Download a backup, Lock books. Top bar shows the business name.
  - Transactions: journal (newest first, void = reversal, "Voided by #n" badges, offers to date
    the reversal today if the original month is closed), chart of accounts (grouped by section,
    balances, add account, deactivate), new journal entry form (Save disabled until debits equal
    credits; difference shown live; customer/vendor name required on A/R/A/P lines).
  - Dashboard figures are real: cash, owed to you, you owe, profit this month; setup checklist
    ticks itself.

**Browser verification** (Chromium, phone viewport, production build, real CSP):
create+open 0.35–0.9 s with 600k rounds; stored record contains no business name, entries or
passphrase; an entry off by one cent can't be saved; void works; backup file has no plaintext;
wrong passphrase refused with a clear message; right one reopens with entries intact; after
deleting IndexedDB the backup restores all entries; a second, separate browser profile opens the
same books from the backup + passphrase; zero console or CSP errors.

**Exit criterion reworded and ticked (Joshua, 2026-10-13):** "…opens in a second browser with the
same passphrase, no wallet required" — met (above). The wallet half is now its own unchecked
criterion: once Shield is linked, either unlocks, and the passphrase always keeps working.

**Results:** 26 files, **236/236** (vault 18, ledger 50 incl. serialization). Build green, audit
clean. Lockfile regenerated under the 7-day rule (see below).

**Supply chain note:** main's lockfile held ~20 packages younger than 7 days (resolved in #9 just
before `minimumReleaseAge` landed; frozen installs don't re-check age). Regenerated cleanly so
every resolved version is ≥7 days old (e.g. dompurify 3.4.17 → 3.4.16, vite 8.3.4 → 8.3.3). Audit
still clean. Follow-up: a CI step that checks lockfile ages, since `--frozen-lockfile` doesn't.

## 2026-10-13 — Rename to Plumb, brand assets

Joshua renamed the product **Plumb** ("honest books, grounded and true.") and supplied the logo
(light + dark) and front-page hero. Build-plan decision "Product name" ticked.

- `brand/source/`: the three originals. `brand/build_assets.py` (Pillow) generates everything the
  app serves; `brand/README.md` lists outputs.
  - Favicon (16–64 px .ico), `icon.png` 512, `apple-icon.png` 180 (Next.js file conventions).
  - Manifest icons 192/512 + maskable 512 (art inside the 80% safe zone); `src/app/manifest.ts`
    makes Plumb installable to a home screen (theme `#113b31`, background `#f5f0e3`).
  - Mark tiles with transparent rounded corners; "Plumb" wordmark extracted to transparent PNGs
    in green (light mode) and cream (dark mode).
  - Hero: 1.9 MB PNG → WebP 768 (86 KB) / 1536 (263 KB) + JPEG fallback (301 KB).
- App: rail shows mark + cream wordmark; setup/unlock/restore show the full hero (never cropped,
  so the tagline stays; capped at 1100 px and edge-faded on wide screens) with mark + wordmark in
  the card; titles, metadata, `themeColor`, Apple web-app title all "Plumb".
- Theme: brand tokens `--plumb-green/cream/ink/gold/cyan` sampled from the art; primary is Plumb
  green, rail is Plumb ink, accent is the cone gold, light canvas warmed slightly toward the cream.
- Backups are now `.plumb` files. User-facing errors say Plumb. Internal names unchanged: `@pnw/*`
  packages, IndexedDB `pnw_ledger`, vault format `pnw-vault`, hash domain `PNW::GL::ENTRY::v1`
  (PNW stays the company/protocol namespace; renaming storage keys would only break stored data).
- Docs: CLAUDE.md, BUILD_PLAN.md, DESIGN_BRIEF.md, THREAT_MODEL.md titles; README opens with
  the hero and a short Plumb section.

**Verified in Chromium** (production build, real CSP): favicon/icon/apple-icon/manifest served
and linked; setup on phone, desktop and dark mode; dashboard rail logo; zero console/CSP errors.
**Results:** 236/236, build green.

**Flags for Joshua:** (1) the hero says "Free • Open source", but the licence is still the
proprietary PNW Smart Contract License v1.7 (CLAUDE.md: don't change it until after the build);
(2) the source icon is ~190 px, so 512 px icons are upscaled; a vector or ≥1024 px source would
sharpen them (drop it in `brand/source/` and re-run the script).

## 2026-10-13 — Product name in one place

"Plumb" turns out to be taken; it stays as the working name until Joshua picks the final one.
To make that rename a one-file change: `apps/business/src/brand.ts` now holds the name, tagline,
backup extension, colours and asset paths; layout metadata, page titles, manifest, logo/hero
components (renamed `BrandMark`/`BrandLogo`/`BrandHero`), restore screen and backup filename all
read from it. Package error messages no longer name the product ("…from this app"). Build-plan
"Product name" decision un-ticked with the rename recipe.

## 2026-10-13 — Phase 2 (fiat): payroll posts into the books

Joshua: "keep building" on the recommended next task (fiat payroll).

- **`@pnw/payroll`** (new; depends only on `@pnw/ledger` + `@pnw/tax-engine`):
  - Team: name, hourly rate or annual salary, pay frequency (weekly / every two weeks / twice a
    month / monthly), W-4 elections (filing status, Steps 3, 4a, 4b, 4c). Private to the vault.
  - Paychecks in bigint cents around the existing TS tax engine (IRS annualization): federal
    income tax, employee SS and Medicare, Additional Medicare above $200k, plus the employer's SS
    and Medicare match (employer doesn't match Additional Medicare). Year-to-date per worker.
  - **Bug found by the tests and fixed:** per-paycheck rounding let a year's Social Security
    reach $11,439.01, one cent over the legal maximum (6.2% × $184,500). Both sides are now capped
    at the annual maximum.
  - `postPayRun`: one balanced entry per paycheck (Dr Wages, Dr Employer Payroll Taxes, Cr Payroll
    Liabilities, Cr Bank), each line tagged with the employee, source `payroll` + run id. Pure: a
    closed month or any ledger rule rejects the whole run with nothing posted. Creates "Wages" /
    "Employer Payroll Taxes" accounts if a blank chart lacks them.
  - `liabilitiesByQuarter` (Form 941 buckets) and `recordTaxPayment` (new ledger source
    `tax_payment`: Dr Payroll Liabilities, Cr Bank).
- **App**: the vault now holds a company file (books + payroll); books saved by the previous
  version still open. Payroll section is live: Team (add/edit/deactivate, W-4 fields), Run payroll
  (pick people, hours, live per-paycheck preview, totals incl. total cost to you, post), Pay runs
  (expandable per-person breakdown), Withholding owed (owed now, by quarter, record a payment).
  Journal shows employee names from the vault. Dashboard checklist ticks on first payroll.

**Browser check** (phone viewport, production build): 3-person run (salary $52k biweekly; $25.50/hr
× 80.25 h; $30/hr × 72 h MFJ with $4,000 dependents credit): gross 6,206.38, withheld 792.66, net
5,413.72, employer taxes 474.79; 3 payroll entries in the journal; cash 25,000 → 19,586.28; owed
to IRS 1,267.45 → 0.00 after recording the payment; team intact after lock/unlock; zero
console/CSP errors.

**Exit criteria:** ticked "existing payroll tests still green" (coordinator 60/60 untouched). The
other Phase 2 criteria need the testnet run or reports (P&L / balance sheet, Phase 4).

**Results:** 29 files, **256/256** (payroll 18 incl. a 200-run property test). Build green.

## 2026-10-13 — Phase 4 (pulled ahead): financial statements

Profit and loss, balance sheet and trial balance, computed on the device from the vault.

- **`@pnw/ledger` `statements.ts`** (pure, bigint cents):
  - `profitAndLoss(books, range, compare?)`: Income, Cost of goods sold, Gross profit, Expenses,
    Net operating income, Other income, Other expenses, Net other income, Net income. Accounts nest
    under their nearest ancestor in the same section (parent keeps its own amount plus a rolled-up
    total), ordered by number then name, only accounts with something in a column. Amounts positive
    on the section's normal side (a refund or contra account shows negative).
  - `balanceSheet(books, asOf, compareTo?)`: Assets (current: bank / A/R / other current; fixed;
    other), Liabilities (current: credit cards / A/P / other current; long-term), Equity (equity
    accounts, Retained Earnings, and a "Net income" line for the fiscal year to date). Built on
    `trialBalance`, so the retained-earnings rollover is the same rule in both places.
  - `compareAccounts` (chart order) and `fiscalYearOf`. The app's chart of accounts now uses the
    same comparator: unnumbered accounts (the built-in ones) sort after numbered ones in each
    section, which is what the old `"~"` sort key intended but `localeCompare` didn't do.
- **Tests:** assets = liabilities + equity; BS Net income = P&L for fiscal YTD; Retained Earnings =
  P&L for prior years = the trial balance's rollover; comparison columns; nesting/order; and a
  300-run fast-check property over random entries across 2025–2026 with a random fiscal start
  month. **Phase 2 criterion** (in `packages/payroll`, since the ledger may not depend on payroll):
  a 3-person `postPayRun` shows Wages = total gross (6,206.38) and Employer Payroll Taxes on the
  P&L, Payroll Liabilities = withheld + employer taxes on the balance sheet, and a tax payment
  clears the liability without touching the P&L.
- **App `/reports`**: report picker (Profit and loss / Balance sheet / Trial balance); P&L presets
  (this month, last month, this quarter, year to date, last year — fiscal-year aware — or a custom
  range); balance sheet and trial balance "as of"; "Compare to" previous period / same period last
  year (balance sheet: end of previous month / same date last year). Statement table with section
  headings, indented sub-accounts, subtotals, bold totals, tabular right-aligned money; tables
  scroll inside their own frame. "Download CSV" of exactly the lines on screen (UTF-8 BOM, plain
  numbers, text cells that look like formulas are defused). Empty state with no entries.

**Browser check** (production build, 390×844 then 1280×900): Services books; journal entries
25,000 owner investment, 8,000 service income, 1,500 rent on the card, 3,000 income dated
2025-12-15; payroll for one salaried person ($52,000/yr biweekly). October P&L: income 8,000.00,
Rent 1,500.00, Payroll Expenses 2,153.00 (Wages 2,000.00 + employer taxes 153.00), net income
4,347.00. Balance sheet as of 2026-10-13: Checking 34,309.15 = 36,000 − net pay 1,690.85; card
1,500.00; Payroll Liabilities 462.15 (withheld 309.15 + 153.00); Owner's Investment 25,000.00,
Retained Earnings 3,000.00 (the 2025 income), Net income 4,347.00; total assets 34,309.15 = total
liabilities and equity. Trial balance 37,962.15 both sides. Comparisons and CSV download work; no
horizontal page scroll at 390px; zero console or CSP errors (one browser warning about the
`bluetooth` Permissions-Policy feature, from the existing security headers).

**Exit criteria:** ticked Phase 2 "P&L for the period shows the wage expense; balance sheet shows
the tax liability" (fiat mode). Phase 4's reconciliation criterion still needs the cash flow
statement.

**Results:** 32 files, **276/276** (ledger +10, payroll +2, business +8). Build green, audit clean.
## 2026-10-13 — Phase 3: customers, vendors, invoices, bills, payments

- **`@pnw/sales`** (new; depends only on `@pnw/ledger`): pure functions over a `Sales` object that
  lives in the vault next to the books.
  - Customers and vendors: name, optional email, terms (due on receipt / net 15 / 30 / 45 / 60,
    default net 30), active flag; vendors carry an optional 1099 flag.
  - Invoices: auto-numbered INV-0001…, due date from terms, lines (income account, quantity as a
    ≤2-dp decimal string multiplied in hundredths, unit price in cents, taxable flag), sales tax
    rate per invoice in basis points, tax rounded half-up once per invoice. Drafts post nothing and
    can be edited or deleted. **Sending** posts Dr A/R (customer) / Cr each income line / Cr Sales
    Tax Payable. Status is derived: draft, open, partially paid, paid, overdue, void. Void reverses
    the entry and is refused while any payment is applied.
  - Payments received: one payment across many invoices, partial allowed, applied ≤ each balance
    and ≤ amount received (any remainder is an unapplied customer credit). Dr bank (or Payments to
    Deposit), Cr A/R. Voidable; voiding reopens the invoices.
  - Bills post on save (Dr expense/asset lines, Cr A/P, all lines naming the vendor); bill
    payments (Dr A/P, Cr bank) across one or more bills; both voidable under the same rules.
  - `invoiceBalance`, `billBalance`, `customerBalance`, `vendorBalance`, `arAging` / `apAging`
    (Current, 1–30, 31–60, 61–90, 90+; as of a date), `salesTaxCollected(from, to)`,
    `suggestApplications` (oldest due first). `salesToJson` / `salesFromJson` (same `$c` scheme).
  - Every posting goes through `postEntry` / `reverseEntry`, so a closed month or inactive
    account rejects the whole operation with books and sales unchanged.
- **App**: the company file is now `{books, payroll, sales}`; files saved without sales open with
  an empty `Sales` (test added). Sales section: Invoices (A/R aging card, list with status badges;
  Send, Edit / Delete draft, Receive payment, Void), Customers, Payments received (form fills
  invoices oldest-first as you type the amount; Void). New invoice page: line grid, income-account
  select, taxable checkbox, tax rate %, live subtotal / tax / total, Save as draft / Save and send.
  Expenses section: Bills (A/P aging card, Pay, Void), Vendors (1099 flag), Bill payments; New bill
  page. Journal shows customer and vendor names; entries owned by an invoice, bill or payment
  point to Sales / Expenses for voiding instead of a bare Void (which would leave the form out of
  step with the books). Dashboard "Send your first invoice" ticks once an invoice is sent; its
  phase label is gone.
- **Fix found in the browser check:** table frames with `sr-only` header cells caused page-level
  horizontal scroll on phones (the absolutely positioned span escaped the scroll frame); those
  frames are now `relative`.

**Browser check** (production build, 390×844, light and dark): customer Acme Co; INV-0001 with
10 × 125.00 taxable + 40.00 mileage at 8.25% → subtotal 1,290.00, tax 103.13, total 1,393.13.
Sent → A/R 1,393.13, Sales Tax Payable 103.13 (dashboard and chart of accounts agree). Payment
500.00 → A/R 893.13, Partially paid, Checking 500.00. Payment 893.13 (prefilled) → A/R 0.00, Paid,
Checking 1,393.13. Vendor Paper Supply (1099); bill PS-1001, 123.45 supplies + 1,500.00 rent →
A/P 1,623.45; paid in full → A/P 0.00, Paid, Checking −230.32. Journal: 5 entries showing
customer/vendor names, no raw ids. No page-level horizontal scroll; zero console/CSP errors (one
existing Chromium warning about `bluetooth` in the Permissions-Policy header).

**Exit criteria:** ticked "Invoice → partial payment → final payment → paid, with AR balance correct
at each step" and "Bill → payment, with AP balance correct". Not yet: sales tax liability report
(`salesTaxCollected` is the data; no report screen), project profitability, public flag. Left for
later: estimates, batch entry, receipt images, dimensions, applying a customer credit to a later
invoice, editing a sent invoice (void and re-issue works today). "Send" records the invoice; it
doesn't email anything.

**Results:** 31 files, **292/292** (sales 35 incl. a 200-run property test; company file 3). Build
green, audit clean.

## 2026-10-13 — Phase 3 finished (fiat)

Estimates, dimensions (projects, classes, locations), project profitability, the sales tax
liability report and payments, 1099 amounts, and encrypted receipt files on bills.

- **`@pnw/ledger`**: new `dimensions.ts`. `Dimensions` (projects with optional customer and
  active/closed status; classes and locations with an active flag; all unlimited, unique names)
  lives in the vault as its own part of the company file. Journal lines carry only tag ids in the
  existing `Line.tags`, which were already in the entry hash, so the plaintext names never touch
  the books (this is the "dimension_hash + vault mapping" of deliverable 5). `cleanTags` drops
  blanks so untagged lines hash exactly as before. Reports: `linesTagged`,
  `profitAndLossForTag` (a normal P&L of only the tagged lines), `profitByTag` (income, COGS,
  expenses incl. payroll, profit, margin in basis points, plus a total). New `SourceKind`
  `"sales_tax_payment"`.
- **`@pnw/sales`**:
  - Estimates (`estimates.ts`): EST-0001…, expiry (default +30 days), invoice-style lines incl.
    taxable flag, tax rate and tags; draft / sent / accepted / declined / converted, "expired"
    derived from the date. Never post. `convertEstimateToInvoice` makes a draft invoice with the
    same lines, tags, tax and memo, linked both ways; converts once; declined can't convert;
    deleting that draft invoice hands the estimate back as accepted.
  - Invoice and bill lines take optional `tags`, carried onto the posted income / expense lines.
  - Bills keep `attachments: {attachmentId, sha256, type, size, name}[]` only (image/* or PDF,
    ≤ 10 MB); `attachToBill` / `detachFromBill` don't post.
  - `salesTaxReport(books, sales, from, to)` (`salestax.ts`): opening Sales Tax Payable, tax per
    invoice posted in the range, voided invoices, payments to the agency (voided payments count
    negative), other adjustments, owed at the end = Sales Tax Payable on the end date by
    construction. `recordSalesTaxPayment` posts Dr Sales Tax Payable / Cr bank.
    `paidToVendor` sums live bill payments in a range (1099s).
  - `salesFromJson` fills `estimates: []` for files saved before estimates.
- **`@pnw/payroll`**: `PayRunInput.lines[].tags` (optional); the paycheck keeps them and the wage
  and employer-tax lines carry them. Net pay and liability lines stay untagged. No change when
  absent (existing tests untouched and green).
- **`@pnw/vault`**: `VaultSession.sealAttachment` / `openAttachment` seal file bytes with the same
  non-extractable data key, AAD `pnw-vault:v1:attachment:<id>:<vault id>` (ids are
  `[A-Za-z0-9_-]`, so role and vault id can't shift into each other). `sha256Hex`. IndexedDB
  goes to version 2 with an `attachments` store (keyed `<vault>/<id>`, indexed by vault) created
  in an `oldVersion`-stepped upgrade; `replace(record, attachments)` swaps both in one
  transaction. Backup files are version 2 (`{format: "pnw-vault-backup", version: 2, record,
  attachments}`), still all ciphertext; version-1 files (the bare record) still restore.
- **App**:
  - Company file gains `dimensions`; older files open with empty lists (test).
  - Sales: Estimates tab (Edit, Mark sent, Accepted, Declined, Convert to invoice, Delete) and
    New estimate. Invoice and estimate share one editor component (`sales/DocumentForm.tsx`).
  - Project / class / location pickers (shown only for kinds that have entries) on invoice,
    estimate, bill and journal-entry lines, and one project per paycheck in Run payroll. The
    journal and pay-run breakdown show tag names.
  - Projects page: Projects tab (add / edit / close / reopen, customer, date range incl. All
    dates, income / costs / profit / margin per project and in total, each project's own P&L);
    Classes & locations tab (add, rename, deactivate, entry counts).
  - Reports: Project profitability (all projects, or one project's P&L with comparison) and
    Sales tax liability, both with CSV.
  - Taxes page: Sales tax (owed now, record a payment with agency and reference, the liability
    report with a tie-out line against Sales Tax Payable), Payroll tax (owed now, 941 quarters,
    link to Payroll → Withholding owed via `?tab=owed`), 1099s (flagged vendors, paid per year).
  - Receipts: attach a photo or PDF on a new bill or any existing bill (`capture="environment"`);
    sealed and stored the moment it's picked, dropped again if the bill isn't saved. Viewing
    decrypts to an object URL and checks the SHA-256 the bill holds; images inline
    (`img-src blob:`), PDFs via a download link, no frames. Backups include every sealed file;
    restore verifies each one opens before replacing anything.

**Browser check** (production build, 390×844, light; Projects also in dark): Contractor books.
Project "Kitchen remodel" for Acme Co. EST-0001: 1 × 6,000.00 taxable tagged to the project +
150.00 haul-away untagged at 8.25% → total 6,645.00; marked sent, accepted, converted → INV-0001
draft (estimate shows Converted · INV-0001), sent → A/R 6,645.00. Bill LY-2201 from Lumber Yard
(1099): 2,450.00 Job Materials tagged to the project, 48×32 PNG receipt attached and viewed
(blob URL, decoded 48×32), then paid. Payroll: Ana Ruiz, $30/hr weekly, 40 h tagged to the
project: gross 1,200.00, employer taxes 91.80. Project: income 6,000.00, costs 3,741.80
(2,450.00 materials + 1,200.00 wages + 91.80 employer taxes), profit 2,258.20, margin 37.6%,
same on Reports → Project profitability; checked by hand. Sales tax this quarter: collected
495.00, ties to Sales Tax Payable; payment of 495.00 to "State DOR" → owed 0.00, report still
ties. 1099s: Lumber Yard 2,450.00. Payroll tax owed 285.68. Backup downloaded (version 2, 1
attachment, no plaintext names in the file); database deleted from a fresh page, setup screen
shown, backup restored, the receipt opens (48×32) and the project figures are unchanged. No
page-level horizontal scroll; zero console or CSP errors (the existing Chromium warning about
`bluetooth` in Permissions-Policy). Fix found in the check: the receipt panel opened inside the
horizontally scrolled bills table and landed off-screen on a phone; it now sits below the table.

**Exit criteria:** ticked "Sales tax liability report ties to invoices for the period" and
"Project profitability report for a job with labor, materials and an invoice" (tests:
`packages/sales/src/salestax.test.ts`, `packages/sales/src/project_profit.test.ts`; payroll is a
test-only dev dependency of `@pnw/sales`, pinned by its boundary test). **Not ticked:** the
public/private flag criterion: it needs `gl_core.aleo` (an on-chain public mapping and a
circuit-level refusal for worker-linked entries), so it's deferred to the anchored/settled work.
**Deferred:** batch create (invoices) and batch entry (bills); the receipt hash isn't inside the
journal entry hash (files can be attached after posting; the bill record holds the SHA-256 and
it's checked on every open); applying a customer credit to a later invoice; emailing documents.

**Results:** 39 files, **352/352** (was 312: ledger +8, sales +17, payroll +1, vault +10,
business +4). Build green, `pnpm audit` clean. Lockfile changes only for the `@pnw/payroll`
dev-dependency link in `@pnw/sales`.
