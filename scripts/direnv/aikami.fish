# ─── Aikami Fish Shell Shortcuts ────────────────────────────────────────
#
# Source this file from your fish config to get moon task aliases and
# workflow shortcuts that work in fish shell.
#
# Quick setup:
#   ln -sf $AIKAMI_ROOT/scripts/direnv/aikami.fish ~/.config/fish/conf.d/aikami.fish
#
# Requires AIKAMI_ROOT to be set (done by .envrc via direnv).
#
# ──────────────────────────────────────────────────────────────────────────

# ── Core Aliases ─────────────────────────────────────────────────────────

alias nr 'bunx moon run'
alias nrf 'bunx moon run :fix'
alias nrc 'bunx moon run :typecheck'
alias nrs 'bunx moon sync'
alias nra 'bunx moon run --affected'

# ── m: moon run shorthand ────────────────────────────────────────────────
function m
    if test (count $argv) -eq 0
        bunx moon run --help 2>/dev/null | head -30; or bunx moon run
    else
        bunx moon run $argv
    end
end

# ── md: dev server shortcut ─────────────────────────────────────────────
function md
    set -l proj $argv[1]
    if test -z "$proj"
        echo "Usage: md <project>  (pwa, docs, landing-page, gamejs, firebase)"
        return 1
    end
    if test "$proj" = firebase
        bunx moon run firebase:emulate
    else
        bunx moon run {$proj}:dev
    end
end

# ── mt: test shortcut ───────────────────────────────────────────────────
function mt
    set -l proj $argv[1]
    if test -z "$proj"
        echo "Usage: mt <project>  (pwa, docs, landing-page, gamejs, firebase, schemas, etc.)"
        return 1
    end
    bunx moon run {$proj}:test
end

# ── mb: build shortcut ──────────────────────────────────────────────────
function mb
    set -l proj $argv[1]
    if test -z "$proj"
        echo "Usage: mb <project>  (pwa, docs, landing-page, gamejs)"
        return 1
    end
    bunx moon run {$proj}:build
end

# ── mf: fix (lint+format) ───────────────────────────────────────────────
function mf
    if test "$argv[1]" = --unsafe
        bunx moon run :fix -- --unsafe
    else if test "$argv[1]" = --affected; or test "$argv[1]" = -a
        bunx moon run :fix --affected
    else
        bunx moon run :fix --affected
    end
end

# ── mc: typecheck ───────────────────────────────────────────────────────
function mc
    if test "$argv[1]" = --all
        bunx moon run :typecheck
    else
        bunx moon run :typecheck --affected
    end
end

# ── ms: moon sync ───────────────────────────────────────────────────────
function ms
    bunx moon sync
end

# ── ma: affected tasks ──────────────────────────────────────────────────
function ma
    set -l task $argv[1]
    if test -z "$task"
        bunx moon run --affected
    else
        bunx moon run :$task --affected
    end
end

# ── Workflows ────────────────────────────────────────────────────────────

function aikami_dev
    echo "🎴 Starting Aikami local dev environment..."
    echo "   Mode: "(set -q AIKAMI_MODE; and echo $AIKAMI_MODE; or echo emulator)
    echo ""
    bunx moon run firebase:emulate
end

function aikami_emulate
    echo "🔥 Starting backend emulators..."
    bunx moon run firebase:emulate
end

function aikami_validate
    set -l do_test $argv[1]
    echo "🔍 Validating affected projects..."
    echo ""
    echo "── Fix ──"
    bunx moon run :fix --affected; or return 1

    echo ""
    echo "── Typecheck ──"
    bunx moon run :typecheck --affected; or return 1

    if test "$do_test" = --test; or test "$do_test" = -t
        echo ""
        echo "── Build ──"
        bunx moon run :build --affected; or return 1

        echo ""
        echo "── Test ──"
        bunx moon run :test --affected; or return 1
    end

    echo ""
    echo "✅ Validation complete"
end

function aikami_affected
    bunx moon query projects --affected
end

function aikami_graph
    echo "🔗 Opening project graph in browser..."
    bunx moon project-graph
end

# ── Logs ─────────────────────────────────────────────────────────────────

function aikami_logs
    set -l app $argv[1]
    if test -z "$app"; set app firebase; end

    switch $app
        case firebase functions
            bunx moon run firebase:logs
        case '*'
            echo "Usage: aikami_logs <app>"
            echo "  Apps: firebase"
            return 1
    end
end

# ── Environment Switcher ─────────────────────────────────────────────────

function aikami_switch
    set -l mode $argv[1]
    if test -z "$mode"
        echo "Usage: aikami_switch <emulator|development|production>"
        echo "Current mode: "(set -q AIKAMI_MODE; and echo $AIKAMI_MODE; or echo emulator)
        return 1
    end

    switch $mode
        case emulator development production
            # valid
        case '*'
            echo "Invalid mode: $mode (use emulator, development, or production)"
            return 1
    end

    set -l root (git rev-parse --show-toplevel 2>/dev/null; or echo $PWD)
    echo "AIKAMI_MODE=$mode" > $root/.env.local

    echo "✅ Switched to $mode mode"
    echo "   Run 'direnv reload' or cd out/in to apply."
end

# ── Help ─────────────────────────────────────────────────────────────────

function aikami_help
    set -l mode (set -q AIKAMI_MODE; and echo $AIKAMI_MODE; or echo emulator)
    set -l proj (set -q AIKAMI_PROJECT_ID; and echo $AIKAMI_PROJECT_ID; or echo demo-aikami-emulator)
    set -l bun_ver (bun --version 2>/dev/null; or echo "N/A")

    echo ""
    echo "  🎴 Aikami Shell Shortcuts"
    echo ""
    echo "  CORE MOON TASKS"
    echo "    m <target>       Run any moon task (e.g., m pwa:dev, m firebase:build)"
    echo "    md <project>     Start dev server (pwa, docs, landing-page, gamejs, firebase)"
    echo "    mt <project>     Run tests"
    echo "    mb <project>     Build"
    echo "    mf               Fix (lint + format) affected projects"
    echo "    mc               Typecheck affected projects"
    echo "    ms               Sync moon projects"
    echo "    ma [task]        Run all affected tasks (optional: specific task)"
    echo ""
    echo "  WORKFLOWS"
    echo "    aikami_dev              Start full local dev environment"
    echo "    aikami_emulate          Start backend emulators only"
    echo "    aikami_validate         Fix → typecheck (add --test for build+test)"
    echo "    aikami_affected         Show which projects changed"
    echo "    aikami_graph            Open project dependency graph"
    echo ""
    echo "  LOGS"
    echo "    aikami_logs <app>       View recent logs (firebase)"
    echo ""
    echo "  ENVIRONMENT"
    echo "    aikami_switch <mode>     Switch environment mode"
    echo ""
    echo "  STATE"
    echo "    Mode:     $mode"
    echo "    Project:  $proj"
    echo "    Bun:      $bun_ver"
    echo ""
end
