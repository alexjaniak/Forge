# Contexts

Markdown files that define agent behavior, constraints, and protocols. They are composed into agent system prompts via the template system (see `../templates/`).

## File inventory

| File | Purpose |
|------|---------|
| `CONSTRAINTS.md` | Shared rules all agents must follow (GitHub protocol, code quality, scope discipline, git safety) |
| `HANDOFF.md` | Structured handoff comment format for task completion |
| `IDENTITY.md` | Agent identity and GitHub comment signing requirements |
| `LABELS.md` | GitHub label definitions, lifecycle rules, and epic flow |
| `PLANNER.md` | Planner agent role — scoping, issue creation, PR review |
| `REVIEWER.md` | Code review protocol and quality standards |
| `SUPER.md` | Super agent role — cross-epic review and final quality gate |
| `WORKER.md` | Worker agent role — claim tasks, implement, hand off |
| `WORKSPACE.md` | Worktree isolation, branching, and push conventions |

## How contexts compose

Each agent role uses a subset of these files. Templates (`../templates/*.example.json` in git, `../templates/*.json` locally) declare a `contexts` array that lists which context files to include. At run time, the selected contexts are concatenated into the agent's system prompt.

For example, a worker agent receives `IDENTITY`, `WORKER`, `CONSTRAINTS`, `LABELS`, `HANDOFF`, and `WORKSPACE` — but not `PLANNER`, `SUPER`, or `REVIEWER`.
