#!/usr/bin/env python3
"""Tests for check_audit_skips.py, offline. Run: python3 -I scripts/check_audit_skips_test.py"""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_audit_skips as c  # noqa: E402

NOW = datetime(2026, 11, 17, tzinfo=timezone.utc)
ID = "GHSA-fc5q-39xc-vjpf"
WORKSPACE = f"""packages:
  - "apps/*"

minimumReleaseAge: 10080

# Advisories the audit may skip.
auditConfig:
  ignoreGhsas:
    # picomatch, no fixed version yet; only the test runner uses it.
    - {ID}
"""
ADVISORIES = {"picomatch": [{"url": f"https://github.com/advisories/{ID}", "vulnerable_versions": "<=4.0.7"}]}


def times(**extra):
    base = {"4.0.6": "2026-10-01T00:00:00Z", "4.0.7": "2026-10-20T00:00:00Z"}
    return lambda name: {**base, **extra}


class ParseSkips(unittest.TestCase):
    def test_reads_ids_with_their_reason(self):
        self.assertEqual(c.parse_skips(WORKSPACE), [(ID, "picomatch, no fixed version yet; only the test runner uses it.")])

    def test_no_config_no_skips(self):
        self.assertEqual(c.parse_skips("packages:\n  - x\n"), [])

    def test_an_id_without_a_comment_has_no_reason(self):
        self.assertEqual(c.parse_skips(f"auditConfig:\n  ignoreGhsas:\n    - {ID}\n"), [(ID, "")])


class Lockfile(unittest.TestCase):
    def test_registry_entries_plain_and_scoped(self):
        lock = "lockfileVersion: '9.0'\n\npackages:\n\n  picomatch@4.0.7:\n    resolution: {}\n\n  '@types/three@0.187.0':\n    resolution: {}\n\nsnapshots:\n\n  other@1.0.0: {}\n"
        self.assertEqual(c.installed_packages(lock), {"picomatch": {"4.0.7"}, "@types/three": {"0.187.0"}})


class Ranges(unittest.TestCase):
    def test_comparators(self):
        self.assertTrue(c.in_range("4.0.7", "<=4.0.7"))
        self.assertFalse(c.in_range("4.0.8", "<=4.0.7"))
        self.assertTrue(c.in_range("1.2.0", ">=1.0.0 <1.2.3 || >=2.0.0 <2.0.5"))
        self.assertTrue(c.in_range("2.0.4", ">=1.0.0 <1.2.3 || >=2.0.0 <2.0.5"))
        self.assertFalse(c.in_range("2.0.5", ">=1.0.0 <1.2.3 || >=2.0.0 <2.0.5"))
        self.assertTrue(c.in_range("9.9.9", "*"))

    def test_an_unreadable_range_fails_rather_than_guessing(self):
        with self.assertRaises(c.Unreadable):
            c.in_range("1.0.0", "^1.0.0")


class Judge(unittest.TestCase):
    def run_judge(self, workspace=WORKSPACE, advisories=ADVISORIES, lookup=None):
        return c.judge(c.parse_skips(workspace), advisories, lookup or times(), NOW)

    def test_passes_while_no_fix_exists(self):
        self.assertEqual(self.run_judge(), ([], []))

    def test_fails_once_a_fix_is_old_enough_to_install(self):
        failures, _ = self.run_judge(lookup=times(**{"4.0.8": "2026-11-01T00:00:00Z"}))
        self.assertEqual(len(failures), 1)
        self.assertIn("picomatch 4.0.8", failures[0])
        self.assertIn("remove the skip", failures[0])

    def test_a_fix_younger_than_seven_days_is_a_note_not_a_failure(self):
        failures, notes = self.run_judge(lookup=times(**{"4.0.8": "2026-11-15T00:00:00Z"}))
        self.assertEqual(failures, [])
        self.assertIn("4.0.8", notes[0])

    def test_a_prerelease_is_not_a_fix(self):
        self.assertEqual(self.run_judge(lookup=times(**{"4.0.8-beta.1": "2026-11-01T00:00:00Z"})), ([], []))

    def test_fails_when_the_advisory_no_longer_applies(self):
        failures, _ = self.run_judge(advisories={})
        self.assertIn("remove the skip", failures[0])

    def test_fails_without_a_reason(self):
        failures, _ = self.run_judge(workspace=f"auditConfig:\n  ignoreGhsas:\n    - {ID}\n")
        self.assertIn("no reason given", failures[0])

    def test_fails_on_something_that_isnt_a_ghsa_id(self):
        failures, _ = self.run_judge(workspace="auditConfig:\n  ignoreGhsas:\n    # reason\n    - CVE-2026-0001\n")
        self.assertIn("not a GHSA id", failures[0])


if __name__ == "__main__":
    unittest.main()
