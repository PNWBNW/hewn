# `scripts/sleep/` — the sleep cycle's hooks

The pieces of `docs/SLEEP.md` that the harness runs on its own. Each is a hook in
`.claude/settings.json` (committed; it applies in local sessions and in cloud sessions with one
repository attached) calling `snapshot.py`, standard library only, run with `python3 -I`.

| Hook | Event | What it does |
|---|---|---|
| `consolidate` | `PreCompact` | Before the harness summarises a full context: writes the mechanical state (branch and HEAD, dirty files, commits not on `origin/main`, worktrees, the newest progress entry, the note files in the scratchpad) to `.claude/sleep/snapshot.md` (ignored by git), and prints the instructions the summariser follows: keep Joshua's rules and approvals verbatim, the work mid-flight with its exact paths and commands, pending decisions, lessons, open PRs; drop tool output; never a key or a session link |
| `wake` | `SessionStart` (`startup`, `resume`, `compact`) | After a compaction: puts the snapshot back into the context, with a warning if the branch has moved since. At startup or resume: the session-start routine of `CLAUDE.md`, with the newest progress file already found |

The script reads git metadata and file names only, never a file's contents, so nothing it writes
can carry a key (INV-06). It runs with or without the hook's JSON on standard input.

Test: `python3 -I scripts/sleep/snapshot_test.py` (CI runs it). It builds a throwaway repository
and checks what each hook writes and prints, that a file's contents never reach the snapshot, and
that `settings.json` wires both hooks to the script.

The skills (`/rest`, `/dream`, `/light-sleep`, `/rem`) come next, in the order `docs/SLEEP.md`
gives.
