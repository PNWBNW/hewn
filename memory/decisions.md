# Decisions

One line each: the date, the decision, who made it, where it is enforced, where it was recorded.
Made decisions only; the open ones are in `BUILD_PLAN.md`'s Decisions list. Newest last within
each area. The first consolidation was made by hand on 2026-11-03 (`docs/MEMORY.md`, the first
dream) from `BUILD_PLAN.md`, `CLAUDE.md`, the documents' Decisions sections and the progress log;
from then on, a decision made in a session is appended here in the same pull request.

## Product and scope

- 2026-10-13 · Hewn is a clean-room rebuild of QuickBooks Advanced's function (minus AI and support) on the PNW payroll stack; never its screens, icons, text or layouts · Joshua · `CLAUDE.md` · BUILD_PLAN
- 2026-10-13 · One codebase, three modes: fiat (default), anchored, settled; the double-entry core identical in all · Joshua · `packages/ledger` · BUILD_PLAN
- 2026-10-13 · Monorepo: `apps/business`, `packages/`; the worker side lives inside `apps/business` as a second kind of account; the Leo programs stay in `pnw_mvp_v2` as a submodule · Joshua · repo layout · BUILD_PLAN Decisions
- 2026-10-13 · Tax engine in TypeScript only; the Julia service retired · Joshua · `packages/tax-engine`, `archive/README.md` · BUILD_PLAN Decisions
- 2026-10-13 · Shield is the only supported wallet; Puzzle, Leo, Fox and Soter adaptors removed · Joshua · `packages/wallet` · BUILD_PLAN Decisions
- 2026-10-14 · The product is **Hewn**, hewnaccounting.com; the app at www.hewnaccounting.com while app.hewnaccounting.com doesn't resolve (2026-10-21); name, tagline and colours only in `packages/brand` · Joshua · `packages/brand` · BUILD_PLAN Decisions
- 2026-10-15 · Licence AGPL-3.0-only, here and in `pnw_mvp_v2`; the Hewn name and logo are not licensed; the app and site link to the source · Joshua · `LICENSE`, `BRAND.sourceUrl` · `CLAUDE.md`
- 2026-10-16 · Marketing says "no monthly subscription", not "free" · Joshua · `apps/site` · BUILD_PLAN Decisions
- 2026-10-25 · Feed, reconcile, seal replaces `gl_core.aleo`: the chain is the bank feed, the vault is the books, a closed period's root is anchored through `payroll_audit_log`; a period-status program comes later as new Leo · Joshua · Phase 1 criteria, `docs/AUDIT_DESIGN.md` · BUILD_PLAN Decisions, `progress/2026-10-25.md`
- 2026-10-25 · Superseded designs move from `BUILD_PLAN.md` to `docs/` with a status; `Known facts` live in the README of what they describe · Joshua · `docs/README.md` · `progress/2026-10-25.md`

## Accounts, names and login

- 2026-10-15 · Every account is on the registry: setup links a Shield account and registers a `name.hewn`; a wallet is required to get in (replaces "fiat first") · Joshua · INV-13, `books/setup.ts` · `CLAUDE.md`
- 2026-10-15 · One kind of account per Shield account: business and personal money never share a wallet; revised 2026-10-26: one username holds a business, or a person's worker and customer accounts, never a business with either; older business + worker pairs keep opening · Joshua · INV-15, `chain/account_kind.ts`, `books/account.ts` · BUILD_PLAN Decisions, `CLAUDE.md`
- 2026-10-15 · Mainnet names live under the Aleo Name Service as the `hewn` TLD: free tier a random public name, paid tier a chosen name priced by length · Joshua · `docs/MAINNET_NAMES.md` · BUILD_PLAN Decisions
- 2026-10-20 · New passphrases: at least 12 characters with a letter and a space or symbol, common passwords refused, a strength meter, a five-word suggestion · Joshua · `books/passphrase.ts` · BUILD_PLAN Decisions
- 2026-10-21 · Usernames replace emails to log in (nothing is ever sent to an email); an email is still a valid username, so older accounts open unchanged · Joshua · `books/account.ts` · BUILD_PLAN Decisions
- 2026-10-23 · Team members, customers and vendors are added only by their registered name, shown only when its hash checks out · Joshua · INV-14 · `CLAUDE.md`

## Keys, storage and backups

- 2026-10-15 · "Stay logged in" keeps only the open data key, non-extractable, for at most 24 hours, forgotten on Log out · Joshua · INV-08, `@pnw/vault` · `CLAUDE.md`
- 2026-10-19 · The one server-side exception to "no private data on any server": two traction totals per country, decided on the device, no dates, addresses or ids · Joshua · INV-05, `api/traction/counts.ts` · `CLAUDE.md`
- 2026-10-22 · From the hardening review: backups asking for more PBKDF2 rounds than the app writes are refused; a size limit on unpacking letters parked; the traction floor waits for data · Joshua · `@pnw/vault` · BUILD_PLAN Decisions
- 2026-10-24 · A lost passphrase is replaced only with the account's recovery key, made in Settings · Joshua · INV-09, `@pnw/vault` `addRecovery` · `CLAUDE.md`
- 2026-10-26 · A business's own view key may be kept inside its encrypted books, to read its incoming private payments; never sent, logged or shown back, never in the letters backup · Joshua · INV-06 exception, `books/view_key.ts`, T20 · `CLAUDE.md`
- 2026-10-26 · Backups of the books on chain as letters: a new chain at half a snapshot of changes or after 12; asked for weekly, after each pay run and at each close; the cost shown first · Joshua · `docs/CHAIN_BACKUP.md` · its Decisions
- 2026-10-27 · On testnet the on-chain backup must be sent with a public fee (Shield's private-fee path fails there); the app says so · Joshua · `chain/ChainBackup.tsx` · `progress/2026-10-27.md`
- 2026-10-30 · While on testnet, the traction map shows every country with a visitor; the floor of 5 returns before mainnet · Joshua · INV-05, `counts.ts` · `CLAUDE.md`

## The chain and the programs

- 2026-10-13 · The wallet is the only signing path for new code; the CLI adapter is legacy, and the `coordinator` package that carried it is gone (2026-10-14) · Joshua · INV-11, `check_signing_path.py` · BUILD_PLAN Decisions
- 2026-10-14 · Hewn pays with one private USDCx transfer per worker and sends the paystub as a letter; `payroll_core_v2`, the receipts and per-payment anchors stay deployed, unused · Joshua · `packages/rail` · `pnw_mvp_v2` `CLAUDE.md`
- 2026-10-15 · Open registration: `pnw_name_registrar_v5` edition 1 and `employer_agreement_v4` edition 2 add free, licence-free paths · Joshua · the chain · `pnw_mvp_v2` `CLAUDE.md`
- 2026-10-16 · Network fees are paid privately by default; only names and job postings are public; never a silent fallback to a public fee (on testnet, see 2026-10-27 above) · Joshua · `@pnw/wallet` `fee_mode.ts` · BUILD_PLAN Decisions
- 2026-10-16/18 · Letters are records on chain; the chain is the mailbox (`hewn_letters_v2` with `send_many`); the Mailbox page is retired (2026-10-19) · Joshua · `docs/LETTERS.md` · BUILD_PLAN Decisions
- 2026-10-19 · The public job board: $1 USDCx to post, $5 a day to feature, 30 days at most, employer names only; interviews not on chain; a posting belongs to the name · Joshua · `hewn_jobs_v1`, `docs/JOB_BOARD.md` · its Decisions
- 2026-10-20 · The DAO's agreement copy and powers stay on testnet; on mainnet agreements carry neither, and job board fees go to Hewn's wallet · Joshua · `employer_agreement_v5` · BUILD_PLAN Decisions
- 2026-10-22 · Who works for whom stays off the public chain: `employer_agreement_v5` authorises without a public ownership check; deployed 2026-10-24, the app switched 2026-10-25 (v4 still read) · Joshua · `chain/agreement_programs.ts` · BUILD_PLAN Decisions
- 2026-10-22 · No program may be upgraded on mainnet (`@noupgrade`, or a multisig with a timelock); pinned until the build is nearly done · Joshua · open until mainnet · BUILD_PLAN Decisions
- 2026-10-23 · Coworkers are confirmed by the registered name the chain says owns their account (the twin-curve way); the 30-digit code stays as a second check · Joshua · `docs/TWIN_CURVE_CONVERSATIONS.md` · BUILD_PLAN Decisions
- 2026-10-24 · The agreement program packs its byte fields on mainnet (`[u128; n]`), the way `hyperlane-aleo` does; v5 stays as deployed on testnet · Joshua · `@pnw/records` `packed` · BUILD_PLAN Decisions
- 2026-10-25 · `hewn_credentials_v1` and `hewn_cards_v1` deployed: credentials as two private records with a public commitment; one card entry per name · Joshua · the chain · `pnw_mvp_v2` `CLAUDE.md`

## Offers, payroll and messages

- 2026-10-16 · Hiring starts with the offer, sent to anyone by their registered name; they join the team when they accept; offers carry no files, the letter is one box of up to 20,000 characters; pay, type, hours and start date are their own negotiable boxes · Joshua · `chain/offer.ts` · BUILD_PLAN Decisions
- 2026-10-19 · The work week is part of an offer's terms (start day, time zone, overtime, longest shift); not negotiated; location at clock-in not built · Joshua · `books/work_week.ts` · BUILD_PLAN Decisions
- 2026-10-20 · A Report button on received messages: a harassment report tells the sender nothing, other categories tell them · Joshua · `docs/LETTERS.md` "Reports" · BUILD_PLAN Decisions
- 2026-10-23 · The business ↔ team member conversation moves to a P-256 handshake; the agreement stays the first lock; backups on chain only when both agree · Joshua · `packages/handshake` · `docs/TWIN_CURVE_CONVERSATIONS.md`

## Customers

- 2026-10-23 · Customers as their own accounts with a portal; posting a request free for now; businesses opt into a directory by field; reviews at each payment, public together at the job's end; USDCx is the customer's to get · Joshua · `docs/CUSTOMERS.md` · its Decisions (13 items)
- 2026-10-26 · Step 1 greenlit and built: accounts, invoices as letters, bills paid from Shield, agreements, invoices referencing an agreement · Joshua · `/customer` · `progress/2026-10-26.md`

## Closing the books and audit

- 2026-10-16 · Proof without receipts: a paycheck, a run or a period provable to an auditor without the chain showing a wage · Joshua · `docs/AUDIT_DESIGN.md` · the doc
- 2026-11-02 · Close period: any end date before today; every checklist line must pass; reopen until locked; a reminder from the 5th; accountants' access is its own design, later · Joshua · `books/close.ts` · `docs/CLOSE_PERIOD.md` Decisions
- 2026-11-03 · No outside audit until mainnet and funding; until then an internal audit stands in for a SOC 2 Type I and Type II; SOC 1 out of scope for now; the control list is `docs/INVARIANTS.md` · Joshua · `docs/COMPLIANCE_MAP.md` · its Decisions
- 2026-11-03 · Joshua alone holds GitHub and Vercel, both with 2FA · Joshua · OPS-02 · `docs/COMPLIANCE_MAP.md`

## Art and the map

- 2026-10-24 · Every account gets art drawn from its name: a worker's land, a business's map, the constellation, paystub rings; landmarks private, the bare land shown or hidden by choice · Joshua · `packages/art` · `docs/HEWN_ART.md`
- 2026-11-03 · The map of the whole tree lives on GitHub (Pages and the README), never on the website; one page with the data-flow view; redrawn on every push · Joshua · `docs/map/` · `progress/2026-11-03.md`
- 2026-11-03 · A point's size is continuous in its connections and lines; the names (dust to supergiant) are only names and filters; nothing overlaps · Joshua · `docs/map/bodies.mjs`, `layout.mjs` · `progress/2026-11-03.md`
- 2026-11-03 · The marketing reel of the map is not kept in the repository · Joshua · session scratch · `progress/2026-11-03.md`

## Proof of income and later designs

- 2026-10-29 · Paystubs become private records the worker proves from; the paystub letter is kept, with the record as an extra transaction; the agreement is checked once per worker (a "paystub right") · Joshua · `docs/PROOF_OF_INCOME.md` · `progress/2026-10-29.md`
- 2026-10-30 · No verifier code: an income letter with a QR code under the employer-vouched name, as simple as bringing in paystubs · Joshua · `docs/PROOF_OF_INCOME.md` · `progress/2026-10-30.md`

## Working agreement

- 2026-10-29 · Commit messages and PR descriptions never carry a `https://claude.ai/...` session link · Joshua · `CLAUDE.md` · `progress/2026-10-29.md`
- 2026-11-03 · A PR merges only after Joshua approves it in the chat session, on his own device; the merge commit says "Approved by Joshua in session, <date>" · Joshua · OPS-01 · `docs/COMPLIANCE_MAP.md`
- 2026-11-03 · Ask the map before grepping; `show` and `impact` on a file before changing it · Joshua · `CLAUDE.md` · `progress/2026-11-03.md`
- 2026-11-03 · Memory in three scopes; frontmatter on every document with a generated index; every progress entry signed with the bare session id (never a link); a weekly out-of-band dreaming pass · Joshua · `docs/MEMORY.md` · its Decisions
