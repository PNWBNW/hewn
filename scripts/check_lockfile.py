#!/usr/bin/env python3
"""Every package the lockfile installs comes from the npm registry, and is at least a week old
(docs/INVARIANTS.md, OPS-04; threat T3).

`pnpm install --frozen-lockfile` installs exactly what pnpm-lock.yaml says, and the lockfile
says where each package comes from: `minimumReleaseAge` applies only when pnpm resolves a
version, not when it installs one a lockfile already names. So this check reads the lockfile
itself.

Always (no network):
  - every `resolution:` in pnpm-lock.yaml is a plain registry entry, `{integrity: ...}`; one
    carrying `tarball`, `repo`, `commit`, `path`, `directory` or `type` (a tarball URL, a git
    repository, a folder on disk) fails;
  - no tracked .npmrc points a registry anywhere but https://registry.npmjs.org/, or lowers
    `minimum-release-age`;
  - pnpm-workspace.yaml sets `minimumReleaseAge` to at least 10080 minutes (7 days) and
    excludes nothing from it.

With `--age --base <ref>` (a pull request's run): every package@version the lockfile has and
`<ref>`'s lockfile doesn't is looked up on https://registry.npmjs.org/<name>, and fails if it
was published less than 7 days ago, or isn't there.

The lockfile is read line by line (no YAML library). Standard library only. Run from the
repository root:

    python3 -I scripts/check_lockfile.py
    python3 -I scripts/check_lockfile.py --age --base origin/main
"""
import argparse
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = "https://registry.npmjs.org/"
MIN_AGE_MINUTES = 10080
MIN_AGE = timedelta(minutes=MIN_AGE_MINUTES)
# Keys a resolution may carry only when the package doesn't come from the registry.
FOREIGN = ("tarball", "repo", "commit", "path", "directory", "type")
FOREIGN_KEY = re.compile(r"(?:^|[{,\s])(" + "|".join(FOREIGN) + r")\s*:")
TOP = re.compile(r"^(\S[^:]*):\s*$")
ENTRY = re.compile(r"^  (\S.*):\s*$")
RESOLUTION = re.compile(r"^(\s+)resolution:\s*(.*)$")


def _key(raw: str) -> str:
    key = raw.strip().strip("'\"")
    return key[1:] if key.startswith("/") else key  # lockfile v6 wrote '/name@1.0.0'


def parse_lockfile(text: str) -> tuple[dict[str, str], list[str]]:
    """The `packages:` section as {name@version: resolution text}, and problems found.

    A resolution written as a block (`resolution:` with its keys on the lines below) is gathered
    into one string, so it is judged the same way as the inline form."""
    entries: dict[str, str] = {}
    problems: list[str] = []
    section, entry = None, None
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        top = TOP.match(line)
        if top:
            section, entry = top.group(1), None
        elif section == "packages":
            m = ENTRY.match(line)
            if m:
                entry = _key(m.group(1))
            else:
                r = RESOLUTION.match(line)
                if r and entry is not None:
                    indent, value = len(r.group(1)), r.group(2).strip()
                    if not value:  # block form: the keys follow, indented further
                        parts = []
                        while i + 1 < len(lines) and (
                            not lines[i + 1].strip()
                            or len(lines[i + 1]) - len(lines[i + 1].lstrip()) > indent
                        ):
                            i += 1
                            if lines[i].strip():
                                parts.append(lines[i].strip())
                        value = "{" + ", ".join(parts) + "}"
                    entries[entry] = value
                    where = f"pnpm-lock.yaml:{i + 1}: {entry}"
                    found = FOREIGN_KEY.findall(value)
                    if found:
                        problems.append(f"{where}: resolution has {', '.join(sorted(set(found)))} (not the npm registry)")
                    elif "integrity:" not in value:
                        problems.append(f"{where}: resolution has no integrity hash")
        i += 1
    return entries, problems


def check_npmrc(rel: str, text: str) -> list[str]:
    problems = []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.split("#", 1)[0].split(";", 1)[0].strip()
        if "=" not in line:
            continue
        name, value = (s.strip().strip("'\"") for s in line.split("=", 1))
        if name == "registry" or name.endswith(":registry"):
            if value.rstrip("/") + "/" != REGISTRY:
                problems.append(f"{rel}:{number}: {name} is not {REGISTRY}")
        elif name == "minimum-release-age":
            if not value.isdigit() or int(value) < MIN_AGE_MINUTES:
                problems.append(f"{rel}:{number}: minimum-release-age below {MIN_AGE_MINUTES}")
        elif name == "minimum-release-age-exclude":
            problems.append(f"{rel}:{number}: minimum-release-age-exclude is not allowed")
    return problems


def check_workspace(text: str) -> list[str]:
    problems = []
    m = re.search(r"^minimumReleaseAge:\s*(\S+)\s*(?:#.*)?$", text, re.M)
    if not m:
        problems.append("pnpm-workspace.yaml: minimumReleaseAge is missing")
    elif not m.group(1).isdigit() or int(m.group(1)) < MIN_AGE_MINUTES:
        problems.append(f"pnpm-workspace.yaml: minimumReleaseAge is below {MIN_AGE_MINUTES}")
    if re.search(r"^minimumReleaseAgeExclude\s*:", text, re.M):
        problems.append("pnpm-workspace.yaml: minimumReleaseAgeExclude is not allowed")
    for m in re.finditer(r"^(\S*registry\S*)\s*:\s*(\S+)", text, re.M | re.I):
        if m.group(2).strip("'\"").rstrip("/") + "/" != REGISTRY:
            problems.append(f"pnpm-workspace.yaml: {m.group(1)} is not {REGISTRY}")
    return problems


def split_key(key: str) -> tuple[str, str]:
    """'@scope/name@1.2.3(peer@1)' -> ('@scope/name', '1.2.3')."""
    key = key.split("(", 1)[0]
    at = key.rfind("@")
    if at <= 0:
        return key, ""
    return key[:at], key[at + 1:]


def fetch_published(name: str) -> dict[str, str]:
    """{version: ISO time} from the registry's full document for `name`."""
    url = REGISTRY + urllib.parse.quote(name, safe="@")
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp).get("time", {})


def parse_time(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


def check_ages(added, fetch=fetch_published, now=None) -> list[str]:
    """Each package@version in `added` must have been published at least MIN_AGE before now."""
    now = now or datetime.now(timezone.utc)
    problems, cache = [], {}
    for key in sorted(added):
        name, version = split_key(key)
        if not version:
            problems.append(f"{key}: no version to look up")
            continue
        if name not in cache:
            try:
                cache[name] = fetch(name)
            except Exception as err:  # network, 404, bad JSON: the version can't be shown to be old
                cache[name] = None
                problems.append(f"{name}: registry lookup failed ({type(err).__name__})")
        times = cache[name]
        if times is None:
            continue
        stamp = times.get(version)
        if not stamp:
            problems.append(f"{key}: not published on the npm registry")
            continue
        age = now - parse_time(stamp)
        if age < MIN_AGE:
            problems.append(f"{key}: published {age.days} day(s) ago, under 7")
    return problems


def tracked(pattern: str) -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z", "--", pattern], cwd=ROOT, capture_output=True, check=True)
    return [p for p in out.stdout.decode().split("\0") if p]


def base_lockfile(ref: str) -> str:
    out = subprocess.run(["git", "show", f"{ref}:pnpm-lock.yaml"], cwd=ROOT, capture_output=True)
    if out.returncode != 0:
        # No lockfile on the base (or no such ref): fail rather than skip the age check.
        raise SystemExit(f"lockfile check: can't read pnpm-lock.yaml at {ref}")
    return out.stdout.decode()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--age", action="store_true", help="look up versions added since --base")
    ap.add_argument("--base", help="the git ref to compare the lockfile with")
    args = ap.parse_args(argv)
    if args.age and not args.base:
        ap.error("--age needs --base <ref>")

    entries, problems = parse_lockfile((ROOT / "pnpm-lock.yaml").read_text())
    for rel in tracked("*.npmrc"):  # '*' crosses folders in a git pathspec
        if Path(rel).name == ".npmrc" and (ROOT / rel).is_file():
            problems += check_npmrc(rel, (ROOT / rel).read_text())
    problems += check_workspace((ROOT / "pnpm-workspace.yaml").read_text())

    added: set[str] = set()
    if args.age:
        before, _ = parse_lockfile(base_lockfile(args.base))
        added = set(entries) - set(before)
        problems += check_ages(added)

    if problems:
        print("lockfile check: FAIL", file=sys.stderr)
        for p in sorted(set(problems)):
            print(f"  - {p}", file=sys.stderr)
        return 1
    extra = f"; {len(added)} added since {args.base}, each at least 7 days old" if args.age else ""
    print(f"lockfile check: ok ({len(entries)} packages, all from the npm registry{extra})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
