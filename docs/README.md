# docs/

Hewn's design documents. The build plan (`BUILD_PLAN.md`) and the progress log (`progress/`, one file per
day, indexed by `PROGRESS.md`) are at the repository root; this folder holds the thinking behind particular pieces. The table is generated from each
document's frontmatter (`scripts/docs_index.py`, checked in CI; `docs/MEMORY.md`): change a
document's `status`, `updated` or `summary` line, then run `python3 -I scripts/docs_index.py --write`.

<!-- docs-index:start -->

| File | Status · updated | What it answers |
|---|---|---|
| [`JOB_BOARD.md`](JOB_BOARD.md) | living · 2026-10-19 | The public job board on `hewn_jobs_v1.aleo`: what is public on purpose, how applications stay sealed, fees. |
| [`LETTERS.md`](LETTERS.md) | living · 2026-10-26 | How everything between two people travels as sealed records on chain: the envelope, the keys, the lookups, channels, what it costs. |
| [`INVARIANTS.md`](INVARIANTS.md) | living · 2026-11-03 | Every non-negotiable rule with an id, where it is enforced, its check, its threats and the SOC 2 and ISO 27001 items it satisfies; then the operating rules. The control list. |
| [`map/`](map/README.md) | living · 2026-11-03 | The map of Hewn in 3D on GitHub Pages: every file in both repositories, every rule and dependency, how they connect; its extractor, layout, viewer, query tool and build. |
| [`security/DATA_FLOW.md`](security/DATA_FLOW.md) | living · 2026-11-03 | Where the data lives and what crosses between places: every store and flow classed private, sealed, public or control, each citing its rule; the map's data-flow view in writing. |
| [`THREAT_MODEL.md`](THREAT_MODEL.md) | living · 2026-11-08 | What Hewn protects, from whom, how, and what it can't: threats T1 to T20, each tied to the rules that answer it. |
| [`TWIN_CURVE_CONVERSATIONS.md`](TWIN_CURVE_CONVERSATIONS.md) | built · 2026-10-23 | The business ↔ team member conversation on key exchange (the handshake), and backups both people agree to. |
| [`HEWN_ART.md`](HEWN_ART.md) | built · 2026-10-24 | The art drawn for every credential and paystub: a worker's land in 3D, a business's topographic map, the constellation, the paystub rings; in the app, the credential card (question 1) still open. |
| [`CUSTOMERS.md`](CUSTOMERS.md) | built · 2026-10-26 | Customers as their own accounts with a portal: invoices sent as letters, bills paid from Shield, agreements with a clear end; Step 1 built, the directory of businesses and reviews still open. |
| [`CHAIN_BACKUP.md`](CHAIN_BACKUP.md) | built · 2026-10-27 | The books backed up as letters to your own account: compressed, then encrypted; a snapshot, then only changes; restored on any device with the wallet and the passphrase or recovery key. |
| [`CLOSE_PERIOD.md`](CLOSE_PERIOD.md) | built · 2026-11-05 | Closing a period through any date after it ends, once every check passes, the root anchored through `payroll_audit_log`, reopening and locking, and the period proof with a public page anyone can check it on. |
| [`MEMORY.md`](MEMORY.md) | built · 2026-11-07 | How Hewn's agents remember across sessions, in three scopes of plain files, with a weekly out-of-band "dreaming" pass that verifies, consolidates and enriches the memory so each session starts small and current. |
| [`SLEEP.md`](SLEEP.md) | built · 2026-11-07 | The sleep cycle for the agents that build Hewn, after Google's sleep framework for continual learning: consolidate before the fast store is wiped, at three rhythms (every compaction, nightly, weekly), and a monthly REM pass that practises and keeps only what finds something; as hooks and skills a plugin can carry to any repository. Extends docs/MEMORY.md. Built except the plugin (step 5), and the first REM run by hand. |
| [`VEIL.md`](VEIL.md) | decided · 2026-11-08 | Veil, Provable's viem-style TypeScript toolkit for Aleo, read from its source: what it is, how it fits Hewn (typed program bindings, a local devnode for end-to-end tests, the reads Hewn lacks, writes through Shield), its risks, and the order to adopt it in; decided: adopt it, with Shield the only wallet. |
| [`MAINNET_NAMES.md`](MAINNET_NAMES.md) | design · 2026-10-25 | `.hewn` names under the Aleo Name Service on mainnet: the two tiers, pricing, reserved names, one kind of name per wallet, and the steps to get there. |
| [`PROOF_OF_INCOME.md`](PROOF_OF_INCOME.md) | design · 2026-10-30 | Paystubs as private records a worker proves from: a one-page income letter checked by a QR code, under the employer-vouched name; new Leo; questions open. |
| [`COMPLIANCE_MAP.md`](COMPLIANCE_MAP.md) | review · 2026-11-03 | The Audit-Ready Plan checked against SOC 2, ISO 27001, HITRUST, FedRAMP and CMMC (and SOC 1): what's met, what's missing, Steps 8 to 14, and the internal audit that stands in for a Type I and Type II until mainnet. |
| [`PAPER.md`](PAPER.md) | review · 2026-11-05 | The technical paper, v1.0 draft for hewnaccounting.com/paper: private payroll and provable books on Aleo, the twin-curve math behind every conversation, what is public, the honest limits, and what is live. |
| [`NAME_REGISTRY_MAP.md`](NAME_REGISTRY_MAP.md) | plan · 2026-10-25 | Where the app depends on the name registry, and how mainnet names under the Aleo Name Service slot in. |
| [`AUDIT_DESIGN.md`](AUDIT_DESIGN.md) | plan · 2026-11-05 | How a paycheck, a run or a period is provable to an auditor without the chain ever showing a wage; the period root, the anchor, and the whole-period pack with its verifier done. |
| [`PAYROLL_COMPLIANCE.md`](PAYROLL_COMPLIANCE.md) | plan · 2026-11-05 | Making payroll legally exact: the IRS's own withholding method with verified, dated tables, a real W-4 the worker signs (drawn and in Shield), layered protection for Social Security numbers, state rules from the Pacific Northwest outward that follow where the work is done, the I-9, and zPass to explore. |
| [`OPERATING_COSTS.md`](OPERATING_COSTS.md) | plan · 2026-11-06 | Running Hewn without a subscription: what costs money, the small fee on what moves money, name sales, hosting; estimates. |
| [`LOCKED_SAVINGS.md`](LOCKED_SAVINGS.md) | idea · 2026-10-24 | Locked savings with an employer match, private and unpooled: one Aleo account per enrollment whose key is split between the two apps; questions for Aleo developers. |
| [`PREMIUM_TIER.md`](PREMIUM_TIER.md) | idea · 2026-10-25 | What could sit behind a paid tier on mainnet, and what the free product never loses; candidates, not decided. |
| [`DESIGN_BRIEF.md`](DESIGN_BRIEF.md) | reference · 2026-10-14 | Who the app is for and the principles its screens follow; clean-room, from what bookkeepers do. |
| [`INTEGRATION_AUDIT.md`](INTEGRATION_AUDIT.md) | report · 2026-10-14 | The read-only pass over the three codebases that decided what to keep, what to rebuild and in what order; most of its list is done. |
| [`ZPASS.md`](ZPASS.md) | report · 2026-11-05 | What zPass is today (an issuer-signed credential proven in zero knowledge; an SDK from early 2025; example programs on testnet only), why Hewn can't use its SDK as it is, where it fits (verified identity, age, sanctions; not the I-9 yet), the missing piece (an issuer), and the recommended path. |
| [`ALEO_CONSTRAINTS.md`](ALEO_CONSTRAINTS.md) | report · 2026-11-08 | The network's limits checked against the settlement design before it was built (2026-10-14). |

Status means: **idea**, an idea, nothing decided or built; **design**, a design waiting for Joshua's decision; **review**, a review or analysis for Joshua, nothing to build; **decided**, decided by Joshua, not yet built; **built**, built and in the app (open items, if any, are named in the summary); **plan**, a plan with its checklist; items tick here; **living**, kept current as the code changes; CI checks it where it can; **report**, a dated report of what was found; history, not current; **reference**, background that doesn't change: who it's for, how it was made.

<!-- docs-index:end -->

Folders without a page of their own:

| Folder | What |
|---|---|
| [`incidents/`](incidents/) | Problems seen in use and what was found, one write-up each, dated. |
| [`grants/`](grants/) | The Aleo SCALE grant proposals: PNW's, as submitted, and Hewn's (`SCALE_GRANT_PROPOSAL_HEWN.md`, 2026-10-24). |
| [`art/`](art/) | The art prototypes and renders behind `HEWN_ART.md`. |

The Leo programs' own documents (the architecture spec, migration notes) live with the programs
in [`pnw_mvp_v2/docs`](https://github.com/PNWBNW/pnw_mvp_v2/tree/main/docs).
