#!/usr/bin/env bash
# ─── Aikami Direnv Bootstrap ─────────────────────────────────────────────
#
# THE ONLY direnv shell script. Sourced by .envrc on every shell entry.
#
# Responsibilities:
#   1. nix-direnv integration + Nix flake devShell loading
#   2. AIKAMI_MODE resolution from .env.local
#   3. Shell aliases + workflow functions (moon shortcuts, aikami_*)
#   4. Delegates secrets loading to Bun (scripts/src/lib/env/secrets.ts)
#   5. Delegates runtime validation to Bun (scripts/src/lib/env/check.ts)
#
# Fish shell users: env vars are set, but aliases/functions are bash-only.
# ────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Early exit: already loaded ─────────────────────────────────────────
if [ -n "${AIKAMI_ENV_LOADED:-}" ]; then
  return 0
fi

# ── 0. Detect project root ─────────────────────────────────────────────
AIKAMI_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
export AIKAMI_ROOT

# ── 1. Nix-direnv integration ──────────────────────────────────────────

_aikami_setup_nix_direnv() {
  if type use_flake &>/dev/null 2>&1; then
    return 0
  fi

  if [ -n "${NIX_DIRENV:-}" ] && [ -f "$NIX_DIRENV/share/nix-direnv/direnvrc" ]; then
    source "$NIX_DIRENV/share/nix-direnv/direnvrc"
    return 0
  fi

  local nix_direnv_path
  if nix_direnv_path=$(nix eval --raw nixpkgs#nix-direnv.outPath 2>/dev/null); then
    if [ -f "$nix_direnv_path/share/nix-direnv/direnvrc" ]; then
      source "$nix_direnv_path/share/nix-direnv/direnvrc"
      return 0
    fi
  fi

  if [ -z "${_AIKAMI_NIX_DIRENV_WARNED:-}" ]; then
    echo "⚠️  nix-direnv caching not enabled — flake will evaluate on every shell entry"
    echo ""
    echo "   To fix (one-time setup):"
    echo "   1. Install nix-direnv:  nix profile install nixpkgs#nix-direnv"
    echo "   2. Configure direnvrc:"
    echo '      mkdir -p ~/.config/direnv'
    echo '      echo "source \$HOME/.nix-profile/share/nix-direnv/direnvrc" >> ~/.config/direnv/direnvrc'
    echo "   3. Run: direnv allow"
    echo ""
    export _AIKAMI_NIX_DIRENV_WARNED=1
  fi
  return 0
}

_aikami_setup_nix_direnv

# ── 2. Load Nix flake devShell ─────────────────────────────────────────
use flake

# ── 3. Mode resolution ─────────────────────────────────────────────────

declare -A _AIKAMI_PROJECT_MAP=(
  [emulator]="demo-aikami-emulator"
  [staging]="aikami-dev"
  [production]="aikami-prod"
)

_aikami_load_mode() {
  if [ -n "${AIKAMI_MODE:-}" ]; then
    case "$AIKAMI_MODE" in
      emulator|staging|production) ;;
      *)
        echo "  ⚠️  Invalid AIKAMI_MODE='$AIKAMI_MODE' — falling back to emulator"
        AIKAMI_MODE="emulator"
        ;;
    esac
  else
    AIKAMI_MODE="emulator"
    local config_file="$AIKAMI_ROOT/.env.local"

    if [ -f "$config_file" ]; then
      local mode_from_file
      mode_from_file=$(grep -E '^AIKAMI_MODE=' "$config_file" 2>/dev/null | head -1 | cut -d= -f2- | xargs || true)

      if [ -n "$mode_from_file" ]; then
        case "$mode_from_file" in
          emulator|staging|production)
            AIKAMI_MODE="$mode_from_file"
            ;;
          *)
            echo "  ⚠️  .env.local mode='$mode_from_file' invalid — using 'emulator'"
            ;;
        esac
      fi
    fi
  fi

  export AIKAMI_MODE
  export AIKAMI_ENV="$AIKAMI_MODE"
  export AIKAMI_PROJECT_ID="${_AIKAMI_PROJECT_MAP[$AIKAMI_MODE]:-demo-aikami-emulator}"

  if [ "$AIKAMI_MODE" = "emulator" ]; then
    export AIKAMI_IS_EMULATOR=1
  else
    export AIKAMI_IS_EMULATOR=0
  fi
}

_aikami_load_mode

# ── 4. Delegate secrets to Bun ─────────────────────────────────────────

echo "━━━ Secret Manager ━━━"
eval "$(bun run "$AIKAMI_ROOT/scripts/src/lib/env/secrets.ts" 2>&2)"

# ── 5. Delegate runtime validation to Bun ──────────────────────────────

bun run "$AIKAMI_ROOT/scripts/src/lib/env/check.ts" 2>&2

# ── 6. Shell aliases + workflow functions (bash/zsh only) ───────────────

_aikami_is_bash_or_zsh() {
  case "${SHELL:-}" in
    *fish*) return 1 ;;
    *)      return 0 ;;
  esac
}

if _aikami_is_bash_or_zsh; then

  # ── Core aliases ────────────────────────────────────────────────────

  alias nr='bunx moon run'
  alias nrf='bunx moon run :fix'
  alias nrc='bunx moon run :typecheck'
  alias nrs='bunx moon sync'
  alias nra='bunx moon run --affected'

  m() {
    if [ $# -eq 0 ]; then
      bunx moon run --help 2>/dev/null | head -30 || bunx moon run
      return
    fi
    bunx moon run "$@"
  }

  md() {
    local proj="${1:-}"
    local mode="${2:-}"
    if [ -z "$proj" ]; then
      echo "Usage: md <project> [--mode emulator]  (client, docs, landing-page, game, firebase)"
      return 1
    fi
    case "$proj" in
      firebase)
        bunx moon run firebase:emulate ;;
      game)
        if [ "$mode" = "--mode" ] && [ "${3:-}" = "emulator" ]; then
          cd "$AIKAMI_ROOT/apps/frontend/game" && bun run dev -- --mode emulator
        else
          bunx moon run game:dev
        fi ;;
      *)
        bunx moon run "${proj}:dev" ;;
    esac
  }

  mt() {
    local proj="${1:-}"
    if [ -z "$proj" ]; then
      echo "Usage: mt <project>  (client, docs, landing-page, game, firebase, schemas, etc.)"
      return 1
    fi
    bunx moon run "${proj}:test"
  }

  mb() {
    local proj="${1:-}"
    if [ -z "$proj" ]; then
      echo "Usage: mb <project>  (client, docs, landing-page, game)"
      return 1
    fi
    bunx moon run "${proj}:build"
  }

  mf() {
    if [ "${1:-}" = "--unsafe" ]; then
      bunx moon run :fix -- --unsafe
    else
      bunx moon run :fix --affected
    fi
  }

  mc() {
    if [ "${1:-}" = "--all" ]; then
      bunx moon run :typecheck
    else
      bunx moon run :typecheck --affected
    fi
  }

  ms() { bunx moon sync; }

  ma() {
    local task="${1:-}"
    if [ -z "$task" ]; then
      bunx moon run --affected
    else
      bunx moon run ":$task" --affected
    fi
  }

  # ── aikami_dev: start full local dev in tmux ────────────────────────

  aikami_dev() {
    echo "🎴 Starting Aikami local dev environment..."
    echo "   Mode: ${AIKAMI_MODE:-emulator}"
    echo ""
    bun run scripts/src/lib/tmux/start.ts all
    echo ""
    aikami_tmux_join all 2>/dev/null || true
  }

  aikami_emulate() {
    echo "🔥 Starting backend emulators..."
    bun run scripts/src/lib/tmux/start.ts emulators
    echo ""
    aikami_tmux_join emulators 2>/dev/null || true
  }

  aikami_game_emulate() {
    echo "🎮 Starting game in emulator mode..."
    bun run scripts/src/lib/tmux/start.ts game
    echo ""
    aikami_tmux_join game 2>/dev/null || true
  }

  # ── Tmux shortcuts ──────────────────────────────────────────────────

  aikami_tmux_start()   { bun run scripts/src/lib/tmux/start.ts "$@"; }
  aikami_tmux_join()    { bun run scripts/src/lib/tmux/join.ts "$@"; }
  aikami_tmux_stop()    { bun run scripts/src/lib/tmux/stop.ts "$@"; }
  aikami_tmux_stop_all() { bun run scripts/src/lib/tmux/stop_all.ts; }
  aikami_tmux_status()  { bun run scripts/src/lib/tmux/status.ts; }

  alias atstart='aikami_tmux_start'
  alias atjoin='aikami_tmux_join'
  alias atstop='aikami_tmux_stop'
  alias atstopall='aikami_tmux_stop_all'
  alias atstatus='aikami_tmux_status'

  # ── aikami_validate ─────────────────────────────────────────────────

  aikami_validate() {
    local do_test="${1:-}"
    echo "🔍 Validating affected projects..."
    echo ""
    export CI=true

    echo "── Fix ──"
    bunx moon run :fix --affected < /dev/null || { echo "❌ Fix failed"; return 1; }

    echo ""
    echo "── Typecheck ──"
    bunx moon run :typecheck --affected < /dev/null || { echo "❌ Typecheck failed"; return 1; }

    if [ "$do_test" = "--test" ] || [ "$do_test" = "-t" ]; then
      echo ""
      echo "── Build ──"
      bunx moon run :build --affected < /dev/null || { echo "❌ Build failed"; return 1; }

      echo ""
      echo "── Test ──"
      bunx moon run :test --affected < /dev/null || { echo "❌ Tests failed"; return 1; }
    fi

    echo ""
    echo "✅ Validation complete"
  }

  aikami_affected() { bunx moon query projects --affected; }
  aikami_graph()    { echo "🔗 Opening project graph in browser..."; bunx moon project-graph; }

  aikami_logs() {
    local app="${1:-firebase}"
    case "$app" in
      firebase|functions) bunx moon run firebase:logs ;;
      *) echo "Usage: aikami_logs <app> (firebase)" ; return 1 ;;
    esac
  }

  aikami_switch() {
    local mode="${1:-}"
    if [ -z "$mode" ]; then
      echo "Usage: aikami_switch <emulator|staging|production>"
      echo "Current mode: ${AIKAMI_MODE:-emulator}"
      return 1
    fi
    case "$mode" in
      emulator|staging|production) ;;
      *) echo "Invalid mode: $mode"; return 1 ;;
    esac
    echo "AIKAMI_MODE=$mode" > "$AIKAMI_ROOT/.env.local"
    echo "✅ Switched to $mode mode"
    echo "   Run 'direnv reload' or cd out/in to apply."
  }

  aikami_secrets_refresh() {
    echo "🔐 Refreshing secrets..."
    eval "$(bun run "$AIKAMI_ROOT/scripts/src/lib/env/secrets.ts" 2>&2)"
    echo "✅ Secrets refreshed"
  }

  aikami_help() {
    cat <<EOF

  🎴 Aikami Shell Shortcuts

  CORE MOON TASKS
    m <target>       Run any moon task (e.g., m client:dev, m firebase:build)
    md <project>     Start dev server (client, docs, landing-page, game, firebase)
                     md game --mode emulator → game emulator mode
    mt <project>     Run tests
    mb <project>     Build
    mf               Fix (lint + format) affected projects
    mc               Typecheck affected projects
    ms               Sync moon projects
    ma [task]        Run all affected tasks

  WORKFLOWS
    aikami_dev              Start full stack in tmux
    aikami_emulate          Start backend emulators in tmux
    aikami_game_emulate     Start game in emulator mode
    aikami_validate         Fix → typecheck (add --test for build+test)
    aikami_affected         Show which projects changed
    aikami_graph            Open project dependency graph

  TMUX SESSIONS
    aikami_tmux_start <svc> Start tmux (emulators|client|game|all)
    aikami_tmux_join <svc>  Attach to tmux session
    aikami_tmux_stop <svc>  Stop tmux session
    atstart/atjoin/atstop   Short aliases

  ENVIRONMENT
    aikami_switch <mode>     Switch mode
    aikami_secrets_refresh   Re-pull secrets

  STATE
    Mode:     ${AIKAMI_MODE:-emulator}
    Project:  ${AIKAMI_PROJECT_ID:-demo-aikami-emulator}

EOF
  }

  # ── Banner ──────────────────────────────────────────────────────────

  echo ""
  echo "  🎴 Aikami ready  |  Mode: ${AIKAMI_MODE}  |  $(bun --version 2>/dev/null || echo 'bun N/A')"
  echo "  Type 'aikami_help' for available shortcuts."
  echo ""

else
  # Fish shell
  echo ""
  echo "  🐟 Fish shell detected — moon aliases not loaded."
  echo "     Env vars are set (AIKAMI_MODE=$AIKAMI_MODE)."
  echo ""
  echo "  🎴 Aikami ready  |  Mode: ${AIKAMI_MODE}  |  $(bun --version 2>/dev/null || echo 'bun N/A')"
  echo ""
fi

# ── Mark as loaded ─────────────────────────────────────────────────────

export AIKAMI_ENV_LOADED=1
