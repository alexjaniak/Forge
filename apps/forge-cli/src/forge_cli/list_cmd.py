"""forge list — unified staged vs active agent view."""

import os
import re

import click

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


@click.command("list")
def list_cmd():
    """Show all agents grouped by state (staged, active, orphan)."""
    manage = _get_manage()

    # Load staged config (cron-jobs.json)
    jobs_file = manage.JOBS_FILE
    if os.path.exists(jobs_file):
        import json
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
    removed_ids = active_ids - staged_ids
    common_ids = staged_ids & active_ids

    changed_ids = set()
    for agent_id in common_ids:
        if staged_jobs[agent_id]["interval"] != active_jobs[agent_id].get("interval"):
            changed_ids.add(agent_id)

    has_staged = new_ids or removed_ids or changed_ids

    # ── Staged section ──
    if has_staged:
        click.echo(click.style("Staged (not yet applied):", bold=True))
        for agent_id in sorted(new_ids):
            job = staged_jobs[agent_id]
            role = _role_from_id(agent_id)
            interval = job["interval"]
            click.echo(
                f"  {click.style('+', fg='green')} "
                f"{click.style(agent_id, fg='green'):<28} "
                f"{role:<10} {interval:<6}"
                f"{click.style('(new — run `forge cron apply` to activate)', dim=True)}"
            )
        for agent_id in sorted(removed_ids):
            info = active_jobs[agent_id]
            role = _role_from_id(agent_id)
            interval = info.get("interval", "?")
            click.echo(
                f"  {click.style('-', fg='red')} "
                f"{click.style(agent_id, fg='red'):<28} "
                f"{role:<10} {interval:<6}"
                f"{click.style('(removed — run `forge cron apply` to activate)', dim=True)}"
            )
        for agent_id in sorted(changed_ids):
            old_interval = active_jobs[agent_id].get("interval", "?")
            new_interval = staged_jobs[agent_id]["interval"]
            role = _role_from_id(agent_id)
            click.echo(
                f"  {click.style('~', fg='yellow')} "
                f"{click.style(agent_id, fg='yellow'):<28} "
                f"{role:<10} {old_interval} → {new_interval}  "
                f"{click.style('(interval changed)', dim=True)}"
            )
        click.echo()

    # ── Active section ──
    # Show agents that are both staged and active (not orphans, not pending removal)
    synced_ids = common_ids - changed_ids
    if synced_ids or changed_ids:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)

        click.echo(click.style("Active:", bold=True))
        for agent_id in sorted(synced_ids | changed_ids):
            info = active_jobs[agent_id]
            role = _role_from_id(agent_id)
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
                f"  {agent_id:<20} {role:<10} {interval:<6}"
                f"{click.style(last_str, fg='cyan'):<30} "
                f"{click.style(next_str, fg='cyan')}"
            )
        click.echo()
    elif not active_jobs:
        click.echo(click.style("Active:", bold=True))
        click.echo(
            click.style("  No active agents (run `forge cron apply` first)", dim=True)
        )
        click.echo()

    # ── Unstaged (orphan) section ──
    orphan_ids = removed_ids  # active but not in staged config
    if orphan_ids:
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)

        click.echo(click.style("Unstaged (active but not in config):", bold=True))
        for agent_id in sorted(orphan_ids):
            info = active_jobs[agent_id]
            role = _role_from_id(agent_id)
            interval = info.get("interval", "?")
            click.echo(
                f"  {agent_id:<20} {role:<10} {interval:<6}"
                f"{click.style('(orphan — active in crontab but missing from cron-jobs.json)', dim=True)}"
            )
        click.echo()

    if not has_staged and not active_jobs:
        click.echo("No agents configured.")
