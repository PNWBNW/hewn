---
status: design
updated: 2026-11-25
summary: How the native desktop client is built to be hard to attack: GPUI without gpui-kit and an in-house trusted path for the three screens that matter, three processes with the keys in the smallest, payments proved against the chain before the phone is asked, one way out to the network, releases that need more than one key, the books under a memory-hard key and a device factor, and a post-quantum plan with its honest limits; a checklist with the test for each item.
---

# Hardening the native client

**What this is.** The design rules for Hewn's native desktop client (`apps/native`, and the Tauri app
in `apps/desktop` where they apply to it): how it keeps a person's books, their workers' personal
data and their payments safe on a computer Hewn doesn't control. It comes from a security deep dive
on 2026-11-25 (six research passes and a red-team pass over them: the interface stack, the supply
chain, the operating system, post-quantum cryptography, the network, the data), done at Joshua's
request. The findings that concern the app as it runs today are kept in the private security record
until each is fixed (`docs/THREAT_MODEL.md`, the security review's rule); this document is the
design going forward.

**Nothing here is built** except what `apps/native` already has. Each rule becomes a pull request of
its own with its test (OPS-08); screens wait for Joshua's go.

## The shape in one paragraph

The phone is the authority: nothing is signed without the person reading it in Shield. The computer
proves what it asks the phone to sign: a payment goes only to an address the chain says belongs to
an active agreement with that worker. The keys live in one small process that has no window and
almost no dependencies; the interface and the network each run in their own process and never hold
a key. The only ways out to the network are listed in one module. A release needs more than one key
and is anchored on Aleo before an app installs it. The books are sealed under a memory-hard key and,
on the device, a factor the computer's own chip keeps. Data at rest is already quantum-safe; what
travels on chain is moved to hybrid post-quantum encryption before any worker's SSN does.

## 1. The interface: GPUI without gpui-kit, and an in-house trusted path

**Decision (proposed):** keep GPUI, drop gpui-kit, build the three security-critical screens in
house. Don't build a whole toolkit in house now.

- **Why not keep gpui-kit.** The risk the source check was built for is in the wrong place: `gpui-kit`
  and `gpui-base` are about 166,000 lines of their publisher's own code (HTML, XML and Markdown
  parsers, a language-server library, two unmaintained crates) that nothing compares with any
  upstream, and `gpui-base` compiles in even with its features off. Depending on `gpui-pre` directly
  removes about 55 crates on Windows and all of that code, and leaves only what the source check
  already compares with Zed. (A short spike confirms `gpui-pre` builds without the kit.)
- **Why not a whole in-house toolkit.** An interface good enough for Hewn's screens on three systems
  is about 40–70 person-weeks for one senior engineer, plus 10–20 a year to keep, with input methods
  and screen readers where estimates slip; the screens themselves are another 30–60 person-weeks on
  any toolkit. That is the wrong place to spend before mainnet.
- **The trusted path, in house:** the passphrase field, the pairing code and the payment review are
  drawn by a small in-house layer: rendered on the CPU (no GPU driver in the path), few dependencies,
  a passphrase field whose memory is wiped, no invisible or direction-reversing characters on the
  review, and kept out of screen capture. These are the screens an attacker would most like to fake
  or read.
- **The rest:** a 1–2 week spike compares GPUI and Slint (software renderer) on one real ledger screen
  before any more screens are built.
- **Our own code** forbids `unsafe` (`#![forbid(unsafe_code)]`), and every control has its
  accessibility role.

**What would change this:** Zed publishing GPUI officially (move to it); `gpui-pre` stalling or
shipping a change it doesn't explain (freeze it and move to Slint); a Windows-only client (native
Win32 controls, about 22 crates, 8–14 person-weeks); a dedicated interface engineer for a year (an
in-house toolkit becomes realistic).

## 2. Three processes, the keys in the smallest

| Process | Holds | Can't |
|---|---|---|
| **Core** | The vault's keys, the Shield pairing, the books' sealed fields; builds every request to Shield | Draw a window, load plugins, start other programs, reach any host but through the network process |
| **Network** | One connection policy (section 4) | See a key or a decrypted book |
| **Interface** | What is on screen now, field by field | Hold a key, reach the network, read a field it isn't showing |

- The core runs with Windows' exploit mitigations on (signed images only, no generated code, no
  child processes, no Win32 window calls) and its crash dumps off; its keys sit in locked memory and
  are wiped on drop (`zeroize`, `secrecy`).
- The interface asks the core for one field at a time and gets only that field; the most sensitive
  (a worker's SSN, bank details, W-4) arrive only on "Reveal", after Windows Hello or a phone approval.
- The whole app is packaged per machine and signed (MSIX with an app sandbox later), the window is
  excluded from screen capture and Recall (`SetWindowDisplayAffinity`, with a switch for screen
  sharing), the books lock on sleep, lock screen and remote sessions, and nothing is written to the
  clipboard that the person didn't copy.
- Not planned: a virtualization-based enclave for the key (it protects the key, not what's on
  screen, and needs signing infrastructure Hewn doesn't have yet).

## 3. Payments: the computer proves, the phone decides

The most valuable attack on a payroll app is not reading the books but changing where the money
goes. So:

- **Every payment is proved before Shield is asked.** The core recomputes the worker's agreement pair
  tag from the stored agreement and both accounts and requires `employer_agreement_v5`'s
  `pair_status` to be active, so a payment can only go to the address the chain says is the other
  side of a live agreement. Editing the books can't redirect it.
- **A run shows what changed** since the last one (a new payee, a changed address or amount) before
  anything is sent, and a first payment to a new payee waits for a second confirmation.
- **"Already paid for this period?"** is checked against the chain before each payment.
- **The phone is the authority.** The desktop's review is informational; Shield's approval is what
  counts, and the design never asks the person to trust a desktop screen over the phone. A short code
  shown on both, so the person can see they are approving the same thing, is a question for
  Provable.
- **Payee receipts:** the worker's app acknowledges a paycheck, and the business sees "no receipt
  after 48 hours", closing the loop outside the payer's computer.

## 4. One way out to the network

- **One module** lists every host the app may reach (the explorer, Shield's relay, the release
  address) and nothing else connects; a test fails on any other host. No telemetry, no font or
  image from anywhere else. A link the person clicks opens in their browser only from an
  allowlist, after a confirmation.
- **One TLS policy** for every Rust client: TLS 1.3 only, no redirects, JSON only with size caps,
  post-quantum hybrid key exchange (X25519MLKEM768) where the server offers it, from the network
  process only (its C build stays out of the core). The operating system's certificates stay trusted
  so accountants on managed networks can work; certificate pinning to Cloudflare- or GitHub-fronted
  hosts is not planned (it breaks on their rotations).
- **Chain data is checked, not believed:** transaction ids are recomputed from what the explorer sends
  (as the verifier does today), a name's address is remembered the first time it's looked up and a
  change is flagged, editions are checked once per run, and immutable chain data is cached. A
  "verify mode" compares a second source or the business's own node.
- **What the explorer learns:** its operators (Cloudflare, Google's load balancer, Provable) see which
  addresses and transactions an app asks about. Caching and fetching broadly then filtering locally
  reduce it; Tor (through Arti) is a later option. Provable sees who uses Shield and when through the
  relay and Shield itself; Hewn can't change that.
- Not planned: cover traffic (cost without a matching gain against the parties that matter).

## 5. Releases: more than one key, and anchored

- **Building:** the Rust toolchain pinned by version and hash in every workflow; every action pinned
  by commit; dependencies vendored and built with no network; a Rust advisory scan (RustSec) on every
  pull request and weekly, with skips that need a reason; `cargo-vet` importing the audits Mozilla,
  Google, the Bytecode Alliance and Zcash publish; the seven-day rule (OPS-04) and the GPUI source
  check, extended to the snapshots' manifests.
- **Proving the build:** reproducible binaries, rebuilt on a second machine and compared before
  signing; GitHub's artifact attestations.
- **Signing:** on a machine that never builds, with keys on hardware. One release signature format,
  version 2: Ed25519 and SLH-DSA (post-quantum, a 32-byte public key) both required, an expiry of
  30–60 days, and a floor below which no older release installs.
- **More than one key:** a second person holds a key that can only veto a release, never make one,
  since one maintainer holds every other key today.
- **Anchored and delayed:** the app installs an update only after its hash is anchored on Aleo and a
  waiting period has passed, so a bad release can be seen and stopped. An on-chain release log needs
  a new Leo program: it will be announced before any work starts (INV-22).
- **Installers:** signed (Azure Artifact Signing), per machine, from one download page with the
  checksums and the verifier. No unsigned build is shared publicly.
- **Old versions:** a signed, anchored minimum version below which the app still opens the books but
  won't ask Shield to sign.

## 6. The books and personal data

- **One format, two implementations, proved equal.** A written specification of the vault format,
  with test vectors run both ways in CI (the web app writes, the Rust core reads, and the reverse).
  The Rust crate is the reference; the web keeps WebCrypto's keys that page scripts can use but not
  export, and uses WebAssembly only for Argon2id and ML-KEM. This follows the way large rewrites are
  proved in practice: the existing implementation is the oracle, and differences are compared by
  their shape, never by their content.
- **Vault v2, reader first:** a version that can read the new format ships before any release
  writes it, so other devices and backups keep working. It adds a protected header, a generation
  counter (so an older copy is detected), a list of key slots and padding.
- **A memory-hard key:** Argon2id (64 MiB, 3 passes, capped) in place of PBKDF2, re-wrapping the data
  key on unlock, never re-encrypting the books. INV-07's wording changes in a pull request about the
  rule when it lands.
- **A second secret, not only a slower first one:** on the device, a slot that needs the computer's
  TPM and Windows Hello (or a passkey on the web); copies that leave the device carry the recovery
  key's slot, not the passphrase's alone. A copied file then can't be guessed at offline.
- **Keys that change:** the data key rotates on a passphrase change, a recovery reset, a forgotten
  session and a member's removal, each starting a new backup chain, so one stolen copy doesn't read
  every later backup.
- **Sealed fields** with their own keys: the view key, and every SSN, bank account and W-4 only ever
  in that form.
- **Exports encrypted by default**, with a plain export behind a clear warning.
- **Sharing with an accountant later:** a key per person, sections scoped to what they need, signed
  writes, and removal by rotating keys.
- Not planned: a decoy vault (legal risk for an employer); a panic lock instead.

## 7. Post-quantum: where Hewn stands

| What | Today | Plan |
|---|---|---|
| The vault, backup files, the recovery code | AES-256, HKDF, a 128-bit code: quantum-safe | Argon2id for its own sake |
| Period roots, anchors, lookups | Hashes only (BLAKE3, HMAC, SHA-256): safe | — |
| Letters (paystubs, W-4s, offers) | Elliptic-curve: can be harvested now, read later | Hybrid ML-KEM-768 inner lock before any SSN travels on mainnet |
| Rust TLS | No post-quantum exchange | X25519MLKEM768 in the network process |
| Releases and updates | Ed25519, minisign: forgeable later | Release signature v2 (Ed25519 + SLH-DSA) |
| Shield's relay | secp256k1: harvestable | A request to Provable (below); Hewn can't fix it alone |
| Aleo records, accounts, proofs; USDCx's compliance records | Elliptic-curve, out of Hewn's control | Put as little on chain as possible; follow Aleo's own plan (none published that we found) |

Every format carries a version, so an algorithm can be swapped without a migration of its own.

## 8. What this can't fix

- Malware running as the person while the books are open can see the screen and try to talk them into
  an approval; with administrator rights it can do more. The phone approval is the backstop.
- A fake app can claim Hewn's name and origin to Shield until Shield can verify an app (section 9).
- Whoever holds the release keys is still the root of trust; anchoring and the veto key make that
  visible and checkable, not absent.
- What is already on chain stays there, under Aleo's cryptography.

## 9. Questions for Provable

1. Does Shield prompt the person for decrypt, records and history requests under a permission
   already granted, or answer silently?
2. Can Shield label a declared origin "not verified", and verify an app through its signed, anchored
   releases?
3. A short code shown on both the app and Shield for each approval; a warning for a first payment to
   a new address; a biometric check per transfer.
4. Who may publish to a relay channel, and how long its history is kept?
5. A relay version that mixes the pairing secret into every message key (it never crosses the
   network), and a hybrid post-quantum handshake.
6. How long the explorer keeps request logs, and whether `latest_edition` answers are cached at the
   edge.
7. Who holds USDCx's compliance key, which sees every private transfer.

## 10. Decisions for Joshua

1. GPUI without gpui-kit, and the in-house trusted path (section 1).
2. Copies that leave the device need the recovery key, not the passphrase alone (businesses keep a
   recovery kit).
3. The pay-run change screen, the first-payee hold and payee receipts (screens).
4. Who could hold the veto key for releases.
5. A separate GitHub identity on a clean device with a hardware key for approving, and production
   deployments behind a second login.
6. Screen-capture protection on by default for businesses, with a switch for sharing.
7. Whether the TPM and Windows Hello slot is the default on the desktop or a choice.

## 11. The checklist

Each item is a pull request of its own; the test is what proves it.

| # | Item | Test |
|---|---|---|
| 1 | Drop gpui-kit; depend on `gpui-pre` directly | The window builds; the lockfile has no `gpui-kit` or `gpui-base` |
| 2 | Source check covers the snapshots' manifests | A test snapshot with an added dependency fails |
| 3 | Rust advisory scan in CI and weekly | A test lockfile with a known advisory fails |
| 4 | Toolchain and actions pinned | A check fails on `stable` or a tag-pinned action |
| 5 | `#![forbid(unsafe_code)]` and accessibility roles in our crates | Build; an accessibility tree test |
| 6 | The network module and its allowlist | A request to any other host fails in a test |
| 7 | TLS policy in the network process | Tests refuse TLS 1.2, a redirect, a non-JSON or oversized reply |
| 8 | Transaction ids recomputed; names remembered | A changed transaction or a changed name's address is refused or flagged |
| 9 | The pair-tag proof before each payment | A payment to an address with no active agreement is refused |
| 10 | Vault spec and vectors both ways | The web's vectors open in Rust and the reverse; one changed byte fails |
| 11 | Vault v2 reader, then Argon2id | Old and new formats open; a copy older than the generation counter is flagged |
| 12 | Device slot (TPM + Hello) | The vault doesn't open from a copied file on another machine |
| 13 | Data-key rotation on the four triggers | A copy from before a rotation can't read a backup after it |
| 14 | Sealed fields | The interface process never receives an SSN it didn't reveal (a test of the core's replies) |
| 15 | Three processes | The interface and network processes hold no key (a memory test after unlock) |
| 16 | Trusted-path screens | Capture of the window returns nothing; the passphrase buffer is zero after use |
| 17 | Release signature v2 with expiry and floor | An expired, older-than-floor or single-signature release is refused |
| 18 | Reproducible build and second-machine compare | Two builds give the same hashes |
| 19 | Hybrid letters | A letter sealed with both halves opens; with either half altered it doesn't |
