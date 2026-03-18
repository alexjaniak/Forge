# forge-cli

Agent orchestration CLI for Forge. Manage agents, cron jobs, webhooks, and logs from a single command.

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

The agent is staged in `cron-jobs.json`. Run `uv run forge cron apply` to activate.

### `forge remove`

Remove an agent by ID.

`uv run forge remove AGENT_ID`

```bash
uv run forge remove worker-03
```

Removes the agent from `cron-jobs.json`. Run `uv run forge cron apply` to deactivate.

### `forge list` / `forge status`

Show all agents grouped by state: staged, active, and unstaged (active but not in config).

`uv run forge list`

Displays each agent's ID, role, interval, last run time, and next run countdown. Highlights pending changes (new, removed, interval changed) that require `uv run forge cron apply`.

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

Run `uv run forge cron apply` afterwards to deactivate the cleared agents.

### `forge cron`

Manage agent cron jobs directly.

#### `forge cron apply`

Sync the system crontab to match `cron-jobs.json`.

```bash
uv run forge cron apply
```

#### `forge cron add`

Add a single cron job.

`uv run forge cron add ID INTERVAL PROMPT [--agentic] [--workspace] [--context TEXT] [--repo REPO]`

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
uv run forge cron add summary-bot 1h "Summarize recent activity" --context contexts/IDENTITY.md
```

#### `forge cron remove`

Remove a cron job by ID.

```bash
uv run forge cron remove summary-bot
```

#### `forge cron run`

Run a job once immediately.

```bash
uv run forge cron run worker-01
```

#### `forge cron clear`

Remove all agent-kernel cron jobs from the system crontab.

```bash
uv run forge cron clear
```

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
| `config.toml` | `apps/forge-cli/config.toml` | Bundled webhook config (`repo.name`, `webhook.secret`) |
| Templates | `templates/*.json` | Agent templates used by `forge add` |

### Environment variables

| Variable | Description |
|----------|-------------|
| `FORGE_REPO` | GitHub repo name (e.g. `owner/repo`) for webhook forwarding |
| `FORGE_WEBHOOK_SECRET` | Webhook secret for signature verification |
| `FORGE_WEBHOOK_PORT` | Webhook server port (default: `8471`) |

### Webhook setup

`forge wh` uses the bundled config under `apps/forge-cli/`.

```bash
cp apps/forge-cli/config.example.toml apps/forge-cli/config.toml
```

Edit `apps/forge-cli/config.toml`:

```toml
[webhook]
secret = "your-secret-here"
port = 8471
events_file = "apps/forge-cli/events.jsonl"

[trigger]
rules_file = "apps/forge-cli/trigger-rules.json"

[repo]
name = "owner/repo"
dir = "/absolute/path/to/Forge"
```

Start the bundled webhook server with `uv run forge wh`. It will read `apps/forge-cli/config.toml` automatically when run from the repo root, and environment variables still override config values for CI or local overrides.
