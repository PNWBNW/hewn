# Customers: design

**Status:** design, for review (Joshua, 2026-10-23; accounts revised 2026-10-26). Nothing is
built. Step 1 (customer accounts, invoices and payment) needs no new Leo and is greenlit, after
the account backup's restore; the rest needs two new
Leo programs (Fable 5.1 at high effort, with must-fail tests). Every step has new screens, built
only with Joshua's greenlight. The decisions below are his.

## The checklist

Moved here from `BUILD_PLAN.md` on 2026-10-25; tick items here.

- [x] Customer accounts: their own sign-up, login and portal; a person can be a worker and a
  customer, as two accounts (Step 1, no new Leo). Built 2026-10-26: the portal has Home and
  Settings; bills, payments and messages come with the next items.
- [x] A business and a customer connect, either one starting, and message each other privately
  (Step 1, no new Leo). Built 2026-10-26: a hello each way, then a shared key (`docs/LETTERS.md`,
  Businesses and their customers).
- [x] Agreements for a job in the conversation (decision 20): the business proposes or revises,
  the customer accepts, asks for changes or declines, either side marks it complete or cancels;
  and either side disconnects. Built 2026-10-26.
- [x] An invoice names its agreement when there is one (decision 21): the invoice form offers the
  customer's agreed jobs, optional; the bill and the printed invoice show it. Built 2026-10-26.
- [x] Invoices sent to a connected customer and shown under Bills (Step 1, no new Leo). Built
  2026-10-26.
- [x] Bills paid from the customer's Shield account, the business told, and recorded on the
  business's side once its own account shows the transfer (Step 1, no new Leo). Built 2026-10-26.
- [x] A printable invoice, for a customer who isn't on the app (Joshua, 2026-10-26): Sales →
  Invoices → Print, then the browser's Print or Save as PDF (a phone's own browser can share it;
  Shield's browser may not print). Built 2026-10-26.
- [ ] A directory of businesses taking new clients, by field of work, with sealed inquiries.
- [ ] Requests only businesses in the chosen field can read, refreshable for businesses that open
  up later; business posts, public or sealed. Free for now; $1 later in a new version.
- [ ] Service agreements with a specified end: complete (both confirm), warranty, closed; change
  orders, cancel, terminate, dispute.
- [ ] Invoices paid through the agreement: one transaction moves the private USDCx straight from
  the customer's wallet to the business's and issues receipts and a one-use review ticket; the
  customer brings their own USDCx. A probe on testnet first (Shield's prover and a private call
  into USDCx).
- [ ] Reviews at each payment, private to the business until the job is complete, in warranty or
  closed, then public with the job's average.

## What it is

Customers come into Hewn the way team members did: through the chain, by registered name, with
everything about them private. A customer can:

- find a business that is taking new clients, by the kind of work it does;
- post a request for work that only businesses in that field can read;
- take a business on under a service agreement with a clear end: complete, warranty, closed;
- get invoices, pay them in USDCx from their own wallet, and message the business;
- invite the business to events on their own calendar;
- review the business at each payment, privately to the business at first and publicly once the
  job reaches its end.

## Decisions so far (Joshua, 2026-10-23)

1. A person can be both a worker and a customer, as two accounts, each with its own login and
   portal (revised 2026-10-26, decision 17).
2. Posting a request is free for now; $1 later, in a new version of the program.
3. Businesses post on the board too. Posts sort by who posted them (a business or a customer),
   and business posts filter by the kind of work. Businesses describe themselves in their own
   words: what they are, and what work they take on.
4. Workers' `.hewn` names are never shown to a customer automatically: the business chooses.
5. Reviews at each payment. They accumulate into a job's average, are private to the business
   until the job is complete, in warranty or closed, then post publicly together.
6. A business switches on "taking new clients" to appear in a directory customers search by
   field of work. The customer reaches out from there.
7. A request is readable only by businesses in the field the customer picks; to anyone else it
   is private. The customer can refresh it so businesses that open up later see it.
8. Getting USDCx is the customer's responsibility. Hewn has no part in it.
9. Each payment issues the customer a one-use review ticket, automatically, in the same
   transaction as the payment, so a business can't hold one back and nobody reviews without
   paying (changed 2026-10-23; at first a payment only opened the chance in the app).
10. A directory listing is free for now; $1 later, in a new version.
11. Reviews only inside Hewn, and only between two parties who made an agreement first.
12. Whether a job's reviews go public at its end is a term of the agreement, agreed by both and
    locked in when it is accepted.
13. One listing per business, one field: it can update the listing and say more in its own
    words, but not post more (businesses shouldn't spend network fees to be found).
14. Spam on free requests: recipients mute first; a private posting pass only if it becomes a
    problem.
15. A business can post one public reply to each review, once the reviews are public.
16. At most 24 reviews per job for now; long, continuous jobs may need more later.
17. Customers sign up on their own and have their own login and a standalone portal that holds
    only customer activity. A customer can also be a worker, but the two are separate accounts
    (2026-10-26; this replaces the "customer side" of a personal account first planned).
18. One username holds a worker and a customer account, never a business with either; a business
    always runs its own Shield account (2026-10-26).
19. Order: the account backup's restore (`docs/CHAIN_BACKUP.md` part 3) first, then Step 1 here,
    greenlit for its screens (2026-10-26).
20. A business and a customer link before any invoice: either just linked (both connect) or with
    an agreement for a job that both agree to. Agreements travel in the conversation for now
    (option A: kept in both vaults, nothing public); the on-chain `hewn_service_v1` takes them over
    later. Either side can disconnect, and then no invoice can be sent (2026-10-26).
21. An invoice names the agreement it's under when there is one for that job, chosen from the
    agreed ones; it doesn't have to (2026-10-26).

## Accounts (decision 17)

A **customer account** is a third kind beside a business and a worker: its own sign-up, its own
login, its own vault, and its own portal that shows only customer activity. A person who is also
a worker keeps the two apart, as two accounts.

| | Business | Worker | Customer |
|---|---|---|---|
| Welcome card | I run a business | I work for a business | I'm a client or customer (new) |
| Username | Its own | Shared with the person's customer account, if any | Shared with the person's worker account, if any |
| Vault | `hash(business + username)` | `hash(worker + username)` | `hash(customer + username)` |
| Portal | The books (`/`) | `/work` | `/customer` (new) |
| Name on the registry | A business name | A personal name, with a profile | A personal name, no profile |

- **Sign-up.** A third card on the Welcome screen: **I'm a client or customer**, "Find
  businesses, get invoices, pay them, and keep every receipt." (Joshua, 2026-10-26: not "I hire
  businesses".) The note under the cards changes to say a username can hold a worker and a
  customer account, and that a business has a username and a Shield account of its own.
- **Usernames (decision 18).** One username holds a worker and a customer account, or a business,
  never a business with either. A business always runs its own Shield account and its own
  username. Usernames live only on the device (there is no server to check them against), so sign-up
  enforces it there: making a business under a username that already holds a worker or customer
  account on this device is refused, and the other way round. Accounts already made under the old
  rule (a business and a worker on one username) keep opening; nothing is stranded.
- **Login.** The same username and passphrase screen. The vault id already mixes in the role, so
  a worker and a customer account under one username each have their own vault and keys; when
  one username opens both, the login asks which (as it does today). `ROLES` gains `customer`.
- **The portal holds only customer activity.** No books, no payroll, no work, no job board. Its
  pages: **Home** (what's owed and what's been paid), **Businesses** (the ones you deal with,
  found by registered name), **Bills** (invoices received), **Payments** (paid, with receipts),
  **Messages**, and **Settings** (Shield, backups, the recovery key). The shell sends a customer
  vault that lands anywhere else back to `/customer`, the way it keeps a worker on `/work`.
- **Shield.** Every account is on the registry, so a customer links a Shield account at setup.
  A customer pays from personal money, so its Shield account may be the one the same person uses
  as a worker, and never a business's: the one-kind rule becomes **business or personal** per
  Shield account, with worker and customer both personal (`chain/account_kind.ts` refuses a
  customer only on a wallet holding a business name).
- **The name.** A customer needs a registered name so a business can find them. If the Shield
  account already holds a personal name (from the same person's worker account), the customer
  account uses it; otherwise setup registers one, free, the same way a worker's is registered,
  without the worker profile. On chain a customer's name looks exactly like a worker's, so the
  chain doesn't say who is a customer.
- **Backups and recovery** work as for the other two: a backup file, the account backup on chain
  (`docs/CHAIN_BACKUP.md`), and a recovery key.

## Step 1: invoices and payment, with no new Leo

What works before `hewn_service_v1` exists, using only what is live (`hewn_letters_v2`, the
stablecoin's own private transfer, the registry):

1. **The two connect** (built 2026-10-26). The business adds the customer by registered name
   (Sales, Customers) and taps Connect, or the customer finds the business by its name (Businesses).
   Each side sends a hello with a fresh public key, one approval each, and from then on everything
   between them is sealed under a key only the two can make (`docs/LETTERS.md`). Messages work
   from here.
2. **The business sends an invoice** (built 2026-10-26): once an invoice is sent in the books, Sales
   → Invoices lists it under **To send to customers on Hewn** while its customer is connected and
   hasn't had it; **Send** puts it in their conversation (number, dates, lines, tax, total, memo;
   nothing of the books' accounts), one approval. Voiding it later lists **Tell them**.
3. **The customer sees it under Bills** (built 2026-10-26): every invoice from each connected
   business, the latest copy, voided when the business said so; opened in full, and the open total
   on Home. Bills checks each conversation for what's new.
4. **The customer pays it** (built 2026-10-26): **Pay** sends exactly the bill's amount as a
   private USDCx transfer from their Shield account to the business's, through payroll's own pay
   queue (`@pnw/rail`), so a reload resumes and a payment whose outcome isn't known is never sent
   again on its own. Once it settles, a `payment` message tells the business which invoice and
   which transfer. Two approvals: the payment, then the message. The bill shows Paid.
5. **The business's books take it** (built 2026-10-26): Sales → Invoices reads its customers'
   conversations and lists each payment. It offers **Record payment for INV-0012** only once the
   business's own Shield account shows that transfer coming in for that amount (For review); the
   customer's word alone records nothing. Recording posts a payment against the invoice
   (receivable to the Shield account) and marks the review item recorded, so it isn't counted
   twice.
6. **Messages** between the two are letters, a conversation like a team member's.

**What's public:** the same as any letter and private transfer: that the letters program and the
stablecoin's private transfer ran, plus the fee payer when the fee is public. Not the amount, the
parties, or the invoice.

**Honest limits, until `hewn_service_v1`:**
- Payment and receipt are two transactions. If the receipt doesn't go through, the payment still
  arrived and the business matches it by amount; the customer's app offers to resend the receipt.
- Nothing on chain ties a payment to an invoice; the receipt letter and both sides' records do.
  The one-transaction payment with receipts and a review ticket (decision 9) comes with
  `hewn_service_v1`.
- No directory, requests, agreements or reviews yet: those are Steps 2 to 4.

## Finding a business: the directory

A business turns on **Taking new clients**. That posts a listing anyone can read, like a job
posting, and turning it off hides the listing (the chain keeps that it once existed).

| Field | Where it comes from | Public |
|---|---|---|
| Field of work | The industry code its `.hewn` name was registered under (1 to 40), so filtering is exact | Yes |
| What we are | The business's own words: the precise kind of business | Yes |
| Work we take on | The business's own words | Yes |
| Service area | A region (country and state or province) for filtering, plus its own words (city, radius) | Yes |
| Inquiry key | A P-256 public key, kept in the business's vault, for sealed inquiries and requests | Yes |

- Customers search and filter in their own browser, from the chain. Nobody learns what a
  customer searched for.
- **An inquiry** is twin-curve from the first message: the customer's app makes a fresh key
  pair and seals the inquiry under the key exchange with the listing's inquiry key, the way an
  application reaches a business through a job posting's hiring key. The inquiry reveals the
  customer's account to that business, since the business has to be able to answer.
- One listing per business, in the field its name was registered under (decision 13). It can
  update the listing and describe other work in its own words.

## The request board

### Customer requests: sealed to a field

What everyone sees: **that a request was posted, and when**. Not the field, the area, the words,
who it went to, how many it went to, or who posted it.

1. The customer writes the request and picks a field (and an area if they want).
2. Their app reads the directory and finds every listing in that field (and area) that is taking
   new clients.
3. It seals the request once, with a fresh random key.
4. For each of those businesses, it seals that key to the business's inquiry key (P-256 key
   exchange with a fresh key pair for the post, HKDF-SHA256, AES key wrap), with a short tag only
   that business can work out. The sealed keys ride in the post; the unused places are filled
   with random bytes, so the count doesn't show.
5. Each business's app tries every new post with its own key, finds its tag, and opens only the
   posts meant for it.
6. The post holds the hash of a secret only the customer's vault keeps. That secret, not the
   customer's account, is what lets them refresh, edit or close the post later.

**Who posted:** the post is sent straight from the customer's wallet. With the private network
fee on (the dashboard's per-device switch), their account doesn't show on chain. With a public
fee, it does: the app warns before posting. Free posts carry no USDCx fee, so nothing else ties
the post to them. A $1 fee later has to be paid privately for the same reason.

**Refreshing:** businesses that turn on Taking new clients after a post can't read it until the
customer adds them. The customer's app watches the directory and says so: "3 businesses in
Plumbing opened up since you posted. Send it to them?" One approval adds a page of sealed keys
for the same request. Nothing is re-posted, and the post's age stays honest.

**More businesses:** a post has room for about 25 businesses. To reach more, the customer adds
another page, which costs that transaction's network fee. That is the "pay to see more options"
cost, and it is real: each page is a transaction.

**Answers (bids):** a business answers inside the board, sealed to the post's key with the tag
only it and the customer can work out, so the customer stays unnamed until they choose to reply.
The answer shows the business's name (businesses are public-facing), but not which post it
answers. When the customer replies, it goes as a letter, and from then on the business knows who
they are.

**Honest limits:**
- "In that field" means registered or listed in that field. Registering a business name is free,
  so someone set on reading a field's requests could register one. This stops casual browsing and
  scraping, not a determined snoop.
- Every business it went to can keep what it read.
- Free posts invite spam. Recipients mute a post first; only if spam becomes a problem does
  posting take a private pass record (one per registered person, without saying which; decision
  14).

### Business posts

A business posts under its own name (looking for subcontractors, vendors, or customers). It
chooses: public, filterable by field and readable by everyone, or sealed to a field like a
customer's request. Public business posts sort apart from customer requests and filter by the
business's field of work and its own words.

## Service agreements

A new program, built like `employer_agreement_v5`: two parties, a record each, the two P-256
halves in the records (so the conversation is twin-curve from the start), no registry call. On
chain: the agreement's id hash, its status, block heights, and the warranty's end height. Never
the terms, the price, the customer or the address of the work.

| Status | Gets there by |
|---|---|
| Offered | The business sends terms (from an inquiry, an answer to a request, or directly by registered name) |
| Active | The customer accepts |
| Work marked complete | The business marks the work done |
| Complete | The customer confirms. Until they do, the business can't call the job finished |
| Warranty | Straight after Complete, when the terms name a warranty period; ends at a set height |
| Closed | Whatever the terms named as the job's end (below) |
| Changed | A change order: one side sends new terms, the other accepts; the status carries on |
| Cancelled | Either side, before work is marked complete, as the terms allow |
| Terminated | Either side, with a reason code, after it started |
| Disputed | Either side flags it; closing waits until both clear it or one terminates. Hewn doesn't settle disputes |

**The job's end (specified closure):** the offer names what closes it.
- the customer signs off;
- the final invoice is paid (the business marks it, the customer confirms);
- the warranty period ends (either side can then close it);
- a checklist in the terms that both sides tick off.

If one side goes silent at the end, the other can close it after a grace period set in the terms;
both sides' records then say it closed without the other's confirmation. Each side keeps a
private closure record as proof the job was done.

## Invoices and payment, through the agreement (decision 9)

1. **The business invoices through the program** (`invoice`), from the sales side it already uses
   (customers, invoices, receivables). The amount and whether it's the final invoice are locked
   into a private `Invoice` record the customer receives; the details (lines, notes) follow as a
   letter in their conversation.
2. **The customer pays it** (`pay`), in one Shield approval and one transaction:
   - the `Invoice` record is used up, so it can't be paid twice;
   - exactly its amount moves as a private USDCx transfer from the customer's wallet straight to
     the business's (a call into the USDCx program, with its exclusion proof, in the same
     transaction). The program never holds the money, so neither does Hewn;
   - both sides get a private `Receipt`, the business's books post it (receivable to cash), and
     the customer's show it as paid;
   - the customer gets a one-use `ReviewTicket` for that agreement.
3. **A final invoice, once paid,** is what the "final invoice paid" closure condition checks, on
   chain, with nobody's word needed.

On chain: only a spent-invoice marker (a hash) and block heights. Never the amount or the parties.

**To prove first:** this is one transaction calling a second program with private records.
Shield's in-browser prover dropped exactly that in payroll (four separate transactions since).
The job board's fee is a two-program call that works, but it's a public transfer. So before
`hewn_service_v1` is written, a tiny probe program on testnet checks a private USDCx transfer
inside another program's call, from Shield on a computer and on a phone. If it fails, payment
stays a plain transfer and reviews go back to the app's prompt (no ticket).

**Audit:** the program moves money (straight through, never held), so it gets a third-party audit
before mainnet, like every program touching real money.

- **The customer's side:** a list of bills and payments, per business and per job.
- **USDCx:** the customer brings their own. The app says only what's needed ("You'll need USDCx
  in Shield to pay this"), without recommending where to get it.

## Reviews

### Who can review (decision 11)

Only the customer on a `hewn_service_v1` agreement, about that agreement's business:

- `note_review` takes the customer's own agreement record (and returns it) and uses up a
  `ReviewTicket` from a payment on that agreement, so only someone who holds one and paid can
  write a review, and only about the business named in it. No agreement and no payment, no
  review.
- Agreements are made only between registered names. The business's name is checked on chain
  when it offers (its name is public anyway). The customer's is checked by the business's app
  before the offer goes out, the way names are confirmed today, not on chain: a public check would
  put the customer's account on the chain next to the business's.
- A review can be noted only while the agreement is Active, Work marked complete, Complete or in
  Warranty, one per payment (a ticket each, decision 9), and at most 24 per job for now. A long,
  continuous job may need more later: a later version can raise the cap. A ticket not used
  before the job ends just lapses.

### At each payment

Each time the customer pays, the payment's ticket lets them write a review: stars, a few fixed tags (on time, clean,
communicates, fair price, would hire again), and a comment. One per payment, all optional. Each
one:

- goes to the business **privately, straight away**, sealed under their conversation's key, so
  the business sees how it's going while there's still time to fix it;
- stays in the customer's vault;
- leaves only a hash on chain, under a key only the two of them can work out. That hash proves the
  entry was written then and can't be changed, dropped or added to later. Each hash also covers
  the one before it, so the chain of entries is fixed.

### Going public, if the agreement says so (decision 12)

The offer carries one more term: **reviews go public at the end, yes or no**. The customer sees it
before accepting, and accepting locks it into the agreement record; neither side can change it
later, except by a change order both accept.

- **Yes:** once the job is **Complete, in Warranty or Closed**, either side can post the job's
  reviews: every entry and the job's average, in one approval. The program checks every entry
  against its hash and that none is missing, so a rough patch at payment 2 stays in, whoever
  posts. A business can't hold good reviews back from a customer who forgets to post, nor
  drop a bad one.
- **No:** the reviews stay between the two of them for good. The business still saw each one as
  it was written.

**A prospective customer sees,** on a business's listing:
- the overall average across its reviewed jobs;
- each job's average;
- opened, that job's entries in order: "Payment 2 of 4: ★★, late start. Payment 3 of 4: ★★★★,
  fixed it."

**Not shown:** amounts, dates beyond the block height it was posted, the job's address, or the
customer's name. The business can work out which customer wrote which job's reviews, since it
knows its own jobs; the public can't. The app warns that comments go public at the end, and not to
name crew or put personal details in them.

**The one public counter:** listing reviews without a server takes a count of reviewed jobs per
business. It holds no money and no single rating, and it only moves when a whole job's reviews
post, so it is a small, documented exception to the leakage guard (Joshua, 2026-10-23: reviews
stay cached until the job ends, then post).

**The business's replies (decision 15).** Once a job's reviews are public, the business can post
one short public reply to each review, shown beneath it ("We came back on the 14th and replaced
the valve at no charge"). One per review, written once, never changed; only for reviews that went
public. While the job is under way, the business answers in the conversation, privately, as it
always could.

## Calendar

A customer invites the business to an event on their own calendar (the shared events already
built for teams). The business can pass the invite on to the crew it sends. Crew names are hidden
from the customer unless the business chooses to show them (decision 4).

## The programs (new Leo)

| Program | Calls (sketch) | Public state |
|---|---|---|
| `hewn_market_v1` | `list`, `update_listing`, `set_taking_clients` (the business, by its name); `post_request`, `add_recipients`, `edit_request`, `close_request` (by the post's secret); `answer` (a business, by its name); `post_business`, `close_business` | Listings; posts as sealed bytes, sealed-key pages and a secret's hash; answers as sealed bytes under tags; the business posts' facts and words |
| `hewn_service_v1` | `offer`, `accept`, `withdraw`, `change`, `accept_change`, `invoice`, `pay` (the USDCx transfer, the receipts and the review ticket in one), `mark_complete`, `confirm_complete`, `close`, `cancel`, `terminate`, `dispute`, `clear_dispute`; `note_review` (the customer, with their agreement record and a ticket), `post_reviews` (either side, when the terms say public), `reply_review` (the business, once per posted review) | Agreement id hash → status, heights, the warranty's end; spent-invoice markers; review hashes under tags; posted reviews and the count of reviewed jobs per business |

Both free for now, `@noupgrade`; $1 later is `hewn_market_v2`, with the app reading both, the way
it reads both letters programs.

## Who sees what

| Holder | Sees |
|---|---|
| Anyone | Listings; that requests exist and when; public business posts; that a business answered something; agreement statuses by id hash; posted reviews |
| A business in the field (or listed when the customer refreshed) | The requests sent to it; the customer's account only once the customer replies |
| The business on an agreement | The terms, the invoices, payments into its wallet, every review as it's written |
| A view key | That letters and records exist. Not a request's words (sealed under key exchange) or the conversation after its handshake |
| Hewn | Nothing beyond what anyone sees. It holds no money and no keys |

## Open questions

1. **Paying to see more.** Sending to more businesses costs a network fee per page, naturally.
   Charging to *browse* (more directory or board pages) can't be enforced: reading the chain is
   free for anyone with the explorer, so the charge would only be a toll in our app, and every
   page would need a Shield approval. Recommendation: browsing stays free.

## Building order (when greenlit)

One Leo program per Fable session (Joshua, 2026-10-23): `hewn_service_v1` first, then
`hewn_market_v1`.

0. The probe: a private USDCx transfer inside another program's call, proven by Shield on a
   computer and a phone (a tiny test program, flagged as Leo).
1. Customer accounts and the portal, invoices as letters, payment by private transfer (Step 1
   above; no new Leo, so it can start before the probe).
2. `hewn_service_v1` and the agreement screens: offer, accept, the statuses, invoices and payment.
3. `hewn_market_v1`, the directory first, then sealed requests and answers.
4. Reviews: notes at payment, posting at the end, the listing's averages.
5. Calendar invites from customers.

## Tests it ships with

Including inputs that must fail:
- a business that didn't receive a request's key can't open it;
- the public can't tell a post's field or how many it went to;
- refreshing, editing or closing a post without its secret is refused;
- a listing or an answer under a name the signer doesn't own is refused;
- the business can't mark an agreement complete for the customer;
- nothing closes while it's disputed, and an agreement can't skip warranty when its terms set one;
- reviews can't post before the job is complete, in warranty or closed;
- a posting with an entry missing, changed or added is refused;
- reviews post only once per job;
- noting a review without the agreement record, without a ticket, with a ticket from another
  agreement or one already used, about another business, after closing, or past 24 is refused;
- paying an invoice twice, paying less or more than it says, paying another customer's invoice,
  or paying without the USDCx is refused, and a refused payment moves nothing;
- posting reviews when the agreement says they stay private is refused, and so is changing that
  term without both sides;
- a second reply to the same review, a reply to a review that isn't public, or a reply from
  anyone but the reviewed business is refused.
