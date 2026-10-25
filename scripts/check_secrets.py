#!/usr/bin/env python3
"""Fail the build if a secret is committed (docs/INVARIANTS.md, INV-06; threat T18).

Scans every file git tracks (not the history, not ignored files) for:
  - an Aleo private key (APrivateKey1...) or view key (AViewKey1...);
  - a GitHub token (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_), an AWS access key id (AKIA...),
    or a PEM private key block;
  - a token, secret, password or private key assigned a long literal value
    (NAME_TOKEN=..., "apiKey": "...");
  - a tracked file named .env or .env.<anything> other than .env.example.

A line that must keep such a string (a documented, public test key, say) carries the marker
`secrets-scan: allow` with a reason on the same line. Matches are reported by file and line only;
the matched text is never printed, so a failing run doesn't leak what it found.

Seed phrases (lists of ordinary words) are not detected; they stay with review.

Standard library only. Run from the repository root: python3 -I scripts/check_secrets.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
B58 = "1-9A-HJ-NP-Za-km-z"
PATTERNS = [
    ("an Aleo private key", re.compile(rf"APrivateKey1[{B58}]{{40,}}")),
    ("an Aleo view key", re.compile(rf"AViewKey1[{B58}]{{40,}}")),
    ("a GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})")),
    ("an AWS access key id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("a PEM private key", re.compile(r"-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----")),
    (
        "a secret assigned a literal value",
        re.compile(
            r"""(?ix)
            \b[\w-]*(?:token|secret|password|passwd|private[_-]?key|api[_-]?key)["']?\s*[:=]\s*
            ["']?(?=[A-Za-z0-9_\-+/=.]{24,})(?=[^"'\s]*\d)(?=[^"'\s]*[A-Za-z])[A-Za-z0-9_\-+/=.]{24,}
            """
        ),
    ),
]
ALLOW = "secrets-scan: allow"
ENV_FILE = re.compile(r"(?:^|/)\.env(?:\..+)?$")


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True)
    return [p for p in out.stdout.decode().split("\0") if p]


def main() -> int:
    findings = []
    files = tracked_files()
    for rel in files:
        if ENV_FILE.search(rel) and not rel.endswith(".env.example"):
            findings.append(f"{rel}: a tracked .env file")
        path = ROOT / rel
        if not path.is_file():
            continue  # a submodule or a deleted file
        try:
            text = path.read_bytes()
        except OSError:
            continue
        if b"\0" in text[:8192]:
            continue  # binary
        for number, line in enumerate(text.decode("utf-8", "replace").splitlines(), 1):
            if ALLOW in line:
                continue
            for what, pattern in PATTERNS:
                if pattern.search(line):
                    findings.append(f"{rel}:{number}: looks like {what}")
                    break
    if findings:
        print("secrets scan: FAIL (matches are not printed)", file=sys.stderr)
        for f in findings:
            print(f"  - {f}", file=sys.stderr)
        print(
            "If a line must keep the string (a public test key), add the marker"
            f" `{ALLOW}` and a reason on that line. If it is a real key, treat it as leaked:"
            " move the funds, make a new key, then remove it.",
            file=sys.stderr,
        )
        return 1
    print(f"secrets scan: PASS - {len(files)} tracked files, nothing that looks like a key or a token")
    return 0


if __name__ == "__main__":
    sys.exit(main())
