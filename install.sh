#!/usr/bin/env bash
set -euo pipefail

# Color support
if command -v tput &>/dev/null && [ -t 1 ]; then
  RED=$(tput setaf 1); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3)
  BOLD=$(tput bold); RESET=$(tput sgr0)
else
  RED="" GREEN="" YELLOW="" BOLD="" RESET=""
fi

info()  { echo "${GREEN}✓${RESET} $*"; }
warn()  { echo "${YELLOW}⚠${RESET} $*"; }
err()   { echo "${RED}✗${RESET} $*" >&2; }

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

# ── Prerequisite checks ─────────────────────────────────────────────

missing=0

check_required() {
  local cmd=$1 label=$2 min_version=${3:-}
  if ! command -v "$cmd" &>/dev/null; then
    err "Required: ${label} not found. Please install it and re-run."
    missing=1
    return
  fi
  if [ -n "$min_version" ]; then
    local ver
    ver=$("$cmd" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
    local major minor req_major req_minor
    major=${ver%%.*}; minor=${ver#*.}; minor=${minor%%.*}
    req_major=${min_version%%.*}; req_minor=${min_version#*.}; req_minor=${req_minor%%.*}
    if [ "$major" -lt "$req_major" ] || { [ "$major" -eq "$req_major" ] && [ "$minor" -lt "$req_minor" ]; }; then
      err "${label} version ${ver} found, but ${min_version}+ required."
      missing=1
      return
    fi
  fi
  info "${label} found"
}

echo "${BOLD}Checking prerequisites...${RESET}"
check_required python3 "Python 3.11+" 3.11
check_required pip     "pip"
check_required git     "git"
check_required gh      "gh CLI"
check_required node    "Node.js 18+" 18.0
check_required npm     "npm"

if ! command -v claude &>/dev/null; then
  warn "claude CLI not found — needed for agent runs but not required for setup"
fi

[ "$missing" -ne 0 ] && { err "Missing prerequisites. Fix the above and re-run."; exit 1; }
echo

# ── Directory setup ──────────────────────────────────────────────────

echo "${BOLD}Setting up directories...${RESET}"
for dir in agent-kernel/logs .worktrees; do
  if [ -d "$dir" ]; then
    info "$dir/ exists"
  else
    mkdir -p "$dir"
    info "$dir/ created"
  fi
done
echo

# ── Python packages ──────────────────────────────────────────────────

echo "${BOLD}Installing Python packages...${RESET}"
for pkg in apps/forge-cli apps/webhook-monitor; do
  name=$(basename "$pkg")
  if pip show "$name" &>/dev/null; then
    info "$name already installed"
  else
    pip install -e "$pkg" --quiet
    info "$name installed"
  fi
done
echo

# ── Node.js setup ────────────────────────────────────────────────────

echo "${BOLD}Installing Node.js dependencies...${RESET}"
if [ -d apps/web/node_modules ]; then
  info "apps/web node_modules exists"
else
  (cd apps/web && npm install --silent)
  info "apps/web dependencies installed"
fi
echo

# ── Config files ─────────────────────────────────────────────────────

echo "${BOLD}Generating config files...${RESET}"

if [ -f agent-kernel/.env ]; then
  info "agent-kernel/.env exists, skipping"
else
  cp agent-kernel/.env.example agent-kernel/.env
  token="${CLAUDE_CODE_OAUTH_TOKEN:-}"
  if [ -z "$token" ] && [ -t 0 ]; then
    read -rp "  Enter CLAUDE_CODE_OAUTH_TOKEN (or press Enter to skip): " token
  fi
  if [ -n "$token" ]; then
    sed -i.bak "s|sk-ant-oat01-\.\.\.|${token}|" agent-kernel/.env
    rm -f agent-kernel/.env.bak
  fi
  info "agent-kernel/.env created"
fi

if [ -f apps/webhook-monitor/config.toml ]; then
  info "apps/webhook-monitor/config.toml exists, skipping"
else
  cp apps/webhook-monitor/config.example.toml apps/webhook-monitor/config.toml
  repo_name="${FORGE_REPO:-}"
  secret="${FORGE_WEBHOOK_SECRET:-}"
  if [ -t 0 ]; then
    [ -z "$repo_name" ] && read -rp "  Enter repo name (owner/repo, or Enter to skip): " repo_name
    [ -z "$secret" ] && read -rp "  Enter webhook secret (or Enter to skip): " secret
  fi
  if [ -n "$repo_name" ]; then
    sed -i.bak "s|^name = \"\".*|name = \"${repo_name}\"|" apps/webhook-monitor/config.toml
    rm -f apps/webhook-monitor/config.toml.bak
  fi
  if [ -n "$secret" ]; then
    sed -i.bak "s|^secret = \"\".*|secret = \"${secret}\"|" apps/webhook-monitor/config.toml
    rm -f apps/webhook-monitor/config.toml.bak
  fi
  # Fill in repo dir
  sed -i.bak "s|^dir = \"\".*|dir = \"${REPO_ROOT}\"|" apps/webhook-monitor/config.toml
  rm -f apps/webhook-monitor/config.toml.bak
  info "apps/webhook-monitor/config.toml created"
fi
echo

# ── Verification ─────────────────────────────────────────────────────

echo "${BOLD}Verifying installation...${RESET}"
errors=0

if forge --help &>/dev/null; then
  info "forge CLI works"
else
  err "forge --help failed"; errors=1
fi

if python3 -c "import click" &>/dev/null; then
  info "Python packages importable"
else
  err "python3 -c 'import click' failed"; errors=1
fi

if node -e "console.log('ok')" &>/dev/null; then
  info "Node.js works"
else
  err "node check failed"; errors=1
fi

[ -f agent-kernel/.env ] && info "agent-kernel/.env exists" || { err "agent-kernel/.env missing"; errors=1; }
[ -f apps/webhook-monitor/config.toml ] && info "config.toml exists" || { err "config.toml missing"; errors=1; }

echo
if [ "$errors" -ne 0 ]; then
  warn "Setup completed with errors. Check the messages above."
  exit 1
fi

# ── Summary ──────────────────────────────────────────────────────────

cat <<EOF

${GREEN}${BOLD}Setup complete!${RESET}

  ${GREEN}✓${RESET} Python packages installed
  ${GREEN}✓${RESET} Node modules installed
  ${GREEN}✓${RESET} Config files created
  ${GREEN}✓${RESET} Directories ready
  ${GREEN}✓${RESET} forge CLI available

  Next steps:
    1. Edit agent-kernel/.env with your Claude OAuth token
    2. Edit apps/webhook-monitor/config.toml with your webhook secret
    3. Run: forge add worker && forge cron apply
EOF
