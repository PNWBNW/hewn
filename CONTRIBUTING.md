# Contributing to Hewn

Thanks for looking. Hewn is built in the open, on the side, by a small number of people and a lot
of patience. This page is for anyone who wants to run it, change it, or fork it into something of
their own.

## Running it

You need Node 22 and pnpm 10 (the exact pnpm is pinned in `package.json`; Corepack picks it up).

```bash
git clone https://github.com/PNWBNW/hewn.git
cd hewn
pnpm install --frozen-lockfile
pnpm test                 # every test, every package (vitest)
pnpm build                # strict typecheck of every package, then the app and site build
pnpm dev:business         # the app at http://localhost:3000
```

The app runs with no settings at all. The optional ones are in `apps/business/.env.example`;
copy it to `.env.local` and never commit it. To use the app fully you'll need the Shield wallet on
Aleo testnet. The Leo programs are a separate repository, `pnw_mvp_v2`, attached here as a
submodule over HTTPS; you only need it to work on the chain side.

## How the work is organised

- **`BUILD_PLAN.md`** is the spec: phases, deliverables, exit criteria. **`PROGRESS.md`** is the
  dated log of every change. **`CLAUDE.md`** holds the rules everyone follows, person or agent.
- One task, one exit criterion, one pull request. A PR ends with the tests run, a dated entry in
  `PROGRESS.md`, and any exit criterion it met ticked in the plan.
- CI (`.github/workflows/ci.yml`) runs the tests, a strict typecheck and build of every package,
  the static bundle of the app, and a dependency audit that fails on anything moderate or worse.
  New dependencies must be at least a week old (`pnpm-workspace.yaml`).
- Commit messages are plain: `scope: what changed`.

## The rules that aren't up for debate

They are spelled out in `CLAUDE.md`; the short form:

- **Privacy floor.** Anything tied to a person (wages, withholding, W-4s, bank details, paystubs,
  addresses) is private in every mode and can never be made public. Enforce it in the vault or the
  circuit, not only in the UI.
- **No private data on any server.** No database. The one exception, two totals per country for
  the traction map, is described in `CLAUDE.md` and `docs/THREAT_MODEL.md`.
- **Keys.** Never commit or print a private key, view key, `.env` or seed phrase.
- **Boundaries.** Chain code lives in `apps/business/src/chain` and is loaded only by the pages
  that need it; the ledger, vault, reports and payroll never import a wallet or Aleo package. A
  test enforces this (`apps/business/src/fiat_boundary.test.ts`).
- **Leo.** Deployed programs are never edited; changes ship as a new version with a migration
  note and negative tests.

## Where things are

The root `README.md` has the map. Every folder with more than a few files has its own README
saying what's in it and how it fits: `apps/business`, `apps/site`, `packages`, `brand`, `docs`,
`archive`.

## Testing by hand

[`dev_testing_guide.md`](dev_testing_guide.md) lists the scenarios to try with real wallets and
phones, what should happen in each, and where to look for breaks. Report anything that exposes
data or moves money wrongly privately, as [`SECURITY.md`](SECURITY.md) describes.

## Forking

Hewn is AGPL-3.0: use it, study it, change it, share it. If you run a changed copy as a service for
other people, offer them its source under the same licence (the app and the site link to the
source for that reason; keep a link to yours).

The **Hewn** name and logo are not licensed. A fork should carry its own name and art. Both live in
one place: the name, tagline, colours and asset paths in `packages/brand/src/index.ts`, the source
art in `brand/source/` with the script that renders it. Change those and nothing else needs to
know. The internal package names stay `@pnw/*`; PNW is the protocol namespace, not the product.

## Reporting a security problem

Privately, please: see `SECURITY.md`.
