# scripts/dreaming/

The weekly dreaming pass (`docs/MEMORY.md`): an out-of-band session whose only job is to curate the
team's memory, so no working session pays for it and memory stops only accreting.

| File | What |
|---|---|
| `PROMPT.md` | The whole instruction the session runs on, kept here so a change to how the team dreams is a pull request like any other. The Routine's own prompt only says to read this file. |

**When:** once a week, Sunday evening Pacific, as a Routine ("Hewn dreaming") that starts a fresh
session on `main` in the cloud environment. It reads the week's progress entries and merged pull
requests, the transcripts those entries name where it can, and the memory store as it is; verifies
statuses, the Now block, the rules' citations and the ledger; organizes new decisions and lessons
into `memory/`; and opens one pull request, `dreaming: week of <date>`, with everything it couldn't
verify written as a question. It never touches code or tests, never rewords a rule, never merges.

**The first run** is fired by hand and reviewed before the schedule stands (Joshua, 2026-11-03):
the Routine is created paused and is enabled once that run's pull request is approved. It lives in
the Routines list of the claude.ai account, where it is paused, fired early or rescheduled; its
prompt is a few lines pointing here (and a fallback that clones the repository if the fresh
session has no checkout), so nothing there needs editing when this file changes.

**By hand:** paste `PROMPT.md` into a fresh cloud session on `main`, or fire the Routine from the
Routines list.
