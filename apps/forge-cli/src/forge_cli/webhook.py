import atexit
import os
import shutil
import signal
import subprocess
import sys
import tomllib
from pathlib import Path

import click


def _load_config():
    """Load repo name and webhook secret from config.toml or env vars."""
    repo = os.environ.get("FORGE_REPO", "")
    secret = os.environ.get("FORGE_WEBHOOK_SECRET", "")

    if repo and secret:
        return repo, secret

    candidates = [
        Path.cwd() / "config.toml",
        Path(__file__).resolve().parent.parent.parent.parent.parent
        / "apps"
        / "webhook-monitor"
        / "config.toml",
    ]
    for path in candidates:
        if path.is_file():
            with open(path, "rb") as f:
                toml = tomllib.load(f)
            if not repo:
                repo = toml.get("repo", {}).get("name", "")
            if not secret:
                secret = toml.get("webhook", {}).get("secret", "")
            if repo and secret:
                break

    return repo, secret


def _has_gh_webhook_forward():
    """Check if gh webhook forward is available."""
    if not shutil.which("gh"):
        return False
    try:
        result = subprocess.run(
            ["gh", "extension", "list"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if "webhook" in result.stdout:
            return True
    except (subprocess.TimeoutExpired, OSError):
        pass
    try:
        subprocess.run(
            ["gh", "webhook", "forward", "--help"],
            capture_output=True,
            timeout=5,
        )
        return True
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, OSError):
        return False


def _start_tunnel(port):
    """Start the tunnel subprocess. Returns the Popen object or None."""
    repo, secret = _load_config()

    if not repo or not secret:
        click.echo(
            "Warning: FORGE_REPO or FORGE_WEBHOOK_SECRET not set — skipping tunnel.",
            err=True,
        )
        return None

    if _has_gh_webhook_forward():
        click.echo(f"Starting tunnel: gh webhook forward → localhost:{port}")
        proc = subprocess.Popen(
            [
                "gh",
                "webhook",
                "forward",
                f"--repo={repo}",
                "--events=issues,pull_request,issue_comment,pull_request_review",
                f"--url=http://localhost:{port}/webhook",
                f"--secret={secret}",
            ],
        )
        return proc

    if shutil.which("ngrok"):
        click.echo(f"Starting tunnel: ngrok → localhost:{port}")
        proc = subprocess.Popen(["ngrok", "http", str(port)])
        return proc

    click.echo(
        "Warning: No tunnel tool found (gh webhook extension or ngrok). "
        "Starting server without tunnel.",
        err=True,
    )
    return None


@click.command()
@click.option("--port", type=int, default=None, help="Port for the webhook server")
@click.option(
    "--no-tunnel",
    is_flag=True,
    default=False,
    help="Start only the server without the tunnel",
)
def wh(port, no_tunnel):
    """Start the webhook monitor."""
    effective_port = port if port is not None else int(os.environ.get("FORGE_WEBHOOK_PORT", "8471"))

    if port is not None:
        os.environ["FORGE_WEBHOOK_PORT"] = str(port)

    # Signal that we were invoked via `forge wh` to suppress the
    # deprecation warning inside the webhook monitor.
    os.environ["_FORGE_WH_INVOKED"] = "1"

    tunnel_proc = None

    if not no_tunnel:
        tunnel_proc = _start_tunnel(effective_port)

    def _cleanup():
        if tunnel_proc and tunnel_proc.poll() is None:
            tunnel_proc.terminate()
            try:
                tunnel_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tunnel_proc.kill()

    atexit.register(_cleanup)

    def _signal_handler(signum, frame):
        _cleanup()
        sys.exit(0)

    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    from forge_webhook.main import run

    try:
        run()
    finally:
        _cleanup()
