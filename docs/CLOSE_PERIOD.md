---
status: built
updated: 2026-11-05
summary: Closing a period through any date after it ends, once every check passes, the root anchored through `payroll_audit_log`, reopening and locking, and the period proof with a public page anyone can check it on.
---

# Closing a period

**Status:** decided (Joshua, 2026-11-02) and built: closing by date and the period root (#272);
Transactions → Close the books, the checklist, the anchor, reopen, lock and the Dashboard reminder
(`books/close.ts`, `books/ClosePanel.tsx`, `chain/CloseShield.tsx`); the period proof, exported
from each close, and the page anyone checks it on (2026-11-05, "The period proof" below). No new
Leo: it anchors through the deployed `payroll_audit_log.aleo`. What's left of Phase 1's last
criterion (a month fed, categorized, reconciled and sealed) is a real close on testnet, and
steps 24 to 29 of the sealed-month test (#224).

`docs/AUDIT_DESIGN.md` already fixes **what** a close commits to (the period root) and **how** it
is anchored (one `anchor_event`). This document is about **when and how a business closes**.

## What Joshua asked for (2026-11-02)

- **Close after the period is over, whenever the business is ready.** Nobody closes October at
  midnight on the 31st: the last bills arrive, the last payments clear, the review list is worked
  through in early November.
- **Choose the date range being closed,** down to the day: a business may close part of a month
  without waiting for its end.

## The close, step by step

**Transactions → Close the books**, any day after the range's last day:

1. **Pick the range.** It starts the day after the last close (or the day the books start, for
   the first close) and can't skip or overlap. The business picks the **end date, any day before
   today** (Joshua, 2026-11-02): the end of a month, a quarter, or the 15th, so part of a month can
   be closed without waiting for its end. Today is never closable, since entries can still land
   in it. The app suggests the end of the last full month. Joshua's first close would be
   **October 25 to October 31, 2026**, since his books start on the 25th.
2. **The checklist. Every line must pass; there is no closing past a warning** (Joshua,
   2026-11-02). Each line that fails says what's left and links to it:
   - **For review** has nothing waiting dated in the range.
   - **The Shield check says Matches** today. With everything in the range reviewed, a match today
     means the range matched too, since any later movement is recorded as well.
   - **No paycheck in the range is still settling.** Wait for it to confirm, or resolve it.
   - **No draft dated in the range** (an unsent invoice, an unposted bill): send, post or delete it.
3. **Review screen.** The range, entry counts, totals (income, expenses, the cash and Shield
   balances at the end date), and exactly what goes on chain: one 32-byte hash and the block
   height it lands in. No amounts, names or accounts.
4. **Close and anchor.** The books compute the period root, mark the range closed, and ask Shield
   to sign `payroll_audit_log::anchor_event(root)`. The root and the transaction id are kept in
   the books.
5. **Afterwards:**
   - **New entries dated in a closed range are refused.** The message says which range is closed
     and offers to date the entry in the open period instead.
   - **The period's proof can be exported** (AUDIT_DESIGN §4, "a whole period"). It recomputes to
     the anchored root and covers every entry, cash entries included.

If Shield's signature fails or is cancelled, the books stay closed and the anchor is offered again
("Not on chain yet: anchor now"), so a close never half-happens.

## Closing by date: what changes underneath

- **The ledger's marks become dates.** Today `@pnw/ledger` closes and locks through a month
  (`closedThrough: "2026-10"`). They become `closedThrough` and `lockedThrough` as dates
  (`"2026-10-31"`), and `closeThrough`, `reopenFrom` and `lockThrough` take dates. A month mark in
  books made before the change reads as that month's last day, so nothing already closed moves.
  Reports keep showing calendar months; closing is separate from how reports group.
- **The root's `period_id` is the range** (`2026-10-25..2026-10-31`) in the root format
  (`HEWN::PERIOD::v1`). `prev_root` still chains each close to the one before. Entries belong to a
  range by their date; settlements by the day their transfer confirmed. Both follow AUDIT_DESIGN.

## The period proof

**Export proof**, on each close that stands, saves one file (`<business>-period-proof-<start>-to-<end>.json`,
through the share sheet on a phone). It holds every entry of the range in full with its salt,
every payment's settlement (transaction id, the address paid) with its two salts, the business
tag, the previous root, the accounts the entries name, and every close of the range, newest
first, with its anchor. It never holds the anchor secret. It does hold wages and the addresses
paid, so the panel says to give it only to an accountant or an auditor. Export is refused when
the books no longer give the root that was closed.

**Check a proof** (`/verify`, public, no account) reads the file on the device and never uploads
it. The file's half (`@pnw/ledger` `checkPeriodProof`): every entry hashes to its recorded hash,
every entry is dated in the range and in journal order, and everything recomputes to the root.
Then the chain's half (`chain/period_check.ts`), only if the file passes: the root is in
`payroll_audit_log`'s `audit_event_height`, the block it landed in came after the range ended,
and every payment's transaction is on chain. The only things looked up are the root and the
transaction ids, both already public. Every line passes or says what failed.

**Not in it yet:** each payment's view key, which would let the checker see that a transfer paid
the paystub's net to that address (AUDIT_DESIGN §3, check 4); the one-paycheck and worker's-year
scopes. Both come with AUDIT_DESIGN's step 3 for those scopes.

## Reopening

A business sometimes has to fix a closed period: a late bill, a miscategorized expense.
**Reopening is allowed until a range is locked** (Joshua, 2026-11-02).

- **Reopen** moves the close back to just before the chosen range, as the ledger already does
  (`reopenFrom`: reopening a range reopens everything after it). It is logged in the books.
- **The anchored root stays on chain**: it can't be removed, and it shouldn't be. Closing again
  anchors a new root for the range, and the proof export shows both, newest first: "anchored
  November 3, reopened November 9, anchored again November 10".
- **Lock** is the permanent version (`lockThrough`): no reopening, and entries in it can't be
  reversed. It's for after taxes are filed. Nothing locks automatically.

## The reminder

From the 5th of each month, the Dashboard reminds the business to close the previous month if it
isn't closed yet (Joshua, 2026-11-02), with a link to Close a period. It goes once the close is
done, or once the business closes past that month's end.

## Who closes

The business, signing in its own Shield. Accountants don't have access to the books yet; how they
might is a separate question (`docs/ACCOUNTANT_ACCESS.md`, to be written).

## Kept safe

- **`anchor_secret` and `business_tag`** (the salts behind the root; not built yet) are made at the
  first close, kept in the books, and travel in both backups (the file and the one kept with the
  account). Without them a proof can't be rebuilt after a restore.
- **The fee:** on testnet Shield covers it. On mainnet the anchor's fee payer is public, which
  shows the business anchored something that day (AUDIT_DESIGN §2). Private fees, still failing
  in Shield on testnet, would hide it.

## Decisions (Joshua, 2026-11-02)

1. **End dates:** any date before today, so part of a month can be closed.
2. **The checklist:** every line must pass; no closing past a warning.
3. **Reopening:** allowed until locked.
4. **The reminder:** yes, from the 5th.
5. **Accountants:** not yet; access to the books is its own design, to brainstorm separately.
