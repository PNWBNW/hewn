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

Versioned and crypto-agile: a version byte, the message's kind, then a list of parts, each tagged
with its algorithm (`src/format.ts`). Two messages travel: the initiator's **half** with its start,
the responder's **answer** back.

```
half     0x02 | 0x01 | count | (alg | length, 2 bytes big-endian | bytes) × count
answer   0x02 | 0x02 | count | (alg | length | bytes) × count
```

| Id | Algorithm | In a half (the initiator's) | In an answer (the responder's) |
|---|---|---|---|
| `0x01` | P-256, the uncompressed point | 65 bytes | 65 bytes, a key made for this answer |
| `0x02` | ML-KEM-1024 | the encapsulation key, 1,568 bytes | the ciphertext, 1,568 bytes |
| `0x03` | **HQC, reserved**: the HQC team's current specification, which comes in a package of its own | refused: "reserved and not supported yet" | refused |
| `0x04` | **ML-DSA-65, reserved**: the owner's signature over the half | refused: "reserved and not supported yet" | refused |
| `0x05` | **HQC as published in FIPS 207, reserved** | refused: "reserved and not supported yet" | refused |
| other | unknown | refused, naming the id | refused |

Parts come once each, in ascending id order, nothing after the last, every one of the suite: a
half carries P-256 and ML-KEM-1024, an answer the P-256 point and one ciphertext per KEM. An
encapsulation key must pass FIPS 203's modulus check (§7.2) and a P-256 part must be a point on
the curve, or the message is refused where it arrives. An encapsulation key and a ciphertext are
both 1,568 bytes, so the kind byte is what tells a half from an answer: **an answer that carries an
encapsulation key** (a half where the answer belongs) **is refused**, and so is a half that
carries ciphertexts.

**The reserved HQC slots.** HQC is NIST's code-based backup KEM, chosen in 2025 so that a break in
lattice cryptography alone wouldn't open anything. Id `0x03` is held for HQC as its team specifies
it today, which comes in a package of its own; its standard (FIPS 207) isn't final, and if what is
published differs, it takes id `0x05`, so pairs made with today's HQC keep working. Either joins in
the same list: a half lists its key, the answer carries one more ciphertext, the combiner takes one
more secret. No migration of its own: a pair made without it keeps its key. Ids are never reused.

**The reserved ML-DSA slot.** ML-DSA-65 (FIPS 204) would let a half carry its owner's signature, so
the other side knows the keys came from them. A signature can't be harvested and forged later the way
a ciphertext can be read later, so it only has to arrive before quantum computers do; until then the
half's origin rests on the Aleo transaction that carries it and, where the two parties use it, on the
out-of-band secret, which already rules out anyone in the middle. When it's needed, it joins as id
`0x04`.

A version 1 half is the bare P-256 point (65 bytes, first byte `0x04`), so the first byte tells the
two apart (`versionOf`); a version 1 half where a version 2 one belongs is refused, never guessed.

**Sizes**, measured from a real pairing in `src/sizes.test.ts` against
`apps/business/src/chain/letters.ts`:

| Message | Bytes | As base64 | A letter (1,052 bytes) | Pages (`send_page`, 7,934 bytes) |
|---|---|---|---|---|
| The half | 1,642 | 2,192 characters | too long | 1 |
| The answer | 1,642 | 2,192 characters | too long | 1 |

The answer used to carry the responder's whole half and the ciphertexts, 3,214 bytes; it is now
1,572 bytes shorter.

## Who sends what

The side that starts (the **initiator**) makes a pending pair key and sends its half: its P-256
point and its ML-KEM-1024 encapsulation key. The side that answers (the **responder**) makes a
P-256 key for this answer alone, encapsulates to the initiator's ML-KEM key, which it already
holds, and sends back its answer: its P-256 point and the ciphertext. It sends no KEM key: it never
decapsulates, so a key of its own would travel unused. The handshake stays two messages, as today.

```ts
// The initiator, when it starts: the vault keeps `stored` until the answer comes; `half` travels.
const pending = await PendingPairV2.create();
const stored = pending.toStored();
send(pending.half);

// The responder, when the start arrives: `answer` travels back, `key` is kept, nothing else is.
const { answer, key } = await answerPairV2({ partiesKey, half, outOfBand });

// The initiator, when the answer arrives (from the vault's copy, if the books closed meanwhile),
// then in one vault write: keep the key, remove `stored`.
const pairKey = await (await PendingPairV2.restore(stored)).complete({ partiesKey, answer, outOfBand });
```

The responder's P-256 key is made non-extractable and dropped once the answer is made. The pair's
key is what each side keeps afterwards: the initiator's pending keys are gone once it completes,
so neither side can make the key again from its halves, as version 1 does.

## One answer per pending pair key

An initiator's KEM private keys are used once: a pending pair key opens exactly one answer.
`complete` spends it before anything else, so a second answer, the same one again, or one that
arrives while the first is being opened is refused ("already taken an answer"); its secret bytes
(the P-256 scalar and the ML-KEM seed, and what is made from them on the way) are zeroed when the
call ends, whether it gave a key or refused the answer. A refused answer spends it too: the pairing
starts again. `discard` zeroes it without an answer, for a start that was withdrawn.

Why: the attacks that recover an ML-KEM private key from outside all send many chosen ciphertexts
to the same key and watch how each is handled: decapsulation-failure attacks, and plaintext-checking
attacks, where a side channel or a library's flawed check shows whether a ciphertext decapsulated
as its sender meant. Against a correct implementation they are out of reach; against a flawed one
they can be cheap: ePrint 2026/1682, for one, recovered an ML-KEM-1024 key from one library's
flawed check with a few hundred ciphertexts. The library here is checked against NIST's vectors,
which can't rule out such a flaw; a key that opens one ciphertext gives any such attack one,
whatever the library's flaws, and costs nothing, since a key is made for each pairing anyway.

The object enforces this in memory. A copy the vault keeps while the answer is awaited
(`toStored`, `restore`) could be restored twice, so the key ring must remove it in the same vault
write that keeps the pair's key; that is the next pull request's to do and test.

## The combiner

HKDF-SHA256 (RFC 5869), as version 1 uses:

```
ikm  = for each layer used, in this order:  id | length | shared secret
         0x01 P-256 (32 bytes), 0x02 ML-KEM-1024 (32), 0xff out of band (32–64)
info = "PNW::PAIR::v2" | 0x02 | flags (bit 0: out of band used)
         | length | the initiator's half | length | the responder's answer
key  = HKDF-SHA256(salt = the agreement's parties key, ikm, info, 32 bytes)
```

Everything that travels is in the info, each message whole and in its role: the half first, then
the answer, each beginning with its kind byte, so the two can't trade places, and neither P-256
point, the encapsulation key nor the ciphertext can be swapped or dropped without changing the key
(`src/pair_key.test.ts` alters bytes all through both messages: each is refused or leaves the two
sides with different keys).

Why HKDF and not X-Wing's SHA3-256 combiner: X-Wing's proof is for X25519 with ML-KEM-768, and it
leaves the ML-KEM ciphertext out on the strength of that pairing. This pair has P-256,
ML-KEM-1024 and an optional third secret, so the conservative generic construction is used:
every secret goes into the extract step (the output stays pseudorandom while any one of them is
unknown), and the whole transcript (the half, the answer, the version, whether the third layer is
used) into the expand step, so no part can be swapped or dropped without changing the key. It is
version 1's primitive with version 1's salt, so a port needs nothing new. Version 1 sorts its two
halves; version 2 keeps their roles (initiator first), so it isn't symmetric.

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
and any network call). A pending pair key holds its P-256 scalar and the 64-byte ML-KEM seed
(d ‖ z, from which the 3,168-byte decapsulation key is remade when needed) as bytes, in private
fields; the copy for the vault (`toStored`) is a P-256 JWK and the seed's hex, like version 1's.
Secret bytes are zeroed once used where JavaScript allows: the arrays this package holds and the
buffers WebCrypto hands back (`src/single_use.test.ts` watches every seed, decapsulation key,
shared secret and ECDH result and finds each zeroed once a pairing completes, fails or is
discarded, and once an answer is made). Strings (the key's hex, the vault's copy, the JWK made
for a moment to load the P-256 key) and the engines' own copies can't be.

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
| `src/format.ts` | Versions, kinds, algorithm ids, the half and answer encodings, the ML-KEM key check |
| `src/pair_key.ts` | The initiator's `PendingPairV2` (`create`, `restore`, `half`, `toStored`, `complete` once, `discard`); the responder's `answerPairV2`; the combiner |
| `src/out_of_band.ts` | The out-of-band secret: its rules, the words, the code |
| `src/single_use.test.ts` | The secret bytes zeroed after use, where a test can see them |
| `src/sizes.test.ts` | The half's and the answer's sizes against a letter and a page |
| `fixtures/pair_keys_v2.json` | Fixed inputs and every intermediate answer (each layer's secret, the answer as it travels, the combiner's input, the key), and version 1's, for a port to check against; rebuilt and checked by `src/fixture.test.ts`, which keeps the inputs when it writes the file again |
| `fixtures/ml_kem_1024_acvp.json` | NIST's ACVP vectors for ML-KEM-1024, trimmed |

## Next

Each its own pull request: the key ring keeping a pending pair key until its answer, then the
pair's key in its place in one write (both versions read); halves and answers travelling as pages;
the out-of-band secret's screens (show the code as a QR code, scan it, or read the words) and its
place in the vault; then new pairs made as version 2.
