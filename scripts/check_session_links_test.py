#!/usr/bin/env python3
"""Tests for scripts/check_session_links.py: a commit message or pull request description with a
claude.ai session link fails, a bare session id passes, an empty range passes. Builds a small
git repository in a temporary folder. Standard library only:

    python3 -I scripts/check_session_links_test.py
"""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check_session_links as c  # noqa: E402

ID = "session_01ABCDEFGHJKLMNPQRSTUVWX"
LINK = f"https://claude.ai/code/{ID}"
ZERO = "0" * 40


class RepoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.git("init", "-q", "-b", "main")
        self.base = self.commit("first")
        self.git("update-ref", "refs/remotes/origin/main", self.base)

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        return subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", *args],
            cwd=self.root, capture_output=True, text=True, check=True,
        ).stdout.strip()

    def commit(self, message):
        self.git("commit", "-q", "--allow-empty", "-m", message)
        return self.git("rev-parse", "HEAD")

    def bad(self, name, event):
        return [w for w, t in c.texts_for_event(name, event, cwd=self.root) if c.has_link(t)]

    def test_a_message_with_a_session_link_fails(self):
        head = self.commit(f"letters: a sender's name is shown as text\n\n{LINK}")
        self.assertEqual(self.bad("push", {"before": self.base, "after": head}), [f"commit {head[:12]}"])

    def test_a_bare_session_id_passes(self):
        head = self.commit(f"progress: the day's entry\n\n— {ID}")
        texts = c.texts_for_event("push", {"before": self.base, "after": head}, cwd=self.root)
        self.assertEqual(len(texts), 1)
        self.assertEqual(self.bad("push", {"before": self.base, "after": head}), [])

    def test_an_empty_range_passes(self):
        self.assertEqual(c.texts_for_event("push", {"before": self.base, "after": self.base}, cwd=self.root), [])
        self.assertEqual(c.texts_for_event("push", {"before": self.base, "after": ZERO}, cwd=self.root), [])

    def test_a_new_branch_is_read_from_the_default_branch(self):
        self.commit("one")
        head = self.commit(f"two {LINK}")
        event = {"before": ZERO, "after": head, "repository": {"default_branch": "main"}}
        self.assertEqual(len(c.texts_for_event("push", event, cwd=self.root)), 2)
        self.assertEqual(self.bad("push", event), [f"commit {head[:12]}"])

    def test_a_force_push_from_an_unknown_commit_still_reads_the_branch(self):
        head = self.commit(f"rewritten ({LINK})")
        self.assertEqual(self.bad("push", {"before": "f" * 40, "after": head}), [f"commit {head[:12]}"])

    def test_pull_request_description_and_commits(self):
        head = self.commit("chain: pairing screen")
        pr = {"pull_request": {"title": "chain: pairing", "body": f"Summary.\n\n{LINK}",
                               "base": {"sha": self.base}, "head": {"sha": head}}}
        self.assertEqual(self.bad("pull_request", pr), ["the pull request's description"])
        pr["pull_request"]["body"] = f"Summary.\n\n— {ID}"
        self.assertEqual(self.bad("pull_request", pr), [])
        pr["pull_request"]["body"] = None
        self.assertEqual(self.bad("pull_request", pr), [])

    def test_the_pattern(self):
        self.assertTrue(c.has_link(f"see [the session]({LINK})"))
        self.assertTrue(c.has_link("Claude-Session: https://claude.ai/code/session_01X"))
        self.assertFalse(c.has_link(f"— {ID}"))
        self.assertFalse(c.has_link("https://claude.ai/code and a session_01X elsewhere"))
        self.assertFalse(c.has_link(""))


if __name__ == "__main__":
    unittest.main(verbosity=1)
