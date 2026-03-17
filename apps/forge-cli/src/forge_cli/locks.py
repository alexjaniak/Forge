"""forge locks — inspect and manage agent issue locks."""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import click


def _repo_root():
    """Return the repository root directory."""
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        click.echo("Error: not inside a git repository.", err=True)
        sys.exit(1)


def _repos_dir():
    """Return the .repos/ directory path."""
    return os.path.join(_repo_root(), ".repos")


def _pid_alive(pid: int) -> bool:
    """Check if a process is still running."""
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _format_age(seconds: int) -> str:
    """Format seconds into a human-readable age string."""
    if seconds < 60:
        return f"{seconds}s"
    elif seconds < 3600:
        return f"{seconds // 60}m"
    elif seconds < 86400:
        return f"{seconds // 3600}h"
    else:
        return f"{seconds // 86400}d"


def _parse_lock(lock_dir: Path) -> dict | None:
    """Parse a lock directory and return its metadata."""
    info_file = lock_dir / "info.json"
    if not info_file.is_file():
        return None
    try:
        with open(info_file) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None

    pid = data.get("pid")
    claimed_at = data.get("claimed_at", "")
    age_str = "?"
    if claimed_at:
        try:
            dt = datetime.strptime(claimed_at, "%Y-%m-%dT%H:%M:%SZ").replace(
                tzinfo=timezone.utc
            )
            secs = int((datetime.now(timezone.utc) - dt).total_seconds())
            age_str = _format_age(max(secs, 0))
        except ValueError:
            pass

    stale = False
    if pid and not _pid_alive(int(pid)):
        stale = True

    return {
        "agent": data.get("agent", "?"),
        "pid": pid,
        "claimed_at": claimed_at,
        "age": age_str,
        "stale": stale,
    }


def _discover_locks(repos_dir: str):
    """Scan all repos under .repos/ for lock directories.

    Yields (repo_label, type_name, number, lock_dir, lock_info) tuples.
    """
    repos_path = Path(repos_dir)
    if not repos_path.is_dir():
        return

    # Walk .repos/github.com/<owner>/<repo>/locks/
    for host_dir in repos_path.iterdir():
        if not host_dir.is_dir():
            continue
        for owner_dir in host_dir.iterdir():
            if not owner_dir.is_dir():
                continue
            for repo_dir in owner_dir.iterdir():
                if not repo_dir.is_dir():
                    continue
                repo_label = f"{host_dir.name}/{owner_dir.name}/{repo_dir.name}"
                locks_base = repo_dir / "locks"
                if not locks_base.is_dir():
                    continue

                for type_dir in locks_base.iterdir():
                    if not type_dir.is_dir():
                        continue
                    type_name = type_dir.name
                    display_type = {"issues": "issue", "prs": "pr"}.get(
                        type_name, type_name
                    )

                    for lock_dir in type_dir.iterdir():
                        if not lock_dir.is_dir() or not lock_dir.name.endswith(
                            ".lock"
                        ):
                            continue
                        number = lock_dir.name.removesuffix(".lock")
                        info = _parse_lock(lock_dir)
                        if info is not None:
                            yield (repo_label, display_type, number, lock_dir, info)


@click.group()
def locks():
    """Inspect and manage agent issue locks."""


@locks.command("list")
def list_locks():
    """Show all held locks across all repos."""
    repos_dir = _repos_dir()
    if not os.path.isdir(repos_dir):
        click.echo("No .repos/ directory found.")
        return

    entries = list(_discover_locks(repos_dir))
    if not entries:
        click.echo("No locks held.")
        return

    # Print table
    header = f"{'REPO':<30}  {'TYPE':<7}  {'#':<5}  {'AGENT':<15}  {'PID':<12}  {'AGE':<8}  STATUS"
    click.echo(header)
    click.echo("-" * len(header))
    for repo_label, display_type, number, _, info in entries:
        pid_str = str(info["pid"]) if info["pid"] else "?"
        status = "[stale]" if info["stale"] else "active"
        click.echo(
            f"{repo_label:<30}  {display_type:<7}  {number:<5}  {info['agent']:<15}  {pid_str:<12}  {info['age']:<8}  {status}"
        )


@locks.command("clear")
@click.option("--all", "clear_all", is_flag=True, help="Clear all locks, not just stale ones.")
@click.option("--force", is_flag=True, help="Skip confirmation for --all.")
def clear_locks(clear_all, force):
    """Clear stale locks, or all locks with --all."""
    repos_dir = _repos_dir()
    if not os.path.isdir(repos_dir):
        click.echo("No .repos/ directory found.")
        return

    entries = list(_discover_locks(repos_dir))
    if not entries:
        click.echo("No locks held.")
        return

    if clear_all:
        if not force:
            click.confirm(
                f"Clear ALL {len(entries)} lock(s)? This may disrupt running agents.",
                abort=True,
            )
        to_clear = entries
    else:
        to_clear = [e for e in entries if e[4]["stale"]]

    if not to_clear:
        click.echo("No stale locks found.")
        return

    import shutil

    for repo_label, display_type, number, lock_dir, info in to_clear:
        shutil.rmtree(lock_dir, ignore_errors=True)
        click.echo(
            f"Cleared: {repo_label} {display_type} #{number} (agent={info['agent']}, pid={info['pid']})"
        )

    click.echo(f"Cleared {len(to_clear)} lock(s).")
