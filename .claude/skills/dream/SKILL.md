---
name: dream
description: The weekly dreaming pass (docs/MEMORY.md, docs/SLEEP.md): verifies, organizes and enriches the team's memory over the last seven days, names promotion candidates and prunes what was promoted or stopped being true, and opens one pull request, "dreaming: week of <date>". Started by the "Hewn dreaming" Routine or by Joshua; never by a working session on its own.
disable-model-invocation: true
context: fork
background: false
---

# Dreaming: the weekly memory pass

You are the weekly dreaming session for Hewn (`PNWBNW/hewn`, checked out in this session). Your
only job is to curate the team's memory: verify it, organize it, enrich it, and keep it the right
size. You never touch code, tests, workflows or the Leo programs; you never change the wording or
the id of a rule; you never merge. You open one pull request and stop. The design you are running
is `docs/MEMORY.md`, extended by `docs/SLEEP.md` (the sleep cycle this pass is the weekly rung
of); read both before anything else, then `CLAUDE.md` in full. The nightly `/light-sleep` may
already have filed some of the week's decisions and lessons; what it filed is yours to verify,
not to redo.

Today is the date `git log -1 --format=%cs origin/main` or later; call it `<today>`. The week is
the seven days ending today.

## 1. Read, progressively

Never read the whole store. In this order:

1. `docs/MEMORY.md`, `CLAUDE.md`, `memory/README.md`, `memory/decisions.md`, `memory/lessons.md`.
2. **The week's work.** The progress entries of the last seven days (`progress/<YYYY-MM>/<date>.md`, one
   file a day, entries oldest to newest) and the pull requests merged into `main` in that time
   (`git log origin/main --since="7 days ago" --format="%h %s"`; a squash merge ends in `(#N)`).
   Read the diff of each merged pull request only where an entry's claim needs checking.
3. **The transcripts**, where you can. Every progress entry ends with the id of the session that
   wrote it (`— session_…`). If this environment's session tools can read a transcript
   (`list_events` with that id, kinds `user` and `assistant`), read it only for what the entry
   left out: a decision Joshua made in chat that no document records, a lesson learned and not
   written down. If they can't, the entries and the diffs are enough; say so in the pull request.
   Never copy anything about a person's books, keys or money out of a transcript.
4. **The documents the week touched**, and every document whose frontmatter status is `design`,
   `review`, `plan` or `idea` (`docs/README.md` lists them by status).
5. **The map**, to check claims about files: `node docs/map/query.mjs show <file>` says what a
   file is and what reaches it; `rule INV-07` lists a rule's checks. Build nothing; the map is
   rebuilt on every push.

## 2. Verify

For each item, either confirm it or write the correction. Change only team memory (`progress/`,
`docs/*.md` frontmatter and status lines, `memory/`, the Now block of `BUILD_PLAN.md`); anything
in org knowledge that is wrong (`CLAUDE.md`, `docs/INVARIANTS.md`, `docs/THREAT_MODEL.md`, a
README) goes in the pull request as a question, not a change.

- **Statuses.** Every document's frontmatter `status` against what shipped: a `design` whose parts
  are all built is `built`; a `plan` whose steps are done is `built` or `report`; `updated` is the
  date of its last real change. A status line inside a document ("being built", "next") that the
  week outran.
- **The Now block** of `BUILD_PLAN.md` against the week's merged pull requests: what it says is in
  flight, next and blocked. Keep it to its four lines.
- **What the entries claim.** Anything a progress entry says was done is in `main`; test counts
  and transaction ids it quotes are plausible (a transaction id resolves on the explorer when the
  network is reachable).
- **The rules' citations.** Every file path `CLAUDE.md` and `docs/INVARIANTS.md` cite exists
  (`python3 -I scripts/check_links.py` covers links; check the paths in prose and the "none" rows
  of the invariants table: a check that now exists for a rule listed as unenforced is a correction).
- **The ledger.** Every decision made this week (in an entry, a merged pull request, a document's
  Decisions section, or a transcript) has a line in `memory/decisions.md`; each line's date is
  right; what it names under "where enforced" exists.

## 3. Organize

- A new decision goes under the subcategory whose one-line description says it belongs; a new
  subcategory only when none fits, with its own one-line description. The format is the file's:
  `- date · decision · who · where enforced (a rule id in bold where it became one) · where recorded`.
- A decision that supersedes another stays beside it, with "Supersedes the <date> …" in the line.
- A new lesson goes in `memory/lessons.md` with its source; two entries that say the same thing
  become one; an entry that stopped being true is removed, and the pull request says which and why.
- Dated provenance that crept back into `CLAUDE.md` moves to the ledger (removing a date or a
  "(Joshua, …)" the ledger already carries is allowed; rewording a rule is not).
- The documents keep their own Decisions sections as the record of the moment; never delete them.

## 4. Enrich

- Each ledger line names where it is enforced: a rule id in bold, a file that exists, or a test.
- Each lesson names the entry, incident or document it came from.
- A decision or lesson whose source you couldn't find keeps its line and gets a question in the
  pull request.

## 5. Promote and prune

The slow rung (`docs/SLEEP.md`): a store that only fills is never pruned, and what keeps proving
true belongs higher up.

- **Promotion candidates.** A lesson in `memory/lessons.md` that sessions keep relying on, or a
  decision every session now assumes, belongs in a README, `docs/INVARIANTS.md` or `CLAUDE.md`.
  Name each candidate in the pull request's **Questions**, with the rule or README it would join
  and the entries that show it holding. Never promote one yourself: a rule changes only in a
  pull request about the rule.
- **Pruning.** A lesson Joshua promoted since the last dream (it now reads as a rule or a README
  line) leaves `memory/lessons.md`; its ledger line in `memory/decisions.md` stays and now says
  where the rule lives. A lesson that stopped being true leaves too, and the pull request says
  which and why. `progress/` is never pruned: it is the raw record, and only the abstractions
  move up.

## 6. Output

- Branch `dreaming/<today>` from `origin/main`. Commit message `dreaming: week of <today>`.
- Before pushing: `python3 -I scripts/check_invariants.py`, `python3 -I scripts/check_links.py`,
  `python3 -I scripts/docs_index.py --write`, and an entry in `progress/<YYYY-MM>/<today>.md` headed
  `## <today> — Dreaming: week of <today>` saying what was verified, what changed and what is
  asked, ending with the bare id of this session (`— session_…`; `get_session` with no
  arguments gives it, or `${CLAUDE_SESSION_ID}`; never a link). Then `python3 -I scripts/progress_index.py --write`.
- One pull request titled `dreaming: week of <today>`. Its body has three parts: **Verified** (what
  was checked and found right, in a few lines), **Changed** (every change, each citing the file,
  entry or pull request it rests on, pruned lessons included), **Questions** (anything you couldn't
  verify, and every promotion candidate, as a question to Joshua, never written down as a fact). Open it even when nothing changed: the entry that says
  the week was verified is the record.
- Never merge (Joshua approves every pull request in chat; OPS-01). Never put a `https://claude.ai/…`
  link in a commit, a pull request or a document. That includes the footer your tooling may add
  to a pull request: end the body with exactly `_Generated by [Claude Code](https://claude.ai/code)_`
  after a `---` line, never with a link to this session, and read the body back after opening the
  pull request to check (the bare session id in the progress entry is the trail; Joshua,
  2026-11-04). Never print a key, a view key or a seed phrase.
  If this session has no tool that opens a pull request, push the branch and end with its name
  and the three parts above as your last message; Joshua opens the pull request from it.
  Stop after the pull request is open.
