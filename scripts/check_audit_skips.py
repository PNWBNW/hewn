#!/usr/bin/env python3
"""Every advisory the audit skips is skipped only while no fix can be installed (docs/THREAT_MODEL.md T3).

pnpm-workspace.yaml may list advisories under auditConfig.ignoreGhsas, each with a comment giving
its reason, when an advisory has no fixed version and nothing the app ships includes the package.
A skip must not outlive that reason. This check asks the npm registry, the same source pnpm audit
reads, for the advisories against every package in pnpm-lock.yaml, and fails when:

- a skipped id has no comment above it, or isn't a GHSA id;
- a skipped advisory no longer matches any installed package (it was fixed by an update: remove
  the skip);
- a version outside the advisory's vulnerable range has been published for at least 7 days, the
  release age pnpm will install (update the package and remove the skip).

A fixed version younger than 7 days is reported and passes: it can't be installed yet. A registry
that can't be reached fails the check rather than passing it unseen.

Standard library only. Run from the repository root: python3 -I scripts/check_audit_skips.py
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = "https://registry.npmjs.org"
RELEASE_AGE = timedelta(days=7)  # pnpm-workspace.yaml minimumReleaseAge (10080 minutes)
GHSA = re.compile(r"^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$")


class Unreadable(Exception):
    """A range or file this check can't read: fail and say so, never guess."""


def parse_skips(workspace_yaml: str) -> list[tuple[str, str]]:
    """The (id, reason) pairs under auditConfig.ignoreGhsas; the reason is the comment block just above."""
    skips, reason, in_config, in_list = [], [], False, False
    for line in workspace_yaml.splitlines():
        stripped = line.strip()
        if not line.startswith(" ") and stripped and not stripped.startswith("#"):
            in_config, in_list = stripped == "auditConfig:", False
            reason = []
            continue
        if not in_config:
            continue
        if stripped == "ignoreGhsas:":
            in_list, reason = True, []
        elif in_list and stripped.startswith("#"):
            reason.append(stripped.lstrip("#").strip())
        elif in_list and stripped.startswith("- "):
            skips.append((stripped[2:].strip().strip("'\""), " ".join(reason)))
            reason = []
        elif stripped:
            in_list = False
    return skips


def installed_packages(lockfile: str) -> dict[str, set[str]]:
    """name -> versions, from the packages: section of pnpm-lock.yaml (registry entries only)."""
    found: dict[str, set[str]] = {}
    in_packages = False
    for line in lockfile.splitlines():
        if not line.startswith(" ") and line.strip():
            in_packages = line.strip() == "packages:"
            continue
        m = re.match(r"^  '?((?:@[^/\s']+/)?[^@\s'/]+)@(\d[^(:'\s]*)'?:\s*$", line) if in_packages else None
        if m:
            found.setdefault(m.group(1), set()).add(m.group(2))
    return found


def version_key(version: str) -> tuple[int, int, int] | None:
    """(major, minor, patch) for a plain release; None for a pre-release or anything else."""
    m = re.fullmatch(r"v?(\d+)(?:\.(\d+))?(?:\.(\d+))?", version.strip())
    if not m:
        return None
    return tuple(int(g or 0) for g in m.groups())  # type: ignore[return-value]


def in_range(version: str, vulnerable: str) -> bool:
    """Whether a release falls in an npm advisory's vulnerable_versions (comparators, spaces, ||)."""
    key = version_key(version)
    if key is None:
        raise Unreadable(f"not a release version: {version}")
    for alternative in vulnerable.split("||"):
        ok = True
        for comparator in alternative.split():
            if comparator == "*":
                continue
            m = re.fullmatch(r"(<=|>=|<|>|=)?(v?\d+(?:\.\d+){0,2})", comparator)
            if not m:
                raise Unreadable(f"can't read the range '{vulnerable}'; check this advisory by hand")
            op, bound = m.group(1) or "=", version_key(m.group(2))
            ok = ok and {"<": key < bound, "<=": key <= bound, ">": key > bound, ">=": key >= bound, "=": key == bound}[op]
        if ok:
            return True
    return False


def fixed_versions(vulnerable: str, times: dict[str, str], now: datetime) -> tuple[list[str], list[str]]:
    """(installable, too_new): published releases outside the range, split at the 7-day release age."""
    installable, too_new = [], []
    for version, stamp in times.items():
        if version_key(version) is None or in_range(version, vulnerable):
            continue
        published = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        (installable if now - published >= RELEASE_AGE else too_new).append(version)
    order = lambda v: version_key(v)  # noqa: E731
    return sorted(installable, key=order), sorted(too_new, key=order)


def judge(skips, advisories, times_for, now) -> tuple[list[str], list[str]]:
    """(failures, notes) for the skips, given {package: [advisory]} and a package -> {version: time} lookup."""
    failures, notes = [], []
    for ghsa, reason in skips:
        if not GHSA.match(ghsa):
            failures.append(f"{ghsa}: not a GHSA id")
            continue
        if not reason:
            failures.append(f"{ghsa}: no reason given; write it as a comment just above the id")
        hits = [(name, a) for name, found in advisories.items() for a in found if str(a.get("url", "")).endswith("/" + ghsa)]
        if not hits:
            failures.append(f"{ghsa}: no installed package has this advisory any more; remove the skip from pnpm-workspace.yaml")
            continue
        for name, advisory in hits:
            vulnerable = advisory.get("vulnerable_versions", "")
            installable, too_new = fixed_versions(vulnerable, times_for(name), now)
            if installable:
                failures.append(f"{ghsa}: {name} {installable[-1]} is outside {vulnerable} and can be installed; update {name} and remove the skip")
            elif too_new:
                notes.append(f"{ghsa}: {name} {too_new[-1]} fixes it, installable from 7 days after its release; update then")
    return failures, notes


def fetch_json(url: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers={"content-type": "application/json", "accept": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def main() -> int:
    workspace = (ROOT / "pnpm-workspace.yaml").read_text()
    skips = parse_skips(workspace)
    if not skips:
        print("audit skips: PASS - the audit skips no advisory")
        return 0
    packages = installed_packages((ROOT / "pnpm-lock.yaml").read_text())
    try:
        advisories = fetch_json(f"{REGISTRY}/-/npm/v1/security/advisories/bulk", {n: sorted(v) for n, v in packages.items()})
        times_for = lambda name: {k: v for k, v in fetch_json(f"{REGISTRY}/{name.replace('/', '%2F')}").get("time", {}).items() if k not in ("created", "modified")}  # noqa: E731
        failures, notes = judge(skips, advisories, times_for, datetime.now(timezone.utc))
    except (OSError, ValueError) as error:
        print(f"audit skips: FAIL - the npm registry couldn't be read ({error}); the skips weren't checked")
        return 1
    except Unreadable as error:
        print(f"audit skips: FAIL - {error}")
        return 1
    for note in notes:
        print(f"  note: {note}")
    if failures:
        print("audit skips: FAIL")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print(f"audit skips: PASS - {len(skips)} skipped, each with its reason and still without an installable fix")
    return 0


if __name__ == "__main__":
    sys.exit(main())
