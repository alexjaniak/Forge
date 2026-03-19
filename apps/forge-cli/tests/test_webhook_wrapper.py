import importlib
import os
import sys
import types
import unittest
from unittest.mock import call, patch


def _canonical_module(canonical_run):
    canonical_module = types.ModuleType("forge_cli.webhook_server.main")
    canonical_module.app = object()
    canonical_module.run = canonical_run
    return canonical_module


def _load_wrapper_module():
    sys.modules.pop("forge_webhook.main", None)
    return importlib.import_module("forge_webhook.main")



class WebhookWrapperTests(unittest.TestCase):
    def test_wrapper_warns_once_and_marks_delegate_invocation(self):
        observed_marker = None

        def fake_canonical_run():
            nonlocal observed_marker
            observed_marker = os.environ.get("_FORGE_WH_INVOKED")

        with patch.dict(
            sys.modules,
            {"forge_cli.webhook_server.main": _canonical_module(fake_canonical_run)},
            clear=False,
        ):
            module = _load_wrapper_module()
            with patch.dict(os.environ, {}, clear=True), patch("sys.stderr") as stderr:
                module.run()

        self.assertEqual(observed_marker, "1")
        self.assertEqual(
            stderr.write.call_args_list,
            [
                call("WARNING: 'forge-webhook' is deprecated. Use 'forge wh' instead."),
                call("\n"),
            ],
        )
        self.assertNotIn("_FORGE_WH_INVOKED", os.environ)

    def test_wrapper_restores_existing_invocation_marker(self):
        observed_marker = None

        def fake_canonical_run():
            nonlocal observed_marker
            observed_marker = os.environ.get("_FORGE_WH_INVOKED")

        with patch.dict(
            sys.modules,
            {"forge_cli.webhook_server.main": _canonical_module(fake_canonical_run)},
            clear=False,
        ):
            module = _load_wrapper_module()
            with patch.dict(
                os.environ, {"_FORGE_WH_INVOKED": "existing"}, clear=True
            ), patch("sys.stderr") as stderr:
                module.run()
                self.assertEqual(os.environ["_FORGE_WH_INVOKED"], "existing")

        self.assertEqual(observed_marker, "1")
        stderr.write.assert_not_called()


if __name__ == "__main__":
    unittest.main()
