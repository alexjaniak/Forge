"""forge add / forge rm — template-based agent management."""

import json
import os
import re
import sys
from types import SimpleNamespace

import click

from forge_cli.paths import _get_manage, cron_jobs_path, load_cron_jobs, repo_root, save_cron_jobs


def _templates_dir():
    return os.path.join(repo_root(), "templates")


def _template_candidates(template_name):
    tdir = _templates_dir()
    return [
        os.path.join(tdir, f"{template_name}.json"),
        os.path.join(tdir, f"{template_name}.example.json"),
    ]


def _available_templates():
    """Return dict of template_name -> file_path for resolved templates in templates/."""
    tdir = _templates_dir()
    if not os.path.isdir(tdir):
        return {}
    templates = {}
    for fname in sorted(os.listdir(tdir)):
        if fname.endswith(".example.json"):
            name = fname[:-13]
        elif fname.endswith(".json"):
            name = fname[:-5]
        else:
            continue
        for candidate in _template_candidates(name):
            if os.path.isfile(candidate):
                templates[name] = candidate
                break
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
@click.argument("agent_types", nargs=-1)
@click.option("--id", "agent_id", default=None, help="Custom agent ID (default: auto-generate).")
@click.option("--interval", default=None, help="Override template interval (e.g. 5m, 1h).")
@click.option("--model", default=None, help="Override template model (e.g. gpt-5.4).")
@click.option("--list", "list_templates", is_flag=True, help="List available templates.")
@click.option("--apply", "apply_flag", is_flag=True, help="Run forge apply after adding.")
def add(agent_types, agent_id, interval, model, list_templates, apply_flag):
    """Add agents from templates.

    AGENT_TYPES is one or more template names (e.g. worker, planner).
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

    if not agent_types:
        click.echo("Error: AGENT_TYPE is required (e.g. forge add worker).", err=True)
        click.echo("Use --list to see available templates.", err=True)
        sys.exit(1)

    if agent_id is not None and len(agent_types) > 1:
        click.echo("Error: --id cannot be used with multiple agent types.", err=True)
        sys.exit(1)

    templates = _available_templates()
    for agent_type in agent_types:
        if agent_type not in templates:
            click.echo(f"Error: no template '{agent_type}' found.", err=True)
            click.echo(f"Available: {', '.join(templates) or 'none'}", err=True)
            sys.exit(1)

    cron_path = cron_jobs_path()
    cron_data = load_cron_jobs(cron_path)
    existing_ids = [j["id"] for j in cron_data.get("jobs", [])]

    for agent_type in agent_types:
        with open(templates[agent_type]) as f:
            template = json.load(f)

        if agent_id is not None:
            aid = agent_id
        else:
            aid = _next_id(agent_type, existing_ids)

        if aid in existing_ids:
            click.echo(f"Error: agent '{aid}' already exists.", err=True)
            sys.exit(1)

        job = {"id": aid}
        job["interval"] = interval if interval else template["interval"]
        job["prompt"] = template["prompt"]
        job["contexts"] = template.get("contexts", [])
        job["agentic"] = template.get("agentic", False)
        job["workspace"] = template.get("workspace", False)
        resolved_model = model if model is not None else template.get("model")
        if resolved_model:
            job["model"] = resolved_model
        if "repo" in template:
            job["repo"] = template["repo"]

        cron_data.setdefault("jobs", []).append(job)
        existing_ids.append(aid)

        click.echo(click.style(
            f"Staged {aid} (template: {agent_type}, interval: {job['interval']})",
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
        if job.get("model"):
            click.echo(f"  model:     {job['model']}")

    save_cron_jobs(cron_path, cron_data)

    if apply_flag:
        click.echo()
        m = _get_manage()
        m.cmd_apply(SimpleNamespace())
    else:
        click.echo()
        click.echo("Run `forge apply` to activate.")


@click.command()
@click.argument("agent_ids", nargs=-1, required=True)
@click.option("--apply", "apply_flag", is_flag=True, help="Run forge apply after removing.")
def rm(agent_ids, apply_flag):
    """Remove agents by ID."""
    cron_path = cron_jobs_path()
    cron_data = load_cron_jobs(cron_path)

    jobs = cron_data.get("jobs", [])
    known_ids = {j["id"] for j in jobs}

    missing = [aid for aid in agent_ids if aid not in known_ids]
    if missing:
        click.echo(f"Error: agents not found: {', '.join(missing)}", err=True)
        sys.exit(1)

    ids_to_remove = set(agent_ids)
    removed = [j for j in jobs if j["id"] in ids_to_remove]
    cron_data["jobs"] = [j for j in jobs if j["id"] not in ids_to_remove]
    save_cron_jobs(cron_path, cron_data)

    for j in removed:
        interval = j.get("interval", "?")
        click.echo(click.style(
            f"Unstaged {j['id']} (was: interval {interval})",
            fg="red",
        ))

    if apply_flag:
        click.echo()
        m = _get_manage()
        m.cmd_apply(SimpleNamespace())
    else:
        click.echo()
        click.echo("Run `forge apply` to deactivate.")
