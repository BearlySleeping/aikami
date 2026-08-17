#!/bin/sh
# apps/backend/local-stack/install.sh
#
# Aikami Local Stack — one-command installer (C-418 Feature F).
#
# Usage (recommended):
#   curl -fsSL https://aikami.sh/install | sh
#
# What it does, step by step (each step is logged so a failure is
# diagnosable from output alone):
#   1. Checks prerequisites (docker, tar, curl/wget).
#   2. Downloads the versioned release bundle (compose files + `.env.example`
#      + the compiled `stack-init` hardware wizard binary).
#   3. Verifies the tarball extracted cleanly.
#   4. Runs the hardware wizard on the HOST (never inside a container — GPU
#      detection without the NVIDIA toolkit is unreliable, C-418 Feature F).
#      Interactive terminals get the full wizard; piped installs run
#      non-interactive (`--yes`, auto-detect) so `curl | sh` just works.
#   5. Prints the `docker compose up -d` command for the user to run.
#
# Guarantees:
#   - An existing `.env` is NEVER overwritten (no silent clobber).
#   - No `git clone` is required — this is the primary path.
#   - Pure POSIX sh (dash-compatible); no bash-specific features.
#
# Overrides (env vars):
#   AIKAMI_STACK_DIR        install directory (default: $HOME/.aikami-stack)
#   AIKAMI_STACK_VERSION    release version (default: latest)
#   AIKAMI_INSTALL_BASE_URL bundle base URL (default: GitHub releases;
#                           once aikami.sh DNS is live (C-418 OQ-5) this
#                           defaults to https://aikami.sh)
#   AIKAMI_SKIP_WIZARD      1 = skip the hardware wizard (fetch only)
#
# The release bundle layout (produced by scripts/bundle_stack.sh):
#   compose*.yaml  .env.example  bin/stack-init

set -eu

log() { printf '\033[1;34m[aikami]\033[0m %s\n' "$*"; }
die() {
  printf '\033[1;31m[aikami] error:\033[0m %s\n' "$*" >&2
  exit 1
}

# ── Configuration ────────────────────────────────────────────────────────
VERSION="${AIKAMI_STACK_VERSION:-latest}"
INSTALL_DIR="${AIKAMI_STACK_DIR:-$HOME/.aikami-stack}"
# Default to GitHub releases until the aikami.sh domain resolves (OQ-5).
BASE_URL="${AIKAMI_INSTALL_BASE_URL:-https://github.com/BearlySleeping/aikami/releases/download}"
BUNDLE_FILE="local-stack-${VERSION}.tar.gz"
BUNDLE_URL="${BASE_URL}/${VERSION}/${BUNDLE_FILE}"
SKIP_WIZARD="${AIKAMI_SKIP_WIZARD:-0}"

# ── Prerequisites ────────────────────────────────────────────────────────
log "step 1/5 — checking prerequisites"
command -v docker >/dev/null 2>&1 || die "Docker is required (https://docs.docker.com/engine/install/)."
command -v tar >/dev/null 2>&1 || die "tar is required."
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  die "curl or wget is required."
fi

# ── Fetch the bundle ─────────────────────────────────────────────────────
log "step 2/5 — downloading the local stack bundle"
log "  version: ${VERSION}"
log "  source:  ${BUNDLE_URL}"
log "  target:  ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
TMP_BUNDLE="${INSTALL_DIR}/.${BUNDLE_FILE}.part"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "${BUNDLE_URL}" -o "${TMP_BUNDLE}" \
    || die "download failed (${BUNDLE_URL}). Check AIKAMI_STACK_VERSION / network."
else
  wget -qO "${TMP_BUNDLE}" "${BUNDLE_URL}" \
    || die "download failed (${BUNDLE_URL}). Check AIKAMI_STACK_VERSION / network."
fi
log "  downloaded ${BUNDLE_FILE}"

# ── Extract ──────────────────────────────────────────────────────────────
log "step 3/5 — extracting the bundle"
mkdir -p "${INSTALL_DIR}/bundle"
tar -xzf "${TMP_BUNDLE}" -C "${INSTALL_DIR}/bundle" \
  || die "bundle extraction failed — the archive may be corrupt."
rm -f "${TMP_BUNDLE}"

# The bundle tarball carries one versioned top-level directory
# (local-stack-<version>/). Resolve it so the handoff path and the wizard
# path work regardless of which version was fetched.
BUNDLE_DIR="$(find "${INSTALL_DIR}/bundle" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[ -n "${BUNDLE_DIR}" ] || die "bundle archive is empty or malformed."

STACK_INIT="${BUNDLE_DIR}/bin/stack-init"
if [ "${SKIP_WIZARD}" != "1" ] && [ ! -x "${STACK_INIT}" ]; then
  die "compiled stack-init binary missing in the bundle (${STACK_INIT})."
fi

# ── Hardware wizard (host-side) ──────────────────────────────────────────
log "step 4/5 — running the hardware wizard"
if [ "${SKIP_WIZARD}" = "1" ]; then
  log "  skipped (AIKAMI_SKIP_WIZARD=1)"
elif [ -f "${INSTALL_DIR}/.env" ]; then
  # Never silently overwrite a hand-edited .env (C-418 Feature F).
  log "  .env already exists at ${INSTALL_DIR}/.env — leaving it untouched."
  log "  Re-run the wizard manually to change hardware:"
  log "    ${STACK_INIT} --env-path ${INSTALL_DIR}/.env"
else
  if [ -t 0 ]; then
    # Interactive terminal — full hardware-detection wizard.
    "${STACK_INIT}" --env-path "${INSTALL_DIR}/.env"
  else
    # Piped install (curl | sh) — non-interactive auto-detect.
    log "  non-interactive install — auto-detecting hardware (--yes)"
    "${STACK_INIT}" --yes --env-path "${INSTALL_DIR}/.env"
  fi
  log "  .env written to ${INSTALL_DIR}/.env"
fi

# ── Handoff ──────────────────────────────────────────────────────────────
log "step 5/5 — done"
log "Start the stack from ${BUNDLE_DIR}:"
log "  cd ${BUNDLE_DIR} && docker compose up -d"
log ""
log "Enable modalities (text,image,voice,stt,client) by editing"
log "  ${INSTALL_DIR}/.env  (COMPOSE_PROFILES / COMPOSE_FILE), then re-run"
log "  'docker compose up -d'."
log ""
log "Contributors: clone the repo for source builds — see the README."
