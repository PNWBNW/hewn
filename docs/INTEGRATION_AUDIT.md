# Integration audit: tying the books to the chain stack

Date: 2026-10-14. Read-only pass over three codebases: this monorepo (`main` @ c560231), the
old portal (`pnw_employment_portal_v1` @ c8b09e8) and the programs (`pnw_mvp_v2` @ 025ca88).
Nothing was changed. File references are `repo:path:line`.

## The short version

Two foundations, both sound, built for different jobs:

| | New app (`apps/business` + `packages/{ledger,vault,payroll,sales}`) | Chain stack (`pnw_mvp_v2` programs + salvaged `packages/*`) |
| --- | --- | --- |
| Does | Double-entry books, encrypted vault, payroll maths with full tax breakdown, invoices, bills, projects, reports | Identity (`.pnw` names, profiles), agreements, private USDCx payroll with receipts, anchor NFTs, credentials |
| Source of truth | The vault on the user's device | Private records in the user's wallet, hash-only public mappings |
| State | 352 tests, deployed, fiat-only by test | 13 programs live on testnet, 166 portal tests, E10/E11 runs succeeded |
| Missing | Any link to a wallet | Any books: receipts carry totals only, no breakdown, no ledger |

**The seam is narrow.** The books already hold everything the chain needs (gross, net, withheld,
pay date, worker), and more than it can store (the per-tax breakdown). The chain already produces
everything the books need to prove a payment (receipt anchor, tx id, block height). So the join
is: **a pay run is posted to the books first, settled on the chain second, and the receipt anchor
is written back onto the entry.** Every other flow (invoices paid in USDCx, bills, worker
paystubs) is the same shape.

**What has to be redone, not just wired:** the coordinator's run model (built around a
localStorage manifest and Zustand callbacks), the five regex record parsers, the Pinata/IPFS
server routes (W-4, terms, timesheet), the worker-side offer store, and the portal's three
different ways of hashing the employer name. Details in §4.

**Settlement path (resolved 2026-10-14, see `ALEO_CONSTRAINTS.md`):** Shield proves through
Provable's delegated proving service, which only accepts single-call functions. That is why the
one-shot `execute_payroll` (four cross-program calls) never reached the network and the 4-step
split did. Every user-signed transition is therefore designed as a single-call function, fired
in parallel across payees after pre-splitting the employer's USDCx with the stablecoin's own
`split`. The monolithic path and `execute_payroll_batch_2` are retired.

**Decisions taken in the same conversation:** no bank feeds or card processors; money that moves
through the app moves on the rail, the books still work with no wallet. The encrypted
party-to-party mailbox (the portal's Pinata channel) stays, as the one server piece (§4.4). The
display suffix becomes `.hewn` (§2.1). Payments to vendors and subs use the same queue as payroll
(§2.3).

## 1. What ties straight in

Copied over unchanged and still correct:

- **Commitments** (`packages/commitments`): BLAKE3 + TLV scheme that the live receipts were
  minted with. Note: `pnw_mvp_v2/portal/src/commitments/*` is a *different* scheme (ENC_V header,
  decimal amounts, 0x00 separator) that was never used on-chain. The portal's copy, which we have,
  is the live one. Treat `pnw_mvp_v2`'s TS as stale.
- **Config** (`packages/config`): the 15 program ids match `testnet.manifest.json`. (The copies
  in `pnw_mvp_v2/portal/src/config` and both adapters there still name v1/v2 programs; stale.)
- **Wallet executor** (`packages/wallet/wallet-executor.ts`): pure, no React, correct error
  classes and polling. The provider is already Shield-only.
- **Manifest compiler** (`packages/manifest`): deterministic, 47 tests, and the run-intent fields
  (`run_kind`, `run_memo`) that make same-day runs distinguishable.
- **Record scanners' logic** (`packages/records`): the wallet-based ones (`scanPayrollHistory`,
  `scanWorkerPaystubs`, `scanAgreementRecords`, `scanCredentialRecords`) work; their parsing
  needs one decoder (§4.3).
- **Credential art and PDFs** (`packages/nft-art`, `packages/pdf`): fine as renderers, once fed
  from the books instead of a fake manifest (§4.6).
- **Handshake maths** (`packages/handshake/engine.ts`): `parties_key`, `agreement_id`, terms
  hashes. Keep the functions; drop the `snarkos` command builders.
- **The programs themselves.** No change needed to post balanced entries for a settled run; the
  receipt anchor is enough to bind an entry to a payment. A new program is only needed for
  anchoring the books (`gl_core.aleo`, Phase 1) and, optionally, richer receipts (§3.2).

## 2. How the two models line up

### 2.1 Identity

| Books (vault) | Chain | Join |
| --- | --- | --- |
| `Worker.id` = `wkr-N`, name, rate, W-4 | wallet address, `worker_name_hash` (field), `.pnw` name (public plaintext by design), `agreement_id` | New vault map `workerId → {address, nameHash, agreementId}`; populated by importing `FinalAgreement` records from the employer's wallet |
| `Settings.businessName` | `employer_name_hash` + `EmployerProfile` record | Vault keeps the registered name hash once the wallet is linked |
| `Customer` / `Vendor` | nothing today | Optional wallet address on the party record, for USDCx invoices and bills |

The `.pnw` name is the only identity shown to the other party today. It is public on-chain
(`pnw_name_registrar_v5.aleo` `name_plaintext`), so showing it is fine. The suffix is a display
choice: the registry stores the bare name and the portal appended `.pnw` in one line
(`portal:src/records/agreement_reader.ts:149`). **Decision: the display suffix is `.hewn`**, held
in `packages/brand` (`BRAND.nameSuffix`). The registry program names and the `PNW::NAME` hash domain (baked into every name
hash) change only at the mainnet redeploy, when every program gets its final name once.

#### Typed and linked parties

**Decision (Joshua, 2026-10-14): two kinds of party, everywhere a party can be picked.** *Typed*: a
name you entered; the books work, nothing else. *Linked*: has a profile and an agreement approved by
both sides; only a linked party can be paid on the rail, receive documents through the mailbox, or
send hours. In between, *Offer sent*: this app sent the agreement and the other side hasn't approved
it yet. The badge (`src/books/LinkBadge.tsx`) sits on every Team, Customer and Vendor row and form;
the status comes from the rail part of the company file (`linkStatus`), so a fiat user sees "Typed"
and nothing else.

Team members link through the employment agreement that exists today: **Send offer** on a typed
team member's row (`src/chain/OfferPanel.tsx`) resolves their registered name or account, puts the
terms document in their mailbox sealed to the agreement's `parties_key` (`terms`, slot 0; the
canonical form in `src/chain/terms.ts` is a contract shared with the worker's app), then sends
`employer_agreement_v4::create_job_offer` with the portal's 16 inputs through Shield. The link is
saved as `offered`; Import team turns it `linked` once a `FinalAgreement` with that agreement id is
in the employer's wallet. The terms document's `agreementId` holds the offer time hash, not the
agreement id: the agreement id is derived from the terms hash, so it can't be inside the terms. The
record's own `agreement_id` is the join.

Vendors, subs and customers become linkable only once a party-agreement program exists (a later Leo
session). Until then they carry an optional rail address on the party record (`Rail.partyLinks`,
the vendor/customer form's "Rail address" field, shown once an account is linked in Settings) and
always read "Typed": no document or payment goes to them on the rail yet. Run payroll on the rail
already requires a linked team member; the pay-bills path has no rail option today, so nothing
gates there.

### 2.2 Payroll (the main seam)

What each side has per paycheck:

| Field | Books `Paycheck` | Chain `*PaystubReceipt` |
| --- | --- | --- |
| Gross, net | yes | `gross_amount`, `net_amount` |
| Federal, SS, Medicare, additional Medicare | each separately | only `tax_withheld` (one total) |
| Employer SS and Medicare | yes | no |
| Fee | no | `fee_amount` |
| Pay date | `payDate` | `epoch_id` (YYYYMMDD) |
| Pay period | `periodStart`, `periodEnd` | only on the `PayrollNFT` anchor |
| Hours, rate, frequency | yes | no (frequency on the agreement) |
| Proof | entry hash, chained | `receipt_anchor`, `payroll_inputs_hash`, block height via mapping |

So the books are the richer record and must come first. **Chosen design (Joshua, 2026-10-14):
rail + books + mailbox.** One transition per payee, the paystub through the mailbox, the link in
the books:

1. `postPayRun` posts one balanced entry per paycheck (already built: Dr Wages, Dr Employer
   Payroll Taxes, Cr Payroll Liabilities, Cr Bank). In settled mode the "bank" account is the
   USDCx wallet account. The paystub document (full breakdown, hours, period, the transfer's
   transition id and the worker's record commitment once known) is built from the paycheck;
   `hash(paystub)` goes into the entry's `source.ref`, so it is inside the entry hash and the
   chain.
2. **On-chain, per worker: one `test_usdcx_stablecoin::transfer_private`** of the net amount.
   Single-call, so Shield delegates it. No receipts program, no per-worker anchor.
3. **The paystub goes to the worker through the mailbox** (§4.4), encrypted to `parties_key`,
   unpinned once their vault has it. The employer's vault keeps its copy.
4. **Proof is the period anchor.** `gl_core.aleo` anchors the period root; paystub → entry →
   Merkle path → anchored root → block height verifies any paystub to anyone the worker chooses
   to show it to. The same proof covers vendor payments and invoices.
5. The entry's `source.ref` also carries the transition id and block height once confirmed.

What this drops, deliberately: `paystub_receipts` records in the worker's wallet (the paystub is
in their vault; the money record is in their wallet), the on-chain `paid_epoch` guard (the vault
guard blocks exact repeats and warns on same-day runs; a per-worker on-chain guard needs a wrapper
around the transfer, which is a two-call function Shield cannot prove), and the per-run cycle NFT
(optional: one `anchor_event` plus one `mint_cycle_nft` per run if wanted). Credentials and
agreements never depended on receipts.

**Fees (decided):** the employer pays network fees on every payment; nothing is deducted from the
payee and no fee ever goes to Hewn or anyone else. ALEO held for fees is a small asset account;
each confirmed payment moves the **actual** fee (read from the confirmed transaction's fee
transition, not the wallet's estimate) to a "Network fees" expense at the ALEO's cost. Paystubs
and remittances show "Network fee: x ALEO, paid by employer". If Shield's fee sponsorship covers
dApp transfers, the line reads zero.

What this fixes from the portal: the portal threw the tax breakdown away
(`portal:app/(employer)/payroll/new/page.tsx:389` keeps only `totalTax`), computed no employer
taxes, kept the active run in localStorage, and rebuilt history from receipts with zeroed hashes
and `"aleo1unknown"` workers. In the new model the vault is the history and receipts are proof.

Chain only moves **net**. Withheld tax stays with the employer as a liability, which is exactly
what the books record. Consistent.

### 2.3 Invoices, bills, vendors and subs

Same pattern, less baggage. One **Pay** queue covers everything owed:

| Payee | Transaction | Extra on-chain | Books |
| --- | --- | --- | --- |
| Worker (W-2) | `transfer_private` + `mint_paystub_receipts` | receipts, `paid_epoch` (after the receipts upgrade) | wages, withholding, employer taxes |
| Sub / contractor (1099) | `transfer_private` | none | bill payment, counted for the 1099 |
| Vendor / business | `transfer_private` | none | bill payment |

Vendors and subs get an optional wallet address or `.hewn` name on their record; businesses
register names too, so "Pay Lumber Yard" resolves through the public registry.

**Incoming payments:** a USDCx `Token` record carries owner and amount only (`transfer_private`
has no memo). Matching an incoming payment to an invoice has three layers: a mailbox note from the
payer's app (invoice number, amount, tx id; §4.4), amount-and-date matching with a one-tap confirm
for plain wallets, and later a `payment_receipts` program, the invoice twin of `paystub_receipts`.
When both businesses are on Hewn, one transfer updates both sets of books.

### 2.4 The worker's paystub

Superseded by §2.2: the full paystub arrives through the mailbox and lives in the worker's vault;
the worker's app checks that the transition id in the paystub produced the USDCx record in their
wallet, and verifies the paystub hash against the anchored period root once it is anchored.

### 2.5 Hashing domains

Ledger entries: `BLAKE3("PNW::GL::ENTRY::v1" ‖ 0x00 ‖ canonical)`. Chain commitments:
`BLAKE3(domain ‖ payload)` with no separator. Different domains, no collision, no change needed.
`gl_core.aleo` will only ever see the 32-byte entry hash.

## 3. On-chain facts that shape the design

- **Live programs** (13): `pnw_name_registry_v2`, `pnw_name_registrar_v5`, `pnw_worker_profiles_v2`,
  `employer_profiles_v2`, `employer_license_registry`, `employer_agreement_v4`, `payroll_core_v2`,
  `paystub_receipts`, `payroll_audit_log`, `pnw_router_v4`, `payroll_nfts_v2`, `credential_nft_v3`,
  `audit_nft`, plus external `test_usdcx_stablecoin`. Immutable (`@noupgrade`): license registry,
  audit log, `payroll_nfts_v2`, `audit_nft`. `credential_nft_v4` has source but no manifest entry.
- **Receipt binding primitives** that a bridge can import: `paystub_receipts::assert_receipt_anchored`
  and `payroll_audit_log::assert_event_anchored`. A program cannot re-emit another program's record,
  so a bridge binds by hash, never by consuming the receipt.
- **`payroll_nfts_v2::mint_*` requires `inputs_hash` to be an anchored audit event**; the portal's
  `audit_event_hash` has zeroed batch/row placeholders (`portal:src/manifest/compiler.ts:258-264`)
  and the history scanner recomputes the same value. Keep that formula or every historical anchor
  breaks.
- **Monolithic vs sequential: resolved.** `payroll_core_v2::execute_payroll` is one 5-program
  proof and the only writer of `paid_epoch`. The portal's flag is set to monolithic
  (`portal:src/coordinator/settlement_coordinator.ts:617`, same in `packages/coordinator`) from
  Joshua's batching experiments; the docs describe the split. Shield's prover cannot delegate a
  multi-call function (`ALEO_CONSTRAINTS.md` §3), so the split is the path and `paid_epoch` moves
  into an upgraded `paystub_receipts` (it is `@admin`, so upgradable in place with an edition bump).
- **Program upgrades exist.** `employer_agreement_v4` was upgraded in place on 2026-04-12; the
  four `@noupgrade` programs cannot be. CLAUDE.md's "deployed programs are immutable" needs the
  `@admin`/`@noupgrade` distinction.
- **Compliance records.** Every private USDCx transfer emits a `ComplianceRecord` (amount, sender,
  recipient) to the stablecoin's investigator address. Wages on the rail are private from the
  public and from us, not from the stablecoin's compliance party. Goes in `THREAT_MODEL.md`.
- **Mapping privacy** (no cumulative counters anywhere; CI guard checks five names):
  `paid_epoch` is keyed by `{agreement_id, epoch_id}`, so it reveals *that* an agreement was paid on
  a date (cadence, tenure), no amount. `name_plaintext` is public by design. `credential_issuer`
  ties a credential id to the employer's address. Worth a line in `THREAT_MODEL.md`; not blocking.
- **Shield**: `privateFee: false` on every call; it is set only in page-level closures in the
  portal and nowhere in `packages/wallet` or `packages/coordinator`. Move it into the executor.
- **Toolchain**: Leo 4.0.0, snarkOS 4.6.0; neither is installed in this session. `pnw_mvp_v2` has
  no deploy script; deploys were run by hand with `leo deploy`.

## 4. What has to be redone

### 4.1 Coordinator (`packages/coordinator`)

- Takes a `PayrollRunManifest` plus a required `adapterConfig` (the CLI/private-key path) and
  Zustand-shaped callbacks. Rewrite the public API as: input = posted `PayRun` + the identity map;
  output = per-paycheck `{receiptAnchor, txId, height}`; progress via a plain callback. Drop
  `executeChunkViaCli`, `adapterConfig`, `viewKey`, and the credential/roster managers
  (`skipCredentials: true` is the only mode ever used). `receipt_reconciler` and
  `receipt_scanner` are unreferenced and query a `receipts` mapping that does not exist; delete.
- `double_pay_guard` stays (exact `payroll_inputs_hash` match = blocked, same epoch = confirm);
  it should also check the vault's own `PayRun`s, which is cheaper and offline.
- Five polling loops with different cadences across executor, hook, coordinator and credential
  page. One `waitForTransaction` in `packages/wallet`.

### 4.2 Wallet package

- `privateFee: false` moves into `executeAleoTransaction`.
- The provider's 19-program list includes legacy `payroll_nfts.aleo`, `credential_nft.aleo`,
  `credential_nft_v2.aleo`; derive it from `packages/config`.
- `useTransactionExecutor` is React; fine for the opt-in adaptor, but the app's fiat core must
  never import it (the boundary test already enforces this).

### 4.3 Records package

- Five regex parsers over `recordPlaintext` (`offers`, `worker_paystub_scanner`,
  `credential_scanner`, `agreement_reader`, `payroll_history_scanner`). One typed decoder with
  tests, and one `field` ↔ hex normaliser (today: `hexToDecimalField`, `fieldFromHash`,
  `normalizeHash32`, `fieldToDecimal`, `bytesToFieldDecimal` in five files).
- `agreement_reader.readAgreementRecords` reads `localStorage["pnw_sent_offers_*"]` from inside a
  package. Remove; agreements come from wallet records and the vault.
- `credential_scanner` defaults a mapping fetch failure to `"active"`. Must be `"unknown"`.
- `name_registry.ts` command builders (`snarkos developer execute …`) and the v1
  `pnw_name_registry.aleo` query: delete.

### 4.4 The mailbox (the one server piece, kept on purpose)

The portal's Pinata/IPFS channel is what lets an offer, a W-4 or a paystub pass between the two
parties with no email, no PDF and no third party reading it: the worker opens the app and it is
there. **Decision (Joshua, 2026-10-14): keep it**, as the single exception to the no-server rule,
rebuilt as one primitive with three changes:

- **Mailbox, not archive.** Each side's vault keeps its copy the moment it opens a document;
  once the worker's acceptance (or the read) is on-chain, the pin is dropped. Pinata only ever
  holds documents in flight, so the pin count stays in the hundreds at thousands of users and the
  cost stays on the free or smallest plan. The app needs only upload / fetch / unpin, so any
  pinning service or a self-hosted node swaps in.
- **One stateless function** holds the Pinata key, stores nothing, and only ever sees
  ciphertext. No database.
- **One encryption scheme, keyed from the on-chain `parties_key`**, replacing the two schemes the
  portal had (HKDF for terms; PBKDF2 for W-4 and punches). The only thing on a pin is a lookup
  hash; the portal put the worker's address, week and punch type in plaintext metadata
  (`portal:app/api/timekeeping/upload/route.ts:47-56`), which goes.

The same mailbox then carries: the agreement terms (hash on the record), the W-4
(worker → employer), the full paystub breakdown (employer → worker, which also solves §2.4 without
a new program), payment notes for invoices (§2.3) and, later, timesheets. The two broken
client↔route contracts in the portal (`uploadEncryptedW4` posting JSON to a multipart route;
lookups by `cid` to a route that requires `agreementId`) are rewritten rather than fixed.

### 4.5 Employer name hash (three derivations)

Registered on-chain: `BLAKE3("PNW::NAME", TLV(name))`. In receipts (what E10/E11 minted):
`BLAKE3("PNW::DOC", address)`. In credentials: `BLAKE3("PNW::NAME", address)`. The agreements
and credential auth checks use the registered one, so the registered name hash is the only
correct value; the manifest compiler must take it from the vault. Testnet receipts minted with
the address-derived hash are throwaway.

### 4.6 UI-level leftovers (do not port)

- Hashes, tx ids, `snarkos` command strings and full addresses rendered to users on eight pages
  and in PDFs; PDFs print "Proven National Workers" and a fake manifest with empty `employer_addr`.
- Onboarding "skip" buttons that mark name/profile registered without any transaction, persisted
  to localStorage.
- Audit authorization: never implemented on-chain on either side (builds a command string for a
  program that does not exist). Mark as not built; `audit_nft.aleo` is live and waiting.
- `offer_store` populated only by the QR path, so the on-chain offer accept leaves the W-4,
  timesheet and dashboard with "no agreement".
- `packages/persistence` (drafts encrypted under the view key, which is empty in the wallet path):
  superseded by `@pnw/vault`. Delete after its tests are archived.
- `pnw_payroll_engine/` (Julia): retired, still in the tree. Delete.
- Monorepo: `SetupScreen.tsx:170` says "including PNW"; `tokens.css` duplicates brand colours and
  `--hewn-*` vars; three pages use `--hewn-green` directly. Collapse into `packages/brand` when
  the Hewn art lands.

### 4.7 Documentation drift to fix when the code moves

- CLAUDE.md (root) and `pnw_mvp_v2` docs say 4-step sequential is the live path; code says
  monolithic.
- `pnw_mvp_v2/portal/src/{config,adapters,commitments}` and `LAYER1_INTERFACE.md` reference v1/v2
  programs and an unused hashing scheme.
- `portal:docs/EMPLOYER_FLOWS.md` describes QR onboarding, `employer_agreement_v2`,
  `@react-pdf/renderer` and a dual-consent mint that do not exist.

## 5. Questions for Joshua

Answered 2026-10-14: the settlement path (single-call steps, parallel; `ALEO_CONSTRAINTS.md`),
the W-4 channel (mailbox, §4.4) and the display name (`.hewn`, §2.1).

Also answered: fees (employer pays, actual cost, no platform fee; §2.2) and the settlement shape
(one transfer per payee; §2.2), which makes a 10-worker run 10 taps.

Still open: whether a true one-tap run (worker-pull escrow or a session key,
`ALEO_CONSTRAINTS.md` §5) is worth its rule change, to be judged after feeling 10 taps on testnet.

## 6. Proposed order (one task, one exit criterion, one PR each)

| # | Task | Exit criterion it serves |
| --- | --- | --- |
| 1 | Record the decisions in CLAUDE.md / BUILD_PLAN: rail-only money movement, mailbox exception, `.hewn`, single-call settlement, `@admin` vs `@noupgrade` | housekeeping, no code |
| 2 | **Link a Shield wallet** from Settings: `packages/wallet` as an opt-in adaptor, vault key wrapped by a wallet signature over a domain-separated message | Phase 1: vault opens with passphrase *or* linked wallet |
| 3 | **Identity map**: import `FinalAgreement` records into the Team list; store address, name hash, agreement id per worker; registered employer name hash in settings; `.hewn` display | Phase 0 (part): the app knows who is on-chain |
| 4 | **Pay run settlement fields**: `PayRun` and entry `source.ref` carry mode, receipt anchor, tx id, height; fiat runs carry `settled_externally`; manifest compiled from paychecks; fee pair | Phase 2: fiat run produces identical entries minus the transfer |
| 5 | **Pay queue** replacing the coordinator (§4.1–4.3 and `ALEO_CONSTRAINTS.md` §5): one `transfer_private` per payee, pre-split, parallel, resumable from the vault, actual fee read back, wallet-only, tests replacing the CLI-path ones | prerequisite for 6 |
| 6 | **Settled payroll run from `apps/business` on testnet**, 3 workers, three entries each carrying its paystub hash and transition id; record taps and wall-clock per transfer | Phase 2 criterion 1 and Phase 0 criterion 1 (criterion text to be reworded from "receipt anchor" to "paystub hash and transition id") |
| 7 | **Mailbox**: the stateless function, one encryption scheme from `parties_key`, unpin after delivery; first payloads: agreement terms and the paystub | Phase 0 criterion 2 (part) |
| 8 | **Worker role** inside the same app: wallet sign-in, offers, paystubs from the mailbox checked against the wallet's records, credential badge | Phase 0 criterion 2 (replaces `apps/worker`) |
| 9 | **Leo session** (Fable, high effort): bump pins; `gl_core.aleo` period anchoring with negative tests; `paystub_receipts` and `payroll_core_v2` retired to `programs/archive/` | Phase 1 chain criteria |
| 10 | Cleanup: delete `persistence`, `pnw_payroll_engine`, dead portal code; archive the portal repo with a pointer | Phase 0 criterion 4 |

Tasks 2, 3 and 4 touch no chain transaction and can be verified entirely offline.
