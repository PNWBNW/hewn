# archive/

Retired code, kept out of the way but not thrown away. Nothing in here is built, tested, published
or imported; the workspace (`pnpm-workspace.yaml`) and the test runner only look at `apps/` and
`packages/`. It stays because the decisions that retired it are easier to trust when the thing
itself is still here to read.

| Folder | Was | Retired | Replaced by |
|---|---|---|---|
| `pnw_payroll_engine/` | A Julia service that computed federal withholding (IRS annualization) for the old portal | 2026-10-13 | `packages/tax-engine`, the same method in TypeScript, running on the device |
| `salvage/` | The one-time script that copied the portal's libraries into `packages/`, and the patch it applied | 2026-10-13, after it ran | Nothing: the packages are owned here now and have changed since. Don't run it again. |
| `packages/persistence/` | An encrypted draft store for the old portal, keyed from the wallet's view key | 2026-10-14 | `packages/vault`: a random data key wrapped by the unlock secret |
| `packages/w4-crypto/` | W-4 sharing encrypted under a key computed from the two addresses, which anyone who knew both could compute | 2026-10-14 | Sealed letters (`packages/mailbox`, `hewn_letters_v2.aleo`) |
| `packages/pdf/` | Paystub, payroll-run, credential and audit PDFs drawn with jsPDF | 2026-10-19 | The paystub view in the app; print from there |
| `packages/nft-art/` | Generative topographic art for credential NFTs, seeded from the credential id | Waiting | Credentials are a later phase; when they return, this comes back with them |

To bring a package back: move it into `packages/`, run `pnpm install`, add it to the layering table
in `packages/README.md`. To bring back a program version, see `src/layer1/archive/README.md` in
`pnw_mvp_v2`.
