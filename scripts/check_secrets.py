#!/usr/bin/env python3
"""Fail the build if a secret is committed (docs/INVARIANTS.md, INV-06; threat T18).

Scans every file git tracks, and every new file it doesn't ignore (what the next `git add -A`
would take), but not the history and not ignored files, for:
  - an Aleo private key (APrivateKey1...), view key (AViewKey1...), compute key (AComputeKey1...)
    or graph key (AGraphKey1...);
  - a GitHub token (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_), an AWS access key id (AKIA...),
    or a PEM private key block;
  - a server's secrets: a JSON web token (the mailbox's pinning key is one), a password inside a
    URL (a store's connection string, rediss://user:password@host);
  - a token, secret, password, JWT or private key assigned a long literal value
    (NAME_TOKEN=..., "apiKey": "...");
  - a file named .env or .env.<anything> other than .env.example (.gitignore ignores them).

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
    ("an Aleo compute key", re.compile(rf"AComputeKey1[{B58}]{{40,}}")),
    ("an Aleo graph key", re.compile(rf"AGraphKey1[{B58}]{{40,}}")),
    ("a GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})")),
    ("an AWS access key id", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("a PEM private key", re.compile(r"-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----")),
    ("a JSON web token", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
    ("a password inside a URL", re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s:/@\"'`]+:[^\s/@\"'`]{12,}@")),
    (
        "a secret assigned a literal value",
        re.compile(
            r"""(?ix)
            \b[\w-]*(?:token|secret|password|passwd|private[_-]?key|api[_-]?key|jwt)["']?\s*[:=]\s*
            ["']?(?=[A-Za-z0-9_\-+/=.]{24,})(?=[^"'\s]*\d)(?=[^"'\s]*[A-Za-z])[A-Za-z0-9_\-+/=.]{24,}
            """
        ),
    ),
]
ALLOW = "secrets-scan: allow"
ENV_FILE = re.compile(r"(?:^|/)\.env(?:\..+)?$")


def files_to_scan() -> list[str]:
    """The tracked files and the new ones git doesn't ignore: a file is read before it is staged."""
    out = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        capture_output=True,
        check=True,
    )
    return [p for p in out.stdout.decode().split("\0") if p]


def main() -> int:
    findings = []
    files = files_to_scan()
    for rel in files:
        if ENV_FILE.search(rel) and not rel.endswith(".env.example"):
            findings.append(f"{rel}: a .env file git would commit")
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
    print(f"secrets scan: PASS - {len(files)} files (tracked and new), nothing that looks like a key or a token")
    return 0


if __name__ == "__main__":
    sys.exit(main())
