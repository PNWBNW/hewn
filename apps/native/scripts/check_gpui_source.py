#!/usr/bin/env python3
"""GPUI's crates.io snapshots are Zed's own source, file for file (apps/native/README.md).

The native app takes GPUI through gpui-kit, which pins `gpui-pre`: weekly crates.io snapshots
of Zed's GPUI published by one maintainer. This check doesn't take their word for it. For every
`gpui-pre` and `gpui-pre-*` crate in apps/native/Cargo.lock it:

1. downloads the exact `.crate` from crates.io and checks its SHA-256 against Cargo.lock;
2. reads the Zed commit and crate it was taken from (`[package.metadata.gpui-pre]`: `zed-rev`, a
   full 40-hex commit, and `zed-crate`, the crate's name in Zed's workspace), and checks that the
   short commit in the crate's description is that same commit;
3. fetches Zed's repository at that commit (shallow, by commit, files only for the crates
   compared) and finds the crate's folder by its name;
4. compares every file: a file that differs, a file only in the snapshot, or a file only in Zed
   fails the check.

What is not compared, and why (IGNORED below; nothing else is):
- `Cargo.toml`: cargo rewrites every manifest it publishes (normalised, workspace values filled
  in), so it never matches the source.
- `Cargo.toml.orig`: the manifest as the snapshot wrote it. It renames the package and its
  dependencies to `gpui-pre-*` and adds `[package.metadata.gpui-pre]`, so it differs from Zed's by
  design. What it depends on is in Cargo.lock, where every crate is held to the seven-day rule
  (apps/desktop/scripts/check_crate_age.py), and its build script, if any, is compared here
  like any other file.
- `.cargo_vcs_info.json` and `Cargo.lock`: written by `cargo package`, not part of any source.
- On Zed's side, a folder holding its own `Cargo.toml` (a nested crate, which cargo never packs
  into its parent) and files that `[package] include`/`exclude` keep out of the package.
  Zed's symbolic links are compared by what they point to, as cargo packs the file itself.

The snapshots are not pure copies, and the check says so rather than look away. Two kinds of
difference pass, and only as written down in apps/native/gpui_patches.toml, which a person reads
and approves in a pull request:
- `[[vendor]]`: a folder of the snapshot that copies another Zed crate's files (gpui-pre-apple's
  `vendor/gpui`, which its build script reads in place of `../gpui`). Each file there is
  compared byte for byte with that Zed crate's file at the same path, and fails if it differs or
  Zed has no such file.
- `[[patch]]`: one file the snapshot changes or adds, pinned by the SHA-256 of Zed's file (empty
  for a file Zed doesn't have) and of the snapshot's, with why it was changed. A patch that
  changes in any byte, a new one, or one listed that no longer applies fails the check, so a new
  gpui-pre version is accepted only after its changes are read again.
`--print-patches` prints the entries for the differences found, for that review; it never writes
the file.

A crate that names no Zed commit, or whose folder can't be found at that commit, fails the
check. Needs the network (crates.io and github.com) and git; standard library only.

  python3 -I apps/native/scripts/check_gpui_source.py
  python3 -I apps/native/scripts/check_gpui_source.py --keep /tmp/gpui-check   # keep the downloads
  python3 -I apps/native/scripts/check_gpui_source.py --print-patches          # entries to review
"""

from __future__ import annotations

import fnmatch
import hashlib
import io
import re
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import urllib.request
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

LOCK = Path(__file__).resolve().parent.parent / "Cargo.lock"
PATCHES = Path(__file__).resolve().parent.parent / "gpui_patches.toml"
CRATES_IO = "registry+https://github.com/rust-lang/crates.io-index"
ZED = "https://github.com/zed-industries/zed"
FAMILY = re.compile(r"^gpui-pre(-[a-z0-9-]+)?$")
REV = re.compile(r"^[0-9a-f]{40}$")
SHORT = re.compile(r"\bzed@([0-9a-f]{7,40})\b")
# Files in the published crate that are not source: see the docstring for why each is here.
IGNORED = frozenset({"Cargo.toml", "Cargo.toml.orig", ".cargo_vcs_info.json", "Cargo.lock"})


class CheckError(Exception):
    """A reason the check fails, in one sentence."""


@dataclass(frozen=True)
class Pinned:
    name: str
    version: str
    checksum: str


@dataclass(frozen=True)
class Snapshot:
    pinned: Pinned
    zed_crate: str
    zed_rev: str
    root: Path  # the unpacked crate


def pinned_family(lock_text: str) -> list[Pinned]:
    """Every gpui-pre crate the lockfile pins from crates.io, with its checksum."""
    out = []
    for p in tomllib.loads(lock_text).get("package", []):
        if not FAMILY.match(p["name"]):
            continue
        if p.get("source") != CRATES_IO or not p.get("checksum"):
            raise CheckError(f"{p['name']} {p['version']} isn't pinned from crates.io with a checksum")
        out.append(Pinned(p["name"], p["version"], p["checksum"]))
    return sorted(out, key=lambda p: p.name)


def download(p: Pinned) -> bytes:
    url = f"https://static.crates.io/crates/{p.name}/{p.name}-{p.version}.crate"
    with urllib.request.urlopen(url, timeout=60) as response:  # noqa: S310 (a fixed https host)
        return response.read()


def unpack(p: Pinned, data: bytes, into: Path) -> Path:
    """Checks the archive against the lockfile's checksum, then unpacks it (no links, no paths outside)."""
    digest = hashlib.sha256(data).hexdigest()
    if digest != p.checksum:
        raise CheckError(f"{p.name} {p.version}: the download's SHA-256 {digest} isn't Cargo.lock's {p.checksum}")
    prefix = f"{p.name}-{p.version}/"
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.name.startswith(prefix) or not (member.isfile() or member.isdir()):
                raise CheckError(f"{p.name} {p.version}: the archive holds {member.name!r}, which a crate can't")
        tar.extractall(into, filter="data")
    return into / prefix.rstrip("/")


def snapshot_of(p: Pinned, root: Path) -> Snapshot:
    """The Zed commit and crate a snapshot names; fails when it names none."""
    manifest = tomllib.loads((root / "Cargo.toml").read_text())
    package = manifest.get("package", {})
    meta = package.get("metadata", {}).get("gpui-pre", {})
    rev, crate = meta.get("zed-rev"), meta.get("zed-crate")
    if not isinstance(rev, str) or not REV.match(rev) or not isinstance(crate, str) or not crate:
        raise CheckError(f"{p.name} {p.version} names no Zed commit ([package.metadata.gpui-pre] zed-rev and zed-crate)")
    short = SHORT.search(package.get("description", "") or "")
    if short and not rev.startswith(short.group(1)):
        raise CheckError(f"{p.name} {p.version}: its description names zed@{short.group(1)}, its metadata {rev}")
    return Snapshot(p, crate, rev, root)


def tree(root: Path, *, skip_nested: bool = False, keep=lambda rel: True) -> dict[str, bytes]:
    """Every file under `root` by its relative path, links read through. With `skip_nested`, a
    folder below the root that holds its own Cargo.toml is left out, as cargo leaves it out."""
    out: dict[str, bytes] = {}

    def walk(d: Path) -> None:
        for entry in sorted(d.iterdir()):
            rel = entry.relative_to(root).as_posix()
            if entry.is_dir():
                if skip_nested and (entry / "Cargo.toml").exists():
                    continue
                if not entry.is_symlink():
                    walk(entry)
                continue
            if entry.is_file() and keep(rel):
                out[rel] = entry.read_bytes()

    walk(root)
    return out


def package_filter(manifest_text: str):
    """What `[package] include`/`exclude` let into a package, as cargo applies them (gitignore-style globs)."""
    package = tomllib.loads(manifest_text).get("package", {})
    include, exclude = package.get("include"), package.get("exclude", [])

    def matches(rel: str, patterns) -> bool:
        path = PurePosixPath(rel)
        for pat in patterns:
            pat = pat.lstrip("/")
            if fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(rel, pat.rstrip("/") + "/*"):
                return True
            if any(fnmatch.fnmatch(str(parent), pat.rstrip("/")) for parent in path.parents if str(parent) != "."):
                return True
        return False

    if include is not None:
        return lambda rel: matches(rel, include)
    return lambda rel: not matches(rel, exclude)


@dataclass(frozen=True)
class Difference:
    """A file that isn't the same on both sides: its path, and the SHA-256 of each side ("" when absent)."""

    path: str
    zed: str
    snapshot: str

    def sentence(self) -> str:
        if not self.zed:
            return f"only in the snapshot: {self.path}"
        if not self.snapshot:
            return f"only in Zed: {self.path}"
        return f"differs: {self.path}"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compare(snapshot_files: dict[str, bytes], zed_files: dict[str, bytes]) -> list[Difference]:
    """Every file that differs, is only in the snapshot, or is only in Zed."""
    out = []
    for rel in sorted(set(snapshot_files) | set(zed_files)):
        if rel in IGNORED:
            continue
        s, z = snapshot_files.get(rel), zed_files.get(rel)
        if s != z:
            out.append(Difference(rel, sha(z) if z is not None else "", sha(s) if s is not None else ""))
    return out


@dataclass(frozen=True)
class Reviewed:
    """apps/native/gpui_patches.toml: the vendored folders and the patched files a person accepted."""

    vendor: tuple[tuple[str, str, str, str], ...]  # (crate, version, folder in the snapshot, Zed crate)
    patches: tuple[tuple[str, str, str, str, str], ...]  # (crate, version, path, zed sha, snapshot sha)


def reviewed(text: str) -> Reviewed:
    data = tomllib.loads(text)
    vendor, patches = [], []
    for v in data.get("vendor", []):
        if not all(isinstance(v.get(k), str) and v.get(k) for k in ("crate", "version", "folder", "zed-crate")):
            raise CheckError("gpui_patches.toml: a [[vendor]] needs crate, version, folder and zed-crate")
        vendor.append((v["crate"], v["version"], v["folder"].strip("/"), v["zed-crate"]))
    for p in data.get("patch", []):
        if not all(isinstance(p.get(k), str) for k in ("crate", "version", "path", "zed", "snapshot", "why")) or not p["why"].strip():
            raise CheckError("gpui_patches.toml: a [[patch]] needs crate, version, path, zed, snapshot and why")
        if not re.fullmatch(r"[0-9a-f]{64}", p["snapshot"]) or not re.fullmatch(r"([0-9a-f]{64})?", p["zed"]):
            raise CheckError(f"gpui_patches.toml: {p['crate']} {p['path']}: the hashes are SHA-256 hex (zed empty for an added file)")
        patches.append((p["crate"], p["version"], p["path"], p["zed"], p["snapshot"]))
    return Reviewed(tuple(vendor), tuple(patches))


def judge(s: "Snapshot", differences: list[Difference], rules: Reviewed, used: set) -> list[str]:
    """The differences no reviewed patch accounts for, as sentences."""
    problems = []
    for d in differences:
        key = (s.pinned.name, s.pinned.version, d.path, d.zed, d.snapshot)
        if key in rules.patches:
            used.add(key)
        else:
            problems.append(d.sentence())
    return problems


def print_patches(found: list[tuple["Snapshot", Difference]]) -> None:
    for s, d in found:
        print("[[patch]]")
        print(f'crate = "{s.pinned.name}"')
        print(f'version = "{s.pinned.version}"')
        print(f'path = "{d.path}"')
        print(f'zed = "{d.zed}"')
        print(f'snapshot = "{d.snapshot}"')
        print('why = ""')
        print()


def git(repo: Path, *args: str) -> str:
    done = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if done.returncode != 0:
        raise CheckError(f"git {' '.join(args[:2])} failed: {done.stderr.strip()[:300]}")
    return done.stdout


def zed_checkout(rev: str, crates: list[str], into: Path) -> dict[str, Path]:
    """Zed at `rev`, with files only for the folders of the named crates; each crate's folder."""
    subprocess.run(["git", "init", "-q", str(into)], check=True)
    git(into, "fetch", "-q", "--depth=1", "--filter=blob:none", ZED, rev)
    manifests = [p for p in git(into, "ls-tree", "-r", "--name-only", rev).splitlines() if p.startswith("crates/") and p.endswith("/Cargo.toml")]
    found: dict[str, Path] = {}
    for crate in crates:
        # Zed names a crate's folder after it, mostly: try that first, then any folder whose
        # manifest names the crate. The manifest decides, never the folder's name.
        guesses = [f"crates/{crate}/Cargo.toml", f"crates/{crate.replace('-', '_')}/Cargo.toml"]
        ordered = [m for m in guesses if m in manifests] + [m for m in manifests if m.rsplit("/", 2)[-2] in (crate, crate.replace("-", "_"))]
        ordered += [m for m in manifests if m not in ordered]
        for manifest in ordered:
            text = git(into, "show", f"{rev}:{manifest}")
            name = tomllib.loads(text).get("package", {}).get("name")
            if name == crate:
                found[crate] = Path(manifest).parent
                break
        else:
            raise CheckError(f"Zed at {rev} has no crate named {crate}")
    git(into, "sparse-checkout", "set", "--no-cone", *[f"/{p.as_posix()}/" for p in found.values()], "/LICENSE-*", "/LICENSES/")
    git(into, "checkout", "-q", rev)
    return {crate: into / rel for crate, rel in found.items()}


def check(lock_text: str, patches_text: str, work: Path, fetch=download) -> tuple[list[str], list[str], list[tuple[Snapshot, Difference]]]:
    """(problems, notes, differences): every gpui-pre crate in the lockfile against Zed at the
    commit it names, with the reviewed vendored folders and patches allowed and nothing else."""
    rules = reviewed(patches_text)
    pinned = pinned_family(lock_text)
    if not pinned:
        return ["no gpui-pre crate in the lockfile: the window takes GPUI from gpui-kit"], [], []
    snapshots = [snapshot_of(p, unpack(p, fetch(p), work / "crates")) for p in pinned]
    problems: list[str] = []
    notes: list[str] = []
    found: list[tuple[Snapshot, Difference]] = []
    used: set = set()
    for rev in sorted({s.zed_rev for s in snapshots}):
        group = [s for s in snapshots if s.zed_rev == rev]
        vendors = [v for v in rules.vendor if any(v[0] == s.pinned.name and v[1] == s.pinned.version for s in group)]
        base = work / f"zed-{rev[:12]}"
        folders = zed_checkout(rev, sorted({s.zed_crate for s in group} | {v[3] for v in vendors}), base)
        for s in group:
            folder = folders[s.zed_crate]
            where = folder.relative_to(base).as_posix() if folder.is_relative_to(base) else folder.name
            label = f"{s.pinned.name} {s.pinned.version} (zed@{rev[:12]} {where})"
            mine = tree(s.root)
            own: list[str] = []
            for crate, version, sub, zed_crate in vendors:
                if (crate, version) != (s.pinned.name, s.pinned.version):
                    continue
                theirs = tree(folders[zed_crate])
                copied = {rel[len(sub) + 1 :]: data for rel, data in mine.items() if rel.startswith(sub + "/")}
                if not copied:
                    own.append(f"the reviewed vendored folder {sub}/ isn't in the snapshot")
                for rel, data in sorted(copied.items()):
                    if theirs.get(rel) != data:
                        own.append(f"vendored {sub}/{rel} isn't {zed_crate}'s {rel} at this commit")
                mine = {rel: data for rel, data in mine.items() if not rel.startswith(sub + "/")}
            differences = compare(mine, tree(folder, skip_nested=True, keep=package_filter((folder / "Cargo.toml").read_text())))
            found.extend((s, d) for d in differences)
            own.extend(judge(s, differences, rules, used))
            if own:
                problems.extend(f"{label}: {p}" for p in own)
            else:
                accepted = sum(1 for d in differences)
                notes.append(f"{label}: matches" + (f", with {accepted} reviewed patch{'es' if accepted != 1 else ''}" if accepted else ""))
    for key in rules.patches:
        if key not in used and any(key[0] == s.pinned.name and key[1] == s.pinned.version for s in snapshots):
            problems.append(f"{key[0]} {key[1]}: the reviewed patch to {key[2]} no longer applies (gpui_patches.toml)")
    return problems, notes, found


def main(argv: list[str]) -> int:
    keep_dir = None
    show = "--print-patches" in argv
    argv = [a for a in argv if a != "--print-patches"]
    if argv:
        if len(argv) != 2 or argv[0] != "--keep":
            print("Usage: check_gpui_source.py [--keep <folder>] [--print-patches]", file=sys.stderr)
            return 2
        keep_dir = Path(argv[1])
        keep_dir.mkdir(parents=True, exist_ok=True)
    patches_text = PATCHES.read_text() if PATCHES.exists() else ""
    try:
        if keep_dir is not None:
            problems, notes, found = check(LOCK.read_text(), patches_text, keep_dir)
        else:
            with tempfile.TemporaryDirectory() as scratch:
                problems, notes, found = check(LOCK.read_text(), patches_text, Path(scratch))
    except CheckError as e:
        print(f"gpui source check: FAIL - {e}", file=sys.stderr)
        return 1
    if show:
        print_patches(found)
        return 0
    for note in notes:
        print(f"  {note}")
    if problems:
        print("gpui source check: FAIL", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print(f"gpui source check: PASS - {len(notes)} crates, each Zed's own source at the commit it names, apart from the reviewed patches")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
