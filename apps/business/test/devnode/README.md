# test/devnode — Hewn against a real Aleo node

End-to-end tests that run Hewn's own chain code against a local Aleo node, step 1 of
`docs/VEIL.md`. The app's unit tests mock the chain and the Leo tests check the programs alone;
these check the seam between them: that the inputs Hewn builds are what the deployed program takes,
and the records it returns are what Hewn reads.

```bash
pnpm --filter @pnw/business test:devnode   # about 3 minutes; CI runs it after `pnpm test`
```

It is not part of `pnpm test` (the root runs only `vitest.config.ts` files); its config is
`vitest.devnode.config.ts`.

## How it works

- `@provablehq/veil-aleo-devnode` starts a local node (the `aleo-devnode` binary, installed from
  npm as `@provablehq/aleo-devnode`) with a funded test account. The node skips proof
  verification, so transactions carry placeholder proofs and a deploy takes seconds.
- One file per program, each with its own node. `harness.ts` holds what they share: start the
  node, deploy a program from `programs/` (sha256 checked), send a call and wait for it, open the
  outputs a view key can read the way Shield lists them, and make a fresh account with public
  credits and its own client (the worker who accepts an offer signs for themselves).
- What the tests call is Hewn's code, not a copy:
  - `letters.devnode.test.ts` (`hewn_letters_v2`): `letterCall`, `manyCalls`, `parseLetterRecord`
    (`src/chain/letters.ts`) and the mailbox's `seal` and `open` (`@pnw/mailbox`). 5 tests.
  - `agreements.devnode.test.ts` (`employer_agreement_v5`): `createOfferInputsV5`,
    `sentOfferPlaintext`, `finalAgreements` (`src/chain/offer.ts`), `parseAgreementRecords` and
    `acceptCall` (`src/chain/work/agreements.ts`), `newHalf` (`src/chain/key_ring.ts`). An offer
    and both copies; the acceptance, with each side's half in the other's copy; a withdrawal,
    after which the offer can't be accepted; and the refusals: someone else accepting, the same
    parties key twice, an offer to oneself, and the same terms at the same second to someone
    else (the agreement id hashes the employer, the terms and the offer time, not the worker). 6
    tests.
  - `payroll.devnode.test.ts` (the USDCx stand-in, below): Phase 2's three-worker payroll run,
    rehearsed. `postPayRun` and `markPaycheckSettlement` (`@pnw/payroll`) post the run and write
    each settlement back as the Pay panel does; `runPayQueue`, `explorerNetwork` and
    `centsToMinor` (`@pnw/rail`) plan the transfers, build the freeze-list proof and send `split`
    and `transfer_private` exactly as through Shield, over a `RailWallet` that signs with the
    node's account and lists its Token records. Checked against the VM: three balanced entries,
    each linked to the transaction that paid it (`source.ref`, `source.doc`, the settlement's
    reference); each worker's view key opens exactly their net pay in that transaction and no one
    else's; the business keeps the rest; the hash chain verifies. And the refusals: a run the
    business can't cover stops before anything is sent; going private with more USDCx than it
    holds is rejected by the node's finalize; a Token the business doesn't own can't be spent by
    it (the Leo test runner lets that through; the VM doesn't). 4 tests.

## The signing key

The devnode client signs with the node's seeded, test-only key, and the accounts a test makes
are generated inside it and gone when it ends. In the app every transaction is
signed in Shield (INV-11), and `scripts/check_signing_path.py` refuses any import of
`@provablehq/veil-aleo-sdk`, `veil-aleo-devnode`, `veil-leo` or `aleo-devnode` outside tests.
These are development dependencies only; nothing here ships.

## The programs

`programs/` holds each program's bytecode exactly as it is deployed on testnet, so the test runs
what users run, not a rebuild. The one exception is the stablecoin: the deployed
`test_usdcx_stablecoin.aleo` can be deployed and minted only by its issuer's account, so a devnode
can't hold it; the payroll test deploys the stand-in from `pnw_mvp_v2/src/stubs` under the same
name, built by Leo 4.0.0. It has the deployed program's transitions, inputs and outputs in the
same order and moves value the same way (its own Leo tests say so, negative cases included); its
freeze-list proof is taken and not checked, since the freeze-list program isn't on a devnode, and
`mint_test` credits a public balance out of nothing. The test checks each file's sha256 before
deploying it.

| File | sha256 | Read from the explorer |
|---|---|---|
| `hewn_letters_v2.aleo` | `982e2d82a95b632fe049221b645e5ff334d44370588db807624b1e0ed64a785a` | 2026-11-06 |
| `employer_agreement_v5.aleo` | `a81fec03bb1418ef4020a3433d22107d1c34aa50e1d6ca76bbf8eab905a6ed19` | 2026-11-06 and 11-07 |
| `employer_agreement_v4.aleo` | `5be6c60a70995dca1ad0368f26e781410249a61ad5ea8f7ba47db2d2b69e5b06` | 2026-11-07; not deployed by a test (it imports two programs), only read by `src/chain/generated/generated.test.ts` to check the ABI's records |
| `test_usdcx_stablecoin.aleo` | `1b00b69ef302f2c6a5af8e6888b8e33cb9fd77edf332cf79a35241f952586bc0` | Not from the explorer: built 2026-11-08 by Leo 4.0.0 from `pnw_mvp_v2/src/stubs/test_usdcx_stablecoin.aleo` (pnw_mvp_v2 #233). Rebuild it when the stand-in changes (`leo build` in a copy of the folder without the `.aleo` suffix; the file is `build/main.aleo`) |

To refresh or add one (a new version is a new file; deployed programs never change):

```bash
curl -s https://api.explorer.provable.com/v2/testnet/program/hewn_letters_v2.aleo \
  | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin))' > programs/hewn_letters_v2.aleo
sha256sum programs/hewn_letters_v2.aleo
```

A program that imports another needs its imports deployed first, in order (`hewn_credentials_v1`
imports `employer_agreement_v5`, say); none of the programs here imports anything.

## What can't be tested this way

Paying more than a Token holds. The stand-in refuses it the way the deployed program does (the
subtraction underflows; its Leo test `test_pay_over_token_fails`), but through the SDK that
underflow is a panic inside the VM's WebAssembly during local execution, not a rejected promise:
the call never settles and a test can only time out. Shield would refuse to build such a
transaction the same way, and the pay queue never builds one (`planTransfers` splits first).
