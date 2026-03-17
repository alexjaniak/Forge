# Templates

JSON files that define the runtime configuration for each agent role. Each template specifies which contexts to include in the agent's system prompt, along with scheduling metadata and the target repo.

## Template format

```json
{
  "interval": "2m",
  "prompt": "The instruction given to the agent each run.",
  "contexts": ["contexts/IDENTITY.md", "contexts/WORKER.md", "..."],
  "repo": "github.com/owner/repo"
}
```

| Field | Description |
|-------|-------------|
| `interval` | Cron scheduling interval between runs |
| `prompt` | The task prompt passed to the agent |
| `contexts` | Ordered list of context files composed into the system prompt |
| `repo` | Target repository for isolated worktree creation and agent execution |

## Available templates

| Template | Role | Contexts |
|----------|------|----------|
| `worker.json` | Claim and implement a single task | Identity, Worker, Constraints, Labels, Handoff, Workspace |
| `planner.json` | Review state, create issues, process handoffs | Identity, Planner, Constraints, Labels, Handoff, Workspace |
| `super.json` | Cross-epic review and quality gate | Identity, Super, Reviewer, Constraints, Labels, Workspace |

## Usage

Templates are loaded by the Forge CLI (`apps/forge-cli`) and web dashboard (`apps/web`) to launch agent runs via `agent-kernel/run.sh`.

Forge-managed agents always run with tool access in isolated worktrees under the target repo. Templates no longer expose separate booleans for those runtime behaviors.
