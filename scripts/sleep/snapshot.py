#!/usr/bin/env python3
"""Consolidate before compaction, and wake after it (docs/SLEEP.md, piece 1 and 2).

A session's context is summarised by the harness when it fills. Whatever the summary drops is
gone, and the mechanical state nobody should have to remember (which branch, which files are
dirty, what is committed but not pushed, where the log ends) is the first thing to go. Two hooks
in `.claude/settings.json` run this script:

    python3 -I scripts/sleep/snapshot.py consolidate     # PreCompact, before the summary is made
    python3 -I scripts/sleep/snapshot.py wake            # SessionStart: startup, resume, compact

`consolidate` writes the state to `.claude/sleep/snapshot.md` (ignored by git) and prints, on
standard output, the instructions the summariser follows: what to keep, what to drop, and that
the mechanical state is written down and will be read back. `wake` prints the context the model
gets after the summary (`hookSpecificOutput.additionalContext`): on `compact`, the snapshot and a
warning if the branch has moved since; on `startup` and `resume`, the session-start routine of
`CLAUDE.md` with the newest progress file already found.

The hook's input (session id, trigger, source, the scratchpad path) arrives as JSON on standard
input; the script runs without it too. It reads only git metadata and file names, never a file's
contents, so nothing it writes can carry a key (INV-06). Standard library only.
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SNAPSHOT = Path(".claude") / "sleep" / "snapshot.md"
HEADING = re.compile(r"^## (\d{4}-\d{2}-\d{2})(?: — |: )(.+)$")
LIMIT = 40  # lines of dirty files, commits, worktrees or notes before "… and N more"
STDOUT_LIMIT = 10_000  # the harness truncates a PreCompact hook's output beyond this

INSTRUCTIONS = """\
Consolidation before compaction (docs/SLEEP.md). The mechanical state of this session (branch,
dirty files, commits not on main, worktrees, the newest progress entry) is written to
{snapshot} and will be read back after the summary, so don't spend the summary on it.

Spend the summary on what only the conversation holds, in this order:
1. Standing rules Joshua set in this session, verbatim where the wording matters, and every
   approval or decision he gave (what was approved, for which PR, in his words).
2. Work mid-flight: the task, the exit criterion, what is done, what is next, the exact paths
   and commands in use, and anything promised to Joshua that is not yet delivered.
3. Decisions pending with Joshua, as the questions put to him.
4. Lessons learned: what went wrong, what fixed it, so it isn't repeated.
5. Open pull requests and their state, with the branch each is on.
Drop tool output, file dumps and chatter. Never include a key, a view key, a seed phrase or the
contents of a .env file, and never a https://claude.ai/ link: a session is cited by its bare id.
"""


def run(args, cwd):
    """A git command's standard output, or '' when git or the repository is missing."""
    try:
        done = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return done.stdout.strip() if done.returncode == 0 else ""


def clipped(lines):
    lines = [line for line in lines if line]
    if len(lines) <= LIMIT:
        return lines
    return lines[:LIMIT] + [f"… and {len(lines) - LIMIT} more"]


def newest_progress(root):
    """(path, entry count, last heading) of the newest day file, or None."""
    # One file a day in a folder a month (progress/2026-11/2026-11-07.md); a stray top-level file still counts.
    days = sorted((p for p in (root / "progress").glob("**/*.md") if re.match(r"\d{4}-\d{2}-\d{2}\.md$", p.name)), key=lambda p: p.name)
    if not days:
        return None
    last = days[-1]
    headings = [m.group(0) for m in map(HEADING.match, last.read_text(encoding="utf-8").splitlines()) if m]
    return last.relative_to(root).as_posix(), len(headings), headings[-1] if headings else "(no entry)"


def notes(scratchpad):
    """Names of the note files at the top of the scratchpad: what a session wrote for itself."""
    if not scratchpad:
        return []
    folder = Path(scratchpad)
    if not folder.is_dir():
        return []
    return sorted(p.name for p in folder.iterdir() if p.is_file() and p.suffix in {".md", ".txt"})


def state(root, hook):
    """The snapshot, as Markdown. Git metadata and file names only."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    branch = run(["git", "branch", "--show-current"], root) or "(detached)"
    head = run(["git", "log", "-1", "--format=%h %s"], root) or "(no commits)"
    dirty = clipped(run(["git", "status", "--porcelain=v1", "--untracked-files=normal"], root).splitlines())
    base = "origin/main" if run(["git", "rev-parse", "--verify", "-q", "origin/main"], root) else ""
    ahead = clipped(run(["git", "log", "--oneline", f"{base}..HEAD"], root).splitlines()) if base else []
    behind = run(["git", "rev-list", "--count", f"HEAD..{base}"], root) if base else ""
    worktrees = clipped(run(["git", "worktree", "list"], root).splitlines())
    progress = newest_progress(root)
    lines = [
        "# Consolidation snapshot",
        "",
        f"- When: {now}",
        f"- Session: {hook.get('session_id') or '(unknown)'}",
        f"- Trigger: {hook.get('trigger') or hook.get('hook_event_name') or '(unknown)'}",
        f"- Branch: `{branch}` at {head}",
    ]
    if base:
        lines.append(f"- Against {base}: {len([l for l in ahead if not l.startswith('…')])} commit(s) ahead, {behind or '0'} behind")
    lines += ["", "## Dirty files (uncommitted)", ""]
    lines += [f"    {line}" for line in dirty] or ["    (clean)"]
    if base:
        lines += ["", f"## Commits not on {base}", ""]
        lines += [f"    {line}" for line in ahead] or ["    (none)"]
    lines += ["", "## Worktrees", ""]
    lines += [f"    {line}" for line in worktrees] or ["    (none)"]
    lines += ["", "## The log", ""]
    if progress:
        path, count, last = progress
        lines.append(f"- Newest day file: `{path}`, {count} entries; last: `{last}`")
    else:
        lines.append("- No progress/ day files")
    found = notes(hook.get("scratchpad_dir"))
    lines += ["", "## Notes in the scratchpad", ""]
    lines += [f"    {name}" for name in clipped(found)] or ["    (none)"]
    return "\n".join(lines) + "\n"


def consolidate(root, hook):
    path = root / SNAPSHOT
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(state(root, hook), encoding="utf-8")
    out = INSTRUCTIONS.format(snapshot=SNAPSHOT.as_posix())
    assert len(out) < STDOUT_LIMIT
    sys.stdout.write(out)


def wake(root, hook):
    source = hook.get("source") or "startup"
    path = root / SNAPSHOT
    if source == "compact":
        if not path.is_file():
            text = "Context was compacted; no consolidation snapshot was found (docs/SLEEP.md). Run `git status` and `git log --oneline -5` before continuing."
        else:
            snapshot = path.read_text(encoding="utf-8")
            branch = run(["git", "branch", "--show-current"], root) or "(detached)"
            then = re.search(r"^- Branch: `([^`]*)`", snapshot, re.M)
            warning = ""
            if then and then.group(1) != branch:
                warning = f"\n\nWARNING: the branch was `{then.group(1)}` at the snapshot and is `{branch}` now. Check out the right one before touching anything."
            text = (
                "Context was compacted. The state the session wrote down just before (docs/SLEEP.md) follows; "
                "re-check `git status` before continuing, and don't repeat a push, merge or PR it lists as done.\n\n"
                + snapshot + warning
            )
    else:
        progress = newest_progress(root)
        branch = run(["git", "branch", "--show-current"], root) or "(detached)"
        dirty = run(["git", "status", "--porcelain=v1"], root).splitlines()
        where = f"`{progress[0]}` ({progress[1]} entries; last: `{progress[2]}`)" if progress else "none yet"
        text = (
            f"Session {source} (docs/SLEEP.md, wake). Follow Session start in CLAUDE.md: the Now block of "
            f"BUILD_PLAN.md, then the newest progress file, which is {where}. "
            f"Branch `{branch}`, {len(dirty)} uncommitted change(s)."
        )
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": text}}))


def main(argv):
    root = ROOT
    args = list(argv)
    if "--root" in args:
        i = args.index("--root")
        root = Path(args[i + 1]).resolve()
        del args[i : i + 2]
    if len(args) != 1 or args[0] not in {"consolidate", "wake"}:
        sys.stderr.write("usage: snapshot.py (consolidate|wake) [--root DIR]\n")
        return 2
    hook = {}
    if not sys.stdin.isatty():
        raw = sys.stdin.read()
        if raw.strip():
            try:
                hook = json.loads(raw)
            except json.JSONDecodeError:
                hook = {}
    (consolidate if args[0] == "consolidate" else wake)(root, hook if isinstance(hook, dict) else {})
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
