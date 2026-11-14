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
     ...ExternallySigned..., ...ExecutionRequest..., ...ProvingRequest... in either case,
     buildAuthorization, buildFeeAuthorization and the other Authorization builders), however it
     reaches them: they sign or prove outside Shield;
  4b. chain/shield.ts names the adapter's signing calls (`.executeTransaction`, `.executeDeployment`)
     anywhere but once, in checkedSend, after `await checkEditions()` (taken from ./editions.ts);
     or useShield() builds its wallet any other way than `{ ...adaptor, executeTransaction:
     checkedSend(adaptor) }` from its one useWallet(), or uses that adapter for anything but the
     spread, checkedSend and disconnect. Outside shield.ts and packages/wallet, a file calls the
     adapter's own executeTransaction or executeDeployment, reads `.adapter` or `.wallets` (the
     raw adapter, which only shield.ts needs), or names executeDeployment at all (the app deploys
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
    r"\bcomputeExternalSigningInputs\b|\b\w*ExternallySigned\w*|\b\w*[Ee]xecutionRequest\w*|\b\w*[Pp]rovingRequest\w*"
    r"|\bbuild(?:Fee)?Authorization(?:Unchecked|FromExecutionRequest)?\b|\bbuildTransactionFromAuthorization\b"
)
SIGN_CALL = re.compile(r"(?:\?\.|\.)\s*(?:executeTransaction|executeDeployment)\b")
ADAPTER_SIGN = re.compile(r"\badapt[eo]r\s*\??\.\s*(?:executeTransaction|executeDeployment)\b")
ADAPTER_READ = re.compile(
    r"\.\s*(?:adapter|wallets)\b|\[\s*[\"'](?:adapter|wallets)[\"']\s*\]|\{[^{}]*\b(?:adapter|wallets)\b[^{}]*\}\s*=(?![=>])"
)
EDITION_CHECK = re.compile(r"\bawait\s+checkEditions\s*\(\s*\)")
EDITIONS_IMPORT = re.compile(r"""import\s*\{[^}]*\bcheckEditions\b[^}]*\}\s*from\s*["']\./editions["']""")
EDITIONS_SHADOW = re.compile(r"\b(?:const|let|var|function|class)\s+checkEditions\b")
CHECKED_SEND = re.compile(r"\bexport\s+function\s+checkedSend\s*\(\s*adaptor\s*:\s*Sender\s*\)\s*\{")
USE_SHIELD = re.compile(r"\bexport\s+function\s+useShield\s*\(\s*\)\s*\{")
THE_WALLET = re.compile(r"\bconst\s+wallet\s*=\s*\{\s*\.\.\.adaptor\s*,\s*executeTransaction\s*:\s*checkedSend\s*\(\s*adaptor\s*\)\s*,?\s*\}\s*;")
ADAPTOR_USES = re.compile(
    r"\bconst\s+adaptor\s*=\s*useWallet\s*\(\s*\)|\.\.\.adaptor\b|\bcheckedSend\s*\(\s*adaptor\s*\)|\badaptor\s*\.\s*disconnect\s*\("
)


def body(code: str, header: re.Pattern):
    """The text between a function header's `{` and its matching `}`, or None. Skips braces in
    string and template literals (comments are already gone)."""
    m = header.search(code)
    if not m:
        return None
    depth, i, quote = 1, m.end(), None
    while i < len(code):
        c = code[i]
        if quote:
            if c == "\\":
                i += 1
            elif c == quote:
                quote = None
        elif c in "'\"`":
            quote = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return code[m.end():i]
        i += 1
    return None


def shield_problems(code: str) -> list:
    """What is wrong with shield.ts's one door: the adapter is asked to sign once, in checkedSend,
    after `await checkEditions()` from ./editions.ts; and useShield()'s wallet sends only through it."""
    problems = []
    send = body(code, CHECKED_SEND)
    calls = list(SIGN_CALL.finditer(code))
    guarded = (
        EDITIONS_IMPORT.search(code)
        and not EDITIONS_SHADOW.search(code)
        and send is not None
        and len(calls) == 1
        and len(SIGN_CALL.findall(send)) == 1
        and (check := EDITION_CHECK.search(send)) is not None
        and check.start() < SIGN_CALL.search(send).start()
    )
    if not guarded:
        problems.append("asks the adapter to sign without `await checkEditions()` first (./editions.ts), or anywhere but once in checkedSend")
    hook = body(code, USE_SHIELD)
    wired = (
        hook is not None
        and len(re.findall(r"\buseWallet\s*\(", code)) == 1
        and THE_WALLET.search(hook) is not None
        and len(re.findall(r"\.\.\.adaptor\b", hook)) == 1
        and len(re.findall(r"\bcheckedSend\s*\(", hook)) == 1
        and len(re.findall(r"\badaptor\b", hook)) == len(ADAPTOR_USES.findall(hook))
    )
    if not wired:
        problems.append(
            "useShield() must build its wallet as `{ ...adaptor, executeTransaction: checkedSend(adaptor) }` "
            "from its one useWallet(), and use that adapter for nothing else but disconnect"
        )
    return problems


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
            problems.extend(f"{rel}: {p}" for p in shield_problems(code))
        elif not rel.startswith("packages/wallet/"):
            if ADAPTER_SIGN.search(code):
                problems.append(f"{rel}: asks the wallet adapter itself to sign; send through useShield() in {SHIELD}")
            if ADAPTER_READ.search(code):
                problems.append(f"{rel}: reads the wallet's raw adapter (`.adapter`, `.wallets`); only {SHIELD} may")
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
