# agent-kernel/cron

> **Note:** The primary interface is now `forge cron`. See the [Forge CLI section](../../README.md#forge-cli) in the root README.

Declarative cron management for agent-kernel. Python 3, no dependencies.

## Quick start

```bash
# 1. Define jobs in cron-jobs.json
# 2. Sync crontab
./agent-kernel/cron/manage.py apply
```

## cron-jobs.json

Source of truth for desired cron state. Checked into git.

```json
{
  "jobs": [
    {
      "id": "worker",
      "interval": "5m",
      "prompt": "Check for stale PRs",
      "agentic": true,
      "contexts": ["contexts/IDENTITY.md", "contexts/WORKER.md"],
      "model": "gpt-5.4",
      "workspace": true,
      "repo": "github.com/owner/repo",
      "enabled": true
    }
  ]
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Unique job identifier. |
| `interval` | string | required | `Nm` (minutes) or `Nh` (hours). |
| `prompt` | string | required | Prompt passed to `run.sh`. |
| `agentic` | bool | `false` | Enable tool use (`--agentic`). |
| `repo` | string | `""` | Target repo (e.g. `"github.com/owner/repo"`). When omitted, the agent targets the Forge repo itself. |
| `contexts` | string[] | `[]` | List of context file paths relative to repo root, each passed as `--context` to `run.sh`. |
| `model` | string | `""` | Optional model override passed to `run.sh --model`. |
| `workspace` | bool | `false` | Run the agent in an isolated git worktree (`--workspace <id>`). |
| `enabled` | bool | `true` | Set `false` to remove from crontab without deleting config. |

## Commands

```bash
# Declarative — sync crontab to match cron-jobs.json
./agent-kernel/cron/manage.py apply

# Imperative — one-off add/remove
./agent-kernel/cron/manage.py add <id> <interval> "<prompt>" [--agentic] [--model <model>]
./agent-kernel/cron/manage.py remove <id>

# Inspect
./agent-kernel/cron/manage.py list

# Wipe all agent-kernel cron jobs
./agent-kernel/cron/manage.py clear
```

## State tracking

`cron-state.json` is auto-generated and gitignored. It tracks what's actually installed in crontab so `list` works without parsing `crontab -l`.

If the state file gets deleted or out of sync, just run `apply` — it reconverges.

Agent definitions often originate from `forge add`, which now reads tracked `templates/*.example.json` defaults and local `templates/*.json` working copies. The tracked examples should keep the generic `github.com/owner/repo` placeholder; local working copies are where repo-specific values belong.

## Logs

Each job logs to `agent-kernel/logs/<id>.log` (persistent, gitignored).

### Pretty log viewer

Color-coded, multi-agent log viewer:

```bash
# Tail all agent logs interleaved
./agent-kernel/logs/view.sh

# Tail a specific agent
./agent-kernel/logs/view.sh worker-01

# Follow live (all agents)
./agent-kernel/logs/view.sh -f

# Follow a specific agent live
./agent-kernel/logs/view.sh -f worker-01
```
