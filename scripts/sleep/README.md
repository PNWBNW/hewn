# `scripts/sleep/` — the sleep cycle's hooks

The pieces of `docs/SLEEP.md` that the harness runs on its own. Each is a hook in
`.claude/settings.json` (committed; it applies in local sessions and in cloud sessions with one
repository attached) calling `snapshot.py`, standard library only, run with `python3 -I`. The
hooks run the copy on main, named in full (`git show refs/remotes/origin/main:scripts/sleep/snapshot.py`)
so that a tag or a local branch called `origin/main` can't stand in for it, never the working
tree's; a change to the script takes effect once it is merged, and if main's copy can't be read
the hook says so on standard error rather than running anything. What this can't cover: the hook
commands themselves are read from the `.claude/settings.json` that is checked out, so a branch
that edits that file runs its own command in any session that opens the folder with it checked
out. An outside branch is read as a diff, never checked out in the project folder.

| Hook | Event | What it does |
|---|---|---|
| `consolidate` | `PreCompact` | Before the harness summarises a full context: writes the mechanical state (branch and HEAD, dirty files, commits not on `origin/main`, worktrees, the newest progress file and how many entries it has, the note files in the scratchpad) to `.claude/sleep/snapshot.md` (ignored by git), and prints the instructions the summariser follows: keep Joshua's rules and approvals verbatim, the work mid-flight with its exact paths and commands, pending decisions, lessons, open PRs; drop tool output; never a key or a session link |
| `wake` | `SessionStart` (`startup`, `resume`, `compact`) | After a compaction: puts the snapshot back into the context, with a warning if the branch has moved since. At startup or resume: the session-start routine of `CLAUDE.md`, with the newest progress file already found |

The script reads git metadata and file names only, never a file's contents, so nothing it writes
can carry a key (INV-06). What it prints is read by the model as its own notes, so it carries
nobody's sentences either: commits are short ids, the log is a path and a count, a file, branch,
worktree or note name is shown only when it is a plain name (no spaces, at most 100 characters),
and a day file dated after tomorrow is not "the newest". The snapshot is never written through a
symlink. It runs with or without the hook's JSON on standard
input.

Test: `python3 -I scripts/sleep/snapshot_test.py` (CI runs it). It builds a throwaway repository
and checks what each hook writes and prints, that neither a file's contents nor a commit's title
or an entry's heading reach the snapshot or the wake context, that a future-dated day file isn't
taken as the newest, that the hook commands in `settings.json` run main's copy with the hook's
input intact, also when a tag and a local branch are called `origin/main`, that a missing main is
reported, that names with spaces are withheld, and that a symlinked snapshot is not written.

| `rem_pairs.py` | (none) | Not a hook: the REM pass's draw (`/rem`, `.claude/skills/rem/SKILL.md`). Three random pairs of unrelated parts of the tree (a rule, a threat, a design document, a Leo program, a package, a page, a CI check), seeded by the date so a run repeats, no part twice. Test: `rem_pairs_test.py` (CI) |

The skills (`/rest`, `/dream`, `/light-sleep`, `/rem`) are in `.claude/skills/`.
