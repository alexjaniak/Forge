# agent-kernel

One-shot Claude CLI wrapper. Cron-friendly.

## Setup

```bash
# 1. Get a long-lived CLI token
claude setup-token

# 2. Create your .env
cp agent-kernel/.env.example agent-kernel/.env
# Paste your token as CLAUDE_CODE_OAUTH_TOKEN in .env
```

## Files

| File | Purpose |
|------|---------|
| `run.sh` | Invokes `claude` CLI once and exits. |
| `.env` | Auth and overrides (gitignored). See `.env.example`. |
| `cron/` | Cron management subsystem. See [`cron/README.md`](cron/README.md). |
| `../contexts/` | Library of reusable context files. See [Context Library](#context-library). |

## Usage

```bash
# Direct run against a target repo
./agent-kernel/run.sh --repo "$PWD" "Summarize recent commits"

# With context files (paths relative to repo root)
./agent-kernel/run.sh --repo "$PWD" --context contexts/IDENTITY.md "Check for stale PRs and comment on them"

# Piped
echo "List open issues" | ./agent-kernel/run.sh --repo "$PWD"
```

## Context Library

Reusable context files live in `contexts/` at the repo root. Each `.md` file is a self-contained context snippet.

```
contexts/
  IDENTITY.md      # agent identity and rules
  CONSTRAINTS.md   # operational constraints
  PLANNER.md       # planner agent instructions
  WORKER.md        # worker agent instructions
  HANDOFF.md       # task handoff protocol
  LABELS.md        # GitHub issue labeling conventions
  WORKSPACE.md     # git worktree and branching guidelines
```

Select which contexts to include per invocation with `--context <path>` (repeatable, relative to repo root).

Cron jobs can also specify contexts in `cron-jobs.json`:
```json
{
  "id": "daily-summary",
  "interval": "1h",
  "prompt": "Summarize recent activity",
  "contexts": ["contexts/IDENTITY.md"]
}
```

## Innies Proxy (Optional)

[Innies](https://github.com/shirtlessfounder/innies/tree/main/docs/onboarding) is a CLI proxy that routes `claude` calls through a central API with buyer-key authentication, useful for teams sharing a single billing account.

### Install

```bash
npm install -g innies
innies login --token in_live_...
```

### Configure

Set `USE_INNIES=true` in your `.env` file:

```bash
# In agent-kernel/.env
USE_INNIES=true
```

See `.env.example` for the full template.

### Behavior

When `USE_INNIES=true`, all agent `claude` invocations route through `innies claude --` instead of calling `claude` directly. No other changes are needed — `run.sh` handles the proxy transparently.

### Verify

```bash
innies doctor
```

This checks connectivity and confirms your token is valid.

## How it works

1. `--context <path>` flags assemble a system prompt from context files (paths relative to repo root)
2. System prompt is passed via `--append-system-prompt` (preserves Claude's built-in capabilities)
3. Your prompt goes as the message argument
4. `--dangerously-skip-permissions` is on by default for unattended runs
5. Tool access is always enabled for unattended runs.
6. `--workspace <id>` runs inside an isolated git worktree under the target repo.
