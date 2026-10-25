# The books backed up on chain: design

**Status:** design, approved by Joshua on 2026-10-26 (decisions at the end). Being built in the order below. No new Leo: it uses the
letters program already live (`hewn_letters_v2`). Approach chosen by Joshua on 2026-10-26: the
books are compressed before they're encrypted, and after the first full copy only the changes are
sent.

## Why

The books live only in the browser that holds them (`docs/THREAT_MODEL.md` T19). On a phone the
way in is Shield's own browser, and that browser:
- lost its storage in a Shield update around 2026-10-23, taking two accounts' books with it;
- can't save a file. There is no share sheet, and a download goes nowhere (2026-10-26).

So on a phone, the only backup that can work is one that leaves the browser through the wallet
itself: letters to the account's own account, which the same wallet finds again on any device.

## What it does

- **Back up:** the books go out as one or more letters to your own account, encrypted so that
  only your username plus your passphrase (or your recovery key) opens them. Each page is one
  Shield approval.
- **Restore:** on any device, connect the same wallet, give your username and passphrase. The app
  finds the backup letters among your own letters, opens them, rebuilds the books, and opens them.
- **After a lost browser:** a login that finds no books here, with Shield connected, offers
  **Look for your books on chain**, so today's dead end becomes one more tap.

## The format

### A chain of pieces

A backup is a **chain**: one **snapshot** (the whole books), then **changes** (what's new since
the piece before), each naming the hash of the state it builds on.

```
snapshot  seq 0   state S0 = the books, whole           names: (nothing)
change    seq 1   S1 = S0 + what changed since           names: hash(S0)
change    seq 2   S2 = S1 + what changed since           names: hash(S1)
...
```

Restore applies the snapshot, then each change in order, checking the hash after every step. If a
piece is missing or doesn't fit, it stops at the last good state and says how far it got, so a
partial restore is never silent.

**A new snapshot starts a new chain** when the changes since the last one add up to more than half
a snapshot, or after 12 changes, so a restore never needs more than a snapshot and a dozen pieces.
Old chains stay on chain. Letters can't be deleted; they're ciphertext and harmless, and restore
reads only the newest complete chain.

### What a piece holds

- **Snapshot:** the company document as the vault keeps it (`companyToJson`), minus each journal
  entry's `hash` and `prevHash`. Those are recomputed on restore (`@pnw/ledger` `hashEntry`), and
  the snapshot carries only the last entry's hash, which must match after recomputing. The hashes
  are random-looking and don't compress; dropping them roughly halves a snapshot.
- **Change:** the journal entries posted since the previous piece (the journal only grows, so new
  entries are a plain list), plus every other section of the document that changed (payroll, sales,
  review, and so on), each whole. Those sections are small next to the journal.
- **Receipt and bill files are not included.** They're far too big for the chain, and they stay in
  file backups. A restore from chain says which files it couldn't bring back.

### Compressed, then encrypted

Each piece is deflated (`chain/compress.ts`, the same as long letters), then sealed. Measured with
the app's own ledger (books of N entries, compressed):

| Entries | Raw | Compressed | Pages |
|---|---|---|---|
| 0 | 2.0 KB | 0.6 KB | 1 |
| 100 | 52 KB | 7.8 KB | 1 |
| 500 | 253 KB | 34 KB | 5 |
| 2,000 | 1.0 MB | 133 KB | 17 |

These numbers include the hashes. Without them, expect roughly half. A week's changes for a small
business (a few dozen entries) is one page, often one letter.

### The keys

- **The content key:** each chain has its own random 256-bit content key, and every piece in the
  chain is sealed with it (AES-256-GCM, as the vault).
- **Two wrapped copies of it ride in the snapshot:** one under a key from the account's username
  and passphrase (PBKDF2-SHA256, 600,000 rounds, as `conversationBackupKey`), and one under the
  account's recovery key, if it has one. Either opens the chain, as either opens the vault.
- **The finder key** says where the pieces are: it comes from the username and the account's
  address, not the passphrase, so a recovery-key restore can still find them. Each piece's lookup
  is a hash of the finder key, the chain and the sequence number, so nothing about the lookup
  connects two backups for anyone without the username and the wallet.

## Where it goes, and what's public

Each page is `hewn_letters_v2::send_page` (or `send` when a piece fits one letter) to the account's
own address, signed in Shield through `useShield()` like every other write (INV-11). The program,
its records and their sizes are described in `docs/LETTERS.md`. In short:

- **Visible to anyone:** that the letters program ran, and that it created fixed-size records. With
  a public fee, also the paying account. With Shield's sponsor paying, as on Joshua's first
  letters, not even that.
- **Never visible:** who the letter is to (record owners are encrypted), what's in it, its real
  length (pages are fixed size), or that it's a backup at all.
- **No mapping is written,** so INV-03 holds trivially. **No server is involved** (INV-02).

## Cost

One page is about 0.087 ALEO and one letter about 0.0066 ALEO, measured at deploy. Shield's sponsor
paid the fee for Joshua's letters, so it may cost nothing on testnet.

- A first backup of a new business's books: one page.
- A weekly change: one letter or one page.
- A busy year's snapshot: five to ten pages.

Each page is one Shield approval, so snapshots should be rare. The rule above keeps them to about
one in twelve backups.

## When it runs

People choose, the app asks. It can't send a backup on its own: every page needs an approval.

- The backup reminder (`books/backup_reminder.ts`) offers **Back up on chain** first in Shield's
  browser, where files don't work, and the file second elsewhere.
- It also asks after a pay run and when a month is closed, so a period's books are on chain before
  the period is sealed.
- A backup on chain counts as a backup for the reminder (`Company.backedUpAt`). The vault also
  keeps the chain's state (chain id, sequence, last hash) and a copy of the last state sent, so the
  next change can be worked out. All of that stays inside the encrypted vault.

## Limits, honestly

- **The wallet is needed.** The letters belong to its account, and a lost wallet means they can't
  be read. File backups don't have this limit.
- **The passphrase or the recovery key is needed.** Without either, nothing opens.
- **Changing the passphrase doesn't re-seal old letters.** They stay openable with the old
  passphrase. So a passphrase change starts a new chain, and the old passphrase should be treated
  as able to open the old backups.
- **It is only as fresh as the last backup.**
- **Ciphertext on a public chain is public for good.** It's protected by the wallet's record
  encryption and by this design's AES layer, but anyone can keep a copy and try later. That's the
  same as every letter today, and it should be said plainly in the app.

## Build order (one PR each)

1. **The format, pure:** snapshot and change pieces, the hash chain, compress and seal, the two
   wrapped key copies, the finder lookups. Tests: round trips, a missing piece stops cleanly, a
   wrong passphrase opens nothing, the recovery key opens it, recomputed hashes match.
2. **Writing it:** **Back up on chain** in the Backups card and the reminder, with the piece and
   page count shown before any approval.
3. **Finding and restoring it:** **Look for your books on chain** after a failed login with Shield
   connected, and **From your account on chain** on the restore screen.
4. **A network test:** two test accounts. Back up, wipe the browser, restore on a second browser,
   then compare the restored books entry by entry.

## Decisions (Joshua, 2026-10-26)

1. **The snapshot rule:** a new chain at half a snapshot of changes, or after 12 changes. Yes.
2. **When to ask:** weekly, after each pay run, and on closing each month. Yes, on each of those.
3. **The cost is shown before each backup** ("2 pages, 2 approvals, about 0.17 ALEO"). Yes.
