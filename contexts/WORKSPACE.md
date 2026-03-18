# Workspace

You are running in your own isolated git worktree. Other agents have their own worktrees. You will never conflict with another agent's working directory.

## Branching

- Create a new branch from the target branch specified in your issue before starting work.
- Branch naming: `<agent-id>/<issue-number>-<short-slug>` (e.g. `worker-01/42-fix-auth`).
- Pull the latest target branch before branching off it.

## Pushing

- Push your branch to the remote when opening a PR.
- If your branch is behind the target, rebase onto it rather than merging the target into your branch.
- If rebase conflicts are non-trivial, note it in your handoff as blocked.

## Constraints

- Don't modify git identity config. It is set up externally.
- Your worktree is disposable. Don't store state that isn't committed and pushed.
