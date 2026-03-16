"""forge diff — show field-by-field comparison between staged and applied."""

import json
import os

import click

from forge_cli.paths import _get_manage, cron_jobs_path, load_cron_jobs

DIFF_FIELDS = ["interval", "prompt", "contexts", "agentic", "workspace", "repo", "runtime", "model", "enabled"]


def _format_value(field, value):
    """Format a field value for display."""
    if field == "contexts":
        if isinstance(value, list):
            return ", ".join(value) if value else "(none)"
        return str(value) if value else "(none)"
    if field in ("agentic", "workspace"):
        return "yes" if value else "no"
    if field == "enabled":
        return "yes" if value else "no"
    return str(value) if value is not None else "(none)"


def _get_field(job, field):
    """Get a field value from a job dict with sensible defaults."""
    if field == "enabled":
        return job.get("enabled", True)
    if field in ("agentic", "workspace"):
        return job.get(field, False)
    if field == "contexts":
        return job.get("contexts", [])
    return job.get(field)


@click.command("diff")
def diff_cmd():
    """Show differences between staged config and applied state."""
    manage = _get_manage()

    # Load staged config
    staged_data = load_cron_jobs(cron_jobs_path())
    staged_jobs = {}
    for j in staged_data.get("jobs", []):
        staged_jobs[j["id"]] = j

    # Load applied state
    state = manage.load_state()
    applied_jobs = state.get("jobs", {})

    staged_ids = set(staged_jobs.keys())
    applied_ids = set(applied_jobs.keys())

    new_ids = sorted(staged_ids - applied_ids)
    deleted_ids = sorted(applied_ids - staged_ids)
    common_ids = sorted(staged_ids & applied_ids)

    # Find modified agents among common ones
    modified = {}
    for agent_id in common_ids:
        changes = []
        for field in DIFF_FIELDS:
            staged_val = _get_field(staged_jobs[agent_id], field)
            applied_val = _get_field(applied_jobs[agent_id], field)
            if staged_val != applied_val:
                changes.append((field, applied_val, staged_val))
        if changes:
            modified[agent_id] = changes

    if not new_ids and not deleted_ids and not modified:
        click.echo("Config matches applied state. Nothing to diff.")
        return

    click.echo(click.style("--- applied", fg="red"))
    click.echo(click.style("+++ staged", fg="green"))
    click.echo()

    for agent_id in deleted_ids:
        click.echo(click.style(f"  {agent_id} (deleted)", fg="red"))

    for agent_id in common_ids:
        if agent_id not in modified:
            continue
        click.echo(f"  {agent_id}")
        for field, old_val, new_val in modified[agent_id]:
            click.echo(click.style(f"-   {field}: {_format_value(field, old_val)}", fg="red"))
            click.echo(click.style(f"+   {field}: {_format_value(field, new_val)}", fg="green"))

    for agent_id in new_ids:
        click.echo(click.style(f"  {agent_id} (new)", fg="green"))
        job = staged_jobs[agent_id]
        for field in DIFF_FIELDS:
            val = _get_field(job, field)
            if val is not None and val != [] and val != "":
                click.echo(click.style(f"+   {field}: {_format_value(field, val)}", fg="green"))
