"""forge apply — sync crontab to match cron-jobs.json."""

from types import SimpleNamespace

import click

from forge_cli.paths import _get_manage


@click.command("apply")
def apply_cmd():
    """Sync crontab to match cron-jobs.json."""
    m = _get_manage()
    m.cmd_apply(SimpleNamespace())
