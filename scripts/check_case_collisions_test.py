#!/usr/bin/env python3
"""Tests for check_case_collisions.py. Run: python3 -I scripts/check_case_collisions_test.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_case_collisions as c  # noqa: E402


class Collisions(unittest.TestCase):
    def test_a_component_beside_a_module_of_the_same_name_clashes(self):
        found = c.collisions(["src/chain/Report.tsx", "src/chain/report.ts"])
        self.assertEqual(found, [("modules differing only by case", ["src/chain/Report.tsx", "src/chain/report.ts"])])

    def test_their_tests_clash_too(self):
        self.assertEqual(len(c.collisions(["a/Inbox.test.ts", "a/inbox.test.ts"])), 2)

    def test_the_same_path_ignoring_case_clashes_whatever_the_file(self):
        found = c.collisions(["docs/Readme.md", "docs/README.md"])
        self.assertEqual(found, [("same path ignoring case", ["docs/README.md", "docs/Readme.md"])])

    def test_a_component_and_its_renamed_module_are_fine(self):
        self.assertEqual(c.collisions(["src/chain/Report.tsx", "src/chain/report_letters.ts", "src/chain/Report.test.ts"]), [])

    def test_same_name_in_different_folders_or_kinds_is_fine(self):
        self.assertEqual(c.collisions(["src/books/report.ts", "src/chain/Report.tsx", "brand/Report.png", "brand/report.svg"]), [])

    def test_a_module_and_its_own_test_are_fine(self):
        self.assertEqual(c.collisions(["src/a/report.ts", "src/a/report.test.ts", "src/a/report.tsx"]), [])


if __name__ == "__main__":
    unittest.main()
