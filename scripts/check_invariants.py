#!/usr/bin/env python3
"""Keep docs/INVARIANTS.md tied to CLAUDE.md, to real checks and to the threat model.

Fails when:
  - an INV id cited in CLAUDE.md has no row in docs/INVARIANTS.md;
  - a row whose rule comes from Hewn's CLAUDE.md (INV-01 to INV-22) isn't cited there;
  - an id appears twice in the table;
  - a check path in backticks doesn't exist (paths under pnw_mvp_v2/ are checked only when the
    submodule is checked out);
  - a row names a threat id that docs/THREAT_MODEL.md doesn't have.

Standard library only. Run from the repository root: python3 -I scripts/check_invariants.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TABLE = ROOT / "docs" / "INVARIANTS.md"
CLAUDE = ROOT / "CLAUDE.md"
THREATS = ROOT / "docs" / "THREAT_MODEL.md"
# Rules whose wording lives in pnw_mvp_v2's CLAUDE.md rather than Hewn's.
CHAIN_ONLY = {"INV-23", "INV-24"}
ROW = re.compile(r"^\|\s*(INV-\d{2})\s*\|(.*)\|\s*$")
PATH = re.compile(r"`([\w./-]+/[\w.-]+\.(?:ts|tsx|py|md|yml|json|sh))`")


def main() -> int:
    table = TABLE.read_text()
    claude = CLAUDE.read_text()
    threats = set(re.findall(r"^#{2,3} (T\d+) —", THREATS.read_text(), re.M))
    submodule = (ROOT / "pnw_mvp_v2" / "CLAUDE.md").exists()
    problems, unchecked = [], 0
    rows: dict[str, list[str]] = {}
    for line in table.splitlines():
        m = ROW.match(line)
        if not m:
            continue
        rid, cells = m.group(1), [c.strip() for c in m.group(2).split("|")]
        if rid in rows:
            problems.append(f"{rid}: two rows")
        rows[rid] = cells
        if len(cells) != 4:
            problems.append(f"{rid}: expected 4 cells after the id, found {len(cells)}")
            continue
        check, cited = cells[2], cells[3]
        for path in PATH.findall(check):
            if path.startswith("pnw_mvp_v2/") and not submodule:
                unchecked += 1
                continue
            if not (ROOT / path).exists():
                problems.append(f"{rid}: check path {path} doesn't exist")
        if not PATH.findall(check) and not check.lower().startswith("none"):
            problems.append(f"{rid}: the check names no file and doesn't say none")
        for t in re.findall(r"\bT\d+\b", cited):
            if t not in threats:
                problems.append(f"{rid}: threat {t} isn't in the threat model")
    in_claude = set(re.findall(r"INV-\d{2}", claude))
    for rid in sorted(in_claude - rows.keys()):
        problems.append(f"{rid}: cited in CLAUDE.md but has no row")
    for rid in sorted(rows.keys() - in_claude - CHAIN_ONLY):
        problems.append(f"{rid}: has a row but CLAUDE.md doesn't cite it")
    if problems:
        print("invariants check: FAIL", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    nones = sum(1 for c in rows.values() if len(c) == 4 and c[2].lower().startswith("none"))
    extra = f"; {unchecked} pnw_mvp_v2 paths not checked (submodule absent)" if unchecked else ""
    print(f"invariants check: PASS - {len(rows)} rules, {len(rows) - nones} with a check, {nones} none{extra}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
