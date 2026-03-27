"""forge clear — remove active cron entries or staged config."""

from types import SimpleNamespace

import click

from forge_cli.paths import _get_manage, cron_jobs_path, load_cron_jobs, save_cron_jobs


@click.command("clear")
@click.option("--staged", is_flag=True, help="Clear only staged config (cron-jobs.json).")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt.")
def clear_cmd(staged, yes):
    """Remove active cron entries, or staged config with --staged."""
    if staged:
        _clear_staged(yes)
    else:
        _clear_active(yes)


def _clear_staged(yes):
    """Clear staged config (cron-jobs.json)."""
    path = cron_jobs_path()
    data = load_cron_jobs(path)
    jobs = data.get("jobs", [])

    if not jobs:
        click.echo("Nothing to clear — no staged agents.")
        return

    click.echo(f"Staged agents ({len(jobs)}):")
    for job in jobs:
        click.echo(f"  {job['id']}  ({job.get('interval', '?')})")

    if not yes:
        click.confirm("Clear all staged agents?", abort=True)

    count = len(jobs)
    data["jobs"] = []
    save_cron_jobs(path, data)

    click.echo(f"Cleared {count} staged agent{'s' if count != 1 else ''} from config.")
    click.echo("Run `forge apply` to deactivate them.")


def _clear_active(yes):
    """Clear active crontab entries and cron-state.json."""
    if not yes:
        click.confirm("Remove all active cron entries and state?", abort=True)

    m = _get_manage()
    m.cmd_clear(SimpleNamespace())
