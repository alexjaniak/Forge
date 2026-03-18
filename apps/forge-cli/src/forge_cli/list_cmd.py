"""forge status — git-style agent status view."""

import json
import os
import re
from datetime import datetime, timezone

import click

from forge_cli.diff_cmd import get_modified_fields
from forge_cli.paths import _get_manage


def _role_from_id(agent_id):
    """Infer role from agent ID prefix (e.g. worker-01 -> worker)."""
    m = re.match(r"^([a-zA-Z]+)", agent_id)
    return m.group(1) if m else "unknown"


def _format_relative(seconds):
    """Format seconds as a human-readable relative time string."""
    if seconds < 0:
        return "overdue"
    mins, secs = divmod(int(seconds), 60)
    hrs, mins = divmod(mins, 60)
    if hrs:
        return f"{hrs}h {mins}m {secs}s"
    if mins:
        return f"{mins}m {secs}s"
    return f"{secs}s"


@click.command("status")
def list_cmd():
    """Show agent status (staged changes and applied agents)."""
    manage = _get_manage()

    # Load staged config (cron-jobs.json)
    jobs_file = manage.JOBS_FILE
    if os.path.exists(jobs_file):
        with open(jobs_file) as f:
            config = json.load(f)
        staged_jobs = {j["id"]: j for j in config.get("jobs", []) if j.get("enabled", True)}
    else:
        staged_jobs = {}

    # Load active state (cron-state.json)
    state = manage.load_state()
    active_jobs = state.get("jobs", {})

    staged_ids = set(staged_jobs.keys())
    active_ids = set(active_jobs.keys())

    new_ids = staged_ids - active_ids
    deleted_ids = active_ids - staged_ids
    common_ids = staged_ids & active_ids

    modified_ids = set()
    for agent_id in common_ids:
        if get_modified_fields(staged_jobs[agent_id], active_jobs[agent_id]):
            modified_ids.add(agent_id)

    has_changes = new_ids or deleted_ids or modified_ids

    # ── Changes to be applied ──
    if has_changes:
        click.echo(click.style("Changes to be applied:", bold=True))
        click.echo(click.style('  (use "forge reset" to discard changes)', dim=True))
        click.echo()
        for agent_id in sorted(new_ids):
            click.echo(
                f"        {click.style('new:', fg='green')}      {click.style(agent_id, fg='green')}"
            )
        for agent_id in sorted(modified_ids):
            changed_fields = [field for field, _, _ in get_modified_fields(staged_jobs[agent_id], active_jobs[agent_id])]
            summary = ", ".join(changed_fields)
            click.echo(
                f"        {click.style('modified:', fg='yellow')} {click.style(agent_id, fg='yellow')}"
                f"  {click.style(f'(fields: {summary})', fg='yellow')}"
            )
        for agent_id in sorted(deleted_ids):
            click.echo(
                f"        {click.style('deleted:', fg='red')}  {click.style(agent_id, fg='red')}"
            )
        click.echo()

    # ── Applied agents ──
    synced_ids = common_ids - modified_ids
    applied_ids = synced_ids | modified_ids
    if applied_ids:
        now = datetime.now(timezone.utc)
        click.echo(click.style("Applied agents:", bold=True))
        for agent_id in sorted(applied_ids):
            info = active_jobs[agent_id]
            interval = info.get("interval", "?")
            last_run = info.get("last_run")

            if last_run:
                last_dt = datetime.fromisoformat(last_run)
                ago_secs = (now - last_dt).total_seconds()
                last_str = f"last: {_format_relative(ago_secs)} ago"

                next_run_iso = manage.compute_next_run(last_run, interval)
                if next_run_iso:
                    next_dt = datetime.fromisoformat(next_run_iso)
                    remain_secs = (next_dt - now).total_seconds()
                    next_str = f"next: {_format_relative(remain_secs)}"
                else:
                    next_str = "next: —"
            else:
                last_str = "last: never"
                next_str = "next: —"

            click.echo(
                f"        {agent_id:<16} {interval:<6}"
                f"{click.style(last_str, fg='cyan'):<30} "
                f"{click.style(next_str, fg='cyan')}"
            )
        click.echo()

    if not has_changes and not active_jobs:
        click.echo("No agents configured.")
