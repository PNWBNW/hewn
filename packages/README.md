# packages/

Hewn's libraries. Source-only TypeScript, no build step: `pnpm build` is a strict typecheck of
every package, and the apps consume the `.ts` sources directly. Import by subpath, for example
`import { domainHash } from "@pnw/commitments/hash"`. Every package is `AGPL-3.0-only`.

The internal names stay `@pnw/*` (PNW is the protocol namespace); the product's name lives in one
package, `brand`, and nowhere else.

## Layering

Imports only point down. The fiat boundary (`apps/business/src/fiat_boundary.test.ts`) adds a
second rule: the ledger, vault, payroll, sales and reports never import a package from the "chain"
rows, and only `apps/business/src/chain` may.

| Layer | Package | What it holds | Chain? |
|---|---|---|---|
| 0 | `brand` | The name, tagline, colours, asset paths and the app and site addresses: the only place the product is named | |
| 0 | `security` | The browser security policy the app and the site share: CSP builder, static headers, nonce | |
| 0 | `ui` | Theme tokens and the shared components (buttons, cards, dialogs) | |
| 0 | `art` | The cards' renderer (`docs/HEWN_ART.md`): a business's map, a paystub's rings, the constellation, the sky, as deterministic SVG text; colours from `brand` | |
| 0 | `ledger` | The double-entry core: accounts, entries, the rules with a negative test each, reports | |
| 0 | `tax-engine` | Federal withholding by the IRS annualization method; the only tax engine | |
| 0 | `mailbox` | Sealed party-to-party documents keyed from the shared `parties_key`: envelope, lookup ids, the courier client | |
| 0 | `commitments` | BLAKE3 domain hashing, Merkle trees, the canonical TLV encoder, Aleo scalar types | chain |
| 0 | `config` | Environment and the deployed program ids (from `pnw_mvp_v2`'s manifest) | chain |
| 1 | `vault` | The encrypted store: a random data key wrapped by the unlock secret; "stay logged in" | |
| 1 | `payroll` | Workers, pay runs, paychecks, the paystub's canonical form | |
| 1 | `sales` | Customers, vendors, estimates, invoices, bills, payments | |
| 1 | `pnw-adapter` | Program and transition names for every Layer 1 and 2 call; routers | chain |
| 1 | `wallet` | The Shield provider and executor: the only way a transaction is signed | chain |
| 1 | `handshake` | The offer and acceptance engine and codec | chain |
| 2 | `manifest` | Payroll run compiler, chunk planner, row validation | chain |
| 3 | `records` | Record scanners and registry reads | chain |
| 4 | `rail` | The pay queue: one private stablecoin transfer per payee through the wallet, resumable | chain |

Four salvaged packages that nothing uses any more (`persistence`, `w4-crypto`, `pdf`, `nft-art`)
are in [`../archive/packages/`](../archive/README.md), out of the workspace.

Hashing note: `commitments` keeps the portal's `BLAKE3(domain || payload)` rule, which is what is
live on testnet. `pnw_mvp_v2/portal/src/commitments` diverged and is not the source of truth.
