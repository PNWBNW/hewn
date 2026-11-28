# @pnw/pair-keys

A conversation's pair key, version 2: the key a business and a person it hired seal their letters
with once their handshake is done, made from **three layers**, each of which an attacker has to
break. The cryptographic core only (2026-11-28, Joshua's go in session): nothing in the app calls
it yet, and every pair made so far stays version 1, made exactly as before by
`apps/business/src/chain/key_ring.ts` (pinned by a fixed answer in its test).

| Layer | What | Holds against |
|---|---|---|
| 1. P-256 ECDH | As in version 1, through WebCrypto | Today's computers |
| 2. ML-KEM-1024 | FIPS 203, its highest level, through `@noble/post-quantum` | A quantum computer (by design) |
| 3. An out-of-band secret | Optional, 32 to 64 bytes, exchanged outside this app and the chain | Whatever breaks later: with it, nothing on chain alone opens a letter |

The plan behind it is the "Letters: three layers" part of `docs/NATIVE_HARDENING.md` (section 7, on
the `docs/native-hardening` branch), which asks for at least 128 bits out of band; this package
refuses anything under 256 bits (32 bytes), as Joshua set for this work on 2026-11-28.

## The format

Versioned and crypto-agile: a version byte, then a list of parts, each tagged with its algorithm
(`src/format.ts`).

```
public half   0x02 | count | (alg | length, 2 bytes big-endian | bytes) × count
ciphertexts   0x02 | count | (alg | length | bytes) × count
```

| Id | Algorithm | In a half | In the ciphertexts |
|---|---|---|---|
| `0x01` | P-256, the uncompressed point | 65 bytes | (none: a key agreement) |
| `0x02` | ML-KEM-1024 | the encapsulation key, 1,568 bytes | the ciphertext, 1,568 bytes |
| `0x03` | **HQC, reserved** | refused: "reserved and not supported yet" | refused |
| `0x04` | **ML-DSA-65, reserved**: the owner's signature over the half | refused: "reserved and not supported yet" | refused |
| other | unknown | refused, naming the id | refused |

Parts come once each, in ascending id order, nothing after the last. A version 2 half carries the
whole suite (P-256 and ML-KEM-1024); an encapsulation key must pass FIPS 203's modulus check
(§7.2) and a P-256 part must be a point on the curve, or the half is refused where it arrives.

**The reserved HQC slot.** HQC is NIST's code-based backup KEM, chosen in 2025 so that a break in
lattice cryptography alone wouldn't open anything; its standard isn't final. When it is, it joins
as id `0x03` in the same list: a half lists it, the answer carries one more ciphertext, the
combiner takes one more secret. No migration of its own: a pair made without it keeps its key.
Ids are never reused.

**The reserved ML-DSA slot.** ML-DSA-65 (FIPS 204) would let a half carry its owner's signature, so
the other side knows the keys came from them. A signature can't be harvested and forged later the way
a ciphertext can be read later, so it only has to arrive before quantum computers do; until then the
half's origin rests on the Aleo transaction that carries it and, where the two parties use it, on the
out-of-band secret, which already rules out anyone in the middle. When it's needed, it joins as id
`0x04`.

A version 1 half is the bare P-256 point (65 bytes, first byte `0x04`), so the first byte tells the
two apart (`versionOf`); a version 1 half where a version 2 one belongs is refused, never guessed.

Sizes, for the wiring: a half is 1,641 bytes, the answer (a half and the ciphertexts) 3,214. Both
are past a letter (1,052 bytes of envelope) and inside one page (`send_page`, 7,934 bytes),
even as base64 (2,188 and 4,288 characters).

## Who encapsulates

The side that answers a start (the **responder**) encapsulates to the starting side's (the
**initiator's**) ML-KEM key, which it already holds when it answers; the ciphertext rides back
with its answer. The handshake stays two messages, as today: the initiator's half goes out with
its start, the responder's half and the ciphertexts with the answer. The responder's own ML-KEM
key travels too (a half is the same whether it starts or answers) and is bound into the
transcript, though a pair encapsulates one way only.

## The combiner

HKDF-SHA256 (RFC 5869), as version 1 uses:

```
ikm  = for each layer used, in this order:  id | length | shared secret
         0x01 P-256 (32 bytes), 0x02 ML-KEM-1024 (32), 0xff out of band (32–64)
info = "PNW::PAIR::v2" | 0x02 | flags (bit 0: out of band used)
         | length | initiator's half | length | responder's half | length | ciphertexts
key  = HKDF-SHA256(salt = the agreement's parties key, ikm, info, 32 bytes)
```

Why HKDF and not X-Wing's SHA3-256 combiner: X-Wing's proof is for X25519 with ML-KEM-768, and it
leaves the ML-KEM ciphertext out on the strength of that pairing. This pair has P-256,
ML-KEM-1024 and an optional third secret, so the conservative generic construction is used:
every secret goes into the extract step (the output stays pseudorandom while any one of them is
unknown), and the whole transcript (both halves, the ciphertexts, the version, whether the third
layer is used) into the expand step, so no part can be swapped or dropped without changing the
key. It is version 1's primitive with version 1's salt, so a port needs nothing new. Version 1
sorts its two halves; version 2 keeps their roles (initiator first), so it isn't symmetric.

## The out-of-band secret

`newOutOfBand()` makes 32 random bytes. They are written two ways, carrying the same 26 symbols of
11 bits: the 256 bits, 8 check bits (SHA-256 of `PNW::OOB::v1` and the secret), then two
Reed–Solomon check symbols over GF(2¹¹).

- **Words** (`outOfBandToWords`): 26 words of the BIP-39 English list, the copy `@pnw/vault` pins
  by its SHA-256. A word may be typed by its first four letters. Twenty-six words is never a valid
  BIP-39 length, so the words can't be taken for, or imported as, a wallet's seed phrase.
- **Code** (`outOfBandToCode`): `PNW-OOB1:` and 58 characters of Crockford base32, every one in a
  QR code's alphanumeric set. Reading forgives case, spaces and dashes, and I, L, O for 1, 1, 0.

The Reed–Solomon symbols give the code distance 3: one or two wrong words, two swapped words, or
one wrong character of the code (a character spans at most two symbols) is always caught, by test
for every single change. Wider damage passes only by chance, about one in 2³⁰.

## Keys and logging

Nothing here logs a key, a secret or a half (INV-06; the boundary test also refuses `console`
and any network call). A half's private part is a P-256 JWK and the 64-byte ML-KEM seed (d ‖ z,
from which the 3,168-byte decapsulation key is remade when needed); it belongs in the vault, like
version 1's. Secret bytes are zeroed once used where JavaScript allows: the arrays this package
holds and the buffers WebCrypto hands back. Strings (the key's hex, the seed's hex, as in
version 1) and the engine's own copies can't be.

## The dependency

`@noble/post-quantum` **0.7.1**, published 2026-08-27, 93 days before it was added (OPS-04 asks
for 7): the newest release at least seven days old on 2026-11-28, and the newest there is. MIT,
pure JavaScript, its three dependencies (`@noble/hashes`, `@noble/curves`, `@noble/ciphers`, all
2.4.0) already in the lockfile. Its README says plainly that it **has not been independently
audited** (its authors audited 0.6.1 themselves, April 2026) and that it doesn't claim
constant-time execution, which no JavaScript can promise. It is checked here against NIST's own
ML-KEM-1024 vectors (ACVP, `fixtures/ml_kem_1024_acvp.json`: key generation, encapsulation,
decapsulation with implicit rejection, the key check). The native client's Rust port can use a
formally verified implementation, as the plan prefers.

## Files

| File | What |
|---|---|
| `src/format.ts` | Versions, algorithm ids, the half and ciphertext encodings, the ML-KEM key check |
| `src/pair_key.ts` | A new half; the responder's `answerPairV2`; the initiator's `completePairV2`; the combiner |
| `src/out_of_band.ts` | The out-of-band secret: its rules, the words, the code |
| `fixtures/pair_keys_v2.json` | Fixed inputs and every intermediate answer (each layer's secret, the combiner's input, the key), and version 1's, for a port to check against; rebuilt and checked by `src/fixture.test.ts` |
| `fixtures/ml_kem_1024_acvp.json` | NIST's ACVP vectors for ML-KEM-1024, trimmed |

## Next

Each its own pull request: the key ring keeping version 2 halves and their ciphertexts (both
versions read); halves and answers travelling as pages; the out-of-band secret's screens (show the
code as a QR code, scan it, or read the words) and its place in the vault; then new pairs made as
version 2.
