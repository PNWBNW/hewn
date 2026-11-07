---
name: rest
description: End of a task, as one command (docs/SLEEP.md): run the checks, write the day's progress entry signed with this session's id, regenerate the indexes, tick the exit criteria met, commit, open the pull request, stop. Use it at the end of every task, before reporting to Joshua.
argument-hint: [one line on what the task did]
---

# Rest: the end-of-task consolidation

This is the "End of every task" item of `CLAUDE.md`'s Working agreement, run as one routine so
no step is skipped when the context is tired. It consolidates what this session did into the
repository before the session ends and its context is gone (`docs/SLEEP.md`). Do the steps in
order; stop at the first one that fails and say which.

The state now:

- Branch: !`git branch --show-current`
- Uncommitted: !`git status --porcelain=v1 | wc -l | tr -d ' '` file(s)
- Today (UTC): !`date -u +%Y-%m-%d`
- Newest progress file: !`ls progress/*.md | sort | tail -1`
- This session: `${CLAUDE_SESSION_ID}`

What the task did, if given: $ARGUMENTS

## 1. The checks

Run what the change touches, and always the repository's own fast checks:

- `pnpm test` when any package or app changed; a changed workflow or script runs its own test
  (`node --test`, `python3 -I scripts/<name>_test.py`).
- `python3 -I scripts/check_secrets.py`, `python3 -I scripts/check_links.py`,
  `python3 -I scripts/check_invariants.py`; `python3 -I scripts/check_signing_path.py` and
  `python3 -I scripts/check_program_names.py` when `apps/` or `packages/` changed.

Nothing is committed while a check fails. Fix it, or stop and say what fails.

## 2. The progress entry

Append to today's file in `progress/` (create it if today's is the first entry), with the
heading `## <today> — <title>`: what changed, why, test counts, transaction ids if any, what is
next or open. Detail goes here, not in chat. The last line is the bare id of this session:

    — ${CLAUDE_SESSION_ID}

Never a link (`docs/MEMORY.md`): only Joshua can open the transcript, and the id is the trail.

## 3. The indexes and the plan

- `python3 -I scripts/progress_index.py --write`
- `python3 -I scripts/docs_index.py --write` when a document under `docs/` changed (its
  frontmatter `updated` and `status` first: a design whose parts are built says so).
- Tick any exit criterion the task met in `BUILD_PLAN.md`, and move the Now block when the work
  moved.
- A decision Joshua made in this session goes in `memory/decisions.md` in its subcategory, in the
  file's one-line format; a lesson learned the hard way in `memory/lessons.md` with its source.

## 4. Commit, pull request, stop

- One commit, `<scope>: <what changed>`; never a `https://claude.ai/...` link in it.
- Push to this session's branch only (`git push -u origin <branch>`); never force.
- One pull request, one task (OPS-08): what changed and why, how it was checked, what Joshua
  should look at. After opening it, read its body back and remove any session link a tool
  appended.
- Report to Joshua in a few lines, leading with the result, and stop. The merge is his (OPS-01).
