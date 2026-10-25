#!/usr/bin/env python3
"""Browser storage is not a book of record (docs/INVARIANTS.md, INV-10; T2).

The books, and everything else that lasts, go in the encrypted vault (`@pnw/vault`, IndexedDB).
Plain web storage holds four flags and nothing else, each written by one file:

  pnw:has-account        localStorage    apps/business/src/books/BooksProvider.tsx   "1": an account exists here, never whose
  hewn-visitor-counted   localStorage    apps/business/src/traction/VisitCounter.tsx "1": this device was counted once
  hewn-visit-counted     sessionStorage  apps/business/src/traction/VisitCounter.tsx "1": this session was counted
  hewn.fee-mode          localStorage    packages/wallet/src/fee_mode.ts            "private" or absent: this device's fee switch

Outside tests and comments, this fails when:
  - a file not listed above touches localStorage or sessionStorage;
  - a listed file stores under a key that isn't its own (the key's constant must still hold the
    literal above, and every setItem must use it);
  - a file outside packages/vault opens IndexedDB, or anything uses document.cookie or the Cache API.

A new flag means a new row here and in docs/INVARIANTS.md, reviewed like any change to the rules.

Standard library only. Run from the repository root: python3 -I scripts/check_browser_storage.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# file -> {constant name: key literal}
ALLOWED = {
    "apps/business/src/books/BooksProvider.tsx": {"HAS_ACCOUNT_FLAG": "pnw:has-account"},
    "apps/business/src/traction/VisitCounter.tsx": {"DEVICE_KEY": "hewn-visitor-counted", "SESSION_KEY": "hewn-visit-counted"},
    "packages/wallet/src/fee_mode.ts": {"FEE_MODE_KEY": "hewn.fee-mode"},
}
WEB_STORAGE = re.compile(r"\b(?:localStorage|sessionStorage)\b")
OTHER = re.compile(r"\bindexedDB\b|\bdocument\.cookie\b|\bcaches\.(?:open|match|keys|delete|has)\b")
SET_ITEM = re.compile(r"\.setItem\(\s*([^,)]+)\s*,")


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
            yield rel, path.read_text(encoding="utf-8", errors="replace")


def code_only(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return "\n".join(line if "://" in line else line.split("//", 1)[0] for line in text.splitlines())


def main() -> int:
    problems = []
    count = 0
    for rel, text in sources():
        count += 1
        code = code_only(text)
        if WEB_STORAGE.search(code):
            keys = ALLOWED.get(rel)
            if keys is None:
                problems.append(f"{rel}: uses web storage; durable data goes in the vault (only the four flags may live there)")
            else:
                for name, literal in keys.items():
                    if not re.search(rf"\b{name}\s*=\s*[\"']{re.escape(literal)}[\"']", code):
                        problems.append(f"{rel}: {name} no longer holds \"{literal}\"")
                for arg in SET_ITEM.findall(code):
                    arg = arg.strip()
                    if arg not in keys and arg.strip("\"'") not in keys.values():
                        problems.append(f"{rel}: stores under {arg}, which isn't one of its flags")
        if OTHER.search(code) and not rel.startswith("packages/vault/"):
            problems.append(f"{rel}: opens IndexedDB, a cookie or the Cache API outside the vault")
    if count == 0:
        problems.append("no source files found: run it from the repository's scripts/ folder")
    if problems:
        print("browser-storage check: FAIL", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print(f"browser-storage check: PASS - {count} source files; web storage holds only the four flags")
    return 0


if __name__ == "__main__":
    sys.exit(main())
