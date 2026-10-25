# Operating costs, fees and hosting

**Status:** plan (Joshua, 2026-10-16), moved here from `BUILD_PLAN.md` on 2026-10-25. The open
questions (the per-paycheck fee, the operating wallet) are in the build plan's Decisions.

The goal: Hewn scales without a monthly subscription. Bookkeeping stays free; what costs us money
to run (the mailbox and its storage, the site) is paid for by a small fee on what moves money,
plus name sales. Nothing here is built yet; the numbers are planning estimates to check against
real traffic before mainnet.

**What it costs to run** (estimates, 2026-10-16)
- Mailbox storage: Cloudflare R2 (replacing Pinata, see "Scaling the mailbox" below). The free
  tier (10 GB-month, 1M writes, 10M reads a month, no egress fees) carries roughly 150–200
  businesses of about 10 people. Past it: about $0.36 per million reads, $4.50 per million writes.
- Hosting: Vercel. The Hobby plan is for personal, non-commercial use, so plan on Pro ($20 a
  month) before mainnet.
- At about 20,000 active workers (about 2,000 businesses): roughly $120 a month in all.

**The fee: flat, per paycheck paid on the rail, paid by the business**
- About 44,000 paychecks a month at that size (most people paid every two weeks), so break-even
  is about $0.003 a paycheck. Candidates: $0.03 (running costs with a wide margin) to $0.10 (also
  saving toward the external security audit and development), with a monthly cap per business
  (say $10) so larger teams aren't penalised.
- **Flat, never a percentage**: a percentage would tie the fee to wages.
- **Collected once per pay run**, as one private USDCx transfer of (fee × paychecks) to Hewn's
  operating wallet, so it reveals neither headcount nor wages. One more Shield approval per run.
- Businesses that pay through their bank (fiat and anchored modes) move no money on the rail,
  so no fee applies; they contribute through names or the premium tier.
- **Names**: 50% of each paid `.hewn` name's price goes to working capital (Joshua, 2026-10-16).

**Two ways to run it, offered as a feature** (Joshua, 2026-10-16), possible because the code is AGPL:
- **Run your own** (lowest cost): a business hosts its own copy of the app and its own mailbox
  (its own R2 bucket and copy of the mailbox function). It pays only its own hosting and the
  network's per-transaction fees, and owes Hewn nothing.
- **Join the Hewn network** (the default): we host it. The small flat fee per paycheck covers
  the heavy data movement (carrying and storing sealed documents) and being part of a larger
  network of businesses and workers.
- The design must let the two meet: a person can work for a self-hosted business and a hosted
  one at the same time. So the mailbox address travels with each agreement (the business names
  it in the offer) rather than being one global setting; the person's app reads each agreement's
  mailbox where the business keeps it. Built with "Scaling the mailbox".

**Scaling the mailbox** (next PR)
- Today every mailbox read searches Pinata's pin list by name, and that call is limited (about 30
  a minute on the free plan) for the whole app: the first thing that breaks.
- Move envelopes to object storage named by their lookup hash (Cloudflare R2: a private bucket
  only our function can read, one direct read per lookup, refused overwrites of a taken slot),
  behind the same mailbox interface, with Pinata kept as an option.
- A batch endpoint: one request checks many lookups (a Messages check is one call, not dozens).
- Rate limits on the mailbox endpoints (Vercel firewall) so nobody can flood the bucket.
- Keep-until days and the daily sweep carry over to R2.
