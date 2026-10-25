# src/chain — everything that touches Aleo

The one folder allowed to import the wallet and Aleo packages. Pages reach it with a dynamic
`import("@/chain/…")`, so a person who never connects Shield never downloads it, and the ledger,
vault, reports and payroll never depend on it. `../fiat_boundary.test.ts` enforces both.

Every write goes through the wallet: the user sees in Shield what they are signing. Program and
transition names come from `@pnw/pnw-adapter` and `@pnw/config`, never typed here.

| Area | Files |
|---|---|
| Shield | `shield.ts`, `shield_route.ts`, `ShieldStatus.tsx`, `FeeChoice.tsx`, `balances.ts`, `AccountBalances.tsx` — the three ways in (extension, Shield's browser, the relay from a phone), fee mode, balances |
| Letters | `letters.ts`, `letter_reader.ts`, `letter_check.ts`, `compress.ts`, `decrypt.ts`, `parties_key.ts`, `thread.ts`, `thread_letters.test.ts` — sealing, sending and reading letters; the key two people share; posting to a conversation |
| Channels and people | `channels.ts`, `Channel.tsx`, `directory.ts`, `SendDirectory.tsx`, `groups.ts`, `coworkers.ts` — announcements, the coworker directory, group chats |
| Offers and agreements | `offer.ts`, `offer_files.ts`, `agreement_draft.ts`, `terms.ts`, `terms_contract.test.ts`, `acceptance.ts`, `OfferPanel.tsx`, `ReviseOffer.tsx`, `KeepOffer.tsx`, `WithdrawOffer.tsx` — the offer on chain and its terms in a letter |
| Hiring | `board.ts`, `Board.tsx`, `jobs.ts`, `JobPanel.tsx`, `applicants.ts`, `Applicants.tsx`, `applications.ts` — the public board, posting, applying, interviewing |
| Pay | `deliver.ts`, `PayPanel.tsx`, `PaystubDelivery.tsx`, `usePaystubDelivery.ts`, `receipts.ts`, `review_feed.ts`, `ReviewPanel.tsx`, `history_probe.ts` — one private transfer per person, the paystub as a letter, the wallet history as the bank feed |
| Setup | `business_registry.ts`, `RegisterBusiness.tsx`, `NameLookup.tsx`, `account_kind.ts`, `RailPanel.tsx`, `cards.ts`, `CardPanel.tsx` — names, the registry, one kind of account per wallet, the account's card (issued at setup, claimed or switched in Settings) |
| Hours and schedule | `HoursChange.tsx`, `hours_inputs.ts`, `PublishTeamSchedule.tsx`, `team_publish.ts`, `MailboxCheck.tsx`, `mailbox_scan.ts` — questioning hours, publishing the week to the team, reading what arrived |
| Events | `events.ts`, `event_reach.ts`, `SendEvent.tsx`, `AnswerEvent.tsx` — the calendar's key to each guest, an event sealed once to every guest, reading invitations (only the organizer's), answering |
| `work/` | The worker side of all of the above: `WorkShield.tsx`, `Inbox.tsx`, `Offers.tsx`, `CounterOffer.tsx`, `Apply.tsx`, `SendTimesheet.tsx`, `AnswerSchedule.tsx`, `HoursChange.tsx`, `Profile.tsx`, the coworker chat and directory, `execute.ts` |

Tests sit beside the files. The ones ending in `_contract.test.ts` pin canonical forms whose
bytes the chain or the other side depends on; change those only on purpose.
