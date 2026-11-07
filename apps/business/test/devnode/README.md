# test/devnode — Hewn against a real Aleo node

End-to-end tests that run Hewn's own chain code against a local Aleo node, step 1 of
`docs/VEIL.md`. The app's unit tests mock the chain and the Leo tests check the programs alone;
these check the seam between them: that the inputs Hewn builds are what the deployed program takes,
and the records it returns are what Hewn reads.

```bash
pnpm --filter @pnw/business test:devnode   # about 2 minutes; CI runs it after `pnpm test`
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

## The signing key

The devnode client signs with the node's seeded, test-only key, and the accounts a test makes
are generated inside it and gone when it ends. In the app every transaction is
signed in Shield (INV-11), and `scripts/check_signing_path.py` refuses any import of
`@provablehq/veil-aleo-sdk`, `veil-aleo-devnode`, `veil-leo` or `aleo-devnode` outside tests.
These are development dependencies only; nothing here ships.

## The programs

`programs/` holds each program's bytecode exactly as it is deployed on testnet, so the test runs
what users run, not a rebuild. The test checks each file's sha256 before deploying it.

| File | sha256 | Read from the explorer |
|---|---|---|
| `hewn_letters_v2.aleo` | `982e2d82a95b632fe049221b645e5ff334d44370588db807624b1e0ed64a785a` | 2026-11-06 |
| `employer_agreement_v5.aleo` | `a81fec03bb1418ef4020a3433d22107d1c34aa50e1d6ca76bbf8eab905a6ed19` | 2026-11-06 and 11-07 |

To refresh or add one (a new version is a new file; deployed programs never change):

```bash
curl -s https://api.explorer.provable.com/v2/testnet/program/hewn_letters_v2.aleo \
  | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin))' > programs/hewn_letters_v2.aleo
sha256sum programs/hewn_letters_v2.aleo
```

A program that imports another needs its imports deployed first, in order (`hewn_credentials_v1`
imports `employer_agreement_v5`, say); neither program here imports anything.
