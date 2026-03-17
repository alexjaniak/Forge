import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from forge_webhook.trigger import _is_agent_running


class TriggerLockfileTests(unittest.TestCase):
    def test_is_agent_running_uses_repo_worktree_lockfile(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            lockfile = Path(tmpdir) / ".worktrees" / "worker-01" / ".agent.lock"
            lockfile.parent.mkdir(parents=True)
            lockfile.write_text(f"{os.getpid()}\n")

            self.assertTrue(_is_agent_running(tmpdir, "worker-01"))

    def test_is_agent_running_returns_false_for_stale_or_malformed_lockfiles(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            stale_lockfile = Path(tmpdir) / ".worktrees" / "stale-worker" / ".agent.lock"
            stale_lockfile.parent.mkdir(parents=True)
            stale_lockfile.write_text("999999\n")

            malformed_lockfile = Path(tmpdir) / ".worktrees" / "bad-worker" / ".agent.lock"
            malformed_lockfile.parent.mkdir(parents=True)
            malformed_lockfile.write_text("not-a-pid\n")

            self.assertFalse(_is_agent_running(tmpdir, "stale-worker"))
            self.assertFalse(_is_agent_running(tmpdir, "bad-worker"))


if __name__ == "__main__":
    unittest.main()
