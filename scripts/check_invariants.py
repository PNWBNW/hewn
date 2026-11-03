#!/usr/bin/env python3
"""Keep docs/INVARIANTS.md tied to CLAUDE.md, to real checks and to the threat model.

Fails when:
  - an INV id cited in CLAUDE.md has no row in docs/INVARIANTS.md;
  - a row whose rule comes from Hewn's CLAUDE.md (INV-01 to INV-22) isn't cited there;
  - an id appears twice in the table;
  - a check path in backticks doesn't exist (paths under pnw_mvp_v2/ are checked only when the
    submodule is checked out);
  - a row names a threat id that docs/THREAT_MODEL.md doesn't have;
  - a Frameworks cell isn't `SOC 2 <criteria>; ISO <Annex A controls>` (CC1.1-style criteria,
    A.5.1-style controls);
  - an operating rule (OPS-01 ...) set in Hewn's CLAUDE.md isn't cited there with its id, or an
    OPS id cited there has no row; an OPS check names no file and doesn't say none.

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
ROW = re.compile(r"^\|\s*((?:INV|OPS)-\d{2})\s*\|(.*)\|\s*$")
CRITERION = r"(?:CC\d\.\d|A1\.\d|C1\.\d|PI1\.\d|P\d\.\d)"
CONTROL = r"A\.[5-8]\.\d{1,2}"
HEWN_CLAUDE = re.compile(r"(?<!`pnw_mvp_v2` )`CLAUDE.md`")  # Hewn's, not the chain repo's
FRAMEWORKS = re.compile(rf"^SOC 2 {CRITERION}(?:, {CRITERION})*; ISO {CONTROL}(?:, {CONTROL})*$")
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
        if len(cells) != 5:
            problems.append(f"{rid}: expected 5 cells after the id, found {len(cells)}")
            continue
        if not FRAMEWORKS.match(cells[4]):
            problems.append(f"{rid}: the Frameworks cell isn't 'SOC 2 <criteria>; ISO <controls>'")
        # INV rows: rule, enforced in, check, threats. OPS rows: rule, set in, evidence, check.
        check, cited = (cells[2], cells[3]) if rid.startswith("INV") else (cells[3], "")
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
    in_claude = set(re.findall(r"(?:INV|OPS)-\d{2}", claude))
    for rid in sorted(in_claude - rows.keys()):
        problems.append(f"{rid}: cited in CLAUDE.md but has no row")
    for rid, cells in sorted(rows.items()):
        if rid in in_claude or rid in CHAIN_ONLY:
            continue
        if rid.startswith("INV") or (len(cells) == 5 and HEWN_CLAUDE.search(cells[1])):
            problems.append(f"{rid}: has a row but CLAUDE.md doesn't cite it")
    if problems:
        print("invariants check: FAIL", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    def none(rid: str, c: list[str]) -> bool:
        return (c[2] if rid.startswith("INV") else c[3]).lower().startswith("none")

    inv = {r: c for r, c in rows.items() if r.startswith("INV")}
    ops = {r: c for r, c in rows.items() if r.startswith("OPS")}
    extra = f"; {unchecked} pnw_mvp_v2 paths not checked (submodule absent)" if unchecked else ""
    print(
        f"invariants check: PASS - {len(inv)} rules, {sum(not none(r, c) for r, c in inv.items())} with a check, "
        f"{sum(none(r, c) for r, c in inv.items())} none; {len(ops)} operating rules, "
        f"{sum(not none(r, c) for r, c in ops.items())} with a check{extra}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
