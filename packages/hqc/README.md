# @pnw/hqc

HQC-5, the category-5 level of HQC (formerly "HQC-256"), from the **HQC team's own reference
implementation, v5.1.0**, compiled to WebAssembly, with a thin TypeScript wrapper: a key pair from
a 32-byte seed, encapsulation, decapsulation. HQC is the code-based KEM NIST chose in 2025 as a
backup to ML-KEM, so that a break in lattice cryptography alone opens nothing; its standard
(FIPS 207) isn't final yet.

Nothing in the app calls this yet (2026-11-28). It is the code behind the pair-key format's
reserved id `0x03` (`packages/pair-keys`, on its branch), which will name it as
`IMPLEMENTATION`: **"HQC-5, specification v5.1, reference v5.1.0 of 2026-10-26"**. Wiring it in
is its own pull request.

Why this and not an npm package (Joshua, 2026-11-28, "option A"): no package on npm implements the
current HQC specification under a licence and at an age this repository allows (OPS-04).

```ts
import { decapsulate, encapsulate, keygen } from "@pnw/hqc";

const { publicKey, secretKey } = await keygen(seed);                  // seed: 32 random bytes; secretKey is the seed
const { cipherText, sharedSecret } = await encapsulate(publicKey);     // fresh randomness from crypto.getRandomValues
const same = await decapsulate(secretKey, cipherText);                // equals sharedSecret
```

| | Bytes |
|---|---|
| Public key | 7,237 (a 32-byte seed, then the vector s: n = 57,637 bits) |
| Secret key | 32 (the KEM seed itself: the reference re-derives everything from it) |
| Ciphertext | 14,421 |
| Shared secret | 32 |
| Encapsulation's randomness | 48 (m, 32, then the salt, 16) |

## Provenance

| | |
|---|---|
| Repository | [gitlab.com/pqc-hqc/hqc](https://gitlab.com/pqc-hqc/hqc), the HQC team's own |
| Tag | `v5.1.0` (tag object `bd3ed177e883aa04ba2db6b029599d662f88ca6f`), tagged 2026-10-26 14:12 UTC |
| Commit | `06567ccbad10580d78dd7863b15d23f41076d57f` ("Release v5.1.0"), 33 days old when vendored |
| Code | The reference (`src/ref`, no SIMD), `src/common` and `lib/fips202`, for `hqc-5` only: 28 files and the `LICENSE` |
| Licence | Public domain (the HQC team's `LICENSE`, with the notice for the FIPS 202 code it includes); the package around it is `AGPL-3.0-only`, like every package here |
| Known answers | `fixtures/PQCkemKAT_32.rsp`, their `kats/ref/hqc-5/PQCkemKAT_32.rsp`: 100 vectors, SHA-256 `e5066df4…5edb` |

`vendor/manifest.json` lists every vendored file with its SHA-256, and `scripts/check_vendor.py`
checks it: offline, every file must be there, listed, unchanged and no link, and nothing else may
be; with `--upstream`, every file is fetched at the pinned commit and must have the hash listed, and
the tag must still name that commit. CI runs the offline check on every pull request (`ci.yml`) and
both on any that touches this package (`hqc.yml`).

### The one patch

The files are the HQC team's byte for byte but for **one character**, listed in the manifest with
upstream's hash, the replacement and why, so the check can undo it and find upstream's file:

```diff
- #define BITMASK(a, size)  ((1UL << (a % size)) - 1)
+ #define BITMASK(a, size)  ((1ULL << (a % size)) - 1)
```

in `src/ref/hqc-5/parameters.h`. `BITMASK(PARAM_N, 64)` masks a vector's last 64-bit word to its
n bits; for HQC-5 that shifts by 57,637 mod 64 = 37. An `unsigned long` is 64 bits on the 64-bit
systems the reference is built for, but 32 on wasm32, where the shift is undefined and the mask
wrong: built without the patch, the module's keys, ciphertexts and shared secrets all differ from
the known answers (clang also warns, and the build treats warnings as errors). `1ULL` is at least
64 bits everywhere, so the value is the intended 2³⁷ − 1 on every target and unchanged on 64-bit
ones. HQC-1 and HQC-3 shift by 5 and 11 and don't meet the bug. It is worth reporting to the HQC
team (their README asks for issues as work items until FIPS 207 is out); that is Joshua's call.

Two more files are ours, not theirs, and change nothing of HQC:

- `wasm/include/immintrin.h`, empty: three reference headers include the x86 intrinsics header
  though the reference uses no intrinsic, and clang's own copy refuses any other target. If an
  intrinsic were ever used, the build would fail on the missing name.
- `wasm/hqc5.c`, the module's entry points: the reference's `randombytes()`, handing out the bytes
  the wrapper wrote (32 for a key pair, then 32 and 16 for an encapsulation, the order the reference
  draws them) and failing if asked for more; and the four exports below.

## The module

`dist/hqc5.wasm`, 34,504 bytes, SHA-256 in `dist/hqc5.wasm.sha256`
(`edf6c5fb5b134a7b1048a450e65a517cf17241f1c9392bd01c5ee6f3cb51db55`). The wrapper carries the same
bytes as base64 (`src/hqc5_wasm.ts`, generated) and instantiates them with
`WebAssembly.instantiate(bytes, {})`: nothing is fetched, and the empty import object means a module
that imported anything would fail to load.

- **Imports nothing**: no WASI, no file system, no clock, no network, no randomness of its own.
  Of the C library only wasi-libc's `memcpy` and `memset` are linked. The reference's two debug
  printers (`compute_generator_poly`, `vect_print`), which nothing calls, are dropped by the linker
  with what they call.
- **Exports** its memory and four functions: `hqc5_keygen`, `hqc5_encaps`, `hqc5_decaps`, and
  `hqc5_layout` (where the five buffers and the stack lie). No start function.
- **Memory**: fixed at 640 KiB (it can't grow): the stack first (512 KiB; decapsulation, the
  deepest call, uses 205 KiB), so an overflow traps rather than writing over data, then the tables
  and the buffers.
- **After every call**, success, failure or trap, the wrapper zeroes the five buffers and the whole
  stack, so nothing of a seed, a key, m or a secret stays in the module's memory. After a trap it
  also drops the instance (its stack pointer is left mid-call) and makes a new one on the next call.
  It zeroes the randomness it drew itself; inputs and outputs are the caller's to zero. What
  JavaScript can't reach stays: the engine's registers and its own copies.

In the app it needs `'wasm-unsafe-eval'`, which the app's policy already allows on every page
(`apps/business/src/security/headers.ts`, `docs/THREAT_MODEL.md` T3); JavaScript eval stays refused.
Tried in Chromium under `script-src 'self' 'wasm-unsafe-eval'`: the first known answer comes out
right; without `'wasm-unsafe-eval'` the wrapper says the module can't be instantiated.

## The wrapper

| | |
|---|---|
| `keygen(seed)` | The key pair a 32-byte seed makes; `secretKey` is a copy of the seed |
| `encapsulate(publicKey, random?)` | `{ cipherText, sharedSecret }`. `random`: 48 bytes (m, then the salt) to reproduce a known answer; left out, fresh from `crypto.getRandomValues` |
| `decapsulate(secretKey, cipherText)` | The 32-byte secret. A ciphertext changed on the way, or made for another key, gives a different pseudorandom secret, never an error (implicit rejection) |
| `isHqc5PublicKey(publicKey)` | The right length, and the three unused bits of the last byte zero, as in every key the scheme makes; `encapsulate` refuses a key that fails it |
| Constants | `PUBLIC_KEY_BYTES`, `SECRET_KEY_BYTES`, `SEED_BYTES`, `CIPHERTEXT_BYTES`, `SHARED_SECRET_BYTES`, `ENCAPSULATION_RANDOM_BYTES`, `ALGORITHM`, `IMPLEMENTATION`, `HQC5_WASM_SHA256` |

Every input is checked for type and length first; an error (`HqcError`) says which input and how
long it was, never its bytes. The functions are async (the module is instantiated on first use);
each call then runs to the end in one go. Note that `decapsulate` takes the secret key first, the
other way round from `@noble/post-quantum`'s; the lengths differ, so swapped arguments are refused.

Measured in Node 22 on a 2.1 GHz Xeon: key generation 13 ms, encapsulation 27 ms,
decapsulation 52 ms.

## The toolchain

`wasm/toolchain.json` pins **Ubuntu 24.04's own packages** (noble, release pocket) of **LLVM 18.1.3**
(`clang-18`, `libclang-cpp18`, `libllvm18`, `libclang-common-18-dev`, `lld-18`, all `1:18.1.3-1`)
and **wasi-libc** (`0.0~git20230113.4362b18-3`): each one's address, size and SHA-256, the hashes
being those in Ubuntu's signed index for noble (`dists/noble/InRelease`, signed 2024-04-25 by the
Ubuntu Archive Automatic Signing Key (2018), whose own SHA-256 is recorded too). All are years past
the seven days OPS-04 asks. `scripts/build_wasm.py` downloads each (from `archive.ubuntu.com`, or
Azure's mirror of it), checks size and hash before unpacking anything, and builds:

- `clang --target=wasm32-wasi -mcpu=generic -O3 -std=c99 -DNDEBUG -DHQC_ARCH_REF=1
  -fno-strict-aliasing`, with the HQC team's warnings (`-Wall -Wextra -Wmissing-prototypes
  -Wpedantic -Wredundant-decls`) as errors. `-O3` is their release build; `-fno-strict-aliasing`
  because the reference reads byte arrays through `uint64_t` pointers;
- `wasm-ld --no-entry --strip-all --stack-first -z stack-size=524288 --initial-memory=655360
  --max-memory=655360`, with `memcpy.o` and `memset.o` taken from wasi-libc's `libc.a`;
- then reads the module back: no import, exactly those exports, a fixed memory, no start function.

Why not wasi-sdk: its releases are on GitHub, which the sandbox this was built in couldn't download
from; Ubuntu's archive it could, and Ubuntu's packages come with a signed index. Moving to a wasi-sdk
release later is a change to `toolchain.json` and the script, and a new module hash.

### Rebuild and check

```bash
python3 -I packages/hqc/scripts/check_vendor.py --upstream   # the vendored files are the HQC team's
python3 -I packages/hqc/scripts/build_wasm.py                # rebuild; fails unless byte for byte the committed module
python3 -I packages/hqc/scripts/build_wasm.py --write        # after a reviewed change: write the module, its hash and src/hqc5_wasm.ts
```

It needs Python 3.10 or later and `dpkg-deb`, so Debian or Ubuntu (elsewhere, an `ubuntu:24.04`
container); `--cache <dir>` keeps the 44 MB of packages between runs (each is checked by hash every
time). The build runs from this folder with relative paths, no debug information and a clean
environment, so the output doesn't depend on where it ran: three builds here, one from fresh
downloads, gave the same bytes, and CI (`.github/workflows/hqc.yml`, `ubuntu-24.04`, read-only, no
secret) rebuilds it on every pull request that touches this package and fails on any difference,
keeping what it built as the run's artifact. To check Ubuntu's hashes yourself:
`gpgv --keyring /usr/share/keyrings/ubuntu-archive-keyring.gpg InRelease`, then the
`Packages.xz` hashes it lists, then each package's `SHA256` there.

## Tests

`pnpm vitest run --project hqc`:

- **The 100 official vectors** (`src/kat.test.ts`): the vectors give each test's DRBG seed, so
  NIST's AES-256 CTR_DRBG (as the KAT generator's `rng.c`) is written out in the test on Node's
  AES-256-ECB, seeded with the bytes 0 to 47; it first makes the file's 100 seeds exactly, then
  for each one draws the key pair's seed, m and the salt. Every public key, secret key, ciphertext
  and shared secret must be the file's exactly, and decapsulation must give the secret back. The
  file's own SHA-256 is checked against the manifest first.
- **The wrapper** (`src/hqc.test.ts`): the sizes; a round trip with fresh randomness; fixed
  randomness repeating; inputs left untouched; every wrong length, swapped arguments and non-bytes
  refused, with no bytes in the message; a changed ciphertext (in u, its padding, v and the salt)
  giving a different secret and no exception, the same one each time; another key's secret key; a
  public key with an unused bit set refused, and one changed elsewhere encapsulating to a secret
  the key's owner doesn't get; the module importing nothing and exporting only its five names; its
  bytes being `dist/hqc5.wasm` and the pinned hash; its memory fixed; every buffer and the stack
  zero after each call; a trap scrubbing and replacing the instance.
- **The boundary** (`src/boundary.test.ts`): no dependency, only its own imports, no fetch or
  streaming compile, no console, nothing of Node's.
- **The vendor check** (`scripts/check_vendor_test.py`): a changed, added or missing file, a link,
  a changed fixture, and a patch that hides another change, lost its replacement or its reason, all
  fail.

Also tried once, not in CI: the same build with `-fsanitize=undefined -fsanitize-trap=undefined`
passes all 100 vectors and 100 changed ciphertexts without a trap.

## Caveats

- **It is reference code**: written to be read and checked, not to be fast; the HQC team's own
  optimised code is x86-64 AVX2 only.
- **No constant-time guarantee.** The HQC team aims at timing resistance only, and only for their
  code compiled as they instruct on the architectures they target; WebAssembly isn't one, and a
  JavaScript engine's compiler may undo what the C compiler kept. Nothing running in a browser or in
  Node can promise constant time. As Hewn will use it, this matters little: each pair's HQC key
  takes one ciphertext, decapsulated once on the person's own device, and nothing answers anyone
  with the result, so there is no oracle to time across many tries.
- **Zeroing has limits** (above): the engine's registers and copies, and the caller's own arrays.
- **HQC's standard isn't final.** FIPS 207 may change the scheme again; a change would be a new
  vendored version, a new module, and a new id or name in the pair-key format, never an edit of
  this one in place.

## Files

| File | What |
|---|---|
| `src/index.ts` | The wrapper: `keygen`, `encapsulate`, `decapsulate`, `isHqc5PublicKey`, the sizes |
| `src/module.ts` | Instantiating the module, its layout, running one call, scrubbing |
| `src/hqc5_wasm.ts` | The module as base64, generated by `scripts/build_wasm.py` |
| `dist/hqc5.wasm`, `dist/hqc5.wasm.sha256` | The module and its SHA-256 |
| `wasm/hqc5.c` | Ours: `randombytes()` and the exports |
| `wasm/include/immintrin.h` | Ours: empty, so the reference's headers compile for WebAssembly |
| `wasm/toolchain.json` | The pinned packages |
| `vendor/hqc-5.1.0/` | The HQC team's files, at their own paths |
| `vendor/manifest.json` | Upstream's commit, every file's SHA-256, the one patch |
| `fixtures/PQCkemKAT_32.rsp` | The 100 official HQC-5 vectors |
| `scripts/check_vendor.py`, `scripts/check_vendor_test.py` | The vendor check and its tests |
| `scripts/build_wasm.py` | The build and its comparison |
