# Hewn — Build Plan

Oct 13, 2026 · Joshua Day

> Source of truth for what gets built and in what order. Mirrors the Claude Doc
> "PNW Ledger — Build Plan" (the product is now named Hewn). When an exit criterion is met, tick it here and log it in that day's file in `progress/`.

## Now

Updated 2026-10-26. Session start reads this block; keep it to these four lines and change it
whenever the work moves.

- **Phase:** Phase 1, Core ledger, redesigned as *feed, reconcile, seal* (Joshua, 2026-10-25).
- **In flight:** the manual tests (issues #150–#164). Audit readiness (the ICM plan) is done:
  invariants with checks, numbered threats, the public-state map, Leo tests for every program Hewn
  calls, a lighter Session start, a link checker (`progress/2026-10-25.md`, `2026-10-26.md`); a
  cold Session start is walked at the end of each phase and kept in that day's log.
- **Next criterion:** Phase 1, reconciliation: the books' cash accounts checked against the Shield
  balance, with any difference flagged.
- **Blocked on Joshua:** archiving the old portal repository on GitHub (Phase 0); two phones with
  Shield for the wallet scenarios in the manual tests and Phase 2's three-worker run.

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
- The execution boundary: on-chain writes are signed in the user's wallet via the `wallet` executor, with program/transition names from `pnw-adapter`. The CLI adapter / private-key path is legacy and gone: the `coordinator` package that carried it was removed on 2026-10-14, and the pay queue in `rail` is the wallet path. The app never calls `snarkos` directly. Extensions hang off this seam.
- `payroll_audit_log` as the pattern for anchoring: a hash on chain, everything else private (a sealed month's root goes through it; the postings themselves stay in the vault, Decisions 2026-10-25).
- The name registry (`pnw_name_registry_v2`; names are `name.hewn`), credentials (now `hewn_credentials_v1`), employer license gate, wallet-signature session model.
- TypeScript tax engine (now `packages/tax-engine`, IRS annualization method).

**Retired**

- The Julia tax service (`pnw_payroll_engine/`, now `archive/pnw_payroll_engine/`). One tax engine, in TS.
- localStorage as a book of record (see Phase 1 vault).
- The portal as an app: `pnw_employment_portal_v1` is rebuilt as a QB-shaped shell in Phase 0. Its libraries survive as packages; its screens do not.

**Frozen**

- Every superseded Leo program version (`pnw_name_registrar` v1-v4, `pnw_router` v2-v3, `employer_agreement` v2-v3, `credential_nft` v1-v2, `payroll_core` v1, `payroll_nfts` v1) moves to `src/layer1/archive/` or `src/layer2/archive/` in
  `pnw_mvp_v2` (done 2026-10-20). `config/testnet.manifest.json` stays the single source of truth for what is live.
- Deployed programs are immutable on Aleo. Changes ship as new versions plus a migration path; nothing is edited in place.

**Conventions**

- Production revisions are numbered v1.1, v1.2 in the filename; whole-number bumps on Joshua's call.
- Every phase ends with its exit criteria green before the next starts. A phase can be reordered; it cannot be skipped.
- New Leo programs get a third-party audit before any real books touch them (budget line, not a phase).
- Circuits and ledger invariants on Fable 5.1 at high effort; scaffolding and UI on Opus 5.5 at default.
- Licence: AGPL-3.0-only (decided 2026-10-15).

## Phase 0 — Salvage and scaffold

The portal is rebuilt as a QuickBooks-shaped shell; its libraries are kept. Nothing in this phase changes what the system does, only where it lives.

**Deliverables**

1. Monorepo `pnw` with `apps/business` (the QB-shaped shell: Dashboard, Transactions, Sales, Expenses, Payroll, Projects, Reports, Taxes), `apps/worker` (paystubs, W-4, offers, credentials, timesheet — the Workforce equivalent), `packages/`, `programs/` (Leo), `programs/archive/`.
2. Salvaged into `packages/`, unchanged in behaviour: `pnw-adapter`, `coordinator`, `records`, `manifest`, `tax-engine`, `w4-crypto`, `handshake`, `nft-art`, `pdf`, `commitments`. Each gets its own `package.json` and its existing tests.
3. Shared UI kit: the `components/ui/` primitives plus a design brief for the new shell (left nav, list/detail pattern, transaction forms) written clean-room against the QB mental model.
4. `pnw_employment_portal_v1` and `pnw_mvp_v2` marked read-only once the monorepo is the source of truth; the Julia engine deleted.

**Exit criteria**

- [x] Every salvaged package builds and its existing vitest suite passes inside the monorepo (2026-10-13)
- ~~A full payroll run (agreement check → USDCx transfer → receipts → audit anchor → cycle NFT) completes end-to-end from `apps/business` on testnet, tx hashes recorded~~ Replaced 2026-10-14: Hewn pays with one private USDCx transfer per worker and sends the paystub as a letter (`docs/AUDIT_DESIGN.md`); the run on testnet is Phase 2's three-worker criterion.
- ~~A worker sees that paystub in `apps/worker` with the credential badge rendered~~ Replaced: the worker side lives inside `apps/business` (Decisions, repo layout), and credentials are drawn as landmarks on the worker's card (`docs/HEWN_ART.md`, 2026-10-25).
- [ ] The old portal repo is archived on GitHub with a pointer to the monorepo

## Phase 1 — Core ledger

The frozen core. Everything else imports it; nothing else may alter it.

**Redesigned 2026-10-25 (Joshua): feed, reconcile, seal.** `gl_core.aleo` is retired as designed.
With nearly all money moving on chain, the chain doesn't need to hold the books: it already holds
the cash side, as a bank statement does. The chain is the feed (every movement in the Shield
account comes in for review and is categorized in the vault), the books stay in the vault
(`@pnw/ledger` refuses unbalanced entries), reconciliation is automatic (the books' cash against
the wallet), and closing a month seals it (one root anchored, `docs/AUDIT_DESIGN.md`). A small
period-status program (open, closed, locked; no postings) comes later as new Leo. The deliverables
below are the original design, kept for the record; later phases that name `gl_core` transitions
read against this. The original line: "Fiat-first: the vault and ledger logic come first;
`gl_core.aleo` lands right behind them."

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

- ~~`leo build` and `leo test` green for `gl_core.aleo`, including negative tests (unbalanced entry, closed period, unknown account) that fail as expected~~ Replaced 2026-10-25 (feed, reconcile, seal)
- ~~Deployed to testnet; program ID in `testnet.manifest.json`~~ Replaced 2026-10-25 (feed, reconcile, seal)
- ~~A 20-entry sample ledger posted, period closed, root anchored, with tx hashes recorded in PROGRESS.md~~ Replaced by the next line
- [ ] A month of a sample business's Shield movements comes in through For review, is categorized, reconciles, and the month is sealed: its root anchored through `payroll_audit_log`, with the tx hash recorded in that day's file in `progress/`
- [ ] Reconciliation: the books' cash accounts are checked against the Shield balance (private records and public), and any difference is flagged on the Dashboard
- [x] Vault survives browser clear-site-data via export/import round trip, and opens in a second browser with the same passphrase, no wallet required (2026-10-13)
- [ ] Once a Shield wallet is linked, the vault opens with either the passphrase or the wallet; the passphrase keeps working so a lost wallet never locks the books
- ~~Trial balance from the vault matches the trial balance recomputed from on-chain records in settled mode~~ Replaced 2026-10-25: there are no on-chain postings to recompute from; reconciliation (above) checks the cash side
- ~~`LEDGER_INTERFACE.md` reviewed and frozen~~ Replaced 2026-10-25: no `gl_core` transitions to freeze; the ledger's interface is `@pnw/ledger`'s exports and its README
- [ ] Period status on chain (open, closed, locked; no postings): a small program, new Leo on Fable, with negative tests

## Phase 2 — Payroll bridge

Payroll stops being the product and becomes the first module posting into the ledger. The existing E10 flow stays intact; it gains one step.

**Deliverables**

1. `payroll_gl_bridge.aleo`: imports `gl_core` and `paystub_receipts`. For each settled worker, posts one journal entry: debit Wages Expense (gross), credit Payroll Tax Liability (withheld), credit Cash or USDCx (net), credit Platform Fee Payable (fee). Entry hash binds to the `receipt_anchor`, so every paystub is traceable to its ledger entry and back.
2. Fiat and anchored modes: the same journal entry is written to the vault with a `settled_externally` flag and an optional bank reference, no USDCx transfer.
3. Manifest compiler extension: `PayrollRunManifest` carries the journal entries it will produce; the batch root covers both.
4. Employer-side payroll liability aging: what has been withheld and not yet remitted, by period.

**Exit criteria**

- [ ] A 3-worker testnet payroll run produces three balanced journal entries, each linked to its transfer transaction (receipt anchors replaced 2026-10-14 by one private transfer per worker and the paystub as a letter)
- [x] Running the same payroll in fiat mode produces identical entries in the vault, minus the chain transfer (fiat mode, offline, 2026-10-14)
- [x] P&L for the period shows the wage expense; balance sheet shows the tax liability (fiat mode, 2026-10-13)
- [x] Existing payroll tests (`vitest`) still green; no change to worker-facing paystub flow (2026-10-13)

## Phase 3 — AR/AP and dimensions

This is where it starts to feel like QuickBooks.

**Deliverables**

1. Customers and vendors: records in the vault, hash-anchored; optional `name.hewn` link when the counterparty is also on the platform.
2. Invoices and estimates: line items, sales tax per line (computed and tracked, not filed), terms, status (draft / sent / partially paid / paid / void). Estimate converts to invoice. Batch create.
3. Bills and expenses: line items, due dates, status, batch entry. Receipt image stored encrypted in the vault, hash on the entry.
4. Payments: apply a payment to one or many invoices; record a bill payment. In settled mode, a USDCx transfer; in fiat and anchored, a bank reference.
5. Dimensions, all unlimited: classes, locations, projects (jobs). Every posting carries a `dimension_hash`; the vault holds the plaintext mapping. Project profitability = postings filtered by project.
6. Public/private flag on business-level entries. Default private. Flipping to public writes the entry's fields to a public mapping; flipping back is impossible (chain is immutable), so the UI confirms twice.

**Exit criteria**

- [x] Invoice → partial payment → final payment → paid, with AR balance correct at each step
- [x] Bill → payment, with AP balance correct
- [x] Sales tax liability report ties to invoices for the period (fiat mode, 2026-10-13)
- [x] Project profitability report for a job with labor (from Phase 2), materials and an invoice (fiat mode, 2026-10-13)
- ~~A public-flagged invoice is readable from a public mapping; a private one is not; a worker-linked entry refuses the flag at the circuit level~~ Replaced 2026-10-25: it rested on `gl_core` postings; with feed, reconcile, seal nothing about an invoice is on chain. A public invoice, if wanted, is a later design

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

- [x] P&L + balance sheet + cash flow for the sample ledger reconcile to each other (net income flows to equity, cash flow ties to cash balance change) (2026-10-19)
- [x] Aging reports agree with open-invoice and open-bill lists (2026-10-19)
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
5. Bank import: OFX/QFX and CSV with a column mapper and a saved profile per bank. Matching engine suggests existing invoices/bills for each line. (2026-10-15, Joshua: may be dropped; the books are wallet-first, and the Shield account feeds Transactions → For review. If kept, imported lines land in the same review list.)
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

## Phase 9 — Scheduling (Joshua, 2026-10-20)

Built into the app, not sold separately. Every day has two layers: shift blocks with their hours,
and an on-call layer covering the whole 24 hours, independent of each other. The business publishes
the week to the whole team at once, so everyone at the business sees the same calendar; each person
confirms their own days or asks for a change, and nothing counts until it is confirmed. A schedule
never leaves the team: the vault and sealed letters only (the team's "Team schedule" channel, where
each person is tagged by a one-way value from the key they share with the business).

**Deliverables**

1. Week view for the business (Payroll → Schedule): per person, per day, shifts and on call; copy
   last week; publish; the person's answer. The person's Schedule page: the week, confirm or ask for
   a change.
2. On-call pay and callouts: the on-call amount per day and the callout minimum (paid as overtime)
   in the offer's terms; a callout clocked in on an on-call day; both as lines on Run payroll.
3. Schedule against the clock: today's shift on Home; early, late and unscheduled time flagged on
   the business's timecards.
4. Team calendar (Joshua, 2026-10-20): a month of day squares with everyone's shifts and on-call
   days, tap a day for its hours; the same calendar on both sides, the business's drafts dashed.
5. Changing hours by agreement (Joshua, 2026-10-20): the person asks for a revision of a shift
   not yet sent; the business questions a shift it received; neither changes until the other side
   agrees. An edit made before sending shows to the business with what it was. A questioned shift
   waits out of pay runs unless the business pays it as sent.
6. Later: shift swaps between coworkers, availability, open shifts.
7. Personal events (Joshua, 2026-10-22): anyone, business or worker, puts their own events on the
   calendar (timed, past midnight, or all day across several days; where, an https meeting link,
   notes). Kept only in the encrypted books: nothing is sent, nothing goes on chain, and there is
   no export to a phone calendar (events live only in the app).
8. Shared events (Joshua, 2026-10-22): invites and answers as sealed letters, the guest list
   visible to guests. A business invites its own team; a worker invites coworkers and their
   employer, at one job per event. More than 8 guests go out in batches, one approval per 8.
   Built 2026-10-22 (`docs/LETTERS.md`, "Shared events").
9. Business-to-business agreements and pass-through invites (Joshua, 2026-10-22, after 8): a typed
   agreement between two businesses (subcontractor, general contractor, supplier or vendor,
   services or consulting, joint venture, referral partnership, or a custom title) with written
   terms that may run past one letter, an optional scope note and dates, approved by both sides in
   Shield, letters only, no new program. Only then can one business invite the other, and the
   partner passes the invite on to its own workers; no business invites another's workers. Guests
   from outside the app and public events: later.

**Exit criteria**

- [x] A week with a shift and an on-call day on the same date publishes, is confirmed by the person, and both sides show it as confirmed (2026-10-20)
- [x] A confirmed on-call week and one callout pay the agreed on-call amount and the callout minimum at the overtime rate on the next run (2026-10-20)
- [x] A week published to the team shows the same shifts and on-call days on every member's calendar, and a republish that leaves a person's days alone keeps their confirmation (2026-10-20)
- [x] A shift questioned by the business changes only after the person agrees, and both sides then show the agreed times (2026-10-20)
- [x] A shift clocked in 20 minutes late shows as late on the business's timecard (2026-10-24)
- [x] A personal event (timed, past midnight, or all day) is kept in the encrypted books, reads back when they reopen, shows on the days it touches on that account's calendar, and is never sent (2026-10-22)
- [x] An event sent to guests reaches each of them in one approval per eight, each guest's answer reaches the organizer, and a change sealed by a guest instead of the organizer isn't believed (2026-10-22, end to end in tests; not yet tried on testnet)

---

## Designs kept in docs/

Larger designs live beside the others in `docs/`, each with its own checklist; the open questions
they raise stay in Decisions below.

- **Mainnet names**, `.hewn` under the Aleo Name Service: [`docs/MAINNET_NAMES.md`](docs/MAINNET_NAMES.md)
- **Operating costs, fees and hosting**: [`docs/OPERATING_COSTS.md`](docs/OPERATING_COSTS.md)
- **Premium tier candidates**: [`docs/PREMIUM_TIER.md`](docs/PREMIUM_TIER.md)
- **Customers**: [`docs/CUSTOMERS.md`](docs/CUSTOMERS.md) (not greenlit)

## Deferred

| Advanced feature | Why it waits | What ships instead |
| --- | --- | --- |
| Free ACH bill pay | Payment processor partner + money-transmitter compliance | USDCx settlement in settled mode; bank reference entry in fiat/anchored |
| 1099 e-filing | IRS IRIS needs a Transmitter Control Code | 1099-NEC/MISC PDF generation (Phase 4) |
| Live bank feeds | Requires Plaid or similar | OFX/QFX/CSV import (Phase 7); live feeds later as opt-in |
| Sales tax filing | Per-state registration and APIs | Liability computed and reported (Phase 3) |
| Priority support, training | Operational | Docs and READMEs |
| Intuit Intelligence block | Out of scope by decision | Revisit later; a local model over the vault |
| Open-source licence | Decided 2026-10-15 | AGPL-3.0-only for Hewn and the Leo programs; Hewn name and logo not licensed |
| `gl_core.aleo`: the books posted on chain | Replaced 2026-10-25 (Joshua) by feed, reconcile, seal (Phase 1) | The books stay in the vault; the chain is the feed; a monthly root is anchored through `payroll_audit_log`; a period-status program later, with no postings |
| Wallet-free ("fiat first") accounts | Replaced 2026-10-15 | Every account links Shield and registers a name.hewn at setup; people are added only by registered name |
| ETH stablecoin + wallet rails | Back burner until the Aleo rails are much further along (2026-10-13) | Aleo/USDCx settled mode only |

## Decisions

- [x] Feed, reconcile, seal replaces `gl_core.aleo` (Joshua, 2026-10-25): the chain is the bank feed, the vault is the books, a monthly root seals each closed period; on chain later only a period's status, never postings.
- [x] Default mode on first launch: fiat (2026-10-13). Anchored and settled are opt-in upgrades.
- [x] Repo layout: monorepo — `apps/business`, `apps/worker`, `packages/`, `programs/` (2026-10-13).
  As built: the worker side lives inside `apps/business` (one app, two kinds of account), and the
  programs stay in `pnw_mvp_v2`, attached as a submodule.
- [x] Reference wallet for vault key derivation: Shield (2026-10-13).
- [x] Tax engine: TypeScript only; Julia service retired (2026-10-13).
- [x] Wallet is the only signing path for new code; the CLI adapter / private-key fallback stays in `coordinator` until its tests are rewritten, then is removed (2026-10-13).
- [x] Fiat is the primary product; chain rails are optional adapters the fiat path never imports (2026-10-13).
- [x] Shield is the only supported wallet; Puzzle, Leo, Fox and Soter adaptors removed (2026-10-13).
- [x] The Mailbox page is retired (2026-10-19, Joshua): Messages is the line of communication. Offers
  and the conversation around each live under Jobs → Offers; the weeks of hours a team sends land under
  Payroll → Hours; a paystub's delivery shows on its paycheck.
- [x] The work week is part of an offer's terms (2026-10-19, Joshua): the day it starts on, the time
  zone its days are drawn in, when overtime starts (a week's hours, and a day's where the state says
  so) and the longest shift before a clock-out is questioned (`books/work_week.ts`). Both sides lay
  the same calendar against the same stamps, so the chain never has to know what day it is. Not
  negotiated: a revised offer keeps it. Location at clock-in: not built (Joshua, 2026-10-19).
- [x] Three ways in to Shield: the extension, Shield's own browser, and a plain phone browser over
  Shield's relay (2026-10-19). An installable Android app (Capacitor around the same code) is the
  third route in a wrapper. Step 1 done (2026-10-19): the app builds as a static bundle beside the
  website (`build:static`). Next: the Android shell (`apps/android`), then CI-built APKs.
- [x] Greenlight for Phase 0 (2026-10-13).
- [ ] Minimum group size for publishing aggregates (suggested 5). Gates Phase 3 public flag.
- [x] Product name for the bookkeeping surface: **Hewn** (hewnaccounting.com; app at www.hewnaccounting.com for now, since app.hewnaccounting.com doesn't resolve yet, 2026-10-21) (2026-10-14). The name, tagline, colours and asset paths live in `packages/brand/src/index.ts`; art in `brand/source/`.
- [ ] Phase 6 before Phase 3, if multi-user is wanted before anything ships to a second person.
- [ ] Greenlight for Phase 1.
- [x] One kind of account per Shield account (business or worker); the same username may hold both (2026-10-15). App check now, registrar on mainnet. Confirmed 2026-10-25 (Joshua): a wallet with a worker name never holds a business name, and the reverse; a worker's account can still be a business's customer. Testnet's `pnw_name_registrar_v5` doesn't enforce it (its tests record that, PNWBNW/pnw_mvp_v2#225), so the mainnet registrar must, with a must-fail test each way.
- [x] Mainnet names live under the Aleo Name Service as the `hewn` TLD; free tier a random public name (changed from private the same day), paid tier a chosen public name priced by length, bought once, no renewal (2026-10-15). See `docs/MAINNET_NAMES.md`.
- [ ] Final prices for the short-name tiers.
- [ ] Agreement with the ANS team to register `hewn` as a TLD.
- [ ] Premium tier for mainnet: whether to have one, what's in it (first candidate: private
  messaging within an organization) and its price. See `docs/PREMIUM_TIER.md`.
- [ ] The per-paycheck fee: amount ($0.03–$0.10 proposed), the monthly cap per business, and when
  it starts (with real traffic, before mainnet). See `docs/OPERATING_COSTS.md`.
- [ ] Hewn's operating wallet: the original PNW rule was "no protocol treasury" (no pooled
  custody). A fee wallet holds only fees, never anyone's pay; confirm it as an exception.
- [ ] Where the other 50% of each paid `.hewn` name goes (50% is working capital).
- [x] Marketing says "no monthly subscription" rather than "free" (2026-10-16).
- [x] Network fees are paid privately by default, for payments, offers, messages and everything
  else; only `.hewn` names and job postings are public (2026-10-16). Never a silent fallback to a
  public fee: short of private ALEO, the app stops and offers to move some. Being tested behind a
  per-device switch first.
- [x] New passphrases: at least 12 characters with a letter and a space or symbol, common
  passwords refused, a strength meter and a five-word suggestion (2026-10-20).
- [x] Usernames instead of emails to log in, since nothing is ever sent to the email; an email
  still works as a username, so accounts made with one open unchanged (2026-10-21).
- [x] A Report button on received messages; a harassment report tells the sender nothing, other
  categories tell them in case their account was taken over (2026-10-20). Built the same day: the
  report goes to Hewn's account as a sealed letter, and can be emailed to hewnsupport@gmail.com or
  copied (`docs/LETTERS.md`, "Reports").
- [x] The DAO's agreement copy and powers stay while on testnet; on mainnet, agreements carry no DAO
  copy and no DAO powers (`employer_agreement_v5`), and job board fees keep going to Hewn's wallet
  (2026-10-20).
- [ ] Account recovery after a takeover (a recovery code, moving a name to a new wallet): parked
  for more thought (2026-10-20).
- [x] Offers carry no files (PDFs, photos); the offer letter is one box of up to 20,000 characters
  to write or paste into (2026-10-16). Offers sent before keep their files.
- [x] Pay (type, rate, how often), employment type, hours a week and start date are boxes of their
  own in an offer, each negotiable in a counter-offer (2026-10-16).
- [ ] Letters on chain rotate to a new random key at least every 24 hours; old keys stay in the
  vault so people keep their history (2026-10-16). **Not built** (found 2026-10-23: every
  conversation keeps one key), and it may not be used at all (Joshua, 2026-10-23); if it is, by
  key exchange rather than by sending the next key inside the old one.
- [x] Hiring starts with the offer: a business sends a job offer to anyone by their registered name,
  and they join the team when they accept (2026-10-16). Team members never paid can be removed.
- [x] ~~Mailbox storage moves from Pinata to object storage (Cloudflare R2) for scale; Pinata stays
  an option (2026-10-16).~~ Moot: the
  mailbox is retired and every message is a letter on chain (2026-10-22).
- [x] Who works for whom stays off the public chain (Joshua, 2026-10-22, from the security review):
  making or accepting an offer on v4 showed both names' hashes and both accounts in the
  transaction (`employer_agreement_v4` calls the registry's `assert_is_owner` with them).
  `employer_agreement_v5` authorises without a public ownership check: written and staged
  2026-10-23 (pnw_mvp_v2 PR #210, with the halves and the two-party change), deployed 2026-10-24,
  and the app switched 2026-10-25 (new offers to v5, v4 still read; `chain/agreement_programs.ts`).
- [x] ~~Maybe, for mainnet:~~ done in v5 as deployed (locked in 2026-10-24 before the deploy, pnw_mvp_v2
  `docs/migrations/2026-10-23-agreement-v5.md` "Packed bytes"; the app's readers and inputs
  followed on 2026-10-25, `@pnw/records` `packed`): the agreement program packs its byte fields
  (Joshua, 2026-10-24). The staged v5's
  records held two key halves and six hashes as about 320 one-byte slots (`[u8; 64]`, `[u8; 32]`),
  each one encrypted and proven on its own; packed as `[u128; 4]` and `[u128; 2]` (about 20 slots,
  the way Provable's `hyperlane-aleo` stores message bodies and ids), deploys cost less (v5:
  38.86 credits, estimated 25–30 packed) and proofs are faster in Shield on a phone. The same
  bytes in a different box: the record's encryption and the twin-curve handshake are unchanged
  (the halves still ride in the records; the app unpacks them). Ships with tests that pack and
  unpack known halves both ways and reach the same key on both sides. v5 deploys on testnet as
  it is; mainnet is a fresh deploy, so its agreement program is where packing goes, a Leo change
  (Fable 5.1, high effort) with the app's readers to match.
- [ ] No program can be upgraded on mainnet (Joshua, 2026-10-22, pinned until the build is nearly
  done): the registry, the registrar, agreements and worker profiles are `@admin` under one key
  today, so an upgrade could change who passes their checks. `@noupgrade`, or a multisig with a
  timelock, before mainnet.
- [ ] GitHub hardening, parked (Joshua, 2026-10-22, after a review of the GitHub incidents; nothing
  changed yet). Settings, the only kind that stops someone holding Joshua's login: a ruleset on
  `main` in both repos (pull request and CI required, no force-push or deletion; a stuck CI badge
  then needs a re-run before merging), Vercel promoting to production by hand, passkey 2FA on
  GitHub and Vercel, old tokens deleted; in pnw_mvp_v2, `testnet-staging` limited to `main` with
  Joshua as reviewer and every key secret moved into it (the admin key can't be replaced: the
  address is fixed in each `@admin` constructor). Workflows, against a poisoned tool only: hash
  checks on the Leo 4.0.0 and snarkOS downloads (stop on a mismatch), an exact Leo version instead
  of "latest" in deploy and upgrade, a read-only token for the plan gate; in Hewn, `pnpm/action-setup`
  pinned to a commit and a 7-day Dependabot cooldown. Ruled out as no real gain or a later break:
  dropping the key fallback, a main-only line in the workflows, commit pins in pnw_mvp_v2 (no
  Dependabot there, so they'd freeze), the `work` trigger.
- [x] From the hardening review (Joshua, 2026-10-22): backups asking for more PBKDF2 rounds than
  this app writes are refused (done). Parked: a size limit on unpacking letters (low value; if
  ever built, at 1 MB, checked when sending too, so nothing Hewn can send is cut short). Waiting
  for more data: the traction page's floor (its totals and the hidden-country count can single
  out a country's only visitor; anyone can add visits; bots may count).
- [x] Coworkers are confirmed by the registered name the chain says owns their account, the
  twin-curve way, not a longer safety code (Joshua, 2026-10-23): letters are sealed to accounts,
  so the business could only sit in the middle by listing an account of its own, and the chain
  would name that account's owner. The 30-digit code stays as a second check.
- [ ] Every conversation twin-curve (Joshua, 2026-10-23, in this order): (1) confirmed names on
  announcements and invitations (done); (2) a P-256 handshake in the business ↔ team member
  conversation, so a view key alone no longer opens paystubs, announcement keys or business
  invitations (`docs/TWIN_CURVE_CONVERSATIONS.md`, approved: the agreement stays the first lock,
  and backups on chain only when both people agree, up to that point, Joshua 2026-10-23; built
  for messages, paystubs and timesheets, and the agreed backups); (3) rotation by handshake: skipped (Joshua, 2026-10-23); (4) v5 agreements
  carry the two public halves (Leo, Fable): built and staged, `employer_agreement_v5.aleo`
  (pnw_mvp_v2 PR #210), deployed 2026-10-24, and the app switched to it 2026-10-25
  (`apps/business/src/chain/agreement_programs.ts`); (5) optional: a
  second lock on reports to Hewn.
- [x] Free names can be squatted or registered ahead of someone on testnet; accepted until
  mainnet's names (Joshua, 2026-10-22).
- [x] Terms of use and a privacy page, public at `/terms` and `/privacy` (Joshua, 2026-10-22):
  "we" is Hewn, run by Joshua Day; Washington State law; questions to hewnsupport@gmail.com. Setup's
  checkbox reads "I understand my passphrase can't be recovered, and that Hewn is testnet software
  provided as is: not tax, legal or accounting advice." The small print under the front page and
  the rail says "Testnet · provided as is · Terms · Privacy"; payroll runs, taxes and paystubs say
  "Testnet software. Check these figures before you rely on them; this isn't tax advice."
