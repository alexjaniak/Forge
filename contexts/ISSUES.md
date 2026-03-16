# Creating Issues

This guide covers how to create GitHub issues that Forge agents can pick up and act on.

## Epics

Epics are multi-task parent issues. To create an epic that enters the agent pipeline:

```bash
gh issue create \
  --title "Short descriptive title" \
  --label "type:epic" \
  --label "role:planner" \
  --label "status:ready-for-planning" \
  --body "$(cat <<'EOF'
## Summary
<1-3 sentences describing the goal and motivation>

## Context
<any relevant background, links to related issues/PRs, or constraints>
EOF
)"
```

**Required labels**: `type:epic` + `role:planner` + `status:ready-for-planning`

This is the only way to kick off new work. A planner agent will pick it up, break it into subtasks, and manage the lifecycle from there. Never go straight to `role:worker` — planners need to scope and decompose the work first.

### What makes a good epic

- **Focused scope**: one logical change, not a grab bag of unrelated fixes
- **Clear motivation**: explain *why*, not just *what* — agents make better decisions with context
- **Concrete acceptance criteria**: what does "done" look like?
- **No implementation details**: let the planner decide how to break it down

### Examples

Good:
> **Title**: Buffered atomic logging for agent runs
> **Summary**: Agent run logging currently writes directly to log files via stdout with delimiters. Concurrent cron triggers interleave output. Buffer each run's output and append atomically on completion.

Bad:
> **Title**: Fix logging and also refactor the CLI and update docs
> **Summary**: Several things need fixing.

## Tasks and fixes

You generally don't create `type:task` or `type:fix` issues directly — planners create these as subtasks of epics. If you need a standalone fix outside an epic, use:

```bash
gh issue create \
  --title "Fix: <description>" \
  --label "type:fix" \
  --label "role:planner" \
  --label "status:ready-for-planning"
```

This routes through a planner first so it can assess scope and create worker tasks if needed.

## Linking to epics

Every subtask issue must include `Parent: #N` in its body to link back to the parent epic. Planners handle this automatically when breaking down epics.

## Label reference

See `LABELS.md` for the full label taxonomy and lifecycle rules.
