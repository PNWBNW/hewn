---
status: design
updated: 2026-11-03
summary: How Hewn's agents remember across sessions, in three scopes of plain files, with a weekly out-of-band "dreaming" pass that verifies, consolidates and enriches the memory so each session starts small and current.
---

# Memory: three scopes, and dreaming

**Status:** design, decided by Joshua on 2026-11-03; parts 1 and 2 built the same day (scopes,
frontmatter and the generated index, session attribution; the first dream by hand), the weekly
dream next. Prompted by
Anthropic's AI DevCon talk on agent memory (Lamis Mukta, 2026-11), whose four stages Hewn had
already walked without naming them: a single file (`CLAUDE.md`), procedural memory (the READMEs and
`docs/`), files agents read and write (`progress/`). What it lacked was the last part of the talk:
a second-order process that curates memory out of band, so memory stops only accreting.

## What memory is here

Everything an agent needs to work on Hewn is a Markdown file in this repository, read by people
and agents alike. There is no memory tool and no store outside git: git is the harness. Every
write is a commit with an author and a time, every change is a pull request Joshua approves
(OPS-01), concurrency is one branch per session with merge conflicts as the content-hash
precondition, and history is inspectable and reversible for free.

The files fall into three scopes, which decide who may write them and when a session reads them:

| Scope | What | Who writes it | Read when |
|---|---|---|---|
| **Org knowledge** | The rules and the facts that don't change by themselves: `CLAUDE.md`, `docs/INVARIANTS.md`, `docs/THREAT_MODEL.md`, every folder's README, the Leo repository's `CLAUDE.md` | Only by a pull request Joshua approves; never by an agent on its own | Session start (`CLAUDE.md`), then on demand |
| **Team memory** | What the team has decided, learned and done: `progress/` (one file a day, append-only), `docs/*.md` (designs with a status), `docs/incidents/`, `memory/` (decisions and lessons, from the first dream on) | Agents, freely, in the session's own pull request; the dreaming pass, in its own | The Now block and the newest `progress/` entries at Session start (about 5k tokens); the rest found through the map or `docs/README.md` |
| **Working memory** | A session's own notes, renders, captures, scratch scripts | The session | Never committed; gone with the session |

Nothing private goes in any of them (INV-01, INV-06): memory is about the software, never about a
person's books.

## Format: plain Markdown with frontmatter

Every document under `docs/` opens with a frontmatter block (`status`, `updated`, `summary`), and
`docs/README.md`'s table is generated from those blocks (`scripts/docs_index.py`, checked in CI).
A status is one of a fixed set (idea, design, review, decided, built, plan, living, report,
reference), so "being built" can't outlive the build: the day something ships, its frontmatter
changes in the same pull request, and the index follows. The same rule as `PROGRESS.md`: the
index is never edited by hand.

## Reading: progressively, never the whole store

A session reads `CLAUDE.md`, the Now block of `BUILD_PLAN.md`, and the last few entries of the
newest `progress/` file. Everything else is found, not read: `docs/README.md` for what a document
answers, the map (`docs/map/query.mjs`, or the page) for what a file is and what touches it,
`grep` only after that. Frontmatter and search, not the whole store.

## Writing: freely, and signed

Agents decide what is worth keeping and write it as they work: a progress entry per task, a
status change when something ships, an incident when something breaks. Two rules:

- **Every progress entry ends with the id of the session that wrote it**, as a bare
  `session_…` line, never a link (the link rule of 2026-10-29 stands). Only Joshua can open a
  session's transcript, so the id is the audit trail from a memory back to the conversation that
  made it, and it tells the dreaming pass which transcript to read. Entries written by Joshua by
  hand say so instead. (Joshua, 2026-11-03.)
- **Org knowledge is never changed as a side effect.** A rule changes in a pull request about
  the rule.

## Dreaming: the out-of-band pass

In-band memory has three limits the talk names and Hewn has felt: a session splits its attention
between the task and its notes; patterns across sessions go unnoticed (the same lesson relearned:
the `merge -s ours` trick, Shield's testnet fee); and memories go stale with confidence (a status
line, the Now block, a CI step's label). The answer is a periodic batch process whose only job is
to curate memory. For Hewn:

- **When:** once a week, as a scheduled Routine that starts a fresh session on `main`. Out of
  band, so no working session pays for it; bounded, so its cost is known.
- **Input:** the week's `progress/` entries, the pull requests merged, the transcripts those
  entries name (by session id), the map's diff, and the memory store as it is.
- **Verify:** every document's status against the code and the merged pull requests; the Now
  block against what shipped; `CLAUDE.md`'s dated parentheticals against the files they cite;
  the invariants' "none" rows; anything a progress entry says was done.
- **Organize:** decisions scattered across documents into `memory/decisions.md` (date, decision,
  who, where enforced, the pull request), lessons into `memory/lessons.md`, dated history out of
  `CLAUDE.md` into the memory it belongs to, so the rules stay rules.
- **Enrich:** each decision linked to its test, its invariant and its map point; each lesson to
  the incident or entry it came from.
- **Output:** one pull request, "dreaming: week of <date>", with every change citing a file or a
  pull request, and anything it couldn't verify written as a question rather than a fact. It
  never touches code or tests, never changes a rule's wording, and never merges: Joshua reads it
  like any other pull request (OPS-01). The pass is itself a session, so its progress entry ends
  with its id.

The map is the structural half of "organize", already running on every push; dreaming is the
semantic half.

## The order

1. **Scopes, frontmatter, the generated index, session attribution** (this document; built
   2026-11-03).
2. **The first dream, by hand** (built 2026-11-03): `memory/decisions.md` (the ledger across
   the documents' own Decisions sections, which stay as the record of the moment) and
   `memory/lessons.md` populated from the documents, `CLAUDE.md` and the progress log;
   `CLAUDE.md` slimmed to rules with the dates and provenance moved to the ledger.
3. **The recurring dream:** the weekly Routine, its prompt kept in the repository
   (`scripts/dreaming/PROMPT.md`), its first run reviewed before the schedule stands.

## Decisions (Joshua, 2026-11-03)

1. Build it, in the order above.
2. Progress entries carry the bare session id (no link); Joshua alone can open the transcript.
