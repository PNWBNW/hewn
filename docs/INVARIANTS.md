---
status: living
updated: 2026-11-12
summary: Every non-negotiable rule with an id, where it is enforced, its check, its threats and the SOC 2 and ISO 27001 items it satisfies; then the operating rules. The control list.
---

# Invariants

Every non-negotiable rule, with an id, where it is enforced, the check that proves it, the
threats it answers (`THREAT_MODEL.md`, T1 to T21), and the framework items it satisfies (SOC 2's
Trust Services Criteria and ISO 27001:2022's Annex A controls, by number; `COMPLIANCE_MAP.md`
says why those two). The wording of each rule lives in `CLAUDE.md` (Hewn's, and `pnw_mvp_v2`'s
for the chain rules); this table owns where each one is enforced and how it is checked. A
**none** in the Check column is a known gap and a to-do, not a hidden one. This is the control
list an auditor reads (`COMPLIANCE_MAP.md`, "The internal audit"): the first table is the rules
the code keeps, the second the rules the company keeps.

`scripts/check_invariants.py` runs in CI and fails when an id in `CLAUDE.md` is missing here, a
row from Hewn's `CLAUDE.md` isn't cited there, a check path doesn't exist, a row names a threat
the threat model doesn't have, or a Frameworks cell isn't in the form `SOC 2 <criteria>; ISO
<Annex A controls>`. Paths under `pnw_mvp_v2/` are checked when the submodule is checked out.

**Enforced in:** *structure* (the architecture leaves no other way), *vault* (`@pnw/vault`),
*circuit* (the Leo program refuses it), *code* (one module owns it), *CI* (a test or script
fails the build), *review* (only a person reading the change), *not yet* (nothing to enforce it on).

## Privacy floor

| Id | Rule | Enforced in | Check | Threats | Frameworks |
|---|---|---|---|---|---|
| INV-01 | Anything tied to an individual (wages, withholdings, W-4 data, bank details, paystubs, address) is private in every mode and can never be made public | vault, circuit | `packages/vault/src/vault.test.ts` · "stores no plaintext"; `pnw_mvp_v2/scripts/check_public_state.py` (every public mapping listed with what it reveals) | T2, T6 | SOC 2 CC6.1, C1.1, P6.1; ISO A.5.12, A.5.34, A.8.11 |
| INV-02 | No private data on any server, ever; no database; plaintext only in the browser session | structure, CI | `packages/vault/src/boundary.test.ts` · "never touches the network"; `apps/business/src/security/headers.test.ts` · "talks to its own origin, the explorer and the Shield relay, nothing else" | T1, T3 | SOC 2 CC6.1, C1.1; ISO A.5.34, A.8.12 |
| INV-03 | Public Aleo mappings hold only hashes, commitments and block heights; never a plaintext amount, account name, memo or identity | circuit, CI | `pnw_mvp_v2/scripts/check_public_state.py`; `pnw_mvp_v2/docs/PUBLIC_STATE.md` (reviewed by a person: the check proves the list complete, not each reason) | T6, T15, T17 | SOC 2 C1.1, P6.1; ISO A.5.34, A.8.12 |
| INV-04 | Aggregates publish only as proofs, with a minimum group size | not yet | none (no aggregate is published yet; `docs/AUDIT_DESIGN.md` step 6) | T6 | SOC 2 C1.1, P6.1; ISO A.5.34, A.8.11 |
| INV-05 | The one server exception: two traction totals per country, no dates, addresses or ids; every country shown while on testnet (Joshua, 2026-10-30), a country shown only from 5 visitors before mainnet; cached a day | code, CI | `apps/business/src/app/api/traction/counts.test.ts` · "names every country with a visitor while on testnet…", "with a floor (5 before mainnet)…", "is cached for a day at the edge, and carries no dates" | T11 | SOC 2 P1.1, P3.1, P4.1; ISO A.5.34, A.8.10 |

## Keys and storage

| Id | Rule | Enforced in | Check | Threats | Frameworks |
|---|---|---|---|---|---|
| INV-06 | Never commit private keys, view keys, `.env` files or seed phrases; never print them in logs (a business's own view key may sit inside its encrypted books, T20) | CI, review | `scripts/check_secrets.py` (both repositories: Aleo keys, tokens, PEM keys, literal secrets, tracked `.env` files; seed phrases stay with review); `pnw_mvp_v2/scripts/check_secrets.py`; `scripts/check_console.py` (no debug logging in shipped code, so nothing a transaction or a record carries is printed) | T18, T20 | SOC 2 CC6.1, CC8.1; ISO A.5.17, A.8.4 |
| INV-07 | The vault key comes from the unlock secret (username and passphrase, PBKDF2-SHA256 600k rounds) and only wraps a random AES-256-GCM data key; the key is never stored in plaintext and never leaves the vault module, except as INV-08 says | vault, CI | `packages/vault/src/vault.test.ts` · "defaults to 600k PBKDF2 rounds", "never exposes an exportable data key", "changes passphrase without re-encrypting the books" | T2, T8 | SOC 2 CC6.1, CC6.7; ISO A.8.24 |
| INV-08 | "Stay logged in" is the person's choice, never a default. It keeps only the data key, non-extractable, in the browser's storage for at most 24 hours by this device's clock, forgotten on Log out. While it is kept, anyone with the device or a copy of its browser profile can open the books, and the tick box says so | vault, UI, CI | `packages/vault/src/vault.test.ts` · "reopens the books without the passphrase until the session expires", "keeps a non-extractable key, and refuses to resume a tampered one", "a clock set back to before the session was last used doesn't reopen the books"; `apps/business/src/books/stay_choice.test.ts` · "is asked on every screen that opens books, and starts unticked on each", "is never switched on by a default in the provider" (known gaps: Log out and closing the tab at once, issue #150; the key's bytes in the browser's files, T2) | T8 | SOC 2 CC6.1; ISO A.8.5, A.8.24 |
| INV-09 | No server account: nothing is verified remotely; a lost passphrase is replaced only with the account's recovery key | structure, vault, CI | `packages/vault/src/recovery.test.ts` | T8 | SOC 2 CC6.1, CC6.2; ISO A.5.16, A.8.5 |
| INV-10 | localStorage is not a book of record; durable data goes in the encrypted IndexedDB vault | code, CI | `scripts/check_browser_storage.py` (web storage holds five flags, each owned by one file, the fifth a step name from a fixed list (`apps/business/src/books/drawing_step.ts`); IndexedDB only in `packages/vault`; no cookies or Cache API); manual check PRIV-3 on issue #163 | T2 | SOC 2 CC6.1, A1.2; ISO A.8.13, A.8.24 |

## Boundaries

| Id | Rule | Enforced in | Check | Threats | Frameworks |
|---|---|---|---|---|---|
| INV-11 | Every on-chain write is signed in the user's wallet through the `wallet` package's executor; nothing calls `snarkos` or the SDK execute path directly | code, CI | `scripts/check_signing_path.py` (one door: only `apps/business/src/chain/shield.ts` touches the wallet adapter; no send outside the chain code, no SDK execute path, no `child_process`, no CLI adapter, no Veil local-key or devnode package outside tests, no Veil writing or contract action and no generated contract factory in the app) | T3 | SOC 2 CC6.1, PI1.3; ISO A.8.5, A.8.26 |
| INV-12 | Program and transition names come from `@pnw/config`, never hard-coded elsewhere | code, CI | `scripts/check_program_names.py` (no `<name>.aleo` written out outside `packages/config`; `credits.aleo`, the network's own, allowed; generated bindings name theirs, pinned to `@pnw/config` by `generated.test.ts`) | T15 | SOC 2 CC8.1, PI1.3; ISO A.8.25, A.8.32 |
| INV-13 | Every account is on the registry: setup links Shield and registers a name, and an unfinished account stays on `/settings/setup` | code, CI | `apps/business/src/books/setup.test.ts` · "keeps an unfinished account on the setup page, wherever it tries to go" | T16 | SOC 2 CC6.1, CC6.2; ISO A.5.16 |
| INV-14 | Team members, customers and vendors are added only by their registered name, shown only when its hash checks out | code, CI | `apps/business/src/chain/directory.test.ts`; `apps/business/src/books/directory.test.ts` | T16 | SOC 2 CC6.1, PI1.2; ISO A.5.16, A.8.26 |
| INV-15 | One kind of account per Shield account: business and personal money never share a wallet | code, CI | `apps/business/src/chain/account_kind.test.ts` · "refuses when the registry can't be read, rather than letting it through" | T16 | SOC 2 CC6.3, PI1.2; ISO A.5.15, A.5.16 |
| INV-16 | The ledger core, vault, reports and payroll never import `wallet`, `pnw-adapter`, `rail` or `records`; chain code lives in `src/chain` and loads only where needed | CI | `apps/business/src/fiat_boundary.test.ts`; `packages/ledger/src/boundary.test.ts`; `packages/vault/src/boundary.test.ts`; `packages/sales/src/boundary.test.ts`; `apps/site/src/site_boundary.test.ts` | T3 | SOC 2 CC6.8, CC8.1; ISO A.8.25, A.8.27 |
| INV-17 | One security policy for the whole app: scripts by nonce or digest, no inline or eval'd code, connections only to the app, the explorer and the Shield relay | code, CI | `apps/business/src/security/headers.test.ts`; `apps/business/src/security/static_csp.test.ts` | T3 | SOC 2 CC6.6, CC6.8; ISO A.8.26, A.8.28 |
| INV-18 | Extension modules never touch posting logic or the vault key | not yet | none (no extension API yet; Phase 8) | T7 | SOC 2 CC6.8, CC8.1; ISO A.8.19, A.8.27 |
| INV-19 | Mode upgrades are one-way, show exactly what goes on chain, and take a second wallet signature after a review screen; never a side effect | not yet | none (anchored and settled modes aren't built yet) | T6 | SOC 2 CC8.1, PI1.3; ISO A.8.32 |

## Leo programs

| Id | Rule | Enforced in | Check | Threats | Frameworks |
|---|---|---|---|---|---|
| INV-20 | Deployed programs are immutable: a change ships as a new version with a migration note; `config/testnet.manifest.json` is the source of truth for what is live | structure, review | `pnw_mvp_v2/scripts/validate_testnet_manifest.py` and `pnw_mvp_v2/scripts/check_chain.py` (every program's edition and text on chain equal the manifest's, on each pull request and daily); `apps/business/src/chain/editions.test.ts` · "refuses when any pinned program is at another edition, naming it, and asks again next time" and "refuses the second of two sends when a program is upgraded between them"; `packages/config/src/programs.test.ts` (nothing compares a deployed program with its source byte for byte) | T4, T15, T21 | SOC 2 CC7.1, CC8.1; ISO A.8.9, A.8.32 |
| INV-21 | Superseded versions move unchanged to `src/layer1/archive/` or `src/layer2/archive/`, with a row in that folder's README | CI, review | `pnw_mvp_v2/scripts/check_archive.py` (every archived file's hash in that archive's `SHA256SUMS`; every folder has a README row) | T4 | SOC 2 CC8.1; ISO A.5.37, A.8.9 |
| INV-22 | Any new or changed Leo program is flagged before work starts and ships with negative tests run in CI | CI, review | `pnw_mvp_v2/.github/workflows/deploy.yml` (asserts each tested program's pass count); `pnw_mvp_v2/scripts/check_public_state.py` (its Tests column must match the gate) | T6, T15 | SOC 2 CC8.1, PI1.3; ISO A.8.25, A.8.29 |
| INV-23 | No cumulative counters in public mappings: they leak wages by difference (`pnw_mvp_v2` `CLAUDE.md`) | CI, review | `pnw_mvp_v2/scripts/check_layer1_public_leakage_guards.py` (a tripwire on five spellings of a running total, not a proof); `pnw_mvp_v2/docs/PUBLIC_STATE.md` (two counters today, neither about money) | T6 | SOC 2 C1.1, P6.1; ISO A.5.34, A.8.12 |
| INV-24 | Layer 2 never moves funds; no pooled custody: an employer's USDCx is consumed and the worker's emitted in one transition, or paid with a plain `transfer_private` (`pnw_mvp_v2` `CLAUDE.md`) | CI, review | `pnw_mvp_v2/scripts/check_layer2_moves_no_funds.py` (Layer 2 imports only money-free programs, calls only `assert_` checks, names no token or transfer) | T6 | SOC 2 PI1.3, PI1.4; ISO A.8.27 |

## Operating rules

How the company works, as opposed to what the code does: who may change what, what every change
leaves behind, who holds which access. These are what a SOC 2 or ISO 27001 auditor samples over a
period (`COMPLIANCE_MAP.md`, gaps 1 to 5, 10). **Set in** is where the rule is written; **Evidence**
is what it leaves behind for someone to sample; **Check** is a script or test, where one exists,
and otherwise names the step of the refreshed plan that adds one.

| Id | Rule | Set in | Evidence | Check | Frameworks |
|---|---|---|---|---|---|
| OPS-01 | A pull request merges only after Joshua approves it in the chat session, on his own device (2026-11-03), and on GitHub from his own account (2026-11-12); the merge commit's message says "Approved by Joshua in session, <date>" | `CLAUDE.md`, working agreement | The commits on `main` from 2026-11-03 on | none in the repository; on GitHub, the ruleset on `main` in both repositories requires one approval, dismissed by a later push; agent sessions act as `hewn-builder` (Write), which can't approve its own pull requests (2026-11-12). A script over `main`'s history is still to come | SOC 2 CC8.1; ISO A.5.3, A.8.32 |
| OPS-02 | Joshua is the only person with access to GitHub and Vercel, both behind two-factor authentication (2026-11-03) | `docs/COMPLIANCE_MAP.md`, decisions | The settings pages of both accounts, seen by Joshua; the collaborator list on GitHub | none (Step 10: the account inventory and the first quarterly access review) | SOC 2 CC6.1, CC6.2, CC6.3; ISO A.5.15, A.5.18, A.8.5 |
| OPS-03 | The admin key that deploys and upgrades the Leo programs lives only in the GitHub secret `ADMIN_PRIVATE_KEY` (environment `testnet-staging`), read by the manual deploy and upgrade workflows, which print a redacted form | `pnw_mvp_v2` `CLAUDE.md`, keys and secrets | The repository's environments and the two workflow files (`pnw_mvp_v2/.github/workflows/`) | none (Step 10: custody and rotation written down; the secrets scan, INV-06, proves it is in no tree) | SOC 2 CC6.1, CC6.7; ISO A.5.17, A.8.24 |
| OPS-04 | Dependencies are installed from the lockfile exactly, must be at least 7 days old (`minimumReleaseAge`), fail the build on a moderate or worse advisory, and are bumped weekly by Dependabot in one batched pull request; the alpha wallet adapters are pinned on purpose | `pnpm-workspace.yaml`, `.github/dependabot.yml`, `CLAUDE.md`, known facts | Every pull request's CI run; Dependabot's pull requests | `.github/workflows/ci.yml` (frozen-lockfile install, `pnpm audit --audit-level=moderate`) | SOC 2 CC7.1, CC8.1, CC9.2; ISO A.5.21, A.8.8, A.8.19 |
| OPS-05 | CI runs with read-only permission and no secrets; the one automatic workflow with a write permission publishes the map to GitHub Pages and writes nothing else (`.github/workflows/map.yml`); the workflows that spend or deploy (`pnw_mvp_v2`'s deploy, upgrade and execute gates) run only by hand, in an environment Joshua controls | `.github/workflows/ci.yml` (`permissions: contents: read`), `.github/workflows/map.yml`, `pnw_mvp_v2` `CLAUDE.md`, workflows | The workflow files; the runs' logs on GitHub | none (Step 11: a check that no workflow widens its permissions) | SOC 2 CC6.3, CC8.1; ISO A.5.15, A.8.2 |
| OPS-06 | A problem seen in use is written up in `docs/incidents/` with what was seen, what changed, and what isn't known, rather than fixed on a guess | `docs/README.md`, the incidents row; the first write-up (`docs/incidents/2026-10-27-stuck-on-opening.md`) | The write-ups | none (Step 12: the runbook with roles, timelines and how users are told) | SOC 2 CC7.4, CC7.5; ISO A.5.24, A.5.27 |
| OPS-07 | Security problems are reported privately through the repository's Security tab, never in a public issue; the reporter gets a reply | `SECURITY.md` | The repository's private reporting setting; the reports and replies | none (the setting lives in GitHub; Step 12 adds it to the runbook) | SOC 2 CC2.3, CC7.3; ISO A.6.8, A.8.8 |
| OPS-08 | Every change is one pull request for one task that ends with the tests run, a dated entry in that day's `progress/` file with test counts, signed with the session that wrote it, and any exit criterion met ticked in `BUILD_PLAN.md`; CI gates every pull request | `CLAUDE.md`, working agreement; `CONTRIBUTING.md` | The pull requests; `progress/` | `scripts/progress_index.py` (the index matches the day files, every entry signed); `scripts/docs_index.py` (every document's status current in the index); `.github/workflows/ci.yml` | SOC 2 CC8.1; ISO A.5.37, A.8.32 |
| OPS-09 | Retired code is deleted, not archived: git history is the archive; `archive/README.md` keeps one row per retired thing with the commit that holds it, and nothing else; deployed Leo program versions are the exception and stay unchanged (INV-21) (2026-11-04) | `CLAUDE.md`, working agreement | `archive/README.md`; the commits it names | `scripts/check_archive.py` (only the README under `archive/`; every row names a commit, and with full history that commit exists) | SOC 2 CC8.1; ISO A.8.32 |
