#!/usr/bin/env python3
"""The HQC code in packages/hqc/vendor is the HQC team's, byte for byte, but for the reviewed
patches (packages/hqc/README.md; docs/INVARIANTS.md, OPS-04).

packages/hqc/vendor/manifest.json names the upstream repository, its tag and the commit the tag
names, and every vendored file with its SHA-256. This check doesn't take the manifest's word for
anything it can test.

Always (no network):
  - every file under the vendored root is listed, and every listed file is there, a regular file
    (no link), with the SHA-256 listed: an extra, missing or changed file fails;
  - a listed file with no patch is upstream's: it records no upstream hash of its own;
  - a patched file records upstream's SHA-256 and one replacement (`find` -> `replace`, with its
    reason). Undoing it (the replacement occurring exactly once, put back to `find`) must give a
    file with upstream's SHA-256, so the vendored file is upstream's with that one change and no
    other. A patch that doesn't undo cleanly, or has no reason, fails;
  - each fixture (the official known-answer file) has the SHA-256 listed.

With --upstream (needs the network, gitlab.com; CI's rebuild job runs it):
  - `git ls-remote` says the tag still names the pinned tag object and commit (a moved tag fails);
  - every listed file and fixture is fetched at the pinned commit from the repository's raw
    endpoint, and its SHA-256 must be the upstream one listed (the file's own for an unpatched
    file, `upstream_sha256` for a patched one).

Standard library only. Run from the repository root:

    python3 -I packages/hqc/scripts/check_vendor.py
    python3 -I packages/hqc/scripts/check_vendor.py --upstream
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
MANIFEST = PACKAGE / "vendor" / "manifest.json"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX40 = re.compile(r"^[0-9a-f]{40}$")
SAFE_PATH = re.compile(r"^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*$")


class CheckError(Exception):
    """A reason the check fails, in one sentence."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load(path: Path = MANIFEST) -> dict:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise CheckError(f"{path.name} can't be read: {e}") from e
    up = manifest.get("upstream", {})
    if not str(up.get("repository", "")).startswith("https://gitlab.com/"):
        raise CheckError("the manifest's upstream repository isn't a gitlab.com https address")
    if not HEX40.match(str(up.get("commit", ""))) or not HEX40.match(str(up.get("tag_object", ""))):
        raise CheckError("the manifest must pin the upstream commit and tag object as full hashes")
    if not up.get("tag"):
        raise CheckError("the manifest names no upstream tag")
    for entry in manifest.get("files", []) + manifest.get("fixtures", []):
        path = entry.get("path", "")
        if not SAFE_PATH.match(path) or ".." in path.split("/"):
            raise CheckError(f"the manifest lists an unsafe path: {path!r}")
        if not HEX64.match(entry.get("sha256", "")):
            raise CheckError(f"{path}: the manifest's SHA-256 isn't 64 lower-case hex digits")
    if not manifest.get("files"):
        raise CheckError("the manifest lists no files")
    return manifest


def check_patch(entry: dict, data: bytes) -> None:
    """A patched file is upstream's with exactly the one replacement the manifest records."""
    patch = entry["patch"]
    upstream = entry.get("upstream_sha256", "")
    if not HEX64.match(upstream):
        raise CheckError(f"{entry['path']}: a patched file must record upstream's SHA-256")
    if not str(patch.get("reason", "")).strip():
        raise CheckError(f"{entry['path']}: a patch must say why")
    find, replace = patch.get("find", ""), patch.get("replace", "")
    if not find or not replace or find == replace:
        raise CheckError(f"{entry['path']}: a patch needs a `find` and a different `replace`")
    new = replace.encode("utf-8")
    if data.count(new) != 1:
        raise CheckError(f"{entry['path']}: the patch's replacement isn't in the file exactly once")
    restored = data.replace(new, find.encode("utf-8"))
    if sha256(restored) != upstream:
        raise CheckError(f"{entry['path']}: undoing the patch doesn't give upstream's file (another change is in it)")


def check_local(manifest: dict, package: Path = PACKAGE) -> list[str]:
    """Every vendored file and fixture against the manifest; returns what was checked."""
    root = package / manifest.get("root", "")
    if not root.is_dir() or root == package:
        raise CheckError("the manifest's root isn't a folder inside the package")
    listed = {e["path"]: e for e in manifest["files"]}
    if len(listed) != len(manifest["files"]):
        raise CheckError("the manifest lists a file twice")
    present = set()
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).as_posix()
        if p.is_symlink():
            raise CheckError(f"{rel}: a link in the vendored tree")
        if p.is_file():
            present.add(rel)
    if extra := sorted(present - set(listed)):
        raise CheckError(f"files in the vendored tree the manifest doesn't list: {', '.join(extra)}")
    if missing := sorted(set(listed) - present):
        raise CheckError(f"files the manifest lists that aren't there: {', '.join(missing)}")
    checked = []
    for rel, entry in sorted(listed.items()):
        data = (root / rel).read_bytes()
        if sha256(data) != entry["sha256"]:
            raise CheckError(f"{rel}: its SHA-256 isn't the manifest's (a changed file)")
        if "patch" in entry:
            check_patch(entry, data)
        elif "upstream_sha256" in entry:
            raise CheckError(f"{rel}: an upstream hash without a patch")
        checked.append(rel)
    for entry in manifest.get("fixtures", []):
        p = package / entry["path"]
        if p.is_symlink() or not p.is_file():
            raise CheckError(f"{entry['path']}: the fixture isn't there")
        if sha256(p.read_bytes()) != entry["sha256"]:
            raise CheckError(f"{entry['path']}: its SHA-256 isn't the manifest's")
        checked.append(entry["path"])
    return checked


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as response:  # noqa: S310 (a fixed https host)
        return response.read()


def check_upstream(manifest: dict) -> None:
    up = manifest["upstream"]
    repo = up["repository"].rstrip("/")
    refs = subprocess.run(
        ["git", "ls-remote", f"{repo}.git", f"refs/tags/{up['tag']}", f"refs/tags/{up['tag']}^{{}}"],
        capture_output=True, text=True, timeout=120, check=False,
    )
    if refs.returncode != 0:
        raise CheckError(f"git ls-remote {repo} failed")
    seen = dict(reversed(line.split("\t", 1)) for line in refs.stdout.splitlines() if "\t" in line)
    if seen.get(f"refs/tags/{up['tag']}") != up["tag_object"]:
        raise CheckError(f"the tag {up['tag']} no longer names the pinned tag object")
    if seen.get(f"refs/tags/{up['tag']}^{{}}") != up["commit"]:
        raise CheckError(f"the tag {up['tag']} no longer names the pinned commit")
    entries = [(e["path"], e.get("upstream_sha256", e["sha256"])) for e in manifest["files"]]
    entries += [(e["upstream_path"], e["sha256"]) for e in manifest.get("fixtures", [])]
    for path, want in entries:
        url = f"{repo}/-/raw/{up['commit']}/{urllib.parse.quote(path)}"
        if sha256(fetch(url)) != want:
            raise CheckError(f"{path}: upstream's file at {up['commit'][:12]} has another SHA-256 than the manifest's")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--upstream", action="store_true", help="also compare with the upstream repository (network)")
    args = parser.parse_args(argv)
    try:
        manifest = load()
        checked = check_local(manifest)
        patched = [e["path"] for e in manifest["files"] if "patch" in e]
        if args.upstream:
            check_upstream(manifest)
    except CheckError as e:
        print(f"check_vendor: {e}", file=sys.stderr)
        return 1
    up = manifest["upstream"]
    where = "and upstream agrees" if args.upstream else "(upstream not compared; --upstream does)"
    print(
        f"check_vendor: {len(checked)} files match the manifest for {up['tag']} at {up['commit'][:12]}, "
        f"{len(patched)} patched ({', '.join(patched) or 'none'}), {where}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
