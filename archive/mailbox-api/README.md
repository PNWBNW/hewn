# The mailbox (retired 2026-10-22)

The first way Hewn carried messages: the sender sealed an envelope (AES-256-GCM under the pair's
key, `packages/mailbox`), and a stateless server route pinned it on IPFS through Pinata under a
lookup hash; the receiver fetched it by that hash and dropped it once read. A daily cron unpinned
anything past its keep-until day.

Letters on chain replaced it (2026-10-16 to 10-18, `docs/LETTERS.md`): the same envelope, inside a
record owned by the recipient and sent from the sender's wallet. After that the mailbox was only
read, for anything sent before, and used as a fallback for coworker chats whose directory copy had
no account. Production never had a Pinata key, so it was off there all along.

Retired 2026-10-22 (Joshua): every message now goes as a wallet-approved letter, and no server
holds messages at all.

- `api/`: the route handlers (`[lookup]/route.server.ts`, `sweep/route.server.ts`), the Pinata
  store and their tests, as they were under `apps/business/src/app/api/mailbox/`.
- `mailbox_client.ts`: the app's one constructor of the client, from `apps/business/src/chain/`.

The envelope (seal, open, lookup ids) and `MailboxClient` stay in `packages/mailbox`: letters use
the envelope, and the client class is a library nothing in the app constructs any more.
