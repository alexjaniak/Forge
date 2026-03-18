"""forge kill — terminate managed agent runs."""

from types import SimpleNamespace

import click

from forge_cli.paths import _get_manage


@click.command("kill")
@click.argument("agent_id", required=False)
@click.option("--all", "kill_all", is_flag=True, help="Terminate all running managed agents.")
def kill_cmd(agent_id, kill_all):
    """Terminate a managed agent run."""
    if bool(agent_id) == kill_all:
        raise click.UsageError("kill requires exactly one of: <agent-id> or --all")

    m = _get_manage()
    m.cmd_kill(SimpleNamespace(id=agent_id, all=kill_all))
