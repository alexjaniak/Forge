import json
import logging
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("forge_webhook.trigger")


def load_rules(rules_path: str) -> list[dict]:
    path = Path(rules_path)
    if not path.exists():
        logger.warning("Trigger rules file not found: %s", rules_path)
        return []
    with open(path) as f:
        data = json.load(f)
    rules = data.get("rules", [])
    logger.info("Loaded %d trigger rules from %s", len(rules), rules_path)
    return rules


def _matches_rule(event: dict, rule: dict) -> bool:
    if event["event_type"] != rule["event_type"]:
        return False

    match = rule.get("match", {})
    if "labels_contain" in match:
        required_label = match["labels_contain"]
        if required_label not in event.get("labels", []):
            return False

    return True


def _is_agent_running(repo_dir: str, workspace_id: str) -> bool:
    repo_root = Path(repo_dir)

    # Derive GitHub path from origin remote (same logic as run.sh)
    try:
        origin_url = subprocess.run(
            ["git", "-C", str(repo_root), "remote", "get-url", "origin"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except subprocess.CalledProcessError:
        # Fallback: check root .worktrees/ (legacy path)
        lockfile = repo_root / ".worktrees" / workspace_id / ".agent.lock"
        return _check_lockfile(lockfile)

    # Normalize SSH/HTTPS URL to github.com/owner/repo
    github_path = re.sub(r'^(git@|https://)', '', origin_url)
    github_path = github_path.replace(':', '/', 1)
    github_path = re.sub(r'\.git$', '', github_path)

    lockfile = repo_root / ".repos" / github_path / ".worktrees" / workspace_id / ".agent.lock"
    return _check_lockfile(lockfile)


def _check_lockfile(lockfile: Path) -> bool:
    if not lockfile.exists():
        return False
    try:
        pid = int(lockfile.read_text().strip())
    except (ValueError, OSError):
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _invoke_agent(repo_dir: str, rule: dict, event: dict) -> None:
    workspace = rule["agent"]
    context = rule.get("context", "")
    issue_num = event.get("number", "unknown")
    event_type = event["event_type"]

    prompt = f"Review the current state of GitHub issues and PRs. Process any new worker handoff comments. Create new issues or adjust existing ones to progress toward the project goals. Spawn subplanner issues if scope is too large."
    if "worker" in workspace:
        prompt = (
            f"Triggered by {event_type} on issue #{issue_num}. "
            f"Find and claim a ready issue, then implement it."
        )

    cmd = [
        str(Path(repo_dir) / "agent-kernel" / "run.sh"),
        "--agentic",
        "--workspace", workspace,
    ]
    if context:
        cmd.extend(["--context", context])
    cmd.append(prompt)

    log_dir = Path(repo_dir) / "agent-kernel" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{workspace}.log"
    log_file = open(log_path, "a")

    logger.info("Invoking agent: %s (workspace=%s, issue=#%s)", " ".join(cmd[:5]), workspace, issue_num)
    subprocess.Popen(
        cmd,
        cwd=repo_dir,
        stdout=log_file,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    log_file.close()


def evaluate_triggers(event: dict, rules: list[dict], repo_dir: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for rule in rules:
        if not _matches_rule(event, rule):
            continue

        agent = rule.get("agent", "unknown")

        if _is_agent_running(repo_dir, agent):
            logger.info(
                "[%s] trigger matched rule (agent=%s, event=%s) — skipped: agent already running",
                ts, agent, event["event_type"],
            )
            continue

        logger.info(
            "[%s] trigger fired (agent=%s, event=%s, issue=#%s)",
            ts, agent, event["event_type"], event.get("number", "?"),
        )
        _invoke_agent(repo_dir, rule, event)
