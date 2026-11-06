---
status: decided
updated: 2026-11-06
summary: Veil, Provable's viem-style TypeScript toolkit for Aleo, read from its source: what it is, how it fits Hewn (typed program bindings, a local devnode for end-to-end tests, the reads Hewn lacks, writes through Shield), its risks, and the order to adopt it in; decided: adopt it, with Shield the only wallet.
---

# Veil: what it is, and how Hewn could use it

**Status:** decided (Joshua, 2026-11-05): **Hewn adopts Veil, and Shield stays the only wallet.**
Veil's wallet support is narrowed to Shield (its provider takes an explicit wallet list); offering
other wallets (Leo Wallet, Puzzle, Fox) waits until each is checked against what Hewn relies on.
Step 1 is built (2026-11-06, below); the rest of the order waits. Michael Turner (Provable) suggested Veil; read from the
source: the `ProvableHQ/veil` repository (cloned read-only, commit `9007de8`, 2026-11-05), its
packages and documentation site, its packages on npm, and the explorer.

## What it is

A TypeScript interface for Aleo modelled on viem, the Ethereum library: the same clients, actions
and method names (`createPublicClient`, `readContract`, `writeContract`, `getBlockNumber`), applied
to Aleo. It wraps Provable's lower-level SDK and the wallet adapters behind one API, and Provable's
SDK documentation now points developers wanting a friendlier interface to it. MIT licence, by
Provable, in active development.

| Package | What it does | Size and dependencies |
|---|---|---|
| `@provablehq/veil-core` | Clients, actions, transports, types; also agent and MCP bindings | No dependencies; about 1 MB unpacked |
| `@provablehq/veil-aleo-wallet-adapter` | Turns a connected wallet (Shield, Leo, Puzzle, Fox) into a Veil account and transport: signing, decryption, records and proving stay in the wallet | No dependencies; the wallet adapter core is an optional peer |
| `@provablehq/veil-aleo-react-hooks` | `VeilProvider`, `useVeilWallet()` | Pins the wallet adapters at 1.4.0 (Shield 1.4.0) |
| `@provablehq/veil-codegen` | Typed TypeScript bindings generated from a program's `abi.json`: record and struct decoders, mapping key and value types, a typed contract (`read`, `write`, `simulate`, `execute`) | Build-time only; output is checked in |
| `@provablehq/veil-aleo-devnode` | Starts, drives, snapshots and stops a local Aleo node for tests, with a funded genesis account | Needs the `aleo-devnode` binary on the machine |
| `@provablehq/veil-leo` | A typed wrapper around the `leo` command (`build`, `deploy`, `abi`) | Needs `leo` on the machine |
| `@provablehq/veil-aleo-sdk` | Local accounts, signing and proving from a private key | `@provablehq/sdk` ^0.13 |
| Bridge, Shield Swap SDK and CLI | Cross-chain bridging; the Shield Swap DEX | Not relevant to Hewn today |

**Maturity.** First published 2026-07-09; 20 versions since, about one a week; 0.16.2 released
2026-11-05. Still 0.x, so breaking changes are expected between minor versions. Its packages carry
no npm provenance attestation.

## How Hewn does it today

`@provablehq/sdk` 0.10.1 for reading and proofs (the stablecoin's freeze-list exclusion proof in
`packages/rail`, decrypting incoming payments with the business's view key), and Provable's wallet
adapters (Shield 1.3.0) for every transaction, through one door (`chain/shield.ts`, INV-11). Around
those: hand-written code to read mappings and parse their values, to parse record plaintext, and to
encode inputs (`[u8; 32]` arrays, packed `[u128; N]`). The integration audit (2026-10-13) already
asked for one typed decoder in place of several hand parsers.

## Where Veil fits

1. **Typed program bindings (codegen).** Generated from each Hewn program's ABI: record decoders,
   mapping value decoders, typed inputs. They would replace the hand parsers and encoders, one
   program at a time, and a program's redeploy would regenerate rather than rewrite them. This is
   the biggest correctness gain. **Checked 2026-11-06: it works.** Leo writes the ABI from 4.0.0
   on (`leo build` writes `build/abi.json`; `leo abi <file.aleo>` writes it from deployed bytecode,
   so no Leo source is needed). `leo abi` 4.0.0 on the live `hewn_letters_v2`, then
   `veil-codegen` 0.15.0, gave typed `toLetter`, `toSentLetter`, `toPage`, the inputs and outputs
   of `send`, `send_page` and `send_many`, and a typed contract. Leo changed the ABI's shape after
   4.0 (inputs and outputs carry their mode inside the variant, `is_final` is gone, `interfaces` and
   `views` are new), and Veil's parser (`parseAbi`) reads both shapes; it ignores the new sections,
   which Hewn's programs don't use. Read from Leo's source at both tags. CI's compile pin can't
   move to 4.4.6 (it refuses our programs' source, `docs/ALEO_CONSTRAINTS.md` §2b), which doesn't
   matter here: `leo abi` reads deployed bytecode, not source, so the ABI comes from the explorer's
   copy of each program, with any Leo.
2. **End-to-end tests against a real node (devnode).** Hewn's app tests mock the chain, and the Leo
   tests check programs alone. A devnode in CI would let tests deploy Hewn's programs locally and
   run real flows (an offer and its acceptance, a letter, a close and its anchor, a payment)
   without testnet. This is the biggest testing gain, and it ships nothing to users.
3. **Reads Hewn doesn't have.**
   - `getProgramCallsPaginated`: every call into a program. Hewn couldn't count its own usage
     (2026-11-05); with this route it can (below).
   - `getTransitionViewKeys`: a payment's view key from the wallet, which the period proof still
     lacks for its fourth check (AUDIT_DESIGN §4). Hewn doesn't need Veil for it: the Shield
     adapter it pins (1.3.0) already has `transitionViewKeys(transactionId)`.
   - `getComplianceFreezeList`, and freeze-list exclusion proofs computed inside the wallet: if
     Shield implements that algorithm, payroll could drop the proof it builds itself. **Checked
     2026-11-06, half answered.** The wallet standard defines it as a *derived input*,
     `program-freezelist-exclusion-proof` (output: the `[MerkleProof; 2]` the stablecoin takes):
     the app grants it at connect for one program, function and input slot, and the wallet fills
     that slot without the app seeing what went into it. The types are in Shield adapter 1.3.0, but
     its `algorithmsSupported()` returns the standard's fixed list, not the wallet's (its own
     comment says so); adapter 1.5.0 asks the wallet. Whether Shield itself computes it is the one
     question left for Michael.
4. **Writes through Shield.** Veil's wallet client, built on the Shield adapter, keeps every
   signature in the wallet, so it fits INV-11. It isn't needed yet: Hewn's executor works. It
   becomes worth it if the typed contracts from codegen are used for writes too. Not available
   through Shield: `simulate` (a dry run before signing). Veil's `simulateContract` needs a local
   account and throws `SimulateNotSupportedError` for a wallet account, in 0.15.0 and at the tip
   (`9007de8`); a preview before signing waits until wallets offer one.

## What to watch

- **The local-key path.** `@provablehq/veil-aleo-sdk` signs with a private key. Hewn's app must never
  import it, nor the devnode or `veil-leo` packages; tests may. The signing-path check
  (`scripts/check_signing_path.py`) refuses them outside tests (rule 7, 2026-11-06), as it refuses
  a CLI adapter.
- **Versions.** Hewn pins exact versions, at least seven days old (OPS-04), and Veil releases weekly:
  pin an older 0.x and move deliberately. The React hooks pin wallet adapters newer than Hewn's
  (1.4.0 against 1.3.0), so adopting them is also a wallet adapter upgrade; the wallet adapter and
  core packages alone avoid that.
- **The SDK version.** Veil's SDK-backed packages want `@provablehq/sdk` ^0.13; Hewn has 0.10.1. Using
  only `veil-core` and the wallet adapter package needs no SDK change. In the devnode tests
  (2026-11-06) `veil-aleo-sdk` brings its own 0.13.0, beside the app's 0.10.1, in tests only.
- **Transports and the content security policy.** Veil's examples default to
  `edge.provable.com`; Hewn would point its transport at the configured endpoint
  (`ENV.ALEO_ENDPOINT`), which the policy already allows.
- **Supply chain.** A new dependency is a new trust surface (THREAT_MODEL T3). `veil-core` having no
  dependencies helps; the lack of provenance doesn't.

## Found along the way: Hewn's real usage

The route behind `getProgramCallsPaginated` (`/programs/{program}/latest-calls/paginated`, at most 50
a page) answers what the explorer couldn't on 2026-11-05: how often Hewn's programs are called.
Every call ever made to Hewn's ten programs on testnet, read the same day:

| Program | Calls | When |
|---|---|---|
| `employer_agreement_v4` | 55 | 2026-04-08 to 2026-10-18 |
| `hewn_letters_v2` | 30 | 2026-10-18 to 2026-10-27 |
| `pnw_name_registrar_v5` | 29 | 2026-03-30 to 2026-10-26 |
| `payroll_audit_log` | 21 | 2026-04-10 to 2026-04-12 |
| `pnw_worker_profiles_v2` | 14 | 2026-03-27 to 2026-10-18 |
| `hewn_credentials_v1` | 14 | 2026-10-25 |
| `employer_agreement_v5` | 13 | 2026-10-25 |
| `hewn_cards_v1` | 13 | 2026-10-25 |
| `hewn_letters_v1` | 8 | 2026-10-16 |
| `hewn_jobs_v1` | 3 | 2026-10-19 |

200 in all, on 18 days, every one of them a day of Joshua's own testing (the first payroll in April,
and October 16 to 27), and none since October 27. Hewn has not yet been used by anyone else on
chain.

## Decisions (Joshua, 2026-11-05)

1. **Adopt Veil,** in the order below, one PR each.
2. **Shield only, for now.** Veil's provider is given Shield alone. Its getting-started page
   confirms wallets differ (Shield requires the programs declared at connection and honours
   record-access grants that other wallets ignore), so another wallet comes only after it is
   checked against Hewn's needs: the letter's sender, decryption with a view key, transition view
   keys, fee modes, its mobile browser.

## The reference copy, and updates

Joshua forked Veil to **`PNWBNW/veil`** (2026-11-05) so sessions can read it quickly. Three rules
keep it from misleading anyone:

1. **The fork is for reading, never for building.** Hewn depends on the published
   `@provablehq/veil-*` packages from npm, pinned exactly, never on the fork or a git URL. What the
   app runs is what the lockfile says, not what the fork holds.
2. **Read the version Hewn pins, not the fork's tip.** Before relying on something in the fork,
   check it out at the tag of the version in the lockfile. Veil tags each package on its own
   (`@provablehq/veil-core@0.15.0`, not `v0.15.0`), and the fork holds no tags (GitHub's "Sync
   fork" copies the branch only), so fetch the tag from Provable's repository into the clone:
   `git fetch https://github.com/ProvableHQ/veil tag @provablehq/veil-core@0.15.0`, then
   `git checkout @provablehq/veil-core@0.15.0`. The fork's main branch moves ahead weekly, and the
   tip may have changed what the pinned version does.
3. **Updates come in deliberately.** A new Veil version arrives through Dependabot's weekly batched
   pull request, at least seven days old (OPS-04), like every dependency. Each upgrade's pull
   request names the versions crossed and reads their release notes, since 0.x releases may break
   things. Sync the fork (GitHub's "Sync fork") when reading something newer than it holds.

**Leo, too.** Joshua forked Leo to **`PNWBNW/leo`** (2026-11-06), on the same three rules: read
only (CI downloads Leo's published release, pinned by version and sha256, never the fork); read
it at the tag of the version CI pins, fetched from Leo's repository since the fork holds no tags
(`git fetch https://github.com/aleo-labs-protocol/leo tag leo-lang-v4.4.6`); sync it when
something newer is needed.

**Where the protocol lives now.** Leo, snarkOS and snarkVM moved from `ProvableHQ` to the
**`aleo-labs-protocol`** organisation (late October 2026; snarkVM's own pull request records the
move on October 27). The old addresses still redirect and serve the same commits. Provable, "an
Aleo Labs company", keeps the developer products: the SDK, Veil, Shield and the explorer. Leo's
releases since 4.1 are tagged `leo-lang-v…` (4.4.6, 2026-10-28, pairs with snarkOS 4.12.0); only
4.0.0 to 4.0.2 carry plain `v…` tags. `pnw_mvp_v2`'s workflows still download from the old
addresses, which works through the redirect; its pin bump moves them.

## The order

1. **Devnode, `veil-leo` and codegen in tests and CI only.** Development dependencies, nothing
   shipped to users. First: one end-to-end test (an offer, its acceptance, a letter) against
   Hewn's real programs on a local node. The `aleo-devnode` binary installs from npm
   (`@provablehq/aleo-devnode`).
   **Built 2026-11-06:** `apps/business/test/devnode/`. `veil-core`, `veil-aleo-sdk` and
   `veil-aleo-devnode` 0.15.0 (the newest at least seven days old) and `aleo-devnode` 0.4.0, as
   development dependencies of the app. The test deploys `hewn_letters_v2` from its live bytecode
   (read from the explorer, checked by sha256), then drives it with Hewn's own `letterCall`,
   `manyCalls`, `parseLetterRecord` and the mailbox's `seal` and `open`: a letter and the sender's
   copy, a page, one announcement to three people, and an all-zero lookup the program must refuse.
   No Leo is needed, since the deployed bytecode is the input. CI runs it after `pnpm test`
   (about 40 s), and the signing-path check refuses the local-key packages outside tests. Next in
   this step: an offer and its acceptance (`employer_agreement_v5`, which imports the registry, so
   its imports deploy first). Codegen no longer waits: Leo's ABI works (above).
2. **Generated bindings in place of the hand parsers,** one program at a time, each its own PR with
   the old and new decoders tested against the same records.
3. **The reads:** a usage panel from the program-calls route (for Hewn's own traction, not the
   app), and transition view keys for the period proof's payment check.
4. **Writes through Veil's wallet client,** only if it clearly beats the current executor, with the
   signing-path check extended first.

One question back to Provable, through Michael: whether Shield implements the in-wallet
freeze-list proof (`program-freezelist-exclusion-proof`), and from which version. (Which Leo
writes the ABI, and whether `simulate` works through Shield, were answered from the source on
2026-11-06, above.)

## Sources

- `ProvableHQ/veil` (read 2026-11-05, commit `9007de8`): the README, each package's README and
  `package.json`, `packages/core/src` (the actions and the HTTP transport's routes)
- The `@provablehq/veil-*` packages on npm (versions, publish dates, provenance)
- The explorer's program-calls route, read for Hewn's ten programs on testnet
- Read 2026-11-06: `aleo-labs-protocol/leo` at `v4.0.0` and `leo-lang-v4.4.6` (`crates/abi`,
  `crates/abi-types`); Veil at `@provablehq/veil-core@0.15.0` and `9007de8`
  (`packages/core/src/utils/parseAbi.ts`, `actions/wallet/simulateContract.ts`,
  `types/inputRequest.ts`); the Shield adapter 1.3.0 (Hewn's) and 1.5.0 from npm;
  `aleo-labs-protocol/snarkVM` pull request 3614 and `aleo-labs-protocol/snarkOS` pull requests
  4610 and 4611 (the move)
