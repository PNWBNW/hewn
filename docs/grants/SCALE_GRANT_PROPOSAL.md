# SCALE Grant Proposal: Proven National Workers (PNW)

> Privacy-first payroll on Aleo — already executing end-to-end on testnet.

---

## Project Overview

### The Problem

Payroll is the largest recurring financial obligation for businesses worldwide, yet the systems that process it are built on decades-old architecture that requires workers to surrender their most sensitive data — Social Security numbers, bank accounts, home addresses, wages — to centralized databases controlled by third-party processors (ADP, Gusto, Paychex). These systems are:

- **Surveillance-heavy:** Every payroll run transmits plaintext wage data through multiple intermediaries. Workers have zero control over who sees their compensation.
- **Breach-prone:** Payroll processors are high-value targets. ADP alone processes payroll for ~20% of the US workforce. A single breach exposes millions of records.
- **Exclusionary:** 1099 contractors, gig workers, and unbanked populations are often locked out of formal payroll systems entirely, forced into cash or informal arrangements with no verifiable employment history.
- **Opaque:** Workers cannot independently verify that their tax withholding was computed correctly or that their employer actually remitted what was owed. They trust the processor's math — and have no recourse when it's wrong.

In Web3, this problem is compounded: DAOs and crypto-native organizations need to pay contributors but have no privacy-preserving payroll infrastructure. Existing on-chain payment tools (Superfluid, Sablier, Utopia Labs) stream tokens publicly — every contributor's compensation is visible to the entire network.

### How PNW Solves This with Aleo's ZK Technology

Proven National Workers is an end-to-end zero-knowledge payroll framework built natively on Aleo. It is the first system where wages, identities, and employment relationships are never visible on-chain, on any server, or to any third party — while remaining fully auditable through scoped, consent-based disclosure.

**Why privacy is essential for payroll:**
- Wage data is among the most sensitive personal information. Publicly visible compensation creates discrimination vectors, enables social engineering, and violates labor privacy norms in most jurisdictions.
- Employment relationships are private. An on-chain record linking a wallet to an employer reveals organizational structure, headcount, and individual roles — competitive intelligence that no business should be forced to publish.
- Tax withholding elections (W-4 data) contain filing status, dependent counts, and income adjustments. This is IRS-protected information that should never appear in plaintext on any shared ledger.

**PNW's privacy architecture leverages Aleo's core primitives:**
- **Private records** for USDCx wage transfers, paystub receipts, and employment agreements — only the record owner can decrypt
- **Zero-knowledge proofs** for payroll execution — the network verifies correctness (valid agreement, sufficient funds, correct amounts) without seeing the underlying data
- **Private-to-private token transfers** via Aleo's native record model — no public mapping entries, no visible balances
- **Cross-program authorization** via commitment-based proofs — credential minting requires proving an active employment relationship without revealing its terms
- **Sealance Merkle exclusion proofs** (Poseidon4, depth 16) for asset-level compliance — proving a wallet is NOT on a sanctions list without revealing what's on the list

### Anticipated Impact on Aleo's Ecosystem

PNW drives three categories of Aleo ecosystem value:

1. **Network activity:** Every payroll run generates 4-5 on-chain transactions per worker per pay period — agreement verification, USDCx transfer, receipt minting, audit anchoring, and cycle NFT minting. A single employer with 25 workers on biweekly payroll generates ~250+ transactions/month. At scale, payroll becomes one of the highest-frequency transaction categories on Aleo.

2. **USDCx adoption:** PNW requires shielded USDCx for settlement. Every employer using PNW must shield stablecoins before running payroll, driving demand for Aleo's private token infrastructure. This creates a direct, recurring use case for private DeFi (ZeFi) — employers need to acquire, shield, and manage USDCx balances.

3. **Real-world utility demonstration:** Payroll is the "killer app" proof point for privacy technology. If Aleo can credibly run private payroll — the most regulated, most sensitive, most frequent financial operation businesses perform — it validates the entire platform for enterprise adoption. PNW on mainnet is a proof-of-concept that every Fortune 500 CISO can understand.

---

## Team Background

### Core Team

**Joshua Daniel Day** — Founder & Lead Architect
- Designed the complete PNW system architecture: Leo programs, adapter layer, settlement coordinator, manifest compiler, and portal UI
- Built and deployed 11 Leo programs to Aleo testnet, achieving end-to-end private payroll execution (April 2026)
- Authored the PNW Smart Contract License v1.7 protecting against unauthorized AI/government control of payroll infrastructure
- Background in workforce systems, labor advocacy, and privacy-first technology design
- GitHub: [PNWBNW](https://github.com/PNWBNW)

### Technical Achievements

- **11 Leo programs deployed and tested on Aleo testnet** — payroll settlement, agreement lifecycle, credential NFTs with cross-program authorization, audit anchoring, name registry with bidirectional resolver, employer verification gate
- **First end-to-end private payroll execution on Aleo** (April 10, 2026) — verified agreement, transferred USDCx privately, minted receipts, anchored audit event, minted cycle NFT — all in a single session from a browser-based portal
- **Multi-worker payroll tested** with 3 workers in sequential execution with automatic USDCx remainder-record handling
- **Wallet integration** — Shield wallet via official @provablehq/aleo-wallet-adaptor-shield package (additional wallets planned)
- **Client-side federal tax engine** implementing IRS Publication 15-T annualization method — brackets, FICA, Medicare computed entirely in-browser with no external service
- **Generative credential NFT art system** — deterministic topographic card art derived from BLAKE3 credential hashes, 4 credential type palettes, multi-peak terrain rendering
- **Previous recognition:** Aleo Buildathon participant (April 2026)

### Repositories & Live Demo

| Resource | Purpose | Link |
|---|---|---|
| **Live Portal** | Deployed dApp (Aleo testnet) | [pnw-employment-portal-v1.vercel.app](https://pnw-employment-portal-v1.vercel.app/) |
| `pnw` | Master index (submodules) | [github.com/PNWBNW/pnw](https://github.com/PNWBNW/pnw) |
| `pnw_mvp_v2` | Leo programs, adapters, commitment primitives | [github.com/PNWBNW/pnw_mvp_v2](https://github.com/PNWBNW/pnw_mvp_v2) |
| `pnw_employment_portal_v1` | Next.js portal (employer + worker dApp) | [github.com/PNWBNW/pnw_employment_portal_v1](https://github.com/PNWBNW/pnw_employment_portal_v1) |

---

## What's Already Built (Testnet-Proven)

PNW is not a proposal — it is a working system. The following has been built, deployed, and tested on Aleo testnet:

**On-Chain (11 Leo programs deployed):**
- Payroll settlement with USDCx private transfers and double-pay guards
- Employment agreement lifecycle (offer → accept → pause/terminate/resume)
- Private paystub receipt minting (worker + employer copies)
- Hash-only audit event anchoring with block-height timestamps
- Soulbound `.pnw` name registry with bidirectional resolver and USDCx pricing
- Credential NFTs with 3 cross-program authorization checks and dual-record mint
- Payroll cycle NFT batch anchoring
- Employer license verification gate
- Dual-consent audit authorization with time-limited access

**Portal (Next.js 16 dApp — no backend, no database):**
- Employer onboarding: wallet connect → name registration → profile → agreement creation
- Worker onboarding: wallet connect → name registration → profile → offer acceptance
- Payroll table with auto-computed tax (from W-4 data) and auto-filled rates (from agreement)
- 4-step sequential settlement coordinator with live progress bar per worker
- Multi-worker payroll tested with 3 workers (automatic USDCx remainder handling)
- Client-side federal tax engine (IRS annualization, 2026 brackets, FICA, Medicare)
- Inline W-4 form (all 4 IRS steps, encrypted IPFS sharing via parties_key)
- Worker timesheet (clock-in/out, weekly hours, 40-hour progress bar)
- Worker paystub viewer (wallet record scan — no view key needed)
- Generative topographic credential art (BLAKE3-seeded, 4 palettes, PNG/PDF export)
- Client-side PDF generation for paystubs, credentials, and audit authorizations
- Shield wallet integration via official @provablehq/aleo-wallet-adaptor-shield
- Encrypted agreement terms (AES-256-GCM + IPFS via Pinata)

**Testnet Proof (April 10, 2026):** First successful end-to-end private payroll — 5 confirmed transactions from browser UI in a single session.

---

## Market Potential & Demand

### Target User Segments

**Primary — Small Businesses & Startups (1-50 employees)**
- 33.2 million small businesses in the US alone (SBA, 2024)
- Most use third-party payroll processors, paying $4-12/employee/month + per-run fees
- Pain point: forced to hand all employee data to processors like ADP/Gusto with no visibility into data handling
- PNW value: employer runs payroll directly from their browser, no intermediary holds the data

**Secondary — DAOs & Crypto-Native Organizations**
- ~13,000 active DAOs managing ~$25B in treasuries (DeepDAO, 2025)
- No existing solution for private contributor compensation — all current tools stream tokens publicly
- Pain point: contributor compensation visible to competitors, tax authorities, and the public
- PNW value: first private payroll infrastructure purpose-built for on-chain organizations

**Tertiary — Gig Economy & 1099 Contractors**
- 73.3 million freelancers in the US (Upwork, 2024), projected 86.5M by 2027
- Most have no verifiable employment history, making it difficult to qualify for loans, housing, or benefits
- Pain point: informal payment arrangements leave no auditable trail
- PNW value: privacy-preserving credential NFTs create verifiable employment history without exposing compensation details

### Total Addressable Market

| Segment | TAM | PNW Penetration Target (Year 1) |
|---|---|---|
| US small business payroll | $100B+/year in processing fees | 100 employers (proof of concept) |
| DAO treasury management | $25B in assets, growing 40%+ YoY | 20 DAOs |
| Global gig/freelancer payments | $455B/year (Statista, 2024) | 500 workers |

### Quantitative Market Indicators

- **Payroll processing market** growing at 7.2% CAGR, reaching $62B globally by 2030 (Grand View Research)
- **Privacy regulation acceleration:** GDPR, CCPA, and 15+ new US state privacy laws since 2023 — employers face increasing liability for wage data breaches
- **Crypto payroll demand:** 36% of US freelancers expressed interest in crypto compensation (Triple-A, 2024), but privacy concerns remain the #1 barrier
- **Aleo network growth:** testnet participation and developer activity increasing — PNW adds a high-frequency, real-world transaction category that demonstrates commercial viability

### Competitive Landscape

| Solution | Private Wages | Private Identity | On-Chain Settlement | Tax Engine | Verifiable Credentials |
|---|---|---|---|---|---|
| ADP/Gusto/Paychex | No | No | No | Server-side | No |
| Superfluid/Sablier | No (public streams) | No | Yes | No | No |
| Utopia Labs | No | Partial | Yes | No | No |
| Request Network | No | No | Yes | No | No |
| **PNW on Aleo** | **Yes (ZK proofs)** | **Yes (private records)** | **Yes (USDCx)** | **Yes (client-side)** | **Yes (credential NFTs)** |

PNW is the only solution that achieves privacy across ALL dimensions — wages, identity, employment relationships, tax data, and credentials — while maintaining auditability through consent-based disclosure.

---

## System Design & Specification

### Architecture Overview

PNW uses a strict three-layer architecture:

**Layer 3 - Employment Portal (Next.js 16 dApp):** Browser-only. No backend server. No database. Compiles payroll manifests, orchestrates settlement, renders UI, generates PDFs client-side.

**Layer 2 - NFT Commitment Programs (Aleo):** Credential NFTs, payroll cycle anchors, audit authorization tokens. Immutable on-chain commitments.

**Layer 1 - Core Settlement Programs (Aleo):** Payroll execution, agreement lifecycle, receipt minting, audit event anchoring. All private records.

### Main Components

**1. Leo Programs (On-Chain — Layer 1 + 2)**

| Program | Purpose | Status |
|---|---|---|
| `payroll_core_v2.aleo` | Atomic payroll settlement with `paid_epoch` double-pay guard | Deployed |
| `employer_agreement_v4.aleo` | Agreement lifecycle + `assert_employer_authorized` for credential auth | Deployed |
| `paystub_receipts.aleo` | Private `WorkerPaystubReceipt` + `EmployerPaystubReceipt` minting | Deployed |
| `payroll_audit_log.aleo` | Hash-only audit event anchoring with block-height timestamps | Deployed |
| `payroll_nfts_v2.aleo` | Cycle NFT batch anchor (imports `employer_agreement_v4`) | Deployed |
| `pnw_name_registry_v2.aleo` | `.pnw` name hash registry with ownership assertions | Deployed |
| `pnw_name_registrar_v5.aleo` | Name registration with USDCx pricing and bidirectional resolver | Deployed |
| `credential_nft_v3.aleo` | Dual-record credential mint with 3 cross-program auth checks | Deployed |
| `credential_nft_v4.aleo` | Adds employer license verification (staged) | Deployed |
| `employer_license_registry.aleo` | Employer verification gate (AUTHORITY-controlled) | Deployed |
| `audit_nft.aleo` | Dual-consent audit authorization + attestation anchoring | Deployed |

**2. Adapter Layer (Execution Boundary)**

The portal never calls `snarkos` directly. All on-chain interaction flows through `src/lib/pnw-adapter/`, which maps program IDs + transition names and handles:
- Deterministic TLV encoding with BLAKE3 content addressing
- Domain-separated hashing (`PNW::DOC`, `PNW::PARTIES`, `PNW::NAME`)
- Merkle tree construction for Sealance compliance proofs
- Canonical type encoding matching what Leo programs expect

**3. PayrollRunManifest (Content-Addressed)**

Every payroll run is compiled into an immutable manifest:
- Each worker row is hashed (BLAKE3) with: agreement_id, gross, tax, fee, net, epoch
- Rows are assembled into a Merkle tree (`row_root`)
- The manifest itself is content-addressed: `batch_id = BLAKE3(canonical manifest bytes)`
- Changing any field changes the `batch_id`, making tampering detectable
- The `batch_id` is anchored on-chain via `mint_cycle_nft`

**4. Settlement Coordinator (4-Step Sequential)**

Each worker's payroll settles in 4 independent ZK proofs:
1. `employer_agreement_v4::assert_agreement_active` — verify employment relationship
2. `test_usdcx_stablecoin::transfer_private` — transfer wages (private-to-private)
3. `paystub_receipts::mint_paystub_receipts` — mint receipt records for both parties
4. `payroll_audit_log::anchor_event` — anchor tamper-proof audit hash

This sequential approach keeps each proof small and fast, ensuring reliable execution from the browser.

**5. Client-Side Tax Engine**

Federal income tax computation runs entirely in the browser using the IRS annualization method (Publication 15-T):
- 2026 projected brackets for all 4 filing statuses
- Social Security (6.2% up to $184,500 wage base, YTD tracking)
- Medicare (1.45% + 0.9% additional above $200K cumulative)
- W-4 adjustments: dependent credits, other income, extra deductions, extra withholding
- No tax data ever leaves the client

**6. Encrypted Data Sharing (Parties Key)**

Worker W-4 data and agreement terms are shared between employer and worker using:
- `parties_key = BLAKE3("PNW::PARTIES", TLV(employer_addr, worker_addr))`
- Both parties can independently derive the same key from their wallet addresses
- Data encrypted with AES-256-GCM, pinned to IPFS via Pinata
- No key exchange protocol needed — both parties compute the key locally

**7. .pnw Name System**

Human-readable identity layer:
- One name per wallet, soulbound, non-transferable
- Forward resolver: `acme_corp.pnw` -> `aleo1abc...`
- Reverse resolver: `aleo1abc...` -> `acme_corp.pnw`
- Names appear on credential cards, paystub PDFs, portal headers
- Registration costs USDCx (paid to DAO treasury)

**8. Generative Credential Art**

Each credential NFT renders as a unique topographic blueprint card:
- 1-5 mountain peaks deterministically derived from credential's BLAKE3 hash
- Contour rings via marching squares algorithm on heightmap
- 4 credential types produce 4 distinct color palettes (cyan, gold, parchment, forest)
- Worker's `.pnw` name + truncated Aleo address in card header
- Downloadable as PNG, printable as PDF certificate

### Data Flow

**Browser Layer (no backend, no database):**

Employer browser: Payroll Table + Tax Engine + PDF Generator --> compiles --> PayrollRunManifest (batch_id, row_root) --> Adapter Layer --> 4 ZK proofs per worker --> Aleo Testnet

Worker browser: W-4 Form, Timesheet, Credentials, Paystubs --> AES-256-GCM encrypted --> IPFS (Pinata) for cross-browser sharing

**Aleo Testnet (on-chain programs called per payroll run):**

1. employer_agreement_v4: assert_agreement_active
2. test_usdcx_stablecoin: transfer_private (wages)
3. paystub_receipts: mint_paystub_receipts (worker + employer copies)
4. payroll_audit_log: anchor_event (hash-only)
5. payroll_nfts_v2: mint_cycle_nft (batch anchor)
6. credential_nft_v3: mint_credential_nft (3 cross-program auth checks)
7. pnw_name_registry_v2: .pnw identity (soulbound, bidirectional resolver)

**On-chain privacy rule:** Public state contains only hashes, commitments, and anchors. Private state (wages, names, addresses, terms, tax data) lives exclusively in private records decryptable only by their owner.

### Timeline for Remaining Components

| Component | Dependency | Target |
|---|---|---|
| Multi-worker batch payroll (25+ workers) | Settlement coordinator optimization | Month 1-2 |
| Double-pay protection (epoch guard) | `mark_epoch_paid` transition or portal-side guard | Month 1 |
| Step failure recovery UI | Settlement coordinator retry logic | Month 2 |
| Mainnet USDCx integration | Sealance mainnet deployment | Month 3-4 |
| Mobile responsive polish | None | Month 2-3 |
| External security audit | All features frozen | Month 5-6 |
| Mainnet deployment | Audit complete + USDCx available | Month 7-8 |
| Worker timesheet → employer auto-population | Encrypted on-chain timesheet records | Month 4-5 |
| DAO governance module | Post-mainnet | Month 9-12 |

---

## Funding & Milestones

**Funding Request: $100,000**

### Budget Breakdown

| Phase | Deliverables | Timeline | Cost |
|---|---|---|---|
| **Phase A: Hardening** | Multi-worker batch (25+), double-pay guard, step recovery, mobile responsive | Months 1-2 | $18,000 |
| **Phase B: Tax & Compliance** | State tax engine (top 5 states), W-2/1099 generation | Months 3-4 | $15,000 |
| **Phase C: Mainnet Prep** | USDCx mainnet integration, name registry migration, program upgrades | Months 4-6 | $17,000 |
| **Phase D: Security Review** | External security review of Leo programs + portal penetration testing | Months 5-7 | $25,000 |
| **Phase E: Mainnet Launch** | Deployment, documentation, onboarding first employers | Months 7-9 | $12,000 |
| **Phase F: Ecosystem Growth** | Developer docs, credential verification portal, community onboarding | Months 9-12 | $8,000 |
| **Infrastructure** | IPFS pinning (Pinata), RPC access, domain, Vercel hosting | 12 months | $5,000 |
| | | **Total** | **$100,000** |

### Milestone Schedule

**Months 1-2: Production Hardening ($18,000)**
- [ ] Multi-worker payroll supporting 25+ workers per run with automatic USDCx change-record handling
- [ ] Double-pay protection deployed (epoch-based guard preventing duplicate payroll for same worker/period)
- [ ] Step failure recovery — resume from any failed step without restarting the entire run
- [ ] Mobile-responsive portal tested on iOS Safari and Android Chrome
- **Exit criteria:** 25-worker payroll run completes successfully on testnet

**Months 3-4: Tax & Compliance ($15,000)**
- [ ] State income tax engine for top 5 US states by employment (CA, TX, FL, NY, WA)
- [ ] Automated W-2 and 1099-NEC generation (client-side PDF, encrypted storage)
- [ ] Worker timesheet data encrypted and shared via on-chain records for payroll auto-population
- **Exit criteria:** Complete payroll cycle including tax forms generated for a 10-worker employer

**Months 4-7: Security Review + Mainnet Prep ($42,000)**
- [ ] External security review of all deployed Leo programs
- [ ] Portal penetration testing (XSS, injection, key handling, session management)
- [ ] USDCx mainnet integration testing with Sealance production proofs
- [ ] Name registry migration plan (testnet `.pnw` names → mainnet)
- [ ] Deploy all 11 programs to Aleo mainnet
- **Exit criteria:** Security review report with no critical findings; programs deployed to mainnet

**Months 7-9: Mainnet Launch ($12,000)**
- [ ] End-to-end payroll execution on mainnet with real USDCx
- [ ] Documentation: employer onboarding guide, worker guide
- [ ] Community onboarding: first 10 employers running real payroll
- **Exit criteria:** 10 employers onboarded, 50+ workers paid on mainnet

**Months 9-12: Ecosystem Growth ($8,000)**
- [ ] Credential verification portal (public verifier checks credential validity without seeing compensation)
- [ ] Developer documentation and integration guides
- [ ] Community growth and onboarding pipeline
- **Exit criteria:** 50 employers, 250 workers active on mainnet

---

## Evaluation Criteria Alignment

### 1. Impact (Alignment with Ecosystem Strategy)

**Drive Commercialization and Adoption:**
- PNW creates a direct, recurring commercial use case for Aleo — payroll runs generate 4-5 transactions per worker per pay period
- Every employer using PNW must acquire and shield USDCx, driving stablecoin adoption
- The `.pnw` name system generates USDCx revenue for the DAO treasury on every registration

**Prepare for Payments Integration:**
- PNW is a payments application — private USDCx transfers are the core settlement mechanism
- The parties_key infrastructure (BLAKE3-derived AES-256-GCM) can be reused for any two-party encrypted data sharing on Aleo
- The Sealance Merkle exclusion proof integration demonstrates production-ready compliance infrastructure

**Invest in Future Infrastructure:**
- The client-side tax engine, content-addressed manifests, and settlement coordinator are reusable infrastructure for any ZeFi application
- The generative credential art system demonstrates NFTs as functional identity primitives, not just collectibles
- The adapter boundary pattern (planning layer → execution layer) provides a reference architecture for any multi-program Aleo dApp

### 2. Readiness (Feasibility of Integration)

- **Already working on testnet** — not a whitepaper, not a prototype, not a mockup
- All 11 Leo programs deployed and tested with real transactions
- Portal is a functional dApp with employer and worker flows end-to-end
- Uses official Provable wallet adapters and SDK — no custom wallet infrastructure needed
- Leo v4.0 migration complete — all programs compile with current toolchain
- Grant funding would harden and scale what already works, not build from scratch

### 3. Collaborative Value (Potential for Collaboration)

**Ecosystem Partner Integration Points:**
- **Wallet teams:** PNW is integrated with Shield wallet and architected to support additional wallets (Puzzle, Leo, Fox, Soter) — payroll runs are a high-engagement use case that drives daily wallet opens
- **zPass:** PNW's credential NFTs could integrate with zPass for cross-platform identity verification — a worker's employment credential from PNW could be verifiable in any zPass-compatible application
- **USDCx / Sealance:** PNW is a live consumer of USDCx with Sealance compliance proofs — direct feedback loop for the stablecoin team on real-world usage patterns
- **Developer tools:** PNW's adapter boundary pattern, content-addressed manifests, and multi-program settlement coordinator are reference implementations for Aleo dApp developers
- **DeFi / ZeFi:** PNW creates a recurring demand for shielded stablecoins — employers need to acquire, shield, and manage USDCx balances, creating natural on-ramps for DeFi liquidity

**Broader Appeal:**
- Privacy-first payroll is universally understood — it's the simplest pitch for why ZK matters ("your salary shouldn't be public")
- PNW on mainnet is a case study that Aleo can present to enterprise prospects, regulators, and media
- The open-architecture approach (proprietary license with permissible audits) demonstrates a credible commercial model for ZK applications

---

## Supporting Materials

### Testnet Transaction Proof (E10 Milestone — April 10, 2026)

| Step | Program | Transaction ID |
|---|---|---|
| Verify agreement | `employer_agreement_v4` | `at1mydsktdsr8pk7d4utzrp6n2rvtgkkpavthukyt4kpdadgyx5lg8sgljea3` |
| Transfer USDCx | `test_usdcx_stablecoin` | `at1yphn8n9zejqnnsktuev7rl9vkv8styq00rjpffa0h7rxnccssyyqdk9ltw` |
| Mint receipts | `paystub_receipts` | `at1w86wy80c9sgv0e2ukwlzja4r4km0vkld2tna586t9447q6pjvvrqhuvnw4` |
| Anchor event | `payroll_audit_log` | `at1jp6mertn92hpn79uak8vdy9t4ha2t0f4fwq877uy6rmjl20g0syqdzygp3` |
| Mint cycle NFT | `payroll_nfts_v2` | `at1d8ht598hqqjgmqfxjwvt0cf47aqafgynzjhazhtreze6j22hzcrq5992r5` |

### Privacy Invariants (Maintained Throughout All Phases)

1. No sensitive data in any database — private keys, view keys, wages, names live in session memory only
2. No plaintext on public chain state — public mappings hold only hashes and commitment anchors
3. Encrypted agreement terms — AES-256-GCM, pinned to IPFS, only two parties hold the key
4. Client-side document generation — PDFs generated entirely in the browser
5. Deterministic credential art — pure function of BLAKE3 hash, no images stored
6. Immutable manifests — content-addressed by BLAKE3, tampering changes the batch_id
7. Encrypted W-4 tax data — parties_key derived independently by both parties
8. Client-side tax computation — no payroll amounts sent to any external service

### Live Demo

- **Portal (Vercel):** [pnw-employment-portal-v1.vercel.app](https://pnw-employment-portal-v1.vercel.app/)

### GitHub Repositories

- **Master repo:** [github.com/PNWBNW/pnw](https://github.com/PNWBNW/pnw)
- **Leo programs:** [github.com/PNWBNW/pnw_mvp_v2](https://github.com/PNWBNW/pnw_mvp_v2)
- **Employment portal:** [github.com/PNWBNW/pnw_employment_portal_v1](https://github.com/PNWBNW/pnw_employment_portal_v1)
