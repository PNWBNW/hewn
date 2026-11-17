#!/usr/bin/env python3
"""No commit message or pull request description carries a claude.ai session link (CLAUDE.md,
Working agreement; Joshua, 2026-10-29). A session's bare id (`session_...`) is fine: only Joshua
can open the transcript, and the progress log is signed with it.

Reads the GitHub event that started the run ($GITHUB_EVENT_PATH):
  - push: every commit from `before` to `after` (a new branch, or a history the clone doesn't
    have: every commit on `after` that isn't on the default branch), and the messages the event
    lists;
  - pull_request: every commit from the base to the head, and the title and description.
With no event (a run on your own machine) it checks the commits on HEAD that aren't on
origin/main. Matches are reported by commit or field; the link itself is not printed.

Standard library only. Run from the repository root (with history: fetch-depth 0):

    python3 -I scripts/check_session_links.py
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINK = re.compile(r"claude\.ai/[^\s)]*session_", re.I)
ZERO = re.compile(r"^0+$")


def has_link(text: str | None) -> bool:
    return bool(text) and bool(LINK.search(text))


def git(*args: str, cwd: Path = ROOT) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


def messages(rev_args: list[str], cwd: Path = ROOT) -> list[tuple[str, str]] | None:
    """[(sha, full message)] for `git log <rev_args>`, or None when git can't walk that range."""
    out = git("log", "--format=%H%x00%B%x00%x01", *rev_args, "--", cwd=cwd)
    if out.returncode != 0:
        return None
    found = []
    for chunk in out.stdout.split("\x01"):
        chunk = chunk.lstrip("\n")
        if "\x00" in chunk:
            sha, body = chunk.split("\x00", 2)[:2]
            found.append((sha, body))
    return found


def texts_for_event(name: str, event: dict, cwd: Path = ROOT) -> list[tuple[str, str]]:
    """[(where, text)] to check for the event `name` with payload `event`."""
    texts: list[tuple[str, str]] = []
    default = f"origin/{(event.get('repository') or {}).get('default_branch') or 'main'}"
    if name == "pull_request":
        pr = event.get("pull_request") or {}
        texts.append(("the pull request's title", pr.get("title") or ""))
        texts.append(("the pull request's description", pr.get("body") or ""))
        base, head = (pr.get("base") or {}).get("sha"), (pr.get("head") or {}).get("sha")
        if base and head:
            found = messages([f"{base}..{head}"], cwd)
            if found is None:
                raise SystemExit(f"session links: can't read the commits {base[:12]}..{head[:12]}")
            texts += [(f"commit {sha[:12]}", body) for sha, body in found]
    elif name == "push":
        before, after = event.get("before") or "", event.get("after") or ""
        for commit in event.get("commits") or []:
            texts.append((f"commit {str(commit.get('id', ''))[:12]}", commit.get("message") or ""))
        if after and not ZERO.match(after):
            found = None
            if before and not ZERO.match(before):
                found = messages([f"{before}..{after}"], cwd)
            if found is None:  # a new branch, or a force push from a history not fetched
                found = messages([after, "--not", default], cwd)
            if found is None:
                raise SystemExit(f"session links: can't read the commits on {after[:12]}")
            texts += [(f"commit {sha[:12]}", body) for sha, body in found]
    else:
        found = messages(["HEAD", "--not", default], cwd) or []
        texts += [(f"commit {sha[:12]}", body) for sha, body in found]
    return texts


def main() -> int:
    name = os.environ.get("GITHUB_EVENT_NAME", "")
    path = os.environ.get("GITHUB_EVENT_PATH", "")
    event = json.loads(Path(path).read_text()) if path else {}
    texts = texts_for_event(name, event)
    bad = sorted({where for where, text in texts if has_link(text)})
    if bad:
        print("session links: FAIL", file=sys.stderr)
        for where in bad:
            print(f"  - {where} carries a claude.ai session link", file=sys.stderr)
        print("Remove the link (a bare session id is fine): amend the commit, or edit the description.",
              file=sys.stderr)
        return 1
    print(f"session links: ok ({len(texts)} message(s) checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
