# Forge

Autonomous agent orchestration platform. Worker, planner, and super agents coordinate via GitHub issues, running in isolated git worktrees.

## Architecture

**Agent roles:**
- **Worker** — picks up `role:worker` issues, implements changes, opens PRs
- **Planner** — scopes epics into subtasks, reviews worker PRs, merges to feature branches
- **Super** — cross-epic review, final quality gate before admin merge

**Coordination model:** GitHub issues and labels serve as shared state. Each issue carries a `status:` label (lifecycle) and a `role:` label (who acts next). Agents transition labels as work flows through the system.

**Worktree isolation:** Each agent runs in its own git worktree, preventing file conflicts between concurrent agents.

## Forge CLI

Unified command-line interface for managing agents.

| Command | Description |
|---------|-------------|
| `forge add <role>` | Add an agent from a template (worker, planner, super) |
| `forge remove <id>` | Remove an agent |
| `forge clear` | Reset all staged agents |
| `forge list` | Show all agents (staged, active, unstaged) |
| `forge status` | Alias for `forge list` |
| `forge cron apply` | Sync staged agent config to live crontab |
| `forge logs` | View agent logs (`-f` to follow) |
| `forge wh` | Start webhook monitor with auto-tunnel |

Install: `pip install -e apps/forge-cli`

## Project structure

```
agent-kernel/    Core runtime — run.sh entry point, cron scheduling
apps/            Applications (forge-cli, web dashboard)
contexts/        Reusable context files that define agent behavior and protocols
templates/       Agent configuration templates (worker.json, planner.json, super.json)
```

- **[agent-kernel](agent-kernel/README.md)** — one-shot Claude CLI wrapper with context assembly, worktree management, and cron-friendly execution
- **[apps/forge-cli](apps/forge-cli/)** — `forge` CLI for agent lifecycle and orchestration
- **[apps/web](apps/web/)** — Next.js web dashboard for monitoring agents and events
- **[contexts](contexts/)** — modular `.md` files shaping agent identity, roles, constraints, handoff protocol, labels, and workspace rules
- **[templates](templates/)** — JSON templates defining agent interval, prompt, contexts, and flags

## Getting started

```bash
git clone https://github.com/alexjaniak/Forge.git
cd Forge
./install.sh
```

The install script checks prerequisites, installs dependencies, and generates config files.

### Manual setup

If you prefer manual setup:
1. `pip install -e apps/forge-cli` — Install the Forge CLI
2. `pip install -e apps/webhook-monitor` — Install the webhook server
3. `cd apps/web && npm install` — Install dashboard dependencies
4. `cp agent-kernel/.env.example agent-kernel/.env` — Configure credentials
5. `cp apps/webhook-monitor/config.example.toml apps/webhook-monitor/config.toml` — Configure webhooks
