"""forge add / forge remove — template-based agent management."""

import json
import os
import re
import sys

import click

from forge_cli.paths import cron_jobs_path, load_cron_jobs, repo_root, save_cron_jobs


def _templates_dir():
    return os.path.join(repo_root(), "templates")


def _available_templates():
    """Return dict of template_name -> file_path for all .json files in templates/."""
    tdir = _templates_dir()
    if not os.path.isdir(tdir):
        return {}
    templates = {}
    for fname in sorted(os.listdir(tdir)):
        if fname.endswith(".json"):
            name = fname[:-5]
            templates[name] = os.path.join(tdir, fname)
    return templates


def _next_id(agent_type, existing_ids):
    """Auto-generate next available ID like worker-01, worker-02, etc."""
    pattern = re.compile(rf"^{re.escape(agent_type)}-(\d+)$")
    used = set()
    for eid in existing_ids:
        m = pattern.match(eid)
        if m:
            used.add(int(m.group(1)))
    n = 1
    while n in used:
        n += 1
    return f"{agent_type}-{n:02d}"


@click.command()
@click.argument("agent_type", required=False, default=None)
@click.option("--id", "agent_id", default=None, help="Custom agent ID (default: auto-generate).")
@click.option("--interval", default=None, help="Override template interval (e.g. 5m, 1h).")
@click.option("--list", "list_templates", is_flag=True, help="List available templates.")
def add(agent_type, agent_id, interval, list_templates):
    """Add an agent from a template.

    AGENT_TYPE is the template name (e.g. worker, planner).
    """
    if list_templates:
        templates = _available_templates()
        if not templates:
            click.echo("No templates found in templates/")
            return
        click.echo("Available templates:")
        for name in templates:
            click.echo(f"  {name}")
        return

    if not agent_type:
        click.echo("Error: AGENT_TYPE is required (e.g. forge add worker).", err=True)
        click.echo("Use --list to see available templates.", err=True)
        sys.exit(1)

    templates = _available_templates()
    if agent_type not in templates:
        click.echo(f"Error: no template '{agent_type}' found.", err=True)
        click.echo(f"Available: {', '.join(templates) or 'none'}", err=True)
        sys.exit(1)

    with open(templates[agent_type]) as f:
        template = json.load(f)

    cron_path = cron_jobs_path()
    cron_data = load_cron_jobs(cron_path)
    existing_ids = [j["id"] for j in cron_data.get("jobs", [])]

    if agent_id is None:
        agent_id = _next_id(agent_type, existing_ids)

    if agent_id in existing_ids:
        click.echo(f"Error: agent '{agent_id}' already exists.", err=True)
        sys.exit(1)

    job = {"id": agent_id}
    job["interval"] = interval if interval else template["interval"]
    job["prompt"] = template["prompt"]
    job["contexts"] = template.get("contexts", [])
    job["agentic"] = template.get("agentic", False)
    job["workspace"] = template.get("workspace", False)

    cron_data.setdefault("jobs", []).append(job)
    save_cron_jobs(cron_path, cron_data)

    click.echo(click.style(
        f"Staged {agent_id} (template: {agent_type}, interval: {job['interval']})",
        fg="green",
    ))
    prompt_display = job["prompt"]
    if len(prompt_display) > 60:
        prompt_display = prompt_display[:57] + "..."
    click.echo(f"  prompt:    \"{prompt_display}\"")
    if job["contexts"]:
        click.echo(f"  contexts:  {', '.join(job['contexts'])}")
    click.echo(f"  agentic:   {'yes' if job['agentic'] else 'no'}")
    click.echo(f"  workspace: {'yes' if job['workspace'] else 'no'}")
    click.echo()
    click.echo("Run `forge apply` to activate.")


@click.command()
@click.argument("agent_id")
def remove(agent_id):
    """Remove an agent by ID."""
    cron_path = cron_jobs_path()
    cron_data = load_cron_jobs(cron_path)

    jobs = cron_data.get("jobs", [])
    removed = [j for j in jobs if j["id"] == agent_id]
    new_jobs = [j for j in jobs if j["id"] != agent_id]

    if len(new_jobs) == len(jobs):
        click.echo(f"Error: no agent '{agent_id}' found.", err=True)
        sys.exit(1)

    cron_data["jobs"] = new_jobs
    save_cron_jobs(cron_path, cron_data)

    interval = removed[0].get("interval", "?") if removed else "?"
    click.echo(click.style(
        f"Unstaged {agent_id} (was: interval {interval})",
        fg="red",
    ))
    click.echo()
    click.echo("Run `forge apply` to deactivate.")
