#!/usr/bin/env bash
# Pretty log viewer for agent-kernel logs.
# NOTE: The primary interface is now `forge logs`. This script is kept for direct use.
# Usage:
#   ./view.sh              — tail all agent logs interleaved
#   ./view.sh worker-01    — tail a specific agent's log
#   ./view.sh -f           — follow all agents live
#   ./view.sh -f worker-01 — follow a specific agent live

set -euo pipefail

LOGS_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── color palette ──────────────────────────────────────────────
# Assign colors by agent ID. Cycles through a fixed palette.
COLORS=(
  "34"  # blue
  "32"  # green
  "33"  # yellow
  "35"  # magenta
  "36"  # cyan
  "91"  # bright red
  "92"  # bright green
  "93"  # bright yellow
  "94"  # bright blue
  "95"  # bright magenta
)

color_for_agent() {
  local agent="$1"
  local hash=0
  for (( i=0; i<${#agent}; i++ )); do
    hash=$(( (hash + $(printf '%d' "'${agent:$i:1}")) % ${#COLORS[@]} ))
  done
  echo "${COLORS[$hash]}"
}

# ── run-grouped line formatter ─────────────────────────────────
# Detects "=== RUN <timestamp> ===" boundaries and groups output.
# Falls back to per-line timestamps for lines outside a run block.
format_lines() {
  local agent="$1"
  local color
  color=$(color_for_agent "$agent")
  local tag="\033[${color}m[${agent}]\033[0m"
  local separator="─────────────────────────"
  local body=""
  local in_block=false
  local current_start_ts=""

  while IFS= read -r line; do
    # Run boundary marker from run.sh — start buffering a new block
    if [[ "$line" =~ ^===\ RUN\ ([0-9T:.Z-]+)\ ===$ ]]; then
      local run_ts="${BASH_REMATCH[1]}"
      local display_ts
      display_ts=$(date -jf '%Y-%m-%dT%H:%M:%SZ' "$run_ts" '+%H:%M:%S' 2>/dev/null || echo "$run_ts")
      current_start_ts="$display_ts"
      body=""
      in_block=true
      continue
    fi

    # End-of-run marker — flush the buffered block atomically
    if [[ "$line" =~ ^===\ END\ RUN(\ ([0-9T:.Z-]+))?\ ===$ ]]; then
      local end_ts="${BASH_REMATCH[2]:-}"
      local time_display="$current_start_ts"
      if [[ -n "$end_ts" ]]; then
        local display_end
        display_end=$(date -jf '%Y-%m-%dT%H:%M:%SZ' "$end_ts" '+%H:%M:%S' 2>/dev/null || echo "$end_ts")
        time_display="$current_start_ts → $display_end"
      fi
      if [[ -n "$body" ]]; then
        printf "\n%b \033[90m%s\033[0m \033[90m%s\033[0m\n%s\n" "$tag" "$time_display" "$separator" "$body"
      fi
      body=""
      current_start_ts=""
      in_block=false
      continue
    fi

    [[ -z "$line" ]] && continue

    if $in_block; then
      body+="$(printf "  %s\n" "$line")"
    else
      printf "  %s\n" "$line"
    fi
  done

  # Flush any remaining buffer (e.g. run still in progress during follow mode)
  if [[ -n "$body" ]]; then
    printf "\n%b \033[90m%s\033[0m \033[90m%s\033[0m\n%s\n" "$tag" "$current_start_ts" "$separator" "$body"
  fi
}

# ── parse args ─────────────────────────────────────────────────
FOLLOW=false
AGENT=""
LINES=50

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--follow) FOLLOW=true; shift ;;
    -n)          LINES="$2"; shift 2 ;;
    -*)          echo "Usage: $0 [-f] [-n lines] [agent-id]" >&2; exit 1 ;;
    *)           AGENT="$1"; shift ;;
  esac
done

# ── single agent mode ─────────────────────────────────────────
if [[ -n "$AGENT" ]]; then
  LOG_FILE="${LOGS_DIR}/${AGENT}.log"
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "No log file found: ${LOG_FILE}" >&2
    exit 1
  fi

  if $FOLLOW; then
    tail -n "$LINES" -f "$LOG_FILE" | format_lines "$AGENT"
  else
    tail -n "$LINES" "$LOG_FILE" | format_lines "$AGENT"
  fi
  exit 0
fi

# ── all agents mode ───────────────────────────────────────────
# Collect agent log files, excluding the system log
LOG_FILES=()
for f in "${LOGS_DIR}"/*.log; do
  [[ ! -e "$f" ]] && continue
  [[ "$(basename "$f")" == "system.log" ]] && continue
  LOG_FILES+=("$f")
done

if [[ ${#LOG_FILES[@]} -eq 0 ]]; then
  echo "No log files found in ${LOGS_DIR}/" >&2
  exit 1
fi

if $FOLLOW; then
  # Run a separate tail -f per agent so each stream always knows its own
  # agent identity. This avoids the interleaving bug where a single
  # tail -f on multiple files omits the "==> path <==" header when
  # files receive data nearly simultaneously.
  TAIL_PIDS=()
  cleanup() { kill "${TAIL_PIDS[@]}" 2>/dev/null; wait 2>/dev/null; }
  trap cleanup EXIT INT TERM

  for log_file in "${LOG_FILES[@]}"; do
    basename="${log_file##*/}"
    agent="${basename%.log}"
    tail -n "$LINES" -f "$log_file" 2>/dev/null | format_lines "$agent" &
    TAIL_PIDS+=($!)
  done

  # Wait for any child to exit (or Ctrl-C)
  wait
else
  # Show last N lines from each agent, grouped by run
  for log_file in "${LOG_FILES[@]}"; do
    basename="${log_file##*/}"
    agent="${basename%.log}"
    tail -n "$LINES" "$log_file" | format_lines "$agent"
  done
fi
