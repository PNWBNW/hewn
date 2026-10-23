# Letters on chain (`hewn_letters_v1.aleo`): design

Status: **`hewn_letters_v2.aleo` deployed on testnet** (2026-10-18): deploy transaction
`at177xpwtt9kdlffahrrnzdwv335g9lys63auye7zw3gtju09ghxu8q9jlauk` (PNWBNW/pnw_mvp_v2 #204, recorded in
#205), 21.61 credits. It keeps v1's `send` and `send_page` and adds `send_many`: one letter to up to
eight accounts in one approval (0.056052 credits a call). The app sends with v2 and still reads
letters sent with `hewn_letters_v1.aleo` (2026-10-16, `at1pxclare6clej0feuzcncngmwvma44g0hg2ngsh763gltk0rz6qpqgtfqnt`).
Settings has "Send a test letter".

**Everything between people now goes as letters:** offers (one page), messages, counter-offers,
paystubs, timesheets, the coworker directory and coworker chat. Group chats send one letter per
member. Announcements: the channel's key goes to each member in a letter, and each post goes to
everyone through `send_many` (one approval for each eight). Events with guests work the same way
("Shared events" below). The old mailbox is
retired (2026-10-22, `archive/mailbox-api/`): nothing is sent through it or read from it.

**Measured on testnet (2026-10-16, Joshua's phone, Shield):** a letter took 13.6–73.7 s from tap
to accepted (approving and Shield's sponsor step included), cost 0.006578 ALEO, and was listed by
Shield in 0.7–1.0 s, with a sender, and read back word for word. Shield had a **sponsor** pay the
fee publicly, so the fee names Provable's account, not the sender's, and the sender paid nothing.

**Measured at deploy** (Leo's cost summary under consensus V22): `send` costs **0.006578 ALEO**
(6,578 microcredits), `send_page` **0.086886 ALEO**. Deploying cost 14.955 credits (synthesis
9.58, storage 4.37, namespace 1), more than the few credits estimated below.

## The idea in one paragraph

An Aleo record is an encrypted message to its owner: anyone can store it, only the owner's view
key opens it, and the wallet already finds it (that is how paystubs and offers arrive). So a
letter is a record. `send(to, lookup, parcel)` outputs one `Letter` owned by the recipient and one
`SentLetter` owned by the sender. No mapping, no finalize, no public state. The parcel inside is
the same sealed envelope the mailbox carries today (AES-256-GCM under the pair's parties key), so
a letter has two locks: the record's (the owner's view key) and the envelope's (the parties key).
Showing a view key to an auditor reveals that letters exist, and, between a business and a person
it hired, what they say too (see "What the chain shows").

## Twin-curve math

What we call **twin-curve math** (Joshua, 2026-10-20): two elliptic curves, each doing its own
Diffie–Hellman key exchange, one job each. It is not pairing-based cryptography (a different thing,
which Aleo's proofs use), and the two layers don't make each other stronger; they cover different
steps.

- **The first curve introduces.** P-256, in the browser's own Web Crypto. Two people who have
  never shared a key each combine their private key with the other's public key and arrive at the
  same secret, which HKDF-SHA256 turns into the pair's parties key. An applicant reaches a business
  this way (the hiring key in the posting, `chain/applications.ts`), and so do coworkers
  (`chain/coworkers.ts`). A business and the person it hires use a random parties key carried
  inside their agreement records instead (`chain/offer.ts`).
- **Its twin seals.** Aleo's own curve (Edwards BLS12-377) seals every record to its owner: the
  sender picks a random r and publishes r·G with the record; the shared secret is r times the
  owner's address, and only the owner rebuilds it, as their view key times r·G. That is the
  letter's outer lock.

Going from a private key k to k·G is easy; going back is practically impossible. Both curves rest
on that one-way step.

## The program

```leo
program hewn_letters_v1.aleo {
    @noupgrade
    constructor() {}

    // One sealed envelope, padded to a fixed size: 34 fields × 31 bytes = 1,054 bytes.
    record Letter     { owner: address, lookup: [u128; 2], parcel: [field; 34] }
    record SentLetter { owner: address, lookup: [u128; 2], parcel: [field; 34] }

    fn send(to: address, lookup: [u128; 2], parcel: [field; 34]) -> (Letter, SentLetter) {
        let me: address = self.signer; // Leo ≥ 4.4: std::ctx::signer()
        return (
            Letter     { owner: to, lookup: lookup, parcel: parcel },
            SentLetter { owner: me, lookup: lookup, parcel: parcel },
        );
    }
}
```

Why each piece:

- **`send_page` (as built).** A second call carries a long document, such as an offer's terms
  (up to 20,000 characters), as one `Page` of 256 fields (7,936 bytes) to the recipient only; the
  sender keeps its copy in its books. The app picks `send` or `send_page` by size. Both refuse the
  zero address and an all-zero lookup.

- **`@noupgrade` constructor.** Every program deployed after consensus V9 must have a constructor.
  `@noupgrade` makes it immutable, which is right for something this small: a change ships as
  `hewn_letters_v2`.
- **The sender is the signer, not the caller.** For a top-level call they are the same; the
  signer stays right if another program ever calls `send`.
- **Two record names.** The wallet returns `recordName`, so the app tells a received letter from
  its own sent copy without opening either.
- **`lookup` is today's mailbox lookup id** (BLAKE3 of parties key, kind and sequence, 32 bytes as
  two `u128`). The thread code stays as it is: "read slot n" becomes "find the letter whose lookup
  is the id for slot n". Nobody but the owner can see it, because every record entry is private.
- **`parcel: [field; 34]`, always full.** Ciphertext lengths are public, so every letter is padded
  to the same size; nothing leaks how long a message is. `[field; N]` is the most compact private
  encoding: 31 bytes per field, about 1,280 bytes of ciphertext per KB carried, against about 1,400
  for `[u128; N]` and five times that for `[u8; N]`.
- **No `from`.** The chain already carries one: since consensus V8 each output record has a
  *sender ciphertext* only its owner can open (Shield's records already show a `sender` field).
  The app reads every letter against it (2026-10-22, the security review): a letter in a
  conversation counts only when its sender is the other side's account, a channel post only from
  the business, an application only from the account that owns the name it claims, an event only
  from its organizer. Opening with the key isn't enough on its own: everyone in a channel holds its
  key, and an auditor shown a view key can find a hired pair's. When Shield gives no sender at all,
  the check stops and says so rather than guessing.

Negative tests (required for any new program): a parcel of the wrong length, a field out of range,
a malformed address and a non-record input must all be rejected. Positive: `Letter.owner == to`,
`SentLetter.owner == signer`, the parcels are identical.

## What the chain shows

| Who sees | What |
|---|---|
| Everyone | that `hewn_letters_v1.aleo/send` ran in some block; that it created two records; their (fixed) sizes; the fee transition |
| Everyone, **public fee** | the sender's address, through `fee_public` (and so a count of how many letters an address sends) |
| Everyone, **private fee** | only a spent credits record's serial number: nobody |
| The recipient | the letter, the sender's address (sender ciphertext), the parcel's contents (parties key) |
| The sender | its own copy, on any device |
| An auditor given a view key | that letters exist and their lookups. Between a business and a person it hired, the letters from before their handshake too (the same view key opens their agreement record, which carries the parties key), and the public key halves; nothing after it, not even the answer that completes the handshake, whose words are sealed under the new key (2026-10-23, `docs/TWIN_CURVE_CONVERSATIONS.md`). Not a conversation backup: it is sealed with a key from its owner's passphrase too. Not the contents of an application or a coworker chat, whose keys come from key exchange and stay in the vault. Paystubs and timesheets too: after the handshake they go under the pair's key |
| Hewn's wallet (testnet only) | a copy of every agreement, parties key included, but no letters: they are sealed to their recipients. After a pair's handshake, that key opens nothing new. On mainnet, agreements carry no such copy (`employer_agreement_v5`, BUILD_PLAN.md) |

The recipient's address is never shown: record owners are encrypted. So with private fees (the
switch shipped in #79), the public footprint of a letter is "someone sent a Hewn letter at block N".

## Cost and limits

Primary sources: snarkVM `console/network/src/lib.rs`, `synthesizer/process/src/cost.rs` (master,
2026-10-16).

- **Fee:** an execution with no finalize pays storage only: 1 microcredit per byte up to
  5,000 bytes, quadratic above (`size² / 5000`). The parcel is stored three times (the private
  input's ciphertext and both records), about 1.3 KB each, plus the proof: an estimated 4–6 KB
  transaction, **roughly 4,000–7,200 microcredits (0.004–0.007 ALEO) a letter**. A private USDCx
  transfer we measured cost 51,580. Not measured yet for letters.
- **Deploying it:** storage at 1,000 microcredits per byte of program, plus synthesis, plus 1
  credit of namespace (any name of 10+ characters). A few testnet credits.
- **Room:** 16 inputs and 16 outputs a call; 33 entries a record; arrays up to 2,048 elements;
  transactions up to 2.3 MB. Two records of about 1 KB are far inside every limit.
- **Text per letter:** 1,054 bytes, less the envelope (29) and the message JSON (~120): **about 900
  characters**. Today's chat limit is 4,000. Either the limit drops for letters, a long message
  goes as several letters (one approval each), or text is compressed first (the browser's
  `CompressionStream`, roughly halving English). Keep each transaction under 5,000 bytes; a bigger
  parcel crosses into the quadratic fee.
- **Proving time in Shield:** not published anywhere; measure it. `paystub_receipts` already mints
  two records (with a finalize) through Shield, so a two-record proof is known to work there.

## How the app uses it

1. **Sending:** seal the message as today, pad to 1,054 bytes, pack into 34 fields, call `send`
   through `useShield()` (so the fee mode applies). One Shield approval per letter.
2. **Receiving:** `requestRecords("hewn_letters_v1.aleo", true)` returns every letter the account
   owns, with `recordName`, `recordPlaintext`, `spent`, `blockHeight`, `transactionId` and
   `sender`. Match each letter's lookup against the next expected slot of each thread; open with
   the parties key; keep it in the vault. A `LetterBox` with the mailbox client's `put` / `get`
   shape slots in under `chain/thread.ts` and everything above it stays.
3. **What goes away:** receipts (a letter in a block is delivered), the daily sweep, keep-until
   dates, the Pinata (IPFS) dependency for messages.
4. **Shield setup:** the program joins `WALLET_PROGRAMS`; people disconnect and reconnect Hewn in
   Shield once, as with the history permission.

## Reports

A person can report a message they received (Joshua, 2026-10-20; `books/report.ts`,
`chain/report.ts`, `chain/Report.tsx`). The report is an ordinary letter to Hewn's account
(`BRAND.reportsAccount`), so nothing new is deployed:

- **What it carries:** what's wrong (harassment, not really from them, a scam, spam, a threat,
  something else), the reporter's note, the message as received (its id, when it was sent, its
  words) and who sent it as the app names them. Nothing else from the conversation.
- **One lock, not two.** There is no key between a reporter and Hewn, so the parcel is the marker
  `HEWN-REPORT-1` and the report itself; the record, sealed to Hewn's account, is the lock. The
  lookup is SHA-256(`PNW::REPORT::v1` ‖ report id), new for every report. The record's sender says
  who reported, and only Hewn's account can read it.
- **The sender:** a harassment report tells them nothing. Any other kind sends them a
  `report_notice` in the conversation (a second approval), so someone whose account was taken over
  learns it is being used.
- **Email too.** After a report, or instead of one when Shield isn't connected, the app offers to
  email it to `BRAND.supportEmail` or copy it, with the same report id.
- **Reading them:** Settings shows a Reports button only when the books are linked to Hewn's
  account; it reads the reports from Shield each time and keeps nothing.

## Shared events

An event with guests (Joshua, 2026-10-22; `books/shared_events.ts`, `chain/events.ts`). A
business invites people on its team; a person invites their employer and the coworkers listed at
that job, one job per event, so an invitation never ties two employers together. Partner
businesses come with business-to-business agreements, later. Nothing new is deployed:

- **The calendar's key.** Each organizer keeps a random 32-byte key for its invitations (a
  *circle*: one for a business, one per job for a person). A guest gets it once, as an
  `event_key` message in the conversation the two already share, sealed with that conversation's
  key: one letter per new guest.
- **The event.** Each invitation, change or cancellation is one post sealed with the circle's key
  (kind `evt_<epoch>`) into the organizer's next slot, sent to every guest at once through
  `send_many`: one approval for each eight. A change also goes to anyone just taken off the list,
  so they hear it. Part 0 carries who invites, what, when and where (notes up to 500 characters);
  every part carries some of the guest list. A long list takes more parts, all naming the event
  and its revision; a guest's app shows a revision once it has every part.
- **The guest list.** Everyone invited sees it: each guest's name as the organizer shows it,
  their answer as the organizer last knew it, and a tag one-way from the key the guest shares with
  the organizer (`lookupId(key, "event_who", 0)`, 12 hex characters), so each guest finds their own
  row and nobody works back to the key.
- **Answers.** Going, maybe or not going, with an optional note: an `event_answer` in the guest's
  own conversation with the organizer, one letter. A change to what, when or where asks everyone
  again; a change to the guest list alone doesn't.
- **Only the organizer posts.** Every guest holds the circle's key, so a guest could seal a post
  that looks like the organizer's. A reader keeps a post only when its letter's sender, which only
  the reader can see, is the organizer's account (the employer's, a team member's from the
  business's link, or a coworker's from the directory the business passed on). A post with any
  other sender is counted and dropped.
- **Gaps.** A post goes to some guests and not others, so each reader's slots have gaps. A reader
  looks 256 slots past the last post it found, and 8 back in case the wallet listed a later letter
  first; keeping a post twice changes nothing.

## What doesn't fit, and the open questions

- **A Shield approval per send.** Fine for offers, counter-offers, announcements; heavier for
  rapid chat. Shield has no "sign without paying" or batch API (adaptor 0.3.0-alpha.3 and upstream
  master), so fee sponsorship and delegated proving are out while Shield is the only signer.
- **Files** (offer attachments, PDFs) are too big: a 100 KB file in one transaction would cost
  about 18 ALEO under the quadratic fee, or about 100 approvals in 5 KB pieces. **Decided (Joshua,
  2026-10-16): offers carry no files.** The offer letter is one box of up to 20,000 characters
  to paste into. On chain that is a long letter: up to about 20 KB of text, roughly 7–8 KB
  compressed, so it needs a bigger parcel than chat (a `send_long`, or the pointer variant below).
  Estimated 0.07–0.3 ALEO an offer, one approval; to measure.
- **Fan-out** (an announcement to 15 people) in one call is up to 15 letters, but 15 copies of the
  parcel push the transaction into the quadratic fee. A later variant: the parcel once, as a public
  input (it is already AES ciphertext), with tiny private pointer records to each member. Needs
  Joshua's call against the privacy floor before it is designed further.
- **Forever.** Today messages are deleted after 30–60 days; on chain, ciphertext stays. If a
  parties key ever leaks, every letter under it opens. **Decided (Joshua, 2026-10-16): a new random
  key at least every 24 hours, every old key kept in the vault** so a person's own history stays
  readable, on any device. The next key travels inside a letter record (sealed to the recipient's
  address, not only under the old key), so one leaked day's key doesn't open the next day's.
  A leaked view key and a leaked vault still open everything; rotation limits a single key's
  reach.
- **Leo version.** Our pin is Leo 4.0.0 (`self.signer`); Leo 4.4 removed that sugar for
  `std::ctx::signer()`. Testnet is on consensus V22; confirm which Leo deploys there.
- **Records pile up.** The pinned adaptor has no "since height" filter; every letter comes back on
  each read. Fine for hundreds; an `archive` call (spending old letters) could come later.
- **Coworker letters need addresses.** Coworkers know each other by a P-256 key, not an Aleo
  address. Sending them letters means sharing addresses in the directory (which reveals each
  person's `.hewn` name to coworkers). Joshua's call.
- **Shield and fees.** Provable's launch copy says private transactions in Shield are free (Provable
  covers the fee). Whether that covers dApp calls is undocumented; the private-fee test will show
  who paid.

## Order of work

1. Private-fee test (live since #79): offer and withdraw with the switch on; confirm `fee_private`.
2. Write `hewn_letters_v1` and its tests (new Leo program: model decision first).
3. Deploy to testnet; record the deployment in the manifest.
4. A read-only check in Settings, like the Shield history check: send one letter to yourself and
   report proof time, fee, transaction size and whether `requestRecords` finds it with `sender`.
5. Then `LetterBox` behind the thread code, offers and messages first.

## Sources

- snarkVM, master 8cbc73f: `console/network/src/lib.rs` (limits), `synthesizer/process/src/cost.rs`
  (fees), `console/program/src/data/record/` (encryption, tags), `ledger/block/src/transition/`
  (what a transition exposes), `synthesizer/src/vm/verify.rs` (constructor rule).
  https://github.com/ProvableHQ/snarkVM
- Leo 4.4.5: `crates/parser/src/rowan.rs` (`self.signer` → `std::ctx::signer()`).
  https://github.com/ProvableHQ/leo
- `@provablehq/sdk` 0.10.1 and wallet adaptor 0.3.0-alpha.3 type definitions (in `node_modules`).
- Shield: https://provable.com/blog/introducing-shield
- Record scanning service (Shield-side, TEE): https://developer.aleo.org/sdk/record-scanning/record_scanning
- Aleo-Voice-Mail, an earlier records-as-messages proof of concept: https://github.com/Elexy101/Aleo-Voice-Mail
