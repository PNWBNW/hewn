#!/usr/bin/env python3
"""Every crate in the desktop app's Cargo.lock was published at least seven days before it was
pinned: the Rust side of the npm workspace's minimumReleaseAge (docs/THREAT_MODEL.md T3, OPS-04).

Reads each crate's publish time from the crates.io index (the `pubtime` field of the sparse
index) and fails on any crate published less than MIN_DAYS before the lockfile's own last commit,
or before now when the lockfile is changed and not yet committed. Needs the network; run it when
Cargo.lock changes (.github/workflows/desktop.yml does).

  python3 -I apps/desktop/scripts/check_crate_age.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tomllib
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

MIN_DAYS = 7
LOCK = Path(__file__).resolve().parent.parent / "src-tauri" / "Cargo.lock"
CRATES_IO = "registry+https://github.com/rust-lang/crates.io-index"


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


def pinned_at() -> datetime:
    """When the lockfile was last committed; now, if it has changes not yet committed."""
    repo = LOCK.parent
    dirty = subprocess.run(["git", "status", "--porcelain", "--", LOCK.name], cwd=repo, capture_output=True, text=True).stdout.strip()
    if not dirty:
        stamp = subprocess.run(["git", "log", "-1", "--format=%cI", "--", LOCK.name], cwd=repo, capture_output=True, text=True).stdout.strip()
        if stamp:
            return datetime.fromisoformat(stamp)
    return datetime.now(timezone.utc)


def main() -> int:
    lock = tomllib.loads(LOCK.read_text())
    packages = [p for p in lock.get("package", []) if p.get("source") == CRATES_IO]
    cutoff = pinned_at() - timedelta(days=MIN_DAYS)
    young: list[str] = []
    unknown: list[str] = []
    cache: dict[str, dict[str, str]] = {}
    for p in packages:
        name, version = p["name"], p["version"]
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
    if young:
        print(f"Published less than {MIN_DAYS} days before {cutoff + timedelta(days=MIN_DAYS):%Y-%m-%d}:")
        for line in young:
            print(f"  {line}")
        print("Pin an older version: cargo update -p <name> --precise <version>")
        return 1
    print(f"{len(packages)} crates, each published at least {MIN_DAYS} days before the lockfile was pinned.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
