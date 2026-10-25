#!/usr/bin/env python3
"""The progress log: one file per day, and an index generated from them.

Entries live in progress/YYYY-MM-DD.md, one `## YYYY-MM-DD — Title` heading per entry, newest
last within a day. PROGRESS.md at the root is generated from those files: a line per day with a
link to its file and each entry's title. Never edit PROGRESS.md by hand; add or change an entry in
its day's file, then run

    python3 -I scripts/progress_index.py --write

Without --write it checks, and fails when:
  - PROGRESS.md isn't what the day files would generate (an entry added without the index);
  - a day file is misnamed, has no entry, or holds an entry dated another day;
  - an entry heading isn't `## YYYY-MM-DD — Title` (older entries may use `: ` for the dash).

`--split` was used once (2026-10-25) to cut the old single PROGRESS.md into day files; kept so
the move can be read and repeated.

Standard library only. Run from the repository root: python3 -I scripts/progress_index.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAYS = ROOT / "progress"
INDEX = ROOT / "PROGRESS.md"
# Entries before 2026-10-25 used either "— " or ": " after the date; both are read as written.
HEADING = re.compile(r"^## (\d{4}-\d{2}-\d{2})(?: — |: )(.+)$")
DAY_FILE = re.compile(r"^\d{4}-\d{2}-\d{2}\.md$")

INTRO = """# Hewn — Progress Log

Dated entries, newest last. Detail lives here; chat reports stay short.

Each day's entries are in [`progress/`](progress/), one file per day. This page is generated from
them (`scripts/progress_index.py`): never edit it by hand. To log something, add a
`## YYYY-MM-DD — Title` entry at the end of that day's file (start the file if it's the first
entry of the day), then run `python3 -I scripts/progress_index.py --write`. CI fails when this
index is out of date.
"""


def anchor(heading_text: str) -> str:
    """GitHub's heading anchor: lowercase, drop punctuation but hyphens, spaces become hyphens."""
    slug = heading_text.strip().lower()
    slug = re.sub(r"[^\w\- ]", "", slug)
    return slug.replace(" ", "-")


def entries(path: Path):
    """(date, title, anchor) for every entry heading in a day file, with GitHub's -1, -2 suffixes."""
    seen = {}
    out = []
    in_fence = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("```"):
            in_fence = not in_fence
        if in_fence or not line.startswith("## "):
            continue
        m = HEADING.match(line)
        if not m:
            out.append((None, line, None))
            continue
        base = anchor(line[3:])
        n = seen.get(base, 0)
        seen[base] = n + 1
        out.append((m.group(1), m.group(2), base if n == 0 else f"{base}-{n}"))
    return out


def build_index():
    problems = []
    lines = [INTRO, "| Day | Entries |", "|---|---|"]
    files = sorted(DAYS.glob("*.md")) if DAYS.is_dir() else []
    days = [p for p in files if p.name != "README.md"]
    if not days:
        problems.append("progress/: no day files")
    total = 0
    for path in reversed(days):  # newest day first in the index; entries stay in written order
        rel = f"progress/{path.name}"
        if not DAY_FILE.match(path.name):
            problems.append(f"{rel}: name isn't YYYY-MM-DD.md")
            continue
        day = path.stem
        found = entries(path)
        if not found:
            problems.append(f"{rel}: no `## {day} — Title` entry")
        links = []
        for date, title, slug in found:
            if date is None:
                problems.append(f"{rel}: heading isn't `## YYYY-MM-DD — Title`: {title}")
                continue
            if date != day:
                problems.append(f"{rel}: entry dated {date}: {title}")
            links.append(f"[{title.replace('|', '/')}]({rel}#{slug})")
            total += 1
        lines.append(f"| [{day}]({rel}) | " + "<br>".join(links) + " |")
    return "\n".join(lines) + "\n", problems, total, len(days)


def split():
    """One-off: cut a single-file PROGRESS.md into progress/<day>.md files."""
    text = INDEX.read_text(encoding="utf-8")
    parts = re.split(r"(?m)^(?=## \d{4}-\d{2}-\d{2}(?: — |: ))", text)
    head, chunks = parts[0], parts[1:]
    by_day = {}
    for chunk in chunks:
        day = HEADING.match(chunk.splitlines()[0]).group(1)
        by_day.setdefault(day, []).append(chunk.rstrip("\n") + "\n")
    DAYS.mkdir(exist_ok=True)
    for day, chunks in by_day.items():
        (DAYS / f"{day}.md").write_text("\n".join(chunks), encoding="utf-8")
    moved = sum(len(c) for c in by_day.values())
    print(f"progress split: {moved} entries into {len(by_day)} day files; dropped header: {head.strip()[:60]!r}")


def main() -> int:
    args = sys.argv[1:]
    if "--split" in args:
        split()
    index, problems, total, days = build_index()
    if problems:
        print("progress index: FAIL", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    if "--write" in args or "--split" in args:
        INDEX.write_text(index, encoding="utf-8")
        print(f"progress index: wrote PROGRESS.md - {total} entries over {days} days")
        return 0
    if not INDEX.exists() or INDEX.read_text(encoding="utf-8") != index:
        print("progress index: FAIL - PROGRESS.md is out of date; run python3 -I scripts/progress_index.py --write", file=sys.stderr)
        return 1
    print(f"progress index: PASS - {total} entries over {days} days, index current")
    return 0


if __name__ == "__main__":
    sys.exit(main())
