#!/usr/bin/env python3
"""Tests for scripts/sleep/rem_pairs.py: the draw is random across categories, repeatable, and
never repeats a part. Standard library only:

    python3 -I scripts/sleep/rem_pairs_test.py
"""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import rem_pairs  # noqa: E402

SCRIPT = HERE / "rem_pairs.py"


def tree(root):
    """A small repository with every category the script knows."""
    (root / "docs").mkdir()
    (root / "docs" / "INVARIANTS.md").write_text(
        "| Rule | What |\n|---|---|\n| INV-01 | one | a |\n| INV-02 | two | b |\n| OPS-01 | ops | c |\n", encoding="utf-8")
    (root / "docs" / "THREAT_MODEL.md").write_text("### T1 — First\n\ntext\n\n### T2 — Second\n", encoding="utf-8")
    for name in ("README.md", "A.md", "B.md"):
        (root / "docs" / name).write_text("x\n", encoding="utf-8")
    for layer, names in (("layer1", ("p1.aleo", "p2.aleo", "archive")), ("layer2", ("q1.aleo",))):
        for name in names:
            (root / "pnw_mvp_v2" / "src" / layer / name).mkdir(parents=True)
    for name in ("vault", "ledger"):
        (root / "packages" / name).mkdir(parents=True)
    for name in ("api", "reports", "payroll"):
        (root / "apps" / "business" / "src" / "app" / name).mkdir(parents=True)
    (root / "scripts").mkdir()
    for name in ("check_links.py", "check_secrets.py", "progress_index.py"):
        (root / "scripts" / name).write_text("", encoding="utf-8")


class RemPairsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        tree(self.root)
        self.found = rem_pairs.parts(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_every_category_is_read_from_the_tree(self):
        names = {k: sorted(n for n, _ in v) for k, v in self.found.items()}
        self.assertEqual(names["rule"], ["INV-01", "INV-02", "OPS-01"])
        self.assertEqual(names["threat"], ["T1", "T2"])
        self.assertEqual(names["document"], ["A.md", "B.md"])  # not the README or the two with their own category
        self.assertEqual(names["program"], ["p1.aleo", "p2.aleo", "q1.aleo"])  # not archive/
        self.assertEqual(names["package"], ["ledger", "vault"])
        self.assertEqual(names["page"], ["payroll", "reports"])  # not api/
        self.assertEqual(names["check"], ["check_links.py", "check_secrets.py"])

    def test_pairs_cross_categories_and_never_repeat_a_part(self):
        pairs = rem_pairs.draw(self.found, "seed", 5)
        self.assertEqual(len(pairs), 5)
        seen = []
        for (ca, pa), (cb, pb) in pairs:
            self.assertNotEqual(ca, cb)
            seen += [pa, pb]
        self.assertEqual(len(seen), len(set(seen)))

    def test_the_same_seed_draws_the_same_pairs_and_another_seed_differs(self):
        a = rem_pairs.draw(self.found, "2026-12-06", 3)
        b = rem_pairs.draw(self.found, "2026-12-06", 3)
        self.assertEqual(a, b)
        others = {tuple(rem_pairs.draw(self.found, f"s{i}", 3)) for i in range(20)}
        self.assertGreater(len(others), 1)

    def test_the_draw_stops_when_fewer_than_two_categories_remain(self):
        small = {"rule": self.found["rule"][:1], "threat": self.found["threat"][:1]}
        self.assertEqual(len(rem_pairs.draw(small, "s", 3)), 1)

    def test_the_command_prints_markdown_and_refuses_an_empty_tree(self):
        done = subprocess.run([sys.executable, "-I", str(SCRIPT), "--seed", "2026-12-06", "--root", str(self.root)],
                              capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("REM pairs, seed `2026-12-06`:", done.stdout)
        self.assertEqual(done.stdout.count("\n1. "), 1)
        self.assertIn("\n3. ", done.stdout)
        with tempfile.TemporaryDirectory() as empty:
            bad = subprocess.run([sys.executable, "-I", str(SCRIPT), "--root", empty], capture_output=True, text=True, timeout=60)
            self.assertEqual(bad.returncode, 1)
            self.assertIn("fewer than two categories", bad.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=1)
