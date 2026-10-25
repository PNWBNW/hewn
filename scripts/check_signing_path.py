#!/usr/bin/env python3
"""Every on-chain write is signed in the user's Shield wallet (docs/INVARIANTS.md, INV-11; T3).

The app has one door to the wallet: `useShield()` in apps/business/src/chain/shield.ts wraps the
adapter's executeTransaction (and applies the fee mode); every panel that sends a transaction gets
its wallet from there. This check keeps that door the only one. Outside tests, it fails when:

  1. a file outside packages/wallet imports a @provablehq/aleo-wallet-adapter package;
  2. a file other than chain/shield.ts takes `useWallet` from @pnw/wallet/wallet-provider;
  3. a file outside apps/business/src/chain, packages/rail and packages/wallet calls
     `.executeTransaction(`;
  4. a file that imports @provablehq/sdk uses its execute path (ProgramManager, buildExecution...,
     .execute(, broadcast);
  5. any file imports child_process (no snarkos, no shelling out);
  6. a file outside packages/pnw-adapter imports the CLI adapter (the retired pasted-key path).

Standard library only. Run from the repository root: python3 -I scripts/check_signing_path.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHIELD = "apps/business/src/chain/shield.ts"
SEND_OK = ("apps/business/src/chain/", "packages/rail/src/", "packages/wallet/src/")
IMPORT = re.compile(r"""(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']""")
SDK_EXECUTE = re.compile(r"\bProgramManager\b|\bbuildExecution\w*|\bbuildDevnodeExecution\w*|\.execute\s*\(|\bbroadcast\w*\s*\(")


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
    """Drops // and /* */ comments so a doc comment naming a call doesn't count as one."""
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return "\n".join(line.split("//", 1)[0] if "://" not in line else line for line in text.splitlines())


def main() -> int:
    problems = []
    count = 0
    for rel, text in sources():
        count += 1
        code = code_only(text)
        imports = IMPORT.findall(code)
        if not rel.startswith("packages/wallet/") and any(i.startswith("@provablehq/aleo-wallet-adapter") for i in imports):
            problems.append(f"{rel}: imports the wallet adapter directly (only packages/wallet may)")
        if rel != SHIELD and re.search(r"\buseWallet\b", code) and any(i == "@pnw/wallet/wallet-provider" for i in imports):
            problems.append(f"{rel}: takes useWallet itself; get the wallet from useShield() in {SHIELD}")
        if ".executeTransaction(" in code and not rel.startswith(SEND_OK):
            problems.append(f"{rel}: sends a transaction outside src/chain, rail or wallet")
        if any(i == "@provablehq/sdk" or i.startswith("@provablehq/sdk/") for i in imports) and SDK_EXECUTE.search(code):
            problems.append(f"{rel}: uses the SDK's execute path; every write goes through Shield")
        if any(i in ("child_process", "node:child_process") for i in imports):
            problems.append(f"{rel}: imports child_process (no snarkos, no shelling out)")
        if not rel.startswith("packages/pnw-adapter/") and any(re.search(r"aleo_cli_adapter|cli_adapter", i) for i in imports):
            problems.append(f"{rel}: imports the retired CLI adapter")
    if not (ROOT / SHIELD).exists():
        problems.append(f"{SHIELD} is missing: the check's one door has moved; update this script")
    if problems:
        print("signing-path check: FAIL", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1
    print(f"signing-path check: PASS - {count} source files; every write goes through {SHIELD}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
