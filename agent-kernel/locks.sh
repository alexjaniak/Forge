#!/usr/bin/env bash
# locks.sh — atomic file-based locking for GitHub issues and PRs
#
# Usage: source this file to get lock_* functions, or run directly:
#   locks.sh --help
#
# Lock layout:
#   $WORK_REPO_DIR/locks/issues/123.lock/   (directory — mkdir is atomic)
#   $WORK_REPO_DIR/locks/issues/123.lock/info.json
#   $WORK_REPO_DIR/locks/prs/456.lock/
#   $WORK_REPO_DIR/locks/prs/456.lock/info.json

# ── help ─────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
  cat <<'USAGE'
locks.sh — atomic file-based locking for GitHub issues and PRs

Functions (source this file to use):
  lock_acquire <type> <number> <agent_id>  — acquire a lock (type: issue|pr)
  lock_release <type> <number>             — release a lock
  lock_check   <type> <number>             — check if locked (exit 0=locked, 1=free)
  lock_list    <repo_dir>                  — list all held locks
  lock_clear_stale <repo_dir>              — remove locks with dead PIDs
  lock_clear_all   <repo_dir>              — force-remove all locks

Lock files live under <repo_dir>/locks/{issues,prs}/<number>.lock/
USAGE
  # If sourced with --help, don't exit the parent shell
  if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    exit 0
  fi
  return 0 2>/dev/null || true
fi

# ── helpers ──────────────────────────────────────────────────────

_lock_dir() {
  local repo_dir="$1" type="$2" number="$3"
  local plural
  case "$type" in
    issue) plural="issues" ;;
    pr)    plural="prs" ;;
    *)     echo "locks: invalid type '$type' (expected: issue, pr)" >&2; return 1 ;;
  esac
  echo "$repo_dir/locks/$plural/${number}.lock"
}

_pid_alive() {
  kill -0 "$1" 2>/dev/null
}

_iso_now() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

_seconds_ago() {
  local then="$1"
  local now_epoch then_epoch
  now_epoch="$(date +%s)"
  # Try python3 first (reliable cross-platform), fall back to date commands
  if command -v python3 &>/dev/null; then
    then_epoch="$(python3 -c "
from datetime import datetime, timezone
import sys
dt = datetime.strptime(sys.argv[1], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
print(int(dt.timestamp()))
" "$then" 2>/dev/null)" || then_epoch="$now_epoch"
  elif date -d "$then" +%s &>/dev/null; then
    then_epoch="$(date -d "$then" +%s)"
  else
    then_epoch="$now_epoch"
  fi
  echo $(( now_epoch - then_epoch ))
}

_format_age() {
  local secs="$1"
  if (( secs < 60 )); then
    echo "${secs}s"
  elif (( secs < 3600 )); then
    echo "$(( secs / 60 ))m"
  elif (( secs < 86400 )); then
    echo "$(( secs / 3600 ))h"
  else
    echo "$(( secs / 86400 ))d"
  fi
}

_read_lock_info() {
  local lock_dir="$1"
  local info_file="$lock_dir/info.json"
  if [[ -f "$info_file" ]]; then
    cat "$info_file"
  else
    echo "{}"
  fi
}

_json_field() {
  local json="$1" field="$2"
  # Minimal JSON field extraction without external deps.
  # Handles both string values ("key": "value") and numeric values ("key": 123).
  local result
  # Try quoted string value first
  result="$(echo "$json" | sed -n 's/.*"'"$field"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  if [[ -n "$result" ]]; then
    echo "$result"
    return
  fi
  # Try numeric value
  echo "$json" | sed -n 's/.*"'"$field"'"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1
}

# ── lock_acquire ─────────────────────────────────────────────────
# Acquire a lock. Returns 0 on success, 1 if already locked.
lock_acquire() {
  local type="$1" number="$2" agent_id="$3"
  local repo_dir="${WORK_REPO_DIR:?WORK_REPO_DIR must be set}"
  local lock_dir
  lock_dir="$(_lock_dir "$repo_dir" "$type" "$number")" || return 1

  mkdir -p "$(dirname "$lock_dir")"

  # Atomic acquire via mkdir
  if mkdir "$lock_dir" 2>/dev/null; then
    # Write metadata
    cat > "$lock_dir/info.json" <<EOF
{"agent": "$agent_id", "pid": $$, "claimed_at": "$(_iso_now)"}
EOF
    return 0
  fi

  # Lock exists — check for stale
  local info
  info="$(_read_lock_info "$lock_dir")"
  local holder_pid
  holder_pid="$(_json_field "$info" "pid")"

  if [[ -n "$holder_pid" ]] && ! _pid_alive "$holder_pid"; then
    # Stale lock — remove and re-acquire
    rm -rf "$lock_dir"
    if mkdir "$lock_dir" 2>/dev/null; then
      cat > "$lock_dir/info.json" <<EOF
{"agent": "$agent_id", "pid": $$, "claimed_at": "$(_iso_now)"}
EOF
      return 0
    fi
  fi

  # Locked by another live process
  local holder_agent
  holder_agent="$(_json_field "$info" "agent")"
  echo "locks: $type #$number is locked by $holder_agent (pid $holder_pid)" >&2
  return 1
}

# ── lock_release ─────────────────────────────────────────────────
# Release a lock. Idempotent — no error if lock doesn't exist.
lock_release() {
  local type="$1" number="$2"
  local repo_dir="${WORK_REPO_DIR:?WORK_REPO_DIR must be set}"
  local lock_dir
  lock_dir="$(_lock_dir "$repo_dir" "$type" "$number")" || return 1

  rm -rf "$lock_dir"
}

# ── lock_check ───────────────────────────────────────────────────
# Check if a resource is locked. Exit 0 if locked, 1 if free.
lock_check() {
  local type="$1" number="$2"
  local repo_dir="${WORK_REPO_DIR:?WORK_REPO_DIR must be set}"
  local lock_dir
  lock_dir="$(_lock_dir "$repo_dir" "$type" "$number")" || return 1

  if [[ ! -d "$lock_dir" ]]; then
    return 1
  fi

  local info
  info="$(_read_lock_info "$lock_dir")"
  local holder_agent holder_pid claimed_at
  holder_agent="$(_json_field "$info" "agent")"
  holder_pid="$(_json_field "$info" "pid")"
  claimed_at="$(_json_field "$info" "claimed_at")"

  echo "$type #$number locked by $holder_agent (pid $holder_pid, since $claimed_at)"
  return 0
}

# ── lock_list ────────────────────────────────────────────────────
# List all held locks under the given repo dir.
lock_list() {
  local repo_dir="$1"
  local locks_base="$repo_dir/locks"

  if [[ ! -d "$locks_base" ]]; then
    echo "No locks directory found."
    return 0
  fi

  local found=false
  printf "%-7s  %-7s  %-15s  %-7s  %s\n" "TYPE" "NUMBER" "AGENT" "PID" "AGE"
  printf "%-7s  %-7s  %-15s  %-7s  %s\n" "------" "------" "--------------" "------" "---"

  for type_dir in "$locks_base"/*/; do
    [[ -d "$type_dir" ]] || continue
    local type_name
    type_name="$(basename "$type_dir")"
    # Map plural dir name back to singular
    local display_type
    case "$type_name" in
      issues) display_type="issue" ;;
      prs)    display_type="pr" ;;
      *)      display_type="$type_name" ;;
    esac

    for lock_dir in "$type_dir"*.lock; do
      [[ -d "$lock_dir" ]] || continue
      found=true
      local number
      number="$(basename "$lock_dir" .lock)"

      local info
      info="$(_read_lock_info "$lock_dir")"
      local agent pid claimed_at
      agent="$(_json_field "$info" "agent")"
      pid="$(_json_field "$info" "pid")"
      claimed_at="$(_json_field "$info" "claimed_at")"

      local age_str="?"
      if [[ -n "$claimed_at" ]]; then
        local secs
        secs="$(_seconds_ago "$claimed_at")"
        age_str="$(_format_age "$secs")"
      fi

      local stale=""
      if [[ -n "$pid" ]] && ! _pid_alive "$pid"; then
        stale=" [stale]"
      fi

      printf "%-7s  %-7s  %-15s  %-7s  %s\n" "$display_type" "#$number" "${agent:-?}" "${pid:-?}${stale}" "$age_str"
    done
  done

  if [[ "$found" == false ]]; then
    echo "No locks held."
  fi
}

# ── lock_clear_stale ─────────────────────────────────────────────
# Find and remove all locks where the holding PID is no longer alive.
lock_clear_stale() {
  local repo_dir="$1"
  local locks_base="$repo_dir/locks"

  if [[ ! -d "$locks_base" ]]; then
    return 0
  fi

  local cleared=0
  for type_dir in "$locks_base"/*/; do
    [[ -d "$type_dir" ]] || continue
    local type_name
    type_name="$(basename "$type_dir")"

    for lock_dir in "$type_dir"*.lock; do
      [[ -d "$lock_dir" ]] || continue
      local number
      number="$(basename "$lock_dir" .lock)"

      local info
      info="$(_read_lock_info "$lock_dir")"
      local pid
      pid="$(_json_field "$info" "pid")"

      if [[ -n "$pid" ]] && ! _pid_alive "$pid"; then
        local agent
        agent="$(_json_field "$info" "agent")"
        echo "Cleared stale lock: $type_name/$number (agent=$agent, pid=$pid)"
        rm -rf "$lock_dir"
        cleared=$(( cleared + 1 ))
      fi
    done
  done

  if (( cleared == 0 )); then
    echo "No stale locks found."
  else
    echo "Cleared $cleared stale lock(s)."
  fi
}

# ── lock_clear_all ───────────────────────────────────────────────
# Force-remove all locks. For debugging/recovery only.
lock_clear_all() {
  local repo_dir="$1"
  local locks_base="$repo_dir/locks"

  if [[ ! -d "$locks_base" ]]; then
    echo "No locks directory found."
    return 0
  fi

  local cleared=0
  for type_dir in "$locks_base"/*/; do
    [[ -d "$type_dir" ]] || continue
    local type_name
    type_name="$(basename "$type_dir")"

    for lock_dir in "$type_dir"*.lock; do
      [[ -d "$lock_dir" ]] || continue
      local number
      number="$(basename "$lock_dir" .lock)"
      local info
      info="$(_read_lock_info "$lock_dir")"
      local agent
      agent="$(_json_field "$info" "agent")"
      echo "Removed lock: $type_name/$number (agent=$agent)"
      rm -rf "$lock_dir"
      cleared=$(( cleared + 1 ))
    done
  done

  if (( cleared == 0 )); then
    echo "No locks to clear."
  else
    echo "Cleared $cleared lock(s)."
  fi
}
