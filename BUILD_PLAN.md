# Plumb — Build Plan

Oct 13, 2026 · Joshua Day

> Source of truth for what gets built and in what order. Mirrors the Claude Doc
> "PNW Ledger — Build Plan" (the product is now named Plumb). When an exit criterion is met, tick it here and log it in PROGRESS.md.

## Scope

Target: functional parity with QuickBooks Advanced (small-business tier), minus Intuit Intelligence and support, built clean-room on the existing PNW stack. Same mental model bookkeepers already know; our own screens, our own code.

One codebase, three operating modes, selectable per business and overridable per transaction type:

| Mode | Where money moves | Where the proof lives | Who it's for |
| --- | --- | --- | --- |
| Fiat (default) | Bank, as today | Encrypted local vault only | Intuit refugees, day one |
| Anchored | Bank, as today | BLAKE3 period roots anchored on Aleo | Almost everyone, eventually |
| Settled | USDCx on Aleo (existing payroll stack) | Private records + anchors | Businesses that want on-chain payroll or AP |

The double-entry core, the invariants and the reports are identical in every mode. Only the settlement adapter and the anchor adapter change.

Privacy floor, enforced in-circuit and in the vault, not in the UI: anything tied to an individual (wages, withholdings, bank details, W-4 data, paystubs, worker address) is private in every mode and cannot be flipped public. Business-level entries carry an owner-controlled public/private flag. Aggregates publish only as proofs, with a minimum group size so a one-employee business cannot leak a wage by inference.

Mode upgrades are one-way and double-checked. Moving a business from fiat to anchored, or from anchored to settled, is a deliberate step: the app shows exactly what will go on-chain, requires a second wallet signature after a review screen, and never flips a mode as a side effect of another action. The crypto off-ramp is the last thing a user touches, not the first.

## Ground rules

**Reused as-is from `pnw_mvp_v2` and `pnw_employment_portal_v1`**

- Privacy architecture: records for identifying data, mappings hold only hashes and block heights, commitment-based authorization (`parties_key` commitments).
- The execution boundary: on-chain writes are signed in the user's wallet via the `wallet` executor, with program/transition names from `pnw-adapter`. The CLI adapter / private-key path is legacy: kept in `coordinator` for its tests, unused by new code, removed later. The app never calls `snarkos` directly. Extensions hang off this seam.
- `paystub_receipts` + `payroll_audit_log` as the pattern for all ledger postings (dual records + hash anchor).
- `.pnw` name registry, credential NFTs, employer license gate, wallet-signature session model.
- TypeScript tax engine (`src/lib/tax-engine.ts`, IRS annualization method).

**Retired**

- The Julia tax service (`pnw_payroll_engine/`). One tax engine, in TS.
- localStorage as a book of record (see Phase 1 vault).
- The portal as an app: `pnw_employment_portal_v1` is rebuilt as a QB-shaped shell in Phase 0. Its libraries survive as packages; its screens do not.

**Frozen**

- Every superseded Leo program version (`pnw_name_registrar` v1-v4, `pnw_router` v2-v3, `employer_agreement` v2-v3, `credential_nft` v1-v2, `payroll_core` v1, `payroll_nfts` v1) moves to `programs/archive/`. `config/testnet.manifest.json` stays the single source of truth for what is live.
- Deployed programs are immutable on Aleo. Changes ship as new versions plus a migration path; nothing is edited in place.

**Conventions**

- Production revisions are numbered v1.1, v1.2 in the filename; whole-number bumps on Joshua's call.
- Every phase ends with its exit criteria green before the next starts. A phase can be reordered; it cannot be skipped.
- New Leo programs get a third-party audit before any real books touch them (budget line, not a phase).
- Circuits and ledger invariants on Fable 5.1 at high effort; scaffolding and UI on Opus 5.5 at default.
- Licence stays as-is until the build is done; revisited then.

## Phase 0 — Salvage and scaffold

The portal is rebuilt as a QuickBooks-shaped shell; its libraries are kept. Nothing in this phase changes what the system does, only where it lives.

**Deliverables**

1. Monorepo `pnw` with `apps/business` (the QB-shaped shell: Dashboard, Transactions, Sales, Expenses, Payroll, Projects, Reports, Taxes), `apps/worker` (paystubs, W-4, offers, credentials, timesheet — the Workforce equivalent), `packages/`, `programs/` (Leo), `programs/archive/`.
2. Salvaged into `packages/`, unchanged in behaviour: `pnw-adapter`, `coordinator`, `records`, `manifest`, `tax-engine`, `w4-crypto`, `handshake`, `nft-art`, `pdf`, `commitments`. Each gets its own `package.json` and its existing tests.
3. Shared UI kit: the `components/ui/` primitives plus a design brief for the new shell (left nav, list/detail pattern, transaction forms) written clean-room against the QB mental model.
4. `pnw_employment_portal_v1` and `pnw_mvp_v2` marked read-only once the monorepo is the source of truth; the Julia engine deleted.

**Exit criteria**

- [x] Every salvaged package builds and its existing vitest suite passes inside the monorepo (2026-10-13)
- [ ] A full payroll run (agreement check → USDCx transfer → receipts → audit anchor → cycle NFT) completes end-to-end from `apps/business` on testnet, tx hashes recorded
- [ ] A worker sees that paystub in `apps/worker` with the credential badge rendered
- [ ] The old portal repo is archived on GitHub with a pointer to the monorepo

## Phase 1 — Core ledger

The frozen core. Everything else imports it; nothing else may alter it. Fiat-first: the vault and ledger logic come first; `gl_core.aleo` lands right behind them.

**Deliverables**

1. `gl_core.aleo` (new, Leo v4): `Posting` record (account_id, amount u128, side debit/credit, period_id, memo_hash, dimension_hash, owner), `JournalEntry` anchor mapping (entry_hash → block height), `period_status` mapping (open/closed/locked). Transitions: `post_entry` (N postings in one proof, debits = credits asserted in-circuit), `close_period`, `anchor_period_root`, `assert_period_open`, `assert_entry_anchored`.
2. Chart of accounts: five types (asset, liability, equity, income, expense), hierarchical, normal-balance rule per type. Default templates for service business, contractor, retail.
3. Encrypted local vault: AES-256-GCM in IndexedDB, key derived from a one-time Shield wallet signature over a domain-separated message; same wallet opens the vault on any device. Export/import as one encrypted blob; optional pin to IPFS via existing Pinata path. Check the existing `src/persistence/` layer first; extend it rather than replace it.
4. Headless mode: for fiat-mode users with no wallet, generate a local Aleo keypair on first run, passphrase-protected. The user never sees the word blockchain until they turn anchoring on.
5. Mode switch: fiat / anchored / settled, per business, with per-transaction-type override and the double-checked upgrade flow from Scope.
6. `LEDGER_INTERFACE.md`: every exposed transition, its inputs, what it asserts, what extenders may call.

**Invariants, enforced in-circuit**

- Sum of debits equals sum of credits for every journal entry.
- Every posting references an account that exists and a period that is open.
- A closed period rejects new postings; a locked period rejects reversals too.
- No plaintext amount, account name or memo ever lands in a public mapping.

**Exit criteria**

- [ ] `leo build` and `leo test` green for `gl_core.aleo`, including negative tests (unbalanced entry, closed period, unknown account) that fail as expected
- [ ] Deployed to testnet; program ID in `testnet.manifest.json`
- [ ] A 20-entry sample ledger posted, period closed, root anchored, with tx hashes recorded in PROGRESS.md
- [x] Vault survives browser clear-site-data via export/import round trip, and opens in a second browser with the same passphrase, no wallet required (2026-10-13)
- [ ] Once a Shield wallet is linked, the vault opens with either the passphrase or the wallet; the passphrase keeps working so a lost wallet never locks the books
- [ ] Trial balance from the vault matches the trial balance recomputed from on-chain records in settled mode
- [ ] `LEDGER_INTERFACE.md` reviewed and frozen

## Phase 2 — Payroll bridge

Payroll stops being the product and becomes the first module posting into the ledger. The existing E10 flow stays intact; it gains one step.

**Deliverables**

1. `payroll_gl_bridge.aleo`: imports `gl_core` and `paystub_receipts`. For each settled worker, posts one journal entry: debit Wages Expense (gross), credit Payroll Tax Liability (withheld), credit Cash or USDCx (net), credit Platform Fee Payable (fee). Entry hash binds to the `receipt_anchor`, so every paystub is traceable to its ledger entry and back.
2. Fiat and anchored modes: the same journal entry is written to the vault with a `settled_externally` flag and an optional bank reference, no USDCx transfer.
3. Manifest compiler extension: `PayrollRunManifest` carries the journal entries it will produce; the batch root covers both.
4. Employer-side payroll liability aging: what has been withheld and not yet remitted, by period.

**Exit criteria**

- [ ] A 3-worker testnet payroll run produces three balanced journal entries, each linked to its receipt anchor
- [ ] Running the same payroll in fiat mode produces identical entries in the vault, minus the chain transfer
- [ ] P&L for the period shows the wage expense; balance sheet shows the tax liability
- [ ] Existing payroll tests (`vitest`) still green; no change to worker-facing paystub flow

## Phase 3 — AR/AP and dimensions

This is where it starts to feel like QuickBooks.

**Deliverables**

1. Customers and vendors: records in the vault, hash-anchored; optional `.pnw` name link when the counterparty is also on the platform.
2. Invoices and estimates: line items, sales tax per line (computed and tracked, not filed), terms, status (draft / sent / partially paid / paid / void). Estimate converts to invoice. Batch create.
3. Bills and expenses: line items, due dates, status, batch entry. Receipt image stored encrypted in the vault, hash on the entry.
4. Payments: apply a payment to one or many invoices; record a bill payment. In settled mode, a USDCx transfer; in fiat and anchored, a bank reference.
5. Dimensions, all unlimited: classes, locations, projects (jobs). Every posting carries a `dimension_hash`; the vault holds the plaintext mapping. Project profitability = postings filtered by project.
6. Public/private flag on business-level entries. Default private. Flipping to public writes the entry's fields to a public mapping; flipping back is impossible (chain is immutable), so the UI confirms twice.

**Exit criteria**

- [ ] Invoice → partial payment → final payment → paid, with AR balance correct at each step
- [ ] Bill → payment, with AP balance correct
- [ ] Sales tax liability report ties to invoices for the period
- [ ] Project profitability report for a job with labor (from Phase 2), materials and an invoice
- [ ] A public-flagged invoice is readable from a public mapping; a private one is not; a worker-linked entry refuses the flag at the circuit level

## Phase 4 — Reports and budgets

All reports compute client-side from the vault. Nothing leaves the browser.

**Deliverables**

1. Core statements: profit and loss, balance sheet, cash flow (indirect method), trial balance, general ledger detail. Date range, comparison period, filter by any dimension.
2. Operational reports: AR aging, AP aging, sales by customer, expenses by vendor, project profitability, sales tax liability, payroll summary by period.
3. Budgets: by account and dimension, monthly or quarterly; budget vs actual report with variance.
4. Custom KPI dashboard: user picks metrics (any account balance, ratio of two, trend over N periods), pins them.
5. Proof export: for any report, generate a ZK proof of a stated claim ("net income for 2026 exceeded $X", "books for Q3 reconcile to anchored root") that a third party verifies against the chain without seeing the report.
6. PDF and XLSX export of any report (existing jsPDF and xlsx paths).

**Exit criteria**

- [ ] P&L + balance sheet + cash flow for the sample ledger reconcile to each other (net income flows to equity, cash flow ties to cash balance change)
- [ ] Aging reports agree with open-invoice and open-bill lists
- [ ] Budget vs actual shows correct variance for a two-month sample
- [ ] A proof of "revenue > X" verifies on testnet with a true X and fails with a false X
- [ ] Report render under 2 seconds on a 5,000-posting vault on a mid-range phone

## Phase 5 — Inventory

Parity with QuickBooks Plus/Advanced inventory, not a warehouse system.

**Deliverables**

1. Items: inventory, non-inventory, service, bundle. SKU, description, income account, COGS account, asset account, default price and cost.
2. Quantity on hand, adjusted by purchase (bill line), sale (invoice line), manual adjustment. Low-stock threshold and reorder point.
3. Valuation: average cost at launch. FIFO as a follow-on once average cost is stable.
4. COGS posting at sale time, automatically, as part of the invoice's journal entry.
5. Reports: inventory valuation summary, stock status, sales by item.

**Exit criteria**

- [ ] Buy 10 at $8, buy 10 at $12, sell 5: QoH 15, average cost $10, COGS $50, inventory asset $150
- [ ] Inventory valuation report ties to the inventory asset account balance
- [ ] Manual adjustment posts to a shrinkage/adjustment account and shows in the GL

## Phase 6 — Multi-user, roles, accountant access

No seat cap; the wallet is the user.

**Deliverables**

1. Business as a multi-member entity: an owner wallet plus member wallets, each bound to the business via a `BusinessMembership` record (reusing the agreement commitment pattern).
2. Roles as transition allow-lists: Owner, Admin, Bookkeeper, AP clerk, AR clerk, Payroll, Read-only, Accountant. Each role names which `gl_core` and module transitions it may call and which vault sections it may decrypt. Custom roles compose from the same list.
3. Vault sharing: the vault key is wrapped per member wallet, so each member decrypts only the sections their role allows. Revoking a member re-wraps the key; it does not rotate the whole vault.
4. Accountant access: a scoped view key plus a time-boxed read-only role. The accountant sees books, not bank details or worker PII, and the grant expires on its own. Dual-consent audit path from `audit_nft.aleo` stays as the formal-audit route.
5. Activity log: who posted, approved, voided, with wallet signature on each action. Hash-anchored per period.

**Exit criteria**

- [ ] A Bookkeeper wallet can post an invoice and cannot run payroll; the attempt fails at the circuit, not just the UI
- [ ] An Accountant grant expires on schedule and the former accountant cannot decrypt new vault entries
- [ ] Revoking a member and adding a new one does not require re-encrypting historical postings
- [ ] Activity log for a period reproduces from signatures and matches the UI

## Phase 7 — Workflows and automation

**Deliverables**

1. Approval chains: a bill, invoice, journal entry or payroll run above a threshold routes to one or more approver wallets. Posting happens only after the last approval; each approval is a signed action in the activity log.
2. Recurring transactions: templates queued for one-tap confirm (never auto-posted without a signature).
3. Reminders: overdue invoice, upcoming bill, period not closed, 1099-eligible vendor missing a W-9. Local notifications; optional email via the user's own mail client, never a PNW server.
4. Excel: export any report or list to `.xlsx`; import chart of accounts, customers, vendors, items, opening balances and bank transactions from `.xlsx` or `.csv`. Two-way live sync deferred.
5. Bank import: OFX/QFX and CSV with a column mapper and a saved profile per bank. Matching engine suggests existing invoices/bills for each line.
6. Bank reconciliation: statement balance, cleared items, difference; period lock on reconcile.

**Exit criteria**

- [ ] A bill over threshold cannot post until two approvers sign; the log shows both signatures
- [ ] A monthly recurring invoice appears in the queue on the right day and posts only on confirm
- [ ] A 200-line CSV bank import matches 80%+ of lines to existing entries on a seeded sample
- [ ] Reconciliation difference is zero on the sample statement, and the period locks

## Phase 8 — Extension API and first industry module

**Deliverables**

1. On-chain extension contract: a documented set of `gl_core` transitions extenders may import (`post_entry`, `assert_period_open`, `assert_entry_anchored`); extension programs own their own records and never receive a `Posting` back.
2. Frontend plugin API: a module registers screens, report types, account templates, dimension types and import mappers. It cannot touch posting logic or the vault key. A manifest, a sandboxed entry point, declared permissions.
3. Reference module, `construction`: job costing by cost code, committed costs, WIP report, over/under billing, retainage, change orders. Labor cost flows from the Phase 2 payroll bridge by project dimension.
4. Second module template, empty, with a README showing how a restaurant (tips) or an FBO (fuel sales, into-plane fees) would fill it in.
5. Module registry: a signed list of known modules with their program IDs and hashes.

**Exit criteria**

- [ ] The construction module runs a sample job from estimate through two progress billings with retainage to a final WIP report, and every number ties to the GL
- [ ] The construction module runs on Brothers NorthWest's real books for one month alongside the current system and the two agree
- [ ] An extension that attempts an unlisted `gl_core` call fails to compile; one that attempts to read the vault key fails at the plugin boundary
- [ ] A second developer builds the empty template into a working tips module using only the README and the interface doc

## Deferred

| Advanced feature | Why it waits | What ships instead |
| --- | --- | --- |
| Free ACH bill pay | Payment processor partner + money-transmitter compliance | USDCx settlement in settled mode; bank reference entry in fiat/anchored |
| 1099 e-filing | IRS IRIS needs a Transmitter Control Code | 1099-NEC/MISC PDF generation (Phase 4) |
| Live bank feeds | Requires Plaid or similar | OFX/QFX/CSV import (Phase 7); live feeds later as opt-in |
| Sales tax filing | Per-state registration and APIs | Liability computed and reported (Phase 3) |
| Priority support, training | Operational | Docs and READMEs |
| Intuit Intelligence block | Out of scope by decision | Revisit later; a local model over the vault |
| Open-source licence | After the build | PNW Smart Contract License v1.7 stays |
| ETH stablecoin + wallet rails | Back burner until the Aleo rails are much further along (2026-10-13) | Aleo/USDCx settled mode only |

## Decisions

- [x] Default mode on first launch: fiat (2026-10-13). Anchored and settled are opt-in upgrades.
- [x] Repo layout: monorepo — `apps/business`, `apps/worker`, `packages/`, `programs/` (2026-10-13).
- [x] Reference wallet for vault key derivation: Shield (2026-10-13).
- [x] Tax engine: TypeScript only; Julia service retired (2026-10-13).
- [x] Wallet is the only signing path for new code; the CLI adapter / private-key fallback stays in `coordinator` until its tests are rewritten, then is removed (2026-10-13).
- [x] Fiat is the primary product; chain rails are optional adapters the fiat path never imports (2026-10-13).
- [x] Shield is the only supported wallet; Puzzle, Leo, Fox and Soter adaptors removed (2026-10-13).
- [x] Greenlight for Phase 0 (2026-10-13).
- [ ] Minimum group size for publishing aggregates (suggested 5). Gates Phase 3 public flag.
- [x] Product name for the bookkeeping surface: **Plumb** (2026-10-13).
- [ ] Phase 6 before Phase 3, if multi-user is wanted before anything ships to a second person.
- [ ] Greenlight for Phase 1.
