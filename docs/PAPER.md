---
status: review
updated: 2026-11-09
summary: The technical paper, v1.0 draft for hewnaccounting.com/paper: private payroll and provable books on Aleo, the twin-curve math behind every conversation, what is public, the honest limits, and what is live.
---

# Hewn: private payroll and provable books on Aleo

**A technical paper · v1.0 (draft, November 2026) · testnet**

*Honest books, grounded and true.*

## Abstract

Hewn is free, open-source bookkeeping and payroll for small businesses. It keeps a business's books
encrypted on its own device, pays its people in a stablecoin through private transfers on Aleo, and
carries every document between people (offers, paystubs, invoices, messages) as sealed records on
the chain itself. No server ever holds anyone's data, and no wage, name or amount is ever public.

Two pieces of cryptography do most of the work. **Twin-curve math** keeps every conversation
between two parties readable by those two alone: Aleo's own curve seals each letter to its
recipient, and a P-256 key exchange seals what's inside to a key only the two of them can make.
**Period roots** make the books provable without exposing them: when a business closes a period, one
32-byte fingerprint of every entry goes on chain, and anyone the business gives the period's proof to
can recompute it and check it against the chain.

This paper describes both, everything built on them, exactly what the chain can see, and the limits
we haven't solved. It describes what runs on Aleo's testnet today; the last sections say what is
live, what is planned, and what stands between here and mainnet.

## 1. The problem

A small business's books hold the most sensitive numbers in several people's lives: what each
person is paid, what was withheld, who they are and where they live. Two kinds of software hold
those numbers today, and both fail someone.

- **Hosted bookkeeping** keeps every business's books in one company's database. The company can
  read them, a breach exposes all of them at once, and the business rents access to its own
  records.
- **Public blockchains** fix custody and break privacy. Pay someone on a transparent chain and
  their wage, and every wage after it, is public for good, along with who paid it.

What a business needs is the opposite of both: books that only it can read, payments that only
the two parties can see, and still a way to prove to an accountant, a lender or an auditor that the
books are complete and unchanged. That last part is what usually forces a choice between privacy and
trust. Hewn's position is that zero-knowledge chains remove the choice.

## 2. Principles

Every design decision in Hewn answers to a short list of rules. Each carries an id in the
repository (`docs/INVARIANTS.md`), with the check in CI that enforces it.

1. **Anything tied to a person is private in every mode,** and can never be made public: wages,
   withholdings, tax forms, bank details, paystubs, addresses (INV-01).
2. **No private data on any server, ever.** No database. Plaintext lives in the browser session
   only (INV-02).
3. **The public chain holds only hashes, commitments and block heights,** never an amount, a name, a
   memo or an identity (INV-03).
4. **Every write to the chain is signed in the user's own wallet,** which shows what is being
   signed (INV-11).
5. **Deployed programs are immutable.** A change ships as a new version, with a migration note
   (INV-20).

The rest of this paper is how those five hold at once.

## 3. Architecture

Three places hold anything, and each is trusted for exactly one thing.

| Where | What it holds | Trusted for |
|---|---|---|
| **The device** | The books: an encrypted vault in the browser (IndexedDB), opened with a username and passphrase | Everything private. If the device is compromised, the attacker sees what the user sees, and nothing more |
| **The wallet (Shield)** | The Aleo account's keys | Signing. Every on-chain write is a transaction the person approves in Shield |
| **The chain (Aleo)** | Encrypted records, hashes, block heights | Ordering and permanence. Never contents |

There is no fourth place. The web host serves the app's code and nothing else: no API sees
plaintext, so a breached host could serve bad code (a threat the app answers with a strict content
security policy and pinned, reviewed dependencies) but could not leak stored books, because there
are none.

**The vault.** A random AES-256-GCM key encrypts the books. The unlock secret, the username and the
passphrase together, only wraps that key (PBKDF2-SHA256, 600,000 rounds), so a recovery key or a
wallet unlock can add another wrapped copy without re-encrypting anything. The key is never stored
in plaintext; a lost passphrase is replaced only with the recovery key, if one was made. There is no
account on any server to reset.

**The journal.** Every entry is hashed (BLAKE3 over a fixed canonical form) together with the hash
of the entry before it, so the books are a hash chain: an edit anywhere in the past changes every
hash after it. A posted entry is never changed; a correction is a new entry that reverses it.

**The chain side is optional code.** The ledger, the vault, the reports and payroll never import
any chain package (a test in CI fails if they do). Chain code lives in one folder and loads only on
the pages that need it, so the books keep working offline.

## 4. Twin-curve math

Every exchange between two parties in Hewn (an application to a job, an offer, a paystub, an
invoice, a message) travels as a **letter**: a record on Aleo, carried by a small program with no public state
(`hewn_letters_v2.aleo`). A letter has two locks, made on two different elliptic curves. We call
the pair **twin-curve math**.

It is not pairing-based cryptography (a different thing, which Aleo's proofs use internally), and
the two layers don't strengthen each other. They do two different jobs.

It is also not **Dual_EC_DRBG**, the "dual elliptic curve" random-number generator that NIST
standardised in 2006 and withdrew in 2014 after its backdoor came to light. That design used two
fixed points on one curve, with a hidden relationship between them that let whoever knew it
predict the output. Twin-curve math is not a random-number generator and has no second point. It
is two standard, public constructions on two different curves, Aleo's record encryption and an
ECDH key agreement on P-256, with every key made on the person's own device and nothing hidden
in the construction. Hewn's randomness comes from the browser's own generator
(`crypto.getRandomValues`), the same source as the vault's keys. The two share a word, not a
design.

### 4.1 Two curves, two jobs

**The twin that seals: Aleo's curve.** Every Aleo record is encrypted to its owner on Aleo's
Edwards curve (over BLS12-377). The sender picks a random scalar *r* and publishes *r·G* with the
record. The shared secret is *r* times the owner's address; only the owner can rebuild it, as their
view key times *r·G*. Anyone can store a record, and the network does; only its owner can open it.
The wallet already finds and decrypts the records its account owns. This is the letter's **outer
lock**, and it is the chain's own: Hewn adds nothing to it.

**The twin that introduces: P-256.** Two people who have never shared a key each make a key pair in
their browser's own Web Crypto, on the NIST P-256 curve. Each combines their private key with the
other's public key (elliptic-curve Diffie-Hellman) and both arrive at the same secret, without it
ever travelling. HKDF-SHA256 turns that secret into the pair's key. This is the letter's **inner
lock**: the envelope.

Both curves rest on the same one-way step. Going from a private key *k* to *k·G* is easy; going
back is practically impossible.

### 4.2 The letter

```leo
record Letter     { owner: address, lookup: [u128; 2], parcel: [field; 34] }
record SentLetter { owner: address, lookup: [u128; 2], parcel: [field; 34] }

fn send(to: address, lookup: [u128; 2], parcel: [field; 34]) -> (Letter, SentLetter)
```

`send` outputs one record owned by the recipient and one owned by the sender, so the sender keeps a
copy that follows its account to any device. There is no mapping, no finalize step and no public
state: the program records nothing about who wrote to whom. `send_many` delivers one letter to up
to eight accounts in one approval, and `send_page` carries a long document (an offer's full terms)
as one larger record. A letter costs about 0.0066 ALEO on testnet.

**The envelope inside** is the same for every kind of document:

```
key(kind)         = HKDF-SHA256(ikm = pair key, salt = "PNW::MAILBOX::v1", info = kind)  → AES-256-GCM
lookup(kind, seq) = BLAKE3("PNW::MAILBOX::LOOKUP::v1" ‖ 0x00 ‖ pair key ‖ kind ‖ u32(seq))
envelope          = 0x01 ‖ iv(12) ‖ AES-256-GCM(payload, associated data = lookup)
```

- **Each kind of document has its own key,** derived from the pair key, so a paystub's key can't
  open a message.
- **The lookup** is how two parties find their letters: a hash only they can compute, carried
  inside the private record. Each side reads its slots in order, and binding the lookup into the
  cipher's associated data means a document can't be replayed as another kind or in another slot.
- **Every letter is padded to the same 1,054 bytes,** 34 fields of 31 bytes. Ciphertext lengths are
  public; fixed-size letters leak nothing about how long a message is.

### 4.3 Who a letter is from

Knowing a key isn't proof of identity. Everyone in an announcement channel holds that channel's
key, and an auditor shown a view key can find some keys too (4.6). So every letter is believed only
from its **sender**.

Since Aleo's consensus version 8, every output record carries a *sender ciphertext* that only its
owner can open. Hewn reads it for every letter and keeps a letter only when its sender is the
account the conversation expects: the other side of a conversation, the business for a channel
post, the organizer for an event, the owner of the registered name an application claims. A letter
from anyone else is counted and dropped. When the wallet gives no sender at all, the app stops and
says so rather than guessing.

### 4.4 Where every key comes from

The outer lock is always the chain's. The inner lock's key depends on who the two parties are. Each
relationship in Hewn makes it its own way, and each derivation carries its own label, so a key made
for one purpose can never be mistaken for another's.

| Who | How their key is made | Label |
|---|---|---|
| **An applicant and a business** | The business makes a P-256 *hiring key* for each job posting; its public half rides in the posting on the public job board, its private half stays in the business's vault. The applicant makes a one-time key pair, derives the key from it and the hiring key, and sends one letter: the one-time public half in the clear, the application sealed under the new key. The business derives the same key from its private half. | `PNW::APPLICATION::v1`, info = posting id ‖ both public halves |
| **A business and a person it hires** | Each side makes a P-256 half when the agreement is made: the employer's rides in the offer record, the worker's in the acceptance, and both sit in every copy of the final agreement (`employer_agreement_v5`). Each side derives the pair's key from its own private half and the other's public one. | `PNW::PAIR::v1`, salt = the agreement's random parties key |
| **Coworkers** | Each person makes one P-256 key pair per business, on their own device. The business passes its people's public halves around as a directory, in letters. Any two derive a key between them. | `PNW::COWORKER::v1`, info = both public halves |
| **A business and a customer** | Each side sends a *hello*: a letter to the other's account holding its registered name and a fresh P-256 public half, nothing secret. A hello counts only when its sender is an account the registry gives the right kind of name, and the name shown is always the registry's. Once both hellos are in, each side derives the key. | `PNW::CLIENT::v1` |
| **A team's announcement channel** | The business makes a random channel key and sends it to each member inside the conversation the two already share. Posts are sealed with the channel key and sent to everyone through `send_many`. Every member can read; only posts whose sender is the business are kept. | (a random key, delivered under the pair keys above) |
| **An event's guests** | The organizer keeps a random key for its invitations and sends it to each guest inside their existing conversation. Each guest on the shared list is tagged by a one-way value from the key that guest shares with the organizer, so each finds their own row and nobody works back to a key. | (a random key; tags are `lookup(key, "event_who", 0)`) |

Two things hold across the whole table. **Private halves never leave the vault that made them.**
And **every key is salted or labelled for its one use**: a coworker key can't be passed off as a
customer key, and a hired pair's key is tied to their one agreement by its random parties key.

### 4.5 The hired pair: closing the last gap

The relationship between a business and the person it hires carries the most sensitive letters
Hewn sends: paystubs, timesheets, the keys to announcement channels and events, the coworker
directory. It was also, in the first version, the one relationship that didn't use key exchange.

In `employer_agreement_v4`, the pair shared a random *parties key* carried inside the agreement
record. That record is sealed to each party, so the key was private; but anyone given either party's
view key could open the record, take the key, and read every letter. The fix had two steps, and both
are built:

1. **A handshake over letters** (October 23, 2026). Each side makes a fresh P-256 half and sends it
   on the next message it was going to send anyway: one more field, no extra letter, no extra
   approval. The answering side's message travels sealed under the new key, so even the answer is
   closed to a view key. From then on, everything between them goes under the derived key, and the
   agreement's key opens nothing new.
2. **The halves in the agreement itself** (`employer_agreement_v5`, deployed October 24, 2026).
   The offer carries the employer's public half and the acceptance the worker's, so the very first
   letter after acceptance is already under a key no view key reaches. The offer's terms and any
   negotiation before acceptance still travel under the parties key; after that, it's twin-curve all
   the way.

Old keys stay in each vault, so a conversation's whole history stays readable on that device, and
a side running an older app that never sends a half simply never switches: nothing breaks.

**Backups both people agree to.** After the switch, the private halves live only in the two vaults.
If one person loses their books without a backup, they lose that conversation's history from the
switch on. A backup on chain fixes that but puts the conversation's key in one more place, and that
key opens both people's letters. So a conversation is backed up only when **both** agree: either
side asks, the other answers Allow or Decline, and on Allow each side writes its own backup letter,
sealed to its own account *and* under a key from its own passphrase, so a view key alone can't open
it. Then the conversation's keys refresh, riding on letters already being sent, so the backup covers
the conversation only up to that point.

### 4.6 What a view key opens

An Aleo view key decrypts every record an account owns, forever; it can't be scoped or time-limited.
So the question that matters for any privacy design on Aleo is what a view key opens. For Hewn's
letters:

| Holder | What they can see |
|---|---|
| **Anyone** | That `hewn_letters_v2.aleo/send` ran in some block, created two records of a fixed size, and paid a fee. Not the sender, not the recipient (record owners are encrypted), not the contents |
| **A person's view key** (an auditor, a scanning service) | That their letters exist, and their lookups. The public halves. Between a business and a person it hired on the old agreement, the letters from before their handshake. **Nothing sealed under a key-exchange key:** not applications, coworker chats, customer conversations, or anything a hired pair sent after the switch |
| **A backup letter's owner** | Their own backed-up history, with their wallet *and* their passphrase |

That table is the whole point of the second curve. The chain's lock is as strong as any record on
Aleo; the second lock means that handing someone your view key, the one way Aleo offers to share
visibility, doesn't hand them your conversations.

### 4.7 What twin-curve math doesn't do

- **It doesn't hide that a letter was sent.** The chain shows a `send` ran. On testnet, Shield's
  sponsor pays the fee publicly, so the fee names the sponsor's account rather than the sender's; a
  sender paying a public fee themselves would show their address.
- **It doesn't make the curves quantum-safe.** Everything on chain stays forever, and a large
  enough quantum computer would break both curves, Aleo's records included. Twin-curve math adds no
  new exposure there; a post-quantum layer can be added to the inner lock once browsers offer one.
- **It doesn't protect a compromised device.** Keys live in the vault; malware that can read the
  unlocked vault can read the conversations, as it could read the books.

## 5. Agreements on chain

An employment agreement is the one relationship Hewn writes to the chain as a contract:
`employer_agreement_v5.aleo`. Its design goal is that **nothing public names the two parties**.

- **The records are private.** An offer is a `PendingAgreement` owned by the worker; acceptance
  turns it into a `FinalAgreement`, one copy each. They carry the terms' hashes and the two P-256
  halves.
- **No public link between the parties.** v4 checked name ownership through the registry inside the
  transaction, which put both names' hashes and both accounts in public inputs. v5 calls nothing:
  the offer binds the signer as the employer inside the record; accepting takes the worker's own
  record and checks the worker's address against the signer; every later step takes the holder's
  own record and checks the caller's role inside it. The only public values are the agreement id
  and a **pair tag**.
- **The pair tag** is one hash (BHP1024) over the agreement's random parties key and the two
  accounts. The agreement's status is kept under it, so another program can prove *"the caller holds
  an active agreement with this person"* from private inputs alone, without either name appearing.
  `hewn_credentials_v1` uses it: a business can vouch for a person only if it has an agreement with
  them, and the chain records only a commitment to the credential and its status.
- **Two parties, no third.** No platform copy, no administrator powers; resuming or ending by mutual
  agreement takes both approvals.

## 6. Payroll

Hewn computes gross pay, withholding and net pay on the device, from each person's timecard
(overtime, callouts and on-call days included), using a tax engine that runs in the browser. Then:

- **Each person is paid by one private transfer** of USDCx, a stablecoin, from the business's
  Shield account to theirs. A private transfer on Aleo consumes the sender's records and creates
  the recipient's; the amount, the sender and the recipient are all encrypted.
- **Every transfer proves the sender isn't on the stablecoin's freeze list** with a Merkle exclusion
  proof (Sealance, Poseidon4, depth 16), built on the device once per pay run.
- **A payment is never sent twice.** Pay runs go through a queue that survives reloads; a payment
  whose outcome isn't known is never retried on its own, and the business's books block an exact
  repeat.
- **The paystub travels as a letter,** under the hired pair's key, and its hash is written into the
  payroll entry in the journal, so the books commit to the exact paystub each person received.

There are no public receipts. The first version of the stack (April 2026) minted receipt records
and per-payment anchors on chain, and the first end-to-end private payroll ran that way on testnet.
Hewn replaced it with the design above: one transfer per person, one letter, and proof at the level
of the period rather than the payment (section 7).

## 7. Proof without exposure

Private books are only half of what a business needs. The other half is being able to show an
accountant, a lender or an auditor that the books are complete and haven't been changed, without
publishing them. Hewn does this with a **period root**.

### 7.1 The period root

When a business closes a range of its books (a month, a quarter, any range ending before today),
the app computes one 32-byte root over two lists: the range's journal entries, and its
**settlements**, which tie each on-chain payment to the entry it paid.

```
salt(x)        = HMAC-SHA256(anchor_secret, x)
entry_leaf     = H("HEWN::LEAF::v1",      salt(entry.hash), entry.hash)
recipient_tag  = H("HEWN::RECIPIENT::v1", salt(entry.hash), recipient)
settle_leaf    = H("HEWN::SETTLE::v1",    salt(entry.hash ":" tx_id), entry.hash, tx_id, recipient_tag)
business_tag   = HMAC-SHA256(anchor_secret, "HEWN::BUSINESS::v1")
root           = H("HEWN::PERIOD::v1", business_tag, period_id, n, m, prev_root,
                   chain_head, entries.root, settlements.root)

H(domain, ...fields) = BLAKE3(domain ‖ 0x00 ‖ for each field: u32 length ‖ bytes)
```

- **Salted leaves.** A wage entry has a predictable shape and a small space of amounts; without
  salts, a hash handed over as part of someone else's proof could be guessed. The salts come from
  one random secret kept in the books, so a proof reveals only the salts it needs.
- **The counts *n* and *m* are inside the root,** so a duplicated last leaf can't pass for a real
  one.
- **`prev_root` chains each close to the one before,** so anchoring this month also vouches for
  every month before it.
- **`chain_head` is the range's last entry hash,** tying the root to the journal's own hash chain.
- **`business_tag` is a salted commitment to the business,** so roots from two businesses can't be
  confused and the root itself names nobody.

### 7.2 The anchor

Closing asks Shield to sign one transaction: `payroll_audit_log::anchor_event(root)`. The program
records the block height at which the hash first appeared and refuses the same hash twice. That is
everything the chain learns: one 32-byte hash, and a block height. One tap closes a month, however
many paychecks it held. A closed range refuses new entries; it can be reopened until it is locked,
and the old root stays on chain with the new one beside it.

### 7.3 The proof, and checking it

From any close, the business can export the **period proof**: one file holding every entry of the
range in full with its salt, every settlement with its salts, the business tag, the previous root,
and the history of the range's closes. It never contains the secret.

Anyone can check one at **hewnaccounting.com/verify**, with no account. The page reads the file on
their own device and never uploads it. It checks that:

1. every entry hashes to its recorded hash, so none was altered;
2. every entry is dated in the range and in journal order;
3. everything recomputes to the period's root, so nothing was added or removed;
4. the root is recorded in `payroll_audit_log`, so the business really did anchor it;
5. the block it landed in came after the range ended;
6. every payment's transaction exists on chain.

The only things it looks up are the root and the transaction ids, both already public. Every line
passes or says what failed.

### 7.4 The limit of a period proof

A period proof proves the books are complete. It can't, on its own, prove that **no payment was made
outside them**. Only the account's full view key shows that, and Aleo view keys aren't
time-limited: handing one over reveals the account's whole history, forever. So full view keys are
for formal audits only, through `audit_nft.aleo`'s dual-consent authorization. Hewn's rule that a
Shield account holds only one kind of account (a business's or a person's, never both) means a
business's view key exposes no one's personal finances.

## 8. What is public, exactly

| Program | What the chain shows |
|---|---|
| `hewn_letters_v2` | That a letter was sent, its fixed size, and the fee. Nothing else |
| `employer_agreement_v5` | An agreement id, a pair tag, a status and a block height. No names, no accounts, no terms |
| `pnw_name_registry_v2`, `pnw_name_registrar_v5` | Registered names and the accounts they point to. A name is public by design: it's how people find each other |
| `hewn_jobs_v1` | Job postings: the business's name, the pay range if given, the hours, how to apply. Public by design |
| `hewn_cards_v1` | Per name, the block a card was issued and whether it is shown |
| `hewn_credentials_v1` | A commitment to each credential, its status and its issue height. Not who issued it or to whom |
| `payroll_audit_log` | Period roots and the block each first appeared at |
| The stablecoin's `transfer_private` | That a private transfer ran. Not the amount, the sender or the recipient |

And by rule, there are no cumulative counters in any public mapping: a running total, read twice,
leaks the difference. Every public mapping in Hewn's programs is listed, with what it reveals, in
`pnw_mvp_v2/docs/PUBLIC_STATE.md`, which CI keeps in step with the programs.

## 9. Threats, and the limits we haven't solved

Hewn keeps a living threat model (`docs/THREAT_MODEL.md`, threats T1 to T20), each threat tied to
the rules and the checks that answer it. Some limits are honest trade-offs rather than open bugs,
and belong in plain view:

- **The stablecoin's compliance copy.** USDCx sends a compliance record of every private transfer to
  its issuer's investigator address. That is outside Hewn's control.
- **The change record.** A payment's transition view key, given to an auditor or a worker to prove a
  payment, also shows how much was left in the coin it was paid from: business information, not
  anyone's wage. Paying from an exact-amount coin avoids it, and the pay planner prefers exact fits.
- **View keys are forever.** There is no way on Aleo to share visibility for a month. That is why
  Hewn's proofs are built to need view keys as rarely as possible.
- **The fee payer is public.** A public fee shows the payer's address. On testnet, Shield's sponsor
  pays; private fees, which hide the payer, currently fail in Shield on testnet.
- **A compromised device sees what the user sees.** The browser is trusted by design.
- **Offline guessing of a stolen vault.** A copied vault can be guessed at with no lockout, so new
  passphrases must be at least 12 characters with a symbol or space, common passwords are refused,
  and PBKDF2 runs 600,000 rounds. A memory-hard function (Argon2id) is planned.
- **Quantum computers,** for both curves and for every record on chain (4.7).

## 10. What is live today

Hewn runs on Aleo's **testnet**, at www.hewnaccounting.com. What's built and deployed:

| Piece | Status | Evidence |
|---|---|---|
| Letters (`hewn_letters_v2`) | Live | Deployed `at177xpwtt9kdlffahrrnzdwv335g9lys63auye7zw3gtju09ghxu8q9jlauk` |
| Agreements with twin-curve halves (`employer_agreement_v5`) | Live; every new offer since October 25, 2026 | Deployed `at1pvypp6lknqz7u7rs8af2qc8r5k2wgds7x3sct6xtdjs0t70feu9ssx6j3k` |
| Handshake and agreed backups for hired pairs | Built | `docs/TWIN_CURVE_CONVERSATIONS.md` |
| Applications, coworkers, customers, channels, events | Built, all as letters | `docs/LETTERS.md` |
| Payroll by private USDCx transfer, paystubs as letters | Built | `docs/LETTERS.md`, `packages/rail` |
| Customers with their own accounts, invoices and payment | Built; first customer payment recorded end to end on October 26, 2026 | `docs/CUSTOMERS.md` |
| The public job board (`hewn_jobs_v1`) | Live | Deployed `at1354m4j9wxc9st3ukwcl2082s6429ddgx27kfekz500rpzcne4qqse80q4n` |
| Credentials (`hewn_credentials_v1`) | Live | Deployed `at1fndzrvr79edftn7a8k5shvqcp5ygj4jw4q9qndmwdpu3fa7vluzqu4hauy` |
| Closing a period, its root anchored | Built | `docs/CLOSE_PERIOD.md`; anchors through `payroll_audit_log` |
| The period proof and `/verify` | Built (November 5, 2026) | `docs/AUDIT_DESIGN.md` §4 |

The first end-to-end private payroll ran on testnet on April 10, 2026, on the stack Hewn grew from:
`at1mydsktdsr8pk7d4utzrp6n2rvtgkkpavthukyt4kpdadgyx5lg8sgljea3` (the agreement check),
`at1yphn8n9zejqnnsktuev7rl9vkv8styq00rjpffa0h7rxnccssyyqdk9ltw` (the private transfer),
`at1w86wy80c9sgv0e2ukwlzja4r4km0vkld2tna586t9447q6pjvvrqhuvnw4` (receipts),
`at1jp6mertn92hpn79uak8vdy9t4ha2t0f4fwq877uy6rmjl20g0syqdzygp3` (the audit anchor, block 15,682,094),
`at1d8ht598hqqjgmqfxjwvt0cf47aqafgynzjhazhtreze6j22hzcrq5992r5` (the payroll cycle record).

**Not built yet:** payment view keys inside a proof, and the single-paycheck and worker's-year
proofs; a period-status program to replace `payroll_audit_log`; claims proven in zero knowledge
with a minimum group size, so aggregates ("payroll over $X") can be published without exposing any
one wage.

## 11. The road to mainnet

- **Names under the Aleo Name Service.** `.hewn` names move under ANS as a top-level domain, with a
  registrar that keeps one kind of account to a wallet on chain.
- **No upgradeable programs on mainnet.** Every program `@noupgrade`, or behind a multisig with a
  timelock.
- **A third-party audit** of every program that will hold real money, before it does.
- **The traction counts' privacy floor returns.** On testnet, Hewn's public visitor map shows every
  country with a visitor; before mainnet, a country shows only with five or more.
- **A fresh start.** Mainnet deploys every program new, so the superseded versions testnet still
  reads (the v4 agreements, the first letters program) won't exist there.

## 12. Open source, and how to take part

Hewn is free and open source under the AGPL-3.0, in two repositories: the app
([github.com/PNWBNW/hewn](https://github.com/PNWBNW/hewn)) and the Leo programs
([github.com/PNWBNW/pnw_mvp_v2](https://github.com/PNWBNW/pnw_mvp_v2)). There is no token. A map of
every file and how it connects is at [pnwbnw.github.io/hewn](https://pnwbnw.github.io/hewn).

We're looking for small businesses and teams to run payroll on testnet with us, for developers who
want to work on private, provable software, and for review of everything in this paper: the
cryptography above all. Problems with security go through the repository's private reporting, never
a public issue.

### Where it came from

Hewn has been built on the side, for free, alongside a full-time job. It began in late 2023 as
"I want to learn more about blockchain", with months in Aleo's developer docs. In February 2025 it
became PNW, Proven National Workers: a huge first design, a union-style network for workers with
on-chain payroll, local DAOs, co-ops and bridges to other chains. Building it taught what mattered.
The second version kept two chains; every cut made the core clearer: private, honest payroll. In
January 2026 it started over on Aleo alone, paid in USDCx, wages and identities never public. The
first private payroll ran on testnet on April 10, 2026, during the Aleo Buildathon. In October,
payroll alone wasn't enough: small businesses need their books. The payroll stack became the
foundation of full bookkeeping, and PNW became Hewn. The full story is in the repository's README.

## Appendix A: the labels

Every key and hash in Hewn carries its own label, so no value made for one purpose can be passed
off as another.

| Label | Used for |
|---|---|
| `PNW::MAILBOX::v1`, `PNW::MAILBOX::LOOKUP::v1` | A letter's envelope key and lookup |
| `PNW::APPLICATION::v1` | An application's key and lookup |
| `PNW::PAIR::v1` | A hired pair's key, after the handshake |
| `PNW::COWORKER::v1` | Two coworkers' key |
| `PNW::CLIENT::v1` | A business and a customer's key |
| `PNW::HELLO::v1` | Where a customer connection's hello is found |
| `PNW::GL::ENTRY::v1` | A journal entry's hash |
| `PNW::PAYSTUB::v1` | A paystub's hash, committed in its payroll entry |
| `HEWN::LEAF::v1`, `HEWN::SETTLE::v1`, `HEWN::RECIPIENT::v1`, `HEWN::NODE::v1`, `HEWN::EMPTY::v1`, `HEWN::PERIOD::v1`, `HEWN::BUSINESS::v1` | The period root |

## Appendix B: where to read more

Every claim in this paper points at a document or a file in the repository, and those are the
record if this paper and the code ever disagree.

- `docs/LETTERS.md`: letters, the envelope, channels, events, customers
- `docs/TWIN_CURVE_CONVERSATIONS.md`: the handshake and agreed backups
- `docs/AUDIT_DESIGN.md`: the period root, the anchor, the proofs
- `docs/CLOSE_PERIOD.md`: closing, reopening, locking, the proof file and `/verify`
- `docs/THREAT_MODEL.md` and `docs/INVARIANTS.md`: the threats and the rules
- `docs/security/DATA_FLOW.md`: where each kind of data goes
- `pnw_mvp_v2/docs/PUBLIC_STATE.md`: every public mapping and what it reveals
- `packages/wallet/README.md`: Shield, signing and fees
