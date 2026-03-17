#!/usr/bin/env bash
set -euo pipefail

# ── ensure cron has a sane environment ─────────────────────────
export HOME="${HOME:-$(eval echo ~)}"
export PATH="$HOME/.claude/local:/opt/homebrew/bin:/usr/local/bin:$PATH"

KERNEL_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$KERNEL_DIR/.." && pwd)"

# ── load .env if present (overrides, etc.) ─────────────────────
if [[ -f "$KERNEL_DIR/.env" ]]; then
  set -a
  source "$KERNEL_DIR/.env"
  set +a
fi
CLAUDE="${CLAUDE_BIN:-claude}"

# ── parse flags ────────────────────────────────────────────────
AGENTIC=false
PROMPT=""
CONTEXTS=()
WORKSPACE_ID=""
TARGET_REPO=""
MODEL=""
NEXT_IS_CONTEXT=false
NEXT_IS_WORKSPACE=false
NEXT_IS_REPO=false
NEXT_IS_MODEL=false

for arg in "$@"; do
  if [[ "$NEXT_IS_CONTEXT" == true ]]; then
    CONTEXTS+=("$arg")
    NEXT_IS_CONTEXT=false
    continue
  fi
  if [[ "$NEXT_IS_WORKSPACE" == true ]]; then
    WORKSPACE_ID="$arg"
    NEXT_IS_WORKSPACE=false
    continue
  fi
  if [[ "$NEXT_IS_REPO" == true ]]; then
    TARGET_REPO="$arg"
    NEXT_IS_REPO=false
    continue
  fi
  if [[ "$NEXT_IS_MODEL" == true ]]; then
    MODEL="$arg"
    NEXT_IS_MODEL=false
    continue
  fi
  case "$arg" in
    --agentic)    AGENTIC=true ;;
    --context)    NEXT_IS_CONTEXT=true ;;
    --workspace)  NEXT_IS_WORKSPACE=true ;;
    --repo)       NEXT_IS_REPO=true ;;
    --model)      NEXT_IS_MODEL=true ;;
    *)            PROMPT="$arg" ;;
  esac
done

# stdin fallback
if [[ -z "$PROMPT" ]] && [[ ! -t 0 ]]; then
  PROMPT="$(cat)"
fi

if [[ -z "$PROMPT" ]]; then
  echo "Usage: $0 [--agentic] [--workspace <id>] [--repo <path-or-url>] [--model <model>] [--context <path> ...] \"<prompt>\"" >&2
  exit 1
fi

# ── resolve target repo ──────────────────────────────────────
# When --repo is provided, the worktree is created under the target repo
# instead of Forge's own repo. Context files still resolve from Forge's REPO_DIR.
WORK_REPO_DIR="$REPO_DIR"

if [[ -z "$TARGET_REPO" ]]; then
  echo "Error: --repo is required. Set the \"repo\" field in your agent template or cron-jobs.json." >&2
  exit 1
fi

if [[ -n "$TARGET_REPO" ]]; then
  if [[ "$TARGET_REPO" == /* ]]; then
    # Absolute local path — use directly
    WORK_REPO_DIR="$TARGET_REPO"
  elif [[ "$TARGET_REPO" == github.com/* ]]; then
    # GitHub URL — clone into .repos/ under Forge root
    LOCAL_CLONE="$REPO_DIR/.repos/$TARGET_REPO"
    if [[ -d "$LOCAL_CLONE/.git" ]]; then
      git -C "$LOCAL_CLONE" pull --ff-only 2>/dev/null || true
    else
      mkdir -p "$(dirname "$LOCAL_CLONE")"
      # Convert github.com/owner/repo to git@github.com:owner/repo.git
      SSH_URL="git@$(echo "$TARGET_REPO" | sed 's|/|:|1')"
      git clone "$SSH_URL.git" "$LOCAL_CLONE"
    fi
    WORK_REPO_DIR="$LOCAL_CLONE"
  else
    # Relative or other path — treat as local path
    WORK_REPO_DIR="$TARGET_REPO"
  fi
fi

# ── workspace (git worktree) isolation ───────────────────────
if [[ -n "$WORKSPACE_ID" ]]; then
  WORKTREE_DIR="$WORK_REPO_DIR/.worktrees/$WORKSPACE_ID"

  # Create worktree if missing
  if [[ ! -d "$WORKTREE_DIR" ]]; then
    git -C "$WORK_REPO_DIR" worktree add "$WORKTREE_DIR" --detach main
  fi

  # Skip if another run is still active in this workspace
  LOCKFILE="$WORKTREE_DIR/.agent.lock"
  if [[ -f "$LOCKFILE" ]]; then
    OLD_PID=$(cat "$LOCKFILE" 2>/dev/null)
    if kill -0 "$OLD_PID" 2>/dev/null; then
      SYSTEM_LOG="$KERNEL_DIR/logs/system.log"
      mkdir -p "$(dirname "$SYSTEM_LOG")"
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $WORKSPACE_ID: skipped (pid $OLD_PID still running)" >> "$SYSTEM_LOG"
      exit 0
    fi
  fi

  # Acquire lock
  echo $$ > "$LOCKFILE"
fi

# ── run boundary markers (used by logs/view.sh to group output) ──
# Emit early so ALL output (including errors) is captured between delimiters.
echo "=== RUN $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
cleanup() {
  echo "=== END RUN $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  rm -f "${LOCKFILE:-}"
}
trap cleanup EXIT

# ── runtime selection (default: claude) ──────────────────────
AGENT_RUNTIME="${AGENT_RUNTIME:-claude}"

# ── runtime command routing ──────────────────────────────────
if [[ "$AGENT_RUNTIME" == "codex" ]]; then
  if [[ "${USE_INNIES:-false}" == "true" ]]; then
    if [[ -n "${INNIES_TOKEN:-}" ]]; then
      RUNTIME_CMD=(innies codex --token "$INNIES_TOKEN" -- exec)
    else
      RUNTIME_CMD=(innies codex -- exec)
    fi
  else
    RUNTIME_CMD=(codex exec)
  fi
else
  if [[ "${USE_INNIES:-false}" == "true" ]]; then
    if [[ -n "${INNIES_TOKEN:-}" ]]; then
      RUNTIME_CMD=(innies claude --token "$INNIES_TOKEN" --)
    else
      RUNTIME_CMD=(innies claude --)
    fi
  else
    RUNTIME_CMD=("$CLAUDE")
  fi
fi

# ── preflight: skip idle worker runs ─────────────────────────
IS_WORKER=false
for ctx in "${CONTEXTS[@]}"; do
  if [[ "$ctx" == *WORKER.md ]]; then
    IS_WORKER=true
    break
  fi
done

if [[ "$IS_WORKER" == true ]]; then
  GH_ARGS=(issue list --label "status:ready-for-work" --label "role:worker" --json number --jq 'length')

  if [[ "$TARGET_REPO" == github.com/* ]]; then
    GH_REPO="${TARGET_REPO#github.com/}"
    GH_ARGS+=(--repo "$GH_REPO")
  fi

  AVAILABLE=$(gh "${GH_ARGS[@]}" 2>/dev/null || echo "error")

  if [[ "$AVAILABLE" == "0" ]]; then
    echo "No issues with status:ready-for-work + role:worker — skipping run"
    exit 0
  fi
  # If gh fails (network error, etc.), proceed with the run rather than skipping
fi


# ── preflight: Codex binary (direct mode) ────────────────────
if [[ "$AGENT_RUNTIME" == "codex" ]] && [[ "${USE_INNIES:-false}" != "true" ]]; then
  if ! command -v codex &>/dev/null; then
    echo "[preflight] codex binary not found. Install: npm install -g @openai/codex" >&2
    exit 1
  fi
fi

# ── preflight: Innies proxy connectivity ─────────────────────
if [[ "${USE_INNIES:-false}" == "true" ]]; then
  if ! command -v innies &>/dev/null; then
    echo "Error: USE_INNIES=true but 'innies' is not installed." >&2
    echo "Install with: npm install -g innies" >&2
    exit 1
  fi

  INNIES_OUT="$(innies doctor 2>&1 || true)"

  if [[ "$AGENT_RUNTIME" == "codex" ]]; then
    if ! echo "$INNIES_OUT" | grep -q "^OK.*codex_binary"; then
      echo "[preflight] innies doctor: codex_binary check failed" >&2
      echo "$INNIES_OUT" >&2
      exit 1
    fi
  else
    if ! echo "$INNIES_OUT" | grep -q "^OK.*claude_binary"; then
      echo "Error: innies claude check failed. Run 'innies doctor' to diagnose." >&2
      echo "$INNIES_OUT" >&2
      exit 1
    fi
  fi
fi



# ── assemble system prompt from context files ─────────────────
SYSTEM_PROMPT=""

for ctx in "${CONTEXTS[@]}"; do
  CTX_PATH="$REPO_DIR/$ctx"
  if [[ ! -f "$CTX_PATH" ]]; then
    echo "Context not found: $ctx ($CTX_PATH)" >&2
    exit 1
  fi
  SYSTEM_PROMPT+=$'\n\n'"$(cat "$CTX_PATH")"
done

# ── inject agent identity ─────────────────────────────────────
if [[ -n "$WORKSPACE_ID" ]]; then
  SYSTEM_PROMPT="AGENT_ID: $WORKSPACE_ID"$'\n\n'"$SYSTEM_PROMPT"
fi

# ── build runtime args ────────────────────────────────────────
RUNTIME_ARGS=()

if [[ "$AGENT_RUNTIME" == "codex" ]]; then
  RUNTIME_ARGS+=(--dangerously-bypass-approvals-and-sandbox)
  if [[ -n "$SYSTEM_PROMPT" ]]; then
    PROMPT="${SYSTEM_PROMPT}"$'\n\n'"${PROMPT}"
  fi
else
  if [[ "$AGENTIC" == false ]]; then
    RUNTIME_ARGS+=(--print)          # text-only, no tools
  fi
  RUNTIME_ARGS+=(--dangerously-skip-permissions)
  if [[ -n "$SYSTEM_PROMPT" ]]; then
    RUNTIME_ARGS+=(--append-system-prompt "$SYSTEM_PROMPT")
  fi
fi

if [[ -n "$MODEL" ]]; then
  RUNTIME_ARGS+=(--model "$MODEL")
fi

if [[ -n "$WORKSPACE_ID" ]]; then
  cd "$WORKTREE_DIR"
fi

# ── update last_run in cron-state.json ────────────────────────
# Records the current UTC timestamp so the CLI status command can show
# when each agent last ran and compute countdown to next run.
if [[ -n "$WORKSPACE_ID" ]]; then
  STATE_JSON="$KERNEL_DIR/cron/cron-state.json"
  if [[ -f "$STATE_JSON" ]]; then
    python3 -c "
import json, sys
from datetime import datetime, timezone
f = sys.argv[1]
agent = sys.argv[2]
with open(f) as fh:
    state = json.load(fh)
if agent in state.get('jobs', {}):
    state['jobs'][agent]['last_run'] = datetime.now(timezone.utc).isoformat()
    with open(f, 'w') as fh:
        json.dump(state, fh, indent=2)
        fh.write('\n')
" "$STATE_JSON" "$WORKSPACE_ID" 2>/dev/null || true
  fi
fi

MAX_RUNTIME="${MAX_RUNTIME:-1200}"  # 20 minutes default

rc=0
timeout "$MAX_RUNTIME" "${RUNTIME_CMD[@]}" "${RUNTIME_ARGS[@]}" "$PROMPT" || rc=$?

if [[ "$rc" -eq 124 ]]; then
  echo "Run killed: exceeded ${MAX_RUNTIME}s timeout"
fi
exit "$rc"
