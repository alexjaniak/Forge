# forge-cli

Agent orchestration CLI for Forge. Manage agents, cron jobs, webhooks, and logs from a single command.

## Installation

```bash
pip install -e apps/forge-cli
```

Requires Python 3.11+. Dependencies: `click>=8.0`, `forge-webhook>=0.1.0`.

## Commands

### `forge add`

Add an agent from a template.

```
forge add [AGENT_TYPE] [--id ID] [--interval INTERVAL] [--list]
```

| Flag | Description |
|------|-------------|
| `AGENT_TYPE` | Template name (e.g. `worker`, `planner`) |
| `--id ID` | Custom agent ID (default: auto-generate, e.g. `worker-01`) |
| `--interval INTERVAL` | Override template interval (e.g. `5m`, `1h`) |
| `--list` | List available templates |

```bash
# Add a worker agent with default settings
forge add worker

# Add with custom ID and interval
forge add worker --id worker-05 --interval 10m

# List available templates
forge add --list
```

The agent is staged in `cron-jobs.json`. Run `forge cron apply` to activate.

### `forge remove`

Remove an agent by ID.

```
forge remove AGENT_ID
```

```bash
forge remove worker-03
```

Removes the agent from `cron-jobs.json`. Run `forge cron apply` to deactivate.

### `forge list` / `forge status`

Show all agents grouped by state: staged, active, and unstaged (active but not in config).

```
forge list
```

Displays each agent's ID, role, interval, last run time, and next run countdown. Highlights pending changes (new, removed, interval changed) that require `forge cron apply`.

### `forge logs`

View agent logs with color-coded output.

```
forge logs [AGENT_ID] [-f | --follow] [-n LINES]
```

| Flag | Description |
|------|-------------|
| `AGENT_ID` | Filter logs to a specific agent (optional) |
| `-f`, `--follow` | Follow logs live |
| `-n LINES` | Number of lines to show (default: 50) |

```bash
# View last 50 lines of all agent logs
forge logs

# Follow a specific agent's logs
forge logs worker-01 -f

# Show last 200 lines
forge logs -n 200
```

### `forge clear`

Reset staged config — remove all agents from `cron-jobs.json`.

```
forge clear [--yes | -y]
```

| Flag | Description |
|------|-------------|
| `-y`, `--yes` | Skip confirmation prompt |

```bash
forge clear -y
```

Run `forge cron apply` afterwards to deactivate the cleared agents.

### `forge cron`

Manage agent cron jobs directly.

#### `forge cron apply`

Sync the system crontab to match `cron-jobs.json`.

```bash
forge cron apply
```

#### `forge cron add`

Add a single cron job.

```
forge cron add ID INTERVAL PROMPT [--agentic] [--workspace] [--context TEXT] [--repo REPO]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `ID` | Job identifier |
| `INTERVAL` | Schedule interval (e.g. `5m`, `1h`) |
| `PROMPT` | Prompt text for the agent |

**Options:**

| Flag | Description |
|------|-------------|
| `--agentic` | Enable tool use |
| `--workspace` | Run in isolated git worktree |
| `--context TEXT` | Context file path (repeatable) |
| `--repo REPO` | Target repo |

```bash
forge cron add summary-bot 1h "Summarize recent activity" --context contexts/IDENTITY.md
```

#### `forge cron remove`

Remove a cron job by ID.

```bash
forge cron remove summary-bot
```

#### `forge cron run`

Run a job once immediately.

```bash
forge cron run worker-01
```

#### `forge cron clear`

Remove all agent-kernel cron jobs from the system crontab.

```bash
forge cron clear
```

### `forge wh`

Start the webhook monitor server with optional auto-tunnel.

```
forge wh [--port PORT] [--no-tunnel]
```

| Flag | Description |
|------|-------------|
| `--port PORT` | Server port (default: `$FORGE_WEBHOOK_PORT` or `8471`) |
| `--no-tunnel` | Start only the server without the tunnel |

```bash
# Start with auto-tunnel
forge wh

# Start on a custom port without tunnel
forge wh --port 9000 --no-tunnel
```

Auto-tunnel uses `gh webhook forward` (preferred) or `ngrok` if available. Tunnel forwards GitHub events (`issues`, `pull_request`, `issue_comment`, `pull_request_review`) to the local server.

## Configuration

| File | Location | Purpose |
|------|----------|---------|
| `cron-jobs.json` | `agent-kernel/cron/cron-jobs.json` | Staged agent definitions (jobs, intervals, prompts) |
| `cron-state.json` | `agent-kernel/cron/cron-state.json` | Active cron state (last run times, managed by the system) |
| `config.toml` | `apps/webhook-monitor/config.toml` | Webhook config (`repo.name`, `webhook.secret`) |
| Templates | `templates/*.json` | Agent templates used by `forge add` |

### Environment variables

| Variable | Description |
|----------|-------------|
| `FORGE_REPO` | GitHub repo name (e.g. `owner/repo`) for webhook forwarding |
| `FORGE_WEBHOOK_SECRET` | Webhook secret for signature verification |
| `FORGE_WEBHOOK_PORT` | Webhook server port (default: `8471`) |
