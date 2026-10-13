#!/usr/bin/env python3
"""
Salvage the reusable libraries of pnw_employment_portal_v1 into packages/.

Behaviour-preserving moves only: files are copied, and the only edits are
import specifiers (rewritten to @pnw/<package>/<module>), plus a handful of
type-only blocks lifted out of app-level zustand stores so packages don't
depend on app state. See PROGRESS.md (2026-10-13, Phase 0 salvage).

Usage: python3 salvage/salvage.py <portal-checkout> <monorepo-root>
Re-runnable: it rewrites packages/<name>/src from scratch each time.
"""

import json
import os
import re
import shutil
import sys

PORTAL, ROOT = (os.path.abspath(p) for p in sys.argv[1:3])
PKGS = os.path.join(ROOT, "packages")

# old path (relative to portal root, no extension) -> (package, new module path)
FILES: dict[str, tuple[str, str]] = {}


def put(pkg: str, mapping: dict[str, str]) -> None:
    for old, new in mapping.items():
        FILES[old] = (pkg, new)


A = "src/lib/pnw-adapter/"
put("commitments", {A + m: m for m in [
    "hash", "hash.test", "merkle", "merkle.test", "canonical_encoder",
    "canonical_types", "token_id", "aleo_types"]})
put("config", {"src/config/env": "env", "src/config/programs": "programs"})
put("pnw-adapter", {A + m: m for m in [
    "aleo_cli_adapter", "aleo_records", "layer1_adapter", "layer1_router",
    "layer2_adapter", "layer2_router", "freeze_list_resolver", "sealance_types"]})
put("wallet", {"src/lib/wallet/" + m: m for m in [
    "credential-signer", "credential-signer.test", "useTransactionExecutor",
    "wallet-executor", "wallet-provider"]})
put("handshake", {"src/handshake/" + m: m for m in ["codec", "engine", "types"]})
put("tax-engine", {"src/lib/tax-engine": "tax-engine"})
put("manifest", {
    **{"src/manifest/" + m: m for m in [
        "chunk_planner", "chunk_planner.test", "compiler", "compiler.test",
        "types", "validation.test"]},
    "components/payroll-table/types": "payroll-table/types",
    "components/payroll-table/validation": "payroll-table/validation",
})
put("records", {
    **{"src/records/" + m: m for m in [
        "agreement_reader", "credential_scanner", "payroll_history_scanner",
        "receipt_scanner", "usdcx_scanner", "usdcx_scanner.test",
        "worker_paystub_scanner"]},
    "src/registry/name_registry": "registry/name_registry",
    "src/registry/profile_types": "registry/profile_types",
})
put("w4-crypto", {"src/lib/w4-crypto": "w4-crypto"})
put("nft-art", {"src/nft-art/" + m: m for m in ["hash_params", "topo_renderer"]})
put("pdf", {"components/pdf/" + m: m for m in [
    "AuditAuthPDF", "CredentialCertPDF", "DownloadPDFButton", "PayrollRunPDF",
    "PaystubPDF", "pdf_helpers"]})
put("persistence", {
    **{"src/persistence/" + m: m for m in [
        "draft_encryptor", "draft_integrity", "draft_store", "index", "key_provider"]},
    **{"src/persistence/__tests__/" + m: "__tests__/" + m for m in [
        "draft_encryptor.test", "draft_integrity.test", "key_provider.test"]},
})
put("coordinator", {
    **{"src/coordinator/" + m: m for m in [
        "double_pay_guard", "double_pay_guard.test", "receipt_reconciler",
        "receipt_reconciler.test", "settlement_coordinator",
        "settlement_coordinator.test"]},
    A + "credentials_manager": "credentials_manager",
    A + "roster_credentials_manager": "roster_credentials_manager",
    A + "roster_tree_builder": "roster_tree_builder",
    A + "roster_tree_builder.test": "roster_tree_builder.test",
    "src/anchor/batch_anchor_finalizer": "batch_anchor_finalizer",
    "src/anchor/batch_anchor_finalizer.test": "batch_anchor_finalizer.test",
})

# Type-only blocks lifted out of app stores: (store, [exported names], package, module)
LIFTED = [
    ("src/stores/worker_store", ["PayType", "WorkerRecord"], "records", "types/worker"),
    ("src/stores/credential_store",
     ["CredentialType", "CREDENTIAL_TYPE_LABELS", "CredentialStatus", "CredentialRecord"],
     "records", "types/credential"),
    ("src/stores/audit_store", ["AuditRequestStatus", "AuditRequest"], "records", "types/audit"),
    ("src/stores/w4_store", ["W4Data"], "w4-crypto", "types/w4"),
]
REDIRECT = {store: (pkg, mod) for store, _, pkg, mod in LIFTED}
# PaystubReceipt moves down from coordinator into records (receipt_scanner needs it).
PAYSTUB_RECEIPT = ("records", "types/paystub_receipt")

# External npm deps per package, versions as resolved in the portal lockfile.
VERSIONS = {
    "@noble/hashes": "2.0.1", "@provablehq/sdk": "0.10.1", "jspdf": "4.2.1",
    "qrcode": "1.5.4", "react": "19.2.3", "zustand": "5.0.11",
    **{f"@provablehq/{n}": "0.3.0-alpha.3" for n in [
        "aleo-types", "aleo-wallet-adaptor-core", "aleo-wallet-adaptor-fox",
        "aleo-wallet-adaptor-leo", "aleo-wallet-adaptor-puzzle",
        "aleo-wallet-adaptor-react", "aleo-wallet-adaptor-react-ui",
        "aleo-wallet-adaptor-shield", "aleo-wallet-adaptor-soter",
        "aleo-wallet-standard"]},
}
DEV_VERSIONS = {"@types/react": "19.2.14", "@types/qrcode": "1.5.6"}


def src_file(old: str) -> str:
    for ext in (".ts", ".tsx"):
        if os.path.exists(os.path.join(PORTAL, old + ext)):
            return old + ext
    raise FileNotFoundError(old)


def resolve(spec: str, from_old: str) -> str | None:
    """Portal import specifier -> portal-relative path without extension."""
    if spec.startswith("@/src/"):
        return "src/" + spec[len("@/src/"):]
    if spec.startswith("@/components/"):
        return "components/" + spec[len("@/components/"):]
    if spec.startswith("."):
        return os.path.normpath(os.path.join(os.path.dirname(from_old), spec))
    return None


def extract_blocks(text: str, names: list[str]) -> str:
    out = []
    for name in names:
        m = re.search(rf"^export (?:type|const) {name}\b", text, re.M)
        if not m:
            raise ValueError(f"{name} not found")
        start = m.start()
        # Keep the doc comment directly above, if any.
        before = text[:start].rstrip("\n")
        if before.endswith("*/"):
            start = before.rfind("/**")
        line_end = text.index("\n", m.start())
        first = text[m.start():line_end].rstrip()
        if first.endswith("{"):
            end = re.compile(r"^\};?[ \t]*$", re.M).search(text, line_end).end()
        elif first.endswith(";"):
            end = line_end
        else:  # multi-line union: ends at the first line ending in ";"
            end = re.compile(r";[ \t]*$", re.M).search(text, line_end).end()
        out.append(text[start:end].strip("\n"))
    return "\n\n".join(out) + "\n"


def main() -> None:
    deps: dict[str, set[str]] = {}
    files_out: dict[str, list[str]] = {}

    def rewrite(text: str, from_old: str, pkg: str, new_mod: str) -> str:
        def sub(m: re.Match) -> str:
            spec = m.group(2)
            target = resolve(spec, from_old)
            if target is None:
                bare = spec.split("/")
                name = "/".join(bare[:2]) if spec.startswith("@") else bare[0]
                if name in VERSIONS:
                    deps[pkg].add(name)
                return m.group(0)
            if target in REDIRECT:
                tpkg, tmod = REDIRECT[target]
            elif target == "src/coordinator/receipt_reconciler" and pkg != "coordinator":
                tpkg, tmod = PAYSTUB_RECEIPT
            elif target in FILES:
                tpkg, tmod = FILES[target]
            else:
                raise SystemExit(f"{from_old}: import {spec!r} -> {target} is not salvaged")
            if tpkg == pkg:
                rel = os.path.relpath(tmod, os.path.dirname(new_mod) or ".")
                new = rel if rel.startswith(".") else "./" + rel
            else:
                deps[pkg].add(f"@pnw/{tpkg}")
                new = f"@pnw/{tpkg}/{tmod}"
            return f"{m.group(1)}{new}{m.group(3)}"

        pat = re.compile(r"""((?:from|import|vi\.mock\()\s*["'])([^"']+)(["'])""")
        return pat.sub(sub, text)

    pkgs = sorted({p for p, _ in FILES.values()} | {p for _, _, p, _ in LIFTED})
    for pkg in pkgs:
        shutil.rmtree(os.path.join(PKGS, pkg, "src"), ignore_errors=True)
        deps[pkg] = set()
        files_out[pkg] = []

    def write(pkg: str, rel: str, text: str) -> None:
        path = os.path.join(PKGS, pkg, "src", rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)
        files_out[pkg].append(rel)

    for old, (pkg, new_mod) in FILES.items():
        src = src_file(old)
        ext = os.path.splitext(src)[1]
        text = open(os.path.join(PORTAL, src)).read()
        if old == "src/coordinator/receipt_reconciler":
            block = extract_blocks(text, ["PaystubReceipt"])
            text = text.replace(
                block.strip("\n"),
                'export type { PaystubReceipt } from "@pnw/records/types/paystub_receipt";\n'
                'import type { PaystubReceipt } from "@pnw/records/types/paystub_receipt";')
            deps[pkg].add("@pnw/records")
            header = ('import type { Bytes32 } from "@pnw/commitments/aleo_types";\n\n'
                      "// Lifted from pnw_employment_portal_v1 src/coordinator/receipt_reconciler.ts\n\n")
            write(PAYSTUB_RECEIPT[0], PAYSTUB_RECEIPT[1] + ".ts", header + block)
            deps[PAYSTUB_RECEIPT[0]].add("@pnw/commitments")
        write(pkg, new_mod + ext, rewrite(text, old, pkg, new_mod))

    for store, names, pkg, mod in LIFTED:
        text = open(os.path.join(PORTAL, store + ".ts")).read()
        imports = [l for l in text.splitlines()
                   if l.startswith("import type") and "zustand" not in l]
        body = extract_blocks(text, names)
        head = "\n".join(imports)
        head = f"// Types lifted from pnw_employment_portal_v1 {store}.ts (store itself stays app-side)\n\n{head}\n\n"
        write(pkg, mod + ".ts", rewrite(head + body, store, pkg, mod))

    for pkg in pkgs:
        exports = {}
        for rel in sorted(files_out[pkg]):
            mod, _ = os.path.splitext(rel)
            if mod.endswith(".test") or "__tests__" in mod:
                continue
            exports["./" + mod] = "./src/" + rel
        if pkg == "persistence":
            exports["."] = "./src/index.ts"
        wanted_dev = {d for d in DEV_VERSIONS
                      if (d == "@types/react" and "react" in deps[pkg])
                      or (d == "@types/qrcode" and "qrcode" in deps[pkg])}
        pj = {
            "name": f"@pnw/{pkg}",
            "version": "0.1.0",
            "private": True,
            "type": "module",
            "exports": dict(sorted(exports.items())),
            "scripts": {"build": "tsc -p tsconfig.json", "test": "vitest run --passWithNoTests"},
            "dependencies": {d: ("workspace:*" if d.startswith("@pnw/") else VERSIONS[d])
                             for d in sorted(deps[pkg])},
            "devDependencies": {d: DEV_VERSIONS[d] for d in sorted(wanted_dev)},
        }
        if not pj["devDependencies"]:
            del pj["devDependencies"]
        base = os.path.join(PKGS, pkg)
        with open(os.path.join(base, "package.json"), "w") as f:
            json.dump(pj, f, indent=2)
            f.write("\n")
        with open(os.path.join(base, "tsconfig.json"), "w") as f:
            json.dump({"extends": "../../tsconfig.base.json",
                       "include": ["src/**/*.ts", "src/**/*.tsx"],
                       "exclude": ["src/**/*.test.ts", "src/**/__tests__/**"]}, f, indent=2)
            f.write("\n")
        with open(os.path.join(base, "vitest.config.ts"), "w") as f:
            f.write('import { defineProject } from "vitest/config";\n\n'
                    "export default defineProject({\n"
                    f'  test: {{ name: "{pkg}", globals: true, environment: "node", '
                    'include: ["src/**/*.test.ts"] },\n});\n')
        print(f"{pkg:12} {len(files_out[pkg]):3} files  deps: {', '.join(sorted(deps[pkg])) or '-'}")


main()
