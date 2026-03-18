import json
from pathlib import Path

from click.testing import CliRunner

from forge_cli.list_cmd import list_cmd


class _FakeManage:
    def __init__(self, jobs_file: Path, active_jobs: dict):
        self.JOBS_FILE = str(jobs_file)
        self._active_jobs = active_jobs

    def load_state(self):
        return {"jobs": self._active_jobs}

    def compute_next_run(self, last_run, interval):
        return None


def test_status_shows_locked_issue_and_ignores_malformed_lock(tmp_path, monkeypatch):
    jobs_file = tmp_path / "agent-kernel" / "cron" / "cron-jobs.json"
    jobs_file.parent.mkdir(parents=True)
    jobs_file.write_text(
        json.dumps(
            {
                "jobs": [
                    {"id": "worker-01", "interval": "5m"},
                    {"id": "worker-02", "interval": "10m"},
                ]
            }
        )
    )

    locks_dir = tmp_path / "locks" / "issues"
    (locks_dir / "892.lock").mkdir(parents=True)
    (locks_dir / "892.lock" / "info.json").write_text(
        json.dumps({"agent": "worker-01", "pid": 123, "claimed_at": "2026-03-18T00:00:00Z"})
    )
    (locks_dir / "893.lock").mkdir()
    (locks_dir / "893.lock" / "info.json").write_text("{not-json")

    active_jobs = {
        "worker-01": {"interval": "5m"},
        "worker-02": {"interval": "10m"},
    }
    manage = _FakeManage(jobs_file, active_jobs)

    monkeypatch.setattr("forge_cli.list_cmd._get_manage", lambda: manage)
    monkeypatch.setattr("forge_cli.list_cmd.common_repo_root", lambda: str(tmp_path))

    result = CliRunner().invoke(list_cmd)

    assert result.exit_code == 0
    assert "worker-01" in result.output
    assert "(issue #892)" in result.output
    assert "worker-02" in result.output
    assert "(issue #893)" not in result.output
