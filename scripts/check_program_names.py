#!/usr/bin/env python3
"""Program names come from one place (docs/INVARIANTS.md, INV-12; T15).

Every Leo program id the app uses lives in packages/config/src/programs.ts (`PROGRAMS`), which
mirrors pnw_mvp_v2's manifest; pnw-adapter keeps its own transition table for the retired CLI
path. Anywhere else, a program id written out by hand can drift from what is deployed: an app
that still calls a superseded version, or reads one mapping from v4 and another from v5.

Outside tests, comments, packages/config and packages/pnw-adapter, this fails on any
`<name>.aleo` in the code. `credits.aleo` is allowed everywhere: it is the network's own program,
not ours, and never changes version. A line that must keep a name carries the marker
`program-names: allow` and a reason.

Standard library only. Run from the repository root: python3 -I scripts/check_program_names.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOME = ("packages/config/src/programs.ts", "packages/pnw-adapter/")
NATIVE = {"credits.aleo"}
ALLOW = "program-names: allow"
NAME = re.compile(r"\b[a-z][a-z0-9_]*\.aleo\b")


def sources():
    for base in ("apps", "packages"):
        for path in (ROOT / base).rglob("*"):
            if path.suffix not in (".ts", ".tsx", ".mts", ".js", ".mjs"):
                continue
            rel = path.relative_to(ROOT).as_posix()
            if "/node_modules/" in f"/{rel}" or "/.next/" in rel or "/out/" in rel or "/dist/" in rel:
                continue
            if re.search(r"\.test\.[mc]?[jt]sx?$", rel) or "/test/" in rel or "/__tests__/" in rel:
                continue
            if rel.startswith(HOME):
                continue
            yield rel, path.read_text(encoding="utf-8", errors="replace")


def strip_block_comments(text: str) -> str:
    """Blanks /* */ comments but keeps their newlines, so line numbers stay true."""
    return re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)


def main() -> int:
    problems = []
    count = 0
    for rel, text in sources():
        count += 1
        for number, line in enumerate(strip_block_comments(text).splitlines(), 1):
            if ALLOW in line:
                continue
            code = line if "://" in line else line.split("//", 1)[0]
            for name in NAME.findall(code):
                if name not in NATIVE:
                    problems.append(f"{rel}:{number}: writes out {name}; take it from PROGRAMS in @pnw/config")
    if count == 0:
        problems.append("no source files found: run it from the repository's scripts/ folder")
    if problems:
        print("program-names check: FAIL", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print(f"program-names check: PASS - {count} source files; every program id comes from @pnw/config")
    return 0


if __name__ == "__main__":
    sys.exit(main())
