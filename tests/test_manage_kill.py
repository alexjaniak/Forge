import importlib.util
import io
import pathlib
import unittest
from types import SimpleNamespace
from unittest.mock import mock_open, patch


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
MANAGE_PATH = REPO_ROOT / "agent-kernel" / "cron" / "manage.py"

spec = importlib.util.spec_from_file_location("forge_manage_test", MANAGE_PATH)
manage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manage)


class ManageKillTests(unittest.TestCase):
    def test_configured_workspace_jobs_use_cron_jobs_file_not_persisted_state(self):
        cron_jobs = {
            "jobs": [
                {"id": "worker-02", "workspace": True, "repo": "github.com/alexjaniak/Forge"},
                {"id": "worker-03", "workspace": True, "repo": "repos/demo"},
                {"id": "worker-04", "workspace": False, "repo": "github.com/acme/skip"},
            ]
        }

        with patch.object(manage.os.path, "exists", return_value=True), patch(
            "builtins.open", mock_open(read_data=manage.json.dumps(cron_jobs))
        ), patch.object(
            manage, "load_state", side_effect=AssertionError("should not read persisted state")
        ):
            jobs = manage._configured_workspace_jobs()

        self.assertEqual(
            jobs,
            [
                ("worker-02", "github.com/alexjaniak/Forge"),
                ("worker-03", "repos/demo"),
            ],
        )

    def test_workspace_lock_path_uses_target_repo_root(self):
        with patch.object(manage, "REPO_DIR", "/tmp/forge"):
            lock_path = manage._workspace_lock_path(
                "worker-02", "github.com/alexjaniak/Forge"
            )

        self.assertEqual(
            lock_path,
            "/tmp/forge/.repos/github.com/alexjaniak/Forge/.worktrees/worker-02/.agent.lock",
        )

    def test_workspace_lock_path_resolves_relative_target_repo_from_forge_root(self):
        with patch.object(manage, "REPO_DIR", "/tmp/forge"):
            lock_path = manage._workspace_lock_path("worker-02", "repos/demo")

        self.assertEqual(
            lock_path,
            "/tmp/forge/repos/demo/.worktrees/worker-02/.agent.lock",
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
            manage, "_configured_workspace_jobs", return_value=[]
        ), patch.object(
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

    def test_find_managed_runs_uses_configured_repo_root_for_targeted_kill(self):
        cron_jobs = {
            "jobs": [
                {"id": "worker-02", "workspace": True, "repo": "github.com/alexjaniak/Forge"}
            ]
        }

        with patch.object(manage, "REPO_DIR", "/tmp/forge"), patch.object(
            manage.os.path, "exists", return_value=True
        ), patch(
            "builtins.open", mock_open(read_data=manage.json.dumps(cron_jobs))
        ), patch.object(
            manage,
            "_read_lock_pid",
            side_effect=lambda path: {
                "/tmp/forge/.repos/github.com/alexjaniak/Forge/.worktrees/worker-02/.agent.lock": 101,
            }.get(path),
        ), patch.object(
            manage,
            "_read_process_command",
            return_value="/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 --repo github.com/alexjaniak/Forge 'prompt'",
        ):
            runs = manage.find_managed_runs(agent_id="worker-02")

        self.assertEqual(
            runs,
            [
                {
                    "agent_id": "worker-02",
                    "pid": 101,
                    "command": "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 --repo github.com/alexjaniak/Forge 'prompt'",
                }
            ],
        )

    def test_find_managed_runs_uses_relative_configured_repo_root_for_targeted_kill(self):
        cron_jobs = {
            "jobs": [
                {"id": "worker-02", "workspace": True, "repo": "repos/demo"}
            ]
        }

        with patch.object(manage, "REPO_DIR", "/tmp/forge"), patch.object(
            manage.os.path, "exists", return_value=True
        ), patch(
            "builtins.open", mock_open(read_data=manage.json.dumps(cron_jobs))
        ), patch.object(
            manage,
            "_read_lock_pid",
            side_effect=lambda path: {
                "/tmp/forge/repos/demo/.worktrees/worker-02/.agent.lock": 101,
            }.get(path),
        ), patch.object(
            manage,
            "_read_process_command",
            return_value="/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 --repo repos/demo 'prompt'",
        ):
            runs = manage.find_managed_runs(agent_id="worker-02")

        self.assertEqual(
            runs,
            [
                {
                    "agent_id": "worker-02",
                    "pid": 101,
                    "command": "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 --repo repos/demo 'prompt'",
                }
            ],
        )

    def test_find_managed_runs_scans_configured_repo_roots_for_bulk_kill(self):
        cron_jobs = {
            "jobs": [
                {"id": "worker-02", "workspace": True, "repo": "github.com/alexjaniak/Forge"},
                {"id": "worker-03", "workspace": True, "repo": "/tmp/other-repo"},
                {"id": "worker-04", "workspace": True, "repo": "repos/demo"},
            ]
        }

        with patch.object(manage, "REPO_DIR", "/tmp/forge"), patch.object(
            manage.os.path, "exists", return_value=True
        ), patch(
            "builtins.open", mock_open(read_data=manage.json.dumps(cron_jobs))
        ), patch.object(
            manage,
            "_read_lock_pid",
            side_effect=lambda path: {
                "/tmp/forge/.repos/github.com/alexjaniak/Forge/.worktrees/worker-02/.agent.lock": 101,
                "/tmp/other-repo/.worktrees/worker-03/.agent.lock": 202,
                "/tmp/forge/repos/demo/.worktrees/worker-04/.agent.lock": 303,
            }.get(path),
        ), patch.object(
            manage,
            "_read_process_command",
            side_effect=lambda pid: {
                101: "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 --repo github.com/alexjaniak/Forge 'prompt'",
                202: "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-03 --repo /tmp/other-repo 'prompt'",
                303: "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-04 --repo repos/demo 'prompt'",
            }.get(pid),
        ):
            runs = manage.find_managed_runs()

        self.assertEqual(
            runs,
            [
                {
                    "agent_id": "worker-02",
                    "pid": 101,
                    "command": "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 --repo github.com/alexjaniak/Forge 'prompt'",
                },
                {
                    "agent_id": "worker-03",
                    "pid": 202,
                    "command": "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-03 --repo /tmp/other-repo 'prompt'",
                },
                {
                    "agent_id": "worker-04",
                    "pid": 303,
                    "command": "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-04 --repo repos/demo 'prompt'",
                },
            ],
        )

    def test_find_managed_runs_uses_union_of_configured_and_discovered_workspaces(self):
        cron_jobs = {
            "jobs": [
                {"id": "worker-02", "workspace": True, "repo": "github.com/alexjaniak/Forge"}
            ]
        }

        with patch.object(manage, "REPO_DIR", "/tmp/forge"), patch.object(
            manage.os.path, "exists", return_value=True
        ), patch(
            "builtins.open", mock_open(read_data=manage.json.dumps(cron_jobs))
        ), patch.object(
            manage,
            "_list_workspace_ids",
            side_effect=lambda repo="": {
                "": ["worker-03"],
                "github.com/alexjaniak/Forge": ["worker-02"],
            }.get(repo, []),
        ), patch.object(
            manage,
            "_read_lock_pid",
            side_effect=lambda path: {
                "/tmp/forge/.repos/github.com/alexjaniak/Forge/.worktrees/worker-02/.agent.lock": 101,
                "/tmp/forge/.worktrees/worker-03/.agent.lock": 303,
            }.get(path),
        ), patch.object(
            manage,
            "_read_process_command",
            side_effect=lambda pid: {
                101: "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 --repo github.com/alexjaniak/Forge 'prompt'",
                303: "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-03 'prompt'",
            }.get(pid),
        ):
            runs = manage.find_managed_runs()

        self.assertEqual(
            runs,
            [
                {
                    "agent_id": "worker-02",
                    "pid": 101,
                    "command": "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 --repo github.com/alexjaniak/Forge 'prompt'",
                },
                {
                    "agent_id": "worker-03",
                    "pid": 303,
                    "command": "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-03 'prompt'",
                },
            ],
        )

    def test_find_managed_runs_rejects_reused_pid_from_other_checkout(self):
        with patch.object(manage, "REPO_DIR", "/tmp/forge"), patch.object(
            manage, "_configured_workspace_jobs", return_value=[]
        ), patch.object(
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

    def test_find_managed_runs_rejects_repo_mismatch_for_same_workspace_id(self):
        cron_jobs = {
            "jobs": [
                {"id": "worker-02", "workspace": True, "repo": "github.com/acme/one"}
            ]
        }

        with patch.object(manage, "REPO_DIR", "/tmp/forge"), patch.object(
            manage.os.path, "exists", return_value=True
        ), patch(
            "builtins.open", mock_open(read_data=manage.json.dumps(cron_jobs))
        ), patch.object(
            manage,
            "_read_lock_pid",
            return_value=101,
        ), patch.object(
            manage,
            "_read_process_command",
            return_value="/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 --repo github.com/acme/two 'prompt'",
        ):
            runs = manage.find_managed_runs()

        self.assertEqual(runs, [])

    def test_find_managed_runs_targeted_kill_scans_all_configured_repos_without_state_entry(self):
        cron_jobs = {
            "jobs": [
                {"id": "worker-03", "workspace": True, "repo": "github.com/alexjaniak/Forge"},
                {"id": "worker-04", "workspace": True, "repo": "repos/demo"},
            ]
        }

        with patch.object(manage, "REPO_DIR", "/tmp/forge"), patch.object(
            manage.os.path, "exists", return_value=True
        ), patch(
            "builtins.open", mock_open(read_data=manage.json.dumps(cron_jobs))
        ), patch.object(
            manage,
            "_read_lock_pid",
            side_effect=lambda path: {
                "/tmp/forge/.repos/github.com/alexjaniak/Forge/.worktrees/worker-02/.agent.lock": None,
                "/tmp/forge/repos/demo/.worktrees/worker-02/.agent.lock": 101,
                "/tmp/forge/.worktrees/worker-02/.agent.lock": None,
            }.get(path),
        ), patch.object(
            manage,
            "_read_process_command",
            return_value="/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 --repo repos/demo 'prompt'",
        ):
            runs = manage.find_managed_runs(agent_id="worker-02")

        self.assertEqual(
            runs,
            [
                {
                    "agent_id": "worker-02",
                    "pid": 101,
                    "command": "/bin/bash /tmp/forge/agent-kernel/run.sh --workspace worker-02 --repo repos/demo 'prompt'",
                }
            ],
        )

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

    def test_terminate_pid_treats_missing_process_during_term_as_exited(self):
        with patch.object(manage, "os") as os_module:
            os_module.kill.side_effect = ProcessLookupError

            signal_used = manage._terminate_pid(101)

        self.assertEqual(signal_used, "SIGTERM")

    def test_terminate_pid_treats_missing_process_during_kill_as_exited(self):
        with patch.object(manage, "_pid_is_alive", return_value=True), patch.object(
            manage, "time"
        ) as time_module, patch.object(
            manage, "os"
        ) as os_module:
            time_module.time.side_effect = [0.0, 0.0, 3.0]
            time_module.sleep.return_value = None
            os_module.kill.side_effect = [None, ProcessLookupError]

            signal_used = manage._terminate_pid(101)

        self.assertEqual(signal_used, "SIGTERM")

    def test_cmd_kill_prints_specific_no_match_message(self):
        with patch.object(manage, "kill_managed_runs", return_value=[]), patch(
            "sys.stdout", new_callable=io.StringIO
        ) as stdout:
            manage.cmd_kill(SimpleNamespace(id="worker-02", all=False))

        self.assertEqual(stdout.getvalue().strip(), "No running managed agent found for 'worker-02'")


if __name__ == "__main__":
    unittest.main()
