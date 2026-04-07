# Forge Webhook Monitor

> **Note:** The primary interface is now `uv run forge wh`. See the [Forge CLI section](../../README.md#forge-cli) in the root README.

Receives GitHub webhook events and stores them as normalized JSONL for the Forge event system.

## Prerequisites

- Python 3.11+
- `uv` installed: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- A tunnel tool: `gh webhook forward` (GitHub CLI) or [ngrok](https://ngrok.com/download)

## Setup

### 1. Install the webhook server

```bash
uv sync --all-packages
```

If you prefer another install method for `uv`, see: https://docs.astral.sh/uv/getting-started/installation/

If `uv` is not on `PATH` yet after installation, restart your shell or source your shell profile.

### 2. Configure

Copy the example config and fill in your values:

```bash
cp config.example.toml config.toml
```

Edit `config.toml`:

```toml
[webhook]
secret = "your-secret-here"   # Required — generate with: openssl rand -hex 32
port = 8471
events_file = "./events.jsonl"

[trigger]
rules_file = "./trigger-rules.json"

[repo]
name = "owner/repo"           # Required for gh webhook forward
dir = "/path/to/repo"         # Absolute path to repo root
```

Environment variables still override config file values for CI/deploy:

| Env var | Overrides |
|---------|-----------|
| `FORGE_WEBHOOK_SECRET` | `webhook.secret` |
| `FORGE_WEBHOOK_PORT` | `webhook.port` |
| `FORGE_EVENTS_FILE` | `webhook.events_file` |
| `FORGE_TRIGGER_RULES` | `trigger.rules_file` |
| `FORGE_REPO_DIR` | `repo.dir` |
| `FORGE_REPO` | `repo.name` (tunnel.sh only) |

### 3. Start the server

```bash
uv run forge wh
```

> `forge-webhook` still works but is deprecated.

The server listens on `0.0.0.0:<port>` and exposes:

- `POST /webhook` — receives GitHub events
- `GET /health` — health check

### 4. Start the tunnel

```bash
./tunnel.sh
```

The script tries `gh webhook forward` first, then falls back to `ngrok`.

**With `gh webhook forward`**: The tunnel configures the webhook automatically — no manual GitHub setup needed. Requires `repo.name` to be set in config.toml (or `FORGE_REPO` env var).

**With `ngrok`**: Copy the public URL from ngrok's output and configure the webhook manually (see below).

### 5. (ngrok only) Configure the GitHub repo webhook

1. Go to your repo → **Settings** → **Webhooks** → **Add webhook**
2. **Payload URL**: `<ngrok-url>/webhook`
3. **Content type**: `application/json`
4. **Secret**: The value of `webhook.secret` from your config
5. **Events**: Select individual events:
   - Issues
   - Pull requests
   - Issue comments
   - Pull request reviews
6. Save

## Quick start (both server + tunnel)

```bash
uv run forge wh
```

Starts the webhook server and tunnel in a single process. Press `Ctrl+C` to stop both.

Use `uv run forge wh --no-tunnel` to start only the server without the tunnel.
