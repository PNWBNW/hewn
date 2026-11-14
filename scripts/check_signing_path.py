#!/usr/bin/env python3
"""Every on-chain write is signed in the user's Shield wallet (docs/INVARIANTS.md, INV-11; T3).

The app has one door to the wallet: `useShield()` in apps/business/src/chain/shield.ts wraps the
adapter's executeTransaction (and applies the fee mode); every panel that sends a transaction gets
its wallet from there. This check keeps that door the only one. Outside tests, it fails when:

  1. a file outside packages/wallet imports a @provablehq/aleo-wallet-adapter package;
  2. a file other than chain/shield.ts takes `useWallet` from @pnw/wallet/wallet-provider;
  3. a file outside apps/business/src/chain, packages/rail and packages/wallet calls
     `.executeTransaction(`;
  4. a file that imports @provablehq/sdk (or @provablehq/wasm, beneath it) uses its execute path
     (ProgramManager..., buildExecution..., .execute(, broadcast);
  4a. any file names the SDK's external-signing or proving-request calls (computeExternalSigningInputs,
     ...ExternallySigned..., ExecutionRequest, build...Authorization..., ProvingRequest,
     submitProvingRequest...), however it reaches them: they sign or prove outside Shield;
  4b. chain/shield.ts asks the adapter to sign (`.executeTransaction(`, `.executeDeployment(`)
     anywhere but after `await checkEditions()` in the same function, with checkEditions taken from
     ./editions.ts; outside shield.ts and packages/wallet, a file calls the adapter's own
     executeTransaction or executeDeployment, or names executeDeployment at all (the app deploys
     nothing; the wallet useShield() returns passes the adapter's deployment through unchecked);
  5. any file imports child_process (no snarkos, no shelling out);
  6. any file imports a CLI adapter (the pasted-key path, deleted; it must not come back);
  7. any file imports Veil's local-key or local-node packages (@provablehq/veil-aleo-sdk,
     veil-aleo-devnode, veil-leo, aleo-devnode): they sign with a private key, for tests only
     (docs/VEIL.md, apps/business/test/devnode);
  8. any file takes a writing or contract action from @provablehq/veil-core (the app uses it to
     read records: parseRecord and the generated decoders), or calls a generated
     `create...Contract` (the bindings in src/chain/generated carry one; only the decoders are
     the app's), so Veil's wallet client never becomes a second way to sign.

Standard library only. Run from the repository root: python3 -I scripts/check_signing_path.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHIELD = "apps/business/src/chain/shield.ts"
SEND_OK = ("apps/business/src/chain/", "packages/rail/src/", "packages/wallet/src/")
IMPORT = re.compile(r"""(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']""")
VEIL_CORE = "@provablehq/veil-core"
VEIL_WRITE = re.compile(r"\b(createWalletClient|getContract|writeContract|executeContract|simulateContract|deployContract|transfer|createClient)\b")
NAMED_FROM = re.compile(r"""import\s+(?:type\s+)?(\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*from\s*["']([^"']+)["']""")
GENERATED_FACTORY = re.compile(r"\bcreate[A-Z]\w*Contract\s*\(")
GENERATED = "apps/business/src/chain/generated/"
TEST_ONLY = ("@provablehq/veil-aleo-sdk", "@provablehq/veil-aleo-devnode", "@provablehq/veil-leo", "@provablehq/aleo-devnode")
SDK = ("@provablehq/sdk", "@provablehq/wasm")
SDK_EXECUTE = re.compile(r"\bProgramManager\w*|\bbuildExecution\w*|\bbuildDevnodeExecution\w*|\.execute\s*\(|\bbroadcast\w*\s*\(")

EXTERNAL_SIGNING = re.compile(
    r"\bcomputeExternalSigningInputs\b|\b\w*ExternallySigned\w*|\bExecutionRequest\b|\bbuild\w*Authorization\w*"
    r"|\bProvingRequest\w*|\bsubmitProvingRequest\w*"
)
SIGN_CALL = re.compile(r"\.\s*(?:executeTransaction|executeDeployment)\s*\(")
ADAPTER_SIGN = re.compile(r"\badapt[eo]r\s*\??\.\s*(?:executeTransaction|executeDeployment)\b")
EDITION_CHECK = re.compile(r"\bawait\s+checkEditions\s*\(")
EDITIONS_IMPORT = re.compile(r"""import\s*\{[^}]*\bcheckEditions\b[^}]*\}\s*from\s*["']\./editions["']""")
EDITIONS_SHADOW = re.compile(r"\b(?:const|let|var|function|class)\s+checkEditions\b")


def unchecked_sends(code: str) -> int:
    """How many of shield.ts's requests for a signature aren't preceded, in their own async
    function, by `await checkEditions()` (taken from ./editions.ts and not redefined here)."""
    if not EDITIONS_IMPORT.search(code) or EDITIONS_SHADOW.search(code):
        return max(1, len(SIGN_CALL.findall(code)))
    missing = 0
    for call in SIGN_CALL.finditer(code):
        start = code.rfind("async", 0, call.start())
        if start < 0 or not EDITION_CHECK.search(code, start, call.start()):
            missing += 1
    return missing


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
        if any(i == s or i.startswith(s + "/") for i in imports for s in SDK) and SDK_EXECUTE.search(code):
            problems.append(f"{rel}: uses the SDK's execute path; every write goes through Shield")
        if EXTERNAL_SIGNING.search(code):
            problems.append(f"{rel}: uses the SDK's external signing or proving request; every write is signed and proved in Shield")
        if rel == SHIELD:
            if unchecked_sends(code):
                problems.append(f"{rel}: asks the adapter to sign without `await checkEditions()` first (./editions.ts)")
        elif not rel.startswith("packages/wallet/"):
            if ADAPTER_SIGN.search(code):
                problems.append(f"{rel}: asks the wallet adapter itself to sign; send through useShield() in {SHIELD}")
            if re.search(r"\bexecuteDeployment\b", code):
                problems.append(f"{rel}: asks for a deployment; the app deploys nothing, and a deployment would skip the edition check")
        if any(i in ("child_process", "node:child_process") for i in imports):
            problems.append(f"{rel}: imports child_process (no snarkos, no shelling out)")
        if any(re.search(r"aleo_cli_adapter|cli_adapter", i) for i in imports):
            problems.append(f"{rel}: imports a CLI adapter (the pasted-key path is gone)")
        for i in imports:
            if any(i == t or i.startswith(t + "/") for t in TEST_ONLY):
                problems.append(f"{rel}: imports {i}, which signs with a local key (tests only)")
        if not rel.startswith(GENERATED):
            for names, module in NAMED_FROM.findall(code):
                if module == VEIL_CORE and (names.lstrip().startswith("*") or VEIL_WRITE.search(names)):
                    problems.append(f"{rel}: takes a writing or contract action from {VEIL_CORE}; the app reads with it, and writes only through Shield")
            if GENERATED_FACTORY.search(code):
                problems.append(f"{rel}: calls a generated contract factory; use the generated decoders, and write through Shield")
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
