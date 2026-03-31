import os
import pathlib
import subprocess
import tempfile
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
RUN_SH = REPO_ROOT / "agent-kernel" / "run.sh"


class RunWorkspaceLockTests(unittest.TestCase):
    def git(self, *args, cwd):
        return subprocess.run(
            ["git", *args],
            cwd=cwd,
            check=True,
            text=True,
            capture_output=True,
        )

    def test_active_workspace_lock_skips_before_resetting_existing_worktree(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = pathlib.Path(tmpdir)
            remote_repo = tmp / "remote.git"
            seed_repo = tmp / "seed"
            work_repo = tmp / "work"
            worktree_dir = work_repo / ".worktrees" / "worker-01"

            self.git("init", "--bare", "--initial-branch=main", str(remote_repo), cwd=tmp)

            seed_repo.mkdir()
            self.git("init", "--initial-branch=main", cwd=seed_repo)
            self.git("config", "user.name", "Test User", cwd=seed_repo)
            self.git("config", "user.email", "test@example.com", cwd=seed_repo)
            (seed_repo / "tracked.txt").write_text("base\n")
            self.git("add", "tracked.txt", cwd=seed_repo)
            self.git("commit", "-m", "seed", cwd=seed_repo)
            self.git("remote", "add", "origin", str(remote_repo), cwd=seed_repo)
            self.git("push", "-u", "origin", "main", cwd=seed_repo)

            self.git("clone", str(remote_repo), str(work_repo), cwd=tmp)
            self.git("worktree", "add", str(worktree_dir), "--detach", "main", cwd=work_repo)
            self.git("checkout", "-b", "worker-01/in-progress", cwd=worktree_dir)

            tracked_file = worktree_dir / "tracked.txt"
            tracked_file.write_text("modified\n")
            untracked_file = worktree_dir / "untracked.txt"
            untracked_file.write_text("keep me\n")
            lock_file = worktree_dir / ".agent.lock"
            lock_file.write_text(f"{os.getpid()}\n")

            result = subprocess.run(
                [str(RUN_SH), "--workspace", "worker-01", "--repo", str(work_repo), "noop"],
                text=True,
                capture_output=True,
                env=os.environ.copy(),
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(tracked_file.read_text(), "modified\n")
            self.assertTrue(untracked_file.exists())
            branch = self.git("branch", "--show-current", cwd=worktree_dir).stdout.strip()
            self.assertEqual(branch, "worker-01/in-progress")


if __name__ == "__main__":
    unittest.main()
