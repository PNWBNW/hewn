#!/usr/bin/env python3
"""Tests for scripts/sleep/snapshot.py: the snapshot holds the state it should, and only that.

Builds a throwaway git repository, runs the script the way the hooks do (a subprocess with the
hook's JSON on standard input) and checks what it writes and prints. Standard library only:

    python3 -I scripts/sleep/snapshot_test.py
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "snapshot.py"
SESSION = "session_01TESTONLYsnapshotid"
# Looks like a key; the snapshot must never copy a file's contents, only its name.
NOT_A_KEY = "APrivateKey1zkpTESTONLYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"


def git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def hook(root, mode, payload):
    done = subprocess.run(
        [sys.executable, "-I", str(SCRIPT), mode, "--root", str(root)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=60,
    )
    return done


class SnapshotTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        git(self.root, "init", "-q", "-b", "main")
        git(self.root, "config", "user.email", "test@example.invalid")
        git(self.root, "config", "user.name", "Test")
        (self.root / "progress").mkdir()
        (self.root / "progress" / "2026-11-06.md").write_text("## 2026-11-06 — Older\n\nText.\n", encoding="utf-8")
        (self.root / "progress" / "2026-11-07.md").write_text(
            "## 2026-11-07 — First of the day\n\nText.\n\n## 2026-11-07 — The newest entry\n\nText.\n",
            encoding="utf-8",
        )
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "start")
        git(self.root, "checkout", "-q", "-b", "work")
        (self.root / "work.ts").write_text("export const x = 1;\n", encoding="utf-8")
        git(self.root, "add", "work.ts")
        git(self.root, "commit", "-q", "-m", "a commit on the branch")
        (self.root / "dirty.ts").write_text("export const x = 1;\n", encoding="utf-8")
        (self.root / "secret.txt").write_text(NOT_A_KEY + "\n", encoding="utf-8")
        self.scratch_tmp = tempfile.TemporaryDirectory()
        self.scratch = Path(self.scratch_tmp.name)
        (self.scratch / "plan.md").write_text("notes\n", encoding="utf-8")
        (self.scratch / "data.bin").write_bytes(b"\x00")
        self.payload = {
            "session_id": SESSION,
            "hook_event_name": "PreCompact",
            "trigger": "auto",
            "scratchpad_dir": str(self.scratch),
        }

    def tearDown(self):
        self.scratch_tmp.cleanup()
        self.tmp.cleanup()

    def snapshot(self):
        return (self.root / ".claude" / "sleep" / "snapshot.md").read_text(encoding="utf-8")

    def test_consolidate_writes_the_state_and_prints_the_instructions(self):
        done = hook(self.root, "consolidate", self.payload)
        self.assertEqual(done.returncode, 0, done.stderr)
        text = self.snapshot()
        self.assertIn(f"- Session: {SESSION}", text)
        self.assertIn("- Trigger: auto", text)
        self.assertIn("- Branch: `work` at", text)
        self.assertIn("?? dirty.ts", text)
        self.assertIn("`progress/2026-11-07.md`, 2 entries; last: `## 2026-11-07 — The newest entry`", text)
        self.assertIn("    plan.md", text)
        self.assertNotIn("data.bin", text)
        # The instructions go to the summariser, under the harness's limit, and point at the file.
        self.assertIn(".claude/sleep/snapshot.md", done.stdout)
        self.assertIn("Standing rules Joshua set", done.stdout)
        self.assertLess(len(done.stdout), 10_000)
        self.assertNotIn("claude.ai", text)

    def test_the_snapshot_never_copies_a_file_s_contents(self):
        hook(self.root, "consolidate", self.payload)
        self.assertIn("?? secret.txt", self.snapshot())  # by name only
        self.assertNotIn(NOT_A_KEY, self.snapshot())

    def test_commits_not_on_main_are_listed_when_a_remote_main_exists(self):
        git(self.root, "update-ref", "refs/remotes/origin/main", "main")
        hook(self.root, "consolidate", self.payload)
        text = self.snapshot()
        self.assertIn("- Against origin/main: 1 commit(s) ahead, 0 behind", text)
        self.assertIn("a commit on the branch", text)

    def test_wake_after_compaction_reads_the_snapshot_back(self):
        hook(self.root, "consolidate", self.payload)
        done = hook(self.root, "wake", {"session_id": SESSION, "hook_event_name": "SessionStart", "source": "compact"})
        self.assertEqual(done.returncode, 0, done.stderr)
        out = json.loads(done.stdout)
        context = out["hookSpecificOutput"]["additionalContext"]
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "SessionStart")
        self.assertIn("Context was compacted", context)
        self.assertIn("- Branch: `work` at", context)
        self.assertIn("?? dirty.ts", context)
        self.assertNotIn("WARNING", context)

    def test_wake_warns_when_the_branch_moved_since_the_snapshot(self):
        hook(self.root, "consolidate", self.payload)
        git(self.root, "checkout", "-q", "main")
        done = hook(self.root, "wake", {"source": "compact"})
        context = json.loads(done.stdout)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("WARNING: the branch was `work` at the snapshot and is `main` now", context)

    def test_wake_without_a_snapshot_says_so(self):
        done = hook(self.root, "wake", {"source": "compact"})
        self.assertEqual(done.returncode, 0, done.stderr)
        context = json.loads(done.stdout)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("no consolidation snapshot was found", context)

    def test_wake_at_startup_points_at_the_newest_progress_file(self):
        for source in ("startup", "resume"):
            done = hook(self.root, "wake", {"source": source})
            self.assertEqual(done.returncode, 0, done.stderr)
            context = json.loads(done.stdout)["hookSpecificOutput"]["additionalContext"]
            self.assertIn(f"Session {source}", context)
            self.assertIn("`progress/2026-11-07.md` (2 entries; last: `## 2026-11-07 — The newest entry`)", context)
            self.assertIn("Branch `work`, 2 uncommitted change(s)", context)

    def test_runs_without_input_and_refuses_a_wrong_mode(self):
        done = subprocess.run(
            [sys.executable, "-I", str(SCRIPT), "wake", "--root", str(self.root)],
            input="", capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("Session startup", json.loads(done.stdout)["hookSpecificOutput"]["additionalContext"])
        bad = subprocess.run([sys.executable, "-I", str(SCRIPT), "sleep"], input="", capture_output=True, text=True)
        self.assertEqual(bad.returncode, 2)

    def test_the_settings_file_wires_both_hooks_to_this_script(self):
        settings = json.loads((SCRIPT.parent.parent.parent / ".claude" / "settings.json").read_text(encoding="utf-8"))
        pre = settings["hooks"]["PreCompact"][0]["hooks"][0]["command"]
        start = settings["hooks"]["SessionStart"][0]
        self.assertIn("scripts/sleep/snapshot.py\" consolidate", pre)
        self.assertEqual(start["matcher"], "startup|resume|compact")
        self.assertIn("scripts/sleep/snapshot.py\" wake", start["hooks"][0]["command"])


if __name__ == "__main__":
    unittest.main(verbosity=1)
