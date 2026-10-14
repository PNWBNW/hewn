# Plumb — Threat Model

Living document. Every phase's PR checks its changes against this list; new features add rows.
Status: ✅ in place · 🔜 planned (phase) · ⚠️ accepted risk.

## What we protect

| Asset | Where it lives | Worst case if lost |
|---|---|---|
| The books (entries, customers, vendors, invoices) | Encrypted vault on the user's device (Phase 1) | Business finances exposed or altered |
| Worker PII and pay (wages, W-4, bank details) | Same vault; never public in any mode | Harm to an individual; legal exposure |
| Vault key / passphrase | Derived in memory, never stored | Everything above |
| Integrity of history | Hash chain, period roots; on Aleo in anchored mode | Undetected fraud |
| The app's own code | Built in CI, served from our host | Every user above, at once |

## Trust boundaries

- **The device and browser are trusted.** If the OS or browser is compromised, the attacker sees
  what the user sees (T8).
- **The server is not trusted with data.** It serves code and nothing else: no database, no API
  that sees plaintext. A breached host can serve bad code (T3) but cannot leak stored books,
  because there are none.
- **Dependencies are untrusted until reviewed.** Every package runs with the app's privileges.
- **The chain is public.** Only hashes, commitments and block heights go there.

## Threats

### T1 — Central breach of everyone's books
No server, no database. ✅ Structural, from the architecture.

### T2 — Stolen device, browser profile or backup file
- AES-256-GCM via WebCrypto; the open data key is non-extractable. ✅ `@pnw/vault`
- Envelope encryption: random data key, wrapped by a PBKDF2-SHA256 (600k rounds, random salt) key
  from the passphrase; associated data binds each ciphertext to its vault and role. ✅
- Backups are the sealed record itself; nothing is decrypted to write one. Restore proves the
  passphrase and re-verifies the hash chain before replacing anything. ✅
- Auto-lock after 15 idle minutes; reload or Lock drops the key and plaintext from memory. ✅

### T3 — Malicious code in the page (XSS, compromised dependency, compromised host)
The highest risk for a browser app.
- Strict CSP, a fresh nonce per request, `'strict-dynamic'`, no `unsafe-inline`/`unsafe-eval`
  in production. ✅ `apps/business/src/security/headers.ts`, `src/proxy.ts`
- `connect-src 'self'` plus the explorer REST origin (read-only lookups the user starts from
  Settings after linking Shield; the default mode never calls it): injected code has nowhere
  to send data but a public read-only API. Verified in a browser: third-party fetch, framing and inline handlers are all
  refused. ✅
- `frame-ancestors 'none'`, `X-Frame-Options: DENY` (no clickjacking); `nosniff`;
  `Referrer-Policy: no-referrer`; device APIs disabled by `Permissions-Policy`. ✅
- React escapes all rendered text; `dangerouslySetInnerHTML` is not used. ✅ (add a lint rule 🔜)
- Dependencies pinned exactly, lockfile enforced in CI (`--frozen-lockfile`). ✅
- `pnpm audit --audit-level=moderate` blocks merges. ✅ Baseline 2026-10-13: 47 → 0 advisories.
- `minimumReleaseAge` 7 days: freshly published (possibly hijacked) versions are never pulled. ✅
- Install scripts allowed only for an explicit list (`onlyBuiltDependencies`). ✅
- Unused wallet adaptors removed (Shield only): fewer packages, smaller attack surface. ✅
- Dependabot for npm and Actions. ✅
- Signed, installable builds with published hashes so users can verify the code they run;
  release hash anchored on Aleo once anchoring exists. 🔜 (before first external user)
- Pin GitHub Actions to commit SHAs. 🔜

### T4 — Silent edits to history (insider, owner, or malware)
- Append-only journal; "edit" and "void" are reversals plus new entries. 🔜 P1
- Each entry hash-chains to the previous; any change breaks the chain and shows. 🔜 P1
- Closed periods produce a root the accountant can keep; locked periods can't reopen. 🔜 P1
- Anchored mode puts period roots on Aleo, making tampering provable. 🔜 P1/P2

### T5 — Ledger logic bugs (wrong numbers)
- Money as integer cents (`bigint`), never floating point. 🔜 P1
- Invariants (debits = credits, open period, active account) enforced in one module, with
  property-based tests over random entries. 🔜 P1
- Strict TypeScript, CI blocks on any failing test or type error. ✅
- Third-party audit of the vault and ledger core alongside the Leo audit. 🔜 budget line

### T6 — Privacy leak through the chain (anchored/settled modes)
- Public mappings hold only hashes, commitments, block heights. ✅ (existing programs) 🔜 `gl_core`
- Aggregates only as proofs with a minimum group size. 🔜 P3 (group size decision open)
- Fiat-mode app cannot import chain packages at all. ✅ `fiat_boundary.test.ts`

### T7 — Unauthorized access by another member (multi-user)
- Roles enforced by key wrapping and in-circuit allow-lists, not by hiding buttons. 🔜 P6

### T8 — Compromised device or lost passphrase
- ⚠️ Malware on the user's own machine sees what the user sees. Mitigation is limited to
  auto-lock and short key lifetime.
- ⚠️ A forgotten passphrase means unrecoverable books. 🔜 P1: optional recovery key, nudges to
  keep an encrypted backup.

## Not yet covered

Phishing look-alike sites, browser extensions with page access, and denial of service are out
of scope until the first external release; revisit then.
