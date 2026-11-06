# test/devnode — Hewn against a real Aleo node

End-to-end tests that run Hewn's own chain code against a local Aleo node, step 1 of
`docs/VEIL.md`. The app's unit tests mock the chain and the Leo tests check the programs alone;
these check the seam between them: that the inputs Hewn builds are what the deployed program takes,
and the records it returns are what Hewn reads.

```bash
pnpm --filter @pnw/business test:devnode   # about 40 s; CI runs it after `pnpm test`
```

It is not part of `pnpm test` (the root runs only `vitest.config.ts` files); its config is
`vitest.devnode.config.ts`.

## How it works

- `@provablehq/veil-aleo-devnode` starts a local node (the `aleo-devnode` binary, installed from
  npm as `@provablehq/aleo-devnode`) with a funded test account. The node skips proof
  verification, so transactions carry placeholder proofs and a deploy takes seconds.
- `beforeAll` deploys the program from `programs/`, and the tests send with Veil's devnode client,
  then decrypt the outputs with view keys the way Shield would list them.
- What the tests call is Hewn's code, not a copy: `letterCall`, `manyCalls`, `parseLetterRecord`
  (`src/chain/letters.ts`) and the mailbox's `seal` and `open` (`@pnw/mailbox`).

## The signing key

The devnode client signs with the node's seeded, test-only key. In the app every transaction is
signed in Shield (INV-11), and `scripts/check_signing_path.py` refuses any import of
`@provablehq/veil-aleo-sdk`, `veil-aleo-devnode`, `veil-leo` or `aleo-devnode` outside tests.
These are development dependencies only; nothing here ships.

## The programs

`programs/` holds each program's bytecode exactly as it is deployed on testnet, so the test runs
what users run, not a rebuild. The test checks each file's sha256 before deploying it.

| File | sha256 | Read from the explorer |
|---|---|---|
| `hewn_letters_v2.aleo` | `982e2d82a95b632fe049221b645e5ff334d44370588db807624b1e0ed64a785a` | 2026-11-06 |

To refresh or add one (a new version is a new file; deployed programs never change):

```bash
curl -s https://api.explorer.provable.com/v2/testnet/program/hewn_letters_v2.aleo \
  | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin))' > programs/hewn_letters_v2.aleo
sha256sum programs/hewn_letters_v2.aleo
```

A program that imports another (an agreement checking a name) needs its imports deployed first,
in order; the next test (an offer and its acceptance) adds that.
