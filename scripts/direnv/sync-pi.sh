#!/usr/bin/env bash
# ─── Pi Version Sync ───────────────────────────────────────────────────────
#
# Checks whether the installed @earendil-works/pi-coding-agent version in
# .pi/node_modules matches the declared version in .pi/package.json. If they
# have drifted (e.g. after `pi update` bumped package.json but node_modules
# was not reinstalled), auto-runs `bun install` to bring things in sync.
#
# Called from bootstrap.sh BEFORE the .pi/node_modules/.bin PATH injection,
# so pi always resolves to the correct version inside the aikami project.
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

_aikami_sync_pi_version() {
  local pi_dir="$AIKAMI_ROOT/.pi"
  local pkg_json="$pi_dir/package.json"
  local installed_pkg="$pi_dir/node_modules/@earendil-works/pi-coding-agent/package.json"

  # ── Guard: no .pi directory or package.json ──────────────────────────
  if [ ! -f "$pkg_json" ]; then
    return 0
  fi

  # ── Read declared version range (e.g. "^0.80.7") ─────────────────────
  local declared
  declared=$(node -e "
    const pkg = require('$pkg_json');
    const v = pkg.devDependencies?.['@earendil-works/pi-coding-agent']
          || pkg.dependencies?.['@earendil-works/pi-coding-agent'];
    process.stdout.write(v || '');
  " 2>/dev/null || true)

  if [ -z "$declared" ]; then
    return 0
  fi

  # ── Read installed version ───────────────────────────────────────────
  if [ ! -f "$installed_pkg" ]; then
    echo "  ⚡ @earendil-works/pi-coding-agent not installed — running bun install..."
    (cd "$pi_dir" && bun install --silent 2>&1 | tail -3) || true
    return 0
  fi

  local installed
  installed=$(node -e "
    process.stdout.write(require('$installed_pkg').version || '');
  " 2>/dev/null || true)

  if [ -z "$installed" ]; then
    return 0
  fi

  # ── Semver check: does installed satisfy declared range? ─────────────
  local satisfied
  satisfied=$(node -e "
    const semver = require('$pi_dir/node_modules/semver/index.js');
    process.stdout.write(semver.satisfies('$installed', '$declared') ? '1' : '0');
  " 2>/dev/null || echo "0")

  if [ "$satisfied" = "1" ]; then
    return 0
  fi

  # ── Drift detected — auto-install ────────────────────────────────────
  echo ""
  echo "  ⚡ pi version drift (installed: $installed, expected: $declared)"
  echo "  ⚡ Auto-installing correct version..."
  (cd "$pi_dir" && bun install 2>&1 | tail -5) || true

  # Re-read to confirm
  local new_ver
  new_ver=$(node -e "
    process.stdout.write(require('$installed_pkg').version || 'unknown');
  " 2>/dev/null || echo "unknown")
  echo "  ✓ pi synced to $new_ver"
  echo ""
}
