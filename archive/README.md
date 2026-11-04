# archive/

Retired code is deleted, not kept (OPS-09): git history is the archive. A retired thing leaves the
tree, so nothing can import it, copy it by accident or bring it back half-remembered, and this
file keeps one row for it: what it was, when it went and why, and the commit that still holds it.
Nothing else lives in this folder (`scripts/check_archive.py`, in CI).

The one exception is a deployed Leo program version: it stays in `pnw_mvp_v2`'s
`src/layer1/archive/` or `src/layer2/archive/`, unchanged (INV-21), because it is on chain for good
and its source is what anyone checks the deployed program against.

| Folder | Was | Retired | Replaced by | Held by |
|---|---|---|---|---|
| `pnw_payroll_engine/` | A Julia service that computed federal withholding (IRS annualization) for the old portal | 2026-10-13 | `packages/tax-engine`, the same method in TypeScript, running on the device | `a285093` |
| `salvage/` | The one-time script that copied the portal's libraries into `packages/`, and the patch it applied | 2026-10-13, after it ran | Nothing: the packages are owned here now and have changed since | `a285093` |
| `packages/persistence/` | An encrypted draft store for the old portal, keyed from the wallet's view key | 2026-10-14 | `packages/vault`: a random data key wrapped by the unlock secret | `a285093` |
| `packages/w4-crypto/` | W-4 sharing encrypted under a key computed from the two addresses, which anyone who knew both could compute | 2026-10-14 | Sealed letters (`packages/mailbox`, `hewn_letters_v2.aleo`) | `a285093` |
| `packages/pdf/` | Paystub, payroll-run, credential and audit PDFs drawn with jsPDF | 2026-10-19 | The paystub view in the app; print from there | `a285093` |
| `packages/nft-art/` | Generative topographic art for credential NFTs, seeded from the credential id | 2026-11-04 (kept as "waiting" until then) | The credential and paystub art planned in `docs/HEWN_ART.md`, which keeps its seeded-terrain idea | `a285093` |
| `mailbox-api/` | The mailbox: a server route (`/api/mailbox`) that pinned sealed envelopes on IPFS through Pinata, a daily sweep that unpinned old ones, and the app's client for it (`mailbox_client.ts`). Off in production (it never had a storage key) | 2026-10-22 | Letters on chain (`hewn_letters_v2.aleo`): every message is a record sealed to its recipient, sent from their wallet. The envelope format itself stays in `packages/mailbox` | `a285093` |
| `packages/coordinator/` (never moved here) | The portal's payroll coordinator, with the CLI adapter's pasted-key fallback | 2026-10-13 | `packages/rail`, the pay queue through the wallet | `6335ce6` (deleted in #27) |

The portal leftovers deleted from inside the live packages on 2026-11-04 (the old transaction
executor, four record scanners, the CLI adapter and its routers) were never here; they are in
`progress/2026-11-04.md`, held by `a285093` too.

**To read or bring one back:** `git show a285093:archive/<path>` reads a file;
`git checkout a285093 -- archive/<folder>` restores a folder, which then moves to `packages/` with
a `pnpm install` and a row in the layering table in `packages/README.md`. To bring back a program
version, see `src/layer1/archive/README.md` in `pnw_mvp_v2`.
