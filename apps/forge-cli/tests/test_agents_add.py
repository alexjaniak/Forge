import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from click.testing import CliRunner

from forge_cli.agents import add


class AddCommandTests(unittest.TestCase):
    def test_add_preserves_template_repo_in_staged_job(self):
        repo_root = Path(__file__).resolve().parents[3]
        template = json.loads((repo_root / "templates" / "worker.json").read_text(encoding="utf-8"))

        with tempfile.TemporaryDirectory() as tmpdir:
            cron_path = Path(tmpdir) / "cron-jobs.json"

            runner = CliRunner()
            with patch("forge_cli.agents.cron_jobs_path", return_value=str(cron_path)):
                result = runner.invoke(add, ["worker"])

            self.assertEqual(result.exit_code, 0, result.output)

            staged = json.loads(cron_path.read_text(encoding="utf-8"))
            self.assertEqual(
                staged,
                {
                    "stagger": True,
                    "jobs": [
                        {
                            "id": "worker-01",
                            "interval": template["interval"],
                            "prompt": template["prompt"],
                            "contexts": template["contexts"],
                            "repo": template["repo"],
                        }
                    ],
                },
            )


if __name__ == "__main__":
    unittest.main()
