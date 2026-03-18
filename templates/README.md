# Templates

Tracked `*.example.json` files define the baseline runtime configuration for each agent role. Local `*.json` working copies are generated from those examples and are intended for repo-specific edits such as the target repo value.

## Template format

```json
{
  "interval": "2m",
  "prompt": "The instruction given to the agent each run.",
  "contexts": ["contexts/IDENTITY.md", "contexts/WORKER.md", "..."],
  "model": "gpt-5.4",
  "agentic": true,
  "workspace": true,
  "repo": "github.com/owner/repo"
}
```

| Field | Description |
|-------|-------------|
| `interval` | Cron scheduling interval between runs |
| `prompt` | The task prompt passed to the agent |
| `contexts` | Ordered list of context files composed into the system prompt |
| `model` | Optional model override passed through to `run.sh --model` |
| `agentic` | Whether the agent runs in agentic mode with tool access |
| `workspace` | Whether the agent gets an isolated git worktree |
| `repo` | Target repo for the agent run; tracked examples should keep the generic placeholder |

## Available templates

| Template | Role | Contexts |
|----------|------|----------|
| `worker.example.json` | Claim and implement a single task | Identity, Worker, Constraints, Labels, Handoff, Workspace |
| `planner.example.json` | Review state, create issues, process handoffs | Identity, Planner, Constraints, Labels, Handoff, Workspace |
| `super.example.json` | Cross-epic review and quality gate | Identity, Super, Reviewer, Constraints, Labels, Workspace |

## Usage

Forge prefers local `templates/*.json` working copies when present and falls back to tracked `templates/*.example.json` files otherwise. `./install.sh` creates the working copies for you. Edit the local `*.json` files for day-to-day use; only update `*.example.json` when you need to change the tracked defaults.
