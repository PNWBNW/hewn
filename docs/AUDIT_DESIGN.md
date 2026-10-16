# Audit design: proof without receipts

Oct 16, 2026 · design (Joshua approved the direction), no code changed

Payroll now costs one private transfer per worker and nothing else on chain:
- no receipt mint
- no per-payment anchor
- the paystub travels through the mailbox

This document is how a paycheck, a pay run or a whole period is still provable to an auditor,
an accountant, a tax agency or a worker's landlord, without the chain ever showing a wage.

## What has to be provable

1. **This paystub is in the books.** It isn't made up after the fact.
2. **The books weren't changed afterwards.** Nothing was edited, removed or back-dated.
3. **The money really moved.** The right amount reached the right person, on chain.
4. **Nothing is missing** (period audits only). Every entry of the period is there.
5. **Totals, without individuals** (later). For example, "payroll this quarter was over $X",
   with no single wage inferable.

## The pieces

| Piece | Where it lives | Status |
|---|---|---|
| The paystub (full breakdown, hours, period) | Employer's vault; the worker's vault via the mailbox | ✅ built |
| `hash(paystub)` inside the payroll entry (`source.doc`) | The books (`@pnw/payroll`) | ✅ built |
| Each entry hash-chained to the one before it | The books (`@pnw/ledger`) | ✅ built |
| The transfer's transaction id and block height, recorded after it confirms | The paycheck's settlement (`@pnw/payroll`), *outside* the hashed entry | ✅ built |
| **Period root:** one hash committing to every entry of a period | The books | 🔜 to build |
| **Period anchor:** that root put on chain once per period | `payroll_audit_log::anchor_event` (live) | 🔜 to wire up |
| **Payment proof:** the transfer's transition view key | Shield (`transitionViewKeys`) | ✅ readable today |
| **Audit pack** and a verifier anyone can run | App export plus a static verify page | 🔜 to build |
| Formal, consented audits | `audit_nft.aleo` (dual-consent authorization) | ✅ live, unchanged |

## 1. The period root

When a period is closed, the books compute one 32-byte root for it. It covers two lists:
- **the period's journal entries**
- **the period's settlements:** one per paycheck paid on chain. A settlement ties the paycheck's
  entry to its transfer. The transfer id is only known after the entry posts, so it is
  recorded on the paycheck and not inside the entry hash. Without this second list, the root
  would vouch for the books but not for which transfer paid them.

```
entry_leaf_i = BLAKE3("HEWN::LEAF::v1"   ‖ salt(entry_i.hash) ‖ entry_i.hash)
settle_leaf  = BLAKE3("HEWN::SETTLE::v1" ‖ salt(entry.hash ‖ tx_id) ‖ entry.hash ‖ tx_id ‖ recipient_tag)
recipient_tag = BLAKE3("HEWN::RECIPIENT::v1" ‖ salt(entry.hash) ‖ worker_address)
salt(x)      = HMAC-SHA256(anchor_secret, x)
entries      = Merkle tree over the entry leaves, in journal order (n leaves)
settlements  = Merkle tree over the settle leaves, in paycheck order (m leaves)
root         = BLAKE3("HEWN::PERIOD::v1" ‖ business_tag ‖ period_id ‖ n ‖ m ‖ prev_root
                      ‖ chain_head ‖ entries.root ‖ settlements.root)
```

An empty list commits to a fixed empty-tree value. The worker's address enters only through a
salted tag, so a revealed settlement leaf names nobody.

A settlement belongs to the period in which its transfer **confirmed**. A paycheck posted on the
31st and confirmed on the 1st has its entry in one period and its settlement in the next, so
its pack carries both periods' proofs. **Close period** warns when paychecks are still pending.


- **Salted leaves.** Without salts, the hashes handed to an auditor as part of someone else's
  proof could be guessed. A wage entry has a known shape, and the amount space is small
  enough to try every value. `salt_i` comes from one random `anchor_secret` kept in the vault,
  so the salts need no storage of their own. A proof reveals only the one salt it needs.
- **`n` and `m`, the counts, are inside the root.** Today's Merkle helper repeats the last leaf
  when a layer is odd, so a tree with one entry duplicated could hash the same as the real one.
  Committing `n` closes that.
- **`prev_root` chains the periods,** so anchoring this month also vouches for every month
  before it.
- **`chain_head` is the last entry hash of the period.** It ties the root to the journal's own
  hash chain.
- **`business_tag`** is a salted commitment to the business (not its address), so roots from
  two businesses can never be confused, and the root itself names nobody.

## 2. The period anchor (one tap per period)

On **Close period**, the app asks Shield to sign one transaction:
`payroll_audit_log::anchor_event(root)`.

The program is live and `@noupgrade`. It records the block height at which the hash first
appeared and refuses the same hash twice. On chain, the only new things are:
- one 32-byte hash
- a block height
- the public fee from the business's address (Shield needs `privateFee: false`), which shows
  that the business anchored *something* that month

That is one tap a month for a monthly close, no matter how many paychecks the period holds.

`gl_core.aleo::anchor_period_root` (Phase 1, a Fable session) will replace it later, adding
on-chain period status (open, closed, locked). The root format above doesn't change, so roots
anchored before then stay valid.

## 3. The payment proof

Each payroll transfer is one `transfer_private` transition. The employer's Shield can produce
that transition's **view key**. Anyone holding it can decrypt exactly that transition, and
nothing else on the account. Decrypted, it shows:
- the worker's address
- the amount
- that it is the stablecoin's own `transfer_private`

All three are checked against the paystub. The app already decrypts transitions this way for
the review list (`chain/decrypt.ts`).

**Known leaks:**
- **The change record.** The same transition carries the employer's change record, so the
  view key also shows how much was left in the coin it was paid from. That's business-level
  information, not anyone's wage, but an auditor or worker given the key sees it. Paying from an
  exact-amount coin (no change) avoids it; the pay planner already prefers exact fits.
- **The compliance record.** The stablecoin itself sends a compliance record of every private
  transfer to its issuer's investigator address (`ALEO_CONSTRAINTS.md` §4). That's outside our
  control, and it's in the threat model.

## 4. The audit pack

A single file the app exports, in one of four scopes:

| Scope | For | Contains |
|---|---|---|
| **One paycheck** | A worker's landlord, a lender | The paystub, its entry, its settlement (tx id, the worker's address, salts), both Merkle paths, the period root's inputs, the anchor tx, the transfer's view key |
| **A worker's year** | W-2 checks, the worker's own records | The above for each of their paychecks that year |
| **A whole period** | The accountant, a formal audit | Every entry and salt of the period (recomputes the root, so nothing can be missing), plus each payment's view key |
| **A claim** (later) | Grants, lenders, regulators | A ZK proof of a statement ("payroll over $X"), with a minimum group size so no single wage can be inferred (BUILD_PLAN Phase 4) |

**The verifier** is a static page, and later a command-line tool, that runs entirely offline
except for reading the chain. It checks:
1. `hash(paystub)` equals the entry's `source.doc`, and the entry hashes correctly.
2. The entry leaf and the settlement leaf (tx id plus the worker's address) both sit under
   the root, and the root is recomputed from its inputs.
3. `payroll_audit_log` shows the root anchored, at a height after the pay date.
4. The transfer, decrypted with its view key, pays the paystub's net to that address.

Every step either passes or names what failed.

**Who can make which pack:**
- **The employer** can make all four scopes.
- **The worker** already holds their paystub. With the period proof the employer adds to it
  (path and salt), they can prove (1) to (3) on their own. Proving (4) needs the payment's view
  key, which the employer can include in the paystub, at the cost of the change-record leak
  above. *Open:* whether the worker can prove receipt from their own record instead. Its
  commitment appears in the transaction's outputs, and that needs checking against the SDK.

## 5. Completeness, and its limit

A whole-period pack proves the books are complete: the auditor recomputes the anchored root
from every entry. It cannot by itself prove that **no payment was made outside the books**.
Only the account's view key shows that, and Aleo view keys aren't time-limited: handing one
over reveals the account's whole history, forever.

So:
- A **full view key is for formal audits only**, through `audit_nft.aleo`'s dual consent.
- The **one-kind-per-wallet rule** helps: a business's Shield account holds only business
  money, so its view key exposes no one's personal finances.

## 6. Double payment

The vault guard already blocks an exact repeat and warns on a second run the same day. An
auditor sees any duplicate as two entries with two transfers in the period pack. No on-chain
guard is planned: it would wrap the transfer in a two-call function, which Shield can't prove.

## Order of work (one PR each)

1. **Ledger: period roots** (Opus). `periodRoot(...)` over entries and settlements, the
   salts, and inclusion proofs, with tests: tampering, a removed or duplicated entry, a
   settlement pointing at the wrong transfer or person, a wrong salt, odd-sized and empty
   periods. The settlement list is built from the payroll paychecks; the ledger takes it as
   input and never imports payroll or chain code.
2. **App: anchor on close** (Opus). **Close period** offers "Anchor this period on Aleo" (one
   Shield tap through `payroll_audit_log::anchor_event`). The tx id and height are kept on the
   period mark. This is the anchored mode's first real step and needs Joshua's greenlight for
   the screen.
3. **Audit pack export and the verify page** (Opus). Scopes one to three, with the verifier
   tested against a fixture pack, including failing ones.
4. **The worker's own proof** (Opus, after the SDK check in §4).
5. **`gl_core.aleo::anchor_period_root`** (Fable, Phase 1). Takes over from
   `payroll_audit_log`, same root format.
6. **Claims with a minimum group size** (Fable, Phase 4).
