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
  local issues

  gh_args=(issue list --state open --json number --jq '.[].number')

  IFS=',' read -r -a labels <<< "$labels_csv"
  for label in "${labels[@]}"; do
    gh_args+=(--label "$label")
  done

  if [[ "$TARGET_REPO" == github.com/* ]]; then
    GH_REPO="${TARGET_REPO#github.com/}"
    gh_args+=(--repo "$GH_REPO")
  fi

  issues=$(gh "${gh_args[@]}" 2>/dev/null || echo "error")

  if [[ "$issues" == "error" ]]; then
    echo "[preflight] gh issue list failed — proceeding without lock"
    return 0
  fi

  if [[ -z "$issues" ]]; then
    if [[ "$mode" == "hard" ]]; then
      labels_display="${labels_csv//,/ + }"
      echo "No issues with $labels_display — skipping run"
      exit 0
    fi

    echo "[preflight] No open issues with role:$role — proceeding without lock"
    return 0
  fi

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
