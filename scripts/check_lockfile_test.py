#!/usr/bin/env python3
"""Tests for scripts/check_lockfile.py: only npm registry entries pass, a version under a week
old fails, and the workspace's release-age setting can't be lowered. The registry is never
called: the lookup is stubbed. Standard library only:

    python3 -I scripts/check_lockfile_test.py
"""
import subprocess
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check_lockfile as c  # noqa: E402

NOW = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)
SHA = "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="


def lockfile(*entries: tuple[str, str]) -> str:
    head = (
        "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n\n"
        "importers:\n\n  .:\n    dependencies:\n      left-pad:\n        specifier: 1.3.0\n"
        "        version: 1.3.0\n\npackages:\n\n"
    )
    body = "".join(f"  '{key}':\n    resolution: {res}\n    engines: {{node: '>=18'}}\n\n" for key, res in entries)
    snaps = "".join(f"  '{key}': {{}}\n" for key, _ in entries)
    return head + body + "snapshots:\n\n" + snaps


PLAIN = lockfile(("left-pad@1.3.0", f"{{integrity: {SHA}}}"))
TARBALL = f"{{integrity: {SHA}, tarball: https://example.com/a.tgz}}"


def published(**ages_in_days):
    """A stub registry: {version: time} for every name, `days` before NOW."""
    times = {v.replace("_", "."): (NOW - timedelta(days=d)).isoformat().replace("+00:00", "Z")
             for v, d in ages_in_days.items()}
    calls = []

    def fetch(name):
        calls.append(name)
        return times

    fetch.calls = calls
    return fetch


class ResolutionTest(unittest.TestCase):
    def test_plain_integrity_passes(self):
        entries, problems = c.parse_lockfile(lockfile(("left-pad@1.3.0", f"{{integrity: {SHA}}}"),
                                                      ("@scope/pkg@2.0.0", f"{{integrity: {SHA}}}")))
        self.assertEqual(problems, [])
        self.assertEqual(sorted(entries), ["@scope/pkg@2.0.0", "left-pad@1.3.0"])

    def test_tarball_resolution_fails(self):
        _, problems = c.parse_lockfile(lockfile(
            ("left-pad@1.3.0", f"{{integrity: {SHA}, tarball: https://example.com/left-pad-1.3.0.tgz}}")))
        self.assertEqual(len(problems), 1)
        self.assertIn("tarball", problems[0])

    def test_git_resolution_fails(self):
        _, problems = c.parse_lockfile(lockfile(
            ("left-pad@https://codeload.github.com/x/left-pad/tar.gz/abc",
             "{commit: 0123456789abcdef, repo: https://github.com/x/left-pad.git, type: git}")))
        self.assertEqual(len(problems), 1)
        for word in ("commit", "repo", "type"):
            self.assertIn(word, problems[0])

    def test_directory_resolution_fails(self):
        _, problems = c.parse_lockfile(lockfile(("left-pad@file:../x", "{directory: ../x, type: directory}")))
        self.assertEqual(len(problems), 1)
        self.assertIn("directory", problems[0])

    def test_block_form_resolution_is_read_too(self):
        text = lockfile(("left-pad@1.3.0", "")).replace(
            "    resolution: \n",
            f"    resolution:\n      integrity: {SHA}\n      tarball: https://example.com/a.tgz\n",
        )
        _, problems = c.parse_lockfile(text)
        self.assertEqual(len(problems), 1)
        self.assertIn("tarball", problems[0])

    def test_resolution_without_integrity_fails(self):
        _, problems = c.parse_lockfile(lockfile(("left-pad@1.3.0", "{}")))
        self.assertEqual(len(problems), 1)
        self.assertIn("no integrity", problems[0])

    def test_a_resolution_in_snapshots_fails(self):
        # pnpm reads an entry's fields from both sections, so a resolution there counts too.
        text = PLAIN.replace(f"    resolution: {{integrity: {SHA}}}\n", "").replace(
            "  'left-pad@1.3.0': {}\n", f"  'left-pad@1.3.0':\n    resolution: {TARBALL}\n")
        _, problems = c.parse_lockfile(text)
        self.assertTrue(any("snapshots" in p and "resolution" in p for p in problems), problems)
        self.assertTrue(any("no resolution" in p for p in problems), problems)

    def test_a_version_or_name_beside_the_resolution_fails(self):
        # pnpm fetches the version written there, not the one in the entry's key.
        for field in ("version: 1.2.0", "name: right-pad", "id: right-pad@1.2.0"):
            text = PLAIN.replace("    engines:", f"    {field}\n    engines:", 1)
            _, problems = c.parse_lockfile(text)
            self.assertEqual(len(problems), 1, (field, problems))
            self.assertIn(field.split(":")[0], problems[0])
        text = PLAIN.replace("  'left-pad@1.3.0': {}\n", "  'left-pad@1.3.0':\n    version: 1.2.0\n")
        self.assertEqual(len(c.parse_lockfile(text)[1]), 1)

    def test_an_entry_in_snapshots_only_fails(self):
        _, problems = c.parse_lockfile(PLAIN + "  right-pad@1.0.0: {}\n")
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("right-pad@1.0.0", problems[0])

    def test_only_the_shape_pnpm_writes_is_read(self):
        variants = {
            "a comment after the section": PLAIN.replace("packages:\n", "packages: # sorted\n"),
            "a quoted section name": PLAIN.replace("packages:\n", "'packages':\n"),
            "an entry on one line": PLAIN.replace(
                f"  'left-pad@1.3.0':\n    resolution: {{integrity: {SHA}}}\n",
                f"  'left-pad@1.3.0': {{resolution: {TARBALL}}}\n"),
            "a quoted field name": PLAIN.replace("    resolution:", "    'resolution':"),
            "a resolution over two lines": PLAIN.replace(
                f"{{integrity: {SHA}}}", f"{{integrity: {SHA},\n      tarball: https://example.com/a.tgz}}"),
            "an alias": PLAIN.replace(f"{{integrity: {SHA}}}", "*plain"),
            "a merge key": PLAIN.replace("    engines:", "    <<: *other\n    engines:"),
            "a double-quoted key": PLAIN.replace("  'left-pad@1.3.0':\n    res", '  "left-pad@1.3.0":\n    res'),
            "an explicit key": PLAIN.replace("    engines:", "    ? version\n    : 1.2.0\n    engines:"),
            "an entry twice": PLAIN.replace("snapshots:", f"  left-pad@1.3.0:\n    resolution: {TARBALL}\n\nsnapshots:"),
        }
        self.assertEqual(c.parse_lockfile(PLAIN)[1], [])
        for name, text in variants.items():
            self.assertNotEqual(c.parse_lockfile(text)[1], [], name)

    def test_a_second_document_is_read_the_same_way(self):
        _, problems = c.parse_lockfile(PLAIN + "---\n" + lockfile(("right-pad@1.0.0", TARBALL)))
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("tarball", problems[0])

    def test_the_words_inside_an_integrity_hash_or_engines_are_not_keys(self):
        _, problems = c.parse_lockfile(lockfile(("type-fest@4.0.0", f"{{integrity: {SHA}}}")))
        self.assertEqual(problems, [])


class AgeTest(unittest.TestCase):
    def test_one_day_old_version_fails(self):
        problems = c.check_ages({"left-pad@1.3.0"}, fetch=published(**{"1_3_0": 1}), now=NOW)
        self.assertEqual(len(problems), 1)
        self.assertIn("under 7", problems[0])

    def test_eight_day_old_version_passes(self):
        self.assertEqual(c.check_ages({"left-pad@1.3.0"}, fetch=published(**{"1_3_0": 8}), now=NOW), [])

    def test_scoped_name_and_peer_suffix_are_looked_up_by_name(self):
        fetch = published(**{"2_0_0": 30})
        self.assertEqual(c.check_ages({"@scope/pkg@2.0.0(react@19.0.0)"}, fetch=fetch, now=NOW), [])
        self.assertEqual(fetch.calls, ["@scope/pkg"])

    def test_unpublished_version_fails(self):
        problems = c.check_ages({"left-pad@9.9.9"}, fetch=published(**{"1_3_0": 30}), now=NOW)
        self.assertIn("not published", problems[0])

    def test_failed_lookup_fails(self):
        def broken(name):
            raise OSError("offline")

        problems = c.check_ages({"left-pad@1.3.0"}, fetch=broken, now=NOW)
        self.assertIn("lookup failed", problems[0])

    def test_nothing_added_looks_nothing_up(self):
        fetch = published()
        self.assertEqual(c.check_ages(set(), fetch=fetch, now=NOW), [])
        self.assertEqual(fetch.calls, [])


class SettingsTest(unittest.TestCase):
    WORKSPACE = 'packages:\n  - "apps/*"\n\nminimumReleaseAge: 10080\n'

    def test_seven_days_passes(self):
        self.assertEqual(c.check_workspace(self.WORKSPACE), [])
        self.assertEqual(c.check_workspace(self.WORKSPACE.replace("10080", "20160")), [])

    def test_lowered_minimum_release_age_fails(self):
        problems = c.check_workspace(self.WORKSPACE.replace("10080", "60"))
        self.assertEqual(len(problems), 1)
        self.assertIn("below", problems[0])

    def test_missing_minimum_release_age_fails(self):
        self.assertIn("missing", c.check_workspace('packages:\n  - "apps/*"\n')[0])

    def test_exclusions_and_other_registries_fail(self):
        text = self.WORKSPACE + "minimumReleaseAgeExclude:\n  - evil\nregistry: https://npm.example.com/\n"
        self.assertEqual(len(c.check_workspace(text)), 2)

    def test_npmrc_registry(self):
        self.assertEqual(c.check_npmrc(".npmrc", "registry=https://registry.npmjs.org/\nauto-install-peers=true\n"), [])
        self.assertEqual(len(c.check_npmrc(".npmrc", "registry=https://npm.example.com/\n")), 1)
        self.assertEqual(len(c.check_npmrc(".npmrc", "@scope:registry=https://npm.example.com\n")), 1)
        self.assertEqual(len(c.check_npmrc(".npmrc", "minimum-release-age=0\n")), 1)


class TreeTest(unittest.TestCase):
    def test_the_repository_passes_today(self):
        out = subprocess.run([sys.executable, "-I", str(HERE / "check_lockfile.py")], capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=1)
