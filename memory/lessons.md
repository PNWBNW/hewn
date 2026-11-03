# Lessons

What was learned the hard way and would be relearned without this file. One entry each, with
where it came from. Append freely; the dreaming pass merges duplicates and drops what stops
being true.

## Working in the cloud session

- **Force-push is refused by the session's safety classifier.** After a squash merge, bring the branch back to a plain push with `git merge -s ours --no-edit -m "…" origin/main`, then push; never `--force`. Commit first: `merge -s ours` fails on uncommitted changes. (`progress/2026-11-03.md`)
- **`pkill` can kill the shell itself** (exit 144) when its pattern matches the running command. Kill by PID from `ps` with a bracketed grep pattern (`grep "[r]ender"`), and don't put a `pkill` in the same command as the thing you then start. (`progress/2026-11-03.md`)
- **`uv tool install` and `pip install` are refused by the classifier** in this sandbox; Node tooling from the repo's own `node_modules` works. (`progress/2026-11-03.md`)
- **The sandbox has no GPU**: WebGL runs on SwiftShader, about 80× slower than a GPU for 3D. A 60 s film with a live three.js set renders at ~0.6 fps with no sub-frame blur at 30 fps; plan ~40 minutes, not 5. (`progress/2026-11-03.md`)
- **The GitHub `merge_pull_request` tool wants the full 40-character SHA**; a short one is refused. Take it from `git rev-parse HEAD`. (`progress/2026-11-03.md`)
- **Two `with:` blocks on one workflow step make the YAML invalid**; the run never starts and the PR shows no CI at all. Parse workflow files (`yaml.safe_load`) before pushing them. (`progress/2026-11-03.md`)
- **Plain HTTP is refused by the agent proxy**, and github.io isn't reachable from the sandbox; a headless browser against a local server works. (`progress/2026-10-25.md`, `2026-11-03.md`)
- **`build:static` overwrites `.next`**, so `next start` after it serves pages whose script nonces no longer match the per-request policy; rebuild the website first. (`progress/2026-10-25.md`)

## Shield and the network

- **On testnet, a private fee fails** (`RemoteProvingService ERR_NAME_NOT_RESOLVED`); Shield covers the fee publicly. The on-chain backup needs "pay with public fees" there; the app says so. (`progress/2026-10-27.md`)
- **Shield's in-app browser has no share sheet and no downloads**; a backup file can't be saved from it. The on-chain backup exists for this reason; a request to Shield's team is drafted. (`progress/2026-10-27.md`)
- **A Shield app update can empty its browser's storage**, taking the books with it. Backups are asked for; the on-chain backup restores on any device. (T19, `progress/2026-10-26.md`)
- **A plain download can land nowhere inside an app's browser** and the page can't tell; a backup counts only through the share sheet or after the person confirms. (`progress/2026-10-26.md`)
- **Shield joins a new private payment with the money already there within a minute**, so the books can only read payments through the business's own view key. (T20, `progress/2026-10-26.md`)
- **Making or accepting an offer on `employer_agreement_v4` shows both names' hashes and both accounts in the transaction**; v5 was written so the pair stays off the public chain. (`progress/2026-10-22.md`)

## The repository

- **A deleted Vercel deployment can take an old preview with it** (30-day retention); production and the domains were fine. Restore and redeploy. (`docs/incidents/2026-10-27-stuck-on-opening.md`)
- **The app stuck on "Opening…" in two browsers and resolved by itself; the cause is unknown.** Don't change anything on the assumption that it is known: write it up, keep the probe (`hewn.drawing-step`). (`docs/incidents/2026-10-27-stuck-on-opening.md`)
- **`@types/node` follows the Node that runs the code** (22); newer types let code call functions that don't exist at run time. Dependabot skips its major bumps; move it by hand when CI and Vercel move. (`progress/2026-10-21.md`)
- **Statuses rot unless generated**: "being built" outlived the build in three documents and the Now block within two days. The documents' index is generated from frontmatter now; the dreaming pass verifies the rest. (`progress/2026-11-03.md`)
- **The invariants table drifts too**: its intro said T1 to T17 when there were 20; a CI step said four flags when there were five. The map and the checks catch paths, not prose; the dream reads prose. (`progress/2026-11-03.md`)
- **GitHub's image proxy caches a README image**; a newly published `still.svg` can show stale or broken for a few minutes after the first deploy. (`progress/2026-11-03.md`)
