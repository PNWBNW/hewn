# Compliance map: the Audit-Ready Plan against SOC 2, ISO 27001, HITRUST, FedRAMP and CMMC

**Status:** review, for Joshua (2026-11-03). Nothing is built or changed. It checks the
Audit-Ready Plan (decided 2026-10-25, Steps 1 to 7, all done: `docs/INVARIANTS.md`, the numbered
threats in `docs/THREAT_MODEL.md`, `pnw_mvp_v2`'s `docs/PUBLIC_STATE.md`, the CI checks, Leo tests
for the programs Hewn calls, the progress log) against the security frameworks a customer or
investor is likely to ask about, and says what a refreshed plan would add. It feeds the full bug
and vulnerability review that comes next.

## The short version

- **What the plan built is the technical half, and it's strong:** rules with ids, each tied to the
  threats it answers and to a check that runs in CI; a threat model; a map of everything public on
  chain; encryption and key handling enforced in code; no server holding anyone's data.
- **Every framework below also audits the organization:** written policies, who can change
  what, how changes are approved, vendors, incidents, recovery, training, and evidence kept over
  months. The plan has almost none of that yet. That's the gap, and it's mostly writing and
  settings, not code.
- **Hewn's design shrinks the audit a lot.** With no database and no server that sees plaintext,
  many controls are "not applicable", but an auditor still needs each one written down with the
  reason.
- **Which frameworks matter:** SOC 2 first. ISO 27001 later, for customers abroad. **SOC 1**,
  which payroll providers are usually asked for, may not apply: Hewn computes payroll on the
  customer's own device and never processes it for them (below). HITRUST, FedRAMP and CMMC don't
  fit Hewn today.
- **No outside audit until mainnet and funding (Joshua, 2026-11-03).** Until then Hewn audits
  itself the way a CPA would for a Type I and a Type II, so the evidence is already there when one
  is hired (below, "The internal audit").

## Which frameworks fit

| Framework | What it is | Fits Hewn? | Why |
|---|---|---|---|
| **SOC 2** | An independent CPA's report on controls against the Trust Services Criteria: Security (required), plus Availability, Processing Integrity, Confidentiality, Privacy as chosen. Type I is one date; Type II covers a period, usually 3 to 12 months. | **Yes, first** | The standard ask for any B2B software. Security, Confidentiality, Privacy and Processing Integrity all apply. |
| **SOC 1** (not in the list) | A CPA's report on a service organization's controls that affect customers' financial reporting. | **Not for now** | Payroll output lands in customers' financial statements, which is why auditors ask payroll processors like ADP for one. But Hewn computes payroll in the customer's browser and the customer signs every payment: Hewn doesn't process for them, so it may not be a service organization at all, and a customer's auditor would test it like desktop software (recalculating sample paychecks). Step 13 still states the payroll control objectives, which serve SOC 2 Processing Integrity and any customer's auditor. Revisit if an audited customer asks. |
| **ISO 27001** | A certified information security management system: clauses 4 to 10 (context, leadership, risk, operation, improvement) and 93 Annex A controls. | **Later** | Expected by international and larger customers; most of its controls overlap SOC 2's, so the same work counts twice. |
| **HITRUST** | A certifiable framework built for healthcare data. | **No** | Hewn holds no health data. Revisit only if health businesses become customers and ask. |
| **FedRAMP** | Authorization for cloud services used by US federal agencies, on NIST 800-53. | **No** | Hewn isn't sold to federal agencies and isn't a cloud service holding their data. |
| **CMMC** | Certification for defense contractors handling Federal Contract Information or Controlled Unclassified Information (Level 2 is NIST 800-171's 110 requirements). | **No** | Applies to the defense supply chain, not to Hewn. A defense contractor using Hewn for its own books wouldn't put CUI in it. |

Worth knowing beyond the list:
- **NIST SSDF (SP 800-218)**, secure software development. It fits an open-source software
  maker exactly, and most of it maps onto what CI already does.
- **OWASP ASVS** for the web app.
- **A third-party audit of the Leo programs** before mainnet, already planned.
- **The FTC Safeguards Rule (GLBA):** payroll can make a business a "financial institution"
  under it. With no customer data held by Hewn, most of it falls away, but the written program
  it asks for overlaps SOC 2.

## Where the plan already meets the frameworks

| Area | SOC 2 | ISO 27001 Annex A | What Hewn has |
|---|---|---|---|
| Risk assessment | CC3 | clauses 6.1, 8.2 | `THREAT_MODEL.md`, T1 to T20, each tied to rules |
| Encryption, key handling | CC6.1, CC6.7 | 8.24 | INV-07 to INV-09: AES-256-GCM vault, PBKDF2 600k, keys never leave the vault module; tested |
| Data minimisation, privacy | P criteria, C1 | 5.34, 8.10 to 8.12 | INV-01 to INV-05: no server data, public chain state mapped (`PUBLIC_STATE.md`), traction counts the only exception |
| Secure development | CC8.1 | 8.25 to 8.29 | Tests, typecheck, build and a dependency audit block every PR; frozen lockfile; packages at least 7 days old; least-privilege CI; CSP (INV-17) |
| Secrets | CC6.1 | 5.17, 8.4 | Secrets scan in both repos (INV-06, T18); the admin key only in a GitHub environment secret |
| Vulnerability reports | CC7.3 | 6.8, 8.8 | `SECURITY.md`, private reporting |
| Change record | CC8.1 | 8.32 | One PR per change, the progress log per day, Leo programs immutable with migration notes (INV-20, INV-21) |
| Processing integrity | PI1 | — | Double-entry rules with a negative test each, a hash-chained journal, reconciliation with Shield, and now period close with anchored roots |
| Incidents (start) | CC7.4 | 5.24 to 5.27 | `docs/incidents/`, the first write-up (2026-10-27) |

## What's missing

The gaps an auditor would raise first, by priority:

1. **Change approval and separation of duties (SOC 2 CC8.1; ISO 8.32; SOC 1).** Today an AI
   agent writes the code and merges its own PRs once CI is green, with no independent human
   approval. To an auditor that's one actor building, approving and shipping. Joshua must decide
   on:
   - branch protection on `main` that requires his approval (a CODEOWNERS file makes it automatic);
   - a written rule for what an agent may merge on its own, if anything;
   - signed commits.
2. **Written policies and a security owner (CC1, CC2, CC5; ISO clauses 4 to 10).** Short
   documents: an information security policy, access control, change management, incident
   response, business continuity, vendor management, acceptable use, and key management. One page
   each is enough at Hewn's size, as long as they match what really happens.
3. **Access to the infrastructure (CC6.1 to CC6.3; ISO 5.15 to 5.18, 8.2).** List every account
   that can change Hewn: GitHub, Vercel, the Upstash store, the domain registrar, npm, and the
   agent sessions' GitHub access. Then:
   - check each has 2FA;
   - review who has access every quarter, and keep the record;
   - write down who holds the admin key (`ADMIN_PRIVATE_KEY`), how it would be rotated, and who
     can run the deploy and upgrade workflows.
4. **Vendors (CC9.2; ISO 5.19 to 5.23).** An inventory with each vendor's own report where one
   exists:
   - Vercel, GitHub, Upstash;
   - Shield/Provable and the Aleo network;
   - the stablecoin's issuer, whose compliance record sees every private transfer
     (`ALEO_CONSTRAINTS.md` §4);
   - npm.
5. **Incident response and recovery (CC7.3 to CC7.5, A1; ISO 5.24 to 5.30).** Turn the incident
   write-up into a runbook: roles, how users are told, timelines. Recovery needs targets for how
   long Hewn may be down and how much can be lost, plus what to do if Vercel or the domain fails;
   the static bundle already exists as a fallback. The deleted deployment on Oct 27 is the case to
   learn from. Test a restore from backup on a schedule.
6. **Security testing beyond unit tests (CC4.1, CC7.1; ISO 8.8, 8.29).** Static analysis
   (CodeQL or Semgrep) in CI, GitHub's secret push protection and dependency review, an SBOM per
   release, a yearly outside penetration test of the app, and the Leo audit before mainnet.
7. **Monitoring with privacy kept (CC7.2; ISO 8.15, 8.16).** Hewn deliberately logs nothing
   personal. Write that down as the design, and add the monitoring that is allowed: GitHub audit
   log review, Vercel deploy alerts, Dependabot and security alerts, and a watch on the domain and
   certificates.
8. **Asset inventory, data classification and a data-flow diagram (CC2.1, C1; ISO 5.9 to 5.13).**
   One diagram of what lives on the device, what crosses to Shield, to the chain, to Vercel and
   to Upstash, with each item classed as private, internal or public. **Done 2026-11-03:**
   `docs/security/DATA_FLOW.md` (four classes: private, sealed, public, control; every point and
   flow citing its rule; generated from the map's data, checked in CI) and the map's data-flow
   view on GitHub Pages (`docs/map/`). The map's project view (same day) lists every file in both
   repositories and every declared dependency and action, which is the raw material of the asset
   inventory; the classified inventory itself stays open (Step 9).
9. **People (CC1.4; ISO 6.1 to 6.6).** Security training, an acceptable-use acknowledgement, and
   for anyone with access later, background checks and offboarding. Small now, but it has to exist.
10. **Evidence over time (SOC 2 Type II).** Auditors sample months of records:
    approvals, access reviews, incident tickets, restore tests. GitHub issues and PRs can hold most
    of it, once the steps above say what to record.
11. **Payroll and tax correctness (PI1; what a SOC 1 would ask).** Control objectives stated plainly (paychecks are
    calculated correctly, paid once, recorded completely, closed and anchored), each with the tests
    or checks that show it. Tax tables need a written owner and a yearly update procedure.

## A refreshed Audit-Ready Plan

Steps 1 to 7 stay as they are. Proposed additions, each one PR or one settings change:

| Step | What | Where |
|---|---|---|
| 8 | Change control: branch protection on `main`, CODEOWNERS, Joshua's approval required, a written rule for agent merges, signed commits | GitHub settings + `docs/` |
| 9 | Governance pack: the control list (done, `docs/INVARIANTS.md`, 2026-11-03), the data-flow diagram (done, `docs/security/DATA_FLOW.md` and the map, 2026-11-03), the short policies, a risk register built from the threat model (likelihood, impact, owner, treatment), the asset and vendor inventory | `docs/INVARIANTS.md`, `docs/security/` |
| 10 | Access: the account inventory with 2FA confirmed, the first access review, the admin key's custody and rotation | `docs/security/` + settings |
| 11 | Security testing in CI: static analysis, dependency review, an SBOM | `.github/workflows/` |
| 12 | Incident response and recovery runbooks, with a restore drill | `docs/security/` |
| 13 | Payroll and tax control objectives, each tied to its tests | `docs/` |
| 14 | The deep review: the whole codebase and the Leo programs, area by area, against the invariants and threats (Fable) | findings, then fixes |

Steps 8 to 13 are what turn "the code is careful" into "the company can show it is". Step 14 is
the code review Joshua asked for next: it should run against the refreshed rules, so its findings
land in the right place.

## Decisions (Joshua, 2026-11-03)

1. **Agent merges:** while Hewn is being built, an agent merges a PR only after Joshua approves
   it in the chat session, on his own device. The merge commit's message says so ("Approved by
   Joshua in session, <date>"), so the approval is on record where an auditor looks. Required
   GitHub approvals can come later, before a SOC 2 period starts.
2. **Access:** Joshua is the only person with access to GitHub and Vercel, and both have 2FA on.
   Still to list: Upstash, the domain registrar, npm, and the agent sessions' GitHub access.

3. **No outside audit yet:** no CPA firm until Hewn is ready for mainnet and has funding. Until
   then, an internal audit that stands in for a SOC 2 Type I and Type II (below).
4. **SOC 1:** out of scope for now; Step 13's payroll control objectives stay.

## The internal audit

What a CPA does for SOC 2, done in-house, so the first outside audit finds the controls written,
working and evidenced. It's not a substitute for an independent report (the person auditing is
also the person running the controls), so each finding says so plainly rather than grading
itself.

- **The control list is `docs/INVARIANTS.md`** (2026-11-03): every rule the code keeps, with the
  SOC 2 criterion and ISO Annex A control it answers and the check that runs in CI, and a second
  table of the rules the company keeps (OPS-01 on: merge approval, access, the admin key,
  dependencies, CI's permissions, incidents, vulnerability reports, the change record), each with
  where it is set, the evidence it leaves (a merge commit saying "Approved by Joshua in session",
  an access review, a write-up) and its check, or the step that adds one.
- **Like a Type I (design, on one date).** Once Steps 8 to 12 are in, walk every control on one
  day: is it written, does it answer its criterion, does what really happens match the words?
  Each gap is a finding with a fix. The write-up is dated and kept in `docs/security/audits/`.
- **Like a Type II (operation, over a period).** Then a period of at least 3 months in which
  every control leaves its evidence as it runs. At the end, sample it the way an auditor would
  (for example 25 merged PRs for change approval, each quarter's access review, each restore
  drill) and record every exception, even small ones. Then the next period starts.
- **The code review (Step 14)** is the testing an auditor's specialists would do, against the
  invariants and threats.
