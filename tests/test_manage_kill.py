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
    def test_workspace_lock_path_uses_repo_backed_and_self_repo_layouts(self):
        with patch.object(manage, "REPO_DIR", "/tmp/forge"):
            self.assertEqual(
                manage._workspace_lock_path("worker-02", "github.com/alexjaniak/Forge"),
                "/tmp/forge/.repos/github.com/alexjaniak/Forge/.worktrees/worker-02/.agent.lock",
            )
            self.assertEqual(
                manage._workspace_lock_path("worker-03"),
                "/tmp/forge/.worktrees/worker-03/.agent.lock",
            )

    def test_parse_run_command_extracts_workspace_and_repo(self):
        command = (
            "/bin/bash /tmp/forge/agent-kernel/run.sh --agentic "
            "--workspace worker-02 --repo github.com/alexjaniak/Forge 'do work'"
        )

        parsed = manage._parse_run_command(command)

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["workspace_id"], "worker-02")
        self.assertEqual(parsed["repo"], "github.com/alexjaniak/Forge")

    def test_find_managed_runs_resolves_repo_backed_and_self_repo_lockfiles(self):
        jobs = [
            {"id": "worker-02", "repo": "github.com/alexjaniak/Forge", "workspace": True},
            {"id": "worker-03", "repo": "", "workspace": True},
            {"id": "worker-04", "repo": "github.com/alexjaniak/Other", "workspace": True},
        ]

        with patch.object(manage, "REPO_DIR", "/tmp/forge"), patch.object(
            manage, "_load_managed_jobs", return_value=jobs
        ), patch.object(
            manage,
            "_read_lock_pid",
            side_effect=lambda path: {
                "/tmp/forge/.repos/github.com/alexjaniak/Forge/.worktrees/worker-02/.agent.lock": 101,
                "/tmp/forge/.worktrees/worker-03/.agent.lock": 102,
                "/tmp/forge/.repos/github.com/alexjaniak/Other/.worktrees/worker-04/.agent.lock": 103,
            }.get(path),
        ), patch.object(
            manage,
            "_read_process_command",
            side_effect=lambda pid: {
                101: (
                    "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 "
                    "--repo github.com/alexjaniak/Forge 'prompt'"
                ),
                102: "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-03 'prompt'",
                103: (
                    "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-04 "
                    "--repo github.com/alexjaniak/Wrong 'prompt'"
                ),
            }.get(pid),
        ):
            runs = manage.find_managed_runs()

        self.assertEqual(
            runs,
            [
                {
                    "agent_id": "worker-02",
                    "pid": 101,
                    "command": (
                        "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 "
                        "--repo github.com/alexjaniak/Forge 'prompt'"
                    ),
                },
                {
                    "agent_id": "worker-03",
                    "pid": 102,
                    "command": "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-03 'prompt'",
                },
            ],
        )

    def test_find_managed_runs_only_checks_jobs_from_cron_config(self):
        with patch.object(manage, "_load_managed_jobs", return_value=[]), patch.object(
            manage, "_read_lock_pid"
        ) as read_lock_pid, patch.object(manage, "_read_process_command") as read_process_command:
            runs = manage.find_managed_runs()

        self.assertEqual(runs, [])
        read_lock_pid.assert_not_called()
        read_process_command.assert_not_called()

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
