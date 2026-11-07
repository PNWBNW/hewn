#!/usr/bin/env python3
"""Draw the pairs the REM pass practises on (docs/SLEEP.md, piece 3: "mix").

The paper's dreaming stage mixes unrelated areas on purpose ("random expert selection"), so the
pairing is mechanical and random, seeded by the date so a run can be repeated:

    python3 -I scripts/sleep/rem_pairs.py                 # three pairs, seeded by today's date
    python3 -I scripts/sleep/rem_pairs.py --seed 2026-12-06 --pairs 5

The parts come from the tree as it is, one category each:

  rule      a row of docs/INVARIANTS.md (INV-nn, OPS-nn)
  threat    a threat of docs/THREAT_MODEL.md (T1, T2, …)
  document  a design document under docs/ (not the indexes or the two above)
  program   a live Leo program in pnw_mvp_v2/src/layer1 or layer2 (not archive/)
  package   a package under packages/
  page      a page folder of the app, apps/business/src/app/<name>/
  check     a CI check, scripts/check_*.py

Each pair crosses two different categories and no part is drawn twice, so three pairs are six
parts. The output is Markdown the skill pastes into its pull request. Standard library only; it
reads names and headings, never a file's contents beyond those lines.
"""
import argparse
import random
import re
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
RULE = re.compile(r"^\| ((?:INV|OPS)-\d+) \| (.+?) \|", re.M)
THREAT = re.compile(r"^### (T\d+ — .+)$", re.M)


def read(path):
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def parts(root):
    """{category: [(name, where)]} for every part the tree has today."""
    found = {}
    inv = read(root / "docs" / "INVARIANTS.md")
    found["rule"] = [(m.group(1), f"docs/INVARIANTS.md, {m.group(1)}: {m.group(2)[:80]}") for m in RULE.finditer(inv)]
    threats = read(root / "docs" / "THREAT_MODEL.md")
    found["threat"] = [(m.group(1).split(" — ")[0], f"docs/THREAT_MODEL.md, {m.group(1)}") for m in THREAT.finditer(threats)]
    skip = {"README.md", "INVARIANTS.md", "THREAT_MODEL.md"}
    found["document"] = [(p.name, f"docs/{p.name}") for p in sorted((root / "docs").glob("*.md")) if p.name not in skip]
    programs = []
    for layer in ("layer1", "layer2"):
        folder = root / "pnw_mvp_v2" / "src" / layer
        if folder.is_dir():
            programs += [(p.name, f"pnw_mvp_v2/src/{layer}/{p.name}") for p in sorted(folder.iterdir()) if p.is_dir() and p.name.endswith(".aleo")]
    found["program"] = programs
    pk = root / "packages"
    found["package"] = [(p.name, f"packages/{p.name}") for p in sorted(pk.iterdir()) if p.is_dir()] if pk.is_dir() else []
    app = root / "apps" / "business" / "src" / "app"
    found["page"] = [(p.name, f"apps/business/src/app/{p.name}") for p in sorted(app.iterdir()) if p.is_dir() and p.name != "api"] if app.is_dir() else []
    found["check"] = [(p.name, f"scripts/{p.name}") for p in sorted((root / "scripts").glob("check_*.py"))]
    return {k: v for k, v in found.items() if v}


def draw(found, seed, count):
    """`count` pairs across different categories, no part twice. Deterministic for a seed."""
    rng = random.Random(seed)
    pool = {k: list(v) for k, v in found.items()}
    pairs = []
    for _ in range(count):
        cats = [k for k, v in pool.items() if v]
        if len(cats) < 2:
            break
        a, b = rng.sample(sorted(cats), 2)
        pa = pool[a].pop(rng.randrange(len(pool[a])))
        pb = pool[b].pop(rng.randrange(len(pool[b])))
        pairs.append(((a, pa), (b, pb)))
    return pairs


def render(pairs, seed):
    lines = [f"REM pairs, seed `{seed}`:", ""]
    for n, ((ca, (na, wa)), (cb, (nb, wb))) in enumerate(pairs, 1):
        lines.append(f"{n}. **{ca} `{na}`** × **{cb} `{nb}`**")
        lines.append(f"   - {wa}")
        lines.append(f"   - {wb}")
    return "\n".join(lines) + "\n"


def main(argv):
    ap = argparse.ArgumentParser(description="draw the REM pass's pairs")
    ap.add_argument("--seed", default=date.today().isoformat(), help="any string; the date by default")
    ap.add_argument("--pairs", type=int, default=3)
    ap.add_argument("--root", default=str(ROOT), help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    found = parts(Path(args.root).resolve())
    if len(found) < 2:
        sys.stderr.write("rem_pairs: fewer than two categories found; is this the repository root?\n")
        return 1
    sys.stdout.write(render(draw(found, args.seed, args.pairs), args.seed))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
