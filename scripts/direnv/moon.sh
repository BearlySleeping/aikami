#!/usr/bin/env bash
# ─── Aikami Moon Task Runner Aliases ─────────────────────────────────────
#
# Source this from .envrc to expose convenient shell aliases and functions
# for the monorepo's moon task runner. All shortcuts use `bunx moon` to
# ensure they work regardless of shell PATH configuration.
#
# Shortcuts follow these conventions:
#   m <target>          — moon run (e.g., m pwa:dev, m firebase:typecheck)
#   md <project>        — run dev server (moon run <project>:dev)
#   mt <project>        — run tests (moon run <project>:test)
#   mb <project>        — build (moon run <project>:build)
#   mf                  — fix all affected projects
#   mc                  — typecheck all affected projects
#   ms                  — moon sync projects
#   ma                  — run all affected tasks

set -euo pipefail

# ── Core Aliases ─────────────────────────────────────────────────────────

alias nr='bunx moon run'
alias nrf='bunx moon run :fix'
alias nrc='bunx moon run :typecheck'
alias nrs='bunx moon sync'
alias nra='bunx moon run --affected'

# ── m: moon run shorthand ────────────────────────────────────────────────
#
# Usage:
#   m pwa:dev          — start PWA dev server
#   m firebase:build   — build Firebase functions
#   m                  — list available targets
m() {
  if [ $# -eq 0 ]; then
    bunx moon run --help 2>/dev/null | head -30 || bunx moon run
    return
  fi
  bunx moon run "$@"
}

# ── md: dev server shortcut ─────────────────────────────────────────────
#
# Usage:
#   md pwa           — start PWA dev server
#   md docs          — start docs dev server
#   md landing-page  — start landing page dev server
#   md gamejs        — start GameJS dev server
#   md firebase      — start Firebase emulators
md() {
  local proj="${1:-}"
  local mode="${2:-}"
  if [ -z "$proj" ]; then
    echo "Usage: md <project> [--mode emulator]  (pwa, docs, landing-page, game, firebase)"
    return 1
  fi
  case "$proj" in
    firebase)
      bunx moon run firebase:emulate
      ;;
    game)
      if [ "$mode" = "--mode" ] && [ "${3:-}" = "emulator" ]; then
        cd apps/frontend/game && bun run dev -- --mode emulator
      else
        bunx moon run game:dev
      fi
      ;;
    *)
      bunx moon run "${proj}:dev"
      ;;
  esac
}

# ── mt: test shortcut ───────────────────────────────────────────────────
mt() {
  local proj="${1:-}"
  if [ -z "$proj" ]; then
    echo "Usage: mt <project>  (pwa, docs, landing-page, gamejs, firebase, schemas, etc.)"
    return 1
  fi
  bunx moon run "${proj}:test"
}

# ── mb: build shortcut ──────────────────────────────────────────────────
mb() {
  local proj="${1:-}"
  if [ -z "$proj" ]; then
    echo "Usage: mb <project>  (pwa, docs, landing-page, gamejs)"
    return 1
  fi
  bunx moon run "${proj}:build"
}

# ── mf: fix (lint+format) ───────────────────────────────────────────────
mf() {
  if [ "${1:-}" = "--unsafe" ]; then
    bunx moon run :fix -- --unsafe
  elif [ "${1:-}" = "--affected" ] || [ "${1:-}" = "-a" ]; then
    bunx moon run :fix --affected
  else
    bunx moon run :fix --affected
  fi
}

# ── mc: typecheck ───────────────────────────────────────────────────────
mc() {
  if [ "${1:-}" = "--all" ]; then
    bunx moon run :typecheck
  else
    bunx moon run :typecheck --affected
  fi
}

# ── ms: moon sync ───────────────────────────────────────────────────────
ms() {
  bunx moon sync
}

# ── ma: affected tasks ──────────────────────────────────────────────────
ma() {
  local task="${1:-}"
  if [ -z "$task" ]; then
    bunx moon run --affected
  else
    bunx moon run ":$task" --affected
  fi
}

# ── Convenience: Aikami-specific workflows ──────────────────────────────

# Start the full local dev environment in tmux (emulators + pwa + game)
aikami_dev() {
  echo "🎴 Starting Aikami local dev environment..."
  echo "   Mode: ${AIKAMI_MODE:-emulator}"
  echo ""
  bun run scripts/src/lib/tmux/start.ts all
  echo ""
  aikami_tmux_join all 2>/dev/null || true
}

# Start just the backend emulators in tmux
aikami_emulate() {
  echo "🔥 Starting backend emulators..."
  bun run scripts/src/lib/tmux/start.ts emulators
  echo ""
  aikami_tmux_join emulators 2>/dev/null || true
}

# Start game in emulator mode in tmux
aikami_game_emulate() {
  echo "🎮 Starting game in emulator mode..."
  bun run scripts/src/lib/tmux/start.ts game
  echo ""
  aikami_tmux_join game 2>/dev/null || true
}

# ── Tmux Session Management ─────────────────────────────────────────────

aikami_tmux_start() {
  local service="${1:-}"
  if [ -z "$service" ]; then
    echo "Usage: aikami_tmux_start <emulators|pwa|game|all> [--force]"
    return 1
  fi
  bun run scripts/src/lib/tmux/start.ts "$@"
}

aikami_tmux_join() {
  local service="${1:-}"
  if [ -z "$service" ]; then
    echo "Usage: aikami_tmux_join <emulators|pwa|game|all>"
    return 1
  fi
  bun run scripts/src/lib/tmux/join.ts "$@"
}

aikami_tmux_stop() {
  local service="${1:-}"
  if [ -z "$service" ]; then
    echo "Usage: aikami_tmux_stop <emulators|pwa|game|all>"
    echo "       aikami_tmux_stop_all  — stop all sessions"
    return 1
  fi
  bun run scripts/src/lib/tmux/stop.ts "$@"
}

aikami_tmux_stop_all() {
  bun run scripts/src/lib/tmux/stop_all.ts
}

aikami_tmux_status() {
  bun run scripts/src/lib/tmux/status.ts
}

# Aliases
alias atstart='aikami_tmux_start'
alias atjoin='aikami_tmux_join'
alias atstop='aikami_tmux_stop'
alias atstopall='aikami_tmux_stop_all'
alias atstatus='aikami_tmux_status'

# Run blackbox integration tests
aikami_test_blackbox() {
  echo "🧪 Running blackbox integration tests..."
  if command -v bun &>/dev/null; then
    # Use pi's blackbox_test if available via the monorepo scripts
    if bun run test:blackbox 2>/dev/null; then
      return 0
    fi
  fi
  echo "  ℹ️  blackbox tests require the pi coding agent or firebase emulators"
}

# Full validation: fix → typecheck → build → test (on affected projects)
aikami_validate() {
  local do_test="${1:-}"
  echo "🔍 Validating affected projects..."
  echo ""

  echo "── Fix ──"
  bunx moon run :fix --affected || {
    echo "❌ Fix failed"
    return 1
  }

  echo ""
  echo "── Typecheck ──"
  bunx moon run :typecheck --affected || {
    echo "❌ Typecheck failed"
    return 1
  }

  if [ "$do_test" = "--test" ] || [ "$do_test" = "-t" ]; then
    echo ""
    echo "── Build ──"
    bunx moon run :build --affected || {
      echo "❌ Build failed"
      return 1
    }

    echo ""
    echo "── Test ──"
    bunx moon run :test --affected || {
      echo "❌ Tests failed"
      return 1
    }
  fi

  echo ""
  echo "✅ Validation complete"
}

# Show affected projects (what changed)
aikami_affected() {
  bunx moon query projects --affected
}

# Show project dependency graph
aikami_graph() {
  echo "🔗 Opening project graph in browser..."
  bunx moon project-graph
}

# ── Logs shortcuts ──────────────────────────────────────────────────────

aikami_logs() {
  local app="${1:-firebase}"
  local mode="${AIKAMI_MODE:-development}"

  case "$app" in
    firebase|functions)
      echo "📋 Firebase functions logs — use firebase:logs moon task"
      bunx moon run firebase:logs "${@:2}" ;;
    pwa)
      echo "📋 PWA logs — use service_logs tool via pi coding agent" ;;
    *)
      echo "Usage: aikami_logs <app>"
      echo "  Apps: firebase, pwa"
      return 1 ;;
  esac
}

# ── Environment Switcher ─────────────────────────────────────────────────
#
# Usage: aikami_switch emulator|development|production
aikami_switch() {
  local mode="${1:-}"
  if [ -z "$mode" ]; then
    echo "Usage: aikami_switch <emulator|development|production>"
    echo "Current mode: ${AIKAMI_MODE:-emulator}"
    return 1
  fi

  case "$mode" in
    emulator|development|production) ;;
    *)
      echo "Invalid mode: $mode (use emulator, development, or production)"
      return 1
      ;;
  esac

  echo "AIKAMI_MODE=$mode" > "$(_aikami_root)/.env.local"

  echo "✅ Switched to $mode mode"
  echo "   Run 'direnv reload' or cd out/in to apply."
  echo ""
  echo "   Or source the new env now:"
  echo "   export AIKAMI_MODE=$mode && source scripts/direnv/secrets.sh && _aikami_load_mode"
}

# ── Help ─────────────────────────────────────────────────────────────────

aikami_help() {
  cat <<EOF

  🎴 Aikami Shell Shortcuts

  CORE MOON TASKS
    m <target>       Run any moon task (e.g., m pwa:dev, m firebase:build)
    md <project>     Start dev server (pwa, docs, landing-page, game, firebase)
                     md game --mode emulator → game emulator mode
    mt <project>     Run tests
    mb <project>     Build
    mf               Fix (lint + format) affected projects
    mc               Typecheck affected projects
    ms               Sync moon projects
    ma [task]        Run all affected tasks (optional: specific task)

  WORKFLOWS
    aikami_dev              Start full stack in tmux (auto-attach)
    aikami_emulate          Start backend emulators in tmux (auto-attach)
    aikami_game_emulate     Start game in emulator mode in tmux (auto-attach)
    aikami_validate         Fix → typecheck (add --test for build+test)
    aikami_affected         Show which projects changed
    aikami_graph            Open project dependency graph

  TMUX SESSIONS
    aikami_tmux_start <svc> Start tmux session (emulators|pwa|game|all)
    aikami_tmux_join <svc>  Attach to running tmux session
    aikami_tmux_stop <svc>  Stop tmux session
    aikami_tmux_stop_all    Stop all aikami tmux sessions
    aikami_tmux_status      List running aikami sessions
    atstart/atjoin/atstop   Short aliases for the above

  LOGS
    aikami_logs <app>       View recent logs (firebase, pwa)

  ENVIRONMENT
    aikami_switch <mode>     Switch environment mode
    aikami_secrets_refresh   Re-pull secrets from GSM

  STATE
    Mode:     ${AIKAMI_MODE:-emulator}
    Project:  ${AIKAMI_PROJECT_ID:-demo-aikami-emulator}

EOF
}

# ── Banner on shell entry ────────────────────────────────────────────────

_aikami_moon_banner() {
  echo ""
  echo "  🎴 Aikami ready  |  Mode: ${AIKAMI_MODE}  |  $(bun --version 2>/dev/null || echo 'bun N/A')"
  echo "  Type 'aikami_help' for available shortcuts."
  echo ""
}
