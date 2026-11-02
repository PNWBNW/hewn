# Closing a period

**Status:** decisions for Joshua (2026-11-02). Nothing is built. No new Leo: it anchors through
the deployed `payroll_audit_log.aleo`. It adds a screen, so building it needs Joshua's
greenlight. It finishes Phase 1's last criterion (a month fed, categorized, reconciled and
sealed) and steps 24 to 29 of the sealed-month test (#224).

`docs/AUDIT_DESIGN.md` already fixes **what** a close commits to (the period root) and **how** it
is anchored (one `anchor_event`). This document is about **when and how a business closes**.

## What Joshua asked for (2026-11-02)

- **Close after the period is over, whenever the business is ready.** Nobody closes October at
  midnight on the 31st: the last bills arrive, the last payments clear, the review list is worked
  through in early November.
- **Choose the date range being closed.**

## The close, step by step

**Accounting → Close a period**, any day after the range's last day:

1. **Pick the range.** It starts the day after the last close (or the day the books start, for
   the first close) and can't skip or overlap. The business picks where it ends; the app suggests
   the end of the last full month. Joshua's first close would be **October 25 to October 31,
   2026**, since his books start on the 25th.
2. **The checklist.** Each line has to pass before the close button lights up:
   - **For review** has nothing waiting dated in the range.
   - **The Shield check says Matches** today. With everything in the range reviewed, a match today
     means the range matched too, since any later movement is recorded as well.
   - **No paycheck in the range is still settling.** A pending one can be waited on, or closed
     past with a warning: its settlement then lands in the next period's root (AUDIT_DESIGN §1).
   - **No draft dated in the range** (an unsent invoice, an unposted bill), or a warning naming it.
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

## What the root covers when the range isn't a calendar month

The root format (`HEWN::PERIOD::v1`) carries a `period_id`. For a range it becomes the range itself
(`2026-10-25..2026-10-31`). `prev_root` still chains each close to the one before. Entries belong
to a range by their date; settlements by the day their transfer confirmed. Both follow AUDIT_DESIGN.

## Reopening

A business sometimes has to fix a closed period: a late bill, a miscategorized expense.

- **Reopen** moves the close back to just before the chosen range, as the ledger already does
  (`reopenFrom`: reopening a range reopens everything after it). It is logged in the books.
- **The anchored root stays on chain**: it can't be removed, and it shouldn't be. Closing again
  anchors a new root for the range, and the proof export shows both, newest first: "anchored
  November 3, reopened November 9, anchored again November 10".
- **Lock** is the permanent version (`lockThrough`): no reopening, and entries in it can't be
  reversed. It's for after taxes are filed. Nothing locks automatically.

## Kept safe

- **`anchor_secret` and `business_tag`** (the salts behind the root; not built yet) are made at the
  first close, kept in the books, and travel in both backups (the file and the one kept with the
  account). Without them a proof can't be rebuilt after a restore.
- **The fee:** on testnet Shield covers it. On mainnet the anchor's fee payer is public, which
  shows the business anchored something that day (AUDIT_DESIGN §2). Private fees, still failing
  in Shield on testnet, would hide it.

## Questions for Joshua

1. **Which end dates?** (a) **Month ends only:** a close covers whole months, one or several (a
   quarter, or a catch-up of two). Simplest, and it keeps reports and taxes in calendar months.
   (b) **Any date:** e.g. every two weeks, or a 4-4-5 fiscal calendar. More flexible; the ledger's
   month-based close mark becomes a date. My pick is (a) now, with (b) later if a business asks.
   Note that a first close starts on the books' first day either way, so Joshua's October is
   October 25 to 31.
2. **The checklist:** must every line pass, or can the business close past a warning (a pending
   paycheck, a draft) after confirming it?
3. **Reopening:** allowed until locked (as above), or never once anchored?
4. **A reminder:** remind the business on the Dashboard to close last month, say from the 5th?
5. **Who signs:** the business's Shield only for now. When accountant access arrives (Phase 6),
   may an accountant close and anchor?
