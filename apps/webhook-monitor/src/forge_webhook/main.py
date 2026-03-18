import os
import sys

from forge_cli.webhook_server.main import app


def run():
    from forge_cli.webhook_server.main import run as canonical_run

    if not os.environ.get("_FORGE_WH_INVOKED"):
        print(
            "WARNING: 'forge-webhook' is deprecated. Use 'forge wh' instead.",
            file=sys.stderr,
        )

    previous_invocation_marker = os.environ.get("_FORGE_WH_INVOKED")
    os.environ["_FORGE_WH_INVOKED"] = "1"
    try:
        canonical_run()
    finally:
        if previous_invocation_marker is None:
            os.environ.pop("_FORGE_WH_INVOKED", None)
        else:
            os.environ["_FORGE_WH_INVOKED"] = previous_invocation_marker
