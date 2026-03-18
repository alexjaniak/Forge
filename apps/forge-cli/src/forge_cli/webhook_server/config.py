import os
import subprocess
import sys
import tomllib
from importlib.resources import files
from pathlib import Path


def _bundled_asset_path(name: str) -> Path:
    return Path(str(files("forge_cli.webhook_server").joinpath("_bundled").joinpath(name)))


def _repo_root() -> Path | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None

    return Path(result.stdout.strip())


def _config_search_paths() -> tuple[Path, ...]:
    paths: list[Path] = [Path.cwd() / "config.toml"]
    repo_root = _repo_root()
    if repo_root is not None:
        repo_local_path = repo_root / "apps" / "forge-cli" / "config.toml"
        if repo_local_path not in paths:
            paths.append(repo_local_path)
    paths.append(_bundled_asset_path("config.toml"))
    return tuple(paths)


def find_config_path() -> Path | None:
    for path in _config_search_paths():
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
        configured_events_file = webhook.get("events_file", "")
        if configured_events_file:
            events_file = _resolve_relative_path(configured_events_file, config_path)
        else:
            events_file = str((Path.cwd() / "events.jsonl").resolve())

    trigger_rules_file = os.environ.get("FORGE_TRIGGER_RULES", "")
    if not trigger_rules_file:
        configured_rules_file = trigger.get("rules_file", "")
        if configured_rules_file:
            trigger_rules_file = _resolve_relative_path(
                configured_rules_file,
                config_path,
            )
        else:
            trigger_rules_file = str(_bundled_asset_path("trigger-rules.json"))

    return {
        "secret": secret,
        "port": int(os.environ.get("FORGE_WEBHOOK_PORT", "") or webhook.get("port", 8471)),
        "events_file": events_file,
        "trigger_rules_file": trigger_rules_file,
        "repo_dir": os.environ.get("FORGE_REPO_DIR", "") or repo.get("dir", ""),
    }
