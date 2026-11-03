#!/usr/bin/env python3
"""The documents' index, generated from each document's frontmatter (docs/MEMORY.md).

Every design document under docs/ opens with a frontmatter block:

    ---
    status: built
    updated: 2026-11-02
    summary: One sentence saying what the document answers.
    ---

`status` is one of a fixed set, so a reader (or the dreaming pass) can tell at a glance what is
decided, built or only an idea, and `docs/README.md`'s table is generated from these blocks, so it
can't say "being built" about something built two days ago. Never edit the table by hand; change
the document's frontmatter, then run

    python3 -I scripts/docs_index.py --write

Without --write it checks, and fails when a document has no frontmatter, a key is missing or
its status isn't in the set, `updated` isn't a date, or the table in docs/README.md isn't what the
frontmatter would generate.

Standard library only. Run from the repository root: python3 -I scripts/docs_index.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
INDEX = DOCS / "README.md"
START, END = "<!-- docs-index:start -->", "<!-- docs-index:end -->"
# What a status means (docs/MEMORY.md): the words the dreaming pass verifies against the code.
STATUSES = {
    "idea": "an idea, nothing decided or built",
    "design": "a design waiting for Joshua's decision",
    "review": "a review or analysis for Joshua, nothing to build",
    "decided": "decided by Joshua, not yet built",
    "built": "built and in the app (open items, if any, are named in the summary)",
    "plan": "a plan with its checklist; items tick here",
    "living": "kept current as the code changes; CI checks it where it can",
    "report": "a dated report of what was found; history, not current",
    "reference": "background that doesn't change: who it's for, how it was made",
}
FRONT = re.compile(r"\A---\n(.*?)\n---\n", re.S)
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# The documents indexed: every Markdown file under docs/ except generated or folder-level pages.
SKIP = {"README.md"}
SKIP_DIRS = {"art", "grants", "incidents", "map/data", "map/dist"}
# A document's own folder page stands in for the folder (the map's README for docs/map).
FOLDER_PAGES = {"map/README.md"}


def frontmatter(path: Path):
    m = FRONT.match(path.read_text(encoding="utf-8"))
    if not m:
        return None, "has no frontmatter block"
    fields = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            return None, f"frontmatter line isn't `key: value`: {line!r}"
        k, v = line.split(":", 1)
        fields[k.strip()] = v.strip()
    for key in ("status", "updated", "summary"):
        if not fields.get(key):
            return None, f"frontmatter lacks `{key}`"
    if fields["status"] not in STATUSES:
        return None, f"status {fields['status']!r} isn't one of {', '.join(sorted(STATUSES))}"
    if not DATE.match(fields["updated"]):
        return None, f"updated {fields['updated']!r} isn't YYYY-MM-DD"
    return fields, None


def documents():
    for path in sorted(DOCS.rglob("*.md")):
        rel = path.relative_to(DOCS).as_posix()
        if rel in SKIP or rel.endswith("/README.md") and rel not in FOLDER_PAGES:
            continue
        if any(rel == d or rel.startswith(d + "/") for d in SKIP_DIRS):
            continue
        yield rel, path


def build():
    rows, problems = [], []
    for rel, path in documents():
        fields, problem = frontmatter(path)
        if problem:
            problems.append(f"docs/{rel}: {problem}")
            continue
        label = rel.replace("/README.md", "/")
        rows.append((fields["status"], fields["updated"], f"| [`{label}`]({rel}) | {fields['status']} · {fields['updated']} | {fields['summary']} |"))
    # Living documents first, then by status, then the most recently updated.
    order = ["living", "built", "decided", "design", "review", "plan", "idea", "reference", "report"]
    rows.sort(key=lambda r: (order.index(r[0]), r[1]), reverse=False)
    rows.sort(key=lambda r: order.index(r[0]))
    table = ["| File | Status · updated | What it answers |", "|---|---|---|", *[r[2] for r in rows]]
    legend = "Status means: " + "; ".join(f"**{k}**, {v}" for k, v in STATUSES.items()) + "."
    block = "\n".join([START, "", *table, "", legend, "", END])
    return block, problems, len(rows)


def main() -> int:
    args = sys.argv[1:]
    block, problems, count = build()
    if problems:
        print("docs index: FAIL", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    text = INDEX.read_text(encoding="utf-8")
    start, end = text.find(START), text.find(END)
    if start < 0 or end < 0:
        print(f"docs index: FAIL - docs/README.md needs the markers {START} and {END}", file=sys.stderr)
        return 1
    new = text[:start] + block + text[end + len(END):]
    if "--write" in args:
        INDEX.write_text(new, encoding="utf-8")
        print(f"docs index: wrote docs/README.md - {count} documents")
        return 0
    if new != text:
        print("docs index: FAIL - docs/README.md is out of date; run python3 -I scripts/docs_index.py --write", file=sys.stderr)
        return 1
    print(f"docs index: PASS - {count} documents with frontmatter, index current")
    return 0


if __name__ == "__main__":
    sys.exit(main())
