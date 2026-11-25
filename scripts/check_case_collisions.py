#!/usr/bin/env python3
"""No two files in the repository differ only by capital letters (the desktop app's Windows and macOS
builds; macOS and Windows file systems ignore case).

Two kinds of clash fail:
- two tracked paths that are the same ignoring case (on Windows or macOS one overwrites the other);
- two modules in one folder whose names are the same ignoring case and extension
  (`Report.tsx` beside `report.ts`): an import without an extension (`./report`) can land on either,
  so a build that passes on Linux fails on a Mac or Windows machine (seen 2026-11-25, the desktop
  app's first build).

Run from the repository root: python3 -I scripts/check_case_collisions.py
"""
import subprocess
import sys
from collections import defaultdict
from pathlib import PurePosixPath

MODULE_EXTENSIONS = {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"}


def module_key(path: str):
    """(folder, name without extension) in lower case, for a module an import may name without its extension."""
    p = PurePosixPath(path)
    if p.suffix not in MODULE_EXTENSIONS:
        return None
    # A test or declaration file keeps its inner suffix in the name (report.test vs Report.test).
    return (str(p.parent).lower(), p.name[: -len(p.suffix)].lower())


def collisions(paths):
    """The clashing groups: [(kind, [paths])]."""
    found = []
    by_path = defaultdict(list)
    by_module = defaultdict(list)
    for path in paths:
        by_path[path.lower()].append(path)
        key = module_key(path)
        if key is not None:
            by_module[key].append(path)
    for group in by_path.values():
        if len(group) > 1:
            found.append(("same path ignoring case", sorted(group)))
    for group in by_module.values():
        stems = {PurePosixPath(p).name[: -len(PurePosixPath(p).suffix)] for p in group}
        if len(stems) > 1:
            found.append(("modules differing only by case", sorted(group)))
    return found


def main() -> int:
    paths = subprocess.run(["git", "ls-files", "-z"], capture_output=True, check=True).stdout.decode().split("\0")
    problems = collisions([p for p in paths if p])
    if problems:
        print("case collisions: FAIL")
        for kind, group in problems:
            print(f"  - {kind}: {', '.join(group)}")
        return 1
    print(f"case collisions: PASS - {len([p for p in paths if p])} files, no two differ only by case")
    return 0


if __name__ == "__main__":
    sys.exit(main())
