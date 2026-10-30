# Invariants

Every non-negotiable rule, with an id, where it is enforced, the check that proves it, and the
threats it answers (`THREAT_MODEL.md`, T1 to T17). The wording of each rule lives in `CLAUDE.md`
(Hewn's, and `pnw_mvp_v2`'s for the chain rules); this table owns where each one is enforced and
how it is checked. A **none** in the Check column is a known gap and a to-do, not a hidden one.

`scripts/check_invariants.py` runs in CI and fails when an id in `CLAUDE.md` is missing here, a
row from Hewn's `CLAUDE.md` isn't cited there, a check path doesn't exist, or a row names a threat
the threat model doesn't have. Paths under `pnw_mvp_v2/` are checked when the submodule is
checked out.

**Enforced in:** *structure* (the architecture leaves no other way), *vault* (`@pnw/vault`),
*circuit* (the Leo program refuses it), *code* (one module owns it), *CI* (a test or script
fails the build), *review* (only a person reading the change), *not yet* (nothing to enforce it on).

## Privacy floor

| Id | Rule | Enforced in | Check | Threats |
|---|---|---|---|---|
| INV-01 | Anything tied to an individual (wages, withholdings, W-4 data, bank details, paystubs, address) is private in every mode and can never be made public | vault, circuit | `packages/vault/src/vault.test.ts` · "stores no plaintext"; `pnw_mvp_v2/scripts/check_public_state.py` (every public mapping listed with what it reveals) | T2, T6 |
| INV-02 | No private data on any server, ever; no database; plaintext only in the browser session | structure, CI | `packages/vault/src/boundary.test.ts` · "never touches the network"; `apps/business/src/security/headers.test.ts` · "talks to its own origin, the explorer and the Shield relay, nothing else" | T1, T3 |
| INV-03 | Public Aleo mappings hold only hashes, commitments and block heights; never a plaintext amount, account name, memo or identity | circuit, CI | `pnw_mvp_v2/scripts/check_public_state.py`; `pnw_mvp_v2/docs/PUBLIC_STATE.md` (reviewed by a person: the check proves the list complete, not each reason) | T6, T15, T17 |
| INV-04 | Aggregates publish only as proofs, with a minimum group size | not yet | none (no aggregate is published yet; `docs/AUDIT_DESIGN.md` step 6) | T6 |
| INV-05 | The one server exception: two traction totals per country, no dates, addresses or ids; every country shown while on testnet (Joshua, 2026-10-30), a country shown only from 5 visitors before mainnet; cached a day | code, CI | `apps/business/src/app/api/traction/counts.test.ts` · "names every country with a visitor while on testnet…", "with a floor (5 before mainnet)…", "is cached for a day at the edge, and carries no dates" | T11 |

## Keys and storage

| Id | Rule | Enforced in | Check | Threats |
|---|---|---|---|---|
| INV-06 | Never commit private keys, view keys, `.env` files or seed phrases; never print them in logs (a business's own view key may sit inside its encrypted books, T20) | CI, review | `scripts/check_secrets.py` (both repositories: Aleo keys, tokens, PEM keys, literal secrets, tracked `.env` files; seed phrases stay with review); `pnw_mvp_v2/scripts/check_secrets.py` | T18, T20 |
| INV-07 | The vault key comes from the unlock secret (username and passphrase, PBKDF2-SHA256 600k rounds) and only wraps a random AES-256-GCM data key; the key is never stored in plaintext and never leaves the vault module | vault, CI | `packages/vault/src/vault.test.ts` · "defaults to 600k PBKDF2 rounds", "never exposes an exportable data key", "changes passphrase without re-encrypting the books" | T2, T8 |
| INV-08 | "Stay logged in" keeps only the non-extractable data key, for at most 24 hours, forgotten on Log out | vault, CI | `packages/vault/src/vault.test.ts` · "reopens the books without the passphrase until the session expires", "keeps a non-extractable key, and refuses to resume a tampered one" (known gap: Log out and closing the tab at once, issue #150) | T8 |
| INV-09 | No server account: nothing is verified remotely; a lost passphrase is replaced only with the account's recovery key | structure, vault, CI | `packages/vault/src/recovery.test.ts` | T8 |
| INV-10 | localStorage is not a book of record; durable data goes in the encrypted IndexedDB vault | code, CI | `scripts/check_browser_storage.py` (web storage holds five flags, each owned by one file, the fifth a step name from a fixed list (`apps/business/src/books/drawing_step.ts`); IndexedDB only in `packages/vault`; no cookies or Cache API); manual check PRIV-3 on issue #163 | T2 |

## Boundaries

| Id | Rule | Enforced in | Check | Threats |
|---|---|---|---|---|
| INV-11 | Every on-chain write is signed in the user's wallet through the `wallet` package's executor; nothing calls `snarkos` or the SDK execute path directly | code, CI | `scripts/check_signing_path.py` (one door: only `apps/business/src/chain/shield.ts` touches the wallet adapter; no send outside the chain code, no SDK execute path, no `child_process`, no CLI adapter) | T3 |
| INV-12 | Program and transition names come from `pnw-adapter` and `@pnw/config`, never hard-coded elsewhere | code, CI | `scripts/check_program_names.py` (no `<name>.aleo` written out outside `packages/config` and `packages/pnw-adapter`; `credits.aleo`, the network's own, allowed) | T15 |
| INV-13 | Every account is on the registry: setup links Shield and registers a name, and an unfinished account stays on `/settings/setup` | code, CI | `apps/business/src/books/setup.test.ts` · "keeps an unfinished account on the setup page, wherever it tries to go" | T16 |
| INV-14 | Team members, customers and vendors are added only by their registered name, shown only when its hash checks out | code, CI | `apps/business/src/chain/directory.test.ts`; `apps/business/src/books/directory.test.ts` | T16 |
| INV-15 | One kind of account per Shield account: business and personal money never share a wallet | code, CI | `apps/business/src/chain/account_kind.test.ts` · "refuses when the registry can't be read, rather than letting it through" | T16 |
| INV-16 | The ledger core, vault, reports and payroll never import `wallet`, `pnw-adapter`, `rail` or `records`; chain code lives in `src/chain` and loads only where needed | CI | `apps/business/src/fiat_boundary.test.ts`; `packages/ledger/src/boundary.test.ts`; `packages/vault/src/boundary.test.ts`; `packages/sales/src/boundary.test.ts`; `apps/site/src/site_boundary.test.ts` | T3 |
| INV-17 | One security policy for the whole app: scripts by nonce or digest, no inline or eval'd code, connections only to the app, the explorer and the Shield relay | code, CI | `apps/business/src/security/headers.test.ts`; `apps/business/src/security/static_csp.test.ts` | T3 |
| INV-18 | Extension modules never touch posting logic or the vault key | not yet | none (no extension API yet; Phase 8) | T7 |
| INV-19 | Mode upgrades are one-way, show exactly what goes on chain, and take a second wallet signature after a review screen; never a side effect | not yet | none (anchored and settled modes aren't built yet) | T6 |

## Leo programs

| Id | Rule | Enforced in | Check | Threats |
|---|---|---|---|---|
| INV-20 | Deployed programs are immutable: a change ships as a new version with a migration note; `config/testnet.manifest.json` is the source of truth for what is live | structure, review | `pnw_mvp_v2/scripts/validate_testnet_manifest.py` (the manifest's shape only; nothing yet compares a deployed program with its source) | T4, T15 |
| INV-21 | Superseded versions move unchanged to `src/layer1/archive/` or `src/layer2/archive/`, with a row in that folder's README | CI, review | `pnw_mvp_v2/scripts/check_archive.py` (every archived file's hash in that archive's `SHA256SUMS`; every folder has a README row) | T4 |
| INV-22 | Any new or changed Leo program is flagged before work starts and ships with negative tests run in CI | CI, review | `pnw_mvp_v2/.github/workflows/deploy.yml` (asserts each tested program's pass count); `pnw_mvp_v2/scripts/check_public_state.py` (its Tests column must match the gate) | T6, T15 |
| INV-23 | No cumulative counters in public mappings: they leak wages by difference (`pnw_mvp_v2` `CLAUDE.md`) | CI, review | `pnw_mvp_v2/scripts/check_layer1_public_leakage_guards.py` (a tripwire on five spellings of a running total, not a proof); `pnw_mvp_v2/docs/PUBLIC_STATE.md` (two counters today, neither about money) | T6 |
| INV-24 | Layer 2 never moves funds; no pooled custody: an employer's USDCx is consumed and the worker's emitted in one transition, or paid with a plain `transfer_private` (`pnw_mvp_v2` `CLAUDE.md`) | CI, review | `pnw_mvp_v2/scripts/check_layer2_moves_no_funds.py` (Layer 2 imports only money-free programs, calls only `assert_` checks, names no token or transfer) | T6 |
