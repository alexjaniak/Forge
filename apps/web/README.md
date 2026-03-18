# Forge Dashboard

Next.js web dashboard for the Forge agent orchestration platform. Displays agent status, streams live logs via SSE, shows GitHub events, and lists live-updating GitHub issues.

## Setup

```bash
cd apps/web
npm install
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000).

## Architecture

### App Router Structure

The dashboard is a single-page app built on Next.js App Router with server-side API routes that read directly from the filesystem.

```
src/app/
├── layout.tsx            # Root layout (Geist Mono font, metadata)
├── page.tsx              # Main page — renders ResizableLayout
├── globals.css           # One Dark theme, Tailwind v4 config
└── api/
    ├── agents/
    │   ├── route.ts          # GET (list) / POST (create) agents
    │   ├── apply/route.ts    # POST — run manage.py apply
    │   ├── clear/route.ts    # POST — reset staged config
    │   └── [id]/
    │       ├── route.ts      # DELETE agent
    │       └── force-run/route.ts  # POST — spawn agent run
    ├── logs/
    │   ├── route.ts          # GET — all agent logs (batch)
    │   ├── [agentId]/route.ts    # GET — single agent logs with offset
    │   └── stream/route.ts       # GET — SSE live log streaming
    ├── events/
    │   └── route.ts          # GET — GitHub events from JSONL
    └── issues/
        └── route.ts          # GET — GitHub issues with 5s cache
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| **ResizableLayout** | `resizable-layout.tsx` | Three-panel layout: sidebar (agents), top-right (logs), bottom-right (events). Panels are resizable with drag handles and collapsible on double-click. Sizes persist to localStorage. |
| **AgentPanel** | `agent-panel.tsx` | Lists agents with status badges (STAGED, ACTIVE, MODIFIED, ORPHAN), role badges, interval/countdown info, and current locked issue links when present. Supports add, delete, force-run, apply, and clear actions. Auto-refreshes every 5s. |
| **LogsPanel** | `logs-panel.tsx` | Streams logs via SSE (`/api/logs/stream`) with polling fallback (5s). Tabs for each agent plus an "All" view. Parses log blocks delimited by `=== RUN ===` / `=== END RUN ===` markers. Max 200 blocks displayed. |
| **EventsPanel** | `events-panel.tsx` | Polls `/api/events` every 3s. Shows GitHub event cards with action badges (color-coded), issue numbers, actors, labels. Max 50 events displayed. |
| **IssuesPanel** | `issues-panel.tsx` | Connects to `/api/issues/stream` for live issue snapshots with `/api/issues` polling fallback. Shows GitHub issues with label badges (color-coded by status/role/type) plus the active agent holding each issue lock when present. Filterable by status and role labels. Audio alert only when an issue newly gains `role:admin`. |

### Data Flow

```
Filesystem                          API Routes              Components
─────────────────────────────────   ─────────────────────   ──────────────
agent-kernel/cron/cron-jobs.json  → GET /api/agents       → AgentPanel
agent-kernel/cron/cron-state.json → GET /api/agents       → AgentPanel
agent-kernel/logs/{id}.log        → GET /api/logs/stream  → LogsPanel (SSE)
apps/webhook-monitor/events.jsonl → GET /api/events       → EventsPanel
gh issue list (via CLI)             → GET /api/issues       → IssuesPanel fallback
GitHub events JSONL                 → GET /api/issues/stream → IssuesPanel live snapshots
templates/{type}.json             → POST /api/agents      → (agent creation)
.worktrees/{id}/.agent.lock       → GET /api/agents       → (running detection)
```

All paths are resolved relative to the repo root via `src/lib/paths.ts`. The repo root defaults to two levels up from `apps/web/` unless `FORGE_REPO_ROOT` is set.

## API Routes

### `GET /api/agents`

Returns all agents with computed status and metadata. Reads staged config from `cron-jobs.json`, active state from `cron-state.json`, and issue lock ownership from `locks/issues/*.lock/info.json`. Status is derived by comparing both:

- **staged** — in jobs but not state
- **active** — in both with matching interval
- **modified** — in both but interval differs
- **orphan** — in state but not jobs

Running state is detected via `.agent.lock` PID files in agent worktrees. Agent cards also surface active issue lock ownership from repo lock metadata when a live lock is present.

When an agent holds a valid issue lock under `locks/issues/<number>.lock/info.json`, the response also includes:

- `lockedIssue.number`
- `lockedIssue.claimedAt`
- `lockedIssue.repo`
- `lockedIssue.repoUrl`
- `lockedIssue.issueUrl`

Malformed lock payloads, missing `info.json`, and stale locks with dead PIDs are ignored.

### `POST /api/agents`

Creates a new agent. Body: `{ type: "worker"|"planner", id?: string, interval?: string }`. Loads defaults from `templates/{type}.json`. Auto-generates ID as `{type}-{N}` if not provided.

### `DELETE /api/agents/[id]`

Removes an agent from the staged config.

### `POST /api/agents/[id]/force-run`

Spawns a detached background process running `run.sh` with the agent's config. Output goes to the agent's log file.

### `POST /api/agents/apply`

Runs `manage.py apply` to activate staged config changes. Returns stdout/stderr.

### `POST /api/agents/clear`

Resets staged config to empty.

### `GET /api/logs/[agentId]?offset={n}`

Returns log content for a single agent starting from byte offset. On first read (offset=0), if the file exceeds 64KB only the last 64KB is returned. Agent ID is validated against `/^[a-z][a-z0-9-]{0,63}$/` to prevent path traversal.

### `GET /api/logs/stream`

Server-Sent Events endpoint for live log streaming. Uses `fs.watch()` on log files and the logs directory. Optional `?agentId=` param to filter to one agent. Sends incremental chunks (max 64KB per event). Handles log rotation by detecting file truncation.

### `GET /api/events?offset={n}`

Returns up to 50 GitHub events from `apps/webhook-monitor/events.jsonl`, parsed from newline-delimited JSON.

### `GET /api/issues`
Returns open GitHub issues via `gh issue list`. Response cached server-side for 5s. Returns `{ issues, labels, repo }`, where each issue may also include `workingAgentId` and `workingLock` from repo issue locks, and `labels` is the hardcoded canonical `status`, `role`, and `type` label set defined in app source so the Issues tab can render filter chips even when a label has zero open matches.

Each issue may also include additive lock metadata when a valid issue lock exists:

- `workingAgentId`
- `workingLock.claimedAt`
- `workingLock.repo`
- `workingLock.repoUrl`
- `workingLock.issueUrl`

Malformed lock payloads, missing `info.json`, and stale locks with dead PIDs are ignored.

### `GET /api/issues/stream`

Server-Sent Events endpoint for live issue snapshots. Sends an initial `{ issues, labels, repo }` snapshot immediately on connect, then emits updated snapshots when the GitHub event feed changes in ways that affect the Issues tab. Live snapshots include the same additive issue-lock metadata as `GET /api/issues`. The frontend falls back to polling `GET /api/issues` if the stream disconnects.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FORGE_REPO_ROOT` | No | Override repo root path. Defaults to `../../` relative to `apps/web/`. All data paths (logs, cron config, events) resolve from this root. |

No `.env` file is required. The app uses filesystem-based configuration exclusively.

## Development

```bash
npm run dev    # Start dev server with hot reload (port 3000)
npm run build  # Production build
npm run start  # Start production server
npm run lint   # Run ESLint
```

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS v4
- shadcn/ui + Base UI
- Geist Mono font
- One Dark theme
