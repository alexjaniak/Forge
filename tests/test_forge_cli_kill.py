import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from click.testing import CliRunner


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
CLI_SRC = REPO_ROOT / "apps" / "forge-cli" / "src"
if str(CLI_SRC) not in sys.path:
    sys.path.insert(0, str(CLI_SRC))

from forge_cli.cli import main


class ForgeCliKillTests(unittest.TestCase):
    def test_kill_dispatches_agent_id_to_backend(self):
        runner = CliRunner()

        with patch("forge_cli.kill_cmd._get_manage") as get_manage:
            result = runner.invoke(main, ["kill", "worker-02"])

        self.assertEqual(result.exit_code, 0)
        get_manage.return_value.cmd_kill.assert_called_once_with(
            SimpleNamespace(id="worker-02", all=False)
        )

    def test_kill_all_dispatches_bulk_flag_to_backend(self):
        runner = CliRunner()

        with patch("forge_cli.kill_cmd._get_manage") as get_manage:
            result = runner.invoke(main, ["kill", "--all"])

        self.assertEqual(result.exit_code, 0)
        get_manage.return_value.cmd_kill.assert_called_once_with(
            SimpleNamespace(id=None, all=True)
        )

    def test_kill_requires_agent_id_or_all(self):
        runner = CliRunner()

        result = runner.invoke(main, ["kill"])

        self.assertEqual(result.exit_code, 2)
        self.assertIn("kill requires exactly one of: <agent-id> or --all", result.output)

    def test_kill_rejects_agent_id_with_all(self):
        runner = CliRunner()

        result = runner.invoke(main, ["kill", "worker-02", "--all"])

        self.assertEqual(result.exit_code, 2)
        self.assertIn("kill requires exactly one of: <agent-id> or --all", result.output)


if __name__ == "__main__":
    unittest.main()
