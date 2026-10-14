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

## 2026-10-14 — Integration audit (read-only)

Joshua's call after Phase 3 and the first Vercel deploy: before tying the new app to the chain
stack, comb through both and decide what ties in, what has to be redone, and in what order.
Four parallel read-only passes (portal employer side, portal worker side, `pnw_mvp_v2` programs
and manifest, this monorepo) feed `docs/INTEGRATION_AUDIT.md`. No code changed.

**Headlines.** The seam is narrow: the books already hold more than the chain can store (the
per-tax breakdown), and the chain already produces the proof the books need (receipt anchor,
tx id, height), so a pay run is posted first, settled second, and the anchor is written back onto
the entry. What has to be redone: the coordinator's run model (localStorage manifest, Zustand
callbacks, required CLI path), five regex record parsers, the Pinata/IPFS server routes (W-4,
terms, timesheet), and three different employer-name hashes. One decision blocks the payroll
bridge: the portal code runs the monolithic `execute_payroll` (`USE_MONOLITHIC_PAYROLL = true`)
while CLAUDE.md and BUILD_PLAN say the 4-step split; Joshua to confirm which works in Shield.
Product direction recorded from the same conversation: no bank feeds or card processors; money
that moves through the app moves on the rail; the books still work with no wallet.

**Results:** 39 files, **352/352** (the one "failed to load" an auditor saw was a stale local
`node_modules` missing the `@pnw/payroll` link; a frozen reinstall fixed it). No build change.

## 2026-10-14 — Aleo constraints check

Joshua asked for a deep dive confirming the settlement design against today's Aleo, since his
batched-payroll attempts in April hit boundaries. `docs/ALEO_CONSTRAINTS.md` records what was
confirmed from snarkVM source and release notes versus what the first testnet run must verify.
Headlines: Shield proves through Provable's delegated proving service, which only accepts
single-call functions, which is why the one-shot `execute_payroll` never reached the network and
the 4-step split did; every user-signed transition is now designed single-call, fired in parallel
after pre-splitting USDCx with the stablecoin's own `split`/`join` (plain transitions the local stub
never had). Hard limits (31 transitions, 16 in/out, 512 finalize ops, 4-credit finalize cap) were
not the problem. Toolchain drift: Leo 4.0.0→4.4.5, snarkOS 4.6→4.12, consensus V14→V22, SDK
0.10.1→0.12.1 (V2 proofs no longer verify after V21). `@admin` programs are upgradable in place,
so `paid_epoch` moves into an upgraded `paystub_receipts`. Every private USDCx transfer emits a
`ComplianceRecord` to the stablecoin's investigator; noted for the threat model. Audit doc updated
with the decisions from the same conversation (rail-only money movement, mailbox kept as the one
server piece, `.hewn` display suffix, one pay queue for workers, subs and vendors).

**Design decisions, same day (Joshua):** rail + books + mailbox. One `transfer_private` per
payee is the only on-chain act per payment; the full paystub goes through the mailbox; the
paystub hash sits in the journal entry's `source.ref` and the period root is anchored by
`gl_core.aleo`, so proof covers paystubs, vendor payments and invoices alike. `paystub_receipts`
and `payroll_core_v2` leave the payment path. Fees: the employer pays network fees on every
payment at actual cost (read back from the confirmed transaction), nothing deducted from the
payee, no platform fee ever. A 10-worker run is 10 wallet taps, then nothing to babysit. Both
docs updated; the Leo session shrinks to the toolchain bump and `gl_core.aleo`.

## 2026-10-14 — Link Shield and import the on-chain team (Phase 0 part: the app knows who is on-chain)

Audit §6 tasks 2 and 3, offline-verifiable half. A business can now link its Shield account
from a new Settings page and pull its team agreements into the books; nothing is sent on-chain.

**Opt-in adaptor area.** `apps/business/src/chain/` is the only place in the app that may import
`@pnw/wallet`, `@pnw/records`, `@pnw/config`, `@pnw/commitments` or `@provablehq/*`, or use chain
vocabulary. Settings reaches it only through `next/dynamic` (`ssr: false`), so the chunk is fetched
on the first tap of Connect or Import and never before. `fiat_boundary.test.ts` now enforces exactly
that: no static `import`/`from` of a chain package or of `@/chain/` outside `src/chain/**`; the
vocabulary check skips `src/chain/**` and tests; the packages may be declared in `package.json`.
Verified in Chromium at 390×844 and 1280×800: the dashboard and Settings load 10 scripts, none
carrying a rail string (`api.explorer.provable.com`, `employer_agreement_v4.aleo`, `shield.app`);
exactly one chunk with those strings arrives after Connect; no console errors, no CSP violations.

**Company file.** New optional `rail` part (`src/books/rail.ts`): account, network, linked date,
registered business name and its hash, the signed link proof, and `links[]` of `workerId →
{address, nameHash, agreementId}` (deduped by worker). `companyToJson` writes it only when present;
every older file still opens. `BooksProvider` exposes `rail`; `updateCompany` covers writes.

**Settings page** (`/settings`, in the rail's bottom group): Business card (name, fiscal year),
Private payments card. Unlinked: one paragraph and **Connect Shield**. Linked: short account with
copy, `name.hewn` (suffix from `BRAND.nameSuffix`), linked date, team count, **Import team**,
**Unlink** (confirm dialog; drops `rail` and its links). Words on the page: Shield, rail, account,
private payments; nothing else.

**`src/chain/RailPanel.tsx`.** Connect: Shield only, no picker modal; states not detected /
connecting / connected; then "Link this account to <business>?", `signMessage` over
`hewn:link:v1\n<vault id>\n<address>\n<ISO time>` (prefix in `BRAND.railLinkDomain`), best-effort
registered-name lookup, save. Import: `scanAgreementRecords` → one row per `FinalAgreement`
(`name.hewn` or short address, short agreement id) with "Link to…" (existing active worker) or
"Add to team" (opens `WorkerForm` pre-filled with the name; the worker and the link save in one
`updateCompany`), or "Linked ✓". Refuses to import when Shield is on a different account than the
linked one. No address or signature is ever logged.

**Package fixes.** `@pnw/records` `agreement_reader`: `display_name` is the bare registered name
(suffix is the app's choice) or undefined; names resolve in parallel (`Promise.allSettled`); the
localStorage fallback `readAgreementRecords` and `StoredOffer` are gone, along with their only
callers, the view-key `buildRosterTree` / `acquireRosterCredentials` in `coordinator` (dead legacy
path; the manifest-based pair stays). `@pnw/wallet` provider builds its program list from
`PROGRAMS` (every layer1, layer2 and external id, credits first, leaves before importers; the
legacy v1/v2 literals are dropped) and no longer imports the react-ui picker modal or its
stylesheet, which `@import`s a Google font and so broke the lazy chunk under the strict CSP;
`@provablehq/aleo-wallet-adaptor-react-ui` is removed from the package. CSP `connect-src` gains
`EXPLORER_ORIGIN` (`https://api.explorer.provable.com`), the one host in the policy; the default
mode never calls it. Threat model note updated.

**Deferred.** Phase 1's "vault opens with passphrase or linked wallet" is not touched: deriving a
vault-wrapping secret from a Shield signature needs the signature to be deterministic for a fixed
message, and whether Shield's `signMessage` is (and stays) deterministic across versions is
unresolved. The link proof is stored so a later session can test exactly that. Also deferred:
unlinking individual workers, re-scanning for status changes, and a vendor/customer account link.

**Results:** 41 files, **361/361** (was 352: records +4, business +5). Build green, `pnpm audit`
clean. Lockfile: four workspace links added to the app, one package removed from `@pnw/wallet`.
## 2026-10-14 — Phase 2: settlement fields and the paystub document

Task from the integration audit's proposed order: make the fiat/rail parity criterion true and
tested, offline, with no wallet. Branch `payroll/settlement-fields`.

- **`@pnw/ledger`**: an entry's `source` can carry `doc`, the hex BLAKE3 of the document the
  entry commits to (validated: 64 lower-case hex, new error code `BAD_DOC`). The canonical form
  is versioned: `[1, …]` exactly as before when there's no document, `[2, …, doc]` with the hash
  appended when there is, so `hashEntry`/`verifyChain` verify every existing books file unchanged
  (`documents.test.ts` pins a v1 fixture with its five hashes). Edits keep the document on the
  replacement; reversals never copy it.
- **`@pnw/payroll`**:
  - `paystub.ts`: the paystub document (version, business, worker, dates, pay type/rate/hours,
    every tax line, net, year-to-date gross and withholding after the check, run id, position)
    and `paystubHash` = BLAKE3(`PNW::PAYSTUB::v1` ‖ 0x00 ‖ canonical JSON, fixed key order,
    bigints as strings). Deterministic; a cent off changes it. `@noble/hashes` added at the
    ledger's pin; boundary test allow-list extended.
  - `PayRun.mode` (`"external"` | `"rail"`), `Paycheck.paystubHash` and `Paycheck.settlement`
    (`pending` | `settled` | `failed`, with reference, height, settledAt, failure). External runs
    settle as they post, with an optional free-text payment reference on every paycheck; rail
    runs post pending with no reference (giving one is refused). `postPayRun` puts the paystub
    hash in each entry's `source.doc` and takes an optional clock. `markPaycheckSettlement` for
    the pay queue: pending → settled/failed, failed → pending; settled never changes.
  - Older payroll files load: runs without the fields become external + settled, no reference,
    no paystub hash (`paystubHash` is optional on the type for that reason; new runs always have
    it). `YearToDate` gained `withheld`. `computePaycheck`/`previewPayRun` return a
    `PaycheckDraft` (no settlement or hash yet).
  - **Parity test** (`packages/payroll/src/parity.test.ts`, "posts identical entries, differing
    only in the account the net pay is credited from"): the same 3-person run posted twice from
    the same books, once external from Checking with a bank reference, once rail from a "Rail
    balance" bank account. Every entry matches line for line (accounts, debits, credits, names,
    tags, memo, date, `source` incl. `doc`) with only the net-pay credit's account differing;
    `hash`/`prevHash` are left out of the comparison since they're computed over that account.
    Paystub hashes are identical per worker and equal each entry's `source.doc`. Settling the
    rail paychecks afterwards changes neither the entries nor the paystubs.
- **App**: Run payroll gains "Payment reference" (optional, shown on each paystub); this screen
  always posts `mode: "external"`. Pay runs show "Paid · Ref. …" (or "Settling… n of m" /
  "n failed" for rail runs, render only). Expanding a run → "View paystub" per person →
  `Paystub.tsx` renders the document in plain words below the table (business, person, period,
  pay, every line, net, "Paid: <reference>" or "by bank", employer taxes, year to date, footer
  "Paystub reference: <first 8 of the hash>"). No chain vocabulary; fiat boundary test green.

**Browser check** (production build, Chromium 390×844): Services template, hourly worker Ana
Ruiz at $30/hr, 40 h, reference "ACH batch 4471": gross 1,200.00, federal 60.15, SS 74.40,
Medicare 17.40, net 1,048.05, employer taxes 91.80; the run card reads "Paid · Ref. ACH batch
4471"; the paystub shows the reference and year-to-date 1,200.00 / 151.95; one payroll entry in
the journal. Zero console or CSP errors (only the existing `bluetooth` Permissions-Policy
warning). Fix found in the check: a screen-reader-only table header (position: absolute) escaped
the table's scroll container and widened the page to 577px; it's visible text now and nothing
overflows on any of the four screens.

**Exit criteria:** ticked "Running the same payroll in fiat mode produces identical entries in
the vault, minus the chain transfer". **Deferred:** the pay queue that creates rail runs and calls
`markPaycheckSettlement`; a PDF of the paystub; the worker-side copy through the mailbox.
Same-day second runs for one worker still compute year-to-date before the day (pre-existing).

**Results:** 42 files, **369/369** (was 352: ledger +6, payroll +11). Build green, `pnpm audit`
clean, typecheck clean. Lockfile: `@noble/hashes` linked into `@pnw/payroll` only.

## 2026-10-14 — The mailbox: envelope, client and the stateless function

Audit §4.4 decision built as a package and a function; wiring into offers, W-4 and paystubs is a
later task. Branch `mailbox/package`.

- **`@pnw/mailbox`** (new; `@noble/hashes` 2.0.1 only, WebCrypto, no React, no workspace deps;
  boundary test: network only in `client.ts`).
  - `envelope.ts`: `deriveMailboxKey(partiesKey, kind)` = HKDF-SHA256(ikm = `parties_key`,
    salt `PNW::MAILBOX::v1`, info = kind) → AES-256-GCM, non-extractable. `lookupId(partiesKey,
    kind, seq)` = hex BLAKE3(`PNW::MAILBOX::LOOKUP::v1` ‖ 0x00 ‖ key ‖ kind ‖ u32be(seq)); both
    parties compute it alone, the receiver scans seq until a miss. `seal` → `{lookup, envelope}`
    with envelope = 0x01 ‖ 12-byte IV ‖ AES-GCM(payload, AAD = lookup); `open` throws
    `MailboxError` `BAD_ENVELOPE` / `BAD_VERSION` / `TAMPERED` on anything but the exact key, kind,
    seq and bytes. `MAX_PAYLOAD_BYTES` 256 KiB on seal and open. `KINDS`: terms, w4, paystub,
    payment_note. `partiesKeyFromHex` takes the handshake's `0x…` hex. Tests pin five lookup
    vectors and one sealed envelope, so neither derivation can change silently.
  - `client.ts`: `MailboxClient` (`put` POST octet-stream, `get` 404 → null, `drop` DELETE,
    404 → done) over `/api/mailbox` by default; lookup checked against `^[0-9a-f]{64}$` before
    any request; injected fetch; 503 → `NOT_CONFIGURED`, 409 → `CONFLICT`.
- **The function** `apps/business/src/app/api/mailbox/[lookup]/route.ts` (POST, GET, DELETE),
  logic in `../handlers.ts` over a four-call `PinStore` interface, Pinata behind it in
  `../pinata.ts` (legacy pinning API: pinFileToIPFS / pinList by name / unpin; gateway reads).
  `PINATA_JWT` read from `process.env` at request time; unset → 503 `{error:"mailbox not
  configured"}` on every method. Lookup not 64 hex → 400; body not octet-stream → 415; over
  `MAX_ENVELOPE_BYTES` (256 KiB + 64) by declared or actual length → 413 (body read through a
  capped stream, never buffered past the cap); first byte not 0x01 or shorter than one envelope →
  400; slot already pinned → 409; pinning service failure → 502 with no detail. `name = lookup`
  is the only pin metadata. `Cache-Control: no-store` on every response, no CORS headers, no
  logging. Optional `PINATA_GATEWAY` for a dedicated gateway host.
- **Docs:** `THREAT_MODEL.md` "The mailbox" (what the function sees and cannot, ciphertext in
  flight only, delivery is not proof); `apps/business/.env.example` (new, the two variables);
  `packages/README.md` row. `@pnw/mailbox` added to the app's deps and `transpilePackages`.

**Verified:** root `pnpm test` **428/428** in 50 files (was 378/44: mailbox +29, business +21,
fiat boundary still green with the route outside `src/chain`); `@pnw/business` build and typecheck
green; `pnpm audit` clean; lockfile changed only by the two workspace links. `next start` + curl:
GET/POST/DELETE → 503 JSON with `PINATA_JWT` unset; with a placeholder key, `/api/mailbox/nope` →
400, JSON body → 415, wrong first byte → 400, 270,001 bytes → 413, PUT → 405. Not exercised
against a live Pinata account (no key in this session).

**Decided:** the 503 check runs before the lookup check, so an unconfigured host answers 503 to
everything (the brief's literal rule); `open` caps the envelope at payload + 29 bytes while the
function allows + 64. **Deferred:** wiring into offers, W-4, paystubs and payment notes; the
seq-scan bookkeeping in the vault; dropping the pin after the receiver's vault has the copy.
## 2026-10-14 — The pay queue: settling a pay run on the rail (one transfer per payee)

The prerequisite for the first settled run from this app (Phase 0 testnet-run criterion / Phase 2
criterion 1). Design as fixed in `ALEO_CONSTRAINTS.md` §5 and `INTEGRATION_AUDIT.md` §2.2: per
payee one `test_usdcx_stablecoin.aleo::transfer_private`, records pre-split with the stablecoin's
own `split`, everything fired at once, resumable from the vault, the employer pays the actual
network fee, no receipts program, no per-run anchor. Branch `rail/pay-queue`. Nothing sent to
testnet yet; that run ticks the criteria.

- **`packages/rail` (`@pnw/rail`, new).** Pure settlement logic with the wallet (`RailWallet`:
  address, `requestRecords`, `executeTransaction`, `transactionStatus`), the network
  (`RailNetwork.fetchJson` over `ENV.ALEO_ENDPOINT`) and time injected, so every path runs under
  test with fakes. No React, no storage, never logs an address, record or signature.
  - `records.ts`: `Token` plaintexts → `{plaintext, amount}` (unspent only), balance, cents ×
    10,000 = minor units.
  - `plan.ts`: `planTransfers`: exact-fit first, then largest payee takes the smallest record that
    covers it, but only when there are at least as many free records as payees; otherwise the
    rest are carved out of the biggest free record with one `split(token, amount)` per payee,
    each spending the previous remainder, change kept as one record. Fails before anything is
    signed on a short balance or when no single record covers a payee ("combine records first";
    `join` is not planned yet). Deterministic; 10 tests incl. "one big record, five payees".
  - `exclusion.ts`: the freeze list from `test_usdcx_freezelist.aleo` mappings
    (`freeze_list_count[1u8]`, `freeze_list[iu32]`), `SealanceMerkleTree` depth 16, two sibling
    paths, `formatMerkleProof`, exactly the coordinator's recipe. Built **once per run**. The SDK's
    tree runs in Node, so the tests use the real one (shape pinned by regex) plus a fake that
    pins the call order.
  - `confirm.ts`: `GET transaction/<id>` → actual fee = sum of the fee transition's `u64` inputs
    (base + priority, `fee_public` or `fee_private`), height from `block_height`/`blockHeight`/
    `height`/`block.header.metadata.height`, else `find/blockHash` + `block/<hash>`; tolerant of
    the transaction being wrapped under `transaction`; a `rejected`/`aborted` status throws.
    Fixture `src/fixtures/transaction.json` is the snarkVM execute-transaction shape with the E10
    USDCx transfer's id and a 51,580-microcredit `fee_public` (the explorer was unreachable from
    the build container, so the shape is from snarkVM, not a live fetch: **verify on testnet**).
  - `queue.ts`: `runPayQueue(ctx)`: plan → one proof → splits in order (each waits for the
    wallet to show both outputs) → every `transfer_private` at once (`Promise.allSettled`),
    inputs `[recipient, "<minor>u128", token plaintext, proof]`, `privateFee: false`, no `fee`
    (the wallet estimates) → poll `transactionStatus` 2 s → 10 s, 15-minute cap, until an `at1…`
    id and accepted/finalized/confirmed, or rejected/failed → confirm on the explorer (3-minute
    window; if the explorer is slow the wallet's word settles it without a fee) → `settled
    {workerId, transactionId, height, feeMicrocredits}` or `failed {workerId, failure}`. Takes
    whatever is still pending or failed, so calling it again resumes; a failed split fails only
    the payees that depended on it. 8 tests with a fake Shield that answers out of order, rejects
    one, mints split outputs; a resume test; one proof for N transfers.
- **`@pnw/payroll`**: `Settlement.feeMicrocredits?: bigint` (JSON as a decimal string, not
  `{$c}`); `markPaycheckSettlement` validates it and now also allows **pending → pending with a
  reference**: the wallet's id for a sent transfer is written to the paycheck the moment Shield
  takes it, so a reload mid-run watches that id instead of paying twice (decision not in the
  brief). `checkDoublePay(payroll, {payDate, lines})`: same person + date + gross with a settled
  or pending paycheck = `blocked`; any other same-day paycheck (different amount, a failed one,
  hours not entered yet) = `sameDay`; the two tiers of the old on-chain guard, now offline over
  the vault. `ensureRailAccount(books)`: the bank-type "Rail balance" account, found by name or
  created. **Year-to-date fix**: `yearToDate(payroll, workerId, payDate, beforeRun?)` counts runs
  posted before `beforeRun` (all of them for the next run) with a pay date up to and including
  `payDate`, so a second run the same day sees the first, and rebuilding a paystub later sees
  exactly what posting saw (tested, including a backdated later run). Callers pass the run id
  when rebuilding. 12 new tests (`settlement.test.ts`).
- **App.** Run payroll: with Shield linked, "Paid from" offers "Rail balance (private rail)"
  first (and defaults to it); choosing it posts `mode: "rail"` from `ensureRailAccount`, hides
  "Payment reference", and keeps anyone without a link out with "Link on the rail first:
  Settings → Import team". `checkDoublePay` runs before posting: blocked → error naming them;
  same day → "Already paid on <date>" dialog with Post anyway / Go back. A rail run lands on
  `/payroll?pay=<run>` with its pay panel open. **`src/chain/PayPanel.tsx`** (lazy, like
  RailPanel; `useShield` moved to `src/chain/shield.ts`, `ShieldStatus` to its own file):
  refuses a Shield account other than the linked one, shows the balance on the rail against the
  run's net, lists everyone with Waiting / Approve in Shield / Sent / Settled · at1… / Failed ·
  reason (Retry), **Pay now** or **Continue**, and writes each outcome through
  `updateCompany` + `markPaycheckSettlement` as it happens. Pay runs list: rail runs still to
  pay get a Continue (something pending) or Retry (only failures) button; settled rail paychecks'
  paystubs read "Paid: On the rail · at1yphn8n…9ltw" and "Network fee: 0.051580 credits, paid by
  employer". Rail ids are not shown on the run card (they were overflowing the phone width).
  Fiat path untouched: no rail linked, no change on any screen; boundary test green with
  `@pnw/rail` added to the chain list.
- **CSP.** The SDK's Poseidon hashing is WebAssembly, which the strict CSP refused
  (`WebAssembly.instantiate … 'unsafe-eval'`). `script-src` gains `'wasm-unsafe-eval'` (WASM
  compilation only; JS eval stays refused). Test and `THREAT_MODEL.md` updated.
- **`packages/coordinator` deleted.** Its wallet path is replaced by `@pnw/rail`, its CLI path
  was legacy, its double-pay tiers are ported; nothing imported it. Also gone with it:
  `receipt_reconciler`, `batch_anchor_finalizer`, the credentials/roster managers.
  `packages/README.md` and CLAUDE.md's boundary lines updated; `manifest`, `pnw-adapter`,
  `records` untouched. BUILD_PLAN.md's historical mentions left as they are.

**Browser check** (production build, Chromium 390×844, `window.shield` mocked with two Token
records of $1,500 and $2,000, `executeTransaction` → `shield_n`, `transactionStatus` → pending
twice then accepted with the E10 transfer id, the explorer intercepted: freeze-list count `0u32`,
missing mapping keys `null`, `/transaction/<id>` → the fixture with a height): link Shield,
import the team (one `FinalAgreement`), link Ana Ruiz, run payroll on the rail (40 h at $30:
net 1,048.05 → `1048050000u128`, the $1,500 record, a `[{siblings: […` proof, `privateFee`
false, no fee), watched it settle; a second run the same day triggered the confirm dialog, was
posted, reached "Sent", the page was reloaded (books relocked, unlocked), the card read
"Settling… 0 of 1 · Continue", Continue resumed the sent transfer and settled it with **no second
`executeTransaction`**; the paystub shows the id and the fee. No chain chunk before Connect; one
more chunk (the SDK) arrives with the pay panel. No horizontal overflow on Payroll, Run payroll
or Settings. Zero console errors or CSP violations.

**For the first real testnet run to verify:** that Shield delegates `transfer_private` and
`split` (single-call functions) rather than dropping them; the approval count per run (expected:
one per split plus one per payee, all up front); wall-clock per transfer from approval to
accepted; that the deployed `test_usdcx_stablecoin.aleo` exposes `split(token, amount) →
(Token, Token)` with the amount first and the remainder second (the plan assumes that order);
the explorer's `/transaction/<id>` shape (fee transition inputs, where the height lives, how an
unindexed id answers) against `confirm.ts`; how long Shield takes to show split outputs in
`requestRecords` (2-minute wait, 4 s polls); and whether Shield's `transactionStatus` accepts
its own ids after a reload (the resume path depends on it).

**Deferred.** Posting the fee to a "Network fees" expense (needs an ALEO asset account and a cost
basis; the fee is kept on the settlement for now); `join` for a payee larger than any one record;
the mailbox copy of the paystub; vendor/bill payments through the same queue.

**Results:** 45 files, **364/364** (was 369: coordinator −60, rail +38, payroll 28 → 40; per
package now: business 32, commitments 12, ledger 74, manifest 47, payroll 40, persistence 17,
rail 38, records 11, sales 52, vault 28, wallet 13). Build green, typecheck clean, `pnpm audit`
clean. Lockfile: `@pnw/rail` linked into the app, `@provablehq/sdk` 0.10.1 moved from the
coordinator to `rail`, the coordinator's links dropped.
