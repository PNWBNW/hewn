# Twin-curve conversations between a business and its people

**Status:** design, for Joshua's review (2026-10-23). Nothing here is built yet.

## Why

Every letter has two locks (`LETTERS.md`, "Twin-curve math"). The outer lock is the record,
sealed to its owner's account on Aleo's curve. The inner lock is the envelope, sealed with the
conversation's key. Coworkers and job applicants make that key by P-256 key exchange, so its
private halves never leave their vaults. A business and a person it hired don't: their key is a
random one carried inside the agreement record. Whoever holds either side's view key can open
that record, take the key, and read the letters. Those letters are the most sensitive ones Hewn
sends: paystubs, the keys to announcement channels, the business's invitations, the coworker
directory. On testnet, Hewn's own wallet also holds a copy of every agreement.

This design moves that conversation to key exchange, so a view key alone opens nothing but the
outer lock, and adds backups that both people have to agree to.

## What stays the same

- **The agreement is still the first lock (Joshua).** A conversation exists only between a
  business and a person who signed an agreement. Its first letters travel under the agreement's
  key exactly as today.
- Every letter is still a record sealed to its recipient, believed only from the other side's
  account (the sender check), between accounts whose registered names the chain confirms.
- Nothing new on chain, no new program, no extra fee for the handshake.

## The handshake

1. **Each side makes a fresh P-256 key pair for the conversation,** in its own vault. The private
   half never leaves it.
2. **The public half rides on the next message that side sends anyway** (a message, a timesheet,
   a paystub, a channel key): one more field in the body, `keyHalf: { epoch, publicKey }`. No
   extra letter, no extra Shield approval. It keeps riding until that side has seen the other's
   half.
3. **When a side holds both halves for an epoch,** it works out the new key:
   HKDF-SHA256 over ECDH(its private half, the other's public half), salt `PNW::PAIR::v1`, info the
   agreement id, the epoch and both public halves (lower first). Both sides arrive at the same key
   without it ever travelling.
4. **From then on it sends under the new key,** in that epoch's own slots. The reader looks in the
   old key's slots and the new key's, so a letter sent just before the switch still arrives.
5. **Every old key stays in the vault,** so the whole history stays readable on that device.

A side that never sends a half (someone on an older version of the app) never switches, and
nothing breaks: the conversation stays under the agreement's key until both halves exist.

### What "public half" exposes

- It never goes on the public chain. It travels inside a letter, under both of today's locks.
- The other person sees it, and so does anyone holding their view key (that's the gap being
  closed). Neither can work out the key from it: the key needs a private half, and getting one
  back from a public half is the hard problem both curves rest on.
- Nobody can swap in a half of their own: a half counts only from the other side's account, and a
  view key can read letters but can't send them.
- A half is fresh and random for each conversation and epoch, so it doesn't identify or link
  anyone.
- Long term: everything on chain stays forever, and a large enough quantum computer would break
  both curves, Aleo's records included. This design doesn't add to that; a post-quantum layer
  could be added once browsers offer one.

## Backups, by agreement (Joshua)

After the switch, the private halves live only in each side's vault. Someone who loses their
books without a file backup loses the history from the switch onwards. A backup on chain fixes
that, but it puts the conversation's key in one more place, and that key opens both people's
letters. So a backup happens only when both agree, and covers the conversation only up to that
point.

1. **Either side asks:** "Ask to back up this conversation" sends a `backup_request` naming the
   latest epoch.
2. **The other side answers** Allow or Decline (`backup_answer`). Nothing is backed up without
   Allow.
3. **On Allow, each side backs up its own copy:** a letter to its own account holding the keys
   for every epoch up to the one named. Two locks again: the record, sealed to that account
   (only that wallet finds and opens it), and a key from that person's passphrase (PBKDF2, the
   same strength as the books), so a view key alone can't open it. One letter, and one Shield
   approval, for each side.
4. **Then both sides start a fresh handshake,** so the backed-up keys cover the conversation only
   up to that point. What follows needs a new backup, and a new agreement to it.
5. **Restoring:** on a new device, connect Shield and enter the passphrase. The app finds its
   backup letters and opens the history they cover; the conversation then carries on with a
   fresh handshake.
6. **Declined, or never asked:** nothing is backed up. Lost books mean that conversation's
   history from the switch onwards is gone for that person; the conversation itself carries on
   after a fresh handshake.

## What a view key opens, before and after

| Holder | Today | After |
|---|---|---|
| A view key (an auditor, a scanning service) | that letters exist, and between a business and the person it hired, what they say | that letters exist, the public halves, and the agreement-key letters from before the switch |
| Hewn's wallet (testnet) | every agreement's key, but no letters | the same, and those keys stop opening anything new after the switch |
| A backup letter's owner | — | its own backed-up history, with its wallet and its passphrase |

## Costs and limits

- The handshake: nothing extra (it rides on messages).
- A backup: one letter and one approval for each side, each time both agree.
- A few hundred conversation keys fit in one backup letter.
- A backup's passphrase lock is only as strong as the passphrase.

## Later, not in this design

- New agreements carrying the two public halves from the start (`employer_agreement_v5`, Leo,
  in a Fable session), so even the first letter is twin-curve.
- The same agreed backups for coworker chats, whose keys already live only in the vault.
- Rotation by a fresh handshake, if it is wanted at all.
- A second lock on reports to Hewn.

## Tests it ships with

Including inputs that must fail: a half from an account other than the other side's is ignored;
a half for another agreement or a past epoch is ignored; an old-version peer keeps the
conversation working; both sides sending halves at once agree on one key; a letter sent under the
old key just before the switch still arrives; a backup is never made without Allow; a restored
backup opens exactly the epochs it covers and nothing after; a wrong passphrase opens nothing.
