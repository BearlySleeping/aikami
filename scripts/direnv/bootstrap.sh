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

# ── 0.1 SOPS age key (C-441) ────────────────────────────────────────────
# Dedicated aikami-only maintainer key, kept separate from any personal
# dotfiles-managed default at ~/.config/sops/age/keys.txt — losing or
# rotating one must never touch the other. sops checks SOPS_AGE_KEY_FILE
# before falling back to the global default, so this only takes effect
# inside the aikami repo.
if [ -f "$AIKAMI_ROOT/.age/maintainer_key.txt" ]; then
  export SOPS_AGE_KEY_FILE="$AIKAMI_ROOT/.age/maintainer_key.txt"
fi

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

# ── 2.1 Bun version drift guard ────────────────────────────────────────
# .bun-version is the source of truth CI's setup-bun action and moon's
# toolchain read. flake.nix pins nixpkgs' bun to match it. If they drift,
# a local `bun install` writes a bun.lock shaped by the wrong bun and CI's
# `bun install --frozen-lockfile` rejects it with "lockfile had changes,
# but lockfile is frozen" — see docs/guides/CI_CD.md.
if command -v bun &>/dev/null && [ -f "$AIKAMI_ROOT/.bun-version" ]; then
  _aikami_pinned_bun="$(cat "$AIKAMI_ROOT/.bun-version" | tr -d '[:space:]')"
  _aikami_active_bun="$(bun --version)"
  if [ "$_aikami_pinned_bun" != "$_aikami_active_bun" ]; then
    echo "⚠️  bun version drift: active bun is $_aikami_active_bun, .bun-version pins $_aikami_pinned_bun"
    echo "   flake.nix's bun overlay is out of sync — bump it and 'direnv reload', or"
    echo "   bun install will write a lockfile CI's frozen install rejects."
  fi
  unset _aikami_pinned_bun _aikami_active_bun
fi

# ── 3. Mode resolution ─────────────────────────────────────────────────

declare -A _AIKAMI_PROJECT_MAP=(
  [emulator]="demo-aikami-emulator"
  [staging]="aikami-staging"
  [production]="aikami-production"
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

# ── 3.5. Pi Version Sync ─────────────────────────────────────────────
# Auto-installs correct @earendil-works/pi-coding-agent when .pi/package.json
# drifts from node_modules (e.g. after `pi update`).
source "${AIKAMI_ROOT}/scripts/direnv/sync-pi.sh"
_aikami_sync_pi_version

# ── 4. Pi-Hypa binary + configuration (additive mode — keeps custom tools active) ─
_path_hypa_bin="$AIKAMI_ROOT/.pi/node_modules/.bin"
if [ -d "$_path_hypa_bin" ]; then
  export PATH="$_path_hypa_bin:$PATH"
fi
unset _path_hypa_bin
export HYPA_PI_MODE="additive"
export HYPA_PI_REWRITE_TIMEOUT_MS="10000"
export HYPA_PI_ASK_NON_INTERACTIVE="deny"

# ── 4.5. pi-deepseek-optimized harness (cache module disabled) ─────────
#
# 🔴 The harness is NOT the cause of the session loops, despite arriving at
# roughly the same time. Measured across all 285 stored sessions: the loop /
# reasoning-collapse rate is 28% on the pre-migration `deepseek` provider
# (61/221 sessions) and 34% after the move to `deepinfra` (21/62) — a
# difference that is not significant (two-proportion z=0.97, p=0.33), and the
# worst cases on record (2026-07-30, 08-03, 08-07, 08-09) predate the harness
# install on 2026-08-21 by three weeks. Its only context-mutating module is
# `cache`, which is disabled below anyway. The real gap was in cost_guard's
# detectors; see section 4.6.
#
# The harness ships five modules. Four are keepers; its `cache` module is
# not, and PI_HARNESS_CACHE_ENABLED=0 disables that module alone:
#
#   * stripTimestamps used an UNANCHORED regex
#     (/Current (date|time)…|Today( is)?[:\s].*|Date[:\s]\d{4}-…/gim)
#     that truncates any prompt line from a match to end-of-line. Ordinary
#     prose was being silently mangled — "Do not assume today is the same
#     as the file mtime" became "Do not assume ". The system prompt carries
#     CLAUDE.md and the skill index, so this corrupted real instructions.
#
#   * stripReasoning deletes reasoning_content from assistant messages,
#     directly contradicting requiresReasoningContentOnAssistantMessages
#     in ~/.pi/agent/models.json (pi then backfills an empty string).
#
#   * sortTools is redundant — pi-cache-optimizer already owns prompt and
#     payload stability, and measured cache hit rate is ~97-98%.
#
# Hashlines and plan mode stay ON; they are the modules that actually earn
# their keep. Rewind stays OFF (harness default).
#
# 🔴 Storm-breaker is OFF as of 2026-08-25: it keys on the tool NAME and
# ignores the arguments, so N consecutive failures of the same tool trip it
# even when every call targeted something different. Measured over all 334
# stored sessions with >=10 assistant turns:
#
#     3+ consecutive failures of the same tool NAME  — 39 sessions (12%)
#     3+ consecutive failures of the same name+ARGS  —  2 sessions (0.6%)
#
# So at threshold 3 roughly 95% of its trips are not repeats at all, they are
# ordinary exploration. The case that forced this (2026-08-25): a review agent
# verifying findings against the tree read three DIFFERENT paths, each of
# which legitimately did not exist. That non-existence WAS the answer it was
# sent to find; storm-breaker read three ENOENTs as a storm and called
# abort(), destroying the result mid-verification.
#
# Nothing is lost by disabling it. cost_guard's loop and cycle trackers cover
# the real failure and key on JSON.stringify(arguments), so three reads of
# three different paths never match — and unlike storm-breaker they steer
# first and only halt on a second strike. Re-enabling is one env var, but the
# harness module cannot be made argument-aware from here.
export PI_HARNESS_CACHE_ENABLED="0"
export PI_HARNESS_STORMBREAKER_ENABLED="0"
export PI_HARNESS_HASHLINES_ENABLED="1"
export PI_HARNESS_PLANMODE_ENABLED="1"

# ── 4.6. Runaway guards (cost_guard.ts) ────────────────────────────────
#
# Spend caps alone cannot catch a cheap runaway: a 2.5h / 308-turn session
# on a 97%-cached model reached only ~$5. These bound the other two axes —
# turns without human input, and wall-clock — so a stuck pipeline fails in
# minutes instead of hours.
export PI_SOFT_SPEND="${PI_SOFT_SPEND:-10.00}"
export PI_HARD_SPEND="${PI_HARD_SPEND:-15.00}"
# Backstops only — the loop/collapse detectors are the real guard. Calibrated
# against all 289 stored sessions, because the first guessed values were far
# too tight: turns p90=217/p99=743/legit-max=821 (a 120 cap would have killed
# 23% of healthy sessions) and active run minutes p90=25/p99=74/legit-max=247
# (a 45m cap would have killed 34%). Run time counts only active work since
# the last prompt, not idle session age.
export PI_MAX_TURNS="${PI_MAX_TURNS:-1000}"
export PI_MAX_RUN_MINUTES="${PI_MAX_RUN_MINUTES:-240}"
export PI_REPETITION_GUARD="${PI_REPETITION_GUARD:-1}"
# Consecutive identical turns before the loop guard intervenes. Calibrated
# against all 270 stored sessions: 261 never exceed a run of 2, and the only
# two that do hit 88 and 846 (the latter a contract implementer that ran
# 6h19m on 2026-08-17). A threshold of 4 catches both with no false positives.
export PI_LOOP_THRESHOLD="${PI_LOOP_THRESHOLD:-4}"
# Completed A-B-A-B cycles before the guard steers (halts at 2x). The period-1
# tracker above only counts CONSECUTIVE identical turns, so it is blind to an
# alternation — and on 2026-08-23 the model responded to a period-1 steer by
# alternating two calls instead, then ran that pair for 26 cycles (~12 min,
# byte-identical arguments) until the run was interrupted by hand. Calibrated
# over the same 285 sessions: healthy runs reach a period-2 match run of 2
# (p99=1), the wedged ones reach 52, 86 and 844.
export PI_CYCLE_THRESHOLD="${PI_CYCLE_THRESHOLD:-3}"
# Repeats of one segment inside REASONING blocks before the collapse guard
# trips. Deliberately far above PI_REPETITION_THRESHOLD (6, which applies to
# text): the model drafts code in its reasoning and drafting repeats lines.
# Measured over all 27,783 stored reasoning blocks, healthy turns reach 37
# repeats of "```typescript"; every genuine collapse sits at 64+ and is
# repeated prose. A threshold of 6 here would have killed 44 healthy sessions.
export PI_THINK_REPETITION_THRESHOLD="${PI_THINK_REPETITION_THRESHOLD:-50}"
# Growth, in bytes, between mid-stream collapse scans. `turn_end` fires only
# once a turn COMPLETES, so before the mid-stream check existed a collapsing
# generation ran unchecked until it exhausted maxTokens — on 2026-08-23 one
# reached 298,477 characters and the user's Ctrl+C is what ended it, after
# which the guard reported "x192" to an already-dead session. The scan is
# throttled by growth because message_update fires per token.
export PI_STREAM_SCAN_BYTES="${PI_STREAM_SCAN_BYTES:-8192}"

# ── 5. Delegate secrets to Bun ─────────────────────────────────────────

echo "━━━ Secret Manager ━━━"
eval "$(bun run "$AIKAMI_ROOT/scripts/src/lib/env/secrets.ts" 2>&2)"

# ── 6. Delegate runtime validation to Bun ──────────────────────────────

bun run "$AIKAMI_ROOT/scripts/src/lib/env/check.ts" 2>&2

# ── 7. Shell aliases + workflow functions (bash/zsh only) ───────────────

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

  # ── aikami_dev: start full local dev in herdr ────────────────────────

  aikami_dev() {
    echo "🎴 Starting Aikami local dev environment..."
    echo "   Mode: ${AIKAMI_MODE:-emulator}"
    echo ""
    bun run scripts/src/lib/herdr/start.ts all
    echo ""
    aikami_herdr_join all 2>/dev/null || true
  }

  aikami_emulate() {
    echo "🔥 Starting backend emulators..."
    bun run scripts/src/lib/herdr/start.ts firebase
    echo ""
    aikami_herdr_join firebase 2>/dev/null || true
  }

  # ── Herdr shortcuts ──────────────────────────────────────────────────

  aikami_herdr_start()   { bun run scripts/src/lib/herdr/start.ts "$@"; }
  aikami_herdr_join()    { bun run scripts/src/lib/herdr/join.ts "$@"; }
  aikami_herdr_stop()    { bun run scripts/src/lib/herdr/stop.ts "$@"; }
  aikami_herdr_stop_all() { bun run scripts/src/lib/herdr/stop_all.ts; }
  aikami_herdr_status()  { bun run scripts/src/lib/herdr/status.ts; }

  alias ahstart='aikami_herdr_start'
  alias ahjoin='aikami_herdr_join'
  alias ahstop='aikami_herdr_stop'
  alias ahstopall='aikami_herdr_stop_all'
  alias ahstatus='aikami_herdr_status'

  # ── aikami_validate ─────────────────────────────────────────────────

  aikami_validate() {
    local do_test="${1:-}"
    echo "🔍 Validating affected projects..."
    echo ""
    local -x CI=true

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
    aikami_dev              Start full stack in herdr
    aikami_emulate          Start backend emulators in herdr
    aikami_validate         Fix → typecheck (add --test for build+test)
    aikami_affected         Show which projects changed
    aikami_graph            Open project dependency graph

  HERDR SESSIONS
    aikami_herdr_start <svc> Start herdr (firebase|client|voice|image|text|all)
    aikami_herdr_join <svc>  Attach to herdr workspace
    aikami_herdr_stop <svc>  Stop herdr workspace
    ahstart/ahjoin/ahstop   Short aliases

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
