#!/usr/bin/env python3
"""Builds dist/hqc5.wasm from the vendored HQC reference code with the pinned toolchain, and
checks the result is the committed one, byte for byte (packages/hqc/README.md).

1. The vendored source is checked first (scripts/check_vendor.py, offline): nothing is built from
   a file the manifest doesn't vouch for.
2. The toolchain is wasm/toolchain.json: Ubuntu 24.04's own packages of clang and wasm-ld (LLVM
   18.1.3) and wasi-libc. Each .deb is downloaded from the first mirror that serves it, and its size
   and SHA-256 are checked before it is unpacked (dpkg-deb, so this runs on Debian or Ubuntu, or in
   an ubuntu:24.04 container). Only two members of wasi-libc's libc.a are linked, memcpy.o and
   memset.o; nothing else of the C library is in the module.
3. Every source is compiled with the same flags (below; the warnings are the HQC team's own set,
   as errors), from the package folder with relative paths, no debug information, and a clean
   environment; then linked with no entry point, a fixed memory that can't grow, and names
   stripped.
4. The module is read back and must import nothing, export exactly the memory and the four
   functions of wasm/hqc5.c, have no start function, and a memory of exactly the size set here.
5. Its SHA-256 is compared with dist/hqc5.wasm.sha256, and dist/hqc5.wasm and src/hqc5_wasm.ts
   (the same bytes as base64, what the package loads) must hold exactly these bytes. Any
   difference fails. With --write, the three files are written instead.

Standard library only; needs the network the first time (or --cache with the packages in it).
Run from the repository root:

    python3 -I packages/hqc/scripts/build_wasm.py                      # rebuild and compare
    python3 -I packages/hqc/scripts/build_wasm.py --write              # rebuild and write
    python3 -I packages/hqc/scripts/build_wasm.py --cache ~/.cache/hqc-toolchain
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

PACKAGE = Path(__file__).resolve().parent.parent
TOOLCHAIN = PACKAGE / "wasm" / "toolchain.json"
VENDOR = "vendor/hqc-5.1.0"
WASM = PACKAGE / "dist" / "hqc5.wasm"
WASM_SHA256 = PACKAGE / "dist" / "hqc5.wasm.sha256"
WASM_TS = PACKAGE / "src" / "hqc5_wasm.ts"

# The reference's sources for HQC-5 (src/CMakeLists.txt's set for HQC_ARCH=ref), then ours.
SOURCES = [
    f"{VENDOR}/lib/fips202/fips202.c",
    f"{VENDOR}/src/common/code.c",
    f"{VENDOR}/src/common/crypto_memset.c",
    f"{VENDOR}/src/common/hqc-kem.c",
    f"{VENDOR}/src/common/symmetric.c",
    f"{VENDOR}/src/ref/gf.c",
    f"{VENDOR}/src/ref/gf2x.c",
    f"{VENDOR}/src/ref/hqc.c",
    f"{VENDOR}/src/ref/parsing.c",
    f"{VENDOR}/src/ref/reed_muller.c",
    f"{VENDOR}/src/ref/reed_solomon.c",
    f"{VENDOR}/src/ref/vector.c",
    "wasm/hqc5.c",
]
INCLUDES = [
    "wasm/include",  # first: the empty immintrin.h (its own comment says why)
    f"{VENDOR}/src/common",
    f"{VENDOR}/src/common/hqc-5",
    f"{VENDOR}/src/ref",
    f"{VENDOR}/src/ref/hqc-5",
    f"{VENDOR}/lib/fips202",
]
CFLAGS = [
    "--target=wasm32-wasi",
    "-mcpu=generic",
    "-O3",  # the HQC team's release build
    "-std=c99",
    "-DNDEBUG",
    "-DHQC_ARCH_REF=1",
    "-fno-strict-aliasing",  # the reference reads byte arrays through uint64_t pointers
    "-Wall", "-Wextra", "-Wmissing-prototypes", "-Wpedantic", "-Wredundant-decls", "-Werror",
]
STACK_BYTES = 512 * 1024  # 205 KiB used by the deepest call (decapsulation), measured
MEMORY_BYTES = 10 * 65536  # the stack, then 33 KiB of tables and buffers
LDFLAGS = [
    "--no-entry",
    "--strip-all",
    "--stack-first",  # a stack overflow traps instead of running into the data
    "-z", f"stack-size={STACK_BYTES}",
    f"--initial-memory={MEMORY_BYTES}",
    f"--max-memory={MEMORY_BYTES}",
]
EXPORTS = {
    "memory": "memory",
    "hqc5_layout": "function",
    "hqc5_keygen": "function",
    "hqc5_encaps": "function",
    "hqc5_decaps": "function",
}


class BuildError(Exception):
    """A reason the build or its check fails, in one sentence."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---- The toolchain ------------------------------------------------------------------------

def fetch_package(pkg: dict, mirrors: list[str], cache: Path) -> Path:
    """The package's .deb in the cache, downloaded if needed; never used before its hash matches."""
    name = Path(pkg["path"]).name
    dest = cache / name
    if dest.is_file() and dest.stat().st_size == pkg["size"] and sha256(dest.read_bytes()) == pkg["sha256"]:
        return dest
    failures = []
    for mirror in mirrors:
        url = mirror + pkg["path"]
        try:
            with urllib.request.urlopen(url, timeout=300) as response:  # noqa: S310 (pinned hosts, checked by hash)
                data = response.read()
        except OSError as e:
            failures.append(f"{url}: {e}")
            continue
        if len(data) != pkg["size"] or sha256(data) != pkg["sha256"]:
            failures.append(f"{url}: not the pinned file (size {len(data)}, SHA-256 {sha256(data)})")
            continue
        tmp = dest.with_suffix(".part")
        tmp.write_bytes(data)
        tmp.replace(dest)
        return dest
    raise BuildError(f"{pkg['name']} {pkg['version']}: no mirror served the pinned file ({'; '.join(failures)})")


def ar_member(archive: bytes, wanted: str) -> bytes:
    """One member of a GNU ar archive (what llvm-ar writes), which must appear exactly once."""
    if not archive.startswith(b"!<arch>\n"):
        raise BuildError("libc.a isn't an ar archive")
    at, names, found = 8, b"", []
    while at + 60 <= len(archive):
        header = archive[at:at + 60]
        if header[58:60] != b"`\n":
            raise BuildError("libc.a has a malformed member header")
        raw = header[:16].rstrip(b" ")
        size = int(header[48:58].strip())
        data = archive[at + 60:at + 60 + size]
        if raw == b"//":
            names = data
        elif raw.startswith(b"/") and raw[1:].isdigit():
            start = int(raw[1:])
            raw = names[start:names.index(b"\n", start)]
        if raw not in (b"/", b"//") and raw.rstrip(b"/").decode() == wanted:
            found.append(data)
        at += 60 + size + (size & 1)
    if len(found) != 1:
        raise BuildError(f"libc.a holds {len(found)} members named {wanted}, not one")
    return found[0]


def unpack_toolchain(toolchain: dict, cache: Path, into: Path) -> dict[str, Path]:
    if shutil.which("dpkg-deb") is None:
        raise BuildError("dpkg-deb isn't installed: build on Debian or Ubuntu, or in an ubuntu:24.04 container")
    for pkg in toolchain["packages"]:
        deb = fetch_package(pkg, toolchain["mirrors"], cache)
        subprocess.run(["dpkg-deb", "-x", str(deb), str(into)], check=True, env=clean_env())
    llvm = into / "usr/lib/llvm-18"
    tools = {
        "clang": llvm / "bin/clang",
        "wasm-ld": llvm / "bin/wasm-ld",
        "resource": llvm / "lib/clang/18/include",
        "sysroot": into / "usr/include/wasm32-wasi",
        "libc": into / "usr/lib/wasm32-wasi/libc.a",
    }
    for what, path in tools.items():
        if not path.exists():
            raise BuildError(f"the unpacked toolchain has no {what} at {path.relative_to(into)}")
    version = subprocess.run([str(tools["clang"]), "--version"], capture_output=True, text=True, check=True, env=clean_env())
    if "clang version 18.1.3" not in version.stdout:
        raise BuildError("the unpacked clang isn't 18.1.3")
    return tools


def clean_env() -> dict[str, str]:
    """No inherited compiler, linker or library settings: the build sees only what it is given."""
    return {"PATH": "/usr/bin:/bin", "LC_ALL": "C", "TZ": "UTC", "SOURCE_DATE_EPOCH": "0"}


# ---- The build ----------------------------------------------------------------------------

def build(tools: dict[str, Path], work: Path) -> bytes:
    flags = CFLAGS + ["-nostdinc", "-isystem", str(tools["resource"]), "-isystem", str(tools["sysroot"])]
    for inc in INCLUDES:
        flags += ["-I", inc]
    objects = []
    for src in SOURCES:
        obj = work / (src.replace("/", "__") + ".o")
        run([str(tools["clang"]), *flags, "-c", src, "-o", str(obj)], src)
        objects.append(str(obj))
    libc = tools["libc"].read_bytes()
    toolchain = json.loads(TOOLCHAIN.read_text(encoding="utf-8"))
    for member in toolchain["libc_members"]:
        path = work / f"libc__{member}"
        path.write_bytes(ar_member(libc, member))
        objects.append(str(path))
    out = work / "hqc5.wasm"
    run([str(tools["wasm-ld"]), *LDFLAGS, "-o", str(out), *objects], "the link")
    return out.read_bytes()


def run(cmd: list[str], what: str) -> None:
    done = subprocess.run(cmd, cwd=PACKAGE, capture_output=True, text=True, env=clean_env())
    if done.returncode != 0 or done.stderr.strip():
        sys.stderr.write(done.stdout + done.stderr)
        raise BuildError(f"{Path(cmd[0]).name} failed or warned on {what}")


# ---- What the module is -------------------------------------------------------------------

def leb(data: bytes, at: int) -> tuple[int, int]:
    value, shift = 0, 0
    while True:
        byte = data[at]
        at += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return value, at


def name(data: bytes, at: int) -> tuple[str, int]:
    n, at = leb(data, at)
    return data[at:at + n].decode("utf-8"), at + n


def describe(wasm: bytes) -> dict:
    """Imports, exports, memory limits, start function and custom sections of a module."""
    if wasm[:8] != b"\0asm\x01\0\0\0":
        raise BuildError("the output isn't a WebAssembly module")
    kinds = {0: "function", 1: "table", 2: "memory", 3: "global", 4: "tag"}
    info = {"imports": [], "exports": {}, "memories": [], "start": False, "custom": []}
    at = 8
    while at < len(wasm):
        section, at = wasm[at], at + 1
        size, at = leb(wasm, at)
        body, end = at, at + size
        if section == 0:
            info["custom"].append(name(wasm, body)[0])
        elif section == 2:
            count, p = leb(wasm, body)
            for _ in range(count):
                module, p = name(wasm, p)
                field, p = name(wasm, p)
                info["imports"].append(f"{module}.{field}")
                break  # one is already too many
        elif section == 5:
            count, p = leb(wasm, body)
            for _ in range(count):
                flags, p = leb(wasm, p)
                low, p = leb(wasm, p)
                high = None
                if flags & 1:
                    high, p = leb(wasm, p)
                info["memories"].append((low, high))
        elif section == 7:
            count, p = leb(wasm, body)
            for _ in range(count):
                field, p = name(wasm, p)
                kind, p = wasm[p], p + 1
                _, p = leb(wasm, p)
                info["exports"][field] = kinds.get(kind, str(kind))
        elif section == 8:
            info["start"] = True
        at = end
    return info


def check_shape(wasm: bytes) -> dict:
    info = describe(wasm)
    if info["imports"]:
        raise BuildError(f"the module imports {info['imports'][0]}: it must import nothing")
    if info["exports"] != EXPORTS:
        raise BuildError(f"the module exports {sorted(info['exports'])}, not {sorted(EXPORTS)}")
    pages = MEMORY_BYTES // 65536
    if info["memories"] != [(pages, pages)]:
        raise BuildError(f"the module's memory is {info['memories']}, not a fixed {pages} pages")
    if info["start"]:
        raise BuildError("the module has a start function")
    return info


def wasm_ts(wasm: bytes) -> str:
    digest = sha256(wasm)
    b64 = base64.b64encode(wasm).decode("ascii")
    lines = [b64[i:i + 96] for i in range(0, len(b64), 96)]
    body = "\n".join(f'  "{line}",' for line in lines)
    return (
        "// Generated by scripts/build_wasm.py from dist/hqc5.wasm: don't edit it, rebuild (README.md,\n"
        "// \"Rebuild and check\"). The HQC team's reference HQC-5 (v5.1.0) compiled to WebAssembly, as\n"
        "// base64, so the package carries its own bytes and never fetches them.\n"
        f'export const HQC5_WASM_SHA256 = "{digest}";\n\n'
        f"export const HQC5_WASM_BYTES = {len(wasm)};\n\n"
        "export const HQC5_WASM_BASE64 = [\n"
        f"{body}\n"
        '].join("");\n'
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--write", action="store_true", help="write dist/hqc5.wasm, its .sha256 and src/hqc5_wasm.ts")
    parser.add_argument("--cache", type=Path, help="keep the downloaded packages here (checked by hash every time)")
    parser.add_argument("--out", type=Path, help="also copy the built module here")
    args = parser.parse_args(argv)
    try:
        vendor = subprocess.run([sys.executable, "-I", str(PACKAGE / "scripts" / "check_vendor.py")], capture_output=True, text=True)
        if vendor.returncode != 0:
            raise BuildError(f"the vendored source doesn't pass its check: {vendor.stderr.strip()}")
        toolchain = json.loads(TOOLCHAIN.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory(prefix="hqc-build-") as tmp:
            tmp_path = Path(tmp)
            cache = args.cache or tmp_path / "cache"
            cache.mkdir(parents=True, exist_ok=True)
            (tmp_path / "toolchain").mkdir()
            (tmp_path / "work").mkdir()
            tools = unpack_toolchain(toolchain, cache, tmp_path / "toolchain")
            wasm = build(tools, tmp_path / "work")
        check_shape(wasm)
        digest = sha256(wasm)
        if args.out:
            args.out.write_bytes(wasm)
        if args.write:
            WASM.parent.mkdir(exist_ok=True)
            WASM.write_bytes(wasm)
            WASM_SHA256.write_text(f"{digest}  hqc5.wasm\n", encoding="utf-8")
            WASM_TS.write_text(wasm_ts(wasm), encoding="utf-8")
            print(f"build_wasm: wrote dist/hqc5.wasm ({len(wasm)} bytes, SHA-256 {digest})")
            return 0
        pinned = WASM_SHA256.read_text(encoding="utf-8").split()[0] if WASM_SHA256.is_file() else "(none)"
        if digest != pinned:
            raise BuildError(f"the rebuilt module's SHA-256 is {digest}, the committed one {pinned}: the build isn't reproduced")
        if not WASM.is_file() or WASM.read_bytes() != wasm:
            raise BuildError("dist/hqc5.wasm isn't the rebuilt module")
        if not WASM_TS.is_file() or WASM_TS.read_text(encoding="utf-8") != wasm_ts(wasm):
            raise BuildError("src/hqc5_wasm.ts doesn't carry the rebuilt module")
    except (BuildError, subprocess.CalledProcessError, OSError, ValueError) as e:
        print(f"build_wasm: {e}", file=sys.stderr)
        return 1
    print(f"build_wasm: rebuilt dist/hqc5.wasm byte for byte ({len(wasm)} bytes, SHA-256 {digest})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
