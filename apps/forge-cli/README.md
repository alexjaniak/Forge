# forge-cli

Agent orchestration CLI for Forge. Manage staged/applied agents, webhooks, logs, and the local UI from a single command.

## Installation

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
uv sync --all-packages
uv run forge --help
```

If you prefer another install method for `uv`, see: https://docs.astral.sh/uv/getting-started/installation/

If `uv` is not on `PATH` yet after installation, restart your shell or source your shell profile.

Run Forge commands from the repo root with `uv run forge ...`. Requires Python 3.11+. Dependencies: `click>=8.0`, `forge-webhook>=0.1.0`.

## Commands

### `forge add`

Add an agent from a template.

`uv run forge add [AGENT_TYPE] [--id ID] [--interval INTERVAL] [--list]`

| Flag | Description |
|------|-------------|
| `AGENT_TYPE` | Template name (e.g. `worker`, `planner`) |
| `--id ID` | Custom agent ID (default: auto-generate, e.g. `worker-01`) |
| `--interval INTERVAL` | Override template interval (e.g. `5m`, `1h`) |
| `--list` | List available templates |

```bash
# Add a worker agent with default settings
uv run forge add worker

# Add with custom ID and interval
uv run forge add worker --id worker-05 --interval 10m

# List available templates
uv run forge add --list
```

The agent is staged in `cron-jobs.json`. Run `uv run forge apply` to activate.

### `forge rm`

Remove an agent by ID.

`uv run forge rm AGENT_ID`

```bash
uv run forge rm worker-03
```

Removes the agent from `cron-jobs.json`. Run `uv run forge apply` to deactivate.

### `forge status`

Show the git-style staged vs applied agent status view.

`uv run forge status`

Displays pending staged changes (`new`, `modified`, `deleted`) plus the currently applied agents with last/next run timing. A staged change to any diffed field is surfaced as `modified`.

### `forge diff`

Show field-by-field differences between staged config and applied state.

`uv run forge diff`

Highlights changes to `interval`, `prompt`, `contexts`, `repo`, `runtime`, `model`, and `enabled`.

### `forge apply`

Apply staged config to the managed crontab.

`uv run forge apply`

### `forge logs`

View agent logs with color-coded output.

`uv run forge logs [AGENT_ID] [-f | --follow] [-n LINES]`

| Flag | Description |
|------|-------------|
| `AGENT_ID` | Filter logs to a specific agent (optional) |
| `-f`, `--follow` | Follow logs live |
| `-n LINES` | Number of lines to show (default: 50) |

```bash
# View last 50 lines of all agent logs
uv run forge logs

# Follow a specific agent's logs
uv run forge logs worker-01 -f

# Show last 200 lines
uv run forge logs -n 200
```

### `forge clear`

Reset staged config — remove all agents from `cron-jobs.json`.

`uv run forge clear [--yes | -y]`

| Flag | Description |
|------|-------------|
| `-y`, `--yes` | Skip confirmation prompt |

```bash
uv run forge clear -y
```

Run `uv run forge apply` afterwards to deactivate the cleared agents.

### `forge reset`

Discard staged changes and restore the staged config from applied state.

`uv run forge reset`

### `forge run`

Run a single agent immediately.

`uv run forge run AGENT_ID`

### `forge locks`

Inspect repo/issue lock state used by the agent kernel.

`uv run forge locks list`

### `forge ui`

Start the local Forge web UI.

`uv run forge ui`

### `forge wh`

Start the webhook monitor server with optional auto-tunnel.

`uv run forge wh [--port PORT] [--no-tunnel]`

| Flag | Description |
|------|-------------|
| `--port PORT` | Server port (default: `$FORGE_WEBHOOK_PORT` or `8471`) |
| `--no-tunnel` | Start only the server without the tunnel |

```bash
# Start with auto-tunnel
uv run forge wh

# Start on a custom port without tunnel
uv run forge wh --port 9000 --no-tunnel
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
