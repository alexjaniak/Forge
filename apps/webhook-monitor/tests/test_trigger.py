import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from forge_webhook.trigger import _invoke_agent, _is_agent_running


class TriggerTests(unittest.TestCase):
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

    @patch("forge_webhook.trigger.subprocess.Popen")
    def test_invoke_agent_uses_workspace_and_repo_arguments(self, mock_popen) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            rule = {"agent": "worker-01"}
            event = {"event_type": "issues", "number": 937}

            _invoke_agent(tmpdir, rule, event)

            mock_popen.assert_called_once()
            args, kwargs = mock_popen.call_args
            self.assertEqual(
                args[0],
                [
                    str(Path(tmpdir) / "agent-kernel" / "run.sh"),
                    "--workspace",
                    "worker-01",
                    "--repo",
                    tmpdir,
                    "Triggered by issues on issue #937. Find and claim a ready issue, then implement it.",
                ],
            )
            self.assertEqual(kwargs["cwd"], tmpdir)
            self.assertEqual(kwargs["stderr"], subprocess.STDOUT)
            self.assertTrue(kwargs["start_new_session"])

    @patch("forge_webhook.trigger.subprocess.Popen")
    def test_invoke_agent_appends_context_when_present(self, mock_popen) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            rule = {"agent": "planner-01", "context": "triage backlog"}
            event = {"event_type": "issue_comment", "number": 738}

            _invoke_agent(tmpdir, rule, event)

            args, _ = mock_popen.call_args
            self.assertEqual(
                args[0],
                [
                    str(Path(tmpdir) / "agent-kernel" / "run.sh"),
                    "--workspace",
                    "planner-01",
                    "--repo",
                    tmpdir,
                    "--context",
                    "triage backlog",
                    "Review the current state of GitHub issues and PRs. Process any new worker handoff comments. Create new issues or adjust existing ones to progress toward the project goals. Spawn subplanner issues if scope is too large.",
                ],
            )


if __name__ == "__main__":
    unittest.main()
