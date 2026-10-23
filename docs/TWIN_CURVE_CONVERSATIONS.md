# Twin-curve conversations between a business and its people

**Status:** approved by Joshua (2026-10-23). Built: the handshake for the conversation's messages
(`books/key_ring.ts`, `chain/key_ring.ts`). Next: paystubs and timesheets on the same keys, then
the agreed backups.

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
2. **The public half rides on the next message that side sends anyway** (a message, a channel
   key, an invitation's key, the coworker directory): one more field beside the body,
   `half: { publicKey }`. No extra letter, no extra Shield approval. It keeps riding until the
   answer comes.
3. **The other side answers** with its own half on the next message it sends, on the same stream
   the start came on (`half: { publicKey, answers }`), so it can always be read.
4. **When a side holds both halves,** it works out the new key: HKDF-SHA256 over ECDH(its private
   half, the other's public half), salt the agreement's parties key, info `PNW::PAIR::v1` and both
   public halves (lower first). Both sides arrive at the same key without it ever travelling.
5. **From then on it sends under the new key,** in that key's own slots (a stream). A reader reads
   the agreement's stream and every pair's it holds both halves of, so nothing sent around the
   switch is missed, and a side that lost its keys still reads the agreement's stream to the end
   and can start again: the other side answers there.
6. **Every old key stays in the vault,** so the whole history stays readable on that device.

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
4. **Then the keys refresh,** so the backed-up keys cover the conversation only up to that
   point. What follows needs a new backup, and a new agreement to it. The refresh is a gain in
   itself (Joshua): the copy holds the old keys, and the conversation carries on under keys the
   copy doesn't have.
5. **It feels like nothing happened (Joshua).** The refresh rides on letters already going: the
   Allow carries the answering side's new half, and the asker's next message carries theirs. Until
   both halves are in, each side keeps sending under the current key, so nobody waits and nothing
   is resent. The conversation stays one thread: every message before the backup stays where it
   was, in order, on both sides' screens, and new ones follow straight on. The only sign is a
   small line in the thread, "Backed up to here, both agreed", where it happened.
6. **Restoring:** on a new device, connect Shield and enter the passphrase. The app finds its
   backup letters and opens the history they cover, into the same thread; the conversation then
   carries on with a fresh handshake.
7. **Declined, or never asked:** nothing is backed up. Lost books mean that conversation's
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
old key just before the switch still arrives; a backup is never made without Allow; after a backup the thread
on both sides still holds every earlier message, in order, and the next message needs no extra
letter or approval; a restored
backup opens exactly the epochs it covers and nothing after; a wrong passphrase opens nothing.
