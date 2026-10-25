# src/books — the books, without the chain

The models behind every screen, as pure TypeScript: given the vault's contents, what does the
screen show, and what does a tap change. No network, no wallet, no Aleo. If a function here needed
the chain it would live in `../chain` instead, and the boundary test would say so.

Naming: `thing.ts` holds the model, `thing.test.ts` its tests, `Thing.tsx` a component built on it.
Most files pair up that way. The ones worth knowing first:

| File | What it holds |
|---|---|
| `account.ts`, `setup.ts`, `BooksProvider.tsx`, `BooksGate.tsx` | Opening the vault with email and passphrase; the setup flow; the React context every page reads |
| `company.ts` | The business's record: books, payroll, rail links, mailbox, schedule, all in one |
| `work.ts` | The worker's record: agreements, punches, sent timecards, paystubs, threads |
| `thread.ts` | The conversation between a business and one person: every kind of message, who may send which, how offers are negotiated |
| `mailbox.ts`, `mailbox_feed.ts` | What arrived for the business: weeks of hours, combined per week; the feed the screens show |
| `hours.ts`, `work_week.ts`, `timecard_pay.ts`, `hours_change.ts` | Shifts from punches on the agreement's calendar; overtime and callouts; timecards into pay; changing hours by agreement |
| `schedule.ts`, `team_schedule.ts`, `team_sources.ts`, `TeamCalendar.tsx` | Drafts, publishing a week, the team calendar everyone sees |
| `events.ts`, `shared_events.ts`, `event_contacts.ts`, `EventPanel.tsx`, `EventDetailsList.tsx`, `SharedEventViews.tsx` | Events on the calendar: personal ones, ones with guests (organized or invited to), who can be invited, the pop-up and the "Waiting for your answer" list |
| `offer_letter.ts`, `terms_words.ts`, `review.ts`, `hiring.ts`, `jobs.ts`, `applications.ts`, `resume.ts` | Offers and their terms in words; hiring and the job board as the vault keeps them |
| `channels.ts`, `directory.ts`, `groups.ts` | Announcement channels, the coworker directory, group chats |
| `paystub_document.ts` | The paystub as a document: the canonical form whose hash the chain sees |
| `card.ts`, `credential.ts`, `paystub_rings.ts` | The account's card as the vault remembers it; a credential (its document, whose hash the record carries, and the landmarks a person's land draws from theirs); a paystub's place in its year for the rings |
| `rail.ts`, `funds.ts`, `opening.ts`, `tags.tsx`, `display.tsx` | Links to people on the rail; set-asides; opening balances; dimensions; formatting |
| `reconcile.ts`, `ShieldCheck.tsx` | The books' Shield account against what Shield holds (the stablecoin only; cash never enters it), and how the Dashboard shows it |

Everything here is covered by tests; run them with `pnpm --filter @pnw/business test`.
