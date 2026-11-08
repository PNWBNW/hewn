# packages/wallet

The Shield provider and executor: the only way a transaction is signed. Every on-chain write goes
through here, so the wallet shows what is being signed (`docs/INVARIANTS.md`, INV-11). In the app,
pages reach it through one door, `useShield()` in `apps/business/src/chain/shield.ts`, and CI fails
on any other path (`scripts/check_signing_path.py`).

| File | What |
|---|---|
| `wallet-provider.tsx` | The provider the app mounts: Shield's adapter, connected one of three ways (below) |
| `wallet-executor.ts` | Submitting a transaction through the adapter and following it to confirmation |
| `fee_mode.ts` | The per-device fee switch (public or private fee) and `withFeeMode`, applied to every call |
| `credential-signer.ts` | Proving who holds an account by a signed challenge (`signMessage`), never a pasted key |

## Shield only, pinned exactly

**Shield is the only wallet**; don't add other adapters. The adapters were renamed from
`-adaptor-` to `-adapter-` on 2026-10-19 and are pinned exactly (no ranges):
`@provablehq/aleo-wallet-adapter-core` 1.3.0, `-react` 1.5.0, `-shield` 1.5.0,
`@provablehq/aleo-wallet-standard` 1.6.0, `@provablehq/aleo-types` 1.3.0 (moved on 2026-11-08 from
1.1.2, 1.3.1, 1.3.0, 1.4.0 and 1.1.0; `docs/ALEO_CONSTRAINTS.md` §2b says what changed).
`@provablehq/sdk` 0.13.0 (0.10.1 until 2026-11-07)
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
the relay the app answers reads only while it is open, and the adapter opens it (the `shield://`
link) for approvals only: a read sent while the app is in the background waits on the channel, and
nothing happens on screen. `chain/shield.ts` exposes `route` and `away` for the wording and the
"Open Shield" link (`ShieldAway`), and `chain/shield_route.ts` has `openShield`, which opens the
app from the tap that asked for a read, as the restore screen does. Tried on a real phone on
2026-11-08 (Brave on Android): the pairing, a letter through to accepted, and the restore's reads,
which waited until the app was opened by hand; hence `openShield`. One more thing seen there: a
remembered pairing is resumed by its relay channel, and when Shield's side has dropped that
channel (a cancelled pairing, say) the resume waits up to five minutes for an app that never
comes, with no tap to open it. `useShield`'s `restart` tears the pairing down and asks Shield
afresh from a tap; the restore screen offers it after ten seconds of "Connecting…". And the wake
link must name the site's relay channel, `shield://wake?channelId=…`, as the adapter's own does:
a bare `shield://wake` opens the app, which then finds no connection for it and says "Connection
expired". The adapter keeps the channel privately, so `shieldWakeUrl` (here) reads it, and a test
fails if a new adapter version moves the names it reads; `useShield().wakeUrl()` hands it to every
"Open Shield" link and to `openShield`.

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
