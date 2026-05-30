#!/usr/bin/env bash
# ─── Aikami GCP Secret Manager Local Integration ─────────────────────────
#
# Sources this from .envrc to pre-populate environment variables from
# Google Cloud Secret Manager when authenticated, or fall back to local
# mock/placeholder values when offline or in emulator mode.
#
# Secrets are cached in a gitignored .env.secrets.local file so that the
# network round-trip is skipped on subsequent shell entries.
#
# Usage in .envrc:
#   source scripts/direnv/secrets.sh
#   _aikami_secrets_load
#
# Requires: gcloud CLI (authenticated), jq
# Cache file: .env.secrets.local (gitignored, per-mode)

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────

# Secrets to attempt to pull from GSM (ordered by priority).
# Add new keys here as the project grows.
readonly _AIKAMI_SECRET_KEYS=(
  # Gemini / LLM API keys
  GEMINI_API_KEY

  # Firebase service account
  FIREBASE_SERVICE_ACCOUNT
)

# How old the cache can be before we attempt a refresh (seconds)
readonly _AIKAMI_SECRETS_CACHE_TTL=$((60 * 30)) # 30 minutes

# ── Helpers ──────────────────────────────────────────────────────────────

_aikami_secrets_cache_file() {
  echo "$(_aikami_root)/.env.secrets.local"
}

_aikami_secrets_cache_age() {
  local cache_file
  cache_file="$(_aikami_secrets_cache_file)"
  if [ ! -f "$cache_file" ]; then
    echo 999999
    return
  fi
  local now mtime
  now=$(date +%s)
  if command -v stat &>/dev/null; then
    if stat --version 2>/dev/null | grep -q GNU; then
      mtime=$(stat -c %Y "$cache_file")
    else
      mtime=$(stat -f %m "$cache_file")
    fi
  else
    mtime=0
  fi
  echo $((now - mtime))
}

# ── Fetch from GSM ───────────────────────────────────────────────────────

_aikami_secrets_fetch_gsm() {
  local project_id="$1"
  local tempfile
  tempfile=$(mktemp)

  echo "# Aikami secrets — auto-generated $(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$tempfile"
  echo "# Mode: $AIKAMI_MODE  Project: $project_id" >> "$tempfile"

  local found=0 missing=0

  for key in "${_AIKAMI_SECRET_KEYS[@]}"; do
    local secret_name="$key"
    local value

    # Try GSM access via gcloud
    if value=$(gcloud secrets versions access latest \
      --secret="$secret_name" \
      --project="$project_id" \
      --quiet 2>/dev/null); then
      echo "${key}=${value}" >> "$tempfile"
      found=$((found + 1))
    else
      # Secret not found — write empty placeholder so developer knows it's missing
      echo "# ${key}=<missing in GSM>" >> "$tempfile"
      missing=$((missing + 1))
    fi
  done

  # Atomically replace cache
  mv "$tempfile" "$(_aikami_secrets_cache_file)"

  if [ "$found" -gt 0 ]; then
    _aikami_ok "Secrets: pulled $found from GSM"
  fi
  if [ "$missing" -gt 0 ]; then
    _aikami_warn "Secrets: $missing not found in GSM (placeholder in cache)"
  fi
}

# ── Load from cache ──────────────────────────────────────────────────────

_aikami_secrets_load_cache() {
  local cache_file
  cache_file="$(_aikami_secrets_cache_file)"

  if [ ! -f "$cache_file" ]; then
    return 1
  fi

  local loaded=0
  while IFS='=' read -r key value; do
    # Skip comments and empty lines
    case "$key" in
      '#'*) continue ;;
      '')   continue ;;
    esac
    # Skip placeholder lines
    case "$value" in
      '<missing in GSM>') continue ;;
    esac
    # Only export if not already set (respect existing env vars)
    if [ -z "${!key:-}" ]; then
      export "$key=$value"
      loaded=$((loaded + 1))
    fi
  done < "$cache_file"

  if [ "$loaded" -gt 0 ]; then
    _aikami_ok "Secrets: loaded $loaded from cache"
  fi
  return 0
}

# ── Mock secrets (emulator mode or offline) ──────────────────────────────

_aikami_secrets_load_mocks() {
  # In emulator mode, set placeholder values so apps work locally
  _aikami_log "Secrets: using emulator mock values"

  # Only set if not already defined
  export GEMINI_API_KEY="${GEMINI_API_KEY:-emulator-key}"
}

# ── Main entry point ─────────────────────────────────────────────────────

_aikami_secrets_load() {
  _aikami_h1 "Secret Manager"

  # Emulator mode — always use mocks (fast, offline-safe)
  if [ "$AIKAMI_IS_EMULATOR" = "1" ]; then
    _aikami_secrets_load_mocks
    return 0
  fi

  # Check gcloud auth
  if ! command -v gcloud &>/dev/null; then
    _aikami_warn "gcloud not found — using cached secrets or mocks"
    if ! _aikami_secrets_load_cache; then
      _aikami_log "No cache found — using mock values"
      _aikami_secrets_load_mocks
    fi
    return 0
  fi

  local account
  account=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null || true)

  if [ -z "$account" ]; then
    _aikami_warn "Not authenticated — using cached secrets or mocks"
    if ! _aikami_secrets_load_cache; then
      _aikami_log "No cache found — using mock values"
      _aikami_secrets_load_mocks
    fi
    return 0
  fi

  # Authenticated: check cache freshness
  local age
  age=$(_aikami_secrets_cache_age)

  if [ "$age" -lt "$_AIKAMI_SECRETS_CACHE_TTL" ] && [ -f "$(_aikami_secrets_cache_file)" ]; then
    _aikami_log "Secrets: cache fresh ($((age / 60))m ago) — skip GSM fetch"
    _aikami_secrets_load_cache
    return 0
  fi

  # Fetch fresh secrets from GSM
  _aikami_log "Secrets: fetching from GSM ($AIKAMI_PROJECT_ID)..."
  _aikami_secrets_fetch_gsm "$AIKAMI_PROJECT_ID"
  _aikami_secrets_load_cache
}

# ── Force-refresh helper (for manual use) ────────────────────────────────
#
# Usage: aikami_secrets_refresh
aikami_secrets_refresh() {
  _aikami_h1 "Secret Manager — Force Refresh"
  _aikami_load_mode

  if [ "$AIKAMI_IS_EMULATOR" = "1" ]; then
    _aikami_log "Emulator mode — no GSM pull needed"
    _aikami_secrets_load_mocks
    return 0
  fi

  if ! command -v gcloud &>/dev/null; then
    _aikami_err "gcloud CLI not found"
    return 1
  fi

  local account
  account=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null || true)
  if [ -z "$account" ]; then
    _aikami_err "Not authenticated — run: gcloud auth application-default login"
    return 1
  fi

  _aikami_secrets_fetch_gsm "$AIKAMI_PROJECT_ID"
  _aikami_secrets_load_cache
  _aikami_ok "Secrets refreshed from GSM"
}
