import argparse
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("manage.py")
SPEC = importlib.util.spec_from_file_location("agent_kernel_cron_manage", MODULE_PATH)
manage = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(manage)


class ManageRepoValidationTests(unittest.TestCase):
    def test_add_requires_non_empty_repo(self):
        args = argparse.Namespace(
            id="worker-01",
            interval="5m",
            prompt="run",
            context=[],
            repo="   ",
            runtime="claude",
            model="",
        )

        stderr = io.StringIO()
        with redirect_stderr(stderr), self.assertRaises(SystemExit) as exc:
            manage.cmd_add(args)

        self.assertEqual(exc.exception.code, 1)
        self.assertIn("job 'worker-01' requires a non-empty repo", stderr.getvalue())

    def test_apply_rejects_job_without_repo(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            jobs_file = Path(tmpdir) / "cron-jobs.json"
            jobs_file.write_text(json.dumps({
                "jobs": [
                    {
                        "id": "worker-01",
                        "interval": "5m",
                        "prompt": "run",
                    }
                ]
            }))

            stderr = io.StringIO()
            with (
                patch.object(manage, "JOBS_FILE", str(jobs_file)),
                patch.object(manage, "load_state", return_value={"jobs": {}, "last_applied": None}),
                patch.object(manage, "read_crontab", return_value=""),
                patch.object(manage, "write_crontab") as write_crontab,
                patch.object(manage, "save_state") as save_state,
                redirect_stderr(stderr),
                self.assertRaises(SystemExit) as exc,
            ):
                manage.cmd_apply(argparse.Namespace())

            self.assertEqual(exc.exception.code, 1)
            self.assertIn("job 'worker-01' requires a non-empty repo", stderr.getvalue())
            write_crontab.assert_not_called()
            save_state.assert_not_called()


if __name__ == "__main__":
    unittest.main()
