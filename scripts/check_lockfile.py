#!/usr/bin/env python3
"""Every package the lockfile installs comes from the npm registry, and is at least a week old
(docs/INVARIANTS.md, OPS-04; threat T3).

`pnpm install --frozen-lockfile` installs exactly what pnpm-lock.yaml says, and the lockfile
says where each package comes from: `minimumReleaseAge` applies only when pnpm resolves a
version, not when it installs one a lockfile already names. So this check reads the lockfile
itself.

Always (no network):
  - pnpm-lock.yaml has only the shape pnpm writes for packages from the registry. Every entry
    under `packages:` has one `resolution:`, written `{integrity: sha512-...}` on one line; one
    carrying `tarball`, `repo`, `commit`, `path`, `directory` or `type` (a tarball URL, a git
    repository, a folder on disk) fails. pnpm reads an entry's fields from `packages:` and
    `snapshots:` together, and fetches the `version` an entry names over the one in its key,
    so only the fields pnpm writes for a registry package are accepted in each section (no
    `version`, `name` or `id`; no `resolution` under `snapshots:`), and every snapshot has its
    entry under `packages:`. Anything this line-by-line reader doesn't recognise (another
    indentation, a flow-style entry, a quoted or explicit key, an alias, a comment after a
    section's name) fails rather than being skipped;
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
# A registry package's resolution, exactly as pnpm writes it.
PLAIN_RESOLUTION = re.compile(r"\{integrity: sha(?:1|256|384|512)-[A-Za-z0-9+/]+=*\}")
TOP = re.compile(r"^([A-Za-z][A-Za-z0-9]*):(?: (.*))?$")
ENTRY = re.compile(r"^  (?:'([^'\s]+)'|([^\s'\"#&*!|>%@`{}\[\],?][^\s'\"#{}\[\],]*)):( \{\})?$")
FIELD = re.compile(r"^    ([A-Za-z]+):(?: (.*))?$")
# The fields pnpm writes under an entry of each section for a package from the registry.
FIELDS = {
    "packages": {"resolution", "engines", "cpu", "os", "libc", "hasBin", "peerDependencies",
                 "peerDependenciesMeta", "bundledDependencies", "deprecated"},
    "snapshots": {"dependencies", "optionalDependencies", "transitivePeerDependencies", "dev",
                  "optional"},
}


def _key(raw: str) -> str:
    return raw[1:] if raw.startswith("/") else raw  # lockfile v6 wrote '/name@1.0.0'


def _judge(where: str, value: str) -> str | None:
    if PLAIN_RESOLUTION.fullmatch(value):
        return None
    found = FOREIGN_KEY.findall(value)
    if found:
        return f"{where}: resolution has {', '.join(sorted(set(found)))} (not the npm registry)"
    if "integrity:" not in value:
        return f"{where}: resolution has no integrity hash"
    return f"{where}: resolution isn't written as a registry entry ({{integrity: ...}} on one line)"


def parse_lockfile(text: str) -> tuple[dict[str, str], list[str]]:
    """The `packages:` entries as {name@version: resolution text}, and problems found.

    A resolution written as a block (`resolution:` with its keys on the lines below) is gathered
    into one string for the message; it fails either way."""
    entries: dict[str, str] = {}
    problems: list[str] = []
    resolutions: list[dict[str, int]] = [{}]  # per YAML document: packages entry -> resolutions
    snapshots: list[tuple[int, int, str]] = []  # (document, line, key)
    seen: list[set] = [set()]  # per document: (section, key) and section names already read
    doc, section, entry, block = 0, None, None, False
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line, n = lines[i], i + 1
        i += 1
        where = f"pnpm-lock.yaml:{n}"
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line == "---":  # another YAML document (pnpm 10 may write one for its own tools)
            doc, section, entry, block = doc + 1, None, None, False
            resolutions.append({})
            seen.append(set())
            continue
        if not line[0].isspace():
            entry, block = None, False
            m = TOP.match(line)
            if not m:
                problems.append(f"{where}: unexpected line at the top level")
                section = None
                continue
            section = m.group(1)
            if section in FIELDS:
                if m.group(2) is not None:
                    problems.append(f"{where}: `{section}:` has something after it on its line")
                if section in seen[doc]:
                    problems.append(f"{where}: `{section}:` appears twice")
                seen[doc].add(section)
            continue
        if section not in FIELDS:
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent == 2:
            m = ENTRY.match(line)
            block = False
            if not m:
                problems.append(f"{where}: unexpected line under {section}")
                entry = None
                continue
            entry = _key(m.group(1) or m.group(2))
            if (section, entry) in seen[doc]:
                problems.append(f"{where}: {entry} appears twice under {section}")
            seen[doc].add((section, entry))
            if section == "packages":
                resolutions[doc].setdefault(entry, 0)
            else:
                snapshots.append((doc, n, entry))
        elif indent == 4 and entry is not None:
            m = FIELD.match(line)
            if not m:
                problems.append(f"{where}: {entry}: unexpected line under {section}")
                block = False
                continue
            name, value = m.group(1), m.group(2)
            block = value is None
            if name not in FIELDS[section]:
                problems.append(f"{where}: {entry}: `{name}` under {section} (not a field of a registry package)")
            elif name == "resolution":
                resolutions[doc][entry] += 1
                if block:  # the keys follow, indented further
                    parts = []
                    while i < len(lines) and (
                        not lines[i].strip() or len(lines[i]) - len(lines[i].lstrip(" ")) > 4
                    ):
                        if lines[i].strip():
                            parts.append(lines[i].strip())
                        i += 1
                    value, block = "{" + ", ".join(parts) + "}", False
                entries[entry] = value
                problem = _judge(f"{where}: {entry}", value.strip())
                if problem:
                    problems.append(problem)
        elif indent >= 6 and block:
            continue  # inside a field written as a block (a map of dependencies, a list)
        else:
            problems.append(f"{where}: unexpected line under {section}")
    for counts in resolutions:
        for key, count in counts.items():
            if count != 1:
                problems.append(f"pnpm-lock.yaml: {key}: {'no resolution' if not count else 'more than one resolution'}")
    for d, n, key in snapshots:
        if key.split("(", 1)[0] not in resolutions[d]:
            problems.append(f"pnpm-lock.yaml:{n}: {key} is under snapshots but not under packages")
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
