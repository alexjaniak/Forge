"""Shared path and config helpers for forge-cli."""

import importlib.util
import json
import os
import subprocess
import sys

import click


def repo_root():
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


def cron_jobs_path():
    return os.path.join(repo_root(), "agent-kernel", "cron", "cron-jobs.json")


def load_cron_jobs(path):
    if not os.path.exists(path):
        return {"stagger": True, "jobs": []}
    with open(path) as f:
        return json.load(f)


def save_cron_jobs(path, data):
    dir_name = os.path.dirname(path)
    tmp_path = os.path.join(dir_name, f".cron-jobs.tmp.{os.getpid()}")
    with open(tmp_path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.rename(tmp_path, path)


_manage_cache = None


def _get_manage():
    """Import and configure manage.py with correct paths resolved via git."""
    global _manage_cache
    if _manage_cache is not None:
        return _manage_cache

    try:
        repo_dir = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except subprocess.CalledProcessError:
        click.echo("Error: not inside a git repository", err=True)
        raise SystemExit(1)

    cron_dir = os.path.join(repo_dir, "agent-kernel", "cron")

    spec = importlib.util.spec_from_file_location(
        "forge_manage", os.path.join(cron_dir, "manage.py")
    )
    manage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(manage)

    # Patch path constants so manage.py works from any directory
    manage.SCRIPT_DIR = cron_dir
    manage.KERNEL_DIR = os.path.join(repo_dir, "agent-kernel")
    manage.REPO_DIR = repo_dir
    manage.JOBS_FILE = os.path.join(cron_dir, "cron-jobs.json")
    manage.STATE_FILE = os.path.join(cron_dir, "cron-state.json")
    manage.LOGS_DIR = os.path.join(repo_dir, "agent-kernel", "logs")

    _manage_cache = manage
    return manage
