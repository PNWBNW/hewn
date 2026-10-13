<p align="center"><img src="apps/business/public/brand/plumb-hero-1536.jpg" alt="Plumb: honest books, grounded and true." width="100%"></p>

## Plumb

**Plumb** is the bookkeeping app being built in this repo: double-entry books, payroll and reports
that live encrypted on your own device. No account, no server, no wallet needed. Proofs on Aleo are
an optional upgrade, never a requirement. Spec: [`BUILD_PLAN.md`](BUILD_PLAN.md) ·
progress: [`PROGRESS.md`](PROGRESS.md) · app: [`apps/business`](apps/business).

---

# Proven National Workers (PNW)

> **Privacy-first payroll on Aleo.** An end-to-end zero-knowledge payroll framework
> where wages, identities, and employment data never leave the user's browser
> unencrypted. This repo is the master index — the two working repos live as
> submodules below.

---

## Repository Structure

| Submodule | What It Owns | Links |
|---|---|---|
| [`pnw_mvp_v2`](./pnw_mvp_v2) | All on-chain logic: Leo programs, adapters, commitment primitives, deployment manifests, CI/CD | [GitHub](https://github.com/PNWBNW/pnw_mvp_v2) |
| [`pnw_employment_portal_v1`](./pnw_employment_portal_v1) | All UI and orchestration: Next.js 16 dApp, manifest compiler, settlement coordinator, generative credential art engine, client-side PDF generation, 5-wallet integration | [GitHub](https://github.com/PNWBNW/pnw_employment_portal_v1) |

**Strict boundary:** the portal never owns on-chain logic; the core repo never owns UI. The adapter layer (`src/lib/pnw-adapter/` in the portal, synced from `portal/src/adapters/` in mvp_v2) is the only execution boundary — every on-chain call passes through it.

---

## How It Works

### The Employer Flow

1. **Connect wallet** — Shield, Puzzle, Leo, Fox, or Soter via the official `@provablehq/aleo-wallet-adaptor-*` package. The wallet provides the Aleo address; the portal never touches private keys.

2. **Register a `.pnw` name** — the employer calls `pnw_name_registrar_v5.aleo::register_employer_name`, which binds a human-readable name (e.g. `acme_corp.pnw`) to their wallet address on-chain. The name hash is used as the employer's identity anchor throughout the system. The `.pnw` name system includes a **full bidirectional resolver** — forward (name → address) and reverse (address → name) — so every surface in the system displays human-readable identities instead of raw Aleo addresses: paystub PDFs, credential card headers, the employer's worker list, and the worker dashboard all resolve `.pnw` names from on-chain data. One name per wallet, soulbound, non-transferable — worker OR employer, not both.

3. **Create an agreement** — the portal encrypts the full employment terms client-side (AES-256-GCM), pins the ciphertext to IPFS via Pinata, and broadcasts a `PendingAgreement` record on-chain via `employer_agreement_v4.aleo::create_job_offer`. Only the employer and worker hold the decryption key, derived from the private `parties_key` field. No plaintext terms touch the blockchain or any server.

4. **Worker accepts** — the worker's wallet receives the `PendingAgreement` as a private record, fetches and decrypts the terms from IPFS, and accepts on-chain via `accept_job_offer`. This mints three `FinalAgreement` records — one for the employer, one for the worker, one for the DAO — binding the two wallets in a cryptographically verifiable employment relationship.

5. **Run payroll** — the employer opens the payroll table, selects workers, and the pipeline auto-computes everything:
   - **Pay rate** auto-fills from the agreement (hourly rate or salary per period)
   - **Hours** entered by employer (hourly workers) or auto-fills (salary)
   - **Gross** = rate × hours (hourly) or fixed amount (salary)
   - **Tax** auto-computed by the built-in federal tax engine using each worker's W-4 data (filing status, dependents, adjustments) via the IRS annualization method — brackets auto-adjust based on projected 12-month income
   - **Net** = gross − tax − fee

   The compiled `PayrollRunManifest` (content-addressed by BLAKE3) is then settled on-chain via `payroll_core_v2.aleo::execute_payroll`, which atomically:
   - Verifies the agreement is active (`employer_agreement_v4::assert_agreement_active`)
   - Transfers USDCx privately via Sealance-compliant Merkle exclusion proofs (`test_usdcx_stablecoin::transfer_private`)
   - Mints private paystub receipts for both worker and employer (`paystub_receipts::mint_paystub_receipts`)
   - Anchors a tamper-proof audit event hash (`payroll_audit_log::anchor_event`)

   All four sub-operations execute in a single zero-knowledge proof per worker. Multi-worker runs are sequential with automatic USDCx change-record handling between workers — tested with 3 workers on testnet.

6. **Anchor the run** — after all workers settle, the portal mints a cycle NFT via `payroll_nfts_v2.aleo::mint_cycle_nft` that commits the batch root to the chain for auditability.

7. **Issue credentials** — the employer calls `credential_nft_v3.aleo::mint_credential_nft`, which enforces three cross-program authorization checks before minting:
   - Caller owns the employer's `.pnw` name (`pnw_name_registry_v2::assert_is_owner`)
   - Target address owns the worker's `.pnw` name (`pnw_name_registry_v2::assert_is_owner`)
   - Caller holds an active agreement with the worker, proven via the private `parties_key` commitment (`employer_agreement_v4::assert_employer_authorized`)

   Each mint emits **two** `CredentialNFT` records in a single transition — one owned by the employer (authoritative) and one owned by the worker (visible in their wallet). Both carry the same `credential_id`. Unauthorized mints revert at the contract level.

### The Worker Experience

- **W-4 Tax Withholding** — after accepting an agreement, the worker completes a W-4 form directly in the portal — no PDF download or upload needed, zero friction on mobile. The form covers all four IRS W-4 steps (Step 1: filing status, Step 2: multiple jobs, Step 3: dependents with $2,000/$500 credits, Step 4: other income/deductions/extra withholding). On submit, the W-4 data is encrypted with the shared `parties_key` (AES-256-GCM, derived from both wallet addresses via BLAKE3) and pinned to IPFS. The employer decrypts it independently using the same derived key — no key exchange needed. The W-4 feeds directly into the tax engine so each worker's payroll is computed with their own filing status, dependent credits, and adjustments.

- **Timesheet** — workers clock in and out from the Timesheet tab. Time entries are stored in localStorage keyed by wallet address. The dashboard shows weekly hours with a progress bar toward 40 hours and a pulsing indicator when clocked in. Hours feed into the payroll table's Hours column for auto-calculated gross pay.

- **Credentials** — the worker connects their wallet and navigates to the Credentials tab. The portal scans for `CredentialNFT` records owned by the connected address. Each credential renders as a unique generative topographic blueprint card — 1-5 mountain peaks, contour rings, and a profile silhouette, all deterministically derived from the credential's BLAKE3 hash. Four credential types produce four distinct color palettes (cyan, gold, parchment, forest). The worker's `.pnw` name and truncated Aleo address appear in the card header. Workers can download the art as PNG or print a PDF certificate.

- **Paystubs** — the Paystubs tab scans the wallet for `WorkerPaystubReceipt` records. No view key required — the wallet decrypts its own records automatically. Each paystub shows gross, tax, fee, and net amounts in USD with a print button that generates a PDF including the worker's full `.pnw` name, full Aleo address, earnings summary, on-chain transaction references, and cropped credential badge thumbnails.

- **Offers** — pending job offers appear as private `PendingAgreement` records in the worker's wallet. The worker reviews encrypted terms (decrypted locally from IPFS) and accepts on-chain.

### How The Two Repos Interact

```
pnw_employment_portal_v1 (Layer 3)
│
├── src/lib/pnw-adapter/        ← synced from pnw_mvp_v2/portal/src/
│   ├── layer1_adapter.ts       ← program ID + transition name mapping
│   ├── layer2_adapter.ts       ← credential/payroll NFT transition mapping
│   ├── canonical_encoder.ts    ← deterministic TLV encoding (BLAKE3)
│   ├── hash.ts                 ← domain-separated hashing
│   └── merkle.ts               ← Merkle tree construction
│
├── src/manifest/compiler.ts    ← payroll table → PayrollRunManifest
├── src/coordinator/            ← settlement orchestration + wallet polling
├── src/records/                ← wallet record scanners (paystubs, credentials, agreements)
├── src/credentials/            ← credential hash computation + wallet mint calls
├── src/stores/
│   ├── w4_store.ts             ← W-4 tax withholding elections per wallet
│   └── timesheet_store.ts      ← clock-in/out time entries per wallet
├── src/lib/
│   ├── tax-engine.ts           ← federal payroll tax computation (annualization method)
│   ├── w4-crypto.ts            ← parties_key AES-256-GCM encryption for W-4 IPFS sharing
│   ├── w4-pdf-parser.ts        ← IRS W-4 PDF AcroForm field reader (pdf-lib)
│   └── logger.ts               ← structured logger with tag filtering + trace IDs
├── src/nft-art/                ← generative topographic renderer (Canvas 2D)
│   ├── hash_params.ts          ← credential_id → terrain parameters (multi-peak)
│   └── topo_renderer.ts        ← heightmap → contours → profile → card
│
└── components/
    ├── credential-art/         ← CredentialCard React wrapper + PNG export
    └── pdf/                    ← client-side PDF generators (jsPDF)

pnw_mvp_v2 (Layers 1 + 2)
│
├── src/layer1/                 ← Leo programs (on-chain execution)
│   ├── payroll_core_v2.aleo    ← atomic payroll settlement + double-pay guard
│   ├── employer_agreement_v4.aleo ← agreement lifecycle + employer authorization
│   ├── paystub_receipts.aleo   ← private receipt minting (worker + employer copies)
│   ├── payroll_audit_log.aleo  ← hash-only audit event anchoring
│   ├── pnw_name_registry_v2.aleo ← .pnw name ownership + resolver
│   ├── employer_license_registry.aleo ← employer verification gate
│   └── ...
│
├── src/layer2/                 ← NFT commitment programs
│   ├── credential_nft_v3.aleo  ← dual-record mint + 3 cross-program auth checks
│   ├── payroll_nfts_v2.aleo    ← cycle/quarter/YTD/EOY batch anchors
│   └── audit_nft.aleo          ← dual-consent audit authorization
│
└── config/testnet.manifest.json ← canonical deployed program ID registry
```

The portal compiles manifests, orchestrates settlement, and renders UI. The Leo programs execute, verify, mint records, and anchor commitments. The adapter layer maps between them — the portal never calls `snarkos` directly.

---

## Programs Deployed to Testnet

| Program | Purpose |
|---|---|
| `payroll_core_v2.aleo` | Monolithic payroll execution with `paid_epoch` double-pay guard |
| `employer_agreement_v4.aleo` | Agreement lifecycle + `assert_employer_authorized` for credential auth |
| `credential_nft_v3.aleo` | Dual-record credential mint with 3 cross-program authorization checks |
| `credential_nft_v4.aleo` | Adds employer license verification (staged for post-buildathon activation) |
| `paystub_receipts.aleo` | Private `WorkerPaystubReceipt` + `EmployerPaystubReceipt` minting |
| `payroll_audit_log.aleo` | Hash-only audit event anchoring with block-height timestamps |
| `payroll_nfts_v2.aleo` | Cycle NFT batch anchor (imports `employer_agreement_v4`) |
| `pnw_name_registry_v2.aleo` | `.pnw` name hash registry with ownership assertions |
| `pnw_name_registrar_v5.aleo` | Name registration with USDCx pricing and reverse resolver |
| `employer_license_registry.aleo` | Employer verification gate (AUTHORITY-controlled) |
| `audit_nft.aleo` | Dual-consent audit authorization + attestation anchoring |

---

## Privacy Invariants

1. **No sensitive data in any database.** Private keys, view keys, wages, names, and addresses live in session memory only. The portal has no backend server and no database.

2. **No plaintext on public chain state.** Public mappings hold only hashes and commitment anchors — enforced by every Leo program in the stack.

3. **Encrypted agreement terms.** Full employment terms are encrypted client-side (AES-256-GCM) before being pinned to IPFS. Only the two parties hold the decryption key, derived from their private `FinalAgreement` records. No plaintext passes through any server or the blockchain.

4. **Client-side document generation.** PDFs (paystubs, credential certificates, audit authorizations) are generated entirely in the browser using jsPDF. No upload, no third-party PDF service.

5. **Deterministic credential art.** Each credential's visual is a pure function of its BLAKE3 hash — rendered client-side on Canvas, no image stored anywhere. Same hash always produces the same pixels.

6. **Immutable manifests.** The `PayrollRunManifest` is content-addressed by BLAKE3. Changing any row changes the `batch_id`, making tampering detectable.

7. **Encrypted W-4 tax data.** Worker W-4 elections (filing status, dependents, adjustments) are encrypted with the shared `parties_key` (AES-256-GCM, derived independently by both parties from their wallet addresses via BLAKE3) before being pinned to IPFS. No plaintext tax data on any server — the employer decrypts using the same derived key.

8. **Client-side tax computation.** Federal income tax, Social Security, and Medicare are computed entirely in the browser using the IRS annualization method. No payroll amounts are sent to any external tax service.

---

## Testnet Milestone: E10 (2026-04-10)

First successful end-to-end private payroll + anchor executed from the portal UI:

| Step | Program | Transaction |
|---|---|---|
| Verify agreement | `employer_agreement_v4` | `at1mydsktdsr8pk7d4utzrp6n2rvtgkkpavthukyt4kpdadgyx5lg8sgljea3` |
| Transfer USDCx | `test_usdcx_stablecoin` | `at1yphn8n9zejqnnsktuev7rl9vkv8styq00rjpffa0h7rxnccssyyqdk9ltw` |
| Mint receipts | `paystub_receipts` | `at1w86wy80c9sgv0e2ukwlzja4r4km0vkld2tna586t9447q6pjvvrqhuvnw4` |
| Anchor event | `payroll_audit_log` | `at1jp6mertn92hpn79uak8vdy9t4ha2t0f4fwq877uy6rmjl20g0syqdzygp3` |
| Mint cycle NFT | `payroll_nfts_v2` | `at1d8ht598hqqjgmqfxjwvt0cf47aqafgynzjhazhtreze6j22hzcrq5992r5` |

---

## Documentation

### In `pnw_mvp_v2`
- [`docs/ARCHITECTURE.md`](./pnw_mvp_v2/docs/ARCHITECTURE.md) — deep technical architecture and trust model
- [`docs/NOTES.md`](./pnw_mvp_v2/docs/NOTES.md) — issue tracker and fix priority
- [`docs/DIRECTORY.md`](./pnw_mvp_v2/docs/DIRECTORY.md) — repo file map with per-file descriptions
- [`docs/IDEA_BOARD.md`](./pnw_mvp_v2/docs/IDEA_BOARD.md) — payroll speedup brainstorming

### In `pnw_employment_portal_v1`
- [`docs/BUILD_ORDER.md`](./pnw_employment_portal_v1/docs/BUILD_ORDER.md) — phase-by-phase build plan with exit criteria
- [`docs/EMPLOYER_FLOWS.md`](./pnw_employment_portal_v1/docs/EMPLOYER_FLOWS.md) — all employer UX flows
- [`docs/HANDSHAKE.md`](./pnw_employment_portal_v1/docs/HANDSHAKE.md) — agreement handshake protocol
- [`docs/INTEROP.md`](./pnw_employment_portal_v1/docs/INTEROP.md) — cross-repo sync contract
- [`docs/PAYROLL_RUN_MANIFEST.md`](./pnw_employment_portal_v1/docs/PAYROLL_RUN_MANIFEST.md) — manifest data contract
- [`docs/nft_plan.md`](./pnw_employment_portal_v1/docs/nft_plan.md) — generative credential NFT art system

---

## License

Proprietary — PNW Smart Contract License v1.7. See [`LICENSE.md`](./LICENSE.md).
