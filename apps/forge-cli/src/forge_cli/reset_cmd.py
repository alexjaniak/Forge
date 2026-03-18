"""forge reset — revert config to match applied state."""

import json
import os

import click

from forge_cli.cron_normalization import normalize_optional_cron_field
from forge_cli.paths import _get_manage, cron_jobs_path, load_cron_jobs, save_cron_jobs

# Fields to copy from state entries back into config job entries.
_CONFIG_FIELDS = (
    "interval", "prompt", "contexts", "agentic", "workspace", "repo",
    "runtime", "model",
)


def _state_entry_to_job(agent_id, entry):
    """Convert a cron-state.json entry to a cron-jobs.json job dict."""
    job = {"id": agent_id}
    for field in _CONFIG_FIELDS:
        if field in entry:
            job[field] = entry[field]
    return job


@click.command("reset")
@click.argument("agent_id", required=False, default=None)
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation.")
def reset_cmd(agent_id, yes):
    """Revert config to match applied state (discard unapplied changes)."""
    manage = _get_manage()

    # Load applied state
    state = manage.load_state()
    applied_jobs = state.get("jobs", {})

    # Load staged config
    jobs_path = cron_jobs_path()
    config = load_cron_jobs(jobs_path)
    staged_jobs = {j["id"]: j for j in config.get("jobs", [])}

    if agent_id:
        _reset_single(agent_id, applied_jobs, staged_jobs, config, jobs_path, yes)
    else:
        _reset_all(applied_jobs, staged_jobs, config, jobs_path, yes)


def _reset_all(applied_jobs, staged_jobs, config, jobs_path, yes):
    """Reset entire config to match applied state."""
    # Check if already in sync
    applied_ids = set(applied_jobs.keys())
    staged_ids = set(staged_jobs.keys())

    if applied_ids == staged_ids:
        all_match = all(
            _jobs_match(staged_jobs[aid], applied_jobs[aid])
            for aid in applied_ids
        )
        if all_match:
            click.echo("Config already matches applied state. Nothing to reset.")
            return

    if not yes:
        click.confirm("Reset config to match applied state?", abort=True)

    # Rebuild jobs array from applied state
    new_jobs = [
        _state_entry_to_job(aid, applied_jobs[aid])
        for aid in sorted(applied_jobs.keys())
    ]
    config["jobs"] = new_jobs
    save_cron_jobs(jobs_path, config)

    # Report what changed
    restored = sorted(applied_ids - staged_ids)
    removed = sorted(staged_ids - applied_ids)
    reverted = sorted(
        aid for aid in applied_ids & staged_ids
        if not _jobs_match(staged_jobs[aid], applied_jobs[aid])
    )

    click.echo("Reset config to match applied state.")
    parts = []
    if restored:
        parts.append(f"Restored: {', '.join(restored)}")
    if removed:
        parts.append(f"Removed: {', '.join(f'{r} (was staged, not applied)' for r in removed)}")
    if reverted:
        parts.append(f"Reverted: {', '.join(reverted)}")
    for part in parts:
        click.echo(part)


def _reset_single(agent_id, applied_jobs, staged_jobs, config, jobs_path, yes):
    """Reset a single agent."""
    in_applied = agent_id in applied_jobs
    in_staged = agent_id in staged_jobs

    if not in_applied and not in_staged:
        click.echo(f"Agent '{agent_id}' not found in config or applied state.", err=True)
        raise SystemExit(1)

    # Check if already in sync
    if in_applied and in_staged:
        if _jobs_match(staged_jobs[agent_id], applied_jobs[agent_id]):
            click.echo("Config already matches applied state. Nothing to reset.")
            return

    if not yes:
        if in_applied and not in_staged:
            click.confirm(f"Restore '{agent_id}' from applied state?", abort=True)
        elif not in_applied and in_staged:
            click.confirm(f"Remove '{agent_id}' (staged but not applied)?", abort=True)
        else:
            click.confirm(f"Reset '{agent_id}' to applied state?", abort=True)

    jobs_list = config.get("jobs", [])

    if in_applied and in_staged:
        # Modified: revert to applied values
        new_job = _state_entry_to_job(agent_id, applied_jobs[agent_id])
        config["jobs"] = [new_job if j["id"] == agent_id else j for j in jobs_list]
        click.echo(f"Reset {agent_id} to applied state.")
    elif not in_applied and in_staged:
        # New (not applied): remove from config
        config["jobs"] = [j for j in jobs_list if j["id"] != agent_id]
        click.echo(f"Removed {agent_id} (was staged, not applied).")
    elif in_applied and not in_staged:
        # Deleted (in applied but not staged): restore from applied
        new_job = _state_entry_to_job(agent_id, applied_jobs[agent_id])
        jobs_list.append(new_job)
        config["jobs"] = jobs_list
        click.echo(f"Restored {agent_id} from applied state.")

    save_cron_jobs(jobs_path, config)


def _jobs_match(staged_job, applied_entry):
    """Check if a staged job matches the applied state entry."""
    for field in _CONFIG_FIELDS:
        staged_val = normalize_optional_cron_field(field, staged_job.get(field))
        applied_val = normalize_optional_cron_field(field, applied_entry.get(field))
        if staged_val != applied_val:
            return False
    return True
