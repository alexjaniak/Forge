"""Clear staged config (wipe all agents from cron-jobs.json)."""

import click

from forge_cli.paths import cron_jobs_path, load_cron_jobs, save_cron_jobs


@click.command("clear")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt.")
def clear_cmd(yes):
    """Clear staged config (wipe all agents from cron-jobs.json)."""
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

    click.echo(f"Cleared {count} agent{'s' if count != 1 else ''} from config. Run 'forge apply' to tear down.")
