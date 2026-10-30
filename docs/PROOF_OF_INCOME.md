# Proof of income: paystubs a worker can prove from

**Status:** design, for Joshua's review (2026-10-29; reworked the same day around paystub
records, with the paystub letter kept beside them and the agreement checked once per worker;
2026-10-30, the income letter replaces the verifier's code, Joshua). Nothing is built. It needs a
new Leo program, so before any Leo is written the session switches to Fable 5.1 at high effort
(INV-22), and the program ships with negative tests.

## What we want

The paystubs a business issues are the source of truth for what a worker earns. The worker should
be able to prove to a third party (a landlord, a lender, a car dealer, a benefits office)
**exactly what that party needs, and nothing more**, and still show that the income came from a
legitimate employer.

Joshua's example: a worker makes about $7,500 a month. The landlord asks for income of at least
3× the rent, and the rent is $1,200. The worker proves **"at least $3,600 a month for the last
6 months"**. The landlord learns that and only that: not the $7,500, not the hours, not the
deductions.

It must feel **as simple as bringing in copies of your paystubs** (Joshua, 2026-10-30). The
verifier may not be comfortable with technology, so they do nothing but look: no code to hand
out, no account, no wallet, no app.

So:

- **The employer is the source.** Each paystub is issued by the business, and the worker can't
  make one up or change one.
- **The worker extends it.** A proof is the worker's own signed statement *about* their paystubs,
  checked against them by the program. It adds nothing the paystubs don't support.
- **The worker chooses what's shown,** within what the paystubs support.
- **The verifier just checks:** they scan a QR code and compare a name to an ID, as they would
  with paper paystubs.

## The integrated paystub

Today a paystub travels as a sealed letter (`docs/LETTERS.md`, `chain/usePaystubDelivery.ts`):
one Shield approval per worker per pay run. It is readable only by the app, so no program can
check anything in it.

The change: **every paystub also becomes a private record issued by a new program,
`hewn_paystubs_v1.aleo`**, sent beside the letter. **The paystub letter stays as it is** (Joshua,
2026-10-29): the full paystub, sealed under the pair's key and drawn by the app, is still what the
worker opens. The record is its provable twin. That is one more approval per worker per pay run
(two in all), which Joshua accepted.

### The record

The record carries only what a proof may need, as plain fields only its owner can read. The rest
of the paystub (each tax and deduction, rates, overtime, callouts) stays in the letter:

| Field | What it holds |
|---|---|
| `owner` | The worker (the business keeps its own copy) |
| `issuer` | The business's account, private |
| `name_commit` | A sealed fingerprint of the worker's legal name, as the business has it on payroll: a hash over the name and `name_salt` |
| `name_salt` | Random and private, so the fingerprint can't be matched against a list of names |
| `period_start`, `period_end`, `pay_date` | The pay period and pay date, as day numbers |
| `gross`, `net` | This paycheck, in cents |
| `hours` | Hours paid, in hundredths (0 for salaried pay) |
| `ytd_gross`, `ytd_net` | Year to date, in cents |
| `kind` | Employee or contractor |
| `doc_hash` | The paystub document's hash, the one already in the books (`Paycheck.paystubHash`) and in the letter |
| `nonce` | Random and private |

**The name is the employer's word,** as on a paper paystub, which prints the employee's name.
The business takes it from its payroll records, and the worker can't change it. It is what lets a
verifier know the proof belongs to the person in front of them (below).

`doc_hash` ties the record to the letter and to the paystub document in the business's books: the
worker's app checks that a record and its letter carry the same hash, and that the record's
numbers match the letter's, and flags any paystub where they don't. The record is about fifteen
fields, inside a record's 32 (`docs/ALEO_CONSTRAINTS.md`).

### Who may issue

Only the employer of an agreement with the worker may issue them a paystub, and the program
refuses a paystub to oneself. The agreement is checked **once per worker, not at every pay run**
(Joshua, 2026-10-29):

1. **Authorize once.** Before a worker's first paystub record, the business signs `authorize`. It
   checks the agreement through `employer_agreement_v5.aleo::assert_pair_agreed` (active, paused
   or ended), as `hewn_credentials_v1` does, and gives the business a private **paystub right**:
   a record of this program, owned by the business, naming the worker.
2. **Then every paystub shows the right, privately.** `issue` takes the business's right, checks
   it names the worker the paystub is for, and gives the right back unchanged as a fresh record.
   A program can check its own private records inside the proof, so issuing needs no public
   step at all.

**Why only once:** the agreement's status lives in v5's public state, and a program can read public
state only in the public part of a transaction (finalize). The pair tag (a pseudonym made from the
two accounts and the agreement's private key, never a name or an amount) goes in as a public
input. If every paystub checked it, every paystub would carry the same tag, and anyone could line
them up: that pair's pay rhythm (every other Friday, say) and how many paychecks it has had.
Checked once, the tag shows once per worker, close to the agreement's own public moments.

**What the right can't do:** it can't be given to another account (the program has no transfer),
and it names one worker, so it can't issue paystubs to anyone else. It stays when the agreement
ends, so a final paycheck still gets its paystub (question 2).

**A Shield test first:** `authorize` calls into a second program, which Shield's prover has had
trouble with (`packages/wallet/README.md`). `hewn_credentials_v1`'s `issue` makes the same call; it
passed from a script on 2026-10-25 but hasn't been tried in Shield yet. **Before any Leo here, try
issuing a credential from the Team page in Shield.** It's one call per worker, so if Shield can't
prove it, a slower path for that one step is acceptable.

### Public state

**Issuing a paystub writes nothing public.** A business paying 7 people would otherwise leave 7
anchors at one block, which is its headcount. Instead:

- **Authorizing a worker shows the pair tag once** (above), and writes nothing.
- **Corrections are the only public mark.** A wrong paystub is never edited: the business voids it
  with its own copy, and only then is the paystub's commitment (a hash over its fields and the
  nonce) written to a `voided` mapping. Then the business issues a corrected one.
- **A proof checks none of its paystubs are voided.**
- **Proofs leave a claim commitment** with its block height (below).

No amounts, no names, no accounts: INV-03 holds.

## The worker: Prove my income

On their Pay page the worker taps **Prove my income** and picks what it's for. A preset fills in
the usual ask, and the worker can change any of it:

| Preset | Fills in |
|---|---|
| Rental application | "Gross at least 3× the rent, each month, last 6 months"; the worker types the rent |
| Loan or car purchase | "Gross at least $X, each month, last 12 months" |
| Proof of employment | "Paid in each of the last N months", no amount |
| Custom | Any of the claims below |

| Choice | Examples |
|---|---|
| The claim | Every month at least $X; at least $X in total; year to date at least $X; paid in each of the last N months (no amount) |
| The threshold | Any amount the paystubs support |
| Gross or net | Gross is what landlords usually ask for |
| The period | The last 3, 6 or 12 months, or a range |
| Shown always | The worker's legal name; the employer's registered business name; the date it was proven |
| Extras, each off by default | How long they've been paid by that employer; pay frequency |
| Optional | "Prepared for" (e.g. Alder Apartments) and an expiry date, both typed by the worker |

Then one signature in Shield. The app passes the paystubs the claim needs to a `prove` transition.
The program:

1. Checks each paystub belongs to the signer and that no two are the same paystub.
2. Checks the legal name the worker shows matches `name_commit` on **every** paystub used.
3. Checks they fall in the claimed period and that the claim holds, e.g. that each calendar
   month's gross, summed by pay date, is at least the threshold.
4. Gives every paystub back unchanged as a fresh record. A record is spent when it's used, so this
   is how the worker keeps them.
5. In finalize, checks none is voided, then records one **claim commitment** with the block
   height. The commitment is a hash over everything the letter shows (the claim, the period, the
   name, the employer, the extras, "prepared for", the expiry) and a random salt.

**What the proof never shows:** the actual amounts, any single paycheck, hours, deductions, or
anything the worker didn't choose.

**Cheap claims.** A year-to-date claim needs only the latest paystub, since `ytd_gross` is on it:
one record, one approval.

**Long periods.** A transition takes at most 16 inputs, and 15 paystubs plus the outputs is about
the limit; that covers 6 months of biweekly pay. For longer periods, a `summarize` transition
rolls up to 15 paystubs into one **monthly summary** record, carrying the name fingerprint
forward. Only the program can create one, so it's as trustworthy as the paystubs it came from, and
a 12-month proof then reads 12 summaries. The app does the rolling up quietly, as paystubs arrive.

## The income letter

The result is a **one-page income letter**, made in the browser. The worker prints it, emails it,
or shows it on their phone, the way they'd hand over copies of paystubs:

> **Income verification**
> **Jane Doe** earned **at least $3,600 a month (gross)**, **May to October 2026**.
> Paid by **Cedar Supply LLC**, on Hewn since March 2026.
> Proven October 30, 2026. Prepared for Alder Apartments. Valid until November 30, 2026.
> *[QR code]* Scan to verify at **hewnaccounting.com**

The QR code holds a link, `hewnaccounting.com/verify#…`. Everything after the `#` stays in the
browser and never reaches a server: what the letter says, and the salt.

## The verifier: scan, look, compare

1. **Scan the QR code with a phone camera**, the way people open a restaurant menu. It opens the
   Hewn website: no app, no account, no wallet. The letter also carries the link in print, for
   typing.
2. **The page shows a green check:** *"Verified. This statement is backed by Jane Doe's paystubs
   from Cedar Supply LLC, recorded on the Aleo blockchain."* It shows the same lines as the letter,
   when it was proven, and whether it has expired.
3. **Compare the name to the applicant's ID,** as with paper paystubs.

The page recomputes the claim commitment from what the link says and checks it on chain. If any
word or number was changed, on paper or in the link, the commitment doesn't match and the page
shows a red warning instead. It also re-checks that none of the paystubs behind it has been voided
since.

**Why there is no verifier's code:** it was there to stop someone else using a proof, and the
employer-vouched name does that better, with the check landlords already make. If Bob forwards
Jane's letter, it says Jane Doe, and Bob's ID doesn't. Showing one letter to two landlords is fine:
it's a true statement about Jane, as copies of the same paystubs would be.

## Showing the income came from a legitimate source

Without showing any amount, the letter carries more assurance than a paper paystub:

- **Only the employer could have issued the paystubs:** a business with an agreement with this
  worker, checked on chain at setup. The worker can't create or edit them.
- **The employer is named:** its registered business name and how long it has been on Hewn (its
  card, `hewn_cards_v1`).
- **Possibly, "Licensed employer":** `employer_license_registry.aleo` is deployed. If a business
  holds a licence there, the letter could say so. What that program actually checks has to be
  read before this is promised (question 6).
- **As with paper,** the verifier can still call the employer.

## What each side learns

| Who | Learns |
|---|---|
| The verifier | What the letter says: the worker's legal name, the claim, the period, the employer, when it was proven, and anything the worker added. Not the wage, the paychecks, the hours or the deductions. |
| The employer | Nothing about proofs. Proving uses only the worker's copies. |
| Hewn | Nothing. No server is involved, and the link's data never leaves the browser. |
| Anyone watching the chain | A worker was authorized (one pair tag, once), a paystub was issued (a transaction, nothing public written or shown), a correction was made (a commitment), a claim exists (a commitment and its height). Not whose, how much, which employer or for whom. |

Wages stay private in every mode (INV-01). The letter isn't public: the worker hands it to whom
they choose, as they would a paystub.

**A trade-off to know:** the paystub letter, after the handshake, is sealed under the pair's key
(`docs/TWIN_CURVE_CONVERSATIONS.md`). A record's plain fields are readable by anyone holding the
worker's **view key**. So a worker who shares their view key with an accountant also shows their
paystub numbers (gross, net, hours, year to date), though not the deductions, which stay in the
letter. Hewn never asks a worker for their view key.

## Limits, said plainly

- **A proof is as good as its employer.** A worker who registers a business and "pays" themselves
  can issue real paystubs, under any name. The letter always names the employer and how long it
  has been on Hewn, so the verifier can judge, and call it. Nothing on chain can prove a business
  is real.
- **Lookalike sites.** Someone could print a fake letter whose QR code opens a copy of the verify
  page on another address. The letter and the page both say to check the address bar reads
  **hewnaccounting.com**, as banks advise. The real page recomputes everything from the chain, so
  edited numbers can't pass there.
- **Names are the employer's spelling.** A name that differs from the ID (a maiden name, a
  nickname on payroll) needs the business to correct its records, as with paper paystubs.
- **Paystubs aren't tied to the USDCx that moved.** Binding them would mean one proof spanning the
  stablecoin and this program, and Shield's prover drops those (`packages/wallet/README.md`). A
  paystub is the employer's word, as it is on paper, only one the worker can't forge.
- **Fishing.** Someone could ask for letter after letter at rising amounts to close in on the
  wage. Only the worker can make a letter, so they can refuse; the app could also offer round
  amounts only (question 5).
- **Voids after the fact.** A business can void a paystub after a proof used it. The proof stays
  on chain as made, and the verify page re-checks and would say a paystub was voided since.
- **The fee payer is public.** Every transaction shows who paid its fee. On testnet Shield covers
  the fee, so the payer is Shield and nothing leaks. On mainnet, a business paying public fees
  would show up as the payer of every paystub transaction, which tells an observer how many
  paystubs it issues and when: its headcount and pay rhythm, though never amounts. Private fees
  fix that; they're the setting that fails in Shield on testnet today (`packages/wallet/README.md`,
  Fees), and they need to work before mainnet.
- **Paystubs from before this.** Pay runs paid before the program exists have letters, not
  records. The business could reissue past paystubs as records (question 7).

## How it would be built

1. **The program**, `hewn_paystubs_v1.aleo` (new Leo; Fable 5.1, high effort; negative tests):
   the paystub record and its business copy, the paystub right, `authorize`, `issue`, `void`,
   `summarize`, `prove`, and two mappings (`voided`, claim height). Deployed on testnet with a
   migration note.
2. **Paystub records beside the letters.** Payroll's paystub step sends the letter as today and
   issues the record after it (the second approval), with the worker's legal name from payroll.
   The paystub views show whether each paystub's record is in and matches its letter.
3. **Prove my income** on the worker's Pay page, with the presets, and the income letter.
4. **The verify page.** Public, no account, like `/card`.

Each step is its own PR. Steps 2 to 4 change or add screens and need Joshua's greenlight.

## Questions for Joshua

1. **Which claims in v1?** "Every month at least $X", "at least $X in total", "year to date at
   least $X", "paid in each of the last N months": all four, or start with the rental preset's
   claim alone?
2. **When the agreement ends:** keep the paystub right (so final paychecks get paystubs, and a
   business that rehires needn't authorize again), or let the business give it up with a
   `release` step when someone leaves?
3. **Fiat-mode businesses:** may a business that pays through its bank issue paystub records too?
   A paystub is the employer's word either way.
4. **Default validity:** should a letter expire after 30 days unless the worker picks otherwise?
5. **Round amounts only** (e.g. $100 steps) to blunt fishing, or any amount?
6. **"Licensed employer":** worth looking into `employer_license_registry` for the letter, or
   leave it to the business name and its time on Hewn?
7. **Past paystubs:** offer the business a one-time reissue of earlier pay runs as records, or
   only from now on?
8. **A fee?** Free while on testnet. On mainnet: free for workers, a small fee per proof, or a
   premium-tier feature (`docs/PREMIUM_TIER.md`)?
