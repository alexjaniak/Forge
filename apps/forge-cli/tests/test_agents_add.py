import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from click.testing import CliRunner

from forge_cli.agents import add


class AddCommandTests(unittest.TestCase):
    def _write_template(self, directory, name, data):
        path = directory / name
        path.write_text(json.dumps(data), encoding="utf-8")
        return path

    def _invoke_add(self, repo_root, *args):
        cron_dir = repo_root / "agent-kernel" / "cron"
        cron_dir.mkdir(parents=True, exist_ok=True)
        cron_path = cron_dir / "cron-jobs.json"
        runner = CliRunner()
        with patch("forge_cli.agents.repo_root", return_value=str(repo_root)):
            with patch("forge_cli.agents.cron_jobs_path", return_value=str(cron_path)):
                result = runner.invoke(add, list(args))
        return result, cron_path

    def test_add_prefers_local_json_template_over_example(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            templates_dir = repo_root / "templates"
            templates_dir.mkdir(parents=True)
            self._write_template(
                templates_dir,
                "worker.example.json",
                {
                    "interval": "2m",
                    "prompt": "from example",
                    "contexts": ["contexts/EXAMPLE.md"],
                    "agentic": True,
                    "workspace": True,
                    "model": "gpt-5.4",
                    "repo": "github.com/example/repo",
                },
            )
            self._write_template(
                templates_dir,
                "worker.json",
                {
                    "interval": "7m",
                    "prompt": "from local",
                    "contexts": ["contexts/LOCAL.md"],
                    "agentic": False,
                    "workspace": False,
                    "model": "o3",
                    "repo": "github.com/local/repo",
                },
            )

            result, cron_path = self._invoke_add(repo_root, "worker")

            self.assertEqual(result.exit_code, 0, result.output)
            staged = json.loads(cron_path.read_text(encoding="utf-8"))
            self.assertEqual(
                staged,
                {
                    "stagger": True,
                    "jobs": [
                        {
                            "id": "worker-01",
                            "interval": "7m",
                            "prompt": "from local",
                            "contexts": ["contexts/LOCAL.md"],
                            "agentic": False,
                            "workspace": False,
                            "model": "o3",
                            "repo": "github.com/local/repo",
                        }
                    ],
                },
            )

    def test_add_falls_back_to_example_template_when_local_file_absent(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            templates_dir = repo_root / "templates"
            templates_dir.mkdir(parents=True)
            self._write_template(
                templates_dir,
                "worker.example.json",
                {
                    "interval": "3m",
                    "prompt": "from example only",
                    "contexts": ["contexts/EXAMPLE.md"],
                    "agentic": True,
                    "workspace": True,
                    "model": "gpt-5.4",
                    "repo": "github.com/example/repo",
                },
            )

            result, cron_path = self._invoke_add(repo_root, "worker")

            self.assertEqual(result.exit_code, 0, result.output)
            staged = json.loads(cron_path.read_text(encoding="utf-8"))
            self.assertEqual(staged["jobs"][0]["prompt"], "from example only")
            self.assertEqual(staged["jobs"][0]["interval"], "3m")
            self.assertEqual(staged["jobs"][0]["model"], "gpt-5.4")

    def test_add_uses_template_model_by_default_and_allows_override(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            templates_dir = repo_root / "templates"
            templates_dir.mkdir(parents=True)
            self._write_template(
                templates_dir,
                "worker.example.json",
                {
                    "interval": "2m",
                    "prompt": "template prompt",
                    "contexts": [],
                    "agentic": True,
                    "workspace": True,
                    "model": "gpt-5.4",
                    "repo": "github.com/example/repo",
                },
            )

            default_result, cron_path = self._invoke_add(repo_root, "worker")
            self.assertEqual(default_result.exit_code, 0, default_result.output)
            staged = json.loads(cron_path.read_text(encoding="utf-8"))
            self.assertEqual(staged["jobs"][0]["model"], "gpt-5.4")

            override_result, override_cron_path = self._invoke_add(
                repo_root,
                "--model",
                "claude-sonnet-4",
                "worker",
            )
            self.assertEqual(override_result.exit_code, 0, override_result.output)
            override_staged = json.loads(override_cron_path.read_text(encoding="utf-8"))
            self.assertEqual(override_staged["jobs"][-1]["model"], "claude-sonnet-4")


if __name__ == "__main__":
    unittest.main()
