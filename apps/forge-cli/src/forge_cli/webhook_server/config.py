import os
import sys
import tomllib
from pathlib import Path


_BUNDLED_CONFIG_PATH = Path(__file__).resolve().parents[3] / "config.toml"


def find_config_path() -> Path | None:
    for path in (_BUNDLED_CONFIG_PATH, Path.cwd() / "config.toml"):
        if path.is_file():
            return path
    return None


def load_toml() -> tuple[dict, Path | None]:
    path = find_config_path()
    if path is None:
        return {}, None

    with open(path, "rb") as f:
        return tomllib.load(f), path


def _resolve_relative_path(value: str, config_path: Path | None) -> str:
    if not value or config_path is None:
        return value

    path = Path(value)
    if path.is_absolute():
        return str(path)

    return str((config_path.parent / path).resolve())


def get_config() -> dict:
    toml, config_path = load_toml()
    webhook = toml.get("webhook", {})
    trigger = toml.get("trigger", {})
    repo = toml.get("repo", {})

    secret = os.environ.get("FORGE_WEBHOOK_SECRET") or webhook.get("secret") or ""
    if not secret:
        print(
            "Error: webhook secret is required — set webhook.secret in config.toml or FORGE_WEBHOOK_SECRET env var",
            file=sys.stderr,
        )
        sys.exit(1)

    events_file = os.environ.get("FORGE_EVENTS_FILE", "")
    if not events_file:
        events_file = _resolve_relative_path(
            webhook.get("events_file", "./events.jsonl"),
            config_path,
        )

    trigger_rules_file = os.environ.get("FORGE_TRIGGER_RULES", "")
    if not trigger_rules_file:
        trigger_rules_file = _resolve_relative_path(
            trigger.get("rules_file", ""),
            config_path,
        )

    return {
        "secret": secret,
        "port": int(os.environ.get("FORGE_WEBHOOK_PORT", "") or webhook.get("port", 8471)),
        "events_file": events_file,
        "trigger_rules_file": trigger_rules_file,
        "repo_dir": os.environ.get("FORGE_REPO_DIR", "") or repo.get("dir", ""),
    }
