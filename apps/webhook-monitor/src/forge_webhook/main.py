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

    canonical_run()
