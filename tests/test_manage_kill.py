import importlib.util
import io
import pathlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
MANAGE_PATH = REPO_ROOT / "agent-kernel" / "cron" / "manage.py"

spec = importlib.util.spec_from_file_location("forge_manage_test", MANAGE_PATH)
manage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manage)


class ManageKillTests(unittest.TestCase):
    def test_parse_run_command_extracts_workspace_and_repo(self):
        command = (
            "/bin/bash /tmp/forge/agent-kernel/run.sh --agentic "
            "--workspace worker-02 --repo github.com/alexjaniak/Forge 'do work'"
        )

        parsed = manage._parse_run_command(command)

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["workspace_id"], "worker-02")
        self.assertEqual(parsed["repo"], "github.com/alexjaniak/Forge")

    def test_matches_managed_run_accepts_absolute_repo_run_path(self):
        command = "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 'prompt'"

        with patch.object(manage, "REPO_DIR", "/tmp/forge"):
            run = manage._matches_managed_run("worker-02", 101, command)

        self.assertEqual(
            run,
            {
                "agent_id": "worker-02",
                "pid": 101,
                "command": command,
            },
        )

    def test_matches_managed_run_requires_repo_cwd_for_relative_run_path(self):
        command = "/bin/bash ./agent-kernel/run.sh --workspace worker-02 'prompt'"

        with patch.object(manage, "REPO_DIR", "/tmp/forge"), patch.object(
            manage, "_read_process_cwd", return_value="/tmp/other"
        ):
            run = manage._matches_managed_run("worker-02", 101, command)

        self.assertIsNone(run)

    def test_find_managed_runs_filters_out_stale_and_non_matching_processes(self):
        with patch.object(manage, "REPO_DIR", "/tmp/forge"), patch.object(
            manage, "_list_workspace_ids", return_value=["worker-02", "worker-03", "worker-04"]
        ), patch.object(
            manage,
            "_read_lock_pid",
            side_effect=lambda path: {
                "/tmp/forge/.worktrees/worker-02/.agent.lock": 101,
                "/tmp/forge/.worktrees/worker-03/.agent.lock": 102,
                "/tmp/forge/.worktrees/worker-04/.agent.lock": 103,
            }.get(path),
        ), patch.object(
            manage,
            "_read_process_command",
            side_effect=lambda pid: {
                101: "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 'prompt'",
                102: "/bin/bash /tmp/other/agent-kernel/run.sh --workspace worker-03 'prompt'",
                103: None,
            }.get(pid),
        ):
            runs = manage.find_managed_runs()

        self.assertEqual(
            runs,
            [
                {
                    "agent_id": "worker-02",
                    "pid": 101,
                    "command": "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 'prompt'",
                }
            ],
        )

    def test_find_managed_runs_rejects_reused_pid_from_other_checkout(self):
        with patch.object(manage, "REPO_DIR", "/tmp/forge"), patch.object(
            manage, "_list_workspace_ids", return_value=["worker-02"]
        ), patch.object(
            manage,
            "_read_lock_pid",
            return_value=101,
        ), patch.object(
            manage,
            "_read_process_command",
            return_value="/bin/bash ./agent-kernel/run.sh --workspace worker-02 'prompt'",
        ), patch.object(
            manage,
            "_read_process_cwd",
            return_value="/tmp/other-checkout",
        ):
            runs = manage.find_managed_runs()

        self.assertEqual(runs, [])

    def test_kill_managed_runs_returns_killed_runs(self):
        runs = [
            {"agent_id": "worker-02", "pid": 101, "command": "cmd-1"},
            {"agent_id": "worker-03", "pid": 202, "command": "cmd-2"},
        ]

        with patch.object(manage, "find_managed_runs", return_value=runs), patch.object(
            manage, "_terminate_pid", side_effect=["SIGTERM", "SIGKILL"]
        ):
            killed = manage.kill_managed_runs()

        self.assertEqual(
            killed,
            [
                {"agent_id": "worker-02", "pid": 101, "command": "cmd-1", "signal": "SIGTERM"},
                {"agent_id": "worker-03", "pid": 202, "command": "cmd-2", "signal": "SIGKILL"},
            ],
        )

    def test_cmd_kill_prints_specific_no_match_message(self):
        with patch.object(manage, "kill_managed_runs", return_value=[]), patch(
            "sys.stdout", new_callable=io.StringIO
        ) as stdout:
            manage.cmd_kill(SimpleNamespace(id="worker-02", all=False))

        self.assertEqual(stdout.getvalue().strip(), "No running managed agent found for 'worker-02'")


if __name__ == "__main__":
    unittest.main()
