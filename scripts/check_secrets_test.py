#!/usr/bin/env python3
"""Tests for scripts/check_secrets.py: what the secrets scan reads and what it recognises.

Builds a throwaway git repository holding a copy of the scan and of this repository's .gitignore,
plants key-shaped strings in it and runs the scan the way CI does. Every planted string is put
together at run time from pieces, so no line of this file looks like a key to the scan itself.
Standard library only:

    python3 -I scripts/check_secrets_test.py
"""
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "check_secrets.py"
GITIGNORE = HERE.parent / ".gitignore"
B58 = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58(n: int) -> str:
    return (B58 * (n // len(B58) + 1))[:n]


# Made-up values, assembled here so that no line of this file matches a pattern.
GITHUB_TOKEN = "gh" + "p_" + "Q" * 36
COMPUTE_KEY = "AComputeKey" + "1" + b58(50)
GRAPH_KEY = "AGraphKey" + "1" + b58(50)
JWT = ".".join(["eyJ" + "hbGciOiJIUzI1NiJ9xx", "eyJ" + "zdWIiOiJ0ZXN0LW9ubHkifQxx", "c2lnbmF0dXJlLXRlc3Qtb25seQ"])
URL_PASSWORD = "rediss://default" + ":" + "Ab3" * 10 + "@example-store.invalid:6379"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)


class SecretsScanTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "scripts").mkdir()
        shutil.copy(SCRIPT, self.root / "scripts" / "check_secrets.py")
        shutil.copy(GITIGNORE, self.root / ".gitignore")
        (self.root / "README.md").write_text("A clean tree.\n", encoding="utf-8")
        for args in (("init", "-q", "-b", "main"), ("config", "user.email", "test@example.invalid"), ("config", "user.name", "Test")):
            git(self.root, *args)
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "start")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel: str, text: str) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def scan(self):
        return subprocess.run(
            [sys.executable, "-I", str(self.root / "scripts" / "check_secrets.py")],
            cwd=self.root,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def ignored(self, rel: str) -> bool:
        return git(self.root, "check-ignore", "-q", "--no-index", rel).returncode == 0

    def test_a_clean_tree_passes(self):
        done = self.scan()
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("PASS", done.stdout)

    def test_an_untracked_file_is_read(self):
        # A new file the next `git add -A` would take: the scan reads it before it is staged.
        self.write("note.txt", f"token {GITHUB_TOKEN}\n")
        done = self.scan()
        self.assertEqual(done.returncode, 1, done.stdout)
        self.assertIn("note.txt:1: looks like a GitHub token", done.stderr)
        self.assertNotIn(GITHUB_TOKEN, done.stdout + done.stderr)

    def test_a_tracked_file_is_still_read(self):
        self.write("src/config.ts", f"const t = '{GITHUB_TOKEN}';\n")
        git(self.root, "add", "src/config.ts")
        done = self.scan()
        self.assertEqual(done.returncode, 1)
        self.assertIn("src/config.ts:1: looks like a GitHub token", done.stderr)

    def test_compute_and_graph_keys(self):
        self.write("keys.md", f"one {COMPUTE_KEY}\ntwo {GRAPH_KEY}\n")
        done = self.scan()
        self.assertEqual(done.returncode, 1)
        self.assertIn("keys.md:1: looks like an Aleo compute key", done.stderr)
        self.assertIn("keys.md:2: looks like an Aleo graph key", done.stderr)
        self.assertNotIn(COMPUTE_KEY, done.stderr)

    def test_server_secrets(self):
        self.write(
            "deploy/notes.txt",
            f"PINATA_JWT={JWT}\nKV_URL={URL_PASSWORD}\nKV_REST_API_TOKEN=AX{b58(40)}\n",
        )
        done = self.scan()
        self.assertEqual(done.returncode, 1)
        self.assertIn("deploy/notes.txt:1: looks like a JSON web token", done.stderr)
        self.assertIn("deploy/notes.txt:2: looks like a password inside a URL", done.stderr)
        self.assertIn("deploy/notes.txt:3: looks like a secret assigned a literal value", done.stderr)

    def test_the_allow_marker_still_applies(self):
        self.write("doc.md", f"{GRAPH_KEY} secrets-scan: allow (a made-up example)\n")
        self.assertEqual(self.scan().returncode, 0)

    def test_env_files_and_backups_are_ignored(self):
        for rel in (".env", ".env.local", ".env.staging", ".env.production", "apps/business/.env.preview",
                    "books.hewn", "books-2026-11-08.hewn.txt", ".vercel/project.json", "apps/site/.vercel/README.txt"):
            self.assertTrue(self.ignored(rel), rel)
        for rel in (".env.example", "apps/business/.env.example", "notes.txt", "docs/hewn.md"):
            self.assertFalse(self.ignored(rel), rel)

    def test_an_ignored_env_file_is_not_read(self):
        self.write(".env.staging", f"GITHUB_TOKEN={GITHUB_TOKEN}\n")
        self.assertEqual(self.scan().returncode, 0)

    def test_a_tracked_env_file_fails(self):
        self.write("config/.env.staging", "NETWORK=testnet\n")
        git(self.root, "add", "-f", "config/.env.staging")
        done = self.scan()
        self.assertEqual(done.returncode, 1)
        self.assertIn("config/.env.staging: a .env file", done.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
