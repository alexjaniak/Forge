import click

from forge_cli.agents import add, remove
from forge_cli.apply_cmd import apply_cmd
from forge_cli.clear_cmd import clear_cmd
from forge_cli.list_cmd import list_cmd
from forge_cli.logs import logs
from forge_cli.run_cmd import run_cmd
from forge_cli.ui import ui
from forge_cli.webhook import wh


@click.group()
def main():
    """Forge — agent orchestration CLI."""


main.add_command(add)
main.add_command(apply_cmd, name="apply")
main.add_command(clear_cmd, name="clear")
main.add_command(list_cmd, name="list")
main.add_command(logs)
main.add_command(remove)
main.add_command(run_cmd, name="run")
main.add_command(list_cmd, name="status")
main.add_command(ui)
main.add_command(wh)
