---
status: plan
updated: 2026-11-18
summary: Each person is paid for their own pay period, starting the day after the last one they were paid for: the period rules for every frequency, missed periods caught up one paycheck each, new hires, failed paychecks paid by their own Retry, worked examples, and the pull requests that build it; the period rules, the default period, the paycheck with nothing to pay and the failed paycheck paid only by its own Retry are built; the catch-up runs and the screen next.
---

# Each person's own pay period

**Status:** decided (Joshua, 2026-11-15) and being built in small pull requests (the plan at the
end). Built so far: the period rules, `packages/payroll/src/pay_periods.ts`, with their tests (#363);
Run payroll's default period (#360); a paycheck with nothing to pay settling as it posts (#361);
a failed paycheck paid only by its own Retry (#362), the three merged on 2026-11-17. No
Leo program changes anywhere in this plan.

Until now Run payroll asked for one pay period for the whole run, and suggested the two weeks to
today. A weekly team, a person who missed a week and a new hire all got the same dates. From now
on **each person is paid for their own pay period, starting the day after the last one they were
paid for.**

## The design in brief

1. **A pay run is still one pay period.** A payday groups people by their exact period and posts
   one run per distinct period, oldest period first, all dated the one pay date. Usually that is
   one run; a missed week, or people on different frequencies, adds a run. Because a run stays
   one period, everything that reads a run's period (the paystub and its hash, the entry memo,
   the payments on the rail, the Pay runs list) stays as it is.
2. **Each person's next period starts the day after the last day any of their paychecks
   covers**, settled, pending or failed. It is one period of their pay frequency.
3. **Missed periods are caught up one paycheck per period.** Each is withheld as one period at
   the person's frequency, so the tax engine doesn't change. Year to date builds up in posting
   order (`yearToDate` already counts runs posted earlier on the same pay date), so the Social
   Security wage base and Additional Medicare land on the right paycheck, and a paystub rebuilt
   later sees exactly what posting saw.
4. **A failed paycheck is paid only by its own Retry, from the money it set aside.** A new
   paycheck over its days is refused, whatever is confirmed.
5. **Nothing new is stored.** Periods are worked out from the history every time, the same on
   every device. Payroll stays at version 1, old books open unchanged and every stored paystub
   hash rebuilds byte for byte.

## The rules

All of them are pure functions in `packages/payroll/src/pay_periods.ts`, on calendar days
(`YYYY-MM-DD`, UTC). Two devices with the same books get the same periods.

**Paid through** (`paidThrough`): the last day any of the person's paychecks covers, in any mode
and whatever its payment status.

- A pending paycheck counts: its payment may still land.
- A failed paycheck counts: its own Retry pays those days.
- A paycheck with nothing to pay counts: its days were paid for.
- Periods that overlap (the old two-week default paid weekly people in windows a week apart)
  simply join up; the next period starts after the latest last day.
- A run whose period can't be read is refused, not skipped: the books never guess where pay
  stops.

**One period from a day** (`periodFrom`):

| Frequency | One period from day S | Longest |
|---|---|---|
| Weekly | S to S+6 | 7 days |
| Every two weeks | S to S+13 | 14 days |
| Twice a month | S to the 15th if S is on or before the 15th, else S to the month's last day; then the 1st to the 15th and the 16th to the end | 22 days |
| Monthly | S to the month's last day; then calendar months | 44 days |

- **The fold.** A twice-a-month leftover under 7 days joins the next half (S = Feb 15, 2027
  gives Feb 15 to 28); a monthly leftover under 14 days joins the next month (S = Oct 31 gives
  Oct 31 to Nov 30). No paycheck pays for a few odd days on their own, and the period after a fold
  is on the calendar. The longest periods in the table are the longest a fold makes.
- February's second half is Feb 16 to 28, or Feb 16 to 29 in a leap year.

**A bridge** is a twice-a-month or monthly period that follows a paycheck which didn't end on the
calendar, starts off the calendar (not on the 1st, or the 16th twice a month) and is long enough
not to fold. It happens after runs from the old two-week default. That last paycheck paid a full
half or month whatever its dates, so:

- a salaried person's bridge starts **unticked**: only the business knows whether those days are
  owed;
- an hourly person's bridge is ticked: their timecards say what is owed.

**Where the next period starts:**

- **With history:** the day after paid through, or "Owed from" when the business moves it. Each
  later period starts the day after the last one ends. Owed from can't reach back over the days of
  a paycheck that failed.
- **Never paid, with teammates on the same frequency:** they join their teammates' period.
  - Weekly and every two weeks: the rhythm most active people on that frequency are paid in
    (people whose last periods are whole periods apart keep one rhythm; ties go to the latest).
  - Twice a month and monthly: the calendar.
  - Their first period is the one that holds their start date (the offer's start date; later, a
    "Pay starts" date on the team member), and their first paycheck counts from that date. Hourly
    pay comes from their timecards, which start then; salary for a shorter first period is a later
    pull request (prorated by calendar days).
  - Without a start date: the team's latest period that ends on or before the pay date.
- **Never paid, nobody else on that frequency:** with a start date, a full period from it
  (weekly or every two weeks) or the calendar half or month that holds it; without one, the
  latest whole period ending on the pay date.

**Due** (`duePeriods`): a period is due when it ends on or before the pay date.

- Due periods are listed oldest first, each its own paycheck: at most the **12 most recent**, and
  the card says how many earlier ones there are.
- Due periods that ended **more than 31 days** before the pay date start unticked (a return from
  leave, seasonal work).
- When nothing is due, the **next period is offered unticked** ("Pay it in this run"), for a
  business that pays the current period or pays ahead.
- "Pay starts" (later) is a floor: no period ending before it is offered, and the period it falls
  in counts pay from it.

**Only the tail is offered.** Leaving a due period unticked while paying a later one leaves it
behind: paid through moves past it. The confirm box lists every such period before posting, and
moving Owed from back offers it again.

**Frequency changes** (a revised offer): the next period is one period of the new frequency from
the day after paid through, ticked, with no bridge question and no proration. The card says
"First every-two-weeks period since their pay frequency changed."

**Salary** is one period's salary per paycheck, whatever the period's length, as today. A later
pull request prorates by calendar days the paychecks that pay fewer days than their full period:
a first paycheck counted from a start date inside the period, and a ticked salaried bridge.

**Withholding:** each paycheck is one period at the person's frequency, through the unchanged tax
engine; W-4 step 4c is added to each. The tax year and the Form 941 quarter follow the pay date,
so a December period paid in January counts in January. The IRS treatment of a late paycheck's
withholding is checked against irs.gov before mainnet.

## Failed and pending paychecks

The period rules count these days as paid; pull requests 4 and 5 hold posting to the same rules.

- **A failed rail paycheck is paid by its own Retry**, in its own run, from the money its first
  try set aside, so it can only be paid once. Its paystub and entry keep their pay date.
- Its days count as paid: the next period starts after them, and Run payroll points to the
  Retry ("Open that run").
- From pull request 4, a new paycheck that shares a day with a failed one is refused, and no
  confirmation lets it through. Owed from can't be moved back over those days either: the period
  rules refuse that already.
- A pending paycheck's days count as paid too. From pull requests 4 and 5, a new paycheck over
  them at the same amount is refused; at another amount, it is asked about before posting.
- A failed paycheck that is never retried stays owed, keeps its entry, year to date and 941
  amounts, and keeps its pay date from closing, as today.

## Worked examples

Weekly periods below run Sunday to Saturday: Nov 7, 14 and 21, 2026 are Saturdays. The periods in
each example are tests in `packages/payroll/src/pay_periods.test.ts`; the amounts after proration
come with that pull request.

**A. A weekly payer missed one week.** Ana and Ben are weekly and hourly. The run of Nov 7 paid
both for Nov 1 to 7; the run of Nov 14 paid only Ben, for Nov 8 to 14.

- On Run payroll with pay date Nov 21, Ana is paid through Nov 7 and owed Nov 8 to 14 ("Missed")
  and Nov 15 to 21, each with that week's timecard hours. Ben is owed Nov 15 to 21.
- Posting gives two runs dated Nov 21: Nov 8 to 14 (Ana), then Nov 15 to 21 (Ana and Ben). Ana's
  second paycheck counts her first in year to date; each is withheld as a weekly paycheck.
- **Books from the old two-week default** (runs Oct 25 to Nov 7 and Nov 1 to 14): paid through
  Nov 14, so the next period is Nov 15 to 21. Nothing overlaps, nothing is asked.

**B. Every two weeks.** Cal is salaried every two weeks at $52,000 a year ($2,000.00 a paycheck),
paid for Nov 1 to 14 on Nov 14.

- On Nov 21 nothing is due: "Paid through Nov 14. Their next period, Nov 15 to Nov 28, ends after
  this pay date.", with "Pay it in this run" unticked.
- On Nov 28 his period is Nov 15 to 28. Ana and Ben's Nov 22 to 28 makes a second run that day:
  one per pay period.
- Left out on Nov 28, on Dec 12 he is owed Nov 15 to 28 and Nov 29 to Dec 12: two paychecks of
  $2,000.00.

**C. Twice a month across February.** Dee is salaried twice a month at $60,000 a year ($2,500.00
a half), paid for Jan 16 to 31, 2027.

- Pay date Feb 15 pays Feb 1 to 15. Pay date Feb 28 pays Feb 16 to 28: 13 days, a full half,
  $2,500.00. In 2028 that half is Feb 16 to 29.
- If she missed Feb 15, the Feb 28 payroll pays Feb 1 to 15 and Feb 16 to 28, two runs.
- **From the old default** (last run Feb 1 to 14, 2027, a full half paid): Feb 15 alone is under
  7 days, so it folds: Feb 15 to 28 for $2,500.00, with no question.
- **A monthly person in the same position** (last run Nov 1 to 14, 2026, a full month paid):
  Nov 15 to 30 is 16 days, so it doesn't fold. It is a bridge: unticked for salary, ticked for
  hourly pay. On Dec 31 the card lists Nov 15 to 30 (unticked) and Dec 1 to 31 (ticked); paying
  December leaves the bridge behind, and the confirm box says so.

**D. A new hire mid-period.** Eve is weekly and hourly, starting Wednesday Nov 18; Ana and Ben's
current period is Nov 15 to 21.

- Eve's first period is Nov 15 to 21, her pay counted from Nov 18 (her timecards start then). She
  is in the same run as Ana and Ben on Nov 21: one run, not two.
- Fay, weekly at $52,000 starting the same day, has the same period counted from Nov 18; with the
  later proration her first paycheck is 4 of 7 days, $571.43.
- Gil, twice a month at $60,000 starting Nov 18: Nov 16 to 30, counted from Nov 18 (later, 13 of
  15 days, $2,166.67).
- If nobody else is weekly, Eve's first period is Nov 18 to 24 and her rhythm continues from
  there.

**E. A rail paycheck that failed last week.** Gus is weekly. In the run of Nov 14 (Nov 8 to 14, on
the rail), Shield turned his transfer down, and the paycheck is failed.

- On Nov 21 Gus is paid through Nov 14: the failed paycheck still covers its days. His card offers
  Nov 15 to 21, with "Their paycheck for Nov 8 to Nov 14 failed (run of Nov 14). Retry it there: it
  spends the money that payment set aside, so it can only be paid once." and "Open that run".
- Moving Owed from back to Nov 8 is refused.
- Retry, in the run of Nov 14, pays it once. The paystub and entry keep the Nov 14 pay date.

## Old books

- They open unchanged; nothing is migrated or written on load.
- Every old paycheck's period is its run's, which is exactly this model, so every stored paystub
  hash rebuilds.
- Gaps between old runs aren't looked for: a two-week window from the old default may have paid a
  weekly person for one week of timecards. Such a gap can be paid by moving Owed from back, which
  asks first.
- For hourly people, the evidence of unpaid work is timecard hours dated before their next period
  that no paycheck paid; the card says so ("This payroll doesn't pay days already paid").

## Trade-offs

- **More runs on some paydays.** Catch-ups and mixed frequencies cost one more approval in Shield
  per extra run, and more run cards on one date.
- **Separate weekly rhythms stay separate.** Weekly or every-two-weeks people whose histories give
  different rhythms get separate runs every payday until Owed from brings them together.
- **A salaried twice-a-month or monthly bridge asks once per person** after runs from the old
  default.
- **Only the tail is offered.** A period skipped by mistake is offered again only if someone moves
  Owed from back. The confirm box lists it.
- **Retry keeps the old pay date,** so a retry across a quarter or year end counts in the old
  quarter.
- **Catch-up paystubs on one pay date share a ring number** in the person's paystub art until the
  rings number by period end (pull request 10).

## The pull requests

Each has one task and one exit criterion.

- [x] 1. **Run payroll: the default period starts after the last run** (the screen's default,
      with the next release).
- [x] 2. **payroll: a paycheck with nothing to pay doesn't hang** (settles when it posts; no
      longer holds up a close).
- [x] 3. **payroll: each person's pay periods** (the pure rules above, no screen): for every
      frequency, history shape and edge case in its tests, `duePeriods` returns exactly the
      expected periods.
- [x] 4. **payroll: a failed paycheck is paid only by its own Retry** (a new paycheck over its
      days is refused; a repost already in the books is asked about before Retry pays).
- [ ] 5. **payroll: one payday, one run per pay period** (`postPayRuns`: catch-up runs on one pay
      date, all or nothing).
- [ ] 6. **Run payroll: each person's own pay period** (the screen; its sentences come to Joshua
      first).
- [ ] 7. **payroll: salary for a shorter period**, prorated by calendar days.
- [ ] 8. **Team: when pay starts** (the "Pay starts" date, a floor for a person's periods).
- [ ] 9. **Replace a failed paycheck** in a later payroll (approved, may come later; Retry is the
      way until then).
- [ ] 10. **Paystubs that read apart:** the worker's list shows the period, and the rings number
      by period end.

Order: 1 with the next release, then 2 and 3 (either order), 4, 5, 6; then 7, 8 and 9; then 10.

## Decided (Joshua, 2026-11-15)

- A failed rail paycheck is paid by its own Retry; replacing it in a later payroll may come later.
- One run per period, on one pay date.
- Periods are due when they end on or before the pay date; the next one is offered unticked.
- Twice a month is the 1st to the 15th and the 16th to the end; monthly is the calendar month;
  short leftovers fold.
- A new hire on weekly or every-two-weeks pay joins their teammates' period, with pay counted from
  their start date.
- Salary for a shorter period is prorated by calendar days (a later pull request).
- A "Pay starts" date on team members, later.
- At most 12 missed periods listed; those that ended more than 31 days ago start unticked.
- Pay for days already paid is left out.
- The IRS treatment of late-paycheck withholding is checked on irs.gov before mainnet.
