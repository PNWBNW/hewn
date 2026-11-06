# Decisions

The ledger of every decision made, across the documents that recorded them. One line each: the
date · the decision · who made it · where it is enforced (a rule id in bold where it became one)
· where it was recorded. Two levels: a group, then a subcategory with one line on what belongs
in it, so a line has one home. Newest last within a subcategory; a decision that replaced an
earlier one says so, and the earlier line stays with "superseded". Made decisions only: the open
ones are `BUILD_PLAN.md`'s unchecked Decisions. First consolidated by hand on 2026-11-03
(`docs/MEMORY.md`, the first dream) from `BUILD_PLAN.md`, `CLAUDE.md`, the documents' Decisions
sections, `pnw_mvp_v2`'s durable decisions and the progress log; from then on, a decision made in
a session is appended here in the same pull request.

## Product

### Scope and positioning
What Hewn is and isn't, and how it's described.

- 2026-10-13 · Hewn is a clean-room rebuild of QuickBooks Advanced's function (minus AI and support) on the PNW payroll stack; never its screens, icons, text or layouts · Joshua · `CLAUDE.md`, `docs/DESIGN_BRIEF.md` · BUILD_PLAN
- 2026-10-13 · Greenlight for Phase 0 · Joshua · BUILD_PLAN · BUILD_PLAN Decisions
- 2026-10-16 · Marketing says "no monthly subscription", never "free" · Joshua · `apps/site` · BUILD_PLAN Decisions
- 2026-10-25 · Feed, reconcile, seal replaces `gl_core.aleo`: the chain is the bank feed, the vault is the books, a closed period's root is anchored through `payroll_audit_log`; a period-status program comes later as new Leo · Joshua · Phase 1 criteria, `docs/AUDIT_DESIGN.md` · BUILD_PLAN Decisions, `progress/2026-10-25.md`
- 2026-11-05 · A technical paper, not a whitepaper (no token), kept in the repository as `docs/PAPER.md` and served at hewnaccounting.com/paper on the marketing site, with a PDF; it explains twin-curve math with everything that uses it · Joshua · `docs/PAPER.md` · `progress/2026-11-05.md`

### Modes and the way in
Which mode the app runs in, and what a person needs to get in.

- 2026-10-13 · Default mode on first launch: fiat; anchored and settled are opt-in upgrades; fiat is the primary product and the chain rails optional adapters · Joshua · superseded (below) · BUILD_PLAN Decisions
- 2026-10-15 · A wallet is required to get in: setup links a Shield account and registers a name (replaces "fiat first") · Joshua · **INV-13**, `books/setup.ts` · `CLAUDE.md`
- 2026-10-19 · Three ways in to Shield: the extension, Shield's own browser, a plain phone browser over Shield's relay; an installable Android app (Capacitor around the same code) is the third route in a wrapper; the static bundle (`build:static`) is step one · Joshua · `packages/wallet/README.md` · BUILD_PLAN Decisions
- 2026-11-03 · The app runs on Aleo: a Shield account is required to use it at all; money moves through it and closed periods anchor there; fiat bookkeeping is a bonus for what happens off chain, never the way in. Supersedes the 2026-10-13 default · Joshua · `CLAUDE.md` (What this is), BUILD_PLAN Scope · this session
- 2026-10-19 · Mode upgrades are one-way, show exactly what goes on chain, and take a second wallet signature after a review screen · Joshua · **INV-19** · `CLAUDE.md`

### Name, brand and licence
The product's name, where its brand lives, and the licence.

- 2026-10-14 · The product is **Hewn**, hewnaccounting.com; the app at www.hewnaccounting.com while app.hewnaccounting.com doesn't resolve (2026-10-21); the name, tagline, colours and asset paths live only in `packages/brand` · Joshua · `packages/brand` · BUILD_PLAN Decisions
- 2026-10-15 · Licence AGPL-3.0-only, here and in `pnw_mvp_v2`; the Hewn name and logo are not licensed; the app and the site link to the source · Joshua · `LICENSE`, `BRAND.sourceUrl` · `CLAUDE.md`

### Repository and stack
How the code is laid out and what it runs on.

- 2026-10-13 · Monorepo: `apps/business` and `packages/`; the worker side lives inside `apps/business` as a second kind of account; the Leo programs stay in `pnw_mvp_v2`, attached as a submodule · Joshua · repo layout · BUILD_PLAN Decisions
- 2026-10-13 · Tax engine in TypeScript only; the Julia service retired · Joshua · `packages/tax-engine`, `archive/README.md` · BUILD_PLAN Decisions
- 2026-10-13 · Shield is the only supported wallet; Puzzle, Leo, Fox and Soter adaptors removed · Joshua · `packages/wallet` · BUILD_PLAN Decisions
- 2026-10-21 · `@types/node` follows the Node that runs the code (22); Dependabot skips its major bumps · Joshua · `.github/dependabot.yml` · `progress/2026-10-21.md`
- 2026-10-25 · Superseded designs move from `BUILD_PLAN.md` to `docs/` with a status; known facts live in the README of what they describe · Joshua · `docs/README.md` · `progress/2026-10-25.md`

## Users
- 2026-11-05 · Hewn adopts Veil (Provable's viem-style toolkit), and Shield stays the only wallet: Veil's provider is narrowed to Shield, and another wallet comes only after it is checked against what Hewn relies on. The order: tests and CI first (a local devnode, typed bindings from codegen), then generated decoders in place of the hand parsers, then the reads Hewn lacks; the app never imports Veil's local-key package · Joshua · `docs/VEIL.md` · `progress/2026-11-05.md`

### Accounts
What an account is, and how many a wallet or a username may hold.

- 2026-10-15 · One kind of account per Shield account: a wallet holding a business's name can't hold a person's account, and the reverse (business and personal money never share a wallet) · Joshua · **INV-15**, `chain/account_kind.ts` · BUILD_PLAN Decisions, `CLAUDE.md`
- 2026-10-26 · One username holds a business, or a person's worker and customer accounts, never a business with either; a person's worker and customer accounts may share a wallet; older business + worker pairs keep opening · Joshua · `books/account.ts` · BUILD_PLAN Decisions
- 2026-10-26 · No cards for clients: a customer account gets no card or land · Joshua · `packages/art` · `progress/2026-10-26.md`

### Names
Registered names, who may be found by one, and names on mainnet.

- 2026-10-15 · Every account is on the registry: setup registers a `name.hewn` (a worker also creates the profile behind it; a customer uses the person's name if the wallet has one) · Joshua · **INV-13** · `CLAUDE.md`
- 2026-10-15 · Mainnet names live under the Aleo Name Service as the `hewn` TLD: free tier a random public name, paid tier a chosen name priced by length · Joshua · `docs/MAINNET_NAMES.md` · BUILD_PLAN Decisions
- 2026-10-22 · Team members, customers and vendors are added only by their registered name, shown only when its hash checks out (fix 4 of the security review) · Joshua · **INV-14** · `progress/2026-10-22.md`

### Login and passphrases
How a person gets in, and what a passphrase must be.

- 2026-10-20 · New passphrases: at least 12 characters with a letter and a space or symbol, common passwords refused, a strength meter, a five-word suggestion · Joshua · `packages/vault/src/passphrase.ts` · BUILD_PLAN Decisions
- 2026-10-21 · Usernames replace emails to log in (nothing is ever sent to an email); an email is still a valid username, so older accounts open unchanged · Joshua · `books/account.ts` · BUILD_PLAN Decisions
- 2026-10-15 · "Stay logged in" keeps only the open data key, non-extractable, for at most 24 hours, forgotten on Log out · Joshua · **INV-08**, `@pnw/vault` · `CLAUDE.md`

### Recovery
What happens when a passphrase or an account is lost.

- 2026-10-24 · A lost passphrase is replaced only with the account's recovery key, made in Settings; there is no server account to reset through · Joshua · **INV-09**, `@pnw/vault` `addRecovery` · `CLAUDE.md`
- 2026-10-20 · Account recovery after a takeover (a recovery code, moving a name to a new wallet) is parked for more thought · Joshua · open · BUILD_PLAN Decisions

## Privacy and keys

### The privacy floor and its exceptions
What may never be public, and the exceptions Joshua has allowed.

- 2026-10-13 · Anything tied to an individual is private in every mode and can never be made public; no private data on any server; public mappings hold only hashes, commitments and heights · Joshua · **INV-01**, **INV-02**, **INV-03** · `CLAUDE.md`
- 2026-03-02 · No cumulative counters in public mappings: they leak wages by difference; audit anchors are hash-only (inherited from PNW) · Joshua · **INV-23**, `check_layer1_public_leakage_guards.py` · `pnw_mvp_v2` `CLAUDE.md`
- 2026-10-19 · The one server-side exception: two traction totals per country, decided on the device, no dates, addresses or ids · Joshua · **INV-05**, `api/traction/counts.ts` · `CLAUDE.md`
- 2026-10-22 · Who works for whom stays off the public chain (from the security review): `employer_agreement_v5` authorises without a public ownership check · Joshua · `chain/agreement_programs.ts` · BUILD_PLAN Decisions
- 2026-10-30 · While on testnet the traction map shows every country with a visitor; the floor of 5 returns before mainnet · Joshua · **INV-05** · `CLAUDE.md`

### Keys in the app
Which keys the app may hold, and how.

- 2026-10-13 · Never commit or print private keys, view keys, `.env` files or seed phrases · Joshua · **INV-06**, `check_secrets.py` · `CLAUDE.md`
- 2026-10-15 · The vault key comes from the unlock secret (username + passphrase, PBKDF2-SHA256 600k rounds) and only wraps a random AES-256-GCM data key, never stored in plaintext, never leaving the vault module · Joshua · **INV-07**, `@pnw/vault` · `CLAUDE.md`
- 2026-10-26 · A business's own view key may be kept inside its encrypted books to read its incoming private payments; never sent, logged or shown back, never in the letters backup · Joshua · **INV-06** exception, `books/view_key.ts`, T20 · `CLAUDE.md`

### Storage and backups
Where the books live on the device, and how they are backed up.

- 2026-10-13 · localStorage is not a book of record; durable data goes in the encrypted IndexedDB vault · Joshua · **INV-10**, `check_browser_storage.py` · `CLAUDE.md`
- 2026-10-22 · Backups asking for more PBKDF2 rounds than the app writes are refused (hardening B) · Joshua · `@pnw/vault` · BUILD_PLAN Decisions
- 2026-10-26 · Backups of the books on chain as letters: a new chain at half a snapshot of changes or after 12; asked for weekly, after each pay run and at each close; the cost shown first · Joshua · `docs/CHAIN_BACKUP.md` · its Decisions
- 2026-10-26 · A plain download counts as a backup only once the person confirms it saved; the share sheet counts at once · Joshua · `books/backup_reminder.ts` · `progress/2026-10-26.md`
- 2026-10-27 · On testnet the on-chain backup must be sent with a public fee; the app says so · Joshua · `chain/ChainBackup.tsx` · `progress/2026-10-27.md`

## The chain

### Programs and versions
Deploying, upgrading, archiving and testing the Leo programs.

- 2026-02-27 · Adapters are the only execution boundary; workflows and routers only plan (inherited from PNW) · Joshua · `packages/pnw-adapter` · `pnw_mvp_v2` `CLAUDE.md`
- 2026-10-13 · The wallet is the only signing path for new code; the CLI adapter is legacy; the `coordinator` package that carried it is gone (2026-10-14) · Joshua · **INV-11**, `check_signing_path.py` · BUILD_PLAN Decisions
- 2026-10-13 · Deployed programs are immutable: a change is a new version with a migration note; the manifest is the source of truth; any new or changed Leo is flagged first and ships with negative tests · Joshua · **INV-20**, **INV-22** · `CLAUDE.md`
- 2026-10-15 · Open registration: `pnw_name_registrar_v5` edition 1 and `employer_agreement_v4` edition 2 add free, licence-free paths; the gated originals stay unchanged · Joshua · the chain · `pnw_mvp_v2` `CLAUDE.md`
- 2026-10-20 · Superseded versions move unchanged to `src/<layer>/archive/` with a row in its README; every live program carries a README · Joshua · **INV-21**, `pnw_mvp_v2` `scripts/check_archive.py` · `pnw_mvp_v2` `CLAUDE.md`
- 2026-10-24 · The agreement program packs its byte fields on mainnet (`[u128; n]`, the way `hyperlane-aleo` does); v5 stays as deployed on testnet · Joshua · `@pnw/records` `packed` · BUILD_PLAN Decisions
- 2026-10-25 · `hewn_credentials_v1` and `hewn_cards_v1` deployed: credentials as two private records with a public commitment; one card entry per name, bound to the name · Joshua · the chain · `pnw_mvp_v2` `CLAUDE.md`

### Fees
Who pays network fees and how.

- 2026-10-16 · Network fees are paid privately by default, for everything; only names and job postings are public; never a silent fallback to a public fee: short of private ALEO the app stops and offers to move some · Joshua · `@pnw/wallet` `fee_mode.ts` · BUILD_PLAN Decisions
- 2026-10-27 · On testnet Shield covers the fee publicly and a private fee fails; the app notes it where it matters (backups) · Joshua · `chain/ChainBackup.tsx` · `progress/2026-10-27.md`

### Letters and records
How anything between two people travels.

- 2026-10-14 · Hewn pays with one private USDCx transfer per worker and sends the paystub as a letter; `payroll_core_v2`, the receipts and per-payment anchors stay deployed, unused · Joshua · `packages/rail` · `pnw_mvp_v2` `CLAUDE.md`
- 2026-10-16 · Letters are records on chain; the chain is the mailbox (`hewn_letters_v2` with `send_many`, 2026-10-18) · Joshua · `docs/LETTERS.md` · BUILD_PLAN Decisions
- 2026-10-19 · The Mailbox page is retired: Messages is the line of communication; offers under Jobs, hours under Payroll, a paystub's delivery on its paycheck · Joshua · the app's navigation · BUILD_PLAN Decisions
- 2026-10-22 · Every letter is checked against its sender; a registered name is shown only when its hash checks out; a payment is never made twice on an unknown outcome (security review fixes 1 to 5) · Joshua · `chain/letters.ts`, `packages/rail` · `progress/2026-10-22.md`
- 2026-10-22 · Layer 2 never moves funds; no pooled custody · Joshua · **INV-24**, `check_layer2_moves_no_funds.py` · `pnw_mvp_v2` `CLAUDE.md`

### Agreements
The agreement between a business and a person, on chain.

- 2026-10-20 · The DAO's agreement copy and powers stay on testnet; on mainnet agreements carry neither, and job board fees go to Hewn's wallet · Joshua · `employer_agreement_v5` · BUILD_PLAN Decisions
- 2026-10-24 · `employer_agreement_v5` deployed: two parties, the key halves in the records, no public link between the parties, a pair tag for other programs, a private end reason; the app switched 2026-10-25, v4 still read · Joshua · `chain/agreement_programs.ts` · `pnw_mvp_v2` `CLAUDE.md`

## Work

### Hiring and offers
How an offer is made and what it carries.

- 2026-10-16 · Hiring starts with the offer, sent to anyone by their registered name; they join the team when they accept; team members never paid can be removed · Joshua · `chain/offer.ts` · BUILD_PLAN Decisions
- 2026-10-16 · Offers carry no files; the letter is one box of up to 20,000 characters; pay, employment type, hours a week and start date are their own negotiable boxes · Joshua · `chain/OfferPanel.tsx` · BUILD_PLAN Decisions
- 2026-10-19 · The work week is part of an offer's terms (start day, time zone, overtime, longest shift), not negotiated; location at clock-in not built · Joshua · `books/work_week.ts` · BUILD_PLAN Decisions

### Payroll and hours
Running payroll and recording hours.

- 2026-10-22 · Pay runs pay only people who accepted (fix 5 of the security review) · Joshua · `packages/rail` · `progress/2026-10-22.md`
- 2026-11-04 · The double-pay item in `pnw_mvp_v2`'s archived `NOTES.md` is closed: the four-step flow it described is gone, and Hewn's own guard (never pay twice on an unknown outcome, 2026-10-22) is tested · Joshua · `packages/payroll/src/settlement.test.ts` (`checkDoublePay`) · `progress/2026-11-04.md`
- 2026-11-05 · Payroll compliance plan: the IRS's own withholding method with verified, dated tables updated only through review; a real W-4 the worker fills in and signs (drawn with a finger, then in Shield), sent sealed under the pair's key; Social Security numbers collected behind layered locks; state rules follow where the work is done and fill in each agreement, the West first from Washington, Oregon and Idaho; the I-9 after the W-4; zPass to explore · Joshua · `docs/PAYROLL_COMPLIANCE.md` · `progress/2026-11-05.md`
- 2026-11-05 · zPass explored: it fits a verified-person mark, age and sanctions proofs, not the I-9's document check yet; its SDK signs with a pasted key, so Hewn would carry the pattern in its own Leo program, signed in Shield; next, questions to the zPass team and the employer as issuer after the I-9 (to decide) · Joshua asked · `docs/ZPASS.md` · `progress/2026-11-05.md`

### Messages and conversations
Who can read what in a conversation, and how people are confirmed.

- 2026-10-20 · A Report button on received messages: a harassment report tells the sender nothing, other categories tell them · Joshua · `docs/LETTERS.md` "Reports" · BUILD_PLAN Decisions
- 2026-10-23 · Coworkers are confirmed by the registered name the chain says owns their account (the twin-curve way); the 30-digit code stays as a second check · Joshua · `docs/TWIN_CURVE_CONVERSATIONS.md` · BUILD_PLAN Decisions
- 2026-10-23 · The business ↔ team member conversation moves to a P-256 handshake; the agreement stays the first lock; backups on chain only when both agree · Joshua · `packages/handshake` · `docs/TWIN_CURVE_CONVERSATIONS.md`

### Customers
Customers as accounts, their portal, bills and reviews.

- 2026-10-23 · Customers as their own accounts with a portal; posting a request free for now; businesses opt into a directory by field; reviews at each payment, public together at the job's end; USDCx is the customer's to get (13 items) · Joshua · `docs/CUSTOMERS.md` · its Decisions
- 2026-10-26 · Step 1 built: accounts, invoices as letters, bills paid from Shield, a printable invoice, agreements for a job, an invoice naming its agreed job · Joshua · `/customer` · `progress/2026-10-26.md`

### The job board
The public board and what it costs.

- 2026-10-19 · The public job board: $1 USDCx to post, $5 a day to feature, 30 days at most, employer names only; applications are name, message and a resume as text; interviews not on chain; a posting belongs to the name · Joshua · `hewn_jobs_v1`, `docs/JOB_BOARD.md` · its Decisions

### Credentials and cards
What a business vouches for, and the art every account carries.

- 2026-10-24 · Every account gets art drawn from its name: a worker's land in 3D with landmarks for credentials, a business's land as a map, the constellation, paystub rings; every card private, a business's card public, a worker's tenure card public or hidden at their choice · Joshua · `packages/art`, `docs/HEWN_ART.md` · `progress/2026-10-24.md`
- 2026-10-25 · A business vouches for a person it has an agreement with (`hewn_credentials_v1`); issued from the team list, accepted from the profile; drawn as landmarks · Joshua · `chain/credentials` · `progress/2026-10-25.md`

## The books

### Ledger and reconciliation
The double-entry core and how it follows Shield.

- 2026-10-13 · The double-entry core is identical in every mode; the ledger, vault, reports and payroll never import the chain packages · Joshua · **INV-16**, `fiat_boundary.test.ts` · `CLAUDE.md`
- 2026-10-26 · Reconciliation: the books' Shield account against the linked account's USDCx, flagged on the Dashboard, with "Record the difference" · Joshua · `books/reconcile.ts` · `progress/2026-10-26.md`

### Closing and anchoring
Closing a period and anchoring its root.

- 2026-10-16 · Proof without receipts: a paycheck, a run or a period provable to an auditor without the chain showing a wage · Joshua · `docs/AUDIT_DESIGN.md` · the doc
- 2026-11-02 · Close period: any end date before today; every checklist line must pass; reopen until locked; a reminder from the 5th · Joshua · `books/close.ts` · `docs/CLOSE_PERIOD.md` Decisions
- 2026-11-05 · The period proof: one file per standing close (every entry and payment in full, with the salts, never the anchor secret), and a public page, `/verify`, that checks it on the device and looks up only the root and the payments' transaction ids · Joshua (greenlit Close period part 3) · `@pnw/ledger` `period_proof.ts`, `chain/period_check.ts` · `docs/CLOSE_PERIOD.md`

### Audit readiness and compliance
Which frameworks Hewn works toward, and how.

- 2026-10-25 · The audit-ready (ICM) plan: Session start reads the Now block; rules with ids tied to checks and threats; every "none" check made real; a public-state map; one progress file a day; not adopted: AGENTS.md, CONTEXT.md per folder, stage folders · Joshua · `docs/INVARIANTS.md`, `scripts/` · `progress/2026-10-25.md`
- 2026-11-03 · SOC 2 first, ISO 27001 later; SOC 1 out of scope for now; HITRUST, FedRAMP and CMMC don't fit; the control list is `docs/INVARIANTS.md` · Joshua · `docs/COMPLIANCE_MAP.md` · its Decisions

## Security and operations

### Access and approvals
Who holds what, and what it takes to merge.

- 2026-11-03 · A PR merges only after Joshua approves it in the chat session, on his own device; the merge commit says "Approved by Joshua in session, <date>" · Joshua · **OPS-01** · `docs/COMPLIANCE_MAP.md`
- 2026-11-03 · Joshua alone holds GitHub and Vercel, both with 2FA · Joshua · **OPS-02** · `docs/COMPLIANCE_MAP.md`
- 2026-11-04 · When Joshua merges a PR himself on GitHub, he adds "Approved by Joshua in session, <date>" to the merge message; #293 (merged by him that day without it) is noted in `progress/2026-11-04.md` · Joshua · **OPS-01** · `progress/2026-11-04.md`

### Hardening
What was hardened, and what was reviewed and parked.

- 2026-10-22 · GitHub hardening parked, with its list (a ruleset on `main` in both repos, Vercel promoting by hand, passkey 2FA, old tokens deleted, the admin environment limited to `main`; hash checks on tool downloads, pinned action versions, a read-only gate token); ruled out: dropping the key fallback, commit pins in `pnw_mvp_v2` · Joshua · open · BUILD_PLAN Decisions
- 2026-10-22 · From the hardening review: the PBKDF2 refusal done; a size limit on unpacking letters parked; the traction floor waits for data · Joshua · `@pnw/vault` · BUILD_PLAN Decisions
- 2026-11-04 · Dead code inside the live packages is deleted, not kept: 16 portal leftovers nothing imported (the old transaction executor, four record scanners, the CLI adapter and its routers, three helpers); shipped code never debug-logs · Joshua · **INV-06**, **INV-12**, `scripts/check_console.py`, `scripts/check_signing_path.py` · `progress/2026-11-04.md`

### Outside audits
When Hewn is audited by others.

- 2026-11-03 · No outside audit until Hewn is ready for mainnet and has funding; until then an internal audit stands in for a SOC 2 Type I (every control walked on one date) and Type II (at least three months of evidence, sampled) · Joshua · `docs/COMPLIANCE_MAP.md` · its Decisions

## Before mainnet
Every commitment pinned to "before mainnet", in one list the dream can verify when the time comes. It repeats
lines that also live in their own group on purpose, so the day of the launch has one complete list.

- 2026-10-15 · `.hewn` names move under the Aleo Name Service as a TLD; a registrar that keeps a wallet to one kind of name; a conversation with the ANS team · Joshua · `docs/MAINNET_NAMES.md` · BUILD_PLAN Decisions
- 2026-10-20 · Agreements carry no DAO copy and no DAO powers on mainnet · Joshua · `employer_agreement_v5` · BUILD_PLAN Decisions
- 2026-10-22 · No program may be upgraded on mainnet: `@noupgrade`, or a multisig with a timelock · Joshua · open · BUILD_PLAN Decisions
- 2026-10-24 · The agreement program packs its byte fields in the mainnet deploy · Joshua · open · BUILD_PLAN Decisions
- 2026-10-30 · The traction floor of 5 visitors a country returns · Joshua · **INV-05** · `CLAUDE.md`
- 2026-10-25 · A third-party audit of every program that will hold real money · Joshua · open · `pnw_mvp_v2` `CLAUDE.md`
- 2026-11-03 · The first outside SOC 2 audit comes with mainnet and funding · Joshua · open · `docs/COMPLIANCE_MAP.md`
- 2026-11-04 · The app keeps reading the superseded `employer_agreement_v4` and `hewn_letters_v1` (their records can't move to a newer program) until Joshua retires them, possibly at mainnet, where every program starts fresh and only the newest version is read · Joshua · open · `apps/business/src/chain/agreement_programs.ts`, `chain/letters.ts`

## Designs ahead
Direction decided, nothing built yet.

### Proof of income
- 2026-10-29 · Paystubs become private records the worker proves from; the paystub letter is kept, with the record as an extra transaction; the agreement is checked once per worker (a "paystub right") · Joshua · `docs/PROOF_OF_INCOME.md` · `progress/2026-10-29.md`
- 2026-10-30 · No verifier code: an income letter with a QR code under the employer-vouched name, as simple as bringing in paystubs · Joshua · `docs/PROOF_OF_INCOME.md` · `progress/2026-10-30.md`

### Accountant access
- 2026-11-02 · Accountants' access to the books is its own design, to brainstorm separately · Joshua · `docs/CLOSE_PERIOD.md` · its Decisions

### Locked savings
- 2026-10-24 · An idea for outside review before anything is built: split-key escrow, unpooled · Joshua · `docs/LOCKED_SAVINGS.md` · the doc

### Premium tier
- 2026-10-16 · Candidates only, not decided; the free product never loses what it has · Joshua · `docs/PREMIUM_TIER.md` · BUILD_PLAN Decisions

## How we work

### The working agreement
How tasks, PRs and reports are done.

- 2026-10-13 · One task, one exit criterion, one PR; no new screens without a greenlight; every task ends with tests, a progress entry and a PR · Joshua · **OPS-08**, `CLAUDE.md` · `CLAUDE.md`
- 2026-10-29 · Commit messages and PR descriptions never carry a `https://claude.ai/...` session link · Joshua · `CLAUDE.md` · `progress/2026-10-29.md`
- 2026-11-03 · Every progress entry ends with the bare id of the session that wrote it (never a link); only Joshua can open the transcript · Joshua · `progress_index.py` · `docs/MEMORY.md`
- 2026-11-04 · Retired code is deleted, not archived: git history is the archive, `archive/README.md` keeps one row per retired thing with the commit that holds it; deployed Leo program versions stay (INV-21). Hewn's `archive/` code deleted the same day; the Leo repository's old documents and `portal/` are decided there · Joshua · **OPS-09**, `scripts/check_archive.py` · `progress/2026-11-04.md`
- 2026-11-04 · The Leo repository's command-line execute harness (`execute_testnet.yml`, the phase 4 scripts, `config/scenarios/`) stays for now · Joshua · open · `pnw_mvp_v2` `CLAUDE.md` · `progress/2026-11-04.md`

### Memory and the map
How the team remembers, and the map it navigates by.

- 2026-11-03 · The map of the whole tree lives on GitHub (Pages and the README), never on the website; one page with the data-flow view; redrawn on every push; a point's size continuous in its connections and lines; nothing overlaps · Joshua · `docs/map/` · `progress/2026-11-03.md`
- 2026-11-03 · Ask the map before grepping; `show` and `impact` on a file before changing it · Joshua · `CLAUDE.md` · `progress/2026-11-03.md`
- 2026-11-03 · Memory in three scopes; frontmatter on every document with a generated index; a weekly out-of-band dreaming pass; the first dream by hand; this ledger in two levels · Joshua · `docs/MEMORY.md` · its Decisions
- 2026-11-03 · The dream runs as a weekly Routine (Sunday evening Pacific) that starts a fresh session on `main` and reads its instruction from `scripts/dreaming/PROMPT.md`; its first run is fired by hand and reviewed before the schedule stands; it never merges · Joshua · `scripts/dreaming/` · `docs/MEMORY.md`
- 2026-11-03 · The marketing reel of the map is not kept in the repository · Joshua · session scratch · `progress/2026-11-03.md`

### Sessions and tooling
What the agent sessions may and may not do.

- 2026-10-13 · Any new or changed Leo program is said out loud first, so Joshua can switch the session to Fable 5.1 at high effort · Joshua · **INV-22** · `CLAUDE.md`
- 2026-11-03 · A refused command is never worked around; after a squash merge the branch comes back with a plain merge of `main`, never a force-push · Joshua · `memory/lessons.md` · this session
- 2026-11-06 · The Leo programs compile and test with Leo 4.0.0, the language they are written in; the deploy and upgrade workflows sign and send with Leo 4.4.6; snarkOS 4.12.0; every download from `aleo-labs-protocol` with its checksum pinned. Moving the source to Leo 4.4 is a Leo change of its own (INV-22) · Joshua (approved `pnw_mvp_v2` #231) · `pnw_mvp_v2/CLAUDE.md` Toolchain, `docs/ALEO_CONSTRAINTS.md` §2b
