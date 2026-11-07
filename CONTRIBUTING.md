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

- **`BUILD_PLAN.md`** is the spec: phases, deliverables, exit criteria. **`progress/`** is the
  dated log of every change, one file per day in a folder per month, indexed by `PROGRESS.md`. **`CLAUDE.md`** holds
  the rules everyone follows, person or agent.
- One task, one exit criterion, one pull request. A PR ends with the tests run, a dated entry in
  that day's `progress/` file, signed with the session or person that wrote it (then
  `python3 -I scripts/progress_index.py --write`), any exit criterion it met ticked in the plan,
  and the status of any document it finished changed in its frontmatter (then
  `python3 -I scripts/docs_index.py --write`). How memory is kept: `docs/MEMORY.md`.
- CI (`.github/workflows/ci.yml`) runs the tests, a strict typecheck and build of every package,
  the static bundle of the app, and a dependency audit that fails on anything moderate or worse.
  New dependencies must be at least a week old (`pnpm-workspace.yaml`).
- Commit messages are plain: `scope: what changed`.

## The rules that aren't up for debate

Each one has an id, a check and the threats it answers in
[`docs/INVARIANTS.md`](docs/INVARIANTS.md); the full wording is in `CLAUDE.md`. In one line each:
the privacy floor (nothing about a person is ever public), no private data on any server, keys
never committed or printed, chain code only in `apps/business/src/chain`, and deployed Leo
programs never edited. A change that weakens one of them is a design discussion before it is a
pull request.

## Where things are

The root `README.md` has the map. Every folder with more than a few files has its own README
saying what's in it and how it fits: `apps/business`, `apps/site`, `packages`, `brand`, `docs`,
`archive`.

## Testing by hand

[`dev_testing_guide.md`](dev_testing_guide.md) lists the scenarios to try with real wallets and
phones, what should happen in each, and where to look for breaks. Post what you find as a
comment on the area's issue (label `manual-test`), except anything that exposes data or moves
money wrongly, which goes privately, as [`SECURITY.md`](SECURITY.md) describes.

## Contributor agreement

Every contribution comes in under the contributor licence agreement in [`CLA.md`](CLA.md). You
keep the copyright in what you write and give Joshua Daniel Day a licence to use it, including in the
commercial licence Hewn is also offered under (`LICENSING.md`); the AGPL copy stays open either
way. On your first pull request a bot (CLA Assistant) asks you to agree with one click, once.
If an AI assistant wrote part of your change, you reviewed it and submit it as your own work.

## Forking

Hewn is AGPL-3.0: use it, study it, change it, share it. If you run a changed copy as a service for
other people, offer them its source under the same licence (the app and the site link to the
source for that reason; keep a link to yours). Keep the attribution "Hewn by Joshua Day", linked
to this repository, where your users can see it, and keep `NOTICE`: that is the licence's one
additional term (`LICENSING.md`). `CREDIT` in `packages/brand/src/index.ts` is the line to keep;
`BRAND` beside it is yours to change. To build something closed on Hewn instead, ask about the
commercial licence (`LICENSING.md`).

The **Hewn** name and logo are not licensed. A fork should carry its own name and art. Both live in
one place: the name, tagline, colours and asset paths in `packages/brand/src/index.ts`, the source
art in `brand/source/` with the script that renders it. Change those and nothing else needs to
know. The internal package names stay `@pnw/*`; PNW is the protocol namespace, not the product.

## Reporting a security problem

Privately, please: see `SECURITY.md`.
