---
status: plan
updated: 2026-11-05
summary: Making payroll legally exact: the IRS's own withholding method with verified, dated tables, a real W-4 the worker signs (drawn and in Shield), layered protection for Social Security numbers, state rules from the Pacific Northwest outward that follow where the work is done, the I-9, and zPass to explore.
---

# Payroll compliance: the plan

**Status:** plan, agreed with Joshua on 2026-11-05. Nothing here is built yet. Each part below is
its own pull request, most with a short design first; parts with new screens need Joshua's
greenlight when they come up. Every rate, threshold and amount in the build comes from the
publishing agency's own document, verified in the session and cited in the code, never from memory.
Numbers mentioned in this plan are marked *unverified* where they are.

## Why

Hewn runs payroll, so its withholding has to be what the law says, for each worker, from the forms
that worker actually signed. Reading the code on 2026-11-05 found:

- **Each worker has their own W-4 values in payroll** (`packages/payroll` `W4`: filing status, the
  dependent credit, other income, extra deductions, extra withholding), and the tax math uses them
  per worker. It is not one generic calculation.
- **But the worker never fills in a W-4.** An offer creates the worker with "single, all zeros"
  (`books/hiring.ts` `DEFAULT_W4`), and only the business can type values in (`WorkerForm`, "From
  their W-4"). What a worker fills in at setup is their profile (legal name, date of birth, state,
  citizenship), not a W-4, and nothing is signed.
- **The federal math is close to the IRS method, not exactly it** (`packages/tax-engine`): it
  annualizes wages and applies the year's brackets and standard deduction, which matches the IRS
  percentage method only when a W-4's Step 2 box is unchecked. It has no Step 2 (multiple jobs or a
  working spouse), offers four filing statuses where the W-4 has three, and its comment assumes
  $2,000 a child for Step 3 (the 2025 law may have raised it to $2,200: *unverified*).
- **Its 2026 tables are labelled "projected"**, and several brackets look wrong against the final
  2026 numbers (the single 32% bracket ends at $515,700 in the code: *to verify*).
- **There is no state tax at all,** and no state employment rules (minimum wage, sick leave, paid
  family leave, overtime).
- **There is no I-9.**

## Decisions (Joshua, 2026-11-05)

1. **States: the West, starting from the Pacific Northwest.** Washington, Oregon and Idaho first.
2. **Social Security numbers are collected,** because compliant payroll needs them, behind several
   independent locks (part 4).
3. **The electronic W-4 meets the IRS's five requirements** (part 3), and a tax professional
   reviews the system before mainnet.
4. **The I-9 follows the W-4** (part 6).
5. **A W-4 is signed twice:** the worker draws their signature with a finger, then Shield signs the
   whole form, the drawing and the date, and it goes on chain as a sealed letter.
6. **Tax tables update through review, never by themselves:** a watching Routine opens a pull
   request when an agency publishes new numbers (part 2).
7. **State rules follow where the work is done,** and fill in and enforce each agreement's terms
   for that state (part 5).
8. **zPass is to be explored** for proving identity without storing documents (part 7).

## Part 1: the federal engine

Replace the approximation with the IRS's own method: Publication 15-T's **percentage method for
automated payroll systems** (Worksheet 1A, for W-4s from 2020 on).

- **Filing statuses as the W-4 has them:** single or married filing separately; married filing
  jointly or qualifying surviving spouse; head of household.
- **Step 2:** the checkbox selects Publication 15-T's other set of tables.
- **Step 3:** the dependent amounts the 2026 W-4 states (*to verify*).
- **Steps 4(a), 4(b), 4(c):** as today, but on the IRS's worksheet lines.
- **Exempt:** a W-4 claiming exemption withholds no federal income tax, and the claim expires on
  February 15 of the next year (*to verify*), after which the worker is treated as having no W-4.
- **No W-4 on file:** withhold as single, with no adjustments (the IRS's rule), as today.
- **Nonresident aliens:** Publication 15-T's added amount, if the profile says so.
- **Social Security and Medicare:** the 2026 wage base and the Additional Medicare threshold,
  verified (the code has $184,500: *to verify*).
- **Tables as dated data.** Each set of tables carries the dates it applies from and to; payroll
  uses the set for the pay date, so January 1 switches over by itself once the new set is merged,
  and a mid-year change works the same way.
- **Tests from the IRS's own worked examples** in Publication 15-T, plus our existing cases, plus
  must-fail cases: a pay date with no tables, a status the W-4 doesn't have.

Needs: the IRS site reachable from the session (`www.irs.gov`), which Joshua approves in a prompt.

## Part 2: keeping the tables current

The IRS has no interface for withholding tables: it publishes Publication 15-T as a PDF, usually in
December; Social Security announces the wage base in October; each state publishes its own.

- **A watching Routine**, like the weekly dream: monthly from October to January and once at
  mid-year, it reads the IRS's, Social Security's and each covered state's publications, compares
  them with the tables in the code, and opens a pull request with the new numbers and a diff when
  anything changed. It never merges (OPS-01): one wrong table makes every paycheck wrong.
- **The app never fetches tables at run time.** Tables ship with the code, reviewed, so nothing on
  the network can change a paycheck.
- Needs: the agencies' hosts on the Routine's environment.

## Part 3: the W-4

### The five electronic requirements

Treasury Regulation §31.3402(f)(5)-1(c), summarized in Publication 15, as read on 2026-11-05 (the
exact text to be confirmed from the source before the build):

| Requirement | How Hewn meets it |
|---|---|
| 1. What the employer receives is exactly what the employee sent, and every submission is recorded | The W-4 is hashed and signed, and travels as a letter on chain: any change breaks the signature, and every submission is a permanent record with its block |
| 2. The system makes it reasonably certain the person submitting is the person named | Signed by the worker's own Shield account, the one that owns their registered name and is the worker in their agreement with this business, with their books behind their passphrase |
| 3. It asks for exactly the same information as the paper form | Every step and field of the year's W-4, with its wording, including the "under penalties of perjury" statement |
| 4. It is signed electronically by the named employee, and the signature is the last entry | The drawn signature, then Shield's signature over the whole form, the drawing and the date; nothing can follow it |
| 5. On request, the employer can give a paper copy with a statement that the named employee submitted it | A printable W-4 from the business's books, with that statement and the signature's details |

**Joshua asked (2026-11-05) whether workers should upload a government ID at onboarding.** Not for
the W-4: its test is "reasonably certain", which the account, the agreement and the name already
meet, and an unverified upload would prove little while being the most valuable thing in a vault
to steal. Identity documents belong to the I-9, where the law requires them (part 6), or to zPass
(part 7).

### The flow

1. The business's offer asks for a W-4 (and the state's form, part 5) once the agreement is
   accepted and the pair's handshake is done.
2. The worker fills it in on their own app, with the IRS's worksheets as helpers (multiple jobs,
   deductions).
3. They draw their signature with a finger. It is kept as pen strokes, not a photo.
4. They review the whole form with the drawing on it, and sign it in Shield: the form, the
   drawing, the date and the perjury statement, in one signature. That is the final entry.
5. It goes to the business as a sealed letter under the pair's twin-curve key (never under the
   agreement's key, which a view key reaches), and the worker keeps their copy.
6. The business's payroll applies it from the first pay period that ends on or after the 30th day
   after it arrives, or sooner (the IRS's rule: *to verify*). Every version is kept, with the
   dates it applied.
7. The worker can send a new W-4 at any time.

**Printing (requirement 5) and Shield's browser.** Shield's in-app browser can't download or share
files (`memory/lessons.md`). The rule is that the employer can produce a copy *on request*, not
instantly on a phone: the W-4 is in the business's books and on chain, so the business prints it
from Hewn on a computer with the Shield extension. Phone screens say so.

**Keeping it.** Employers keep W-4s for at least four years (*to verify*). The business's vault, its
backups and the letters on chain cover that.

**Legal signatures.** Electronic signature law is broad, and a wallet signature should qualify, with
the drawn signature making it familiar to people and courts. This is the point the professional
review confirms.

## Part 4: protecting Social Security numbers

No one can honestly promise software can't be hacked. What Hewn does is stack independent locks,
so that one failure exposes nothing.

1. **No server to breach.** The number is never anywhere outsiders can reach in bulk, which removes
   the most common cause of leaks entirely (INV-02).
2. **The vault.** Encrypted on the device behind the passphrase, as all the books are.
3. **A lock of its own.** Inside the vault, the number is encrypted again under a separate key,
   shown masked (•••-••-1234), and revealed only with a fresh Shield signature each time; it hides
   again after a few seconds. Someone inside an unlocked app still can't read it without the wallet.
4. **Sent only under a twin-curve key.** The W-4 travels only after the handshake, so a view key
   can't open it.
5. **Never fingerprinted bare.** There are about a billion possible numbers, so a plain hash of a
   W-4 could be cracked by trying them all. Every hash of a document holding one includes a random
   value kept with it.
6. **Never logged, exported or reported,** except on the W-2 (CI already blocks debug logging in
   shipped code).

What remains is a compromised device, where malware sees what the user sees; lock 3 shrinks that.
The threat model gets a new threat for identity documents and numbers, with these locks as its
answers.

## Part 5: state rules

**Payroll follows where the work is done, not where the business is registered.** A Washington
business with someone living and working in Oregon follows Oregon's rules for that person (with
exceptions such as reciprocity agreements and residence rules, which each state's design covers).

- **The business records:** its registered state, its state account numbers (unemployment
  insurance, withholding, paid leave, workers' compensation), and its headcount, since some
  employer shares of paid leave apply only above a size.
- **Each agreement records the work location**, down to the city or county where local rules apply.
- **Each state is a pack** with two halves:
  - *payroll:* income tax withholding with the state's own form (where it has one), and the
    employee and employer contributions it requires (paid family and medical leave, long-term care,
    workers' compensation, unemployment insurance);
  - *agreement terms:* the minimum wage (an offer below it is refused), paid sick leave accrual,
    paid family leave and its split between employer and employee, overtime rules (California's
    daily overtime, for one), pay frequency, and final-paycheck timing. Hewn fills these into the
    offer and enforces them.
- **No new Leo is expected:** an offer's terms travel in its sealed document, which the agreement
  record hashes. The design confirms this.

**Order:** Washington, Oregon and Idaho first; then California, Nevada, Montana, Alaska, Utah and
Wyoming; then Arizona, Colorado, New Mexico and Hawaii. What each first state involves, to be
verified from its own agencies:

- **Washington:** no income tax; Paid Family and Medical Leave, the WA Cares Fund (long-term care),
  and the employee's share of workers' compensation (Labor & Industries), which is charged by hours
  worked.
- **Oregon:** income tax withholding with its own state W-4 (OR-W-4), the statewide transit tax,
  and Paid Leave Oregon; local taxes in the Portland area to check.
- **Idaho:** income tax withholding with its own form.

## Part 6: the I-9

Every new hire needs a Form I-9, proving identity and eligibility to work. Its rules are its own
(*all to verify* from USCIS):

- The worker fills in section 1 by their first day; the employer examines the worker's documents
  and fills in section 2 within three business days of the start date.
- Examining documents remotely is allowed only to employers enrolled in E-Verify, under a specific
  live-video procedure; others examine them in person.
- Electronic I-9s have their own requirements (integrity, an audit trail, signatures, retrieval).
- The employer keeps it for three years after hire or one year after the job ends, whichever is
  later.

Document images, where required, live only in the business's vault, sealed, and only for the
retention period, with the same locks as part 4.

## Part 7: zPass, to explore

Aleo's ecosystem has zero-knowledge identity work (zPass), meant to let a person prove a statement
about a government-issued credential ("holds a valid ID", "is over 18", "is authorized to work")
without handing over the document. For Hewn that could mean identity, for the W-4's "reasonably
certain" and for the I-9, without anyone storing an ID image.

Questions for the exploration, nothing assumed:

1. What zPass is today: who maintains it, whether it is live on testnet or mainnet, its program and
   SDK.
2. Which credentials it can verify (passports, state IDs, driver's licenses) and how the credential
   is issued or read (NFC chip, an issuer, an attestation service).
3. What a proof reveals, and what is public on chain.
4. Whether a zPass proof can stand in for, or support, the I-9's document examination (almost
   certainly not on its own under current rules: the employer must examine original documents), or
   only strengthen identity for the W-4 and the registry.
5. Whether it runs in Shield's browser.

Output: a short note in `docs/`, then a decision.

## Order of work

1. **The federal engine** (part 1): no new screens; needs the IRS site reachable.
2. **The tables Routine** (part 2).
3. **The W-4** (parts 3 and 4): a design, then the build; new screens.
4. **The state rules** (part 5): a design for Washington, Oregon and Idaho, then one state at a time.
5. **The I-9** (part 6): a design, then the build.
6. **zPass** (part 7): the exploration note, then a decision; can run alongside.

## Before mainnet

- A tax professional reviews the electronic W-4 and I-9 systems and the withholding against the
  agencies' publications.
- Every covered state's pack is verified against its agencies for the year.
- The threat model covers identity numbers and documents.
