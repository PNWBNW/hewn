# Proof of income: a worker proves what they earn without showing it

**Status:** design, for Joshua's review (2026-10-29). Nothing is built. It needs a new Leo program,
so before any Leo is written the session switches to Fable 5.1 at high effort (INV-22), and the
program ships with negative tests.

## What we want

A worker paid through Hewn can prove a statement about their income to someone who asks (a
landlord, a lender, a car dealer, a benefits office) without handing over paystubs or showing a
wage:

- "I earned at least **$3,000 every month** for the last **6 months**."
- "I earned at least **$20,000 in total** over the last **12 months**."
- "I have been employed continuously for **8 months**." (no amount at all)

The person checking learns that the statement is true, and nothing else: not the wage, not the
paychecks, not the hours. Nobody else learns anything, not even that a proof was made for them.

This is something only private payroll on a zero-knowledge chain can offer. It makes being paid
through Hewn worth something to the worker, not just to the business.

## What it rests on, and what it can't use

A proof is only as good as the numbers under it, and the worker must not be able to make those
numbers up.

- **Not the USDCx records.** A received payment is an owner and an amount, nothing more
  (`transfer_private` carries no memo; `docs/ALEO_CONSTRAINTS.md`). It doesn't say who paid or
  that it was wages, and Shield joins received records within a minute, so they don't survive as
  paychecks.
- **Not the paystub letters.** Paystubs travel as sealed letters (`docs/LETTERS.md`): the wages
  are inside an envelope the app opens, not fields a Leo program can read.
- **Not `paystub_receipts.aleo`.** It is deployed, but anyone may call `mint_paystub_receipts`
  with any accounts and amounts, so a worker could mint their own. It can't be the source.

So the source has to be new: **earnings statements**, private records that only an employer can
create, and only for a person it has an agreement with.

## The design

### 1. Earnings statements (the employer's side)

Once a month, after the month's last pay run, the business issues each worker an **earnings
statement**: a private record owned by the worker, with the business keeping its own copy.

| Field | What it holds |
|---|---|
| `owner` | The worker |
| `month` | The month it covers, as `yyyymm` |
| `gross` | Gross pay for the month, in cents |
| `net` | Net pay for the month, in cents |
| `kind` | Employee or contractor |
| `pair` | The agreement's pair tag (a pseudonym from `employer_agreement_v5`, not a name) |
| `nonce` | Random and private, so the statement's commitment can't be guessed |

**Who may issue:** the signer must be the employer of an agreement the two did make. That is the
same check `hewn_credentials_v1` makes when a business vouches for a worker:
`employer_agreement_v5.aleo::assert_pair_agreed`, which takes the parties key and the worker's
account privately. A worker can't issue a statement to themselves, because v5 refuses an
agreement with yourself.

That check is a call into a second program, and Shield's prover drops proofs that span several
programs (`packages/wallet/README.md`). `hewn_credentials_v1`'s `issue` makes the same call; it
passed from a script on 2026-10-25 but hasn't been tried in Shield yet. **Before any Leo here, try
issuing a credential from the Team page in Shield.** If Shield can't prove it, the check moves to
finalize as a read of `employer_agreement_v5`'s public state, if that state allows it, which keeps
each proof to one program.

**Public:** one commitment per statement (a hash over its fields and the nonce) with its status
and the block it was issued at. Nothing else, so INV-03 holds.

**Corrections:** a statement is never edited. The business revokes a wrong one with its own copy
(its status becomes REVOKED) and issues a corrected one. A proof checks every statement it uses
is still active.

**Approvals:** monthly, not per paycheck, and batched: one transition can carry up to 15
statements (16 outputs), so a business with 15 workers approves once a month. Statements are
issued by the business that ran payroll, from the payroll records it already has.

### 2. Making a proof (the worker's side)

On their Pay page the worker picks a claim and the months it covers. The app passes the
statements for those months to a `prove` transition, signed in the worker's Shield:

- It takes up to 15 statements and gives each back unchanged as a fresh record (a record is
  spent when it's used, so the worker keeps them), which leaves room for 12 months comfortably.
- It checks each statement belongs to the signer, that the months are distinct and fall in the
  range claimed, and that the claim holds (every month at least $X, or the total at least $X, or
  every month in the range present).
- In finalize it checks every statement's commitment is still active, then records one **claim
  commitment** with the block height: a hash over the claim's text, the months, the verifier's
  code (below) and a random salt. No amounts, no names, no accounts.

The proof says nothing the worker didn't choose to say: "at least $3,000" doesn't reveal $3,412.

### 3. Checking a proof (the verifier's side)

The verifier needs no wallet and no Hewn account.

1. The verifier gives the worker a short **code**, for example their business name and the date.
   It goes into the claim commitment, so a proof made for one landlord can't be reused for another.
2. The worker makes the proof and sends a link: `hewnaccounting.com/verify#…`. Everything after
   the `#` stays in the browser and never reaches a server: the claim, the months, the code, the
   salt and the worker's registered name.
3. The verify page recomputes the commitment and checks it exists on chain. It then shows the
   claim, when it was proven, the worker's `name.hewn`, and how many employers the statements
   came from.

A printable version, a one-page letter with a QR code for the link, suits a rental application.

**Who is in front of the verifier:** a link can be forwarded. If the verifier wants to know the
applicant is the worker, the verify page can ask the applicant to sign the verifier's code in
Shield on the spot, which proves they control the account behind `name.hewn`. This step is
optional (question 5).

## What each side learns

| Who | Learns |
|---|---|
| The verifier | The claim the worker chose to prove, the months, the worker's `name.hewn`, how many employers, and when it was proven. Not the wage, paychecks or hours. |
| The employer | Nothing. Proving spends only the worker's own copies; the employer's copies are untouched. |
| Hewn | Nothing. No server is involved, and the link's data never leaves the browser. |
| Anyone watching the chain | That a statement commitment exists, and later that a claim commitment exists, with their block heights. Not whose, not how much, not for whom. |

Wages stay private in every mode (INV-01). The claim isn't public: the worker shares it
privately with one verifier.

## Limits, said plainly

- **A proof is as good as its employers.** A worker who registers a fake business and "pays"
  themselves can issue real statements. The verify page shows how many employers there were, and
  can show each employer's registered name and how long it has been on Hewn (its card's issue
  height, `hewn_cards_v1`), so the verifier can judge. It can't prove the employer is a real
  business; nothing on chain can.
- **Statements aren't tied to the USDCx that moved.** Binding them would mean one proof spanning
  two programs (the stablecoin and this one), and Shield's prover drops those
  (`packages/wallet/README.md`). A statement is the employer's word, as a paystub is today, only
  one the worker can't forge.
- **Fishing.** A verifier could ask for proof after proof at rising amounts to close in on the
  wage. Only the worker can make a proof, so they can refuse; the app could also offer amounts
  in round steps only (question 6).
- **Revocation after the fact.** An employer can revoke a statement after a proof used it. The
  proof stays on chain as made, but the verify page re-checks the statements' status and would
  show that one was revoked since.

## How it would be built

1. **The program**, `hewn_income_v1.aleo` (new Leo; Fable 5.1, high effort; negative tests): a
   statement record, `issue`, `revoke`, `prove`, and two mappings (statement status and height,
   claim height). Deployed on testnet with a migration note, like every program.
2. **The employer side:** "Issue earnings statements" after a month's last pay run, on Payroll,
   from the pay runs already in the books.
3. **The worker side:** "Prove your income" on the worker's Pay page: pick a claim, enter the
   verifier's code, sign, get the link and the printable letter.
4. **The verify page:** public, no account, like `/card`.

Each step is its own PR. Steps 2 to 4 are new screens and need Joshua's greenlight.

## Questions for Joshua

1. **Gross, net, or both?** Landlords usually ask about gross. Should the worker choose which
   one a claim uses?
2. **Monthly statements**, or one per paycheck? Monthly means far fewer approvals; per paycheck
   would allow claims like "paid every two weeks".
3. **Fiat-mode businesses:** may a business that pays through its bank issue statements too? The
   statement is the employer's word either way.
4. **Employer names on the verify page:** shown by default, hidden by default, or the worker's
   choice per proof?
5. **The live signature check** (the applicant signs the verifier's code in Shield): in v1, or
   later?
6. **Round amounts only** (e.g. $250 steps) to blunt fishing, or any amount?
7. **Which claims in v1?** "At least $X every month", "at least $X in total" and "employed for N
   months", or start with the first one alone?
8. **A fee?** Free while on testnet. On mainnet: free for workers, a small fee per proof, or a
   premium-tier feature (`docs/PREMIUM_TIER.md`)?
