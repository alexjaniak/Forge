# DACL

Autonomous agent orchestration. Planner and worker agents run in isolated git worktrees, coordinating via GitHub issues.

## Repo structure

```
agent-kernel/    One-shot Claude CLI wrapper, cron-friendly
contexts/        Reusable context library for agent instructions
```

- **[agent-kernel](agent-kernel/README.md)** — invoke Claude CLI with context files, run unattended via cron
- **[contexts](contexts/)** — modular `.md` files that shape agent behavior (identity, constraints, planner/worker roles, handoff protocol, labels, workspace rules)

## How it works

Agents are stateless one-shot CLI invocations. Each run:

1. `agent-kernel/run.sh` assembles a system prompt from selected context files
2. Invokes `claude` CLI in either text-only (`--print`) or agentic mode
3. Optionally runs inside an isolated git worktree (`--workspace`)

Cron jobs drive recurring agent runs. See [`agent-kernel/cron/README.md`](agent-kernel/cron/README.md).

## Forge CLI

Unified command-line interface for agent orchestration.

```
forge add worker              # add a new worker agent
forge add planner             # add a new planner agent
forge remove <id>             # remove an agent
forge cron apply              # sync crontab
forge cron status --watch     # live agent timing
forge logs -f                 # follow all logs
forge unorphan <id>            # restore orphaned agent to config
forge wh                      # start webhook monitor
```

Install: `pip install -e apps/forge-cli`

## Getting started

See [agent-kernel/README.md](agent-kernel/README.md) for setup and usage.
