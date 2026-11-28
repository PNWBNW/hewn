#!/usr/bin/env python3
"""Tests for packages/hqc/scripts/check_vendor.py: the package's own vendored tree passes; a
changed, added or missing file, a link, a changed fixture and an upstream hash without a patch
fail; a patch passes only when undoing its one replacement gives upstream's file, and fails when
the file carries another change, the replacement is missing or doubled, or it has no reason; an
unsafe path in the manifest fails. No network: the upstream comparison isn't called. Standard
library only:

    python3 -I packages/hqc/scripts/check_vendor_test.py
"""

import copy
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check_vendor as c  # noqa: E402

PACKAGE = HERE.parent


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Tree:
    """A copy of the package's vendored tree, fixtures and manifest in a temporary folder."""

    def __init__(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        shutil.copytree(PACKAGE / "vendor", self.root / "vendor")
        shutil.copytree(PACKAGE / "fixtures", self.root / "fixtures")
        self.manifest = c.load(self.root / "vendor" / "manifest.json")

    def check(self, manifest: dict | None = None) -> list[str]:
        return c.check_local(manifest or self.manifest, self.root)

    @property
    def vendored(self) -> Path:
        return self.root / self.manifest["root"]

    def patched(self) -> dict:
        return next(e for e in self.manifest["files"] if "patch" in e)

    def close(self) -> None:
        self.tmp.cleanup()


class CheckVendor(unittest.TestCase):
    def setUp(self) -> None:
        self.t = Tree()

    def tearDown(self) -> None:
        self.t.close()

    def fails(self, fragment: str, manifest: dict | None = None) -> None:
        with self.assertRaises(c.CheckError) as e:
            self.t.check(manifest)
        self.assertIn(fragment, str(e.exception))

    def test_the_package_tree_passes(self):
        checked = c.check_local(c.load(), PACKAGE)
        self.assertIn("src/common/hqc-kem.c", checked)
        self.assertIn("fixtures/PQCkemKAT_32.rsp", checked)

    def test_the_copy_passes(self):
        self.assertEqual(len(self.t.check()), len(self.t.manifest["files"]) + len(self.t.manifest["fixtures"]))

    def test_a_changed_file_fails(self):
        p = self.t.vendored / "src/common/hqc-kem.c"
        p.write_bytes(p.read_bytes() + b"\n")
        self.fails("src/common/hqc-kem.c: its SHA-256 isn't the manifest's")

    def test_an_added_file_fails(self):
        (self.t.vendored / "src/ref/extra.c").write_text("int x;\n")
        self.fails("doesn't list: src/ref/extra.c")

    def test_a_missing_file_fails(self):
        (self.t.vendored / "src/ref/gf.c").unlink()
        self.fails("aren't there: src/ref/gf.c")

    def test_a_link_fails(self):
        os.symlink("/etc/hostname", self.t.vendored / "src/ref/link.h")
        self.fails("a link in the vendored tree")

    def test_a_changed_fixture_fails(self):
        p = self.t.root / "fixtures/PQCkemKAT_32.rsp"
        p.write_bytes(p.read_bytes().replace(b"count = 0", b"count = 9", 1))
        self.fails("fixtures/PQCkemKAT_32.rsp: its SHA-256 isn't the manifest's")

    def test_an_upstream_hash_without_a_patch_fails(self):
        m = copy.deepcopy(self.t.manifest)
        entry = next(e for e in m["files"] if "patch" not in e)
        entry["upstream_sha256"] = "0" * 64
        self.fails("an upstream hash without a patch", m)

    def test_a_patch_with_another_change_fails(self):
        entry = self.t.patched()
        p = self.t.vendored / entry["path"]
        data = p.read_bytes() + b"/* more */\n"
        p.write_bytes(data)
        m = copy.deepcopy(self.t.manifest)
        next(e for e in m["files"] if e["path"] == entry["path"])["sha256"] = sha(data)
        self.fails("another change is in it", m)

    def test_a_patch_whose_replacement_is_missing_fails(self):
        m = copy.deepcopy(self.t.manifest)
        next(e for e in m["files"] if "patch" in e)["patch"]["replace"] = "#define NOT_THERE 1"
        self.fails("isn't in the file exactly once", m)

    def test_a_doubled_replacement_fails(self):
        entry = self.t.patched()
        p = self.t.vendored / entry["path"]
        data = p.read_bytes() + entry["patch"]["replace"].encode() + b"\n"
        p.write_bytes(data)
        m = copy.deepcopy(self.t.manifest)
        next(e for e in m["files"] if e["path"] == entry["path"])["sha256"] = sha(data)
        self.fails("isn't in the file exactly once", m)

    def test_a_patch_without_a_reason_fails(self):
        m = copy.deepcopy(self.t.manifest)
        next(e for e in m["files"] if "patch" in e)["patch"]["reason"] = " "
        self.fails("a patch must say why", m)

    def test_a_patch_without_upstreams_hash_fails(self):
        m = copy.deepcopy(self.t.manifest)
        del next(e for e in m["files"] if "patch" in e)["upstream_sha256"]
        self.fails("must record upstream's SHA-256", m)

    def test_an_unsafe_path_fails(self):
        m = copy.deepcopy(self.t.manifest)
        m["files"].append({"path": "../escape.c", "sha256": "0" * 64})
        p = self.t.root / "vendor" / "manifest.json"
        p.write_text(json.dumps(m))
        with self.assertRaises(c.CheckError) as e:
            c.load(p)
        self.assertIn("unsafe path", str(e.exception))

    def test_an_unpinned_commit_fails(self):
        m = copy.deepcopy(self.t.manifest)
        m["upstream"]["commit"] = "v5.1.0"
        p = self.t.root / "vendor" / "manifest.json"
        p.write_text(json.dumps(m))
        with self.assertRaises(c.CheckError) as e:
            c.load(p)
        self.assertIn("full hashes", str(e.exception))


if __name__ == "__main__":
    unittest.main(verbosity=1)
