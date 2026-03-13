"""forge run — run a cron job once immediately."""

from types import SimpleNamespace

import click

from forge_cli.paths import _get_manage


@click.command("run")
@click.argument("id")
def run_cmd(id):
    """Run a job once immediately."""
    m = _get_manage()
    m.cmd_run(SimpleNamespace(id=id))
