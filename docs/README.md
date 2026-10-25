# docs/

Hewn's design documents. The build plan (`BUILD_PLAN.md`) and the progress log (`progress/`, one file per
day, indexed by `PROGRESS.md`) are at the repository root; this folder holds the thinking behind particular pieces.

| File | Status | What it answers |
|---|---|---|
| [`INVARIANTS.md`](INVARIANTS.md) | Living, checked in CI | Every non-negotiable rule with an id (INV-01…), where it is enforced, the check that proves it, and the threats it answers. Where an auditor starts. |
| [`THREAT_MODEL.md`](THREAT_MODEL.md) | Living | What Hewn protects, from whom, how, and what it can't. Every PR checks its changes against it; new features add rows. |
| [`LETTERS.md`](LETTERS.md) | Living | How everything between two people travels as sealed records on chain: the envelope, the keys, the lookups, channels, what it costs. |
| [`TWIN_CURVE_CONVERSATIONS.md`](TWIN_CURVE_CONVERSATIONS.md) | Design, for review | Moving the business ↔ team member conversation to key exchange, and backups both people agree to. |
| [`CUSTOMERS.md`](CUSTOMERS.md) | Design, for review | Bringing customers in: the directory of businesses taking clients, requests only a field can read, service agreements with a clear end (complete, warranty, closed), payment in USDCx, reviews at each payment that post when the job ends. |
| [`LOCKED_SAVINGS.md`](LOCKED_SAVINGS.md) | Idea, for outside review | Locked savings with an employer match, kept private and unpooled: one Aleo account per enrollment whose key is split between the worker's and the business's apps, the business's half time-locked with drand. Questions for Aleo developers at the end. |
| [`HEWN_ART.md`](HEWN_ART.md) | Design, for review | The art drawn for every credential and paystub: a Northwest scene, the pine that grows with time on Hewn, a constellation that fingerprints the record and carries the person's own star, a log's rings for the year's paychecks. |
| [`JOB_BOARD.md`](JOB_BOARD.md) | Living | The public job board: what is public on purpose, how applications stay sealed, fees. |
| [`AUDIT_DESIGN.md`](AUDIT_DESIGN.md) | Plan, approved | How a paycheck, a run or a period is provable to an auditor without the chain ever showing a wage. |
| [`NAME_REGISTRY_MAP.md`](NAME_REGISTRY_MAP.md) | Plan | Where the app depends on the name registry, and how mainnet names under the Aleo Name Service slot in. |
| [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md) | Reference | Who the app is for and the principles its screens follow. Clean-room: from what bookkeepers do, not from any other product. |
| [`ALEO_CONSTRAINTS.md`](ALEO_CONSTRAINTS.md) | Report, 2026-10-14 | The network's limits checked against the settlement design before it was built. |
| [`INTEGRATION_AUDIT.md`](INTEGRATION_AUDIT.md) | Report, 2026-10-14 | The read-only pass over the three codebases that decided what to keep, what to rebuild and in what order. Most of its list is done. |
| [`grants/`](grants/) | Reference | The Aleo SCALE grant proposals: PNW's, as submitted, and Hewn's (`SCALE_GRANT_PROPOSAL_HEWN.md`, 2026-10-24). |

The Leo programs' own documents (the architecture spec, migration notes) live with the programs
in [`pnw_mvp_v2/docs`](https://github.com/PNWBNW/pnw_mvp_v2/tree/main/docs).
