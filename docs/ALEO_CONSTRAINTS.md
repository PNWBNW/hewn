# Aleo constraints check (2026-10-14)

Joshua hit boundaries building batched payroll in early 2026. Before designing the settlement path
for the new app, this checks each assumption against the network as it is now. "Confirmed" means
read from source or release notes this session; "to verify" means it needs a testnet run, which
the first settled-mode task will do. Most Aleo doc sites are unreachable from the build container,
so sources are GitHub, snarkVM source and release notes.

## 1. Hard limits (confirmed from snarkVM source, `mainnet` branch)

| Limit | Value | Where |
| --- | --- | --- |
| Transitions per transaction | 31 + the fee transition (`TRANSACTION_DEPTH = 5`) | `console/program/src/state_path/configuration` |
| Inputs / outputs per transition | 16 / 16 | `Network::MAX_INPUTS`, `MAX_OUTPUTS` |
| Finalize operations per transaction | 512 across all transitions; `MAX_WRITES` 32 per finalize (since V14) | `FINALIZE_ID_DEPTH = 9` |
| Mapping entries per program | 128 (V22, activating testnet 13 Oct, mainnet ~20 Oct 2026; was 31) | `MAX_MAPPINGS` |
| Array elements | 2048 (V14+) | `MAX_ARRAY_ELEMENTS` |
| Struct / record fields | 32 data entries (records 33 incl. owner) | `MAX_DATA_ENTRIES` |
| Program size / transaction size | 2,048,000 chars / 2,304,000 bytes (V16+) | `MAX_PROGRAM_SIZE`, `MAX_TRANSACTION_SIZE` |
| Functions per program | 31; imports 64 | `MAX_FUNCTIONS`, `MAX_IMPORTS` |
| Finalize cost cap per function | `TRANSACTION_SPEND_LIMIT` 4 credits (V10+; was 100), checked at deployment | PR #2368 |
| Execution fee | linear in bytes below 5,000 bytes, quadratic penalty above | fee docs |
| Block time | 10 s in code; observed ~3 s on mainnet | `BLOCK_TIME`; community reports |

Sources: [Network trait source](https://raw.githubusercontent.com/ProvableHQ/snarkVM/mainnet/console/network/src/lib.rs),
[state path depths](https://raw.githubusercontent.com/ProvableHQ/snarkVM/mainnet/console/program/src/state_path/configuration/mod.rs),
[spend limit PR](https://github.com/ProvableHQ/snarkVM/pull/2368),
[fee docs](https://github.com/AleoNet/welcome/blob/master/documentation/concepts/fundamentals/03A_transaction_fees.md).

What this means for us: a per-worker payroll transition is nowhere near these limits. A batch of
*k* workers in one transition is bounded by 16 outputs (receipts emit 2 records per worker → 8
workers per receipts transition) and by the 4-credit finalize cap per function (each worker adds
mapping writes). The limits were not what broke batching in April; the prover was (§3).

## 2. Toolchain drift (confirmed)

| | Pinned in our repos | Current |
| --- | --- | --- |
| Leo | 4.0.0 | 4.4.5 (1 Oct 2026); bytecode upgrades in CLI since 4.4.3 |
| snarkOS / snarkVM | 4.6.0 | 4.12.0 (13 Oct 2026) |
| Consensus | V14 (Leo 4 required) | V21 live on testnet 6 Oct (Varuna V3 proofs), V22 on 13 Oct; mainnet V21 1 Oct, V22 ~20 Oct |
| `@provablehq/sdk` | 0.10.1 | 0.12.1; **V2 proofs no longer verify after V21**, so any local proving through 0.10.1 is dead on both networks |
| Wallet adaptor | 0.3.0-alpha.3 | unchanged; API: `executeTransaction({program, function, inputs, fee?, recordIndices?, privateFee?})`, `transactionStatus`, `requestRecords`, `signMessage`, `decrypt`. No bulk method. |

Sources: [Leo releases](https://github.com/ProvableHQ/leo/releases), [snarkOS releases](https://github.com/ProvableHQ/snarkOS/releases),
[snarkVM releases](https://github.com/ProvableHQ/snarkVM/releases), [SDK releases](https://github.com/ProvableHQ/sdk/releases),
adaptor types read from `node_modules/@provablehq/aleo-types`.

Action: the Leo session bumps all pins before touching a program. The wallet path is unaffected
(Shield proves), but `@provablehq/sdk` 0.10.1 is still used for `SealanceMerkleTree` and must move
to 0.12.x regardless.

## 3. Proving: the thing that actually broke batching

- **Shield's built-in prover is delegated proving.** Aleo's docs describe Shield as using
  encrypted proving requests decrypted inside a TEE (Provable's Delegated Proving Service).
- **The DPS only takes single-call functions.** SDK 0.11.0 notes (27 May 2026): "Currently requests
  are limited to functions with a single call. A call stack deeper than 1 is not yet supported."
  ([SDK releases, page 2](https://github.com/ProvableHQ/sdk/releases?page=2))
- `payroll_core_v2::execute_payroll` makes four cross-program calls. `execute_payroll_batch_2`
  makes eight. Neither can be delegated. Whatever Shield does with them (local WASM proving, or
  drop) is the "returns an ID, never reaches the network" behaviour from April.
- Every step of the 4-step split **is** a single-call function: `assert_agreement_active`,
  `transfer_private` (its finalize reads another program's mappings, which is not a call),
  `mint_paystub_receipts`, `anchor_event`. So the split works on Shield because it is
  delegatable, not because it is smaller.

**To verify on the first settled run:** whether the DPS limit still holds (SDK 0.11.10 added
"multi-program prepared processes", which may mean it has lifted) and whether Shield falls back
to local proving for multi-call functions. Until then, **design every user-signed transition as a
single-call function.** This reverses the audit's "one-shot is strictly better" line.

Consequences (as decided, §5):
- Per payment the only transaction is the stablecoin's own `transfer_private`. A wrapper that
  also records a paystub hash or a `paid_epoch` guard would be a two-call function, which is
  exactly what cannot be delegated, so the commitment lives in the books and the period anchor
  instead, and the double-pay guard lives in the vault.
- `assert_agreement_active` as a separate transaction guarantees nothing (nothing links it to
  the transfer). Check `agreement_status` over REST for free; no step.
- `paystub_receipts`, `payroll_core_v2` and the per-run `anchor_event` + `mint_cycle_nft` are
  retired from the payment path (the NFT stays available as an optional per-run anchor).
- If the DPS limit lifts, a single-call wrapper becomes possible and the on-chain guard can
  return without changing the user-facing design.

## 4. What else changed since April

- **Program upgrades are real.** Constructors with `@noupgrade`, `@admin(address)`, `@checksum`,
  `@custom`; edition increments by one; `employer_agreement_v4` was upgraded in place on
  2026-04-12. Our rule "deployed programs are immutable" is wrong for `@admin` programs and should
  read: `@noupgrade` programs are immutable (`employer_license_registry`, `payroll_audit_log`,
  `payroll_nfts_v2`, `audit_nft`); `@admin` programs upgrade with an edition bump, a migration note
  and an archived copy of the previous edition. What an upgrade may change (records, mappings,
  imports) is **to verify** against the Leo upgradability guide before the first upgrade.
  ([Leo upgradability guide](https://docs.leo-lang.org/guides/upgradability), [ARC-0006](https://github.com/ProvableHQ/ARCs/discussions/94))
- **Fee sponsorship is native.** A third party can supply a separate fee authorization that is
  combined with the sender's execution authorization, publicly or privately. Press coverage of
  Shield's launch says Provable covers network fees for private transactions in Shield
  ("users don't need ALEO to pay them"); not confirmed from a Provable source this session.
  If true, a worker with zero ALEO can still accept an offer and claim pay. **To verify.**
- **Proving-key caching** (SDK 0.11.0, IndexedDB) gives 30–50% faster local proving on repeat
  calls; testnet 4.12.0 reports ~8% faster CPU proving. Varuna V3 is a verifier change, not a
  speedup.
- **USDCx has `split` and `join`.** Both are plain transitions (no finalize, no Merkle proof,
  single program): `split(token, amount) → (Token, Token)`, `join(t1, t2) → Token`. The local stub in
  `pnw_mvp_v2/src/stubs` lacks them, which is why the portal never used them.
  ([compliant-stablecoin source](https://github.com/ProvableHQ/compliant-stablecoin/blob/master/stablecoin_program/src/main.leo))
- **Every private USDCx transfer emits a `ComplianceRecord` to the investigator address** with
  amount, sender and recipient. That is the compliance design of the stablecoin, not something we
  can opt out of, and it belongs in `THREAT_MODEL.md`: wage amounts on the rail are private from
  the public and from us, not from the stablecoin's compliance party.
- `transfer_private` carries **no memo**. An incoming record is owner + amount only, so the
  "what is this payment for" problem in the audit stands; the mailbox note is the answer.

## 5. The settlement design, re-checked

Goal: tap once, any number of payees, no babysitting.

**Chosen (Joshua, 2026-10-14): rail + books + mailbox.** One transition per payee, nothing else
on-chain per payment; the paystub through the mailbox; the commitment in the books, anchored per
period by `gl_core.aleo`. Detail in `INTEGRATION_AUDIT.md` §2.2.

**Per run, today's programs:**

1. Books first: `postPayRun` / `payBills` post the entries with the paystub hash in
   `source.ref`, status "settling".
2. **Pre-split**: the app keeps the employer's USDCx as many records. `split` is a single plain
   transition (one approval, proves in seconds, no proof of exclusion). Done when funds arrive, not
   at pay time.
3. **Fire everything in parallel.** Per payee: one `transfer_private` (single-call, delegatable).
   None depends on another's output, so all are broadcast at once; the app only waits on the
   chain, never on itself. Fee is public (`privateFee: false`), paid by the employer, which has no
   record dependency either.
4. Statuses flip in the vault as each confirms; the actual fee is read from the confirmed
   transaction and posted to Network fees; the paystub is dropped in the mailbox; failures retry
   alone; closing the tab loses nothing.

Approvals: Shield prompts once per `executeTransaction`. 10 workers = 10 taps, all up front, then
walk away. 10 vendors = 10 taps. The receipts and anchor transactions from the April design are
gone, so there is nothing to batch.

**Why there is no "one tap for ten transfers" with the programs as they are:** spending a record
needs the owner's signature, and Shield signs one transaction per prompt. The only ways round it:

- **Workers pull.** Employer signs one transaction that moves the run's total into a program-held
  escrow with per-worker claims; each worker's app claims (their tap, fee possibly sponsored). The
  employer taps once; workers tap once each. Custody sits in a program for hours or days, which
  bends the "no pooled custody" invariant.
- **A session key.** Employer signs one transfer of the run's total to a throwaway account the app
  generates and keeps in the vault; the app then proves and broadcasts the N payouts itself with no
  prompts. Proving happens in a web worker (free, slow on phones) or via the DPS (needs a Provable
  API key in Hewn's name; pricing unknown). The float sits in the user's own vault, not with us,
  but it is a second key with money on it, which our rules currently forbid.

Both are deliberate rule changes for the Leo session, to be measured against how 22 taps feels
on testnet first.

## 6. Open items, in the order they get answered

1. First settled run from the new app (task 6 in the audit): does Shield accept each single-call
   step via delegated proving; what is the wall-clock per transfer and per receipt; does a
   multi-call function still fail. Record numbers in `PROGRESS.md`.
2. Confirm Shield fee sponsorship from a Provable source, and whether it covers dApp-initiated
   transactions.
3. Read the upgradability guide before the Leo session; `gl_core.aleo` is the only new program
   the chosen design needs.
4. Bump toolchain pins (Leo 4.4.5, snarkOS 4.12.0, SDK 0.12.x) in the same session.
5. Add the compliance-record fact to `THREAT_MODEL.md`.
6. Fee read-back: confirm the REST transaction response exposes the fee transition's amount so
   the books post the actual fee.

## 7. Registry gates (read from the Leo source, 2026-10-14)

- `pnw_name_registrar_v5::register_employer_name(name_hash, name_u128, industry_u8)` asserts the
  signer is `is_verified` in `employer_license_registry`, takes 1 USDCx from the signer's **public**
  balance (`transfer_public_as_signer`), and allows one name per account (worker or business, never
  both). It is a four-program call, so Shield must prove it locally (not delegated); the old portal
  did this successfully in April.
- `employer_license_registry.set_verified(wallet, license_hash, flag)` is callable only by its
  `AUTHORITY` (the DAO treasury account) and the program is `@noupgrade`. No licence number is
  checked on chain; only a commitment is stored. Hewn stores a fixed placeholder.
- `employer_agreement_v4::create_job_offer` asserts the same approval **and** that the caller owns the
  employer name hash. So a business can neither register nor send an offer until the authority has
  approved its account. Removing that gate needs new program versions (registrar v6, agreement v5);
  a Leo task, not started. Until then the Settings → Register business name flow shows the account
  to send to the authority, and the authority's own account gets an Approve button.
