import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from forge_cli.webhook import _load_config
from forge_cli.webhook_server import config


class WebhookConfigTests(unittest.TestCase):
    def test_get_config_resolves_repo_local_relative_paths(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            config_dir = repo_root / "apps" / "forge-cli"
            config_dir.mkdir(parents=True)
            config_path = config_dir / "config.toml"
            config_path.write_text(
                "\n".join(
                    [
                        "[webhook]",
                        'secret = "repo-secret"',
                        'events_file = "./events.jsonl"',
                        "",
                        "[trigger]",
                        'rules_file = "./trigger-rules.json"',
                        "",
                        "[repo]",
                        f'dir = "{repo_root}"',
                        "",
                    ]
                )
            )

            with patch("forge_cli.webhook_server.config.Path.cwd", return_value=repo_root), patch(
                "forge_cli.webhook_server.config._repo_root",
                return_value=repo_root,
            ), patch.dict("os.environ", {}, clear=True):
                resolved = config.get_config()

            self.assertEqual(resolved["secret"], "repo-secret")
            self.assertEqual(Path(resolved["events_file"]), (config_dir / "events.jsonl").resolve())
            self.assertEqual(
                Path(resolved["trigger_rules_file"]),
                (config_dir / "trigger-rules.json").resolve(),
            )
            self.assertEqual(resolved["repo_dir"], str(repo_root))

    def test_get_config_uses_bundled_assets_when_repo_config_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cwd = Path(tmpdir)

            with patch("forge_cli.webhook_server.config.Path.cwd", return_value=cwd), patch(
                "forge_cli.webhook_server.config._repo_root",
                return_value=None,
            ), patch.dict(
                "os.environ",
                {"FORGE_WEBHOOK_SECRET": "env-secret"},
                clear=True,
            ):
                resolved = config.get_config()

            self.assertEqual(resolved["secret"], "env-secret")
            self.assertEqual(Path(resolved["events_file"]), (cwd / "events.jsonl").resolve())
            self.assertTrue(resolved["trigger_rules_file"].endswith("trigger-rules.json"))
            self.assertTrue(Path(resolved["trigger_rules_file"]).is_file())

    def test_wrapper_load_config_uses_shared_repo_local_lookup(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            config_dir = repo_root / "apps" / "forge-cli"
            config_dir.mkdir(parents=True)
            (config_dir / "config.toml").write_text(
                "\n".join(
                    [
                        "[webhook]",
                        'secret = "shared-secret"',
                        "",
                        "[repo]",
                        'name = "owner/repo"',
                        "",
                    ]
                )
            )

            with patch("forge_cli.webhook_server.config.Path.cwd", return_value=repo_root), patch(
                "forge_cli.webhook_server.config._repo_root",
                return_value=repo_root,
            ), patch.dict("os.environ", {}, clear=True):
                repo, secret = _load_config()

            self.assertEqual(repo, "owner/repo")
            self.assertEqual(secret, "shared-secret")


if __name__ == "__main__":
    unittest.main()
