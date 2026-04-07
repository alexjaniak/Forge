#!/usr/bin/env python3
"""agent-kernel cron management — declarative crontab sync."""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

# ── ANSI color helpers ────────────────────────────────────────

def _color(text, code):
    """Wrap text in ANSI color escape codes."""
    if not sys.stdout.isatty():
        return text
    return f"\033[{code}m{text}\033[0m"

def _green(text):  return _color(text, "32")
def _red(text):    return _color(text, "31")
def _yellow(text): return _color(text, "33")
def _dim(text):    return _color(text, "2")


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
KERNEL_DIR = os.path.dirname(SCRIPT_DIR)
REPO_DIR = os.path.dirname(KERNEL_DIR)
JOBS_FILE = os.path.join(SCRIPT_DIR, "cron-jobs.json")
# cron-state.json format (auto-generated, gitignored):
# {
#   "jobs": {
#     "<agent-id>": {
#       "interval": "5m",          # scheduling interval (Nm or Nh)
#       "cron_expr": "*/5 * * * *",# resolved cron expression
#       "prompt": "...",           # agent prompt
#       "agentic": true,           # tool use enabled
#       "workspace": true,         # git worktree isolation
#       "contexts": [...],         # context file paths
#       "repo": "",                # target repo (empty = self)
#       "installed_at": "ISO8601", # when job was added/updated
#       "last_run": "ISO8601"      # updated by run.sh at start of each run
#     }
#   },
#   "last_applied": "ISO8601"      # when apply was last run
# }
# next_run is computed dynamically as last_run + interval.
STATE_FILE = os.path.join(SCRIPT_DIR, "cron-state.json")
LOGS_DIR = os.path.join(KERNEL_DIR, "logs")
TAG_PREFIX = "# Forge:agent-kernel"


# ── helpers ────────────────────────────────────────────────────

def parse_interval(interval):
    m = re.fullmatch(r"(\d+)m", interval)
    if m:
        return f"*/{m.group(1)} * * * *"
    m = re.fullmatch(r"(\d+)h", interval)
    if m:
        return f"0 */{m.group(1)} * * *"
    raise ValueError(f"Invalid interval '{interval}': must be Nm or Nh (e.g. 5m, 1h)")


VALID_RUNTIMES = {"claude", "codex"}
MODEL_RE = re.compile(r'^[a-zA-Z0-9_./-]+$')


def validate_runtime(runtime):
    if runtime not in VALID_RUNTIMES:
        print(f"Error: unknown runtime '{runtime}'. Valid: {', '.join(sorted(VALID_RUNTIMES))}", file=sys.stderr)
        sys.exit(1)


def validate_model(model):
    if model and not MODEL_RE.match(model):
        print(f"Error: invalid model '{model}'", file=sys.stderr)
        sys.exit(1)



def build_cron_command(job_id, prompt, agentic, contexts=None, workspace=False, repo=None, runtime=None, model=None):
    runtime = runtime or "claude"
    env_prefix = f"AGENT_RUNTIME={runtime} " if runtime != "claude" else ""
    cmd = f"mkdir -p {LOGS_DIR} && cd {REPO_DIR} && {env_prefix}./agent-kernel/run.sh"
    if agentic:
        cmd += " --agentic"
    if workspace:
        cmd += f" --workspace {job_id}"
    if repo:
        cmd += f" --repo {repo}"
    if model:
        cmd += f" --model '{model}'"
    for ctx in (contexts or []):
        cmd += f" --context {ctx}"
    cmd += f' "{prompt}" >> {LOGS_DIR}/{job_id}.log 2>&1'
    return cmd


def read_crontab():
    try:
        return subprocess.run(
            ["crontab", "-l"], capture_output=True, text=True, check=True
        ).stdout
    except subprocess.CalledProcessError:
        return ""


def write_crontab(content):
    content = content.strip()
    if not content:
        subprocess.run(["crontab", "-r"], capture_output=True, check=False)
    else:
        subprocess.run(
            ["crontab", "-"], input=content + "\n", text=True, check=True
        )


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"jobs": {}, "last_applied": None}


def save_state(state):
    state["last_applied"] = datetime.now(timezone.utc).isoformat()
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)
        f.write("\n")


def interval_to_seconds(interval):
    """Convert an interval string like '5m' or '1h' to seconds."""
    m = re.fullmatch(r"(\d+)m", interval)
    if m:
        return int(m.group(1)) * 60
    m = re.fullmatch(r"(\d+)h", interval)
    if m:
        return int(m.group(1)) * 3600
    return 0


def compute_next_run(last_run_iso, interval):
    """Compute next run timestamp from last_run + interval."""
    if not last_run_iso:
        return None
    last_run = datetime.fromisoformat(last_run_iso)
    secs = interval_to_seconds(interval)
    if secs == 0:
        return None
    return (last_run + timedelta(seconds=secs)).isoformat()


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def compute_stagger_offsets(jobs):
    """Group jobs by interval and compute per-job offsets in seconds.

    Returns dict: {job_id: offset_seconds}.
    """
    from collections import defaultdict
    groups = defaultdict(list)
    for job in jobs:
        groups[job["interval"]].append(job["id"])

    offsets = {}
    for interval, job_ids in groups.items():
        total_secs = interval_to_seconds(interval)
        group_size = len(job_ids)
        for i, job_id in enumerate(sorted(job_ids)):
            offsets[job_id] = (i * total_secs) // group_size
    return offsets


def apply_offset_to_interval(interval, offset_seconds):
    """Apply a stagger offset to an interval, returning (cron_expr, sleep_seconds).

    For minute intervals (Nm): shifts the minute field and adds sub-minute sleep.
    For hour intervals (Nh): shifts the minute field within the hour.
    """
    minute_offset = offset_seconds // 60
    sleep_seconds = offset_seconds % 60

    m = re.fullmatch(r"(\d+)m", interval)
    if m:
        step = int(m.group(1))
        if minute_offset == 0:
            cron_expr = f"*/{step} * * * *"
        else:
            cron_expr = f"{minute_offset}/{step} * * * *"
        return cron_expr, sleep_seconds

    m = re.fullmatch(r"(\d+)h", interval)
    if m:
        step = int(m.group(1))
        cron_expr = f"{minute_offset} */{step} * * *"
        return cron_expr, sleep_seconds

    raise ValueError(f"Invalid interval '{interval}'")


# ── crontab manipulation ──────────────────────────────────────

def remove_job_from_crontab(crontab, job_id):
    tag = f"{TAG_PREFIX}:{job_id}"
    lines = crontab.splitlines()
    result = []
    skip_next = False
    for line in lines:
        if line.strip() == tag:
            skip_next = True
            continue
        if skip_next:
            skip_next = False
            continue
        result.append(line)
    return "\n".join(result)


def add_job_to_crontab(crontab, job_id, cron_expr, command):
    crontab = remove_job_from_crontab(crontab, job_id)
    tag = f"{TAG_PREFIX}:{job_id}"
    entry = f"{tag}\n{cron_expr} {command}"
    if crontab.strip():
        return crontab.strip() + "\n" + entry
    return entry


# ── subcommands ───────────────────────────────────────────────

def cmd_apply(args):
    if not os.path.exists(JOBS_FILE):
        print(f"Error: {JOBS_FILE} not found", file=sys.stderr)
        sys.exit(1)

    with open(JOBS_FILE) as f:
        config = json.load(f)

    state = load_state()

    stagger = config.get("stagger", False)

    desired = {}
    for job in config.get("jobs", []):
        if job.get("enabled", True):
            desired[job["id"]] = job

    # Compute stagger offsets when enabled
    stagger_offsets = {}
    if stagger:
        enabled_jobs = [job for job in config.get("jobs", []) if job.get("enabled", True)]
        stagger_offsets = compute_stagger_offsets(enabled_jobs)

    actual = state["jobs"]

    to_remove = set(actual.keys()) - set(desired.keys())
    to_add = set(desired.keys()) - set(actual.keys())

    # Detect changes — include stagger state change as a reason to update all jobs
    stagger_changed = stagger != state.get("stagger", False)

    to_update = set()
    for job_id in set(desired.keys()) & set(actual.keys()):
        d = desired[job_id]
        a = actual[job_id]
        if (stagger_changed or
                d["interval"] != a.get("interval") or
                d["prompt"] != a.get("prompt") or
                d.get("agentic", False) != a.get("agentic", False) or
                d.get("workspace", False) != a.get("workspace", False) or
                d.get("contexts", []) != a.get("contexts", []) or
                d.get("repo", "") != a.get("repo", "") or
                d.get("runtime", "claude") != a.get("runtime", "claude") or
                d.get("model", "") != a.get("model", "")):
            to_update.add(job_id)

    no_change = (set(desired.keys()) & set(actual.keys())) - to_update

    crontab = read_crontab()

    print("Applied cron changes:")

    for job_id in sorted(to_remove):
        old_interval = actual[job_id].get("interval", "?")
        crontab = remove_job_from_crontab(crontab, job_id)
        del state["jobs"][job_id]
        print(_red(f"  - {job_id:<20} {old_interval:<6} (removed)"))

    for job_id in sorted(to_add | to_update):
        job = desired[job_id]
        contexts = job.get("contexts", [])
        repo = job.get("repo", "")
        runtime = job.get("runtime", "claude")
        model = job.get("model", "")
        validate_runtime(runtime)
        validate_model(model)
        command = build_cron_command(job_id, job["prompt"], job.get("agentic", False), contexts, job.get("workspace", False), repo or None, runtime, model or None)

        offset = stagger_offsets.get(job_id, 0)
        if stagger and offset > 0:
            cron_expr, sleep_secs = apply_offset_to_interval(job["interval"], offset)
            if sleep_secs > 0:
                command = f"sleep {sleep_secs} && {command}"
        else:
            cron_expr = parse_interval(job["interval"])
            sleep_secs = 0

        crontab = add_job_to_crontab(crontab, job_id, cron_expr, command)
        state["jobs"][job_id] = {
            "interval": job["interval"],
            "cron_expr": cron_expr,
            "prompt": job["prompt"],
            "agentic": job.get("agentic", False),
            "workspace": job.get("workspace", False),
            "contexts": contexts,
            "repo": repo,
            "runtime": runtime,
            "model": model,
            "stagger_offset": offset if stagger else 0,
            "installed_at": now_iso(),
        }
        if job_id in to_add:
            print(_green(f"  + {job_id:<20} {job['interval']:<6} (new)"))
        else:
            old_interval = actual[job_id].get("interval", "?")
            if old_interval != job["interval"]:
                print(_yellow(f"  ~ {job_id:<20} {old_interval} \u2192 {job['interval']:<6} (updated)"))
            else:
                print(_yellow(f"  ~ {job_id:<20} {job['interval']:<6} (updated)"))

    for job_id in sorted(no_change):
        interval = desired[job_id]["interval"]
        print(_dim(f"  = {job_id:<20} {interval:<6} (unchanged)"))

    write_crontab(crontab)
    state["stagger"] = stagger
    save_state(state)

    total_active = len(desired)
    print()
    print(f"{total_active} agent{'s' if total_active != 1 else ''} active.")


def cmd_add(args):
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", args.id):
        print(f"Error: invalid id '{args.id}' (use alphanumeric, dashes, underscores)", file=sys.stderr)
        sys.exit(1)

    runtime = args.runtime or "claude"
    model = args.model or ""
    validate_runtime(runtime)
    validate_model(model)

    cron_expr = parse_interval(args.interval)
    contexts = args.context or []
    repo = args.repo or ""
    command = build_cron_command(args.id, args.prompt, args.agentic, contexts, args.workspace, repo or None, runtime, model or None)

    crontab = read_crontab()
    crontab = add_job_to_crontab(crontab, args.id, cron_expr, command)
    write_crontab(crontab)

    state = load_state()
    state["jobs"][args.id] = {
        "interval": args.interval,
        "cron_expr": cron_expr,
        "prompt": args.prompt,
        "agentic": args.agentic,
        "workspace": args.workspace,
        "contexts": contexts,
        "repo": repo,
        "runtime": runtime,
        "model": model,
        "installed_at": now_iso(),
    }
    save_state(state)

    print(f"Added cron job '{args.id}' ({args.interval}): {cron_expr}")
    print(f"  Log: {LOGS_DIR}/{args.id}.log")


def cmd_remove(args):
    crontab = read_crontab()
    tag = f"{TAG_PREFIX}:{args.id}"
    if tag not in crontab:
        print(f"No cron job found with id '{args.id}'", file=sys.stderr)
        sys.exit(1)

    crontab = remove_job_from_crontab(crontab, args.id)
    write_crontab(crontab)

    state = load_state()
    state["jobs"].pop(args.id, None)
    save_state(state)

    print(f"Removed cron job '{args.id}'")


def cmd_list(args):
    state = load_state()
    jobs = state["jobs"]
    if not jobs:
        print("No active jobs")
        return

    stagger_enabled = state.get("stagger", False)

    for job_id, info in jobs.items():
        mode = "agentic" if info.get("agentic") else "text"
        offset = info.get("stagger_offset", 0)
        if stagger_enabled and offset > 0:
            cron_expr, sleep_secs = apply_offset_to_interval(info["interval"], offset)
            mins, secs = divmod(offset, 60)
            if sleep_secs > 0:
                offset_str = f"+{mins}m{secs}s" if mins else f"+{secs}s"
                cron_col = f"{cron_expr} (stagger: {offset_str}, sleep: {sleep_secs}s)"
            else:
                cron_col = f"{cron_expr} (+{offset}s)"
        elif stagger_enabled:
            cron_col = f"{info['cron_expr']} (stagger: base)"
        else:
            cron_col = info["cron_expr"]
        print(f"  {job_id:<20} {cron_col:<30} {mode:<10} \"{info['prompt']}\"")


def print_status_table():
    """Print a human-readable table of agent timing (last run, next run, countdown).

    Returns True if there are jobs to display, False otherwise.
    """
    state = load_state()
    jobs = state["jobs"]
    if not jobs:
        print("No active jobs")
        return False

    now = datetime.now(timezone.utc)
    print(f"  {'AGENT':<20} {'INTERVAL':<10} {'LAST RUN':<22} {'NEXT RUN':<22} {'COUNTDOWN'}")
    print(f"  {'─' * 20} {'─' * 10} {'─' * 22} {'─' * 22} {'─' * 15}")

    for job_id, info in sorted(jobs.items()):
        interval = info.get("interval", "?")
        last_run = info.get("last_run")
        next_run = compute_next_run(last_run, interval) if last_run else None

        last_str = last_run[:19].replace("T", " ") if last_run else "never"
        next_str = next_run[:19].replace("T", " ") if next_run else "—"

        if next_run:
            next_dt = datetime.fromisoformat(next_run)
            delta = next_dt - now
            total_secs = int(delta.total_seconds())
            if total_secs <= 0:
                countdown = "overdue"
            else:
                mins, secs = divmod(total_secs, 60)
                hrs, mins = divmod(mins, 60)
                if hrs:
                    countdown = f"{hrs}h {mins}m {secs}s"
                elif mins:
                    countdown = f"{mins}m {secs}s"
                else:
                    countdown = f"{secs}s"
        else:
            countdown = "—"

        print(f"  {job_id:<20} {interval:<10} {last_str:<22} {next_str:<22} {countdown}")

    return True


def cmd_status(args):
    """Print agent timing table, optionally refreshing every second with --watch."""
    if not getattr(args, "watch", False):
        print_status_table()
        return

    try:
        while True:
            sys.stdout.write("\033[2J\033[H")
            sys.stdout.flush()
            print_status_table()
            time.sleep(1)
    except KeyboardInterrupt:
        print()


def cmd_run(args):
    if not os.path.exists(JOBS_FILE):
        print(f"Error: {JOBS_FILE} not found", file=sys.stderr)
        sys.exit(1)

    with open(JOBS_FILE) as f:
        config = json.load(f)

    job = next((j for j in config.get("jobs", []) if j["id"] == args.id), None)
    if not job:
        print(f"No job with id '{args.id}' in {JOBS_FILE}", file=sys.stderr)
        sys.exit(1)

    runtime = job.get("runtime", "claude")
    if runtime != "claude":
        os.environ["AGENT_RUNTIME"] = runtime

    cmd = [os.path.join(REPO_DIR, "agent-kernel", "run.sh")]
    if job.get("agentic"):
        cmd.append("--agentic")
    if job.get("workspace"):
        cmd += ["--workspace", job["id"]]
    if job.get("repo"):
        cmd += ["--repo", job["repo"]]
    if job.get("model"):
        cmd += ["--model", job["model"]]
    for ctx in job.get("contexts", []):
        cmd += ["--context", ctx]
    cmd.append(job["prompt"])

    print(f"Running {args.id}...")
    os.execv(cmd[0], cmd)


def cmd_clear(args):
    state = load_state()
    if not state["jobs"]:
        print("No jobs to clear")
        return

    crontab = read_crontab()
    count = len(state["jobs"])
    for job_id in list(state["jobs"].keys()):
        crontab = remove_job_from_crontab(crontab, job_id)
    write_crontab(crontab)

    state["jobs"] = {}
    save_state(state)

    print(f"Cleared {count} job(s)")


# ── main ──────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="agent-kernel cron manager")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("apply", help="Sync crontab to match cron-jobs.json")

    p_add = sub.add_parser("add", help="Add a single cron job")
    p_add.add_argument("id", help="Job identifier")
    p_add.add_argument("interval", help="Interval: Nm or Nh")
    p_add.add_argument("prompt", help="Prompt for run.sh")
    p_add.add_argument("--agentic", action="store_true", help="Enable tool use")
    p_add.add_argument("--workspace", action="store_true", help="Run in isolated git worktree")
    p_add.add_argument("--context", action="append", help="Context file path relative to repo root (repeatable)")
    p_add.add_argument("--repo", help="Target repo (e.g. github.com/owner/repo or absolute path)")
    p_add.add_argument("--runtime", default="claude", help="Agent runtime: claude or codex (default: claude)")
    p_add.add_argument("--model", default="", help="Explicit model override (e.g. gpt-5.4)")

    p_rm = sub.add_parser("remove", help="Remove a cron job by ID")
    p_rm.add_argument("id", help="Job identifier")

    sub.add_parser("list", help="List active cron jobs")
    p_status = sub.add_parser("status", help="Show agent timing: last run, next run, countdown")
    p_status.add_argument("--watch", "-w", action="store_true", help="Continuously refresh the status table every 1 second")

    p_run = sub.add_parser("run", help="Run a job once immediately")
    p_run.add_argument("id", help="Job identifier from cron-jobs.json")

    sub.add_parser("clear", help="Remove all agent-kernel cron jobs")

    args = parser.parse_args()
    commands = {
        "apply": cmd_apply,
        "add": cmd_add,
        "remove": cmd_remove,
        "list": cmd_list,
        "status": cmd_status,
        "run": cmd_run,
        "clear": cmd_clear,
    }
    commands[args.command](args)


if __name__ == "__main__":
    print(
        "WARNING: Direct invocation of manage.py is deprecated. "
        "Use 'forge cron <subcommand>' instead.",
        file=sys.stderr,
    )
    main()
