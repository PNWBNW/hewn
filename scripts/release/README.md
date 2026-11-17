# scripts/release — signed, anchored releases of the static bundle

Step 2 of `docs/HOSTING.md`: make the code people run checkable. A release is the static bundle
(`pnpm --filter @pnw/business build:static`, the folder `apps/business/out`) built from a tagged
commit, with a list of every file's SHA-256, one digest over that list, the operator's signature
of the digest, and the digest anchored on Aleo. Anyone can rebuild it, compare, and check the
signature and the anchor. Node's own modules only; no dependency. The scripts read `@pnw/brand`
and `@pnw/config` from their TypeScript source, so they need Node 22.18 or later and a copy of
this repository, but no `pnpm install`.

| File | What it does | Who runs it |
|---|---|---|
| `build.mjs` | Builds the bundle in a fixed environment (the commit as Next.js's build id, no machine settings, UTC), then writes `release.json` | CI, twice; the operator, once |
| `manifest.mjs` | Writes `release.json` for a bundle folder | `build.mjs`; by hand for any folder |
| `compare.mjs` | Compares two builds (folders or `release.json` files) and names each file that differs | CI; the operator, before signing |
| `keygen.mjs` | Makes the release key pair; the private key goes only to a file outside any repository | The operator, once, offline |
| `sign.mjs` | Signs a `release.json`'s digest, writes `release.sig` | The operator, offline |
| `verify.mjs` | Checks a bundle folder or a URL against `release.json`, `release.sig`, the published keys and (with `--anchor`) the anchor | Anyone |
| `anchor.mjs` | Prints the `[u8; 32]` input for `anchor_event`; reads the anchor back from the explorer | The operator; anyone (`check`) |
| `lib.mjs`, `git.mjs`, `keys.mjs` | The format, the checks, the commit, the key file | The scripts above |
| `release.test.mjs`, `fixture/` | The tests (`node --test scripts/release/release.test.mjs`, in CI) and a small signed bundle they check | CI |

The workflow is `.github/workflows/release.yml`: on a `v*` tag, or by hand, it builds the commit
twice on two machines in two folders, fails unless the two are the same bytes, and uploads the
bundle with its `release.json` (`release-bundle`) and the manifest alone (`release-manifest`). It
holds no secret and signs nothing.

## The format

`release.json`, at the root of the bundle:

```json
{
  "version": "v1.2",
  "commit": "<40 hex>",
  "created": "YYYY-MM-DD",
  "files": { "<path relative to the bundle, forward slashes, sorted>": "<sha256 hex>" },
  "digest": "<sha256 hex>"
}
```

- `digest` is the SHA-256 of the canonical JSON of `files`: `{"<path>":"<hash>",...}`, the paths
  in byte order, no whitespace, as UTF-8. Paths are printable ASCII without `"` or `\`, so any
  language writes the same bytes.
- `release.json` and `release.sig` are not listed in `files`.
- `created` is the commit's day (UTC) and `version` the tag on it (else `dev-<12 hex>`), so two
  builds of one commit write the same `release.json`.
- **What the signature covers:** the list of files, and nothing else in `release.json`. The commit
  is covered too, indirectly: a release build names its folders by it (`_next/static/<commit>/`),
  and `verify.mjs` fails a `release.json` whose commit isn't that one. The `version` and `created`
  fields are not signed: an old release keeps its valid signature under any version label, so
  check the commit (or the digest) against the release notes, not the label.

`release.sig`, beside it: `{"key": "<key id>", "sig": "<base64>"}`, an Ed25519 signature over the
32 raw digest bytes. A key's id is the first 16 hex characters of the SHA-256 of its raw 32-byte
public key.

The keys a release is checked against are `releaseKeys` in `packages/brand/src/index.ts`
(`{id, publicKey}`, the raw key in base64). The list ships empty: until the operator adds a key,
`verify.mjs` checks a signature only against keys given with `--key`. `RELEASE_KEY_FIXTURE` there
is the key that signed `fixture/`; it is for the tests and never trusted.

## The operator's guide

### Once: the release keys (offline)

On a machine you trust, ideally one that stays offline, with this repository checked out:

```bash
node scripts/release/keygen.mjs --out /Volumes/ReleaseKey/release-1.pem
node scripts/release/keygen.mjs --out /Volumes/Spare/release-2.pem     # the spare, kept apart
```

Each asks for a passphrase (twice; never shown) and encrypts the key with it. The script refuses a
path inside this repository or any git checkout, never overwrites a file, writes the key with
mode 0600 and prints only the key id and the public key, as the line to add to `releaseKeys`.
Add both lines in a pull request (the spare is how a lost or leaked key is replaced). The private
keys never go into GitHub, CI, Vercel, a chat or a password manager that syncs (INV-06). The key
file's passphrase uses the standard encrypted-PKCS8 format (as `openssl` writes it), which is a
second lock, not the only one: keep the file on an encrypted drive too, and pick a long passphrase.

### Each release

1. **Tag the commit** on `main`: `git tag v1.2 <commit> && git push origin v1.2`. The Release
   workflow builds it twice and fails if the builds differ. Its summary shows the digest.
2. **Rebuild it yourself** from a fresh clone of the same commit, with the pnpm in `package.json`
   and the same Node as the workflow (its build log's first line names it: "with Node v22…"):
   ```bash
   git clone https://github.com/PNWBNW/hewn release-check && cd release-check
   git checkout v1.2 && pnpm install --frozen-lockfile
   node scripts/release/build.mjs            # prints the digest
   ```
3. **Compare with CI's**: download the `release-bundle` artifact from the run, unzip it, and
   ```bash
   node scripts/release/compare.mjs apps/business/out ~/Downloads/release-bundle
   ```
   It must say `Same release.` If not, it names the files that differ: don't sign.
4. **Sign** on the offline machine. Only `release.json` needs to travel to it:
   ```bash
   node scripts/release/sign.mjs path/to/release.json --key /Volumes/ReleaseKey/release-1.pem
   ```
   It checks that the digest is the list's and the commit the bundle's build id (given a bundle
   folder instead, also that every file matches), asks for the passphrase, and writes
   `release.sig` beside `release.json`. It prints the digest and the key id, never the key.
5. **Check the signature** against the published keys:
   ```bash
   node scripts/release/verify.mjs apps/business/out     # with release.sig copied in
   ```
   Until your key is in `releaseKeys` on `main`, pass it: `--key <your public key>`.
6. **Anchor the digest** on Aleo (below), then check it:
   ```bash
   node scripts/release/anchor.mjs check apps/business/out   # "Anchored in block …"
   ```
7. **Publish**: a GitHub release on the tag with the bundle (zipped), `release.json`,
   `release.sig`, the digest and the anchor's transaction id in its notes. The hosts (step 4 of the
   plan) serve the bundle with `release.json` and `release.sig` at its root, so
   `node scripts/release/verify.mjs https://<where it is served>/ --anchor` checks what that host
   serves: every listed file at its own address, and each page at its folder's address too (`/`,
   `/terms/`). It can't see an address the list doesn't name, or what the host sends someone else
   at another moment; the desktop app and the website's worker (steps 3 and 4) check every
   response as it arrives.

### Anchoring a release

The digest goes on chain through the deployed `payroll_audit_log` (`@pnw/config`
`PROGRAMS.layer1.payroll_audit_log`): `anchor_event(event_hash: [u8; 32])` records the block a
hash first appeared in, under `audit_event_height`, and refuses the same hash twice. No new Leo
program. It is the same call the app makes when the books are closed
(`apps/business/src/chain/close_anchor.ts`: `anchorCall(root)` builds it with a public fee, and
`CloseShield.tsx` sends it with `executeAndWait(wallet, …)` from the wallet package, approved in
Shield). The signature says who released it; the anchor says, in public, the block by which that
exact list of files existed, so a release swapped for another later can't claim the earlier date:
its digest would have a later anchor, or none. Checking which release *should* be served (the
latest, by its anchor) is left to the person, or to the desktop app and the worker later.
`anchor_event` records no caller and takes any 32 bytes from anyone: the anchor proves when, not
who (the signature does that). The account that anchored shows only as the payer of the
transaction's public fee, so the notes name the transaction. Anchor before the release is
published; the CI artifact is public, so someone else may anchor the digest first. Then
`anchor_event` refuses the operator's call (the same hash twice), and `anchor.mjs check` still shows
the earlier block, which is all the anchor is for.

`node scripts/release/anchor.mjs literal <bundle | release.json | digest>` prints the program,
the function, the fee and the input:

```
Program   payroll_audit_log.aleo
Function  anchor_event
Fee       public
Input     [ 120u8, 199u8, … ]
```

The write itself is signed in the operator's Shield wallet (INV-11); nothing here signs or sends.
The app has no place yet to anchor a digest that isn't a closed period's root. The smallest way
that keeps every write in Shield: a few lines on an existing chain page (the period check at
`/verify`, say) that take a pasted 64-hex digest and call the same `anchorCall` and
`executeAndWait`, so Shield shows `payroll_audit_log.aleo/anchor_event` and the bytes before it
is approved. That is a change to a screen, so it waits for a go-ahead. Until then a release can
be built, compared, signed and checked; only the anchor waits.

`anchor.mjs check` reads
`https://api.explorer.provable.com/v2/testnet/program/<id>/mapping/audit_event_height/<key>`
(`--endpoint` for another explorer) and prints the block, or exits 1 when there is none.

## Reproducible builds

Two clean builds of one commit give the same bytes. Found on 2026-11-17 by building the same
tree twice in two folders and comparing:

- **What differed:** only Next.js's build id, a random string per build. It names a folder
  (`_next/<id>/`, `_next/static/<id>/`) and appears in every page and every `__next.*.txt` file;
  through the pages' inline scripts it also changed the script hashes in each page's security
  policy. Every page and every route file differed; the scripts and styles did not.
- **What changed:** the static build's id is the commit (`apps/business/next.config.ts` reads
  `HEWN_BUILD_ID`, which `build.mjs` sets), and `build.mjs` builds in a fixed environment:
  only the tool paths and proxy settings of the machine are kept, no `NEXT_PUBLIC_*` or
  `VERCEL_*`, time zone UTC, a fixed locale, telemetry off, the old output and cache removed.
- **Checked:** two builds in different folders, one with a different time zone, umask and
  `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_ALEO_ENDPOINT` set, gave identical trees and identical
  `release.json` files; checked again in a second review from two fresh copies of the tree, and with
  `CI=true` set (as GitHub sets it) against one without. No absolute path or build time appears in
  the output.
- **Not yet checked:** a build on macOS or Windows against one on Linux. Next.js compiles with a
  native binary per system; if they differ, build the release on Linux (CI's system), in a
  container if need be.

The website build (`pnpm build`, Vercel) keeps Next.js's own build ids: it isn't a release.

## Tests

`node --test scripts/release/release.test.mjs` (in CI) checks the format and its digest, that a
changed, missing or added file fails and is named, that an edited list no longer matches its
signature, that no key is trusted until one is published, sign then verify with a key made for
the test, that `keygen.mjs` refuses a path in the repository or any git checkout and prints no
private key, the anchor's input and mapping key against the app's, the explorer reads (mocked),
verification over HTTP against a local server (each page at its folder's address too), and that
a `release.json` naming another commit than the bundle's build id fails.
`apps/business/src/release_build_id.test.ts` checks that `next.config.ts` takes the static
build's id from `HEWN_BUILD_ID`, refuses anything but a 40-hex commit, and leaves the website
build alone.
