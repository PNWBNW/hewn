#!/usr/bin/env python3
"""Links between the documents point at something that exists.

For every tracked Markdown file, outside the archives and the dated history, this fails when a
link to a file in the repository points at nothing, or a link to a heading (`file.md#heading`,
or `#heading` in the same file) names a heading the file doesn't have. Headings are matched the
way GitHub makes their anchors (lowercase, punctuation dropped, spaces to hyphens, -1, -2 for
repeats); an explicit `<a id="…">` or `name="…"` counts too.

Not checked: web links (http, https, mailto; a check over the network would fail on someone
else's outage), links into a submodule (it may not be checked out), and anything inside code.
Skipped as history, where a link may rightly point at what was there then: `archive/`,
`progress/`, `docs/archive/`, `src/layer1/archive/`, `src/layer2/archive/`.

The same file runs in Hewn and in pnw_mvp_v2. Standard library only. Run from the repository
root: python3 -I scripts/check_links.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_PREFIXES = ("archive/", "progress/", "docs/archive/", "src/layer1/archive/", "src/layer2/archive/")
WEB = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//)", re.I)  # http:, https:, mailto:, //host
INLINE = re.compile(r"!?\[(?:[^\[\]]|\[[^\]]*\])*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
REFDEF = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$")
HREF = re.compile(r"""<(?:a|img)\b[^>]*?\s(?:href|src)=["']([^"']+)["']""", re.I)
EXPLICIT = re.compile(r"""<a\b[^>]*?\s(?:id|name)=["']([^"']+)["']""", re.I)


def tracked_markdown():
    out = subprocess.run(["git", "ls-files", "-z", "--", "*.md"], cwd=ROOT, capture_output=True, check=True)
    return [p for p in out.stdout.decode().split("\0") if p and not p.startswith(SKIP_PREFIXES)]


def submodule_paths():
    gm = ROOT / ".gitmodules"
    if not gm.exists():
        return ()
    return tuple(m + "/" for m in re.findall(r"(?m)^\s*path\s*=\s*(\S+)", gm.read_text()))


def strip_code(text: str, inline: bool = True) -> str:
    """Blank out fenced blocks (and inline code, unless inline=False), keeping line breaks."""
    lines, fence = [], None
    for line in text.splitlines():
        m = re.match(r"^\s*(`{3,}|~{3,})", line)
        if fence:
            if m and m.group(1)[0] == fence[0] and len(m.group(1)) >= len(fence):
                fence = None
            lines.append("")
            continue
        if m:
            fence = m.group(1)
            lines.append("")
            continue
        lines.append(re.sub(r"(`+)(?:(?!\1).)+?\1", "", line) if inline else line)
    return "\n".join(lines)


def slug(heading: str) -> str:
    text = re.sub(r"<[^>]+>", "", heading)                       # inline HTML
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)      # links keep their text
    text = text.replace("`", "").strip().lower()
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


_anchor_cache = {}


def anchors(path: Path):
    if path not in _anchor_cache:
        raw = path.read_text(encoding="utf-8", errors="replace")
        seen, found = {}, set(EXPLICIT.findall(raw))
        for line in strip_code(raw, inline=False).splitlines():
            m = re.match(r"^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$", line)
            if not m:
                continue
            base = slug(m.group(1))
            n = seen.get(base, 0)
            seen[base] = n + 1
            found.add(base if n == 0 else f"{base}-{n}")
        _anchor_cache[path] = found
    return _anchor_cache[path]


def main() -> int:
    subs = submodule_paths()
    problems, checked, files = [], 0, tracked_markdown()
    if not files:
        problems.append("no Markdown files found: run it from the repository's scripts/ folder")
    for rel in files:
        src = ROOT / rel
        code = strip_code(src.read_text(encoding="utf-8", errors="replace"))
        for lineno, line in enumerate(code.splitlines(), 1):
            targets = INLINE.findall(line) + HREF.findall(line)
            m = REFDEF.match(line)
            if m:
                targets.append(m.group(1))
            for target in targets:
                if WEB.match(target):
                    continue
                path_part, _, frag = target.partition("#")
                path_part = path_part.split("?", 1)[0]
                if path_part:
                    base = ROOT if path_part.startswith("/") else src.parent
                    dest = (base / path_part.lstrip("/")).resolve()
                    try:
                        dest_rel = dest.relative_to(ROOT).as_posix()
                    except ValueError:
                        problems.append(f"{rel}:{lineno}: {target} leaves the repository")
                        continue
                    if (dest_rel + "/").startswith(subs) or dest_rel + "/" in subs:
                        continue
                    checked += 1
                    if not dest.exists():
                        problems.append(f"{rel}:{lineno}: {target} points at nothing")
                        continue
                else:
                    dest = src
                    checked += 1
                if frag and dest.is_file() and dest.suffix == ".md" and frag.lower() not in anchors(dest):
                    problems.append(f"{rel}:{lineno}: {target} names a heading that isn't there")
    if problems:
        print("link check: FAIL", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print(f"link check: PASS - {checked} links in {len(files)} documents point at something that exists")
    return 0


if __name__ == "__main__":
    sys.exit(main())
