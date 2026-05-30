#!/usr/bin/env bash
# ─── Aikami Direnv Core Library ───────────────────────────────────────────
# Source this from .envrc to get logging, mode resolution, and validation
# helpers. All functions are prefixed with `_aikami_` to avoid collisions.
#
# This file is NOT sourced by direnv — it's sourced inline by .envrc after
# `use flake` loads the Nix devShell. All commands here run in the user's
# interactive shell (aliases + functions survive).

set -euo pipefail

# ── Constants ────────────────────────────────────────────────────────────

# Valid modes
readonly _AIKAMI_VALID_MODES=("emulator" "development" "production")
readonly _AIKAMI_DEFAULT_MODE="emulator"

# GCP project mapping
declare -A _AIKAMI_PROJECT_MAP=(
  [emulator]="demo-aikami-emulator"
  [development]="aikami-dev"
  [production]="aikami-prod"
)

# ── Logging Helpers ──────────────────────────────────────────────────────

_aikami_log()  { echo "  ℹ️  $*"; }
_aikami_ok()   { echo "  ✅ $*"; }
_aikami_warn() { echo "  ⚠️  $*"; }
_aikami_err()  { echo "  ❌ $*" >&2; }
_aikami_h1()   { echo ""; echo "━━━ $* ━━━"; }

# ── Project Root Detection ───────────────────────────────────────────────

_aikami_root() {
  if [ -n "${AIKAMI_ROOT:-}" ]; then
    echo "$AIKAMI_ROOT"
    return 0
  fi
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
  echo "$root"
}

# ── Environment Mode ─────────────────────────────────────────────────────
#
# Resolves AIKAMI_MODE from (in priority order):
#   1. Already-exported AIKAMI_MODE env var
#   2. .env.local file (AIKAMI_MODE= key)
#   3. Default: "emulator"
#
# Sets and exports:
#   AIKAMI_MODE        — "emulator" | "development" | "production"
#   AIKAMI_ENV         — alias for AIKAMI_MODE
#   AIKAMI_PROJECT_ID  — GCP project ID
#   AIKAMI_IS_EMULATOR — "1" if emulator mode, "0" otherwise
_aikami_load_mode() {
  local config_file
  config_file="$(_aikami_root)/.env.local"

  # Respect already-set value (e.g. from a parent shell)
  if [ -z "${AIKAMI_MODE:-}" ]; then
    AIKAMI_MODE="$_AIKAMI_DEFAULT_MODE"

    if [ -f "$config_file" ]; then
      # Read only the AIKAMI_MODE line from .env.local
      local mode_from_file
      mode_from_file=$(grep -E '^AIKAMI_MODE=' "$config_file" 2>/dev/null | head -1 | cut -d= -f2- | xargs || true)
      if [ -n "$mode_from_file" ]; then
        # Validate against known modes
        local valid=false
        for m in "${_AIKAMI_VALID_MODES[@]}"; do
          if [ "$mode_from_file" = "$m" ]; then
            valid=true
            break
          fi
        done
        if [ "$valid" = true ]; then
          AIKAMI_MODE="$mode_from_file"
        else
          _aikami_warn ".env.local AIKAMI_MODE='$mode_from_file' invalid — using '$AIKAMI_MODE'"
        fi
      fi
    fi
  fi

  export AIKAMI_MODE
  export AIKAMI_ENV="$AIKAMI_MODE"

  # Resolve project ID
  AIKAMI_PROJECT_ID="${_AIKAMI_PROJECT_MAP[$AIKAMI_MODE]:-demo-aikami-emulator}"
  export AIKAMI_PROJECT_ID

  if [ "$AIKAMI_MODE" = "emulator" ]; then
    export AIKAMI_IS_EMULATOR=1
  else
    export AIKAMI_IS_EMULATOR=0
  fi
}

# ── GCP Authentication Check ─────────────────────────────────────────────
#
# Checks if gcloud is authenticated. Emulator mode skips this entirely.
# Returns 0 if authenticated (or emulator), 1 otherwise.
_aikami_gcp_check() {
  if [ "$AIKAMI_IS_EMULATOR" = "1" ]; then
    _aikami_h1 "Aikami Environment"
    _aikami_ok "Mode: emulator (local — no GCP auth needed)"
    _aikami_log "Project: $AIKAMI_PROJECT_ID"
    return 0
  fi

  _aikami_h1 "Aikami Environment"
  _aikami_log "Mode: $AIKAMI_MODE"
  _aikami_log "Project: $AIKAMI_PROJECT_ID"

  if ! command -v gcloud &>/dev/null; then
    _aikami_warn "gcloud CLI not found — set AIKAMI_MODE=emulator in .env.local for local dev"
    return 1
  fi

  local account
  account=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null || true)

  if [ -n "$account" ]; then
    _aikami_ok "GCP authenticated as: $account"
    return 0
  else
    _aikami_warn "No active gcloud auth — run: gcloud auth application-default login"
    _aikami_warn "Or switch to emulator mode: echo 'AIKAMI_MODE=emulator' > .env.local"
    return 1
  fi
}

# ── Runtime Validation ───────────────────────────────────────────────────
#
# Quick checks to ensure the monorepo tooling is in sync.
_aikami_validate_runtime() {
  _aikami_h1 "Runtime Validation"

  # Bun version
  if command -v bun &>/dev/null; then
    local bun_ver
    bun_ver=$(bun --version 2>/dev/null || echo "unknown")
    _aikami_ok "Bun $bun_ver"
  else
    _aikami_err "Bun not found — Nix flake may not be loaded"
    return 1
  fi

  # Moon sync check — warn if moon config files changed since last sync
  if [ -f "$(_aikami_root)/moon.yml" ]; then
    local moon_ts ws_ts
    if command -v stat &>/dev/null; then
      # GNU stat
      moon_ts=$(stat -c %Y "$(_aikami_root)/.moon/cache/moonlanding.txt" 2>/dev/null || echo 0)
      ws_ts=$(stat -c %Y "$(_aikami_root)/.moon/workspace.yml" 2>/dev/null || echo 0)
    else
      # BSD stat (macOS)
      moon_ts=$(stat -f %m "$(_aikami_root)/.moon/cache/moonlanding.txt" 2>/dev/null || echo 0)
      ws_ts=$(stat -f %m "$(_aikami_root)/.moon/workspace.yml" 2>/dev/null || echo 0)
    fi
    if [ "$ws_ts" -gt "$moon_ts" ] 2>/dev/null; then
      _aikami_warn "moon config changed — run: bunx moon sync"
    else
      _aikami_ok "moon projects in sync"
    fi
  fi

  # Check if Nix devShell was sourced (nix-direnv or use flake)
  if [ -n "${AIKAMI_NIX_READY:-}" ] || [ -n "${IN_NIX_SHELL:-}" ]; then
    _aikami_ok "Nix devShell loaded"
  elif [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
    _aikami_ok "Nix devShell loaded (Playwright path set)"
  else
    _aikami_warn "Nix devShell may not be loaded — some packages may be missing"
  fi

  echo ""
}

# ── Moon Dependency Warning ──────────────────────────────────────────────
#
# Check if Bun lockfile or package.json changed since last install, and
# warn the developer. Runs quickly (stat calls only).
_aikami_deps_warning() {
  local root
  root="$(_aikami_root)"

  local lock_ts mod_ts
  if command -v stat &>/dev/null; then
    if stat --version 2>/dev/null | grep -q GNU; then
      lock_ts=$(stat -c %Y "$root/bun.lock" 2>/dev/null || echo 0)
      mod_ts=$(stat -c %Y "$root/node_modules/.installed" 2>/dev/null || echo 0)
    else
      lock_ts=$(stat -f %m "$root/bun.lock" 2>/dev/null || echo 0)
      mod_ts=$(stat -f %m "$root/node_modules/.installed" 2>/dev/null || echo 0)
    fi
  else
    return 0
  fi

  if [ "$lock_ts" -gt "$mod_ts" ] 2>/dev/null && [ "$mod_ts" != "0" ]; then
    _aikami_warn "bun.lock changed since last install — run: bun install"
  fi
}
