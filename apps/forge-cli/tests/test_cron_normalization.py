import unittest
from unittest.mock import patch

from click.testing import CliRunner

from forge_cli.diff_cmd import diff_cmd
from forge_cli.reset_cmd import _jobs_match, reset_cmd


class CronNormalizationTests(unittest.TestCase):
    def test_jobs_match_normalizes_optional_fields(self):
        staged_job = {
            "id": "agent-1",
            "interval": "5m",
            "prompt": "Test prompt",
            "contexts": [],
            "agentic": False,
            "workspace": False,
        }
        applied_job = {
            "interval": "5m",
            "prompt": "Test prompt",
            "contexts": [],
            "agentic": False,
            "workspace": False,
            "repo": "",
            "runtime": "claude",
            "model": "",
        }

        self.assertTrue(_jobs_match(staged_job, applied_job))

    def test_diff_ignores_normalized_optional_field_differences(self):
        manage = type(
            "Manage",
            (),
            {
                "load_state": lambda self: {
                    "jobs": {
                        "agent-1": {
                            "interval": "5m",
                            "prompt": "Test prompt",
                            "contexts": [],
                            "agentic": False,
                            "workspace": False,
                            "repo": "",
                            "runtime": "claude",
                            "model": "",
                            "enabled": True,
                        }
                    }
                }
            },
        )()
        staged_data = {
            "jobs": [
                {
                    "id": "agent-1",
                    "interval": "5m",
                    "prompt": "Test prompt",
                    "contexts": [],
                    "agentic": False,
                    "workspace": False,
                    "enabled": True,
                }
            ]
        }

        runner = CliRunner()
        with patch("forge_cli.diff_cmd._get_manage", return_value=manage), patch(
            "forge_cli.diff_cmd.cron_jobs_path", return_value="/tmp/cron-jobs.json"
        ), patch("forge_cli.diff_cmd.load_cron_jobs", return_value=staged_data):
            result = runner.invoke(diff_cmd)

        self.assertEqual(result.exit_code, 0)
        self.assertIn("Config matches applied state. Nothing to diff.", result.output)

    def test_reset_skips_write_for_normalized_optional_field_differences(self):
        manage = type(
            "Manage",
            (),
            {
                "load_state": lambda self: {
                    "jobs": {
                        "agent-1": {
                            "interval": "5m",
                            "prompt": "Test prompt",
                            "contexts": [],
                            "agentic": False,
                            "workspace": False,
                            "repo": "",
                            "runtime": "claude",
                            "model": "",
                        }
                    }
                }
            },
        )()
        staged_config = {
            "jobs": [
                {
                    "id": "agent-1",
                    "interval": "5m",
                    "prompt": "Test prompt",
                    "contexts": [],
                    "agentic": False,
                    "workspace": False,
                }
            ]
        }

        runner = CliRunner()
        with patch("forge_cli.reset_cmd._get_manage", return_value=manage), patch(
            "forge_cli.reset_cmd.cron_jobs_path", return_value="/tmp/cron-jobs.json"
        ), patch("forge_cli.reset_cmd.load_cron_jobs", return_value=staged_config), patch(
            "forge_cli.reset_cmd.save_cron_jobs"
        ) as save_cron_jobs:
            result = runner.invoke(reset_cmd, ["--yes"])

        self.assertEqual(result.exit_code, 0)
        self.assertIn("Config already matches applied state. Nothing to reset.", result.output)
        save_cron_jobs.assert_not_called()


if __name__ == "__main__":
    unittest.main()
