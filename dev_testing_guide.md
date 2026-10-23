# Dev testing guide

For developers using the app itself. Each scenario here is one we think could cause problems, or
whose exact outcome we're not sure of. Pick one, try it in the app, then post what happened as a
comment on that area's GitHub issue (linked under each heading), so every scenario builds up a
record of who tried it, where, and what they saw. Each scenario says what to do and what should
happen; anything else is a finding. The **Break it** lines are where we'd look first if we were
trying to make it fail. The automated tests (`pnpm test`) cover the logic; this covers what they
can't: real wallets, real phones, the chain, and someone trying to cheat.

Scenarios have ids (`PAY-2`) so a comment can name the one it's about.

## Before you start

- **Testnet only.** Don't put real books, real names, real wages, real bank details or real
  addresses into Hewn. Make up a business and its people.
- **Never paste a private key, view key, seed phrase or passphrase** into the app, an issue, a
  chat or an email. Hewn never asks for one. A screen that does is a finding in itself.
- **Wallet:** Shield on Aleo testnet, as the browser extension on a computer and the Shield app on
  a phone. You'll need testnet ALEO for fees and testnet USDCx for pay runs and the job board.
- **Accounts:** Shield allows one kind of Hewn account per wallet account (a business or a
  person, never both). Make at least these, each with its own Shield account:

  | Name here | Kind | Plays |
  |---|---|---|
  | Business A | business | the employer |
  | Worker 1, Worker 2 | person | A's team |
  | Worker 3 | person | someone A never hired |
  | Business B | business | another employer, or someone trying to pass as A |

- **Where:** the website (www.hewnaccounting.com) on a computer and on a phone, inside Shield's
  own browser, in a plain phone browser (which pairs with the Shield app), and the installable
  bundle (`pnpm --filter @pnw/business build:static`, then serve `apps/business/out/`).
- Note the date, the time and the commit on `main` you tested, so a finding can be reproduced.

## Posting your results

1. Find the area's issue (linked under each heading below; all of them carry the
   [`manual-test`](https://github.com/PNWBNW/hewn/issues?q=label%3Amanual-test) label).
2. Post **one comment per scenario you tried**, starting with its id:

   ```
   Scenario: PAY-2
   Tested: <date>, commit <short sha on main>
   Device / browser / wallet:
   Account kinds used:
   Result: as expected | different | couldn't test
   What happened (if different, or why not tested):
   Transaction ids (public, fine to share):
   ```

3. "As expected" is worth posting too: it tells us the scenario has been tried, and where.

**Comments are public.** Anything that exposes someone's data, moves money wrongly, or lets one
account pass as another goes privately through the repository's **Security** tab (see
[`SECURITY.md`](SECURITY.md)), never in a comment. Never post a key, seed phrase, passphrase or backup file, and blur accounts in screenshots. From inside
the app, the Report button on any message sends it to Hewn as a sealed letter, and you can copy it
to hewnsupport@gmail.com.

| How bad | Looks like |
|---|---|
| Critical | someone reads or changes what isn't theirs; a payment goes twice or to the wrong account; a key or passphrase shows up anywhere |
| High | a check can be passed by an impostor; books lost or locked for good; a forged message believed |
| Medium | wrong figures in the books, taxes or a paystub; a screen showing the wrong state |
| Low | wording, layout, slowness |

## 1. Accounts and logging in (`ACC`)

Results: [#150](https://github.com/PNWBNW/hewn/issues/150)

- **ACC-1 New business.** Make an account with a username and a passphrase, link Shield, register
  a `name.hewn`. *Expect:* the app keeps you on setup until all three are done, then opens the
  books.
- **ACC-2 New person.** The same as Worker 1, plus the worker profile. *Expect:* the work screens.
- **ACC-3 One kind per wallet.** With Business A's Shield account, try to set up a person's
  account. *Expect:* refused. And the reverse.
- **ACC-4 One username, two kinds.** Use the same username for a business and a person (each with
  its own Shield account). *Expect:* two separate sets of books.
- **ACC-5 Wrong passphrase.** *Expect:* refused, with nothing opened or changed.
- **ACC-6 Stay logged in.** Tick it, close the browser, come back within 24 hours. *Expect:* the
  books open without the passphrase. After 24 hours, or after Log out: the passphrase again.
- **ACC-7 Idle lock.** Without "stay logged in", leave the books open 15 minutes, or reload.
  *Expect:* locked.
- **Break it:** a passphrase under 10 characters; the same passphrase typed with look-alike
  Unicode; a very long username; an email as the username; Log out and close the tab at once,
  then reopen (known gap: it may still be logged in, see the end).

## 2. Books, backups and tabs (`VAULT`)

Results: [#151](https://github.com/PNWBNW/hewn/issues/151)

- **VAULT-1 Backup and restore.** Settings → Download a backup; in a fresh browser profile,
  Restore from a backup with the same passphrase. *Expect:* the same books.
- **VAULT-2 Restore, wrong passphrase.** *Expect:* refused; the books on that device untouched.
- **VAULT-3 Doctored backup.** Open a backup file in a text editor and change it: the `iterations`
  number to 4000000000, the `format`, a few characters of the encrypted data. *Expect:* each is
  refused straight away ("isn't a books backup from this app"), never a spinner that runs for
  hours.
- **VAULT-4 Two tabs.** Open the same books in two tabs and save a change in each. *Expect:* the
  second says "These books changed in another tab or window, so nothing was saved here", and
  nothing is lost.
- **VAULT-5 Offline.** With the network off, the books (sales, expenses, reports) still work;
  screens that need the chain say so.
- **Break it:** clear the site's data in the middle of a save; a private window; a browser that
  blocks storage; a backup from one account restored into another.

## 3. Names and finding people (`NAME`)

Results: [#152](https://github.com/PNWBNW/hewn/issues/152)

- **NAME-1 Find.** Look up a business and a person by `name.hewn`, by bare name, and by `aleo1…`
  account. *Expect:* only exact names are found.
- **NAME-2 Look-alikes.** Register `a1ice` while `alice` exists. *Expect:* the app always shows
  exactly the registered name, so the two can't be confused on screen.
- **Break it:** upper case, a leading `@`, the old `.pnw` suffix, a Cyrillic `а` in place of a
  Latin `a`, 2 or 17 characters (names are 3 to 16 of `a–z`, `0–9`, `_`).

## 4. Offers and agreements (`OFFER`)

Results: [#153](https://github.com/PNWBNW/hewn/issues/153)

- **OFFER-1 Hire.** Business A offers Worker 1 by name. Worker 1 sees the terms, sends a
  counter-offer, A revises, Worker 1 accepts. *Expect:* each step arrives on the other side, and
  both agree on the final terms.
- **OFFER-2 A long letter.** An offer letter near 20,000 characters, including emoji and
  non-Latin text. *Expect:* it arrives whole, or the app says it's too long before sending. It
  never arrives cut short.
- **OFFER-3 Not yet accepted.** Business A offers Worker 3, who doesn't answer. *Expect:* Worker 3
  can't be paid on the rail: "Can't be paid on the rail until they accept their offer".
- **Break it:** Business B uses Business A's display name and sends Worker 1 an offer. *Expect:*
  Worker 1 sees B's registered name, never A's.

## 5. Messages with the business (`MSG`)

Results: [#154](https://github.com/PNWBNW/hewn/issues/154)

- **MSG-1 Both ways.** Business A and Worker 1 message each other. *Expect:* every message
  arrives, in order, after checking messages.
- **MSG-2 Report.** Report a message. *Expect:* Hewn's account receives it as a letter, and the
  copy for email works.
- **MSG-3 The handshake.** Business A and Worker 1 each send one message and check. *Expect:* the
  conversation's subtitle changes to "Sealed with a key only the two of you hold", with no extra
  letter or Shield approval, and every message before and after stays in the thread, in order.
  Then restore Worker 1's books from a backup made *before* the handshake: *expect* Worker 1 can
  still message, and after one message each way the subtitle comes back.
- **Break it:** HTML or a `<script>` in a message (shown as plain text?); a message sent while the
  other side's phone is offline; a very long message.

## 6. Coworkers (`CW`)

Results: [#155](https://github.com/PNWBNW/hewn/issues/155)

- **CW-1 Opt in.** Worker 1 and Worker 2 each let coworkers find them at Business A; A checks its
  messages. *Expect:* each sees the other, and under the name "`name.hewn` · confirmed on chain"
  with that person's real registered name.
- **CW-2 Talk.** Message both ways, and make a group with three people. *Expect:* it works, and
  Business A has no way to read any of it.
- **CW-3 Safety code.** Open the code on both phones side by side. *Expect:* the same 30 digits.
- **CW-4 Leave.** Worker 2 stops letting coworkers find them. *Expect:* they drop off the list.
- **CW-5 No chain.** Open the coworker list offline. *Expect:* "not confirmed", never a wrong
  name.
- **Break it (needs a changed copy of the app):** make Business A's app list its own account, or
  Worker 3's, as Worker 2. *Expect:* Worker 1 sees a red warning ("a business's account, not a
  person's") or Worker 3's real name, never Worker 2's. The safety codes no longer match.

## 7. Announcements (`ANN`)

Results: [#156](https://github.com/PNWBNW/hewn/issues/156)

- **ANN-1 Post.** Business A makes a channel, adds Workers 1 and 2, and posts. *Expect:* both
  receive it, and the channel shows Business A's registered name "· confirmed on chain".
- **ANN-2 Team schedule.** Publish a week's schedule to a big team. *Expect:* it arrives in parts
  and shows only once every part is in.
- **ANN-3 Remove someone.** Take Worker 2 out, then post. *Expect:* Worker 2 can't read the new
  post.
- **Break it:** a member holds the channel's key; from their own account, post into the channel
  (needs a changed app). *Expect:* nobody sees it, because posts count only from the business's
  account.

## 8. Shared calendar (`EVT`)

Results: [#157](https://github.com/PNWBNW/hewn/issues/157)

- **EVT-1 Business invites.** Business A invites its team. Each invitation shows the organizer's
  registered name "· confirmed on chain". Workers answer Going, Maybe or No.
  *Expect:* A sees the answers. Change the time: *expect* everyone is asked again.
- **EVT-2 Coworker invites.** Worker 1 invites Worker 2. *Expect:* the same.
- **EVT-3 Many guests.** A guest list too long for one letter. *Expect:* every guest gets the
  invitation.
- **Break it:** a guest (who holds the event's key) sends a changed version from their own
  account. *Expect:* ignored. An event link starting `javascript:` or `http://`. *Expect:*
  refused (links must be `https://`).

## 9. Hours, schedules and paystubs (`WORK`)

Results: [#158](https://github.com/PNWBNW/hewn/issues/158)

- **WORK-1 Hours.** Worker 1 clocks in and out and sends a timesheet. *Expect:* Business A gets it,
  and changed hours need both sides to agree.
- **WORK-2 Paystub.** After a pay run, Worker 1 gets a paystub. *Expect:* its figures match the
  run, and only Worker 1 and Business A can see it. Try it both before and after the two have
  exchanged a message each (MSG-3): it arrives either way.
- **Break it:** clocking across midnight, a time-zone change, daylight saving, a shift over 24
  hours.

## 10. Pay runs (`PAY`): money moves here

Results: [#159](https://github.com/PNWBNW/hewn/issues/159)

- **PAY-1 Pay.** Business A runs payroll for Workers 1 and 2 on the rail. *Expect:* Shield asks
  for each payment, the money arrives, and the paystubs go out.
- **PAY-2 Never twice.** Approve a payment in Shield, then straight away close the tab, or turn
  the network off. Reopen the run. *Expect:* "Not confirmed", with "Check Shield history". Pay
  again only through "Pay again anyway", after checking. Nothing may ever send a second payment
  for the same paycheck on its own.
- **PAY-3 Short.** A run bigger than the balance. *Expect:* refused before Shield is asked.
- **PAY-4 Rejected.** Reject a payment in Shield. *Expect:* marked failed, with Retry.
- **PAY-5 Two tabs.** Start the same run in two tabs. *Expect:* each person is paid once.
- **PAY-6 Private fees.** Switch private fees on, pay, and look the transaction up on the
  explorer. *Expect:* no sender account in the fee.
- **Break it:** switch Shield to another account in the middle of a run; airplane mode between
  approving and confirming; approve one payment and reject the next; a person removed from the
  team while a run is open.

## 11. Job board (`JOB`)

Results: [#160](https://github.com/PNWBNW/hewn/issues/160)

- **JOB-1 Post.** Business A posts a job ($1 in USDCx), features it ($5 a day, up to 30 days),
  edits it and closes it.
- **JOB-2 Apply.** Worker 3 applies with a résumé. *Expect:* Business A sees the application with
  Worker 3's real registered name, and can reply.
- **JOB-3 Lost answer.** Post a job, then lose the network right after approving in Shield.
  *Expect today (known gap):* the $1 may be spent with no saved posting, and posting again pays
  again. Evidence welcome.
- **Break it:** apply while claiming another person's name (needs a changed app). *Expect:*
  counted as an impostor and not shown as that person.

## 12. The books (`BOOKS`)

Results: [#161](https://github.com/PNWBNW/hewn/issues/161)

- **BOOKS-1** Invoices, estimates, bills, transactions, projects: every entry balances (debits
  equal credits), and reports tie out to the transactions.
- **BOOKS-2** Taxes: the figures are labelled as testnet estimates, not advice.
- **Break it:** cents and rounding, negative and very large amounts, February 29th, the last day
  of the year, deleting something another entry uses, importing a messy file.

## 13. Phones and wallets (`DEV`)

Results: [#162](https://github.com/PNWBNW/hewn/issues/162)

- **DEV-1** The Shield extension on a computer.
- **DEV-2** Shield's own browser on a phone.
- **DEV-3 A plain phone browser.** It pairs with the Shield app over Shield's relay: every
  approval opens the app, and reads only work while the app is open. **Never tried on a real phone
  yet, so this is the most valuable test on this page.**
- **DEV-4** A computer without the extension. *Expect:* no way in yet, and a clear message.
- **DEV-5** The installable bundle: everything above that doesn't need a server.

## 14. Privacy: what must never show (`PRIV`)

Results: [#163](https://github.com/PNWBNW/hewn/issues/163)

- **PRIV-1 The chain.** Look up your transactions on the explorer. *Expect:* no amounts, names,
  memos or accounts in public state; with private fees, no sender either.
- **PRIV-2 The network.** Watch the browser's network panel while you use the app. *Expect:*
  explorer reads, Shield's relay, `/api/count` carrying only `{"first": true|false}`, and page
  views with no query strings. Nothing else, and nothing personal.
- **PRIV-3 The device.** Look at local storage and IndexedDB. *Expect:* no books in local storage,
  and the vault encrypted.
- **PRIV-4 Traction.** `/traction` shows totals only, and no country under 5 visitors.

## 15. The web side (`WEB`)

Results: [#164](https://github.com/PNWBNW/hewn/issues/164)

- **WEB-1** Put `<b>`, `<img src=x onerror=alert(1)>` and `<script>` into every text box: names,
  memos, messages, offer letters, event notes, job descriptions. *Expect:* always shown as plain
  text, never run.
- **WEB-2** Load the website inside an `<iframe>` on another site. *Expect:* refused. (The
  installable bundle can't set this rule itself.)
- **WEB-3** Restore, upload or import files that aren't what they claim: an empty file, a huge
  one, a picture renamed `.hewn`.

## Known gaps

These are known and on the list, so they aren't new findings, but evidence of their impact is
welcome. The accepted risks are in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

- The traction counts can be inflated by anyone, and the totals can hint at a country's only
  visitor (waiting for more data).
- Between a business and the people it hired, a view key opens both locks on their letters; the
  other conversations need a second key from the person's vault. A fix is planned.
- Conversation keys don't rotate yet.
- Log out can be undone by closing the tab at the same moment (ACC).
- A job post whose answer from Shield is lost (JOB-3).
- Background page loads (prefetches) don't carry the security policy.
- No size limit when unpacking a letter (parked: low risk).
