# apps/native — the native verifier

The first piece of the hardened native client (`docs/HOSTING.md`, "Later: a hardened native
client"): a verifier in Rust, with no web engine, that checks on a person's own computer what the
JavaScript tools and the website's `/verify` page check. A library does the checking; a small GPUI
window shows each check, passed or failed and why. It holds no keys, opens no books, has no
wallet and signs nothing (INV-11: signing stays in Shield). Its only network reads are the
explorer's, for anchors.

| Path | What |
|---|---|
| `verify/` | `pnw-verify`, the library, and `pnw-verify`, its command-line tool |
| `verify/src/release.rs` | A release folder, as `scripts/release/verify.mjs` checks it |
| `verify/src/period.rs` | A period proof and its anchor, as `/verify` checks them (`@pnw/ledger` `checkPeriodProof`, `chain/period_check.ts`) |
| `verify/src/aleo.rs` | What snarkVM adds natively: transaction ids, and that the anchoring transaction carries the root |
| `verify/src/chain.rs` | The explorer reads, read only |
| `verify/src/js.rs` | `JSON.stringify`, JavaScript's numbers, string order and `trim`, as the proof's hashes need them |
| `verify/src/generated.rs` | The product's name, colours and release keys (`@pnw/brand`) and the program ids and explorer (`@pnw/config`), generated; never edit it |
| `verify/tests/` | The tests, and their fixtures (below) |
| `app/` | `pnw-verifier`, the window: a thin layer over the library |
| `scripts/generate.mjs` | Writes `generated.rs`; without `--write`, fails when it differs |
| `scripts/period_fixture.test.ts` | Makes the period fixtures with `@pnw/ledger`'s own code; fails when the committed ones differ |
| `scripts/check_gpui_source.py`, `_test.py` | Checks every `gpui-pre` crate against Zed's repository (below), and its tests |
| `gpui_patches.toml` | What the `gpui-pre` snapshots change from Zed's source, reviewed |
| `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml` | Its own Cargo workspace, every crate pinned, Rust 1.97.0. Not part of the pnpm workspace |

## Build and run

```bash
cd apps/native
cargo test --locked                                  # every test; the live one is ignored
cargo test --locked -- --ignored                     # October's anchor, read from the real explorer
cargo run --locked -p pnw-verifier-app               # the window
cargo run --locked -p pnw-verify -- release ../../scripts/release/fixture/bundle --key QHzyXDv61fB8w9nNyyvTIWLiPOZlm67NAWcLJHynbJQ=
cargo run --locked -p pnw-verify -- period <proof.json>
cargo run --locked -p pnw-verify -- anchor <root> <last day of the range> [<anchoring transaction id>]
```

On Linux the window needs `libxkbcommon-dev libxkbcommon-x11-dev libxcb1-dev libx11-xcb-dev
libfontconfig1-dev libfreetype-dev libvulkan-dev libwayland-dev` and a Vulkan driver to run.
Windows and macOS need nothing beyond Rust. `--key` (both the window and the tool) trusts a release
key by hand while `@pnw/brand` publishes none, as `verify.mjs --key` does; `--endpoint` reads
another explorer.

The window: **Check a release folder…**, **Check a period proof…** (the file the close panel
exports), or **Check a period's anchor from the clipboard** (copy a root, the range's last day
and, if known, the anchoring transaction's id, in any order). A box also reads a release's anchor.

`.github/workflows/native.yml` runs, on every pull request that touches this folder or what it is
made from: the generated files, the period fixtures, the crate-age check, the GPUI source check
and its tests, then formatting, lints and every test on Linux, and builds the window and the tool
for Windows (unsigned, kept as the run's artifact with their SHA-256). Running it on a real Windows
machine is a person's to do.

## What it checks

**A release** (`verify.mjs`, byte for byte, against the same fixture, `scripts/release/fixture`):
`release.json` is well formed, every path is one a release may carry, and its digest is the
SHA-256 of the canonical list; `release.sig` is an Ed25519 signature of that digest by a trusted
key (`releaseKeys` in `@pnw/brand`, or `--key`); every file in the folder is listed with its
SHA-256 and nothing else is there; the commit `release.json` names is the bundle's build id; and,
when asked, the digest is anchored in `payroll_audit_log`'s `audit_event_height`. Two differences
from `verify.mjs`, both stricter: a field the format says is a string must be one (JavaScript's
regular expressions would take a one-element array), and Ed25519 is verified strictly (canonical
encodings, no small-order keys). A signature `sign.mjs` makes passes both. It checks a folder, not
a URL: `verify.mjs` also checks what a host serves.

**A closed period** (`/verify`): the file's half recomputes every entry's hash (BLAKE3 over the
`JSON.stringify` of its canonical array), checks every entry is dated in the range and in journal
order, and recomputes the leaves, the two Merkle roots and the period root (BLAKE3 under the
`HEWN::…::v1` domains) from the salts the file reveals. The chain's half, only if the file passes:
the root is in `audit_event_height`, the block it names was made after the range ended, and every
payment's transaction is on chain. The labels and the reasons are the page's. The fixtures are made
by `@pnw/ledger` itself, on entries that use every field the hash reads, so a change to the
ledger's format fails here until the port follows.

**What snarkVM adds** (`snarkvm-console` 4.13.1; `aleo.rs`): the period root is the app's own
commitment, BLAKE3 and HMAC, with no Aleo hash in it, so snarkVM isn't needed to recompute it.
What it does natively is check the anchoring transaction itself. `anchor_event`'s input is
private, but the future it returns carries the root in public; from the transaction as the
explorer serves it, the verifier recomputes the future's output id (Poseidon8 over the function
id, a BHP1024 hash, the future's fields, the transition commitment and the index), every
transition's id (BHP512 over the root of the BHP Merkle tree of its inputs and outputs, and its
commitment) and the transaction's id (the root of the tree of its transitions and its fee). So the
explorer can't show another argument for the transaction the books recorded without an id failing
to match. Transaction ids are also checked as snarkVM reads them, checksum and all (`/verify`
checks their characters and length). For a proof, the transaction is the standing close's
`anchorTx`; for the clipboard check, the one given.

**October 2026**, closed and anchored on testnet on 2026-11-07 (`progress/2026-11/2026-11-07.md`):
its root `95496641…e68b` is the argument of `anchor_event` in `at1hg2etspa…p500eq`; anchored in
block 21,235,519, made 2026-11-07, after the range ended on 2026-10-31. `verify/tests/october.rs`
checks this from a trimmed copy of the transaction (ids, types, commitments and the public future;
the private input's ciphertext, the proofs and the fee's values, which name the account that paid,
are left out), and `live_october_is_anchored` against the live explorer.

## What it doesn't check

- **October's entries.** Its proof file isn't here (it holds wages); what is checked is its public
  data. A person with the file checks it with **Check a period proof…**.
- **Who anchored.** `anchor_event` records no caller; the business name in a proof is the file's
  own claim, shown as such.
- **That the explorer is honest about the chain.** The mapping, the block's time and whether a
  transaction is in an accepted block are the explorer's word, as on `/verify`. The transaction
  check narrows what it could lie about, not whether. No proof is verified: that would need the
  programs' verifying keys and snarkVM's synthesizer, and no block or consensus is checked.
- **A release served at a URL** (`verify.mjs` does).
- **Signing anything.** Nothing here can: there is no key and no wallet.

## Where GPUI comes from

The window takes GPUI, Zed's UI framework, through **gpui-kit** (Longbridge, Apache-2.0, used in
production in Longbridge Pro), at `=0.10.0` with its default features off: GPUI alone, no component
library, no bundled assets. gpui-kit pins **gpui-pre** `=0.3.12`: weekly crates.io snapshots of
Zed's GPUI, twenty `gpui-pre-*` crates, each naming the Zed commit it was taken from
(`[package.metadata.gpui-pre] zed-rev`, here `d2a4fb6ded7c470be25d1541281da3882495b65b`). crates.io's
own `gpui` (0.2.2) dates from October 2025 (Joshua, 2026-11-25). One maintainer (crates.io user
`huacnlee`) publishes both gpui-kit and gpui-pre, which is why the source isn't taken on trust:

- **Seven days** (OPS-04): every crate in `Cargo.lock` was published at least seven days before it
  was pinned, and none comes from git (`apps/desktop/scripts/check_crate_age.py --lock
  apps/native/Cargo.lock --no-git`). gpui-kit 0.10.0 was published 2026-11-16 and gpui-pre 0.3.12
  2026-11-09; a few newer patch releases of common crates were pinned back.
- **Zed's own source** (`scripts/check_gpui_source.py`): each `gpui-pre` crate is downloaded from
  crates.io, its SHA-256 checked against `Cargo.lock`, and compared file by file with its crate in
  Zed's repository at the commit it names (fetched shallow, by commit). Not compared: `Cargo.toml`
  (cargo rewrites it), `Cargo.toml.orig` (the snapshot renames the package and its dependencies;
  what it depends on is in `Cargo.lock`, under the seven-day rule), `.cargo_vcs_info.json` and
  `Cargo.lock` (cargo writes them), and on Zed's side nested crates and files the manifest
  excludes. Anything else that differs, is extra or is missing fails.
- **What the snapshots change**, found by that check and reviewed on 2026-11-25
  (`gpui_patches.toml`, for Joshua's approval in the pull request): sixteen of the twenty crates are
  Zed's files exactly. Seven files in four crates are changed, each marked "Modified for gpui-pre":
  `actions!` derives `$crate::Action` (gpui-pre); the macros pass their output through an added
  module that rewrites `gpui::` paths to the gpui-kit facade (gpui-pre-macros, two files: token
  rewriting only, no file, network or process access); a field removed and a method renamed for wgpu
  30.0.1 from crates.io in place of Zed's pinned wgpu commit (gpui-pre-wgpu, three files); and
  gpui-pre-apple's build script reads GPUI's sources from `vendor/gpui` instead of `../gpui`, those
  five vendored files being Zed's `crates/gpui` files byte for byte. Each patch is pinned by the
  SHA-256 of both sides: a new gpui-pre version, or any change to a patch, fails the check until it
  is read again and written down.

gpui-kit itself and `gpui-base` (Longbridge's own crates, not Zed's) are held to the seven-day rule
but not compared with anything: they are read in review like any other dependency.

**snarkVM:** `snarkvm-console` `=4.13.1` (published 2026-11-17; mainnet's version per Provable),
with only its `network`, `program` and `types` features: Aleo's types and hashes; no proving or
verifying key is used. Testnet ran snarkVM 4.12.0 when this was pinned (the
snarkOS v4.12.0 that `pnw_mvp_v2`'s toolchain pairs with Leo 4.4.6; the explorer doesn't say). The
hashes used here are the same in both; October's transaction recomputes under 4.13.1.
