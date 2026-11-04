#!/usr/bin/env python3
"""Retired code is deleted, not kept (docs/INVARIANTS.md, OPS-09).

Git history is the archive. `archive/` holds one file, its README, with one row per retired thing
naming the commit that still holds it. This fails when:
  - anything git tracks under archive/ is not archive/README.md;
  - a row of the README's table doesn't name a commit (a backticked hex id, 7 to 40 characters);
  - git is available with full history and a named commit doesn't exist in it.

Deployed Leo program versions are not here: they stay in pnw_mvp_v2's src/layer*/archive/,
unchanged (INV-21), and that repository checks them (scripts/check_archive.py there).

Standard library only. Run from the repository root: python3 -I scripts/check_archive.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = "archive/README.md"
COMMIT = re.compile(r"`([0-9a-f]{7,40})`")


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)


def main() -> int:
    problems = []
    tracked = git("ls-files", "archive")
    files = tracked.stdout.split() if tracked.returncode == 0 else [
        p.relative_to(ROOT).as_posix() for p in (ROOT / "archive").rglob("*") if p.is_file() and "node_modules" not in p.parts]
    for f in files:
        if f != README:
            problems.append(f"{f}: archive/ holds only its README; retired code is deleted (git history keeps it)")
    readme = ROOT / README
    if not readme.exists():
        problems.append(f"{README} is missing: it is the record of what was retired")
        rows = []
    else:
        rows = [line for line in readme.read_text(encoding="utf-8").splitlines()
                if line.startswith("| `")]
    if not rows:
        problems.append(f"{README}: no rows found in its table")
    full_history = git("rev-parse", "--is-shallow-repository").stdout.strip() == "false"
    for row in rows:
        cells = [c.strip() for c in row.strip("|").split("|")]
        held = COMMIT.findall(cells[-1]) if cells else []
        if not held:
            problems.append(f"{README}: the row for {cells[0]} names no commit that holds it")
        elif full_history:
            for c in held:
                if git("cat-file", "-e", f"{c}^{{commit}}").returncode != 0:
                    problems.append(f"{README}: the row for {cells[0]} names {c}, which isn't in the history")
    if problems:
        print("archive check: FAIL", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    note = "commits checked" if full_history else "commits' form checked (shallow clone)"
    print(f"archive check: PASS - only the README, {len(rows)} retired things, {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
