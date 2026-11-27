#!/usr/bin/env python3
"""Tests for apps/native/scripts/check_gpui_source.py: a snapshot that is Zed's source passes; a
changed, added or missing file fails; a reviewed patch passes only at its exact bytes and fails
once stale; a vendored folder must be byte for byte Zed's; a crate that names no Zed commit, a
download whose checksum isn't the lockfile's and an archive holding a link fail. Neither
crates.io nor GitHub is called: the download and Zed's checkout are stubbed. Standard library
only:

    python3 -I apps/native/scripts/check_gpui_source_test.py
"""

import hashlib
import io
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check_gpui_source as c  # noqa: E402

REV = "d2a4fb6ded7c470be25d1541281da3882495b65b"


def manifest(name: str, zed_crate: str, rev: str = REV, short: str = REV[:7]) -> str:
    return (
        f'[package]\nname = "{name}"\nversion = "0.3.12"\n'
        f'description = "Zed\'s GPU-accelerated UI framework (gpui-pre snapshot of zed@{short})"\n\n'
        f'[package.metadata.gpui-pre]\nzed-crate = "{zed_crate}"\nzed-rev = "{rev}"\n'
    )


def crate_archive(name: str, files: dict[str, bytes], link: bool = False) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel, data in files.items():
            info = tarfile.TarInfo(f"{name}-0.3.12/{rel}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        if link:
            info = tarfile.TarInfo(f"{name}-0.3.12/evil")
            info.type = tarfile.SYMTYPE
            info.linkname = "/etc/passwd"
            tar.addfile(info)
    return buf.getvalue()


def lock(*crates: tuple[str, bytes]) -> str:
    out = "version = 4\n\n"
    for name, data in crates:
        out += (
            f'[[package]]\nname = "{name}"\nversion = "0.3.12"\n'
            f'source = "registry+https://github.com/rust-lang/crates.io-index"\n'
            f'checksum = "{hashlib.sha256(data).hexdigest()}"\n\n'
        )
    return out


class Fixture:
    """A fake Zed checkout and a fake crates.io, in a scratch folder."""

    def __init__(self, zed: dict[str, dict[str, bytes]]):
        self.tmp = tempfile.TemporaryDirectory()
        self.work = Path(self.tmp.name)
        self.zed_root = self.work / "zed"
        for folder, files in zed.items():
            for rel, data in files.items():
                path = self.zed_root / folder / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
        self.archives: dict[str, bytes] = {}
        self._real = c.zed_checkout
        c.zed_checkout = self.checkout

    def checkout(self, rev, crates, into):
        self.asked = (rev, crates)
        return {crate: self.zed_root / crate for crate in crates if (self.zed_root / crate).exists()}

    def add(self, name: str, files: dict[str, bytes], **kw) -> bytes:
        data = crate_archive(name, files, **kw)
        self.archives[name] = data
        return data

    def run(self, lock_text: str, patches: str = ""):
        self.runs = getattr(self, "runs", 0) + 1
        return c.check(lock_text, patches, self.work / f"out{self.runs}", fetch=lambda p: self.archives[p.name])

    def close(self):
        c.zed_checkout = self._real
        self.tmp.cleanup()


SRC = {"Cargo.toml": b'[package]\nname = "gpui"\n', "src/lib.rs": b"pub fn a() {}\n", "README.md": b"gpui\n"}


class SourceCheck(unittest.TestCase):
    def setUp(self):
        self.f = Fixture({"gpui": SRC})

    def tearDown(self):
        self.f.close()

    def snapshot(self, **changes):
        files = {"Cargo.toml": manifest("gpui-pre", "gpui").encode(), "Cargo.toml.orig": b"renamed", ".cargo_vcs_info.json": b"{}", "Cargo.lock": b"", "src/lib.rs": SRC["src/lib.rs"], "README.md": SRC["README.md"]}
        for k, v in changes.items():
            k = k.replace("__", "/").replace("_DOT_", ".")
            if v is None:
                files.pop(k, None)
            else:
                files[k] = v
        return self.f.add("gpui-pre", files)

    def test_an_exact_copy_passes_and_packaging_files_are_ignored(self):
        problems, notes, _ = self.f.run(lock(("gpui-pre", self.snapshot())))
        self.assertEqual(problems, [])
        self.assertIn("matches", notes[0])
        self.assertEqual(self.f.asked, (REV, ["gpui"]))

    def test_a_changed_file_fails(self):
        problems, _, _ = self.f.run(lock(("gpui-pre", self.snapshot(src__lib_DOT_rs=b"pub fn a() { evil() }\n"))))
        self.assertEqual(len(problems), 1)
        self.assertIn("differs: src/lib.rs", problems[0])

    def test_an_added_file_fails(self):
        problems, _, _ = self.f.run(lock(("gpui-pre", self.snapshot(src__extra_DOT_rs=b"// more\n"))))
        self.assertTrue(any("only in the snapshot: src/extra.rs" in p for p in problems))

    def test_a_missing_file_fails(self):
        problems, _, _ = self.f.run(lock(("gpui-pre", self.snapshot(README_DOT_md=None))))
        self.assertTrue(any("only in Zed: README.md" in p for p in problems))

    def test_a_reviewed_patch_passes_only_at_its_exact_bytes(self):
        patched = b"pub fn a() { $crate() }\n"
        entry = (
            '[[patch]]\ncrate = "gpui-pre"\nversion = "0.3.12"\npath = "src/lib.rs"\n'
            f'zed = "{hashlib.sha256(SRC["src/lib.rs"]).hexdigest()}"\n'
            f'snapshot = "{hashlib.sha256(patched).hexdigest()}"\nwhy = "a path for the facade"\n'
        )
        problems, notes, _ = self.f.run(lock(("gpui-pre", self.snapshot(src__lib_DOT_rs=patched))), entry)
        self.assertEqual(problems, [])
        self.assertIn("1 reviewed patch", notes[0])
        problems, _, _ = self.f.run(lock(("gpui-pre", self.snapshot(src__lib_DOT_rs=patched + b"// one more byte\n"))), entry)
        self.assertTrue(any("differs: src/lib.rs" in p for p in problems))
        self.assertTrue(any("no longer applies" in p for p in problems))

    def test_a_stale_patch_fails(self):
        entry = '[[patch]]\ncrate = "gpui-pre"\nversion = "0.3.12"\npath = "src/gone.rs"\nzed = ""\nsnapshot = "' + "a" * 64 + '"\nwhy = "x"\n'
        problems, _, _ = self.f.run(lock(("gpui-pre", self.snapshot())), entry)
        self.assertTrue(any("src/gone.rs no longer applies" in p for p in problems))

    def test_a_patch_without_a_reason_is_refused(self):
        entry = '[[patch]]\ncrate = "gpui-pre"\nversion = "0.3.12"\npath = "src/lib.rs"\nzed = ""\nsnapshot = "' + "a" * 64 + '"\nwhy = " "\n'
        with self.assertRaises(c.CheckError):
            self.f.run(lock(("gpui-pre", self.snapshot())), entry)

    def test_a_crate_that_names_no_commit_fails(self):
        files = {"Cargo.toml": b'[package]\nname = "gpui-pre"\nversion = "0.3.12"\n', "src/lib.rs": SRC["src/lib.rs"]}
        with self.assertRaisesRegex(c.CheckError, "names no Zed commit"):
            self.f.run(lock(("gpui-pre", self.f.add("gpui-pre", files))))

    def test_a_description_naming_another_commit_fails(self):
        files = {"Cargo.toml": manifest("gpui-pre", "gpui", short="1234567").encode(), "src/lib.rs": SRC["src/lib.rs"]}
        with self.assertRaisesRegex(c.CheckError, "description names zed@1234567"):
            self.f.run(lock(("gpui-pre", self.f.add("gpui-pre", files))))

    def test_a_checksum_other_than_the_lockfiles_fails(self):
        self.snapshot()
        other = lock(("gpui-pre", b"something else"))
        with self.assertRaisesRegex(c.CheckError, "isn't Cargo.lock's"):
            self.f.run(other)

    def test_an_archive_holding_a_link_fails(self):
        data = self.f.add("gpui-pre", {"Cargo.toml": manifest("gpui-pre", "gpui").encode()}, link=True)
        with self.assertRaisesRegex(c.CheckError, "which a crate can't"):
            self.f.run(lock(("gpui-pre", data)))

    def test_a_crate_not_from_crates_io_fails(self):
        text = 'version = 4\n\n[[package]]\nname = "gpui-pre"\nversion = "0.3.12"\nsource = "git+https://example.com/x?rev=' + "a" * 40 + "#" + "a" * 40 + '"\n'
        with self.assertRaisesRegex(c.CheckError, "isn't pinned from crates.io"):
            self.f.run(text)

    def test_no_snapshot_in_the_lockfile_is_a_problem(self):
        problems, _, _ = self.f.run("version = 4\n")
        self.assertTrue(problems)


class Vendored(unittest.TestCase):
    def setUp(self):
        self.f = Fixture({"gpui": SRC, "gpui_apple": {"Cargo.toml": b'[package]\nname = "gpui_apple"\n', "build.rs": b"fn main() {}\n"}})
        self.rules = '[[vendor]]\ncrate = "gpui-pre-apple"\nversion = "0.3.12"\nfolder = "vendor/gpui"\nzed-crate = "gpui"\n'

    def tearDown(self):
        self.f.close()

    def apple(self, vendored: bytes) -> bytes:
        return self.f.add("gpui-pre-apple", {"Cargo.toml": manifest("gpui-pre-apple", "gpui_apple").encode(), "build.rs": b"fn main() {}\n", "vendor/gpui/src/lib.rs": vendored})

    def test_a_vendored_copy_of_zeds_file_passes(self):
        problems, _, _ = self.f.run(lock(("gpui-pre-apple", self.apple(SRC["src/lib.rs"]))), self.rules)
        self.assertEqual(problems, [])

    def test_a_vendored_file_that_isnt_zeds_fails(self):
        problems, _, _ = self.f.run(lock(("gpui-pre-apple", self.apple(b"pub fn a() { evil() }\n"))), self.rules)
        self.assertTrue(any("vendored vendor/gpui/src/lib.rs" in p for p in problems))

    def test_without_the_vendor_rule_the_folder_is_extra(self):
        problems, _, _ = self.f.run(lock(("gpui-pre-apple", self.apple(SRC["src/lib.rs"]))))
        self.assertTrue(any("only in the snapshot: vendor/gpui/src/lib.rs" in p for p in problems))


class Trees(unittest.TestCase):
    def test_nested_crates_and_excluded_files_are_left_out_and_links_read_through(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "src").mkdir()
            (root / "src" / "lib.rs").write_text("x")
            (root / "derive").mkdir()
            (root / "derive" / "Cargo.toml").write_text("[package]")
            (root / "docs").mkdir()
            (root / "docs" / "big.md").write_text("y")
            (root.parent / f"{root.name}-licence").write_text("licence")
            (root / "LICENSE").symlink_to(root.parent / f"{root.name}-licence")
            keep = c.package_filter('[package]\nexclude = ["docs/"]\n')
            files = c.tree(root, skip_nested=True, keep=keep)
            (root.parent / f"{root.name}-licence").unlink()
        self.assertEqual(sorted(files), ["LICENSE", "src/lib.rs"])
        self.assertEqual(files["LICENSE"], b"licence")


if __name__ == "__main__":
    unittest.main()
