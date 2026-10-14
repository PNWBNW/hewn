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

**One decision needed before the payroll bridge:** which settlement path actually works in
Shield today. The code says monolithic (`USE_MONOLITHIC_PAYROLL = true`), the docs say 4-step
sequential. See §5, question 1.

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
(`pnw_name_registrar_v5.aleo` `name_plaintext`), so showing it is fine; the suffix is a display
choice.

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

So the books are the richer record and must come first. The bridge, in fiat and settled mode
alike, is:

1. `postPayRun` posts one balanced entry per paycheck (already built: Dr Wages, Dr Employer
   Payroll Taxes, Cr Payroll Liabilities, Cr Bank). In settled mode the "bank" account is the
   USDCx wallet account, and a `fee_amount > 0` adds a Dr Platform Fee / Cr Platform Fee Payable
   pair (BUILD_PLAN Phase 2).
2. The manifest is compiled **from the posted paychecks**, not from a separate table:
   `gross = paycheck.gross`, `net = paycheck.net`, `tax_withheld = federal + SS + Medicare +
   additional Medicare`, `epoch_id = payDate`.
3. Settlement runs through the wallet; the resulting `receipt_anchor`, tx id and block height
   are written to the entry's `source.ref` and to the `PayRun`.
4. The entry hash chain is unchanged (the anchor goes in `source.ref`, which is hashed), so a
   settled entry is bound to its receipt, which is what Phase 2's exit criterion asks for.

What this fixes from the portal: the portal threw the tax breakdown away
(`portal:app/(employer)/payroll/new/page.tsx:389` keeps only `totalTax`), computed no employer
taxes, kept the active run in localStorage, and rebuilt history from receipts with zeroed hashes
and `"aleo1unknown"` workers. In the new model the vault is the history and receipts are proof.

Chain only moves **net**. Withheld tax stays with the employer as a liability, which is exactly
what the books record. Consistent.

### 2.3 Invoices and bills

Same pattern: `sendInvoice` posts A/R; a USDCx payment arrives as a `Token` record from the
customer; `receivePayment` posts it with the tx id as `reference`. For bills, `payBills` triggers a
`transfer_private` and records the tx id. No new program; the receipt side (a paystub-style record
for invoices) is a later nicety.

### 2.4 The worker's paystub

The worker's wallet holds a `WorkerPaystubReceipt` with totals only. Two ways to show a full
paystub with no server:

- **Now, zero cost:** the worker role keeps the worker's own W-4 in their vault, reads gross and
  withheld from the record, and recomputes the breakdown with the same tax engine. The engine
  is deterministic, so the recomputed total must equal `tax_withheld`; if it does not, the
  paystub shows the total only and flags it.
- **Clean, later (Leo session):** `paystub_receipts_v2.aleo` with per-tax fields and the pay
  period on the private record. Private records can carry this; nothing public changes.

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
- **Monolithic vs sequential.** `payroll_core_v2::execute_payroll` is one 5-program proof and
  writes `paid_epoch` (on-chain double-pay guard). The 4-step split never writes it. The portal
  currently runs monolithic (`portal:src/coordinator/settlement_coordinator.ts:617`, same in
  `packages/coordinator`), with a comment that the "Shield drops it" belief may have been wrong and
  timing constants "based on observed monolithic runs". CLAUDE.md and BUILD_PLAN still say
  sequential. See §5.
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

### 4.4 Server-dependent pieces (violate "no server")

The portal has four Next.js API routes with a Pinata JWT: terms upload/lookup, timekeeping
upload/list. `packages/w4-crypto` and `packages/handshake/codec` still call them. Decisions:

- **W-4**: the real-world flow is the worker hands the form to the employer; the new app already
  stores the W-4 on the employer's `Worker` record in the vault. Keep that. The worker role keeps
  its own copy for §2.4. No channel needed; `uploadEncryptedW4`/`fetchAndDecryptW4` go.
- **Agreement terms**: `terms_doc_hash` is on the agreement record; the plaintext terms belong in
  both parties' vaults, delivered in the offer link (the QR/URL path already carries the full
  `OfferIntent`). Drop IPFS.
- **Timesheet**: punches went to Pinata encrypted and never reached payroll anyway (the employer
  typed hours by hand). Out of scope until the worker role exists; then punches live in the
  worker's vault and the weekly total travels with the pay-run request.

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
  `--plumb-*` vars; three pages use `--plumb-green` directly. Collapse into `brand.ts` when the
  Hewn art lands.

### 4.7 Documentation drift to fix when the code moves

- CLAUDE.md (root) and `pnw_mvp_v2` docs say 4-step sequential is the live path; code says
  monolithic.
- `pnw_mvp_v2/portal/src/{config,adapters,commitments}` and `LAYER1_INTERFACE.md` reference v1/v2
  programs and an unused hashing scheme.
- `portal:docs/EMPLOYER_FLOWS.md` describes QR onboarding, `employer_agreement_v2`,
  `@react-pdf/renderer` and a dual-consent mint that do not exist.

## 5. Questions for Joshua

1. **Which payroll path works in Shield today?** Monolithic `execute_payroll` (one signature per
   worker, writes `paid_epoch`) or the 4-step split (four signatures, no `paid_epoch`)? The code
   and the docs disagree. If monolithic works, it is strictly better and the sequential code can go.
2. **W-4 entered by the employer** (as the new app does, and as paper works) rather than uploaded
   by the worker: fine?
3. **Fee**: is there a platform fee in settled mode, and who receives it? `fee_amount` exists on
   every receipt; the books have no account for it yet.
4. **Display name**: show `name.pnw` to users as today, or just `name`?

## 6. Proposed order (one task, one exit criterion, one PR each)

| # | Task | Exit criterion it serves |
| --- | --- | --- |
| 1 | Record the answers to §5 in CLAUDE.md / BUILD_PLAN; rewrite the Phase 2 bridge text to "books first, chain second, anchor written back" | housekeeping, no code |
| 2 | **Link a Shield wallet** from Settings: `packages/wallet` as an opt-in adaptor, vault key wrapped by a wallet signature over a domain-separated message | Phase 1: vault opens with passphrase *or* linked wallet |
| 3 | **Identity map**: import `FinalAgreement` records into the Team list; store address, name hash, agreement id per worker; registered employer name hash in settings | Phase 0 (part): the app knows who is on-chain |
| 4 | **Pay run settlement fields**: `PayRun` and entry `source.ref` carry mode, receipt anchor, tx id, height; fiat runs carry `settled_externally`; manifest compiled from paychecks; fee pair | Phase 2: fiat run produces identical entries minus the transfer |
| 5 | **Coordinator rewrite** per §4.1–4.3, wallet-only, with tests replacing the CLI-path ones | prerequisite for 6 |
| 6 | **Settled payroll run from `apps/business` on testnet**, 3 workers, three entries each linked to its receipt anchor | Phase 2 criterion 1 and Phase 0 criterion 1 |
| 7 | **Worker role** inside the same app: wallet sign-in, paystubs from records with breakdown per §2.4, credential badge | Phase 0 criterion 2 (replaces `apps/worker`) |
| 8 | **Leo session**: `gl_core.aleo` (Phase 1) and, if wanted, `paystub_receipts_v2` with breakdown fields | Phase 1 chain criteria |
| 9 | Cleanup: delete `persistence`, `pnw_payroll_engine`, dead portal code; archive the portal repo with a pointer | Phase 0 criterion 4 |

Tasks 2, 3 and 4 touch no chain transaction and can be verified entirely offline.
