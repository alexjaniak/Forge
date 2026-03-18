#!/usr/bin/env bash

detect_agent_role() {
  AGENT_ROLE=""

  for ctx in "${CONTEXTS[@]}"; do
    case "$ctx" in
      *WORKER.md)
        AGENT_ROLE="worker"
        break
        ;;
      *PLANNER.md)
        AGENT_ROLE="planner"
        break
        ;;
      *SUPER.md)
        AGENT_ROLE="super"
        break
        ;;
    esac
  done

  export AGENT_ROLE
}

preflight_lock_issue() {
  local role="$1"
  local labels_csv="$2"
  local mode="$3"
  local -a gh_args
  local -a labels
  local labels_display
  local issues_json

  gh_args=(issue list --state open --json 'number,body,createdAt' --limit 100)

  IFS=',' read -r -a labels <<< "$labels_csv"
  for label in "${labels[@]}"; do
    gh_args+=(--label "$label")
  done

  if [[ "$TARGET_REPO" == github.com/* ]]; then
    GH_REPO="${TARGET_REPO#github.com/}"
    gh_args+=(--repo "$GH_REPO")
  fi

  issues_json=$(gh "${gh_args[@]}" 2>/dev/null || echo "error")

  if [[ "$issues_json" == "error" ]]; then
    echo "[preflight] gh issue list failed — proceeding without lock"
    return 0
  fi

  if [[ "$issues_json" == "[]" || -z "$issues_json" ]]; then
    if [[ "$mode" == "hard" ]]; then
      labels_display="${labels_csv//,/ + }"
      echo "No issues with $labels_display — skipping run"
      exit 0
    fi

    echo "[preflight] No open issues with role:$role — proceeding without lock"
    return 0
  fi

  # Sort issues by parent epic age (oldest epic first), then by own age.
  # Parent epic is extracted from "Parent: #N" in the issue body.
  # Issues without a parent fall back to their own creation date.
  local issues
  issues=$(_sort_issues_by_epic_age "$issues_json")

  FORGE_LOCKED_ISSUE=""
  for ISSUE_NUM in $issues; do
    if lock_acquire issue "$ISSUE_NUM" "$WORKSPACE_ID" 2>/dev/null; then
      FORGE_LOCKED_ISSUE="$ISSUE_NUM"
      break
    fi
  done

  if [[ -z "$FORGE_LOCKED_ISSUE" ]]; then
    if [[ "$mode" == "hard" ]]; then
      echo "No unlocked $role issues available — skipping run"
      exit 0
    fi

    echo "[preflight] No unlocked $role issues available — proceeding without lock"
    return 0
  fi

  export FORGE_LOCKED_ISSUE
  echo "[preflight] Locked issue #$FORGE_LOCKED_ISSUE for $WORKSPACE_ID"
}

_sort_issues_by_epic_age() {
  local issues_json="$1"
  local repo_flag=""

  if [[ "$TARGET_REPO" == github.com/* ]]; then
    repo_flag="--repo ${TARGET_REPO#github.com/}"
  fi

  python3 -c "
import json, re, subprocess, sys

issues = json.loads(sys.argv[1])
repo_flag = sys.argv[2] if len(sys.argv) > 2 else ''

# Extract parent epic numbers from issue bodies via 'Parent: #N'
epic_numbers = set()
issue_epics = {}
for issue in issues:
    body = issue.get('body', '') or ''
    match = re.search(r'Parent:\s*#(\d+)', body)
    if match:
        epic_num = match.group(1)
        epic_numbers.add(epic_num)
        issue_epics[issue['number']] = epic_num

# Batch-fetch epic creation dates
epic_dates = {}
if epic_numbers:
    for epic_num in epic_numbers:
        cmd = ['gh', 'issue', 'view', epic_num, '--json', 'createdAt', '--jq', '.createdAt']
        if repo_flag:
            cmd.extend(repo_flag.split())
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if result.returncode == 0 and result.stdout.strip():
                epic_dates[epic_num] = result.stdout.strip()
        except Exception:
            pass

# Sort: use epic creation date if available, else own creation date
def sort_key(issue):
    epic_num = issue_epics.get(issue['number'])
    if epic_num and epic_num in epic_dates:
        return epic_dates[epic_num]
    return issue.get('createdAt', '')

issues.sort(key=sort_key)

for issue in issues:
    print(issue['number'])
" "$issues_json" "$repo_flag"
}
