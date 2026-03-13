import os

import click

from forge_cli.paths import repo_root


@click.command()
@click.option("--port", default=3000, show_default=True, help="Port for the dev server.")
def ui(port):
    """Start the Forge dashboard."""
    root = repo_root()
    web_dir = os.path.join(root, "apps", "web")

    if not os.path.isdir(web_dir):
        click.echo(f"Error: apps/web/ not found at {web_dir}", err=True)
        raise SystemExit(1)

    click.echo(f"Starting Forge dashboard on port {port}...")
    os.chdir(web_dir)
    os.execvp("npm", ["npm", "run", "dev", "--", "--port", str(port)])
