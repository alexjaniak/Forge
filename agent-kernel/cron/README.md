# agent-kernel/cron

> **Note:** The primary interface is now `forge cron`. See the [Forge CLI section](../../README.md#forge-cli) in the root README.

Declarative cron management for agent-kernel. Python 3, no dependencies.

## Quick start

```bash
# 1. Define jobs in cron-jobs.json
# 2. Sync crontab
./agent-kernel/cron/manage.py apply
```

Each job must declare a `repo`. Managed cron jobs always run with tool access in an isolated git worktree at `<target-repo>/.worktrees/<id>`.

## cron-jobs.json

Source of truth for desired cron state. Checked into git.

```json
{
  "jobs": [
    {
      "id": "worker",
      "interval": "5m",
      "prompt": "Check for stale PRs",
      "contexts": ["contexts/IDENTITY.md", "contexts/WORKER.md"],
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
| `repo` | string | required | Target repo (e.g. `"github.com/owner/repo"`). |
| `contexts` | string[] | `[]` | List of context file paths relative to repo root, each passed as `--context` to `run.sh`. |
| `enabled` | bool | `true` | Set `false` to remove from crontab without deleting config. |

Managed cron jobs always run with tool access in an isolated worktree named after the job ID under the target repo, so those runtime behaviors are no longer configured per job.

## Commands

```bash
# Declarative — sync crontab to match cron-jobs.json
./agent-kernel/cron/manage.py apply

# Imperative — one-off add/remove
./agent-kernel/cron/manage.py add <id> <interval> "<prompt>" --repo github.com/owner/repo
./agent-kernel/cron/manage.py remove <id>

# Inspect
./agent-kernel/cron/manage.py list

# Wipe all agent-kernel cron jobs
./agent-kernel/cron/manage.py clear
```

## State tracking

`cron-state.json` is auto-generated and gitignored. It tracks what's actually installed in crontab so `list` works without parsing `crontab -l`.

If the state file gets deleted or out of sync, just run `apply` — it reconverges.

## Logs

Buffered runs append to `agent-kernel/logs/<target>.log` (persistent, gitignored):

- Cron-managed jobs write to `agent-kernel/logs/<job_id>.log`.

Each completed run is appended atomically as a buffered block starting with `=== RUN <timestamp> duration=<N>s exit=<code> ===`. Workspace lock skips are recorded as `=== SKIP <timestamp> reason="<...>" ===`.

Cron-managed agents always run with tool access in an isolated worktree named after the job ID.

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
