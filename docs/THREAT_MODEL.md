# Hewn — Threat Model

Living document. Every phase's PR checks its changes against this list; new features add rows.
Status: ✅ in place · 🔜 planned (phase) · ⚠️ accepted risk.

## What we protect

| Asset | Where it lives | Worst case if lost |
|---|---|---|
| The books (entries, customers, vendors, invoices) | Encrypted vault on the user's device (Phase 1) | Business finances exposed or altered |
| Worker PII and pay (wages, W-4, bank details) | Same vault; never public in any mode | Harm to an individual; legal exposure |
| Vault key / passphrase | Derived in memory, never stored | Everything above |
| Integrity of history | Hash chain, period roots; on Aleo in anchored mode | Undetected fraud |
| The app's own code | Built in CI, served from our host | Every user above, at once |

## Trust boundaries

- **The device and browser are trusted.** If the OS or browser is compromised, the attacker sees
  what the user sees (T8).
- **The server is not trusted with data.** It serves code and nothing else: no database, no API
  that sees plaintext. A breached host can serve bad code (T3) but cannot leak stored books,
  because there are none. The one API it has, the mailbox, sees ciphertext only (below).
- **Dependencies are untrusted until reviewed.** Every package runs with the app's privileges.
- **The chain is public.** Only hashes, commitments and block heights go there.

## Threats

### T1 — Central breach of everyone's books
No server, no database. ✅ Structural, from the architecture.

### T2 — Stolen device, browser profile or backup file
- AES-256-GCM via WebCrypto; the open data key is non-extractable. ✅ `@pnw/vault`
- Envelope encryption: random data key, wrapped by a PBKDF2-SHA256 (600k rounds, random salt) key
  from the passphrase; associated data binds each ciphertext to its vault and role. ✅
- Backups are the sealed record itself; nothing is decrypted to write one. Restore proves the
  passphrase and re-verifies the hash chain before replacing anything. ✅
- Log out drops the key and plaintext from memory. Without "stay logged in": auto-lock after 15
  idle minutes, and any reload locks. ✅
- ⚠️ **Stay logged in** (ticked by default at login, Joshua 2026-10-15): the open data key is also
  kept in IndexedDB as the browser's non-extractable `CryptoKey`, with an expiry 24 hours after
  login, so a phone switching apps (which suspends or reloads the page) doesn't log the user out.
  It can decrypt but can't be exported, so it can't be copied off the device; anyone holding the
  unlocked device can open the books until it expires or Log out forgets it. `resumeSession`
  refuses an expired key, an expiry further out than 24 hours, an extractable key, or one that
  doesn't open its record, and clears it. One remembered session per device. Accepted: on a phone
  the books open inside the Shield app, which itself needs a fingerprint. ✅ `@pnw/vault`
  (`remember`, `resumeSession`, `forgetSession`)
- **Email + passphrase.** The unlock secret is the normalised email and the passphrase together
  (`hewn:v1\n<email>\n<passphrase>`), so a stolen file needs both to open; the passphrase alone
  does not. The vault id is `acct-` plus 32 hex of SHA-256 over role and email, local to the
  device. ✅ `apps/business/src/books/account.ts`
- ⚠️ The id is an unsalted hash, so someone holding a file or the browser profile can test a
  guessed email against it cheaply. That confirms an address they already suspect; it opens
  nothing (the key still needs the passphrase), and the email is not stored in the clear anywhere
  (it lives inside the encrypted company file). Accepted.
- Login never says whether an email has an account here: one generic message for a wrong email,
  a wrong passphrase or an empty device, and a failed lookup spends one key derivation so the wait
  tells the same story. ✅
- There are no server accounts, so there is no credential-stuffing surface, no reset email to
  hijack and no password reset. A lost passphrase is unrecoverable. 🔜 The recovery key (a second
  wrapped copy of the data key, held by the user) is the planned recovery mechanism; the email is
  kept in the account so recovery can use it.

### T3 — Malicious code in the page (XSS, compromised dependency, compromised host)
The highest risk for a browser app.
- Strict CSP, a fresh nonce per request, `'strict-dynamic'`, no `unsafe-inline`/`unsafe-eval`
  in production. ✅ `packages/security/src/headers.ts` (shared with the marketing site `apps/site`,
  whose policy names no host and allows no WebAssembly), `apps/business/src/security/headers.ts`,
  each app's `src/proxy.ts`
- ⚠️ One policy for the whole business app (Joshua, 2026-10-15): every page may compile
  WebAssembly (`'wasm-unsafe-eval'`; JS eval stays refused) for the wallet code's hashing and
  decryption, and may reach the explorer REST origin. Until then the policy was widened per page,
  but a page's policy is fixed when the document loads and in-app navigation keeps it, so in
  practice the first page opened set it for the whole session, and wallet code broke when the
  session began elsewhere. A fresh load per page would apply the right one but lock the books (the
  unlocked session lives in memory only). Accepted: the widening is two allowances, the same on
  every page.
- `connect-src 'self'` plus the explorer REST origin, and nothing else: injected code has nowhere
  to send data but a public read-only API. Verified in a browser: third-party fetch, framing and
  inline handlers are all refused. ✅
- ⚠️ The dashboard asks the explorer for the linked account's public balances each time it opens,
  so the explorer's operator can tie the user's IP to that address. The address is already public
  (it owns a registered name). Private balances come from Shield's own records and touch no server
  of ours. Accepted.
- ⚠️ The app asks Shield for the "on-chain history" decrypt permission (the widest level), because
  Shield answers `requestTransactionHistory` only at that level and the books are meant to fill from
  the account's own past transfers. It lets the page read the linked account's history and decrypt
  its own transitions; everything read stays in the browser session and the vault, and nothing is
  sent anywhere but the read-only explorer. The permission is the user's to grant or revoke in
  Shield. Accepted (Joshua, 2026-10-15).
- `frame-ancestors 'none'`, `X-Frame-Options: DENY` (no clickjacking); `nosniff`;
  `Referrer-Policy: no-referrer`; device APIs disabled by `Permissions-Policy`. ✅
- React escapes all rendered text; `dangerouslySetInnerHTML` is not used. ✅ (add a lint rule 🔜)
- Dependencies pinned exactly, lockfile enforced in CI (`--frozen-lockfile`). ✅
- `pnpm audit --audit-level=moderate` blocks merges. ✅ Baseline 2026-10-13: 47 → 0 advisories.
- `minimumReleaseAge` 7 days: freshly published (possibly hijacked) versions are never pulled. ✅
- Install scripts allowed only for an explicit list (`onlyBuiltDependencies`). ✅
- Unused wallet adaptors removed (Shield only): fewer packages, smaller attack surface. ✅
- Dependabot for npm and Actions. ✅
- Signed, installable builds with published hashes so users can verify the code they run;
  release hash anchored on Aleo once anchoring exists. 🔜 (before first external user)
- Pin GitHub Actions to commit SHAs. 🔜

### T4 — Silent edits to history (insider, owner, or malware)
- Append-only journal; "edit" and "void" are reversals plus new entries. 🔜 P1
- Each entry hash-chains to the previous; any change breaks the chain and shows. 🔜 P1
- Closed periods produce a root the accountant can keep; locked periods can't reopen. 🔜 P1
- Anchored mode puts period roots on Aleo, making tampering provable. 🔜 P1/P2

### T5 — Ledger logic bugs (wrong numbers)
- Money as integer cents (`bigint`), never floating point. 🔜 P1
- Invariants (debits = credits, open period, active account) enforced in one module, with
  property-based tests over random entries. 🔜 P1
- Strict TypeScript, CI blocks on any failing test or type error. ✅
- Third-party audit of the vault and ledger core alongside the Leo audit. 🔜 budget line

### T6 — Privacy leak through the chain (anchored/settled modes)
- Public mappings hold only hashes, commitments, block heights. ✅ (existing programs) 🔜 `gl_core`
- Aggregates only as proofs with a minimum group size. 🔜 P3 (group size decision open)
- Fiat-mode app cannot import chain packages at all. ✅ `fiat_boundary.test.ts`
- The sender behind every transaction. A public fee (`fee_public`) names the paying address, so
  anyone can count a business's payments on payday (close to its headcount) even with every
  amount hidden. A private fee (`fee_private`) is paid from a credits record and names no one.
  Private by default is the decision (Joshua, 2026-10-16); 🔜 testing: a per-device switch on the
  dashboard (`@pnw/wallet/fee-mode`, applied to every call in `chain/shield.ts`). It never falls
  back to a public fee on its own.
- **Measured 2026-10-16 (test letters through Shield):** Shield doesn't spend the account's private
  ALEO for a dApp call. It has a sponsor pay a public fee instead: the `fee_public` names *another*
  account (Provable, which says it covers Shield's fees), not the sender. The public can't tie the
  transaction to the sender. Provable, which sponsored it, can. Sponsorship is Provable's policy and
  may change (limits, mainnet); the per-send fee choice stays for when it does.

### T7 — Unauthorized access by another member (multi-user)
- Roles enforced by key wrapping and in-circuit allow-lists, not by hiding buttons. 🔜 P6

### T8 — Compromised device or lost passphrase
- ⚠️ Malware on the user's own machine sees what the user sees. Mitigation is limited to
  auto-lock and short key lifetime. With "stay logged in", a remembered key (24 hours at most,
  non-extractable) lets anyone holding the unlocked device open the books until it expires or
  Log out; untick it on a shared device.
- ⚠️ A forgotten passphrase means unrecoverable books. 🔜 P1: optional recovery key, nudges to
  keep an encrypted backup.

## The review list (Transactions → For review)
- Built on the device from Shield's own history and records plus the read-only explorer; kept in
  the encrypted vault (amounts, dates and the other side's account). Nothing is sent anywhere. ✅
- ⚠️ Naming the other side asks the registry (explorer) about that account's name, so the
  explorer's operator can see which accounts the business looks up. Names already on the
  business's customers, vendors or team are used without asking. Accepted.
- An accepted item is undone from the review list (its entry reversed), never voided alone in the
  register, so the list and the books can't disagree. ✅

## The mailbox

The one server function (`/api/mailbox/<lookup>`, `@pnw/mailbox`; decision in
`docs/INTEGRATION_AUDIT.md` §4.4). It carries a document (offer terms, a W-4, a paystub, a payment
note) from one party of an agreement to the other, with no email, no PDF and no third party able
to read it. It holds the pinning key, stores nothing, has no database.

**What the function, the host and the pinning service can see:** ciphertext; lookup hashes
(`BLAKE3("PNW::MAILBOX::LOOKUP::v1" ‖ 0x00 ‖ parties_key ‖ kind ‖ seq)`, which only the two parties
can compute and which relate to nothing else); request timing and sizes; client IP addresses.
**What they cannot:** who the parties are, which kind of document it is, how many documents an
agreement has exchanged, or any content. Every envelope is AES-256-GCM under a key derived with
HKDF-SHA256 from the agreement's on-chain `parties_key` and the document kind, bound to its lookup
as associated data, so it can't be read, replayed into another slot or passed off as another kind.
The function refuses anything that isn't a sealed envelope (hex lookup, octet-stream body, version
byte, 256 KiB cap) and logs neither bodies nor lookups. Same origin only, no CORS. ✅

**Pinata holds ciphertext in flight only.** The receiver's vault keeps its copy the moment the
document is opened and the pin is then dropped; the sender's vault kept one from the start.
Nothing on a pin but the lookup as its name and, for some, a keep-until day (below): no
addresses or kinds in metadata. ✅

**Keep-until days** (`@pnw/mailbox` `retention.ts`; Joshua, 2026-10-16). Records people depend on
(paystubs, W-4s, weeks of hours, payment notes) carry no day and stay pinned until collected:
nothing deletes them on its own. Documents that only matter for a while carry one: an offer's
terms and file pieces (the day after it expires), receipts (60 days). The function checks the day
(a real date, today to 60 days on) and keeps it beside the pin; a daily sweep
(`/api/mailbox/sweep`, the host's scheduler with `CRON_SECRET`) unpins mailbox pins whose day has
passed, and only those (named by a lookup, with a valid day). The host learns a calendar day per
pin: roughly how long the sender wants it kept, which hints at whether it is an offer. Without
`CRON_SECRET` the sweep does nothing and expired pins wait for the receiver's app, which clears an
expired offer when it finds one. ⚠️ Accepted.

**The thread between a business and one person** (`books/thread.ts`, `chain/thread.ts`; counter-offers
first). Each side writes its own numbered slots (kinds `thread_b`, `thread_w`) sealed with the pair's
parties key, and reads the other side's. Every message that arrives is untrusted input: a known
kind, one that side may send (only the person asks for changes; only the business keeps or
revises an offer), every field in shape and bounded, or it is skipped and its pin left. Nothing in
a thread signs anything: an offer changes only by a withdrawal and a new offer on the chain, each
approved in Shield, and the person's app still checks the new offer's terms against its record.
Each offer's terms now have their own slot (`terms_<agreement id>`), so a revised offer can never be
read with the old one's terms. ✅

**Messages** (Joshua, 2026-10-16) travel the same thread as plain `text` messages, either side,
at most 4,000 characters. Reading one sends a receipt back, so the sender sees "Received". The
host sees one more envelope per message and per receipt, and their timing. A conversation is
named in the address bar by an agreement id or a team member id, never by its key. Plain
messages carry no keep-until day yet: an unread one stays pinned until it's read. ✅

**Announcement channels** (`books/channels.ts`, `chain/channels.ts`). Each channel has its own
random 32-byte key, numbered. The business sends it to each member inside their own thread
(sealed with that pair's parties key), so nobody outside the channel ever sees it. A post is
sealed once with the channel key, in slots only the business writes; members' apps refuse
anything that doesn't open with it. Taking someone out moves the channel to a new key that only
those who stay get: the one who left keeps what they already read and nothing after. Each reader
sends a receipt through their own thread, so "seen by" names nobody to anyone but the business.
Posts stay pinned (many readers), with no keep-until day yet. A member can share a key or a post
they were given; that's true of any message anyone can read. ⚠️ Accepted.

**Coworkers** (`books/directory.ts`, `chain/coworkers.ts`). Opt-in only. Opting in at a business,
the person's device makes an ECDH P-256 key pair for that business alone (no key ties them across
employers); the private half stays in their vault. The business passes on the names and public
keys of those who opted in, and nothing else, and only to them. Two coworkers derive their key
with ECDH and HKDF-SHA256 (salt `PNW::COWORKER::v1`, both public keys as info): the business never
holds it, and their conversation uses its own slots (`cw_a`/`cw_b`) and accepts plain messages
only. The business relays the public keys, so it could swap one and sit in the middle; a safety
code (SHA-256 over both keys, 30 digits) is shown on both phones, and coworkers who compare it in
person and find it matches have ruled that out ("The numbers match" marks it checked). Leaving
the directory sends an empty list to the person who left. ⚠️ Accepted until checked in person;
✅ once checked.

**Group chats** (`books/groups.ts`, `chain/groups.ts`). No group key: every group message is sent
to each member separately through the private conversation the two coworkers already share,
with one message id for all the copies. So a member can't pass as another (each copy arrives
under the sender's own pair key), the business can't read any of it, and taking someone out
means they get nothing new. A group's setup counts only when it comes from its admin. Group
messages are refused in business-and-person threads. Groups hold at most 25 people (one send per
member per message). ✅

**Receipts** (`@pnw/mailbox` `sealReceipt`, `chain/receipts.ts`). When a person's app collects an
offer or a paystub, or the business's app collects a week of hours, it seals a small receipt
("received at") back to the sender, at an address in its own domain
(`BLAKE3("PNW::MAILBOX::RECEIPT::v1" ‖ 0x00 ‖ parties_key ‖ kind ‖ seq)`) under its own key, and the
sender drops it once its vault has the time. The host sees one more small envelope; by timing it
can guess that a document was collected and answered, not by whom or what. A missing receipt only
means "not known yet". ✅

**Offer letter files** (PDFs and photos attached to an offer, 5 MB together; only offers sent
before 2026-10-16, since offers no longer carry files) travel the same way,
cut into 256 KB pieces, each sealed like any other document under a kind unique to the offer. The
host and the pinning service see ciphertext and, from the number of pieces, roughly how big the
files are; nothing else. Each file's SHA-256 is inside the offer's terms, which the agreement
record's terms hash commits to, so the person's app refuses any file that isn't exactly the one
offered. Both sides keep the files in their vaults; the pieces are dropped once the person
accepts. ✅

**What the business takes in.** A team member's week of hours arrives sealed to the agreement and is
opened on the business's device. It comes from another person, so it is treated as untrusted input
(`books/mailbox.ts`): it must be a version 1 timesheet naming exactly the agreement whose key opened
it, its total must equal the sum of its entries, every entry must fit in a day, and nothing beyond the
known fields is kept. A document that fails is skipped and reported, never half-kept, and its pin
stays. A week is written to the vault before its pin is dropped. ✅

**Delivery is not proof.** The mailbox is a courier. Both vaults keep copies, and what proves a
paystub or a payment is the books: the document hash in the entry, the entry hash in the chain,
the period root anchored. A lost or dropped envelope costs a re-send, never a record. ✅

Without `PINATA_JWT` the function answers 503 and everything else in the app works; the mailbox
is the only feature that needs the host to have a secret. ⚠️ Accepted: the host can refuse
delivery (denial of service) or see that two unknown parties exchanged *something*. Scanning by
lookup also means an attacker who steals a `parties_key` can read that pair's envelopes while
they're pinned; the key is in a private record and in the vault, never elsewhere.

**The parties key is random** (fixed 2026-10-16). Every mailbox key and address comes from the
agreement's `parties_key`. The old portal computed it from the two addresses alone, so anyone
who knew (or guessed) who works for whom could compute it and read their mailbox, paystubs and
W-4s included, while pinned. The program never checks how the key was made, so the business's
app now draws 32 random bytes for each new pair (`chain/offer.ts` `newPartiesKey`), keeps the
same key for a revised offer to the same person, and replaces an address-derived one whenever
an offer goes out again. The person reads it from their private agreement record. The public
`agreement_parties_commitment` hashes the key with the two name hashes, so it can't be
reversed. Pairs linked before the fix (testnet only) keep their old key until they get a new
offer. ✅

## Not yet covered

Phishing look-alike sites, browser extensions with page access, and denial of service are out
of scope until the first external release; revisit then.

## Traction counts (2026-10-19)

During testnet the app keeps two totals per country since launch, visits and visitors, in a small
Upstash store (`apps/business/src/app/api/traction/`), and shows them on the public `/traction` map.
- **Stored:** country code → two numbers. No dates, no addresses, no ids. The country comes from
  Vercel's `x-vercel-ip-country` header; the request's address is never read.
- **Visitor:** decided on the device (local storage remembers it was counted); only `{first: bool}`
  is sent. Nothing lets the server tell two visitors apart. One count per browser session.
- **Published:** only countries with at least 5 visitors, cached a day at the edge, so a small
  country never points at a person and watching the page can't time a visit.
- **If the store leaks:** per-country totals, nothing about anyone. **If someone spams the counter:**
  inflated totals; the endpoint takes same-origin requests only and caps the body, and the numbers
  are presented as rough. It never touches the vault, keys, wallets or the chain.
