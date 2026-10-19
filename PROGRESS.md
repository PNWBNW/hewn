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

## 2026-10-14 — The marketing site (`apps/site`) and a shared brand package

Joshua: the product is getting the brand **Hewn** (hewnaccounting.com); the current art and name
("Plumb") stay as placeholders until the new logo and hero arrive. The site deploys as a second
Vercel project (root directory `apps/site`) at `hewnaccounting.com` + `www`; the app lives at
`app.hewnaccounting.com`.

- **`@pnw/brand`** (`packages/brand`, new). `BRAND` moved out of `apps/business/src/brand.ts`
  unchanged (name, tagline, backupExtension, nameSuffix, railLinkDomain, colors, assets), plus
  `appUrl` (`NEXT_PUBLIC_APP_URL` ?? `https://app.hewnaccounting.com`) and `siteUrl`
  (`NEXT_PUBLIC_SITE_URL` ?? `https://hewnaccounting.com`). `apps/business/src/brand.ts` is now a
  one-line re-export, so no import site in the app changed. Added to the app's deps and
  `transpilePackages`. CLAUDE.md's brand paragraph, BUILD_PLAN's rename recipe,
  `docs/INTEGRATION_AUDIT.md` and `brand/README.md` now point at `packages/brand`.
- **`@pnw/security`** (`packages/security`, new). `headers.ts` was a mechanical move, so it is
  shared: `buildCsp({ nonce, dev, connect?, wasm? })` defaults to `connect-src 'self'` and no
  WebAssembly; `SECURITY_HEADERS` and `newNonce` unchanged. The app's
  `src/security/headers.ts` re-exports those and wraps `buildCsp` with its two opt-ins
  (`EXPLORER_ORIGIN`, `wasm: true`), so the app's policy is byte-identical and its tests stay
  where they were, unchanged and green. `proxy.ts` stays per app (it imports `next/server` and
  carries the matcher; 25 lines). THREAT_MODEL T3 updated.
- **Brand assets for both apps.** `brand/build_assets.py` generates into `apps/business/` as
  before and then copies every file byte-for-byte into `apps/site/` (`APPS` list; icons
  `icon.png`/`apple-icon.png`/`favicon.ico` included). Re-ran it: `git status` shows no change
  under `apps/business/public/brand` or `src/app` icons; `cmp` of all 13 pairs identical.
- **`apps/site`** (`@pnw/site`): Next 16.3.8 / React 19.2.3 / Tailwind 4.2.1, same pins as the
  app, `tokens.css` from `@pnw/ui`, `lucide-react` for four section icons. Deps: `@pnw/brand`,
  `@pnw/security`, `@pnw/ui` and nothing else from the workspace.
  - `/`: the whole hero on an ink band (capped at 1100 px, edge-faded on wide screens, never
    cropped; the tagline is in the art), then mark + wordmark as the `h1` with the tagline, one
    plain paragraph, **Open the app** → `BRAND.appUrl`, "Free. No sign-up. Works offline.", and
    four cards: *Your books stay on your device*, *Everything a small business needs* (books,
    invoices and estimates, bills, projects, payroll with federal withholding, P&L / balance
    sheet / trial balance as CSV: only what the app has today), *Pay your team directly, if you
    want to* (optional "private payments", books work without it), *Free* (no subscription, no
    per-employee fee; the network fee on private payments is the only cost and the employer pays
    it). Header and footer carry the name, Privacy and Open the app.
  - `/privacy`: plain-language page from `docs/THREAT_MODEL.md`: what never leaves the device,
    no account/server/database, no analytics/cookies/third parties (and the app's one read-only
    explorer exception), the mailbox sees only ciphertext + lookup codes + timing/size/IP,
    private payments put only fingerprints on the public record, forgotten passphrase =
    unrecoverable, malware on your own device. No legal boilerplate; "Last reviewed 14 October
    2026".
  - Same CSP approach as the app (`src/proxy.ts`, fresh nonce per request, `connect-src 'self'`
    only, no `wasm-unsafe-eval`), same static headers. `lang="en"`, title template
    `%s · <name>`, description, Open Graph image (the hero) and `metadataBase` from `BRAND`.
    No inline `style=`, no fonts from a CDN, no third-party script. `README.md` lists the Vercel
    settings (root `apps/site`, `ENABLE_EXPERIMENTAL_COREPACK=1`, optional `NEXT_PUBLIC_APP_URL`
    / `NEXT_PUBLIC_SITE_URL`).
  - `src/site_boundary.test.ts` (7 tests): workspace deps are exactly brand/security/ui; runtime
    deps exactly lucide-react/next/react/react-dom; no chain package or `@provablehq/*`; no
    static import outside those; no `src=`/`href="https://` literal in any `.tsx`; the site's
    CSP names no host, `script-src` is `'self' 'nonce' 'strict-dynamic'` only, `style-src` and
    `font-src` are `'self'` + nonce, frames refused.

**Decided (not in the brief).** (1) "Static where possible" loses to the nonce CSP: Next.js can
only stamp a nonce on a per-request render, so both pages render per request like the app
(`await connection()` in the layout; `icon.png`/`apple-icon.png` stay static). (2) The brand
components (`BrandMark`/`BrandLogo`/`BrandHero`) are a 50-line copy in `apps/site/src/components/`
rather than a shared package, since moving them would change the app's shell imports; the site's
`BrandLogo` has no `onDark` mode (no nav rail). (3) The privacy page names the threat-model file
but doesn't link the repository (unsure it's public). (4) The feature list says only what the app
has (no reconciliation, no PDF export).

**Verified.** Root `pnpm test`: 52 files, **421/421** (site 7 new). `pnpm build` (all packages
+ both apps) green; `@pnw/site` and `@pnw/business` typecheck clean; `pnpm audit
--audit-level=moderate` clean; lockfile diff is workspace links only (`apps/site`,
`packages/brand`, `packages/security`, and the two new links in `apps/business`).
**Chromium** (`next start`, 390×844 and 1280×800, light and dark, both pages): zero console
errors, zero CSP violations, no horizontal overflow (`scrollWidth` = viewport on every page), hero
rendered at its natural aspect (390×185 phone, 1100×522 desktop) with the tagline visible,
`lang="en"`, title "Plumb" / "Privacy · Plumb", three "Open the app" links → the app URL,
favicon/icon/apple-icon linked, the only `[style]` element is Next's own route announcer (set via
CSSOM, not blocked). One pre-existing console *warning* on every page, shared with the app:
Chromium doesn't recognise `bluetooth` in `Permissions-Policy` (harmless; left as is).
Screenshots (scratch): phone light — header with mark + wordmark and Open the app, the full hero
with "honest books, grounded and true." and the FREE · OPEN SOURCE line, logo + tagline + paragraph
+ green button, four stacked cards, footer; desktop light — hero capped at 1100 px fading into the
ink band, two-column cards; phone dark privacy — dark canvas, cream headings, six short sections.
Business app started once from its production build: setup screen renders with the re-exported
brand (title "Plumb", hero, CSP with the explorer origin and `'wasm-unsafe-eval'`), no errors.

**Flag for Joshua.** The hero art still says "FREE • OPEN SOURCE" while the licence is the
proprietary PNW Smart Contract License v1.7 (same flag as 2026-10-13); the site copy says
"free" and never says "open source". Once the Hewn art arrives: drop it in `brand/source/`, edit
`packages/brand/src/index.ts`, re-run `brand/build_assets.py`, and both apps follow.

## 2026-10-14 — CSP: rail allowances scoped to two pages

Joshua asked why WebAssembly was allowed and chose to scope it. `apps/business/src/security/headers.ts`
now widens the shared policy only when the request path is `/settings` or `/payroll` (and their
subpaths): the explorer origin in `connect-src` and `'wasm-unsafe-eval'` in `script-src`, both of
which exist for the opt-in rail panels loaded there. Every other page keeps the strict policy the
marketing site uses (own origin only, no WebAssembly). `proxy.ts` passes the path; `hostsRail`
matches by path segment (`/payrolls` and `/settingsx` are not rail pages). Threat model T3 updated.

**Results:** business app 55/55 (headers tests rewritten for both policies), typecheck and build
green. Verified on the production build with curl: `/` and `/transactions` carry
`script-src 'self' 'nonce-…' 'strict-dynamic'` and `connect-src 'self'`; `/settings` and
`/payroll/run` add `'wasm-unsafe-eval'` and the explorer origin.
## 2026-10-14 — Paystubs delivered through the mailbox after settlement

The first document to travel through the mailbox (`INTEGRATION_AUDIT.md` §2.2 step 3, §4.4):
once a paycheck settles on the rail, the employer's app seals the full paystub to the person and
puts it in their mailbox. Branch `mailbox/paystubs`. Mailbox, not archive: the employer's vault
records what was sent so it can go again; the worker's app (a later task) scans the slots, keeps
its copy and drops the pin.

- **`src/books/rail.ts`:** `RailLink.partiesKey` (64 hex, no `0x`; the agreement's shared secret,
  the only thing that seals a paystub to this person) and `mailboxSeq?: { paystub?: number }`
  (the next unused slot per kind, missing = 0). `validateLink` requires the key on a new link;
  `railFromJson` / `railToJson` accept links from before it existed (`allowLegacyLinks`), so older
  files open and save unchanged until the person is imported again. `addLink` validates the new
  link strictly, replaces the link with the same `workerId` in place, keeps `mailboxSeq` when the
  same agreement (same key) is re-imported and starts it over for a new one. `linkFor`,
  `nextSeq(link, kind)`, `bumpSeq(rail, workerId, kind, used?)` (= max(current, used + 1); never
  backwards). Tests 5 → 12.
- **`@pnw/payroll`:** `Paycheck.delivery?: { seq, lookup, sentAt }` (the outbox record; only the
  last send is kept) and `markPaycheckDelivery(payroll, runId, workerId, delivery)`: settled
  paychecks only, seq a whole number, lookup 64 hex, sentAt a date, never an earlier slot than the
  last. Plain JSON fields, so the serializer needed no change. `delivery.test.ts`, 4 tests.
- **`src/chain/deliver.ts`** (pure; the mailbox client and the clock injected):
  `paystubEnvelope(company, runId, workerId)` rebuilds the paystub with `paystubDocument` from
  exactly what posting used (`yearToDate(…, run.id)`), **refuses to send unless
  `paystubHash(doc) === paycheck.paystubHash`**, and wraps it as `{ version: 1, kind: "paystub",
  document, settlement: { transactionId, height?, feeMicrocredits? (decimal string) },
  businessName }` where `document` is the canonical paystub (hash key order, amounts as decimal
  strings, absent fields null) so the receiver hashes it exactly as the books did.
  `deliverPaystub({ company, runId, workerId, client, now })` → `seal(partiesKey, "paystub", seq,
  utf8(json))` → `client.put(lookup, envelope)` → `{ company, delivery, slotTaken }` with the
  delivery on the paycheck and the slot bumped. **409 (slot taken)** = an earlier attempt reached
  the pin but not the vault: counted as delivered, slot advanced. Anything else throws and the
  company is untouched. `recordDelivery(company, runId, workerId, delivery)` is the pure apply
  step the app runs on the latest vault copy. `isMailboxOff(e)` = 503. 7 tests with a fake
  client: the envelope opens with the key/kind/slot and not otherwise, no name or amount or
  transfer id in the ciphertext, resend → next slot with a fresh IV, 409, 502/503/network failure
  leave the input unchanged, hash mismatch and a renamed worker refuse before any request, missing
  parties key → "Re-import this team member in Settings to enable paystub delivery".
- **`src/chain/parties_key.ts`:** `WorkerRecord` doesn't carry `parties_key` and
  `packages/records` was off limits, so the import reads the employer's agreement records once
  more (`readPartiesKeys(requestRecords)`, pending and final, unspent) and maps agreement id →
  key, with the agreement id parsed the way `scanAgreementRecords` parses it. 3 tests.
- **App.** Import team saves the key on every link; a link without one shows "Linked to <name> ·
  Re-import to enable paystub delivery" with a "Re-import as…" select that offers the same person
  (the link is replaced in place). Pay panel (`src/chain/PayPanel.tsx`): the moment a paycheck's
  settlement is in the vault its paystub is sent; each settled row reads "Paystub sent" /
  "Sending paystub…" / "Paystub not sent · <reason> · Send"; a send that fails never touches the
  settlement. On a **503** one line, "Paystub delivery is off on this server", the Send buttons go
  away and nothing else is sent that session (`usePaystubDelivery` short-circuits; no loop). The
  paystub view (`Paystub.tsx`) shows, for settled rail paychecks only, "Paystub sent <when> ·
  Resend paystub" (or "Paystub not sent · Send paystub") through a lazily loaded
  `src/chain/PaystubDelivery.tsx`, so nobody without a rail paycheck downloads it. Fiat path
  untouched; boundary test green.

**Verified:** root `pnpm test` **435/435** in 54 files (was 414/51); `@pnw/business` build and
typecheck green; `pnpm audit` clean; lockfile unchanged. Chromium 390×844 on the production
build, the pay-queue check's mocked Shield (agreement record now with a `parties_key`) and
intercepted explorer, `/api/mailbox/*` answered by the script: link, import ("Linked ✓", no
re-import hint), run payroll on the rail, settle → **"Paystub sent"**; the one POST went to a
64-hex lookup with nothing else in the URL, `application/octet-stream`, 706 bytes starting with
**0x01**, no name, business, amount or transfer id in the clear, nothing but the lookup in any
header. Reload → paystub view reads "Paystub sent Oct 14, 2026, 6:50 AM · Resend paystub";
Resend with the script answering **409** → still "Paystub sent", slot advanced; Resend again →
**201** at a third distinct lookup, fresh ciphertext; after another reload the next send took a
fourth slot (the vault remembers). Second run with the script answering **503**: settled, "Paystub
not sent", the one line, exactly one request, no Send button. No horizontal overflow on Payroll
or Settings; zero console errors or CSP violations (the scripted 409/503 and Playwright's
"aborted" note on a fulfilled route are filtered as the interception, and the page is checked to
have received every scripted status: 201, 409, 201, 201, 503).

**Decided (not in the brief):** `deliverPaystub` returns `{ company, delivery, slotTaken }`
rather than a bare `Company`, so the app can apply the delivery onto the latest vault copy
(`recordDelivery`) while other paychecks' settlements land at the same time; the parties key is
read from the wallet's records in `src/chain` (see above) rather than from `WorkerRecord`; a
pending agreement can be linked too (it carries the key); `markPaycheckDelivery` requires a
settled paycheck; `height` and `feeMicrocredits` are left out of the envelope when the settlement
has none, not sent as null; re-importing the same agreement keeps the mailbox counter.
**Deferred:** the worker side (scan, keep, drop the pin); offers, W-4 and payment notes through
the same mailbox; a "sent" mark on the pay runs list itself (it is on the panel and the paystub).

## 2026-10-14 — Typed and linked parties, and sending an offer

Joshua's rule (2026-10-14): two kinds of party everywhere a party can be picked. **Typed**: a name
you entered; the books work, nothing else. **Linked**: a profile and an agreement approved by both
sides; only a linked party can be paid on the rail, receive documents or send hours. Workers are
linkable today through the employment agreement; vendors, subs and customers wait for a
party-agreement program (a later Leo session), so for them this is the badge, the gate and a stored
address. Branch `rail/typed-linked`. `docs/INTEGRATION_AUDIT.md` §2.1 has a "Typed and linked
parties" subsection recording the rule.

- **`src/books/rail.ts`:** `RailLink.status: "offered" | "linked"` (required; a link saved before
  this existed loads as `linked` and saves that way), `offeredAt?`, `linkedAt?`; an offered link
  must carry its parties key even on load. New `PartyLink` (`kind: customer | vendor`, `id`,
  optional `address`/`nameHash`/`agreementId`/`partiesKey`, `status: typed | offered | linked`;
  offered/linked need all three agreement fields) in `Rail.partyLinks`, left out of the file when
  empty, so older files load and save unchanged. `linkStatus(rail, "worker" | "customer" |
  "vendor", id)` → `typed | offered | linked` (typed with no rail at all); `markLinked`,
  `setPartyLink`, `removePartyLink`, `partyLinkFor`, `setPartyAddress` (trim, validate `aleo1…`,
  clear = drop a typed party; an offered/linked party keeps its account). `addLink` keeps
  `offeredAt` when the same agreement is imported as a full link. Tests 12 → 21.
- **`src/books/LinkBadge.tsx`:** Typed (muted) / Offer sent / Linked (green), on every Team,
  Customer and Vendor row and in their forms (`WorkerForm` gets `status`, `PartyForm` gets
  `link`), with a one-line meaning on the form. Team's footnote explains the two kinds once an
  account is linked.
- **The gate.** Run payroll on the rail already required a link (unchanged). The pay-bills form
  has no rail path yet, so nothing was added there. The customer and vendor forms get an optional
  **Rail address** field (shown once an account is linked in Settings, since the address lives on
  the rail part of the file; validated `aleo1…`, stored in `partyLinks`) with the note "Documents
  and payments on the rail need an agreement approved by both sides; coming for vendors and
  customers soon." Nothing else for them.
- **Send offer** (`src/chain/OfferPanel.tsx`, lazy, from a typed team member's row once Shield is
  linked and the business has a registered name): their registered name (with or without
  `.hewn`) → `computeNameHash` → `name_owner` → address, or address → `worker_primary_name_of` →
  name (`resolveWorker`; "They need to register a name first" otherwise); start date (today),
  review (+90 days), end (optional, open-ended), industry (`INDUSTRY_SUFFIXES`), free-text
  terms; pay type, rate and frequency from the Worker record.
- **`src/chain/terms.ts`:** the `Terms` document, a contract shared with the worker's app:
  `{ version: 1, kind: "terms", agreementId, termsText, payType, rate (cents, string), frequency,
  startDate, businessName, offeredAt }` in exactly that order; `canonicalTerms` =
  `JSON.stringify` of the validated object; `parseTerms`/`validateTerms`. **`agreementId` holds
  the offer time hash** (64 hex, no `0x`), because the agreement id is derived from the terms hash
  and cannot be inside the terms; the worker's app matches by the record's `agreement_id` and
  checks `computeTermsDocHash(canonicalTerms(received)) === record.terms_doc_hash`. Pinned:
  the fixture document hashes to `0x9f83731c…33c948ac`. 5 tests.
- **`src/chain/offer.ts`** (pure; mailbox client, wallet and clock injected): `dateToHeight` and
  `offerEpochs` exactly as the portal (1 block / 3 s from the current height, never before it;
  review never before start; end 0 = open-ended), `fetchLatestHeight` (`/block/height/latest`),
  `createJobOfferInputs` (the portal's 16 inputs: u8 arrays for agreement id / parties key /
  terms doc hash / terms root / offer time hash, `<decimal>field` name hashes, address,
  `u8` industry and frequency, `u32` epochs, `1u16`, `schema_v 2u16`, `policy_v 1u16`),
  `FREQUENCY_CODES`, `finalAgreementIds(records)`, `awaitAccepted` (wallet polling, same
  accepted/rejected sets as the pay queue), and `sendOffer`: build terms → `computeAgreementValues`
  → `seal(parties_key, "terms", 0, utf8(canonical))` → `client.put` (**409 continues; 503
  throws "Offers need the mailbox; it's off on this server" before any transaction**) →
  `executeTransaction(employer_agreement_v4::create_job_offer, privateFee: false)` → poll to
  acceptance → the link to record (`offered`, agreement id, parties key, address, name hash,
  `offeredAt`). 15 tests: inputs equal to a reference built from the portal's own
  `bytesToAleoU8Array`/input list, epochs, name resolution with a fake registry, the envelope
  opens with the key/kind/slot and holds the canonical terms (nothing in the clear), mailbox-first
  ordering with a fake client and wallet (503 → no wallet call; 409 → sent; 502/network → no
  wallet call), refusals before any request, rejected/never-answering wallet, and offer → `addLink`
  → `finalAgreementIds` → `markLinked`.
- **Import team (`RailPanel.tsx`):** reads the agreement records once more raw (parties keys and
  which agreements are final), and every offered link whose agreement id is now a
  `FinalAgreement` turns `linked` on its own; a pending one shows "Offer sent · <name>". Settings
  counts "n linked · m offers sent".
- `@pnw/handshake` added to the app's dependencies, `transpilePackages` and the fiat boundary's
  chain-package list (it is reachable only from `src/chain`).

**Verified:** root `pnpm test` **473/473** in 57 files (was 444/55; business 101); `@pnw/business`
build and typecheck green; `pnpm audit --audit-level=moderate` clean; fiat boundary green;
lockfile diff is the one workspace link. **Chromium 390×844** on the production build
(`scratch/typed-linked.mjs`: mocked `window.shield`, the explorer answered for height and the
registry mappings, `/api/mailbox/*` answered by the script): a typed team member shows **Typed**
and no Send offer before Shield is linked; after linking (registered name `dayco.hewn` resolved),
Send offer → Find "ana" hit `name_owner` → "ana.hewn" → terms → the one POST went to a bare
64-hex lookup, `application/octet-stream`, 369 bytes starting **0x01**, no terms, name, business
or rate in the clear; one mocked `employer_agreement_v4.aleo::create_job_offer` with `privateFee:
false` and 16 inputs (`777field` employer hash, the worker's decimal name hash, the address,
`1u8`, `3u8`, start `4210000u32` = the current height, end `0u32`, review ahead, `1u16 2u16
1u16`, three 32-byte arrays); the row read **Offer sent**, still after a reload; Import team with
nothing accepted left it so ("1 offer sent" in Settings); with the mock handing back a
`FinalAgreement` carrying the offer's agreement id, Import team showed "Linked ✓ · Ana Ruiz" and
the row flipped to **Linked** (the edit form says so too). Customers and Vendors show **Typed**,
refuse `aleo1short` ("Enter an account like aleo1…, 63 characters") and keep a good rail address
across edit. No horizontal overflow on Payroll, Sales, Expenses or Settings; zero console errors
or CSP violations.

**Decided (not in the brief).** (1) `status` is a required field on `RailLink`, defaulted on
load, so the two test literals that build links (`company.test.ts`, `deliver.test.ts`) gained
`status: "linked"`. (2) Twice-a-month pay has no agreement code; it is sent as every two weeks
(`3u8`, the nearest cadence) and the terms document carries the exact frequency; the panel says
so. (3) Ids in the link are stored without `0x` (as the import stores them); the terms'
`agreementId` likewise. (4) The terms always go to slot 0 of the `terms` kind. (5) The rail
address field appears only once an account is linked (there is nowhere to keep it before); the
badge shows everywhere regardless. (6) The offer is recorded after the wallet reports acceptance,
without waiting for the explorer to index it. (7) Industry defaults to the first entry, as the
portal's fallback did; it is not stored in the books. (8) Settings' team count distinguishes
linked from offered (a two-line edit outside the files listed).

**Flag.** Re-offering the same person (same two addresses, so the same parties key and the same
slot 0) would find the slot taken (409) and go on with the *old* terms in the mailbox, which
the worker's hash check would then refuse. Not reachable today (Send offer only shows for a
typed team member), but the day a terminated agreement can be re-offered the terms need their own
slot counter (`mailboxSeq.terms`) and the worker's scan to try each slot.

**Deferred.** Linking vendors, subs and customers (the party-agreement program); paying a bill on
the rail; cancelling or re-sending an offer; a worker's name shown on the Team row once linked.
## 2026-10-14 — The worker side, inside the same app

`INTEGRATION_AUDIT.md` §6 task 8, Phase 0 criterion 2 (the worker sees their paystub). Branch
`work/worker-side`. A person who works for a business sets up their own vault on their own phone
and gets a profile on the registry, offers to accept, clock in / clock out with the week sent to
the employer, and paystubs arriving through the mailbox. No new Leo program; every transition is
one the old portal exercised, encoded the same way.

- **Role in the company file.** `Company.role?: "business" | "worker"` (absent = business, so
  every existing file opens as before; an unknown role is refused) and `Company.work?: Work`
  (`src/books/work.ts`: `workToJson` / `workFromJson`, field-by-field validation, one agreement
  per id, punches sorted). `Work` = display name, `profile?` (name hash, name, done flag,
  registered-at), `agreements` (id, parties key, employer address and name hash, optional
  registered name, status pending/active/paused/terminated, optional `Terms`, accepted-at),
  `punches`, `timesheets` (sent weeks), `paystubs` (received) and `mailboxSeq` per agreement
  (`paystub`, `timesheet`). Pure operations: `upsertAgreement` (keeps terms/name/acceptance an
  earlier copy had), `setProfile`, `nextWorkSeq` / `bumpWorkSeq` (never backwards), `addPaystub`
  (one per slot), `recordTimesheet` (a week sent again replaces the record), `punch` (the
  opposite of the last punch; only against an active agreement), `updatePunch`, `removePunch`
  (a lone last out can go alone and reopens the shift; removing an in takes its out with it).
  **The rule:** per agreement, punches in time order alternate in, out, in, out… from an in, no two
  at the same time; `checkPunches` enforces it on every add, edit and removal, which is what makes
  overlapping shifts impossible. 15 tests.
- **Hours maths** (`src/books/hours.ts`): local calendar days, weeks start Monday
  (`weekStartOf`), a shift crossing midnight is split between its two days, an open shift counts
  up to now or, once its day has ended, to that midnight (a forgotten clock-out never bleeds into
  the next day). `buildTimesheet` = the shared payload `{ version: 1, kind: "timesheet",
  agreementId, weekStart, entries: [{ date, in, out, minutes }], totalMinutes, sentAt }`, refused
  for a non-Monday or an empty week. 7 tests, pinned to `America/Los_Angeles`.
- **Setup chooses the role.** `SetupScreen` opens with "What brings you here?": *I run a
  business* (today's flow, unchanged) or *I work for a business* (your name and a passphrase
  only → blank books named after the person, `role: "worker"`, empty `work`). `BooksProvider`
  exposes `role` and `work`, `create` takes the role, and `useWork()` gives the worker pages
  `work` + `updateWork`. Company-file tests cover the round trip with role/work, a business file
  carrying neither, and files from before roles opening as a business's.
- **Worker shell.** `AppShell` renders its own nav for a worker (Home, Offers, Hours, Paystubs,
  Profile, then Settings / backup / Lock), the header badge reads for hours and paystubs, and
  `redirectFor(role, path)` sends a worker off any business page to `/work` and a business off
  `/work/*` to `/` (Settings is shared); `src/app/work/layout.tsx` renders nothing for a
  non-worker vault. Routes are literal under `src/app/work/**`, so they win over `[section]`.
- **Pages** (fiat-safe words only; every Shield/mailbox panel is a `dynamic()` import from
  `src/chain/work/**`, so a person who never taps a button never downloads it):
  - `/work` Home: one big Clock in / Clock out button (vault only; a select appears with more
    than one active employer), today and this week, the employer list with pay terms, Send this
    week, the latest paystub.
  - `/work/hours`: the week's punches by day (earlier weeks a tap away), each editable
    (datetime-local, the alternating rule explained on refusal) or removable with a confirm,
    the weekly total, Send to <employer>. `src/chain/work/SendTimesheet.tsx` seals the payload
    with the agreement's parties key under kind `timesheet` at the next slot and `put`s it;
    409 = sent; 503 = "Timesheet delivery is off on this server". Note: `timesheet` is not one of
    the kinds `@pnw/mailbox` names (`packages/*` were off limits); the mailbox accepts any
    lower-case kind and the kind is part of the key, so it works as is — adding it to `KINDS`
    is a one-line follow-up for whoever next edits the package.
  - `/work/offers`: the agreements in the vault, pending first ("Waiting for you"), with the
    terms once known. "Check for offers" → `src/chain/work/Offers.tsx`: reads
    `employer_agreement_v4` records from Shield (`PendingAgreement` and `FinalAgreement`, parsed
    as the old portal parsed them plus `parties_key` and `terms_doc_hash`; a final copy wins over
    a pending one; a final agreement's paused/terminated status from the `agreement_status`
    mapping, best effort), resolves the employer's registered name from
    `name_plaintext(employer_name_hash)` (best effort), fetches the terms at
    `lookupId(partiesKey, "terms", 0)`, **verifies `computeTermsDocHash(canonicalTerms(terms))`
    equals the record's `terms_doc_hash`** ("Terms don't match the agreement" and no Accept
    otherwise; the same when the terms haven't arrived or the host has no mailbox), shows pay
    type, rate, frequency, start date and the terms text, and **Accept** runs
    `employer_agreement_v4::accept_job_offer(recordPlaintext, accept_time_hash)` with the hash
    built exactly as the old portal built it (BLAKE3("PNW::DOC", TLV 0x6008 of the u32 epoch
    seconds) as a `[u8; 32]`), then marks the agreement active with its terms and `drop`s the
    terms pin. Every agreement found is written to the vault, so the list stands without Shield.
  - `/work/paystubs`: the list, newest first, each opening in `PaystubView` (document only, plain
    words: period, pay, gross, each tax, net, "Paid on the rail · <short id>", the fee line,
    employer taxes, year to date). "Check for new paystubs" → `src/chain/work/Inbox.tsx`, which
    runs `scanPaystubs` (`inbox.ts`): for each accepted agreement, slots of kind `paystub` from
    `mailboxSeq[agreementId].paystub ?? 0` upward until `get` returns null; each envelope is
    opened, parsed as `{ version: 1, kind: "paystub", document, settlement, businessName }`
    (what `src/chain/deliver.ts` writes), its hash recomputed with `paystubHash` from the typed
    document (`src/books/paystub_document.ts` reads the canonical form back), kept in the vault
    (`addPaystub`, which bumps the slot), and only then `drop`ped. An envelope that won't open
    or won't parse is skipped with a visible error and its slot moved on, so one bad document
    never blocks the ones behind it; 503 stops the scan with the one-line message. Needs no
    Shield: the keys are in the vault.
  - `/work/profile`: the registered name and the two steps. `src/chain/work/Profile.tsx`: connect
    Shield (`useShield`, checked against the account linked in Settings), look the account up in
    `worker_primary_name_of` → `name_plaintext`; else **Register name**: availability through
    `name_owner(computeNameHash(name))` (a name already owned by this account is "already
    yours" and skips the transaction), then `pnw_name_registrar_v5::register_worker_name(<hash>field,
    <name as u128>u128)` exactly as `RegisterNameStep.tsx` encoded it, with "Needs 1 USDCx in
    your public balance and a little ALEO for the fee"; then **Create profile**: the 15-input
    `pnw_worker_profiles_v2::create_worker_profile` exactly as `CreateProfileStep.tsx` encoded it
    (legal first/middle/last name as u128, age from the date of birth, gender with "Prefer not to
    say" = the old code's 3 and the default, FIPS state, ISO country, industry, citizenship;
    schema/policy/rev 1u16; the anchor BLAKE3("PNW::DOC", TLV 0x5010 of name hash, address, u32
    seconds); the state-issued id the old form sent as "0" when blank). No skip: the profile is
    done only when Shield reports the transaction accepted. The vault keeps only `nameHash`,
    `name`, `profileAnchored`, `registeredAt`.
  - Settings for a worker: "You" instead of "Business" (no fiscal year), the copy on Private
    payments reads for receiving, no Import team, the registered name comes from the profile.
    Shield linking is the same `RailPanel` connect flow (the other worker's file, untouched).
- **`src/chain/work/execute.ts`**: every write goes through `@pnw/wallet`'s
  `executeAleoTransaction` with `privateFee: false`, the fee left to Shield's estimate as the pay
  queue does, then the wallet's own `transactionStatus` until accepted/rejected (5-minute cap,
  injectable clock). Nothing logs an input, an id or an error. The old portal's
  `useTransactionExecutor` is not used: it `console.log`s every input.
- **CSP**: `/work` joins `/settings` and `/payroll` as a rail page (`RAIL_PATHS`), so the worker
  pages may compile WebAssembly and reach the explorer; everything else stays strict. Headers
  tests and THREAT_MODEL T3 updated. `@pnw/handshake` is linked into the app (lockfile +3 lines)
  for `computeTermsDocHash`.

**Shared contracts** (with the employer's Send offer, built in parallel): `Terms` =
`{ version: 1, kind: "terms", agreementId, termsText, payType, rate (cents, decimal string),
frequency, startDate, businessName, offeredAt }`, canonical form = `JSON.stringify` with keys in
exactly that order; the record's `terms_doc_hash` = `computeTermsDocHash(canonical)`. Pinned
fixture: the terms above with rate 3000, weekly, start 2026-10-19, "Day Construction", offered
2026-10-14T16:00:00.000Z → `0b56276bce6516f482492af7b1acbfc5d40690f20ab1967a45151edc4986719f`.
`Terms.agreementId` may be the agreement id or the offer time hash; the app matches by the
record's `agreement_id` and only checks the hash. The timesheet payload is above.

**Tests**: 29 new in the app (work 15, hours 7, company +2, headers edited) plus `src/chain/work`
(terms 6 with the pinned hash and `fetchTerms` outcomes; agreements 7 incl. the pinned accept-time
hash; execute 4; inbox 7 with a fake mailbox: stops at the first miss, bumps the slot, drops pins
after storing, skips one bad envelope with a visible error, starts from the remembered slot,
503/502, pending agreements left alone; timesheet 4; registry 8 with the pinned fixtures
`ana_ruiz` → `4547698302048783622388735066678619945457518107237306768812295900000616107966field`,
`7020655931687266682u128`, "Ana" → `4288097u128`, " " → `32u128`, "Ruiz" → `1383426426u128`).
Root `pnpm test` **503/503** in 63 files (was 435/54); `@pnw/business` typecheck and build
green; `pnpm audit --audit-level=moderate` clean; fiat boundary green (no chain word or import
outside `src/chain`).

**Chromium 390×844** on the production build (scratch `worker.mjs`: `window.shield` owned by the
worker, the explorer intercepted, `/api/mailbox/*` served from sealed fixtures made with the real
`seal`): set up as a worker → lands on `/work`, `/payroll` bounces back to `/work`; Settings →
Connect Shield → "Shield is linked. Offers and pay reach this account directly.", no Import team;
Profile → the mocked registered name `ana_ruiz.hewn`, the profile form → Create profile →
`create_worker_profile` with 15 inputs (`12345field`, `4288097u128`, …, `36u8`, `3u8`, `53u16`,
`840u16`, …, `9u8`, a `[u8; 32]` anchor), `privateFee: false`, no fee → "Profile complete";
Offers → Check → 1 agreement found, terms fetched from slot 0 once, `brothers.hewn` / Day
Construction / $30.00 per hour / weekly / starts 2026-10-19 / the terms text, Accept →
`accept_job_offer` with the record plaintext as Shield gave it and a `[u8; 32]` accept-time hash
→ "Accepted", the terms pin DELETEd, the list shows Active; Home → Clock in ("On the clock since
…") → Clock out; Hours → edit the clock-in two hours back → 2h 00m → Send this week → one POST,
201, to a bare 64-hex lookup (= slot 0 of the `timesheet` kind for this agreement), octet-stream,
335 bytes starting with **0x01**, no field name, name or hour in the clear; Paystubs → Check → "1
new paystub arrived", the paystub slot read once then DELETEd, the view shows gross 1,200.00,
each tax, net 1,048.05, "Paid on the rail · at1yphn8n…9ltw", the fee line; a second check reads
slot 1 only (the vault remembers); Home shows the latest paystub. Zero console errors or CSP
violations (a mailbox 404 is the end of a scan and is filtered as such), no horizontal overflow on
any page. `business-smoke.mjs`: *I run a business* → the dashboard, `/work/hours` bounces to `/`,
Settings unchanged. Screenshots in scratch `shots-worker/`.

**Decided (not in the brief).** (1) A name already on the registry marks step 1 done but not the
profile: `profileAnchored` is false until `create_worker_profile` is accepted in this app, since
the profile's anchor can't be looked up without the anchor itself; someone who made a profile in
the old portal is asked again (whether the program accepts a second profile for the same name is
for the testnet run to tell). (2) `employerLabel` prefers the business name from the terms, then
the registered name, then the short account. (3) Removing a punch takes the other end of its shift
only when the rest would no longer alternate; a last out can go alone. (4) A shift still open when
a week is sent is cut at now / that midnight rather than refused. (5) The fee on the three
transitions is left to Shield's estimate (the pay queue's precedent) rather than the old portal's
flat 0.5 credits. (6) Paystubs are scanned for paused and terminated agreements too (pay can
arrive after a pause), never for pending ones. (7) The inbox needs no Shield; Offers and Profile
do. **Deferred:** checking the paystub's transition id against the USDCx record in the worker's
account (§2.4) and against the anchored period root; the credential badge; W-4 through the
mailbox; the employer's side of the timesheet (receiving the week); a "sent" mark per day.

## 2026-10-14 — Hewn branding

Joshua's final name and art arrived: **Hewn** (hewnaccounting.com, app at app.hewnaccounting.com).
New sources in `brand/source/`: `hewn-logo-light.png`, `hewn-logo-dark.png`, `hewn-hero.png`,
`hewn-icon.png` (the pine-cone-on-a-plumb-line tile, now the app icon), `hewn-strip.png`
("Every business. One Hewn.", source only) and `tiles/` (books, payroll, invoices, reports, farm,
build). `brand/build_assets.py` was rewritten for the new art (the logos are lettering with the pine
inside the H rather than a mark beside it, so the wordmarks are extracted per logo, the dark one from
inside its navy panel) and starts by clearing the output folder so a rename leaves nothing behind. It
regenerates `hewn-*` files into `apps/business` and copies them byte-for-byte to `apps/site`.
`packages/brand`: name Hewn, backup extension `.hewn` (old `.plumb` backups still restore: the file
picker takes any file), asset paths, `wordmarkAspect` 315/123, and a `tiles` map. The lockup is now the
wordmark alone (it carries its own pine) in both apps; hero dimensions 1536×526 everywhere including
the social-share image; the site's "Everything a small business needs" card shows the four tiles that
exist today (Books, Payroll, Invoices, Reports; Farm and Build wait for their templates). CSS
variables renamed `--plumb-*` → `--hewn-*`. CLAUDE.md, README, BUILD_PLAN (product-name decision
ticked), brand README and doc titles updated. Internal names stay `@pnw/*` and `pnw-*` formats.

**Results:** 534/534, both apps build, audit clean. Chromium on the production builds, 390×844 and
1280×800, light and dark: site and app setup screen render with the new lockup and hero, tagline
visible, no horizontal overflow, zero console errors.

**Notes for Joshua:** the app icon source is 217 px, so the 512 px icons are upscaled (send a larger
file or SVG and re-run the script for crisper ones). The hero still says "FREE • OPEN SOURCE" while
the licence is proprietary (site copy says only "free").

## 2026-10-14 — Front page, Log in pop-up and email accounts

Joshua's problem: the app opened with the passphrase card already over the hero, hiding the front
page. Now a real front page, a Log in pop-up, a New here? entry, and an account that is an email
plus a passphrase. Branch `front/login`. No server, no email sent, no verification, no sync; moving
device is by backup file.

- **`FrontPage.tsx`** (rendered by `BooksGate` when status is `new` or `locked`, never auto-opening
  anything): top bar with the wordmark and, on the right, **New here?** (text) and **Log in** (icon +
  words, 44px tall on a phone); the whole hero, uncropped and uncovered; the tagline as the heading;
  the site's intro trimmed; **Get started** and **Log in** buttons (the filled one is Get started on
  a device with no books and Log in on one with books, and comes first); three value lines with
  icons; "Encrypted on this device. Nothing is sent to a server." About 1.07 screens at 390px.
- **`LoginDialog.tsx`** (`@pnw/ui` Dialog): Email, Passphrase (show/hide), Log in; links Restore
  from a backup file, New here? Create an account, and, only if a `"default"` vault exists, Open
  books created before accounts (swaps to a passphrase-only form). Esc, backdrop and an X close it;
  focus goes to Email only once the dialog is open and returns to Log in on close; the form is
  mounted only while open, so closing clears it. `autoComplete` email / current-password. One
  generic error. Busy state during the 600k-round derivation. If one email and passphrase open both
  a business and a worker account, a chooser ("Open your business books" / "Open your worker
  account"); the other session's key is dropped.
- **New here**: the existing `SetupScreen` as a full view with a Back link (to the front page; later
  steps label it "Front page" so it isn't mistaken for the step Back). The protect step gains Email
  (validated, normalised) above Passphrase; the "no password reset" line sits under the passphrase;
  the old checkbox is shortened and no longer hard-codes a company name. Setup refuses to overwrite
  an existing account for that email and role. `AuthCard` is now top bar + hero + card below it (the
  negative-margin overlap is gone); Settings says "You can add the other kind later from the front
  page: New here? → choose the other one."
- **`account.ts`** (pure): `normalizeEmail` (trim, NFKC, lowercase, shape, 254 max),
  `vaultIdFor` (`acct-` + 32 hex of SHA-256 over `hewn:acct:v1:<role>:<email>`), `accountSecret`
  (`hewn:v1\n<email>\n<NFKC passphrase>`), `findAccounts(store, email, passphrase)` (0, 1 or 2
  accounts; one generic error; a failed lookup spends one decoy key derivation so timing doesn't say
  whether the email exists), `legacyOpen`, `hasLegacyVault`. `Company.email` (normalised, inside the
  encrypted file; absent on older files).
- **`BooksProvider`**: `create({ email, role, passphrase, … })`, `unlock(email, passphrase)` →
  opened or a choice, `chooseAccount`, `cancelChoice`, `unlockLegacy`, `restore(file, email,
  passphrase)`. Saves, attachments and backups use the open session's vault id. `locked` now means
  "some books are on this device": the `VaultStore` interface has no list method and an account's
  id is a hash of an email, so it is `"default"` exists **or** the small `localStorage` flag
  `pnw:has-account` (set on create, login and restore; holds only "1", never an email). If the flag
  is lost the page leans towards Get started but Log in still finds the account (the login computes
  the ids from the typed email). `restore` requires the backup's record id to be one of the ids for
  that email ("This backup belongs to a different account"); a `"default"` backup restores with the
  passphrase alone. `RestoreScreen` asks email + passphrase, or passphrase only after reading a
  pre-accounts file. Backup names and contents carry no email (only the hash id). `UnlockScreen` is
  gone, replaced by the dialog.
- **Docs**: CLAUDE.md "Keys and storage" (unlock secret is email + passphrase); THREAT_MODEL T2
  (email part of the secret, hashed local id, no server accounts, no credential stuffing, no reset,
  recovery key planned, and the accepted risk that the unsalted id lets someone holding a file test
  a guessed email, which opens nothing).

**Tests**: 561/561 in 67 files (was 534/66 on main): `account.test.ts` 25 (normalisation incl.
unicode, full-width, combining accents, idempotence, bad shapes, 254/255; id stable and pinned,
differs by role and email, no email in it; secret changes with either input; passphrase alone
cannot open an account vault; the email is absent from the record and the backup; `findAccounts`
right/wrong email, wrong passphrase, other email's passphrase, both roles, different passphrases
per role, empty device, legacy vault not opened by it; `legacyOpen`, `hasLegacyVault`), `company.test.ts`
+2 (email round trip, files from before accounts). Fiat boundary green (no banned word in the new
copy). Typecheck, business build and `pnpm audit --audit-level=moderate` clean.

**Chromium** on the production build (107 checks, scratch `login.mjs`, shots in
`shots-login/`), 390×844 and 1280×800, light and dark: a fresh profile shows the front page with
no dialog open, nothing focused, the whole hero visible and uncovered (9 sample points hit the
image) and at its true 1536:526 shape; no horizontal overflow anywhere; the wordmark, New here? and
Log in sit side by side at 390px with 44px targets. Log in opens the pop-up (Email focused, correct
autocomplete values), Esc, backdrop tap and X each close it and focus returns to Log in. New here →
setup with Back → front page; Get started goes to the same place. Created a business account with
`Ana.Ruiz@Example.com`; reload → front page with **Log in** now the filled button; wrong email and
wrong passphrase both give "That email and passphrase don't match an account on this device";
Log in is disabled with no email; `  ana.ruiz@EXAMPLE.com ` + passphrase opens it; Settings shows
Account `ana.ruiz@example.com` and the hint. A worker account with the same email and passphrase:
Log in → chooser, each choice opens the right side; creating a second account for the same email and
role is refused, not overwritten. The business backup (record id `acct-…`, no email in the file or
its name) restores on a fresh profile with its email and passphrase, is refused for another email
("This backup belongs to a different account") and for a wrong passphrase, and logs in afterwards.
A pre-seeded `"default"` vault (made with the real `createVault`, 600k rounds, by a throwaway
vitest and written into IndexedDB in the page) shows "Open books created before accounts", rejects a
wrong passphrase, opens with the right one, and Settings says "Created before accounts". Desktop
dark: create, lock, log in. Zero console errors or CSP violations; the only console output is the
existing `Permissions-Policy … Unrecognized feature: 'bluetooth'` warning from this Chromium build
(header set in `@pnw/security`, untouched).

**Decided (not in the brief).** (1) `RailPanel` still imports `VAULT_ID` for the message Shield signs
when linking an account, so I kept that export, pointing at `"default"`, instead of editing
`src/chain`; the signed message therefore says `default` for every account (see Deferred). (2)
`vaultIdFor` and `accountSecret` take the already-normalised email as given (as specified); the
callers normalise. (3) A failed login spends one decoy PBKDF2 so a wrong email isn't visibly
faster than a wrong passphrase. (4) Creating an account where that email and role already exist is
refused rather than replacing the vault. (5) Restore on a device with books warns "If this account
already has books on this device, restoring replaces them", since only that account's vault is
replaced now. (6) No edits to `packages/vault`, `packages/ledger`, `apps/site`, `brand/`, or
`src/chain`/`work`/`payroll`/`sales`/`expenses`.

**Deferred.** The recovery key (a second wrapped copy of the data key; the email is kept in the
account for it). Email verification (needs a server; not planned). Migrating `"default"` books to an
email account. Cross-device sync is intentionally not planned. Binding the Shield link message to
the open vault's id instead of `default` (needs a one-line change in `src/chain/RailPanel.tsx`).
Changing the passphrase or email from Settings.

## 2026-10-14 — Link message names the open account

The message Shield signs when linking an account now carries the open account's vault id instead of
`default` (`BooksProvider` exposes `vaultId`, set on open, cleared on lock; `RailPanel` throws "Log in
first" without one). The exported `VAULT_ID` is gone. Typecheck clean; `pnpm test` 561/561.

## 2026-10-14 — Send offer: always reachable, with a draft and a review

Joshua's first build account had nowhere to build an employment agreement: "Send offer" only appeared
once Shield was linked and a business name was found, with no hint why. Now every active typed team
member has Send offer, and the panel opens with a checklist that ticks off as each piece is done
(Shield linked → business's registered name). If the lookup by account finds no name, the business can
type one it already owns; it is accepted only when the registry says this account owns it
(`resolveBusinessName`). Registering a new business name is not built (back burner, may be dropped).

The offer form drafts the terms from plain fields (role, duties, hours a week, notice days, dates) plus
the team record's pay (`agreement_draft.ts`, pure). The draft follows the fields until the text is
edited by hand; "Start over from the fields" returns to it. A Review step shows the agreement exactly as
the worker will read it before the single Shield approval. Nothing about the terms contract, the
mailbox slot or the 16 `create_job_offer` inputs changed.

Tests: `pnpm test` 569/569 (+8: draft text, optional lines, refusals, long dates, business-name
ownership). Browser check on a fresh account: Team → Send offer shows the checklist with the Settings
link. Not run here: the linked-account form and review (needs Shield), to be covered by Joshua's
testnet run. Unverified assumption: that employer names live in the same registry mapping
`queryNameOwner` reads for worker names; if not, the typed-name check says "No one has registered that
name".

## 2026-10-14 — The business Mailbox

A Mailbox page for the business (sidebar item, `/mailbox`), one list, newest first, of what has
passed between it and its team: offers sent (waiting), "X accepted your offer" (linked), paystubs
delivered, and weeks of hours the team sends. Offers and paystubs are read from the rail links and
pay runs (no copies); hours are new: the business collects them from each linked agreement's sealed
`timesheet` slots when the page opens and on "Check now", needing no Shield (the parties keys are in
the vault). Each week is written to the vault (`Company.mailbox`) before its pin is dropped, then
shown with its daily entries; unread weeks show a badge on the sidebar item. A waiting offer shows
"Check for a reply", which opens the existing Import team panel (the acceptance still has to be read
from the Shield account). "Offer sent" now points to the Mailbox.

Hours come from another person's device, so `books/mailbox.ts` treats them as untrusted: version 1
timesheet naming exactly the agreement whose key opened it, total equal to the sum of the entries,
entries bounded to a day and to 100, unknown fields dropped; a failing document is skipped and
reported with its pin left. `/mailbox` joins `/settings`, `/payroll` and `/work` as the fourth page
allowed the explorer and WebAssembly (the reply check runs there); THREAT_MODEL updated.

Tests: `pnpm test` 592/592 (+23: validation, slots, unread, scan order and failure modes, feed
ordering). Browser check: a fresh business account shows the Mailbox item and its empty state. Not run
here: a populated feed and a real scan (need two Shield accounts and `PINATA_JWT`); Joshua's testnet
run covers them. Not built: turning received hours into a pay run's hours (next), worker-sent W-4s
(the worker app doesn't send one yet).

## 2026-10-14 — Register a business name (.hewn)

Settings → Register business name, and the same flow inside the Send offer checklist
(`chain/RegisterBusiness.tsx`, `chain/business_registry.ts`). It reads the registry for the linked
account and goes one of four ways: already holds a business name (kept), holds a worker's name (a
business needs its own Shield account), not yet approved (shows the account to send to the registry
authority, with Check again), or free to register (name + industry, availability check, one Shield
approval of `pnw_name_registrar_v5::register_employer_name`, done only when Shield reports it
accepted; saved to the books as `rail.businessName`). The authority's own account also gets an Approve
button (`employer_license_registry::set_verified`), for itself or a pasted account.

**Found in the Leo source (not what I assumed):** registering a business name, and `create_job_offer`,
both require the account to be approved in `employer_license_registry`, and only its `AUTHORITY`
account can approve. The UBI/licence number is not checked on chain (only a commitment is stored; we
store a placeholder), but the approval gate itself is real and the registry is `@noupgrade`. So a
business needs the authority's one-time approval before it can register or send offers. Dropping the
gate needs a registrar v6 and agreement v5 (Leo session, not started). Also: the old
`buildRegisterEmployerNameCommand` in `@pnw/records` has the pre-v5 signature and is not used.
Recorded in `docs/ALEO_CONSTRAINTS.md` §7.

Tests: `pnpm test` 605/605 (+13: v5 input encoding pinned, name and industry refusals, approval
inputs, authority check, the four account states, availability). Not run here: the panels themselves
(need Shield, public USDCx and a funded account); Joshua's testnet run covers them.

## 2026-10-14 — Find people and businesses by their .hewn name

One lookup for both (`chain/directory.ts`, `chain/NameLookup.tsx`): type `ana.hewn`, `dayco`, `@dayco`
or an account starting aleo1 and get who it is: a person or a business, its industry (businesses),
whether a business is approved to send offers, and the account it points at. Public registry data only,
no Shield needed. It replaces the offer panel's own "name or account" field (which now refuses a
business with "dayco.hewn is a business, not a person") and appears on the customer and vendor forms
as "Find on the registry", filling the party's rail address and keeping the name's hash on the party
(`PartyLink.nameHash`, cleared if the account is then edited by hand). The old `resolveWorker` is gone.

Names are held on chain as hashes, so only an exact name can be found: no search by first letters and
no list to browse. The message for a miss says to check the spelling. (A browsable directory would
need an indexer, which is a server; not planned.) `/sales` and `/expenses` may now reach the explorer
for this lookup (connect-src only, still no WebAssembly); THREAT_MODEL updated.

Not built, and not possible with today's programs: agreements and payments between businesses. A
customer or vendor found by name is still "typed" (the books work, nothing is sent on the rail), because
a bilateral agreement between two businesses (job contract, hold harmless, NDA, anything else) needs a
party-agreement Leo program that doesn't exist yet. That is the next Leo session (Fable 5.1, high effort).

Tests: `pnpm test` 622/622 (+17: name normalisation, business and person results, industry and
approval, misses, exact-name refusals, kind mismatch, the suffix query, name-hash handling on parties,
the CSP for the two lookup pages). `next build` clean.

## 2026-10-15 — Open registration live; the app uses it

Deployed from the phone through a new GitHub workflow in pnw_mvp_v2 (`upgrade-admin-program`,
admin key in the `testnet-staging` environment). Open copies of the gated functions were appended
(an upgrade can't change an existing function's finalize inputs):

| Program | Edition | Adds | Upgrade tx |
|---|---|---|---|
| `pnw_name_registrar_v5` | 1 | `register_worker_free`, `register_employer_free` (free, no approval) | `at1m77eapnjtp4wxk0lf5y9dyp3j0glxm2umsv8rk0j8nt2ny96xg9q6cgtx6` |
| `employer_agreement_v4` | 2 | `create_offer_open`, `pause/terminate/resume_employer_open` (no approval) | `at17d0f4a442msg92tzgem7s65346s2eway3auvpwalzmnyhngtgqqqe62yjc` |

The app now calls `register_worker_free`, `register_employer_free` and `create_offer_open`. Gone:
the "needs approval" screen and the authority's Approve tool, the 1 USDCx notes (registration is
free; only the network fee), and "approved to send offers" on lookup cards.

What it took (in `docs/ALEO_CONSTRAINTS.md` §7): testnet is on consensus V22; Leo 4.4.5 only knew
up to V20 and its fee proofs were rejected until it got snarkVM 4.12.0's height table; Leo publishes
no binaries anymore (crates.io build, cached); Leo 4.4 rejects our 4.0-era syntax, so the bytecode is
compiled with 4.0.0 and sent with 4.4.5. The toolchain update (port sources to 4.4 syntax, bump CI
pins, SDK and adaptor) is the next task.

Tests: `pnpm test` 618/618, `next build` clean.

## 2026-10-15 — Open source: AGPL-3.0

Joshua's decision: Hewn and the Leo programs are now **AGPL-3.0-only** (the proprietary PNW Smart
Contract License v1.7 is retired here). `LICENSE` holds the canonical GNU text (661 lines; checked
word-for-word against SPDX's copy). Every `package.json` says `"license": "AGPL-3.0-only"`. The app
(sidebar note and the front page's lock note) and the site footer link to the source
(`BRAND.sourceUrl`), since anyone running a changed copy for others must offer its source. The Hewn
name and logo are not licensed (README). CLAUDE.md's licence rule and BUILD_PLAN's decision row are
updated. `SCALE_GRANT_PROPOSAL` is left as written (a record of what was submitted).

Before going public: both repos' full histories were scanned for private keys, view keys, Pinata
tokens and committed `.env` files. Only placeholders (`APrivateKey1...`), dummy test keys and empty
`.env.example` files were found. Making the repos public is Joshua's step (GitHub Settings).

Tests: `pnpm test` 618/618; both apps typecheck.

## 2026-10-15 — Setup: every account links Shield and registers its name.hewn

Joshua's decision, replacing "fiat first": every account, business or worker, links a Shield account
and registers a `name.hewn` before it can use the app; a worker also creates the private profile
behind the name, as in the MVP. `books/setup.ts` (pure, tested) says where an account stands
(`link` → `name` → `profile` for workers → `done`). The app shell sends any unfinished account to
`/settings/setup` (a rail page under the CSP, so Shield works there) and shows only "Finish setup" in
the sidebar until it's done; existing accounts go through the same page on their next login. The page
reuses the existing Connect, Register business name and worker Profile panels; their Cancel starts
the step over. Sign-up now says what comes next, and that each role needs its own Shield account
(one registered name per account). CLAUDE.md and BUILD_PLAN record the change.

Browser check: a new business account lands on "Finish setting up", step 1 of 2; a new worker
account on step 1 of 3; the sidebar offers only "Finish setup". The Shield steps themselves need the
extension or the Shield app (Joshua's testnet run).

Next (separate PR): add team members, customers and vendors only by finding their registered name.

Tests: `pnpm test` 625/625 (+7 for the setup steps and redirect).
## 2026-10-15 — People are added only by their registered name

Team members, customers and vendors are now added only by finding their `name.hewn` (or account) on
the registry. Team → Add someone opens on "Find them on the registry", and the pay and W-4 form
appears once they're found; the customer and vendor forms start with the same lookup, and "Add" stays
off until someone is found (the free-typed rail address field is gone). Who someone is (account,
name hash, registered name) is kept in the books as a `PartyLink`, which now covers team members too
(`kind: "worker"`, `name`; `setRegistered` / `registeredFor` in `books/rail.ts`). Team rows show
their `name.hewn`; Send offer opens already addressed to them (Change looks them up again); Import
team's "Add to team" keeps who they are. People added before this rule stay, marked "Not linked to
a registered name yet", with a lookup to link them (editing a team member, or the party form).

Shared piece: `books/RegistryField.tsx` (the found identity, or the lookup; loads it only when
shown). Browser check: Team → Add someone shows only the lookup; Customers → Add shows the lookup
first and keeps "Add customer" disabled. (This container can't reach the explorer, so every lookup
here reads as "no one has registered"; Joshua's testnet run covers real names.)

Tests: `pnpm test` 621/621 (+3 for registered identities).
## 2026-10-15 — Dashboard shows the linked account's ALEO and USDCx

The dashboard has a "Shield account" card with the linked account's ALEO and USDCx, each split into
private and public, read automatically instead of entered by hand. Public balances come from the
explorer (`credits.aleo/account`; the stablecoin's public mapping, tried as `balances` then `account`
because the deployed name isn't pinned here) as soon as the page opens, with no Shield needed. Private
balances are the unspent `credits` and `Token` records Shield returns once it is connected to the
linked account (it reconnects on its own after the first time). A different Shield account gets a
"switch accounts" note. It only displays balances and posts nothing to the books; "Cash in the bank" is still the books' own bank
accounts. USAD is left out for now (Joshua).

Code: `chain/balances.ts` (pure: record sums, mapping parse, six-decimal format; no `@pnw/rail`,
whose index loads the prover's WebAssembly), `chain/AccountBalances.tsx`, loaded dynamically by
`app/page.tsx` only when an account is linked. CSP: `/` joins `LOOKUP_PATHS` (explorer only, no
WebAssembly; the Shield adaptor needs none). Threat model T3 updated.

Known limit: the CSP comes from the first page loaded, so opening the dashboard by in-app navigation
from a strict page (say `/transactions`) blocks the public read until a reload; the private part
still shows. The same is true of the other explorer pages today.

Tests: `pnpm test` 640/640 (+12: balances, dashboard CSP). `next build` green.
## 2026-10-15 — Shield history check (read-only probe)

Step 1 of the wallet-fed books (Joshua): before building a "For review" list that fills itself from
the wallet, find out what Shield actually gives us. Settings → Private payments → **Check Shield
history** (business only) runs a read-only check and shows a report with a Copy button:
records per program (USDCx, credits) with their field names and spent counts; the wallet's
transaction history per program; how many USDCx records come from transactions the history
doesn't list (payments received); and up to three past transfers opened end to end (Shield's
transition view keys → the explorer's transaction → decrypted with the SDK), reporting how many
inputs and outputs could be read and whether an amount is readable. The report holds counts, field
names and function names only: no account, amount or transaction id, so it is safe to paste into a
chat. Nothing is signed, posted or stored.

Decisions recorded (Joshua): the Shield account is the business's bank account; its balance on the
start date is the opening balance; wallet movements after it arrive "for review" and are
categorised (customer payment, vendor payment, job, tax category); ALEO is fee money only, never
an asset; swaps are noted in review as swaps to or from USDCx (buying ALEO books as Network fees).

Code: `chain/history_probe.ts` (+6 tests), `chain/HistoryProbe.tsx`, a button in Settings.
`@provablehq/sdk` 0.10.1 is now a direct dependency of the app (already in the lockfile via
`@pnw/rail`; nothing new downloaded).

Tests: `pnpm test` 646/646. `next build` green.
## 2026-10-15 — Shield asked for the history permission

First run of the Shield history check (Joshua, testnet): records 0 for both programs (the account
holds only public funds, matching the dashboard's "Private 0.00 · Public 19.00"), and history
"failed: The dApp does not have decrypt permission". The app connected with
`DecryptPermission.UponRequest`; Shield answers `requestTransactionHistory` only at
`OnChainHistory`. The wallet provider now asks for `OnChainHistory` (it includes everything the
lower levels allow). An existing connection keeps its old permission until Hewn is disconnected in
Shield and connected again. Threat model T3 notes the wider permission.

Tests: `pnpm test` 646/646. `next build` green.
## 2026-10-15 — What Shield gives the books (history check results)

Second run of the history check (Joshua, testnet, after reconnecting with the on-chain history
permission), with some USDCx moved from public to private in Shield first:
- History works: 2 USDCx and 3 credits transactions, each with `blockNumber`, `blockTimestamp`,
  `functionId`, `programId`, `transactionId`, `transactionStatus`.
- Records carry far more than the plaintext: `blockHeight`, `blockTimestamp`, `transactionId`,
  `functionName`, `sender`, `spent`, `transitionId`, and more.
- A transfer the account signed opens in full with Shield's transition view key: every input
  (amount and recipient) and the fee are readable.
- One USDCx record's transaction was not in the history list, so the feed must merge history and
  records, deduplicated by transaction id.
- `transfer_public_to_private` is a move inside the same account (public → private USDCx): the
  review list should label it itself and post nothing.
- `test_usdcx_bridge.aleo/mint_public` failed to decrypt in the SDK ("Array exceeds maximum of
  elements"); harmless, the stablecoin transition beside it carries the amount.
- Not yet seen: a payment from another account. Joshua is testing sends and receipts made inside
  Shield (not through the app) to see how they show up.

Verdict: the wallet can feed the books. Next: start the books from the Shield balance (below), then
the "For review" list.

## 2026-10-15 — Start the books from the Shield balance

The dashboard's balances card gets **Start your books from this balance**: once both USDCx
balances are read, a confirm step shows today's date and the private + public total in dollars,
and **Start my books** posts it as the opening balance of the books' **Shield account** (debit),
against Opening Balance Equity (credit). Nothing typed, nothing to balance. Afterwards the card
says which date the books follow the account from. A zero balance records the start with no
entry. Fractions of a cent are dropped, never rounded up. ALEO is fee money and isn't counted.

- The rail's bank account is now named "Shield account"; books holding the old "Rail balance"
  keep it and it is renamed when the books start (`findRailAccount`, `LEGACY_RAIL_ACCOUNT_NAMES`
  in `@pnw/payroll`). The pay run picker says "Shield account (private rail)".
- The start is kept on the link (`rail.start = {date, entryId?}`, validated) so the review list
  knows where to begin and a second start is refused.
- Setup checklist: with an account linked, "Enter opening balances" becomes "Start your books from
  your Shield balance" and points at the card.
- Start date is today only, for now: a past date can come once the review list can rebuild the
  balance on that date.

Code: `books/opening.ts` (+6 tests), `chain/AccountBalances.tsx`, `books/rail.ts`, `app/page.tsx`,
`@pnw/payroll` (`findRailAccount`, +1 test case).

Tests: `pnpm test` 652/652. `next build` green.
## 2026-10-15 — History check opens the newest transfers; navigation and the security policy

Third run of the history check (Joshua, after sending and receiving inside Shield): USDCx history
went from 2 to 4 transactions, but every decrypt failed with "WebAssembly … violates the following
Content Security Policy directive", and the transfers it tried were the old ones.
- Order: Shield lists history newest first and the check took the last entries, so it reopened the
  oldest. It now sorts by block height, then time, opens the newest (up to 4), and lists the newest
  10 history entries per program as `date function (status)`.
- Policy: each page's CSP is set when the document loads, and in-app navigation keeps it. Opened at
  `/` (the dashboard: explorer, no WebAssembly) and then tapping to Settings, the SDK can't compile.
  A full load fixes the policy but locks the books (the session is in memory only), so forcing
  reloads is not an option. Open decision for Joshua: one policy for the whole signed-in app.

Tests: `pnpm test` 653/653. `next build` green.
## 2026-10-15 — One security policy for the whole app

Joshua chose one CSP for the whole business app. Every page now allows the explorer in
`connect-src` and `'wasm-unsafe-eval'` (WebAssembly compilation only; JS eval stays refused);
nothing else changed (nonce, `'strict-dynamic'`, no other host, no framing). Before, the policy
was widened per page, but a page's policy is fixed when the document loads and in-app navigation
keeps it, so the first page opened decided it for the whole session: opened at the dashboard, the
history check's decryption was blocked on Settings. A fresh load per page would fix that but lock
the books (the unlocked session lives in memory only). `RAIL_PATHS`, `LOOKUP_PATHS`, `hostsRail`
and `hostsLookup` are gone; `buildCsp` no longer takes a path. Threat model T3 and CLAUDE.md
updated (and a misplaced "verified in a browser" line in T3 put back under connect-src).

Tests: `pnpm test` 649/649 (the per-path tests are replaced by six for the single policy).
`next build` green.
## 2026-10-15 — Stay logged in

Joshua: switching apps on the phone logged him out every time (the page is suspended or reloaded,
and the unlocked books lived in memory only). Now the login has **Stay logged in on this device for
24 hours** (ticked by default): the open data key is kept in IndexedDB as the browser's
non-extractable `CryptoKey` with an expiry 24 hours after login, and the app reopens the books on
load until then. **Log out** (the menu's old "Lock books") forgets it. Unticked, nothing is kept:
15 idle minutes or a reload locks, as before. Creating an account and restoring a backup stay
logged in too.

- `@pnw/vault`: `VaultSession.remember(store, expiresAt)`, `resumeSession(store)`,
  `forgetSession(store)`, `REMEMBER_MS`; one remembered slot per device (`RememberedSession` in a
  new IndexedDB store, `DB_VERSION` 3). `resumeSession` refuses and clears an expired key, an
  expiry more than 24 hours out, an extractable key, or a key that doesn't open its record.
- `BooksProvider`: resumes on load; `open(session, stay)`; a timer logs out at expiry; the idle
  lock applies only when not kept open; `stayUntil` on the context.
- CLAUDE.md (the one exception to "the vault key is never stored") and threat model T1/T8 updated.
- Checked in Chromium against a production build: created an account, reloaded (still open), Log
  out then reload (asks again), logged in unticked then reload (asks again). No page errors.

Idea logged (Joshua's roommate, no work planned): an optional paid tier with bank connections, customer
service and extras. Bank feeds need a server-side aggregator (Plaid or similar), which the
free app's no-server rule forbids, so it would be a separate opt-in service.

Tests: `pnpm test` 655/655 (+6 vault). `next build` green.
## 2026-10-15 — Transactions → For review (step 3a)

Money that moves in the Shield account after the books started now comes in for review, in plain
words, and posts to the books when accepted. Nothing to type, no debits and credits.

- **Where:** Transactions → **For review** (replaces the "Bank activity" placeholder), with To
  review / Reviewed / Excluded. A count shows on the menu's Transactions item and as "N
  transactions to review" on the dashboard; `/transactions?tab=review` opens the tab.
- **Finding it** (`chain/review_feed.ts`): Shield's USDCx history (both directions of public
  transfers, and what the account sent privately) read back from the explorer, plus the
  account's USDCx records (a private payment received, with Shield's `sender`), merged by
  transaction id. Public transfers are read as they are; private ones are opened with Shield's
  transition view key. Only movements after the start count: the start now keeps its exact
  time (`rail.start.at`); a start from before that counts from the next day. Rejected
  transactions are skipped; ones the explorer can't serve yet are counted and retried next check.
- **Each line:** "Sent 4.625 USDCx to PNW DAO" / "Received 4.25 USDCx from Employer 1", with the
  date, the dollars that go in the books, and a note when a fraction of a cent is dropped. Names
  come from the business's customers, vendors and team, then the registry (`name.hewn`), else a
  short account.
- **What was this?** Money in: Customer payment (income account, defaults to the first income
  account), Owner money in (equity, the investment account by name), Swap from ALEO, Other. Money
  out: Expense or vendor (expense account, no default: the business picks), Owner money out (the
  draw account), Swap to ALEO, Other. Optional customer/vendor, project and memo. **Accept** posts
  (in: debit Shield account, credit the account; out: the reverse; source `deposit`/`expense`,
  ref `review:<tx>`); **Exclude** keeps it out. Swaps post to **Network fees** (created if
  missing): buying ALEO is buying fee money.
- **Automatic:** a move between the account's public and private halves is "internal" (nothing to
  post); a paycheck the app paid itself (its settlement's transaction id) is "recorded".
- **Undo:** an accepted item goes back to review with its entry reversed; an excluded one simply
  returns. The register shows "Undo it from For review" instead of Void on those entries.
- Code: `books/review.ts` (+7 tests), `chain/review_feed.ts` (+8), `chain/ReviewPanel.tsx`,
  `chain/decrypt.ts` (shared with the history check), `books/company.ts`, `app/transactions`,
  `shell/AppShell.tsx`, `app/page.tsx`. Threat model: "The review list". BUILD_PLAN phase 7 bank
  import marked "may be dropped" (Joshua).
- Checked in Chromium against a production build with a seeded vault: the tab, accept as
  income and as owner's draw, the reviewed list, the internal move, the entries in the register.
  No page errors. Not checked here: reading Shield and the explorer (this container can't reach
  either); that's Joshua's first run.

Known limits: a fraction of a cent per transfer isn't posted, so the books can trail the wallet by
dust; invoices and bills aren't matched yet (step 3b).

Tests: `pnpm test` 670/670 (+15). `next build` green.
## 2026-10-15 — For review: Change

Joshua: a way to correct a transaction reviewed wrongly, in one step. Reviewed lines that were
accepted now have **Change** beside Undo: it opens the same "What was this?" card inline,
prefilled with what was posted (the choice, the account, the customer or vendor, the project, the
memo), and **Save change** reverses the old entry and posts the corrected one in one save (the
books keep the original, the reversal and the correction). **Cancel** leaves it as it was.

Code: `books/review.ts` `changeItem` and `choicesOf` (+1 test), `chain/ReviewPanel.tsx` (the card's
edit mode, Change in the reviewed list). Checked in Chromium with a seeded vault: accepted a
payment as a customer payment, changed it to owner money in; it opened prefilled and the line
then read "Posted to Owner's Investment". No page errors.

Tests: `pnpm test` 671/671 (+1). `next build` green.
## 2026-10-15 — Set-asides ("floating values")

Joshua: the business holds one wallet balance, but wants to earmark parts of it (10 of 20 USDCx
for Equipment) without moving money, and have payments to certain vendors come out of the
earmark. Built as **set-asides**: sub-accounts of the books' Shield account (bank accounts under
it). What's left in the Shield account itself is **General**, free to spend; General plus every
set-aside always equals the Shield account's total.

- **Dashboard → Set-asides** (shown once the books have started): General and each set-aside with
  its balance and the vendors it pays, and the total. **New set-aside** (name, optional amount to
  set aside now, vendors it pays). **Manage**: Set aside (from General) / Release (back to
  General), rename, change vendors, **Close set-aside** (its balance goes back to General, the
  account is made inactive). Every move is a book entry (`manual`, ref `set-aside`); moving more
  than General or the set-aside holds is refused.
- **For review:** with set-asides open, each line asks **Paid from** (money out) or **Went into**
  (money in): General or a set-aside, with balances. Picking a vendor a set-aside pays switches
  the default to that set-aside (until changed by hand); a warning shows when a payment takes the
  chosen one below zero (the money has already left, so it is not refused). Change reads it back
  and can move it. A set-aside is never the "other side" of a review.
- Code: `books/funds.ts` (+5 tests), `books/SetAsides.tsx`, `books/review.ts`
  (`shieldAccountId` on accept, `choicesOf` reads it back), `chain/ReviewPanel.tsx`,
  `books/company.ts` (`funds`), `app/page.tsx`.
- Checked in Chromium with a seeded vault: made "Equipment fund" with 10.00 paying Saw Co;
  reviewed a 4.625 payment with Saw Co as vendor, which defaulted to the fund; afterwards General
  8.62, Equipment fund 5.38, total 14.00. No page errors.

Not yet: payments the app sends itself (payroll) don't check General's balance before paying;
that's the next step if wanted. Vendor payments aren't sent from the app at all yet.

Tests: `pnpm test` 676/676 (+5). `next build` green.
## 2026-10-15 — Log out reachable on a phone

Joshua: no way to log out. The side menu's bottom (Settings, Download a backup, Log out) ran off
the bottom of a phone screen with the Shield browser's bars, and the menu didn't scroll; at a
390×640 view, Log out sat at 625–669. The menu now scrolls (`overflow-y-auto`), and Settings has a
**Log out** button by the account, with when "stay logged in" ends (or that it logs out on close
and after 15 idle minutes). Checked in Chromium at 390×640: Log out reachable after a scroll;
Settings → Log out returns to the front page.

Tests: `pnpm test` 676/676. `next build` green.
## 2026-10-15 — One kind of account per Shield account

Joshua: a business account and a worker account on the same wallet would mix business money with
a person's pay (incoming wages landing in the business's books, spending that can't be told
apart, balances that no longer match). Rule: one kind of account per Shield account; the same
email may hold both kinds, each with its own Shield account.

- `chain/account_kind.ts`: `kindConflict(role, address)` / `assertKindFree` read the registry's
  other-kind mapping (`worker_primary_name_of` for a business, `employer_primary_name_of` for a
  worker). Stricter than the older lookups: a 404, `null` or `0field` is "none", but an
  unreachable or failing registry refuses with "try again" instead of letting it through. (+4
  tests)
- Checked before Shield is asked to sign the link (Settings and setup, both kinds of account), and
  before a worker registers a name. Registering a business name already refused a wallet holding
  a worker's name.
- CLAUDE.md "Boundaries" records the rule. The registry itself doesn't enforce it yet: the mainnet
  registrar will (with the name fees, renewal and reserved names Joshua is designing).
- Not handled: wallets already linked to both kinds before this (Joshua's test accounts). The fix
  there is Settings → Unlink on one of them and link another Shield account; a name already
  registered stays on the registry.

Tests: `pnpm test` 680/680 (+4). `next build` green.
## 2026-10-15 — Mainnet registrar design written down

Joshua's design for the mainnet name registrar is now a section of BUILD_PLAN.md ("Mainnet name
registrar"): length-priced names, yearly renewal with a grace period, reserved names, one kind
per wallet on chain, and usage credit toward renewal (0.25 USDCx per paystub received or payroll
payment sent, private, capped at the renewal price, reset yearly, with opt-in auto-renewal that
Shield approves). Exit criteria list the negative tests. Building it is a new Leo program, for a
Fable 5.1 session. Docs only; no code changed.
## 2026-10-15 — Mainnet names move to the Aleo Name Service; no renewals

Joshua pointed at ARC-137 (the Aleo Name Service, built on ARC-721) for broad reverse resolution,
and he was right: ANS is one shared registry with `primary_names` and `names` mappings, and the
wallets and explorers that support it read them through an open-source indexer that follows the
registry's `tlds` mapping. So a `hewn` TLD registered there (one admin-only `register_tld` by the
ANS team, our registrar program as owner) makes `john.hewn` show, and receive, in every ANS-aware
app with nothing to build on their side. ANS also has private names, which fit the free tier.

Decisions: free tier = a random private `.hewn` name assigned at setup, found by address; paid
tier = a chosen public name, priced by length, bought once; **no renewal, no expiry** (ANS names
are permanent, and the usage-credit idea went with renewal); one kind per wallet; our programs
key on ANS's name hash on mainnet (a fresh deploy). BUILD_PLAN's registrar section is rewritten as
"Mainnet names"; CLAUDE.md notes mainnet lookup by address. Open: short-name prices, and the
conversation with the ANS team. Docs only; no code changed.

## 2026-10-15 — README rewritten for Hewn

The top-level README still described the PNW two-repo setup (submodules, the old portal's
employer flow, five wallets, `.pnw` names). It now leads with Hewn: what it is, what each area
of the app does today, how the vault, the Shield wallet, payroll and the mailbox fit together, a
short history (PNW, the first private testnet payroll on 2026-04-10 with its tx hashes, the
redesign into Hewn, `.hewn` under ANS next), a map of the repo with the retired and legacy
folders marked, how to run it locally, where to report security problems, and the AGPL licence
text unchanged. Docs only; no code changed.

## 2026-10-15 — Source link points at the renamed repository

The GitHub repository is now `PNWBNW/hewn`. `BRAND.sourceUrl` (the "source code" link the app
and the site show, which the AGPL makes us keep) pointed at the old `PNWBNW/pnw`; GitHub
redirected it, but the link now names the real home. One line in `packages/brand`.

## 2026-10-15 — Free-tier names are public

Joshua's call after #57: the free tier's random `.hewn` name is public, like a paid one (ANS
`register`, not `register_private`), so it resolves to the address, can be the wallet's primary
name and shows in every ANS-aware wallet and explorer. The only difference between the tiers is
whether you choose the name. BUILD_PLAN "Mainnet names" and its Decisions line, and the CLAUDE.md
registry note, say so now. Docs only; no code changed.

## 2026-10-15 — README: the longer history

Joshua opened his earlier repositories so the README's "Where it came from" could tell the whole
story, not just 2026. Read from their commit history (not named in the README, at his request):
the first PNW design (Feb 2025, ~480 commits in a month: Leo contracts and a whitepaper for a
multi-chain worker network with SubDAOs, farm co-ops and trust funds, plus a farm-to-table
market idea); the Aleo + Stellar MVP (Feb 2025 to mid 2025, ~1,240 commits, most of them
March to May); a Cosmos sidechain and wage token sketched in May 2025 and set aside; the
Aleo-only rebuild (Jan 2026) and the portal (Mar 2026); the first private testnet payroll during
the Aleo Buildathon (2026-04-10); Hewn (Oct 2026). The section opens with Joshua's own words on
why he started. Docs only; no code changed.

## 2026-10-15 — Name registry map, with a fallback to our own registry

New `docs/NAME_REGISTRY_MAP.md`: every place the Leo programs and the app depend on the name
registry.

**On chain:** five live programs check name ownership directly: agreement v4, credential v3/v4,
worker profiles v2, employer profiles v2, and router v4. Receipts and payroll only carry the
hashes.

**In the app:** about a dozen name operations, repeated across files.

**Findings:**
- One kind per wallet isn't enforced on chain.
- The registrar doesn't tie a name hash to its text.
- Two different 16-character name rules.
- Duplicated lookups.
- A possible caller bug in the router, to check.

**Plan, at Joshua's ask, so the in-house registry stays usable if ANS declines the `hewn` TLD:**
- Programs ask one program of ours, `hewn_names`.
- The app asks one name service.
- A name's id is ANS's name hash in both modes, so switching never changes stored records.
- One Leo source, two builds, chosen by a constant before deploy.

BUILD_PLAN "Mainnet names" gains the fallback and two exit criteria. Planning only; no code
changed.

## 2026-10-16 — The H is the icon

The pine-cone icon from the "Plumb" days is replaced, at Joshua's ask, by the Hewn H: cream on
green, both legs the same width, with a cyan pine in the left leg.

**Source.** The H is drawn as a vector, `brand/source/hewn-icon.svg`, rendered to
`hewn-icon.png` at 1024 px (the old source was 217 px and upscaled). It is a full green square
with the H in its middle half, so the same art serves as the iOS icon and the maskable app icon
without padding, and it doubles as the X avatar.

**Script.** `brand/build_assets.py` now takes the square as is for `apple-icon.png` and the
maskable icon, and rounds the corners for `icon.png`, the 192/512 icons, `favicon.ico` and
`hewn-mark.png`.

**Unchanged.** Hero, tiles and wordmarks regenerated byte-identical. The site and the app serve
the same files (checked with the site running: tab icon, iOS icon and favicon are the new H).

**Not changed.** The wordmark's own H still has the wider left leg and a cut-out tree.

Tests 680/680, build green.

## 2026-10-16 — A door in the hero's H

Joshua's idea: in the hero's lettering, the gap under the H's crossbar is now a small door beside
the pine, so the H reads as a cabin. The door is painted in the scene's own palette:
- **Colour:** the tree's sky-teal, a shade deeper, fading lighter toward the haze like the tree.
- **Light:** sky light on the panel tops, warm sun light on the right edges, a soft shadow under
  the crossbar.
- **Knob and grain:** a gold knob in the sun's colour, and the illustration's light grain.

**Scope.** Only the hero changes (`brand/source/hewn-hero.png`, then the three generated hero
files in each app). The standalone H icon and the wordmark stay as they are (Joshua). Everything
else regenerated byte-identical. Tests 680/680.

## 2026-10-16 — Audit design: proof without receipts

New `docs/AUDIT_DESIGN.md`, the direction Joshua approved: payroll stays one private transfer
per worker, and auditability comes from the books plus one anchor per period. No receipts.

- **Period root.** A salted Merkle root over the period's journal entries and its settlements
  (each paycheck's entry tied to its transfer id and a salted tag of the worker's address).
  It also commits the entry counts, the previous period's root and the journal's hash-chain
  head.
- **Period anchor.** One Shield tap per period, through the live `@noupgrade`
  `payroll_audit_log::anchor_event`. No new Leo needed now; `gl_core` takes over later with
  the same root format.
- **Payment proof.** The transfer's transition view key. Known leaks: the employer's change
  record, and the stablecoin's own compliance record.
- **Audit packs.** Four scopes (a paycheck, a worker's year, a period, later ZK claims with a
  minimum group size) and an offline verifier.
- **Limit.** Proving "no off-book payments" needs a full view key, so that stays with
  `audit_nft`'s dual consent.

**Found while writing it.** The transfer id is recorded on the paycheck after it confirms,
outside the hashed entry. Hence the settlement list in the root.

Order: period roots (ledger), anchor on close (app; the screen needs Joshua's greenlight),
audit pack and verifier, the worker's own proof, then `gl_core` (Fable). Docs only; no code
changed.

## 2026-10-16 — The business keeps the offer it sent

Found in the offer review: the business's vault never kept the terms it offered. `OfferPanel`
saved only the link and threw the returned terms away. The worker's app deletes the mailbox copy
once it accepts, so after that only the worker had the agreement's text. THREAT_MODEL's mailbox
section said the sender kept one from the start, and now it does.

- `RailLink.terms` holds the terms exactly as sent. They are validated with the same
  `validateTerms` the worker side uses (`books/work.ts`), so a bad copy refuses to load.
- The terms are saved the moment the offer goes out. They are kept through approval and through
  importing the same agreement again, and dropped when a different agreement replaces the link.
- On the team list, "View offer" shows the books' copy: the date sent, the pay, the start date
  and the full terms text.
- Offers sent before this have no copy.

**Next (Joshua, 2026-10-16):** the job offer letter.
- Open sections for job description, requirements and handbook or policies.
- PDF and image attachments up to 5 MB, delivered through the mailbox and committed inside the
  terms fingerprint, so accepting binds the worker to the exact files.
- Both sides keep the full letter.

Then a design for counter-offers.

Tests 684/684 (+4), build green. The new view is checked by typecheck only: reaching an offered
team member needs Shield and the registry.

## 2026-10-16 — The job offer letter

Joshua's ask: an offer should be a full job offer letter, not just pay and dates. It has a job
description, requirements, handbook or policies, anything else, and a contract or photos
attached. The worker accepts all of it. The old portal only ever had a text box; the PDF
upload he remembered was the W-4's.

**Terms version 2.** Version 1 plus `letter` (four sections, each up to 20,000 characters) and
`files`: name, type, size, SHA-256 and piece count, for PDF, PNG, JPEG or WebP, at most 5 files
and 5 MB together. Both live inside the terms document, so the agreement record's
`terms_doc_hash` commits to every word and every file's fingerprint; accepting on chain accepts
exactly these. No Leo change. Version 1 offers still load and verify.

**One definition.** `books/offer_letter.ts` holds the letter's shape and limits, used by both
sides. The business's and the worker's canonical forms are pinned to each other byte for byte
for version 2 (`terms_contract.test.ts`).

**Files through the mailbox** (`chain/offer_files.ts`). Each file is cut into 256 KB pieces,
numbered one file after another, under a mailbox kind unique to the offer (`offer_` plus the
start of the offer time hash), so a second offer never collides with the first. On arrival,
each piece's size and the whole file's SHA-256 are checked against the terms.

**Sending.** The files go up first, then the terms, then the one Shield signature. If a piece
can't be delivered, nothing is signed. The business's vault keeps each file (`RailLink.offerFiles`)
and the terms.

**Offer screen.** An "Offer letter" area with the four sections and Attach files. The review
shows the letter and files, and each file can be saved. Progress shows "x of y" while the
pieces go up.

**Worker.**
- Check for offers collects and verifies the files and saves them in the vault
  (`WorkAgreement.files`).
- Accept waits until every file is in and the person ticks "I've read the offer letter and the
  attached files".
- After accepting, the terms and every piece are dropped from the mailbox.
- The Offers page keeps showing the letter and the files from the vault.

THREAT_MODEL's mailbox section now covers the files (the host can tell roughly how big they are).

Tests 705/705 (+21): letter rules, files there and back including a missing piece, a swapped
piece, a wrong fingerprint and someone else's key, the send order, the cross-side contract,
and saved copies on both sides. Build green. The screens are checked by typecheck and build
only: an offer needs Shield and two registered accounts, so Joshua's test run is the real check.

**Next:** a counter-offer design, for Joshua's approval before building.

## 2026-10-16: Every offer expires, and a waiting offer can be withdrawn

Joshua: every offer has an expiry, so offers nobody answers don't sit in the mailbox forever.

**Expiry** (`books/offer_letter.ts`). The business picks "Offer open for" 3, 7, 14 or 30 days
(default 7). `expiresAt` sits inside the terms (version 2, after `offeredAt`), so the terms hash
on the agreement commits to it. Validation refuses a missing expiry, one not after the offer,
and one more than 30 days on.

**Worker side.**
- Check for offers clears an expired offer's terms and file pieces from the mailbox and skips
  fetching its files.
- Accept refuses an expired offer; the row says it expired and hides the Accept area.
- The Offers page shows "Expired" for a pending offer past its time.

**Business side.**
- The team list shows "Offer expires in…" or "Offer expired without an answer", and the saved
  offer shows "Open until".
- **Withdraw offer** (`chain/WithdrawOffer.tsx`, loaded only when tapped): one Shield approval of
  `employer_agreement_v4::terminate_employer_open` on the pending agreement. `accept_job_offer`
  needs it pending, so the person can't accept it anywhere afterwards. Then the terms and file
  pieces are dropped from the mailbox, the business's saved copies of the files are discarded,
  and the team member is typed again, ready for a new offer (`rail.removeLink`). No Leo change.
- Not yet checked on testnet: whether Shield proves `terminate_employer_open` (it calls the
  name registry, like `create_offer_open`, which does work).

Tests 713/713 (+8): expiry windows, validation and labels; withdraw inputs, the single
privateFee-false signature, mailbox cleanup only after acceptance; `removeLink`; a 14-day offer.
Build green.

**Next:** keep-until dates and read receipts (important documents are never deleted
automatically; unopened negotiation messages clear after 30 days).

## 2026-10-16: Mailbox keep-until days, the daily sweep, and receipts

Joshua: records people depend on are never deleted automatically; documents that only matter
for a while are; and the sender should know whether something was picked up.

**Keep-until days** (`@pnw/mailbox` `retention.ts`).
- Paystubs, W-4s, weeks of hours and payment notes carry no day. They stay pinned until the
  other side's app collects them, however long that takes.
- An offer's terms and file pieces carry the day after the offer expires. Receipts carry 60 days.
- The client sends the day in `X-Mailbox-Keep-Until`. The function checks it (a real date,
  today to 60 days on) and pins it as Pinata keyvalues beside the envelope.

**Daily sweep** (`/api/mailbox/sweep`, `vercel.json` cron at 04:17 UTC).
- Unpins mailbox pins whose day has passed, only those (named by a lookup hash, with a valid
  day), at most 500 a run.
- Needs `Authorization: Bearer $CRON_SECRET`. Without `CRON_SECRET` set in Vercel it does nothing
  (503), and an expired offer is still cleared by the person's app when it finds one.

**Receipts** (`@pnw/mailbox` `sealReceipt`/`openReceipt`, `chain/receipts.ts`).
- The person's app sends one when it first sees an offer and when it collects a paystub. The
  business's app sends one when it collects a week of hours.
- A receipt lives at its own address (`PNW::MAILBOX::RECEIPT::v1` domain) under its own key and
  says only "received at".
- The sender reads receipts on its mailbox check (business: Mailbox page; person: Check for
  paystubs), keeps the time (`RailLink.offerReceivedAt`, `PaycheckDelivery.receivedAt`,
  `SentTimesheet.receivedAt`), then drops them. Best effort on both ends.
- Shown as: offers "Opened …" / "Not opened yet" / "It expired before they opened it";
  paystubs "Received …" / "Waiting for their app to pick it up"; sent hours "Received …" /
  "Not picked up yet".

Manual delete of paystubs or agreements doesn't exist yet. When it's built, it asks the person
to save a PDF first (Joshua).

THREAT_MODEL's mailbox section covers keep-until days and receipts: the host learns a calendar day
per pin and, by timing, that a document was collected.

Tests 745/745 (+32): receipt addresses and sealing (wrong key, slot, kind, or a document passed off
as a receipt), keep-until validation, the header, the function refusing bad days, the Pinata
keyvalues and the sweep's own filter, the sweep's secret, receipts sent on collecting paystubs and
hours, read-record-then-drop, what each side waits on, and the vault fields. Build green.

**For Joshua:** add `CRON_SECRET` (any long random string) to the app's Vercel environment
variables so the daily sweep runs.

**Next:** counter-offers as a conversation thread (needs per-offer terms slots).

## 2026-10-16: Premium tier candidate noted: private messaging within an organization

Joshua: a full messaging system (business ↔ team, group announcements, coworker ↔ coworker
within the same business) could be a premium feature on mainnet. Not gated now. BUILD_PLAN gains
"Premium tier candidates" with the design constraints:
- the circle is the business plus everyone with an accepted agreement;
- group keys go to each member through their own mailbox and are replaced when someone leaves;
- coworker messages are private from the business (the business only relays public keys);
- the directory is opt-in.

The tier itself is an open decision. Docs only; no tests changed.

## 2026-10-16: Counter-offers, as a conversation thread

Joshua: the person can reply with what they'd like changed; the business sees exactly what, and
accepts or counters back; either side can go again.

**The thread** (`books/thread.ts`, `chain/thread.ts`).
- One conversation per business and person, filed by the pair's parties key (the same for every
  offer between them). The business keeps it in its mailbox (`Mailbox.threads`), the person in
  `Work.threads`.
- Each side writes its own slots (`thread_b` / `thread_w`) and reads the other's. Typed messages:
  - `counter`: from the person, the terms as they'd like them, plus a note;
  - `stands`: from the business, keeping the offer as it is, plus a note;
  - `revised`: from the business, saying which new offer replaced which.
- Incoming messages are checked field by field, and a side can't send the other side's kinds.
  Plain messages join the same thread in the next PR.

**Person.**
- On Check for offers, a pending offer has **Ask for changes**: edit a copy of the terms (pay,
  frequency, start date, written terms, letter sections; changing pay or start updates the
  written terms too), review "was → wants", add a note, send. No Shield.
- The offer then shows "You asked for changes…", "They kept this offer as it is" with their note,
  or, on the new offer, "Revised offer" with what changed from the old one.
- A withdrawn offer now shows as Withdrawn (or "Replaced by a revised offer"): pending records
  are checked on chain too.

**Business.**
- The Mailbox check reads each person's thread. The feed shows "Ana asked for changes to your
  offer" with the changes as was → wants, and three answers:
  - **Accept their changes** or **Counter back** (edit first) send a revised offer: withdraw
    (Shield 1 of 2), then send the new one with the same letter files (Shield 2 of 2), then a
    `revised` note in the thread. The team member's pay in Payroll follows the offer.
  - **Keep the offer as it is** sends a `stands` note. No Shield.
- The Team row shows "Asked for changes: answer in Mailbox".
- Links now keep the offer's industry, review and end dates (`RailLink.offerInputs`) so a
  revision starts from them.

**Per-offer terms slot.** An offer's terms now live at kind `terms_<first 24 hex of agreement id>`,
slot 0, so a revision never collides with the old offer's terms. The person's app falls back to
the shared slot 0 for offers sent before; withdrawing clears both. `payLine` and `longDate` moved
to `books/terms_words.ts` (`agreement_draft` re-exports them).

THREAT_MODEL covers the thread. Tests 762/762 (app 374, +16): message rules (wrong side,
malformed fields), the thread through a fake mailbox (each side's slots, keep-then-drop, a taken
slot stepped over, a forged message skipped), open requests and answers, was → wants,
keeping the written terms in step, the form, the vault fields, the per-offer terms slot with its
fallback. Screens checked by typecheck and build; a real negotiation needs two accounts and
Shield, so Joshua's test run is the real check.

**Next:** business ↔ team messages on the same thread (a Messages screen on both sides).

## 2026-10-16: The parties key is random (security fix)

Found while fact-checking the messaging post. Every mailbox key and lookup comes from the
agreement's `parties_key`. The old portal computed it as BLAKE3("PNW::PARTIES", employer address,
worker address), so anyone who knew (or guessed) both addresses could compute it, derive the
mailbox keys and read what was pinned: offers, paystubs, W-4s, hours, threads. Business
addresses are visible on chain (public fees), and worker addresses are on the name registry.

`employer_agreement_v4` takes `parties_key` as an input and never checks how it was made, and
both sides already read it from their private records. So the fix needs no Leo change:
- `sendOffer` draws 32 random bytes for each new pair (`newPartiesKey`);
- a revised offer keeps the pair's key (`partiesKey` input), so the conversation carries on;
- an address-derived key passed in is replaced (`isDerivedPartiesKey`).

Pairs linked before the fix (testnet only) keep their old key until they get a new offer. The
unused `@pnw/w4-crypto` package (the portal's IPFS W-4 sharing, same derived key) is marked
legacy and do-not-use. THREAT_MODEL updated.

Tests 766/766 (+4, in `offer.test.ts`):
- every pair gets a fresh key, never the address-derived one;
- the key goes on the chain, seals the terms and lands on the link;
- a revision keeps it;
- an old key is replaced and a malformed one refused.

## 2026-10-16: Messages between a business and its team

Joshua: the full messaging suite, starting with business ↔ team. The premium-tier line is to be
drawn later.

- **Plain messages on the existing thread** (`books/thread.ts`): a `text` message type, from
  either side, up to 4,000 characters.
  - Their messages carry a `read` mark; mine carry `receivedAt` from the other side's receipt
    (`markDelivered`).
  - Helpers for the screens: `unreadIn`, `markThreadRead`, `preview`, `revisionOf`.
- **Receipts:** reading any thread message sends a receipt back (`chain/thread.ts`).
  `awaitingReceipts` lists my latest 20 messages not yet heard back about.
- **Conversation screen** (`chain/Conversation.tsx`, the same on both sides):
  - Opening it reads their new messages, looks for receipts for mine, and marks theirs read.
  - Bubbles for messages; a short card for each negotiation step, with "See the offer".
  - A composer with Send. Under the last one of mine: "Sent" or "Received <time>".
  - No Shield needed.
- **Pages:**
  - `/messages` (business): one conversation per team member, linked or with an offer out.
  - `/work/messages` (person): one per business.
  - Both lists show the latest message and an unread count. "Messages" is in both navs with an
    unread badge.
  - The address bar names a conversation by team member id or agreement id, never by its key.
- **Mailbox feed:** keeps only offer and negotiation events; plain messages live in Messages.

THREAT_MODEL covers messages. Tests 772/772 (app 384, +10). Screens are checked by typecheck and build;
two accounts on two devices is the real test.

**Next:** group messages and announcements (a group key per business, sent to each member
through their own thread, replaced when someone leaves).

## 2026-10-16: Announcement channels

Part 3 of the messaging suite: the business posts once, and everyone in the channel reads it.

- **Model** (`books/channels.ts`):
  - A channel has a random 32-byte key, numbered (`epoch`), and a member list.
  - New thread messages (from the business only):
    - `channel`: sends the key, or a new one;
    - `channel_left`: tells a member they were taken out.
  - Posts are sealed once with the channel key (kind `ann_<epoch>`), in slots only the business
    writes.
  - Taking someone out moves the channel to a new key that only those who stay get.
  - The person's channels are rebuilt from their thread, in order, every time it changes
    (`updateWorkThread`), so the keys and "left" always match what the business sent.
- **Transport** (`chain/channels.ts`):
  - `sendChannelKey`, `postToChannel`, `readChannel`.
  - Readers send a receipt through their own thread (kind `ch_<channel>_<epoch>`).
  - `awaitingSeen` / `readSeen` give "Seen by 3 of 5" for the latest 5 posts.
- **Business** (`/messages`, `chain/Channel.tsx`):
  - An Announcements section with **New channel** (name, pick linked team members).
  - Each channel has posts with "Seen by n of m" (tap to see names), **Who's seen it**,
    **People** (add or take out), and a Post box.
  - The list page checks every conversation when it opens (`chain/MessagesCheck.tsx`).
- **Person** (`/work/messages`):
  - An Announcements section with unread counts. Opening a channel marks its posts read.
  - **Reply privately** goes to that business's conversation.
  - The list page checks every conversation and channel when it opens
    (`chain/work/MessagesCheck.tsx`). The nav badge counts unread posts too.

THREAT_MODEL covers channels. Tests 781/781 (app 393, +9), including end to end through a fake
mailbox: the key reaches two members, a post reaches both, both show as seen, then one is taken
out and can't read the next post while the other can. A forged post under another key is skipped.

**Next:** the opt-in coworker directory, coworker ↔ coworker messages (keys only the two coworkers
hold) and group chats.

## 2026-10-16: Coworker directory and private coworker messages

Part 4 of the messaging suite (group chats come next).

- **Opt-in directory** (`books/directory.ts`).
  - On Messages → Coworkers, a person who works at a business (an accepted agreement) can tap
    **Let coworkers find me** under a name they choose.
  - Their device makes a P-256 key pair for that business only and sends the name and public
    key to the business (`directory_join`). **Stop letting coworkers find me** sends
    `directory_leave`.
  - On its Messages check, the business passes the list of everyone who opted in (`directory`)
    to each of them whenever it changes, and an empty list to anyone who left
    (`businessDirectory`, `directoryDigest`, `owedEmptyDirectory`). Its Messages page shows how
    many opted in.
- **Coworker messages** (`chain/coworkers.ts`, `chain/work/CoworkerChat.tsx`).
  - The pair key is ECDH plus HKDF-SHA256 over both public keys, so only the two coworkers can
    make it.
  - The conversation uses its own slots (`cw_a`/`cw_b`, by key order) and the shared
    conversation screen, accepting plain messages only.
  - A **safety code** (6 groups of 5 digits) to compare in person, and **The numbers match**
    marks it checked.
  - The worker's Messages check reads every coworker conversation. Unread counts are in the
    list and the nav.
  - The address bar names a coworker by a tag from their public key and the agreement it's
    under, never by a key.
- **Supporting changes:**
  - `chain/thread.ts` takes optional `kinds` and an `accept` filter.
  - `Conversation` takes them too, plus a subtitle.
  - Directory bookkeeping messages are hidden from conversations.

THREAT_MODEL covers coworkers. Tests 791/791 (app 403, +10). Covered:
- the pair key matches on both sides and differs with anyone else;
- the safety code is symmetric and changes if a key is swapped;
- a coworker conversation through a fake mailbox skips anything but plain messages;
- the directory: joins, leaves, duplicates, the empty list owed;
- the vault fields.

**Next:** group chats (everyone can post): a group key handed out through the coworker or
business threads, each member posting in their own slots.

## 2026-10-16: Group chats between coworkers (messaging suite complete)

Part 5, the last of the messaging suite.

- **No group key.** Each group message goes to every member separately, through the private
  coworker conversation the two already share, with the same message id everywhere
  (`chain/groups.ts` `fanOut`). So:
  - a member can't pass as someone else;
  - the business can't read any of it;
  - taking someone out means they simply get nothing new.

  Groups hold at most 25 people (one send per member per message).
- **New thread kinds**, between coworkers only:
  - `group`: the admin's setup (name, members), sent to everyone before and after a change;
  - `group_text`: a message;
  - `group_leave`: someone leaving.

  Business-and-person threads refuse all three; coworker threads accept them along with plain
  messages.
- **Rebuilding groups** (`books/groups.ts` `groupsFor`) from the coworker conversations:
  - the latest setup that came from the admin themselves (a member can't fake one);
  - messages deduped by id;
  - who left, and nothing from a member after they leave.
  - Unread counts per group.
- **Screens.** Under Messages → Coworkers:
  - **Group chats** with **New group** (name, pick coworkers).
  - The group view shows who said what, a Send box, **People** for the admin, and **Leave the
    group** for anyone.
  - One-to-one coworker chats show only their own messages; group messages live in the group.
  - `markItemsRead` marks a group's messages read in every conversation they came through.

THREAT_MODEL covers group chats. Tests 796/796 (app 408, +5). End to end through a fake mailbox:
- three coworkers; the group reaches all;
- one message id for every copy;
- a removed member sees they're out and gets nothing new;
- a member's fake setup is ignored;
- leaving works;
- business threads refuse group messages.

The messaging suite is complete: counter-offers, business ↔ team messages, announcement channels,
the opt-in coworker directory with private coworker messages, and group chats.

**Next:** the scale and hardening PR (Joshua to pick how the mailbox finds a pin: a hash-only
index, or batching and caching within the no-database rule).

## 2026-10-16: Plan for operating costs, fees and hosting

Docs only. BUILD_PLAN gains "Operating costs, fees and hosting":
- **The goal:** no monthly subscription. Bookkeeping stays free; a flat fee per paycheck paid on
  the rail, plus name sales, pays for hosting.
- **Cost estimates:** R2 free tier ≈ 150–200 businesses of ~10; Vercel Pro $20; ≈ $120 a month at
  ~20k workers.
- **Break-even:** about $0.003 a paycheck. Proposed fee $0.03–$0.10 with a monthly cap.
- **Privacy:** the fee is flat (never a percentage), collected once per run as one private
  transfer, so it reveals neither wages nor headcount.
- **Hosting:** hosted (covered by the fee) or self-hosted (own mailbox, no fee). The mailbox
  address becomes a setting.
- **The scaling plan:** R2 object storage, a batch endpoint, rate limits.

New open decisions: the fee amount and cap, the operating-wallet exception to "no protocol
treasury", and where the other half of each name sale goes. Recorded: "no monthly subscription"
wording, and the R2 move.

## 2026-10-16: Site says "No monthly subscription"

Joshua: say "no monthly subscription" rather than "free".
- The hero now reads "No monthly subscription. Works offline." "No sign-up" is gone: setup now
  links Shield and registers a name.
- The "Free" section is now "No monthly subscription". The books stay free; private payments
  carry the network's fee; and once on the main network, a small flat fee per paycheck paid this
  way goes toward running the service. It is never a percentage of pay, and a business that runs
  its own copy pays nothing.
- The meta description matches.

Joshua: present "two ways to run it" as a feature. The pricing section now offers:
- **Run your own** (open source; host your own copy and mailbox; pay only your hosting and the
  network's fees; nothing to us);
- **Join the Hewn network** (we carry and store your sealed documents and connect you with
  everyone on it, for a small flat per-paycheck fee once on mainnet).

BUILD_PLAN records it, and notes that the mailbox address must travel with each agreement, so
one person can work for a self-hosted business and a hosted one at once.

Still out of date on the site, for a wider copy refresh (needs Joshua's go-ahead): "no account to
create", "nothing is uploaded" and "no server". They predate the required Shield link and name,
and the mailbox, which carries sealed documents. Site tests 7/7; site build green.

## 2026-10-16: Private network fees, a test switch

Joshua: keep the books and payments as private as possible. Only `.hewn` names and job postings
are public. That includes the network fee: a public fee (`fee_public`) names the address that
sent the transaction. Anyone could count a business's payments on payday, which is close to its
headcount, even with every amount hidden. A private fee (`fee_private`) is paid from a credits
record and names no one.

Why `privateFee: false` was required: April's note says Shield tried to pay from a private credits
record, couldn't find one, and dropped the proof silently. Testnet faucet credits arrive public, so
the accounts most likely held no private ALEO. This needs testing before it becomes the default.

- **`@pnw/wallet/fee-mode`**: `readFeeMode` / `writeFeeMode` keep this device's choice
  (public unless private is chosen; a blocked browser store reads as public); `withFeeMode` sets a
  call's `privateFee` to the mode. A per-device convenience while it's tested, not a book of record.
- **`chain/shield.ts`**: every transaction the app sends goes through `useShield`'s wallet,
  whose `executeTransaction` now applies the fee mode at the moment of sending. That covers
  offers, withdrawals, revisions, payments, splits, names, profiles and acceptances, on both sides.
  It never falls back from private to public on its own.
- **Dashboard balances card**: "Pay network fees privately (testing, this device)", next to the
  private ALEO that pays it. With it on and no private ALEO, the card says so.
- Docs: THREAT_MODEL T6 (the fee names the sender), BUILD_PLAN decision (private fees by
  default), CLAUDE.md's Shield fact.

Test plan (Joshua, testnet):
1. In Shield, move a few ALEO from Public to Private.
2. Turn the switch on, create an offer to an account, then withdraw it.
3. On the explorer, each transaction's fee should be `credits.aleo/fee_private`, with no address.
4. Next, two payments at once: do two private fees pick different credits records?

Tests: 799/799 (3 new in `fee_mode.test.ts`).

## 2026-10-16: Design for letters on chain (`docs/LETTERS.md`)

Joshua: carry messages on Aleo itself, with no IPFS or Cloudflare; find exactly how. This entry is
research and design only. Nothing is built or deployed.

The design:
- `hewn_letters_v1.aleo` has one call, `send(to, lookup, parcel)`. It creates a `Letter` owned
  by the recipient and a `SentLetter` owned by the sender, with no mapping and no finalize.
- The parcel is today's sealed envelope, padded to 34 fields (1,054 bytes).
- The lookup is today's mailbox lookup id, so the thread code stays.

Sources: snarkVM master and Leo 4.4.5 source, plus the SDK 0.10.1 and adaptor type files. Key
findings:
- **Fee:** storage only, 1 µc per byte up to 5 KB and quadratic above. That comes to an
  estimated 4,000–7,200 µc a letter (not measured).
- **Text per letter:** about 900 characters.
- **Sender:** the chain already gives the recipient the sender's address, through a sender
  ciphertext only the owner can open.
- **Leo:** 4.4 replaced `self.signer` with `std::ctx::signer()`.
- **Shield:** it has no sign-only or batch API, so fee sponsorship and delegated proving are out.
- **Files:** too big for chain under the quadratic fee. They need another home.

Open for Joshua:
- which model writes the Leo;
- where files go;
- a fan-out variant for announcements;
- addresses in the coworker directory;
- the chat length limit.

Tests: unchanged (docs only).

## 2026-10-16: Offers without files, one big letter box

Joshua: remove PDFs, and give the offer a bigger text box so a business can paste everything in
the simplest way. Files are also too big for letters on chain (`docs/LETTERS.md`).

- **Offer form:** the four letter sections and the file picker are gone. In their place is one
  "Offer letter" box: 14 rows, resizable, up to 20,000 characters, with a counter. Its text is
  written into the letter's `description`.
- **Letter format:** unchanged (terms version 2, four sections, `files: []`), so offers already
  sent and accepted read as before. A letter written in the one box shows as "Offer letter"; an
  older one shows each of its sections under its heading (`LetterSections`).
- **Counter-offers:** the editor's four section boxes are one "Offer letter" box.
  `proposalChanges` compares the letter as one text (`letterText`: an older letter's sections
  joined under their headings), with the field `letter` and the label "Offer letter".
- **Revised offers:** these carry no files. An older offer's saved files are discarded once it is
  withdrawn, and the screen says the revision goes without them.
- **Older offers:** a person can still fetch and check an older offer's files, and withdrawing one
  still clears its pieces (`chain/offer_files.ts`, now marked legacy).
- **Docs:** THREAT_MODEL (files only on older offers), LETTERS (decided: no files; the long-letter
  size on chain), BUILD_PLAN decision.

Next (separate PR): specific boxes in the offer for pay, pay period, employment type and hours,
each negotiable in a counter-offer.

Tests: app 409 (offer tests rewritten without files; 2 new for the single box).

## 2026-10-16: Offer boxes for pay, employment type and hours

Joshua: give the offer specific boxes for rate of pay, pay period, employment type and so on, so
a counter-offer can work field by field.

- **Offer form:** it has its own boxes for "Paid by" (hour or salary), rate, "Paid" (how often),
  employment type and hours a week, beside the start date. Pay starts from the team member's
  record. Once the offer is sent, the books pay what it says (`updateWorker`, as revisions
  already did).
  - Employment types: Full-time, Part-time, Seasonal, Temporary, Contract (fixed term), or "Not
    stated".
  - Hours are written one way ("40", "37.5"; more than 0 and at most 168, two decimals).
- **Terms (version 2):** `employmentType` and `hoursPerWeek` come after `files`, each only when
  given. An offer without them keeps its exact bytes and hash. Both sides of the contract
  (`chain/terms.ts`, `books/work.ts` + `chain/work/terms.ts`) share `validateJobFields`
  (`books/terms_words.ts`).
- **Drafted terms:** a new "Employment: Part-time." line after the role. Hours are worded through
  `hoursLine`.
- **Counter-offers:**
  - `Proposal` carries the two fields, and the editor has the same boxes (`JobBoxes`).
  - `proposalChanges` lists "Employment" and "Hours" between pay and start date ("Not stated"
    when absent).
  - `syncTermsText` keeps the written lines in step.
  - Revised offers send the fields on.
- **The person's offer view** shows Employment and Hours when the offer has them.
- **Design:** letters on chain rotate to a new random key at least every 24 hours, and old keys
  stay in the vault (`docs/LETTERS.md`, BUILD_PLAN decision).

Tests: app 422; new tests for job fields, the terms contract, counter-offers, the draft and
sendOffer.

## 2026-10-16: The offer comes first; remove team members added by mistake

Joshua: having to add someone to the team before sending them a job offer is backwards. He also
wanted wrongly added team members cleared. Redeploying wouldn't do that: the books live only in
each device's encrypted vault, not on a server. So the app gained a Remove instead.

- **Team:**
  - "Send a job offer" is now the first button. It finds the person by registered name or
    account and opens the offer panel for them, with "Their name in your books" prefilled from
    the registered name.
  - The old way, "Add someone already working here", is still there, as is "Send offer" on a
    team member's row.
  - When the team is empty, the job offer opens by default.
- **`books/hiring.ts`:**
  - `hireByOffer`: a sent offer adds the person as an inactive team member (left out of pay runs)
    with the offer's pay and the default W-4. It records who they are on the registry, and the
    link carries `joinsOnAccept`. The row reads "Offer out: they join the team when they accept".
  - `acceptOffers` (used where Shield's agreements are read): an accepted offer links them and
    makes them active, and the flag goes.
  - `dropOffer` (Withdraw offer): the link goes, and so does someone the offer was hiring. A team
    member who was already in the books is typed again.
  - Revised offers keep `joinsOnAccept`. If a revision fails after the withdrawal, the person
    being hired is taken out.
- **Remove:** a team member never paid, with no offer out, can be removed (with a confirmation):
  `removeFromTeam`, via `removeWorker` and `hasBeenPaid` in `@pnw/payroll`. Anyone paid is
  deactivated instead, so the books keep their history. An accepted agreement stays on the
  network; only the books forget it.
- **`RailLink.joinsOnAccept`:** true or absent, and dropped once linked (`validateLink`,
  `markLinked`).

Tests: 820/820 (7 new in `hiring.test.ts`).

## 2026-10-16: Letters on chain, the program and the app's codec (not wired in yet)

Joshua: no stopgap mailbox key; build letters on chain as intended. He approved writing the Leo
with Opus, because Fable was at its limit. The rule's flag was given and negative tests are
included.

- **`hewn_letters_v1.aleo`** (PNWBNW/pnw_mvp_v2 #202):
  - `send(to, lookup, parcel[field; 34])` creates a `Letter` for the recipient and a
    `SentLetter` for the signer.
  - `send_page(to, lookup, page[field; 256])` creates a `Page` for the recipient.
  - No mappings, no finalize, `@noupgrade`. It refuses the zero address and an all-zero lookup.
    The bytecode is 1.3 KB.
  - Seven Leo tests (four must fail), checked by mutation: removing `send`'s checks turns exactly
    its two must-fail tests red. They run in that repo's CI.
  - A new workflow, deploy-new-program, is check-only by default and refuses an id that is
    already deployed.
- **App: `chain/letters.ts`:**
  - Bytes become field elements (31 bytes each, little-endian), each parcel padded to its call's
    fixed size behind a 2-byte length.
  - The lookup becomes two u128 halves. `letterCall` picks `send` or `send_page` by size.
  - `parseLetterRecord` reads Shield's records, checked against the real plaintext format from
    `leo run`.
  - `LetterBox` has the mailbox's put/get/drop shape: put = one approval, then a wait for the
    network; get = one read of the wallet's letters; drop does nothing; no receipts.
  - The program joins `PROGRAMS.letters`. It joins `WALLET_PROGRAMS` only once it is deployed
    (asking Shield for a program that doesn't exist yet could break connecting); then people
    reconnect Hewn in Shield once.
- **Next:**
  1. Deploy: Joshua taps broadcast.
  2. A test letter to yourself on testnet: fee, proving time, and whether Shield finds it.
  3. Offers' terms as a page, and threads as letters.

Tests: app 9 new (letters); Leo 7/7.

## 2026-10-16: hewn_letters_v1 live on testnet; "Send a test letter"

Joshua ran deploy-new-program: first as a dry run, then with broadcast (run 38937150717).
- **Deploy transaction:** `at1pxclare6clej0feuzcncngmwvma44g0hg2ngsh763gltk0rz6qpqgtfqnt`; fee
  transaction `at1xpqcty50j8ndnfzt5nry4wc3cmme3tjqmht72enzug9us06y0gpsrmlwek`.
- **Deploy cost:** 14.955127 credits (synthesis 9.58, storage 4.37, namespace 1).
- **Leo's cost summary per call:** `send` 0.006578 ALEO, which is the estimate's range; `send_page`
  0.086886 ALEO. Recorded in the pnw_mvp_v2 manifest (#203).

App:
- **The program joins `WALLET_PROGRAMS`.** An existing Shield connection may need disconnecting
  and connecting again before Shield knows it.
- **Settings → "Send a test letter"** (`chain/letter_check.ts`, `chain/LetterCheck.tsx`):
  - One `send` to this account itself, carrying a line sealed with a throwaway key.
  - It reports: tap-to-accepted time (approving included), the fee and whether it was paid
    privately (`parseFeeKind`, new in `@pnw/rail`), whether Shield lists the letter and the
    sender's copy and how soon, whether Shield shows a sender, and whether it opened.
  - The report has no account in it and can be pasted into a chat.

Next: Joshua runs the test, ideally with the private-fee switch on (it tests both at once). Then
offers' terms go out as a page and threads as letters.

Tests: all green (2 new for the check, 1 for the fee kind).

## 2026-10-16: The test letter shows what the network sees

Joshua: the test letter's report should show what exactly is broadcast, not only the transaction
id. `describeBroadcast` breaks the public transaction down from the explorer's own copy (the view
anyone has). For each call it gives:
- inputs and outputs by kind (private, public, record, future);
- each record's ciphertext length;
- whether a sender ciphertext is attached;
- any value left readable (an account in one is printed as "an account").

For the fee transition it says whether the payer is shown (`fee_public`) or not (`fee_private`).
It also gives the JSON size and an explorer link.

Tests: all green (1 new).

Then Joshua: let the test letter say whatever he types.
- **"What it says" box** in the panel, showing live whether the text goes as a letter (up to
  1,023 bytes, about 0.0066 ALEO) or as a page (up to 7,905 bytes, about 0.087 ALEO), or is too
  long. A page uses `send_page`, which has no sender's copy, so both calls can be measured.
- **The words read back** from the network show on screen. The report gives only their size, so
  it stays safe to paste.

Tests: all green (1 more).

## 2026-10-16: First letters on testnet (Joshua's phone, Shield)

1. **`at1gl7jhc6utv47le0e20v0sywqhtrrludlt9mt7w4y4tdluzr3vu8qeddmsn`:**
   - 13.6 s from tap to accepted, approving included.
   - Fee 0.006578 ALEO, exactly as the deploy summary said.
   - Shield listed the letter and the sender's copy in 0.7 s and shows a sender on it.
   - It opened and read back.
2. **`at1vnq22xz4jmv852qq3h6d3qn82ld683ng2rzvydlxa7p4zzk2j5zsyugujm` (custom 50-byte message):**
   - 73.7 s; same fee and the same results, read back word for word.
   - The network sees: `send`; 3 private inputs; 2 records of 2,311 ciphertext characters each,
     both with a sender ciphertext; nothing readable. The transaction is 12.6 KB of JSON.

**Finding:** the fee went out as `fee_public` both times, though Joshua's dashboard switch was on.
So Shield ignored `privateFee: true`, or fell back to a public fee. Not yet known:
- whether the account held private ALEO;
- whether the public fee was paid by this account or by a sponsor (Provable says it covers some
  Shield fees).

The report now says which fee mode the app asked for ("Fee asked for"), and whether a public fee's
payer is this account or another, without printing either account.

Joshua then: let the person choose, right before each send, whether its fee is paid privately or
publicly.
- **`chain/FeeChoice.tsx`:** a Private / Public choice next to the send button. It starts from the
  device's switch and changes only that send. The test letter uses it now, and the message send
  box gets it when messages move onto letters.
- **How the choice travels:** as `feeMode` with the call (`Call.feeMode` in
  `chain/work/execute.ts`, `LetterBox.put` options). `chain/shield.ts` turns it into
  `privateFee`, falling back to the device's switch when there is none.

Joshua's Shield shows 5.072712 ALEO private (shielded before the three test letters), yet all
three paid `fee_public`. Shield seems to ignore `privateFee: true` for dApp calls, or pay publicly
anyway. The next test, with "Private" chosen and "Fee asked for" in the report, settles whether
the request reached Shield.

Tests: 835/835.

## 2026-10-16: Shield's sponsor pays the fee; offers go as letters

**Finding** (`at14j5vyy9dmztdajcsy7qhtejw3736ssd93dtlcy70a5dwjennwv8qvkdhuk`, "Fee asked for:
private"):
- The fee was `fee_public`, but paid by *another* account, not Joshua's. Shield sponsors dApp fees
  (Provable covers them), so the public sees the sponsor's account and not the sender.
- The sender paid nothing; his Shield activity shows the letters with no amount.
- Shield ignores `privateFee: true` for these calls.
- Recorded in THREAT_MODEL T6 and LETTERS. The per-send fee choice stays in case sponsorship
  changes.

**Offers go as letters** (Joshua hit "Offers need the mailbox" again: offers hadn't moved yet):
- **`chain/compress.ts`:** a document is deflated before sealing when that's smaller (a 0x01
  marker, then deflate-raw; plain JSON starts with `{`). A long offer letter then fits in one page.
- **`sendOffer`:**
  - The terms are packed, sealed, and refused before Shield is asked if the envelope is over a
    page ("too long to send on the network").
  - They go through `client.put`, which is now a `LetterBox` to the person: one `send_page`.
  - The person's fee choice (`feeMode`) goes with both the page and `create_offer_open`.
- **The offer panel:** the review step has the Private/Public fee choice, and the copy says Shield
  asks twice (the terms page, then the offer).
- **Revised offers:** these send their terms as a page too, with three approvals in all.
- **The person's side:** `fetchTerms` reads through `lettersThenMailbox`: the wallet's letters
  first, then the old mailbox for offers sent before (a mailbox that's off reads as empty). It
  unpacks deflated terms.
- **Not moved yet:** offer receipts (best effort; the business sees "Sent", not "Received"),
  thread notes, counter-offers, timesheets, paystubs and channels still use the mailbox. They move
  next.

Both accounts need to reconnect Hewn in Shield once, so Shield knows the letters program.

Tests: 841/841.

**Messages go as letters** (business ↔ person; Joshua: messages need an accepted offer to link the
accounts, then they should work without the mailbox):
- **The conversation** (`chain/Conversation.tsx`, both sides) now takes the other side's account.
  - It connects Shield (`chain/letter_reader.ts` `useLetters`), sends each message as a letter to
    that account (one approval) and reads the account's letters, then the old mailbox.
  - A compact Private/Public fee choice sits under the send box. A message too long for a letter
    goes as a page.
  - No receipts: the last message of yours reads "On the network". Coworker chat still uses the
    mailbox, with receipts.
- **Counter-offers** ("Ask for changes"): a letter (a page when the offer letter is long), with
  the fee choice.
- **"Keep the offer as it is"**: a letter, behind Shield now.
- **Revised offers:** the "this replaces that" note is a letter, a fourth approval. The fee choice
  now covers the revised terms, the offer and the note.
- **The checks** behind the Messages lists, the Mailbox page and Offers read letters once Shield
  has reconnected (they wait up to 4 s), else the mailbox alone. A mailbox that's off no longer
  stops letters being read.
- **`chain/thread.ts`:** every thread message is deflated before sealing when that's smaller
  (older, uncompressed messages still read).
- **`LetterBox.put`:** refuses a slot this account already sent a letter under (another device or
  an earlier try) as CONFLICT, so the thread steps over it without paying for a transaction.
- **Still on the mailbox:** channels (announcements), the coworker directory, coworker and group
  chat, timesheets, paystubs, offer receipts.

Tests: 846/846 (5 new: `chain/thread_letters.test.ts`).

## 2026-10-16: paystubs and timesheets go as letters

Joshua tested #89 (messages as letters) and it worked; "let's build the rest".

- **Paystubs:**
  - Each paystub is deflated, sealed and sent to the person as a letter (one approval).
  - The pay panel sends them after all payments finish, one at a time, so a letter never races
    a payment in Shield.
  - Resend on a paystub connects Shield first.
  - Tests check that a paystub fits in one letter (not a page).
- **The person's paystub check:**
  - Connects Shield and reads letters, then the old mailbox.
  - Receipts for hours sent through the old mailbox are still read, best effort.
- **Timesheets:**
  - Each week goes to the employer as a letter (one approval) with the fee choice.
  - The business's Mailbox check reads weeks of hours from letters, then the old mailbox.
- **Cleanup:** removed the "delivery is off on this server" states for paystubs and timesheets.
- **Still on the mailbox:** channels (announcements), the coworker directory, and coworker and
  group chat. Those need Joshua's call:
  - **Announcements:** a post to N people is N letters (N approvals) with `hewn_letters_v1`. A
    fan-out call needs a new program.
  - **Coworkers:** coworkers know each other by a P-256 key, not an Aleo address.

Tests: 846/846 (two existing tests now also check one-letter fit).

## 2026-10-16: coworkers go as letters (accounts shared on opting in)

Joshua chose "share address, opt-in" for coworker chat, and send-to-many (`hewn_letters_v2`, PNWBNW/pnw_mvp_v2 #204, waiting to
deploy) for announcements.

- **Directory entries:**
  - Each entry now carries the person's account. The business adds it from its own link to that
    person (the account the offer went to), never from the join message.
  - Older lists have no accounts, and their digest differs, so the business is prompted to send
    the list again.
- **The business's coworker list:**
  - It is no longer sent in the background by the Messages check.
  - The Messages page says when the list changed and offers "Send the list": one letter per
    person, with the fee choice (`chain/SendDirectory.tsx`, `directoryOutbox`).
- **The person's side:**
  - Joining or leaving the directory is a letter to the business.
  - The join copy says your account is shared with coworkers who opted in.
  - 1:1 coworker chat uses letters to the coworker's account. With no account on the list it
    falls back to the old mailbox.
  - Group chats (make, message, edit, leave) send one letter per member, with Shield gating
    (`chain/work/coworker_letters.tsx`). They move to send-to-many with announcements once v2
    is deployed.
  - The background check reads coworker letters too. A mailbox that's off no longer stops it.
- **Limit:** the coworker list must fit one page (about 7.9 KB packed, roughly 40 people opted in).
  A larger list is refused as too long to send.

Tests: 848/848 (new: the outbox, accounts from the link, a bad account refused).

## 2026-10-18: hewn_letters_v2 deployed; announcements go as letters

Joshua deployed `hewn_letters_v2.aleo` on testnet (deploy-new-program run 39170375139).
- **Deploy:** transaction `at177xpwtt9kdlffahrrnzdwv335g9lys63auye7zw3gtju09ghxu8q9jlauk`, fee
  transaction `at1sthw0xvmuu3xz0vw7lg75j58qhr7j2d2ru88v7t2ffsw99vzqgps8mn0y5`.
- **Cost:** 21.611652 credits (synthesis 14.627, storage 5.983, namespace 1). Per call: `send`
  0.006578, `send_page` 0.086886, `send_many` 0.056052.
- **Recorded in PNWBNW/pnw_mvp_v2 #205:** the manifest names v2, v1 stays listed as legacy for
  reading, and v1's source is archived unchanged.

The app:
- **Programs:** sends with v2 and reads letters from both v2 and v1. Both are in `WALLET_PROGRAMS`,
  so each account reconnects Hewn in Shield once.
- **Announcements:**
  - Making a channel, or changing who's in it, sends the key to each member in a letter, one
    approval per person.
  - A post goes to every member through `send_many`, one approval for each eight
    (`ManyLetterBox`, `manyCalls`). Every copy is the same parcel under the channel slot's lookup,
    and the business's own account fills the unused places.
  - Posts are deflated before sealing and capped at 1,500 characters so they fit one letter.
  - "Who's seen it" is gone: letters have no receipts.
  - The person's check reads posts from letters, then the old mailbox.
- **Group chats** still send one letter per member: each copy is sealed under a different pair's
  key, so `send_many`'s shared parcel doesn't fit them.

Tests: 853/853 (new: reading v1 letters, `manyCalls` grouping, padding and refusals, the slot check
for `send_many`, and an announcement end to end over a fake network).

## 2026-10-19: the job board program, and posting from the Jobs page

**Program** (PNWBNW/pnw_mvp_v2 #206, #207, merged; Joshua deploying): `hewn_jobs_v1.aleo`, the
public job board. Postings live in public mappings (`postings`, `posting_body`, `posting_count`,
`posting_at`, walkable from the explorer with no server); applications and everything after them
are letters. Calls: `post` ($1 USDCx to the Hewn foundation, plus the network fee), `update`
(free), `feature` ($5 a day, 1 to 30 days, never more than 30 days ahead), `close` (free). Every
call is gated by `pnw_name_registry_v2::assert_employer_owner` on the signer and the name's
industry code, so only a business `.hewn` name can post (a worker name has code 0; forks can't post).
31 Leo tests, 26 must-fail, mutation-checked; local stubs for the registry and USDCx. Codex's
sellback point (a name sold back and re-registered carries its old postings to the new holder) left
as is: a posting belongs to the name. Design: `docs/JOB_BOARD.md`.

**The app** (this PR):
- `packages/config` names `hewn_jobs_v1.aleo`; it is in `WALLET_PROGRAMS` after USDCx, so each
  account reconnects Hewn in Shield once.
- `books/jobs.ts`: the business's own copy of each posting in the vault (`jobs` on the company
  file), with the same checks the program makes (pay range, hidden pay, kinds, 168 hours), and the
  words' limits (title 80, location 80, description 4,000 characters).
- `chain/jobs.ts`: the encodings (the words as a JSON array, deflated, packed into 40 fields like a
  letter: 1,238 bytes), the four calls with their inputs, the explorer reads (count, index, posting,
  body, the newest N), board order (featured and current first, then newest), and the feature maths
  (days allowed, where the window ends).
- **Jobs page** (`/jobs`, business navigation): the list from the vault; New posting, Change,
  Feature and Close open `chain/JobPanel.tsx`, Shield-gated on the linked account, which reads the
  name's industry code from the registry and sends one call per approval. Posting shows "$1"; feature
  reads the current height and the posting's window from the chain first and offers only the days
  still allowed, with the cost.
- Not yet: the public board page (marketing site and the worker's "Find work"), applying (name +
  message + resume text, builder, local PDF import), the person's applications list with statuses,
  and the business's applicants per posting (interview, offer, not selected).

Tests: 872/872 (new: posting facts and words, the vault's postings and the company file, posting
ids, the body codec with deflate and refusals, the calls' inputs, featuring maths and board order,
parsing the explorer's postings and walking the newest with a fake read).

## 2026-10-19: the job board page, public

`/board`: every open posting, for anyone, with or without an account (hewn #95).
- **Public path:** the first page that renders without open books. `BooksGate` lets `/board`
  through, and `AppShell` shows a bare header (the brand, "Open Hewn") instead of the rail until
  the books are open; neither role is redirected away from it. A worker gets "Find work" in the
  navigation; a business reaches it from the address bar (its own postings are under Jobs).
- **Not on the marketing site:** the site is a brochure with no chain reads and a security policy
  naming no host, so the board lives in the app, which already reads the explorer.
- **Reading:** `chain/board.ts` walks the newest 100 postings by index, reads the current height,
  looks up each business's name once through the registry's reverse resolver, orders featured and
  current first (latest window first) then newest, and filters on words (each must appear in the
  title, location, description or business name) and on kind of work, place and pay.
- **The page** (`chain/Board.tsx`, loaded dynamically): search, three filters, Refresh, each posting
  opening to its description, how many days of featuring are left, and for a visitor "Open Hewn to
  apply". A signed-in worker sees "Applying from here comes next" until the next PR.

Tests: 875/875 (new: loading the board over fake reads with names and order, and the filters).

## 2026-10-19: applying from the board, with a resume builder

The private half of the job board (hewn #96): a worker applies to a posting and keeps track of it.
- **Hiring key:** every posting now carries the public half of an ECDH P-256 key pair the business
  made for it (a fourth element in the body); the private half lives in the business's vault.
  Changing a posting keeps its key.
- **Applying** (`chain/applications.ts`, `chain/work/Apply.tsx`): the person's `.hewn` name, a
  message and their resume as text. A one-time key pair and the hiring key make the pair's parties
  key (HKDF over ECDH, salt `PNW::APPLICATION::v1`); the application goes as one letter to the
  business's account under the posting's application lookup (SHA-256 of the salt and the posting
  id, the same for every applicant): the one-time public key in the clear, then the application
  sealed under the parties key as slot 0 of the person's side. One application per posting per
  account (the letter box's slot check). The business will read every letter under that lookup
  (`LetterBox.getAll`, new) and open each with its private half (`unpackApplication`).
- **Resume builder** (`books/resume.ts`): a few questions (name, a line, contact, summary, jobs,
  schooling, skills) become plain text the person edits before sending. PDF import is still to come.
- **Applications** (`/work/applications`, in the navigation): each job applied to, with its status:
  Applied, then whatever the business last said (Seen, Interviewing, Offer sent, Hired, Not
  selected, Posting closed; a new `application_status` message, business-only). The conversation
  is under Messages, named by the posting, and the Messages check reads it like any employer's.
- Messages between the two: `application` (worker-only) and `application_status` (business-only)
  join the thread kinds; an application shows as a card with the resume folded away.

Tests: 887/887 (new: the key agreement from both sides, the application letter opening only with
the posting's key and refusing tampering or another posting, a long resume deflated and one that
won't fit, the thread kinds' side rules, the vault's applications and their status, the resume
text, the body with a hiring key).

## 2026-10-19: the business's applicants

The last piece of the job board loop (hewn #97): from Jobs, each posting has **Applicants**.
- **Reading applications** (`chain/applicants.ts`, `chain/Applicants.tsx`): every letter under the
  posting's application lookup (`LetterBox.getAll`) is opened with the posting's hiring key; each
  new key is an applicant, their account looked up on the registry by their name hash (a name with
  no account yet is counted and left for later), with a conversation in the business's mailbox
  threads under `applicant:<key>`, the application as its first message. Each applicant's new
  messages are read on open and on Check, and by the Messages check.
- **From an applicant:** the conversation (letters both ways), a status (one letter; kept on the
  applicant), an interview (a message with the time and place or meeting link, then the
  Interviewing status), and an offer (the existing offer flow, to their registered name).
- Postings made before hiring keys can't read applications and say so.

Tests: 890/890 (new: opening the letters under a posting, once per key, skipping known keys and
what won't open; applicants kept on a posting with their status and the vault round trip; the
status and interview wording).

## 2026-10-19: hewn_jobs_v1 deployed

Joshua deployed `hewn_jobs_v1.aleo` on testnet (deploy-new-program).
- **Deploy:** transaction `at1354m4j9wxc9st3ukwcl2082s6429ddgx27kfekz500rpzcne4qqse80q4n`, fee
  transaction `at1m7ngn79cd0kpuj92zkkv05lx7aq0wwgzh0sdc9df6dmc6ghvmgpse2cz0s`.
- **Cost:** 8.924390 credits (storage 6.628, synthesis 1.294, namespace 1, constructor 0.002). Per
  call, in ALEO on top of the USDCx fees: `post` 0.020269, `update` 0.014193, `feature` 0.006927,
  `close` 0.003964.
- **Recorded in PNWBNW/pnw_mvp_v2:** the manifest names it under `program_ids.jobs`.
- The app already names it (#94) and has it in Shield's program list; nothing to change here.

## 2026-10-19: the fee choice on a posting says what it doesn't change

Joshua, posting the test job, saw "Private" as a fee option and asked whether a private fee makes
the posting private. It doesn't: the choice only decides which ALEO pays the network fee; the
posting goes into public mappings either way, and the $1 USDCx is a public transfer. The Jobs
panel now says so under the fee choice on post, change, feature and close (`chain/JobPanel.tsx`).

## 2026-10-19: aggregate page views (Vercel Web Analytics)

Joshua asked to see how much traffic the site gets, and chose Vercel Web Analytics.
- **What's counted:** page views in aggregate, on the marketing site and the app. Vercel's
  `@vercel/analytics` 2.0.1 (pinned) in each root layout (`src/PageViews.tsx`). No cookies, nothing
  that identifies a person. The script and its endpoint are on each site's own address, so the
  security policy is unchanged (still `'self'` only; the injected script runs under `strict-dynamic`).
- **What's sent:** the path only. `beforeSend` strips the query string and hash, so nothing a link
  carries (an agreement id, a filter) leaves the page. Books, names, amounts and messages never do:
  they live in the vault, not in a URL.
- **Wording:** the privacy page's "No analytics of any kind" became "Page counts, no tracking, no
  cookies, no third parties", saying exactly what is counted. The app's footer now says the books
  are never sent to a server (it said nothing is). The site's boundary test names the package as
  its one runtime addition.
- **To switch it on:** Vercel → each project (the app, and the site) → Analytics → Enable. Until
  then the script is served but nothing is recorded.

Tests: 890/890; typecheck, build and audit pass.
