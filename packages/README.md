# packages/

Libraries salvaged from `pnw_employment_portal_v1` (Phase 0). Behaviour is unchanged: the only
edits are import specifiers and a few type-only blocks lifted out of app stores. Regenerate with
`python3 salvage/salvage.py <portal-checkout> .`.

Source-only TypeScript: no emit. `pnpm build` is a strict typecheck of every package; apps
consume the `.ts` sources directly. Import modules by subpath, e.g.
`import { domainHash } from "@pnw/commitments/hash"`.

## Layering (imports only point down)

| Layer | Package | What it holds |
|---|---|---|
| 0 | `commitments` | BLAKE3 domain hashing, Merkle, canonical TLV encoder, token ids, Aleo scalar types |
| 0 | `config` | Env and deployed program ids |
| 0 | `tax-engine` | IRS annualization withholding (the only tax engine) |
| 1 | `pnw-adapter` | Layer 1/2 transition maps and routers, CLI adapter, freeze-list resolver, Sealance types |
| 1 | `wallet` | Wallet provider, wallet executor, credential signer |
| 1 | `handshake` | Offer/acceptance engine and codec |
| 2 | `manifest` | Payroll run compiler, chunk planner, payroll-table row types and validation |
| 3 | `records` | Record scanners, `.pnw` name registry reads, shared record types |
| 3 | `persistence` | Encrypted draft store (seed of the Phase 1 vault) |
| 3 | `w4-crypto` | W-4 encryption between agreement parties |
| 4 | `coordinator` | Settlement coordinator, double-pay guard, receipt reconciler, roster/credentials managers, batch anchor |
| 4 | `nft-art` | Credential NFT terrain art |
| 4 | `pdf` | Paystub, payroll run, credential and audit PDFs |

Hashing note: `commitments` keeps the portal's `BLAKE3(domain || payload)` rule, which is what is
live on testnet. `pnw_mvp_v2/portal/src/commitments` uses `BLAKE3(domain || 0x00 || payload)` and
has diverged; it is not the source of truth.
