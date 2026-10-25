# Premium tier candidates

**Status:** candidates for mainnet, not decided (Joshua, 2026-10-16), moved here from
`BUILD_PLAN.md` on 2026-10-25. Whether there is a tier at all is open in the build plan's
Decisions.

Features that could sit behind a paid tier once Hewn is on mainnet (Joshua, 2026-10-16). Nothing
here is gated today, and the tier itself (what's in it, its price) is an open decision below. The
free product never loses what it has: books, payroll, paystubs, agreements and the mailbox stay free.

**Scheduling** (Phase 9; Joshua, 2026-10-20): included for now, a possible premium feature; where
the line falls is decided before mainnet.

**Private messaging within an organization.** An organization is a business plus everyone with an
accepted agreement with it, so the circle is already defined on chain and nobody outside it can be
reached. Built on the mailbox (sealed envelopes, lookup hashes, keep-until days, receipts):
- **Business ↔ team member:** one-to-one threads over the agreement's existing parties key. Unopened
  messages are swept after 30 days (`MESSAGE_KEEP_DAYS`); the sender sees Received / Expired unread.
- **Group messages and announcements:** the business makes a group key and sends it to each
  member through their own mailbox; a message is sealed once under it and read by everyone. When
  someone leaves, a new key goes out, so they can't read what comes after.
- **Team member ↔ team member:** private from the business too. Coworkers have a legal right to
  discuss pay and conditions with each other (NLRA in the US), so the business must not hold
  these keys. Each person makes a key pair in their own vault; the business only relays the
  public halves. Each coworker's registered name is confirmed on chain for the account their
  letters go to (2026-10-23), and a short safety code is a second check in person.
- **Opt-in directory:** team members appear to each other only if they choose to; the business
  shares the list, never an address someone didn't agree to show.

Needs its own design doc and Joshua's greenlight before any code (a new screen and new key
handling); likely a Fable session for the key agreement.
