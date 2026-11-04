#!/usr/bin/env python3
"""No debug logging in code the app ships (docs/INVARIANTS.md, INV-06; T18).

A transaction's inputs, a record's plaintext or a letter can carry amounts, addresses and names;
a debug line that prints one puts it in the browser's console, where a screenshot, a shared
screen or a support session can carry it off. So shipped code doesn't log: outside tests and
comments, this fails on console.log, .debug, .info, .trace, .dir or .table anywhere under
apps/*/src or packages/*/src. console.warn and console.error stay allowed for failures, and must
not print a value a person typed or a record carried. Build scripts (apps/*/scripts) run on the
build machine, not in the browser, and are not checked.

Standard library only. Run from the repository root: python3 -I scripts/check_console.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEBUG = re.compile(r"\bconsole\s*\.\s*(log|debug|info|trace|dir|table)\s*\(")


def sources():
    for base in ("apps", "packages"):
        for path in (ROOT / base).glob("*/src/**/*"):
            if path.suffix not in (".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx"):
                continue
            rel = path.relative_to(ROOT).as_posix()
            if "/node_modules/" in f"/{rel}":
                continue
            if re.search(r"\.test\.[mc]?[jt]sx?$", rel) or "/test/" in rel or "/__tests__/" in rel:
                continue
            yield rel, path.read_text(encoding="utf-8", errors="replace")


def code_only(text: str) -> str:
    """Drops // and /* */ comments so a comment naming console.log doesn't count as one."""
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return "\n".join(line.split("//", 1)[0] if "://" not in line else line for line in text.splitlines())


def main() -> int:
    problems = []
    count = 0
    for rel, text in sources():
        count += 1
        for n, line in enumerate(code_only(text).splitlines(), 1):
            m = DEBUG.search(line)
            if m:
                problems.append(f"{rel}:{n}: console.{m.group(1)} in shipped code")
    if problems:
        print("console check: FAIL", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print(f"console check: PASS - {count} source files, no debug logging")
    return 0


if __name__ == "__main__":
    sys.exit(main())
