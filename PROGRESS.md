# PNW Ledger — Progress Log

Dated entries, newest last. Detail lives here; chat reports stay short.

## 2026-10-13 — First session (bootstrap)

**Setup**
- `CLAUDE.md` and `BUILD_PLAN.md` committed to `main` (f33e92c).
- Branch `monorepo` created in `PNWBNW/pnw`.
- Source repos cloned over HTTPS into a scratch dir:
  - `pnw_employment_portal_v1` @ 909660e
  - `pnw_mvp_v2` @ 025ca88

**Portal baseline** (pnpm 10.28.0, `pnpm install --frozen-lockfile`, Node 22, `npx vitest run`, no changes)

| | Passed | Failed | Total |
|---|---|---|---|
| Test files | 14 | 2 | 16 |
| Tests | 160 | 5 | 165 |

Failures (all look like stale tests, not broken code — to confirm before salvage):
- `src/anchor/batch_anchor_finalizer.test.ts` — 4 tests. Test imports `buildCycleNftParams`, which
  `batch_anchor_finalizer.ts` no longer exports (removed in 1795ff2 "payroll UX fixes after first
  successful run"). Fails with `buildCycleNftParams is not a function`.
- `src/coordinator/settlement_coordinator.test.ts` — "passes correct WorkerPayArgs to adapter".
  Expects program `payroll_core.aleo`; adapter now maps to `payroll_core_v2.aleo`
  (`src/lib/pnw-adapter/layer1_adapter.ts:48`).

Phase 0 exit criterion 1 ("existing vitest suite passes inside the monorepo") needs these 5
resolved — fix the tests to match current code, or confirm the code regressed.

**`src/persistence/` vs the Phase 1 vault**

What exists (≈450 lines + 3 test files):
- `key_provider.ts` — `KeyProvider` interface (encrypt/decrypt) and `SessionKeyProvider`:
  AES-256-GCM, random 96-bit IV, non-extractable key, PBKDF2-SHA256 100k with fixed salt
  `PNW::DraftEncryption::v1`. Tested.
- `draft_encryptor.ts` — JSON ↔ encrypted envelope; plaintext metadata (employer addr, epoch, row
  count, timestamp) outside the blob for listing. Tested.
- `draft_integrity.ts` — BLAKE3 Merkle root over rows, bound to employer + epoch; tamper check on
  decrypt. Tested.
- `draft_store.ts` — IndexedDB `pnw_drafts` / store `drafts`, indexes by employer and epoch;
  save / load / list / delete / deleteAll. **No tests.**
- Only consumer: `app/(employer)/payroll/new/page.tsx` (payroll draft save/resume).

Coverage of Phase 1 deliverable 3, roughly **35–40%**:

| Vault requirement | Status |
|---|---|
| AES-256-GCM | ✅ done |
| IndexedDB storage | ✅ done, but payroll-draft-specific schema |
| Tamper detection | ✅ done (GCM tag + Merkle root) |
| Pluggable key source | ✅ `KeyProvider` interface is the right seam |
| Key from Shield wallet signature over a domain-separated message | ❌ derives from the **view key** in the session store. Needs a new `WalletSignatureKeyProvider`; see question below |
| Same wallet opens vault on any device | ⚠️ works today only because the view key is deterministic; must hold for the signature path too (signature must be deterministic, or wrap a random vault key) |
| General ledger vault (accounts, entries, customers, …) | ❌ schema is `PayrollTableRow[]` only |
| Export/import as one encrypted blob | ❌ |
| Optional IPFS pin via Pinata | ❌ not wired to persistence |
| Headless mode (local keypair + passphrase) | ❌ |
| Key never leaves vault module | ⚠️ view key lives in a Zustand session store outside the module |

Plan: extend, don't replace — keep `KeyProvider`, the envelope pattern and integrity hashing;
generalise the store schema; add a wallet-signature key provider, a passphrase provider for
headless mode, and export/import.

Also noted: 19 files still use `localStorage` (sent offers, per-agreement pay state, a
prefixed store). These need to move into the vault during Phase 1.

**Open questions for Joshua**
1. Vault key from a wallet signature: Aleo signatures are Schnorr-style with a random nonce, so the
   same message may sign differently each time — a key derived from it would not reopen the vault on
   a second device. Needs a test against Shield before Phase 1. If non-deterministic, fallback options
   are the view key (today's approach) or an unlock that uses the wallet's record-decrypt. Either way,
   recommend a random vault key wrapped by the wallet-derived key from day one (Phase 6 per-member
   wrapping needs it anyway).
2. The 5 stale tests: OK to update them to current code as part of Phase 0 salvage?

**Status:** stopped per First-session step 6. No scaffolding started.
