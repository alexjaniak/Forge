import os
import sys
import tomllib
from pathlib import Path


def _load_toml() -> dict:
    """Load config.toml from working directory, then package directory as fallback."""
    candidates = [
        Path.cwd() / "config.toml",
        Path(__file__).resolve().parent.parent.parent / "config.toml",
    ]
    for path in candidates:
        if path.is_file():
            with open(path, "rb") as f:
                return tomllib.load(f)
    return {}


def get_config() -> dict:
    toml = _load_toml()
    webhook = toml.get("webhook", {})
    trigger = toml.get("trigger", {})
    repo = toml.get("repo", {})

    secret = os.environ.get("FORGE_WEBHOOK_SECRET") or webhook.get("secret") or ""
    if not secret:
        print("Error: webhook secret is required — set webhook.secret in config.toml or FORGE_WEBHOOK_SECRET env var", file=sys.stderr)
        sys.exit(1)

    return {
        "secret": secret,
        "port": int(os.environ.get("FORGE_WEBHOOK_PORT", "") or webhook.get("port", 8471)),
        "events_file": os.environ.get("FORGE_EVENTS_FILE", "") or webhook.get("events_file", "./events.jsonl"),
        "trigger_rules_file": os.environ.get("FORGE_TRIGGER_RULES", "") or trigger.get("rules_file", ""),
        "repo_dir": os.environ.get("FORGE_REPO_DIR", "") or repo.get("dir", ""),
    }
