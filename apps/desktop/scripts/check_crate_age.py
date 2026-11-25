#!/usr/bin/env python3
"""Every crate in a Cargo.lock was published at least seven days before it was pinned: the Rust
side of the npm workspace's minimumReleaseAge (docs/THREAT_MODEL.md T3, OPS-04).

Reads each crate's publish time from the crates.io index (the `pubtime` field of the sparse
index) and fails on any crate published less than MIN_DAYS before the lockfile's own last commit,
or before now when the lockfile is changed and not yet committed.

A crate from git is accepted only at a pinned commit: its source must name `rev=<40 hex>` and
resolve to that same commit (never a branch, a tag or a bare repository), and the commit's own
date must be at least MIN_DAYS before the lockfile was pinned. The date is read by fetching that
one commit, without its files, with git. With `--no-git`, any crate from git fails (the native
app takes every crate from crates.io).

Needs the network; run it when a Cargo.lock changes (.github/workflows/desktop.yml and native.yml
do).

  python3 -I apps/desktop/scripts/check_crate_age.py                       # the desktop app's
  python3 -I apps/desktop/scripts/check_crate_age.py --lock apps/native/Cargo.lock --no-git
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import tomllib
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

MIN_DAYS = 7
DESKTOP_LOCK = Path(__file__).resolve().parent.parent / "src-tauri" / "Cargo.lock"
CRATES_IO = "registry+https://github.com/rust-lang/crates.io-index"
GIT_SOURCE = re.compile(r"^git\+(https://[^?#\s]+)\?rev=([0-9a-f]{40})#([0-9a-f]{40})$")


def index_path(name: str) -> str:
    n = name.lower()
    if len(n) <= 2:
        return f"{len(n)}/{n}"
    if len(n) == 3:
        return f"3/{n[0]}/{n}"
    return f"{n[0:2]}/{n[2:4]}/{n}"


def pubtimes(name: str) -> dict[str, str]:
    url = f"https://index.crates.io/{index_path(name)}"
    with urllib.request.urlopen(url, timeout=30) as response:  # noqa: S310 (a fixed https host)
        lines = response.read().decode().splitlines()
    out: dict[str, str] = {}
    for line in lines:
        entry = json.loads(line)
        if "pubtime" in entry:
            out[entry["vers"]] = entry["pubtime"]
    return out


def pinned_at(lock: Path) -> datetime:
    """When the lockfile was last committed; now, if it has changes not yet committed."""
    repo = lock.parent
    dirty = subprocess.run(["git", "status", "--porcelain", "--", lock.name], cwd=repo, capture_output=True, text=True).stdout.strip()
    if not dirty:
        stamp = subprocess.run(["git", "log", "-1", "--format=%cI", "--", lock.name], cwd=repo, capture_output=True, text=True).stdout.strip()
        if stamp:
            return datetime.fromisoformat(stamp)
    return datetime.now(timezone.utc)


def commit_date(url: str, rev: str) -> datetime:
    """The committer date of one commit, fetched alone (no files, no history) into a scratch repository."""
    with tempfile.TemporaryDirectory() as scratch:
        git = ["git", "-C", scratch, "-c", "protocol.version=2"]
        subprocess.run(["git", "init", "-q", scratch], check=True)
        fetched = subprocess.run([*git, "fetch", "-q", "--depth=1", "--filter=tree:0", url, rev], capture_output=True, text=True)
        if fetched.returncode != 0:
            raise RuntimeError(f"couldn't fetch {rev} from {url}: {fetched.stderr.strip()[:300]}")
        stamp = subprocess.run([*git, "show", "-s", "--format=%cI", rev], capture_output=True, text=True, check=True).stdout.strip()
    return datetime.fromisoformat(stamp)


def main(argv: list[str]) -> int:
    lock_path = DESKTOP_LOCK
    no_git = "--no-git" in argv
    argv = [a for a in argv if a != "--no-git"]
    if argv:
        if len(argv) != 2 or argv[0] != "--lock":
            print("Usage: check_crate_age.py [--lock <path to Cargo.lock>] [--no-git]", file=sys.stderr)
            return 2
        lock_path = Path(argv[1]).resolve()
    lock = tomllib.loads(lock_path.read_text())
    packages = lock.get("package", [])
    cutoff = pinned_at(lock_path) - timedelta(days=MIN_DAYS)
    young: list[str] = []
    unknown: list[str] = []
    unpinned: list[str] = []
    cache: dict[str, dict[str, str]] = {}
    commits: dict[tuple[str, str], datetime] = {}
    registry = 0
    for p in packages:
        name, version, source = p["name"], p["version"], p.get("source")
        if source is None:
            continue  # a crate of this workspace
        if source.startswith("git+") and no_git:
            unpinned.append(f"{name} {version}: from git, which this lockfile may not use ({source})")
            continue
        if source.startswith("git+"):
            m = GIT_SOURCE.match(source)
            if not m or m.group(2) != m.group(3):
                unpinned.append(f"{name} {version}: {source}")
                continue
            key = (m.group(1), m.group(2))
            if key not in commits:
                commits[key] = commit_date(*key)
            if commits[key] > cutoff:
                young.append(f"{name} {version} (git commit {key[1][:12]} of {key[0]}, dated {commits[key]:%Y-%m-%dT%H:%M:%S%z})")
            continue
        if source != CRATES_IO:
            unpinned.append(f"{name} {version}: from {source}, neither crates.io nor a pinned git commit")
            continue
        registry += 1
        if name not in cache:
            cache[name] = pubtimes(name)
        stamp = cache[name].get(version)
        if stamp is None:
            unknown.append(f"{name} {version}")
            continue
        published = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if published > cutoff:
            young.append(f"{name} {version} (published {stamp})")
    for line in unknown:
        # Crates published before the index recorded publish times are old enough by definition.
        print(f"  no publish time in the index (published before 2025): {line}")
    failed = False
    if unpinned:
        failed = True
        print("Not accepted (crates.io, or a git dependency pinned with rev = \"<40 hex commit>\" and never a branch or a tag):")
        for line in unpinned:
            print(f"  {line}")
    if young:
        failed = True
        print(f"Published or committed less than {MIN_DAYS} days before {cutoff + timedelta(days=MIN_DAYS):%Y-%m-%d}:")
        for line in young:
            print(f"  {line}")
        print("Pin an older version: cargo update -p <name> --precise <version> (or an older commit)")
    if failed:
        return 1
    git_note = f" and {len(commits)} pinned git commits" if commits else ""
    print(f"{registry} crates{git_note}, each at least {MIN_DAYS} days old when {lock_path.name} was pinned.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
