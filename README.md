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
| `forge rm <id>` | Remove staged agents by ID |
| `forge apply` | Sync staged agent config to live crontab |
| `forge diff` | Show git-style staged vs applied config changes |
| `forge reset [agent-id]` | Reset staged config to match applied state |
| `forge run <id>` | Run an agent once immediately |
| `forge clear` | Clear staged config (`cron-jobs.json`) |
| `forge status` | Show staged changes and applied agents |
| `forge logs` | View agent logs (`-f` to follow) |
| `forge ui` | Start the web dashboard |
| `forge locks list` | Show all held issue/PR locks across repos |
| `forge locks clear` | Clear stale locks (`--all` for all, `--all --force` to skip confirm) |
| `forge wh` | Start webhook monitor with auto-tunnel |
| `forge kill <id>` | Terminate one running managed agent |
| `forge kill --all` | Terminate all running managed agents |

Run from the repo workspace: `uv run forge --help`

## Lock system

File-based locking prevents multiple agents from claiming the same GitHub issue or PR simultaneously. Locks use atomic `mkdir` operations — no external dependencies required.

**How it works:**

1. **Preflight** — before an agent run, `run.sh` queries available `status:ready-for-work` issues and attempts to lock one
2. **Atomic acquire** — `mkdir` is used as an atomic lock primitive; if the directory already exists, the lock is held
3. **Stale detection** — if the holding PID is no longer alive, the lock is automatically reclaimed
4. **Pre-assignment** — the locked issue number is exported as `FORGE_LOCKED_ISSUE` so the agent knows which issue to work on
5. **Cleanup** — locks are released on agent exit via a trap handler; stale locks can be cleared manually

**Lock directory layout:**

```
<repo-dir>/locks/
  issues/<number>.lock/info.json
  prs/<number>.lock/info.json
```

Each `info.json` contains `{"agent": "<id>", "pid": <pid>, "claimed_at": "<ISO timestamp>"}`.

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `FORGE_LOCKED_ISSUE` | Issue number locked for this agent run (set by preflight) |
| `WORK_REPO_DIR` | Repository directory where locks are stored |

**CLI commands:**

| Command | Description |
|---------|-------------|
| `forge locks list` | Show all held locks across repos with agent, PID, age, and status |
| `forge locks clear` | Clear stale locks (dead PIDs) |
| `forge locks clear --all` | Clear all locks (prompts for confirmation) |
| `forge locks clear --all --force` | Clear all locks without confirmation |

**Shell library** (`agent-kernel/locks.sh`):

| Function | Description |
|----------|-------------|
| `lock_acquire <type> <number> <agent_id>` | Acquire a lock (type: `issue` or `pr`) |
| `lock_release <type> <number>` | Release a lock |
| `lock_check <type> <number>` | Check if locked (exit 0=locked, 1=free) |
| `lock_list <repo_dir>` | List all held locks |
| `lock_clear_stale <repo_dir>` | Remove locks with dead PIDs |
| `lock_clear_all <repo_dir>` | Force-remove all locks |

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
curl -LsSf https://astral.sh/uv/install.sh | sh
./install.sh
```

If you prefer another install method, see the official uv installation guide: https://docs.astral.sh/uv/getting-started/installation/

If `uv` is not available immediately after installation, restart your shell or source your shell profile before running `./install.sh`.

The install script checks prerequisites, syncs the Python workspace with `uv`, installs dependencies, and generates config files.

### Manual setup

If you prefer manual setup:
1. `curl -LsSf https://astral.sh/uv/install.sh | sh` — Install `uv`
2. `uv sync --all-packages` — Sync the Forge Python workspace
3. `cd apps/web && npm install` — Install dashboard dependencies
4. `cp agent-kernel/.env.example agent-kernel/.env` — Configure credentials
5. `cp apps/forge-cli/config.example.toml apps/forge-cli/config.toml` — Configure webhooks
6. `uv run forge --help` — Verify the Forge CLI is available
