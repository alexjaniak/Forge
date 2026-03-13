"""forge unorphan — restore an orphaned agent back into staged config."""

import json
import os
import re
import sys

import click

from forge_cli.paths import cron_jobs_path, load_cron_jobs, repo_root, save_cron_jobs


TEMPLATE_PREFIXES = {"worker", "planner", "super"}


def _infer_template_type(agent_id):
    """Infer template type from agent ID prefix (e.g. worker-01 -> worker)."""
    m = re.match(r"^([a-zA-Z]+)-\d+$", agent_id)
    if m and m.group(1) in TEMPLATE_PREFIXES:
        return m.group(1)
    return None


def _load_template(template_type):
    """Load a template JSON file by type name."""
    templates_dir = os.path.join(repo_root(), "templates")
    path = os.path.join(templates_dir, f"{template_type}.json")
    if not os.path.exists(path):
        click.echo(f"Error: template file not found: {path}", err=True)
        sys.exit(1)
    with open(path) as f:
        return json.load(f)


def _load_cron_state():
    """Load cron-state.json."""
    state_path = os.path.join(repo_root(), "agent-kernel", "cron", "cron-state.json")
    if not os.path.exists(state_path):
        return {"jobs": {}}
    with open(state_path) as f:
        return json.load(f)


@click.command("unorphan")
@click.argument("agent_id")
@click.option("--template", "template_type", default=None,
              help="Template type to use (e.g. worker, planner). Required if not inferable from ID.")
def unorphan_cmd(agent_id, template_type):
    """Restore an orphaned agent back into staged config."""
    state = _load_cron_state()
    active_jobs = state.get("jobs", {})

    if agent_id not in active_jobs:
        click.echo(f"Error: Agent '{agent_id}' not found in active state.", err=True)
        sys.exit(1)

    cron_path = cron_jobs_path()
    cron_data = load_cron_jobs(cron_path)
    staged_ids = {j["id"] for j in cron_data.get("jobs", [])}

    if agent_id in staged_ids:
        click.echo(f"Error: Agent '{agent_id}' is already staged.", err=True)
        sys.exit(1)

    if template_type is None:
        template_type = _infer_template_type(agent_id)
    if template_type is None:
        click.echo(
            f"Error: cannot infer template type from '{agent_id}'. "
            "Use --template <type> to specify.",
            err=True,
        )
        sys.exit(1)

    template = _load_template(template_type)
    agent_state = active_jobs[agent_id]

    job = {
        "id": agent_id,
        "interval": agent_state.get("interval", template["interval"]),
        "prompt": template["prompt"],
        "contexts": agent_state.get("contexts", template.get("contexts", [])),
        "agentic": template.get("agentic", False),
        "workspace": template.get("workspace", False),
    }

    cron_data.setdefault("jobs", []).append(job)
    save_cron_jobs(cron_path, cron_data)

    click.echo(click.style(
        f"Agent '{agent_id}' restored to staged config.",
        fg="green",
    ))
    click.echo("Run `forge cron apply` to activate.")
