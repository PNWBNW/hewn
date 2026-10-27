# packages/wallet

The Shield provider and executor: the only way a transaction is signed. Every on-chain write goes
through here, so the wallet shows what is being signed (`docs/INVARIANTS.md`, INV-11). In the app,
pages reach it through one door, `useShield()` in `apps/business/src/chain/shield.ts`, and CI fails
on any other path (`scripts/check_signing_path.py`).

| File | What |
|---|---|
| `wallet-provider.tsx` | The provider the app mounts: Shield's adapter, connected one of three ways (below) |
| `wallet-executor.ts`, `useTransactionExecutor.ts` | Submitting a transaction through the adapter and following it to confirmation |
| `fee_mode.ts` | The per-device fee switch (public or private fee) and `withFeeMode`, applied to every call |
| `credential-signer.ts` | Proving who holds an account by a signed challenge (`signMessage`), never a pasted key |

## Shield only, pinned exactly

**Shield is the only wallet**; don't add other adapters. The adapters were renamed from
`-adaptor-` to `-adapter-` on 2026-10-19 and are pinned exactly (no ranges):
`@provablehq/aleo-wallet-adapter-core` 1.1.2, `-react` 1.3.1, `-shield` 1.3.0,
`@provablehq/aleo-wallet-standard` 1.4.0, `@provablehq/aleo-types` 1.1.0. `@provablehq/sdk` 0.10.1
is used elsewhere for what Shield doesn't do (the stablecoin's exclusion proof, in `rail`), never
to execute.

## Three ways in, one adapter (Joshua, 2026-10-19)

- **The extension on a computer** and **Shield's own browser on a phone** both inject Shield into
  the page.
- **A plain phone browser** pairs with the Shield app over Shield's relay: `connect()` opens the app
  with a `shield://` link, every approval opens it again, and answers come back sealed end to end
  through `wss://relay.shield.app`, the one host besides the explorer in the app's security policy
  (pinned there, `apps/business/src/security/headers.ts`, and here).

A computer without the extension has no way in yet: Shield's app can't scan a pairing code. Over
the relay the app answers reads only while it is open; `chain/shield.ts` exposes `route` and `away`
for the wording and an "Open Shield" link. Not yet tried on a real phone.

## Fees

`privateFee: false` was needed on every `executeTransaction`: with a private fee, proof generation
failed silently, most likely because the test accounts held no private ALEO to pay with. Private
fees by default is the goal (Joshua, 2026-10-16); it is being tried behind the dashboard's
per-device switch (`fee_mode.ts`), which `chain/shield.ts` applies to every call.

Shield may pay the fee itself ("Network fee: Covered by Shield" in its prompt, seen 2026-10-26):
the transaction then carries a public `fee_public` paid by Shield's own account, and `privateFee`
is ignored. The user's address isn't the fee payer then, so it isn't exposed; the app must never
take that payer for the sender (`apps/business/src/chain/review_feed.ts`).

`privateFee` isn't always ignored, though: with the switch on, a `hewn_letters_v2` backup in Shield's
Android app failed before signing ("RemoteProvingService: Failed to send proving request …
ERR_NAME_NOT_RESOLVED", 2026-10-27), and went through, covered by Shield, with the switch off. On
testnet the backup card says to turn the switch off (`apps/business/src/chain/ChainBackup.tsx`).

Shield's in-browser prover drops proofs that span several programs, so nothing Hewn sends is one:
payroll is one `transfer_private` per payee (`packages/rail`), and the paystub goes as a letter,
rather than `payroll_core_v2`'s one-proof `execute_payroll`, which stays deployed and unused.
