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
#   1. Checks prerequisites (docker, tar, curl/wget) and that this OS/arch
#      is supported (compiled `stack-init` binaries are platform-specific).
#   2. Resolves the release version (default: latest release via the GitHub
#      API) and downloads the versioned bundle tarball + SHA256SUMS.
#   3. Verifies the tarball SHA-256 against SHA256SUMS BEFORE extraction —
#      nothing is ever executed from an unverified download.
#   4. Extracts into the compose project directory and runs the hardware
#      wizard on the HOST (never inside a container — GPU detection without
#      the NVIDIA toolkit is unreliable, C-418 Feature F). Interactive
#      terminals get the full wizard; piped installs run non-interactive
#      (`--yes`, auto-detect) so `curl | sh` just works.
#   5. Prints the `docker compose up -d` command for the user to run.
#
# The wizard writes `.env` into the SAME directory that holds compose.yaml
# (the compose project dir), so `docker compose up -d` actually reads it.
#
# Guarantees:
#   - An existing `.env` is NEVER overwritten (no silent clobber).
#   - The downloaded tarball is checksum-verified before extraction.
#   - No `git clone` is required — this is the primary path.
#   - Pure POSIX sh (dash-compatible); no bash-specific features.
#
# Overrides (env vars):
#   AIKAMI_STACK_DIR        install directory (default: $HOME/.aikami-stack)
#   AIKAMI_STACK_VERSION    release version, e.g. 0.1.0 (default: latest)
#   AIKAMI_INSTALL_BASE_URL bundle base URL (default: GitHub releases;
#                           once aikami.sh DNS is live (C-418 OQ-5) this
#                           defaults to https://aikami.sh)
#   AIKAMI_SKIP_WIZARD      1 = skip the hardware wizard (fetch only)
#
# The release bundle layout (produced by scripts/bundle_stack.sh):
#   compose*.yaml  .env.example  bin/stack-init  install.sh  SHA256SUMS
#
# Release naming (single source of truth — see publish-local-stack.yml):
#   GitHub release tag:  local-stack-<version>
#   asset:               local-stack-<version>.tar.gz
#   checksums:           SHA256SUMS

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
API_BASE_URL="${AIKAMI_INSTALL_API_URL:-https://api.github.com/repos/BearlySleeping/aikami}"
SKIP_WIZARD="${AIKAMI_SKIP_WIZARD:-0}"

# ── Platform support (M1) ────────────────────────────────────────────────
# `stack-init` is a compiled Bun binary; it only runs where a matching
# binary was published. bundle_stack.sh compiles for the host by default and
# supports cross-compiling via AIKAMI_BUNDLE_TARGETS. The installer fails
# fast with a clear message for unsupported platforms instead of downloading
# a tarball whose binary cannot execute.
OS_NAME="$(uname -s 2>/dev/null || echo unknown)"
MACHINE="$(uname -m 2>/dev/null || echo unknown)"
case "${OS_NAME}" in
  Linux)
    case "${MACHINE}" in
      x86_64|amd64) PLATFORM="linux-x64" ;;
      aarch64|arm64) PLATFORM="linux-arm64" ;;
      *) die "unsupported architecture '${MACHINE}' on Linux — the compiled stack-init binary is published for x64/arm64 only; run 'bun run stack init' from a repo clone instead." ;;
    esac
    ;;
  Darwin)
    case "${MACHINE}" in
      x86_64) PLATFORM="darwin-x64" ;;
      arm64) PLATFORM="darwin-arm64" ;;
      *) die "unsupported architecture '${MACHINE}' on macOS — run 'bun run stack init' from a repo clone instead." ;;
    esac
    ;;
  *)
    die "unsupported OS '${OS_NAME}' — the one-command installer supports Linux and macOS; run 'bun run stack init' from a repo clone instead."
    ;;
esac
log "platform: ${OS_NAME}/${MACHINE} (${PLATFORM})"

# ── Resolve the release version (H3) ─────────────────────────────────────
# Naming contract: release tag `local-stack-<version>`, asset
# `local-stack-<version>.tar.gz`. `latest` resolves the newest release tag
# through the GitHub API; an explicit version (0.1.0 or full tag form
# local-stack-0.1.0) is accepted.
if [ "${VERSION}" = "latest" ]; then
  log "step 1/6 — resolving latest release"
  if command -v curl >/dev/null 2>&1; then
    LATEST_JSON="$(curl -fsSL "${API_BASE_URL}/releases/latest" 2>/dev/null || true)"
  else
    LATEST_JSON="$(wget -qO- "${API_BASE_URL}/releases/latest" 2>/dev/null || true)"
  fi
  RELEASE_TAG="$(printf '%s' "${LATEST_JSON}" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  case "${RELEASE_TAG}" in
    local-stack-*) VERSION="${RELEASE_TAG#local-stack-}" ;;
    *) die "could not resolve the latest release tag (API replied: ${RELEASE_TAG:-empty}). Set AIKAMI_STACK_VERSION=<version> explicitly." ;;
  esac
  log "  resolved version ${VERSION} (tag ${RELEASE_TAG})"
fi
case "${VERSION}" in
  local-stack-*) VERSION="${VERSION#local-stack-}" ;; # tolerate full-tag form
esac
RELEASE_TAG="local-stack-${VERSION}"
BUNDLE_FILE="local-stack-${VERSION}.tar.gz"
BUNDLE_URL="${BASE_URL}/${RELEASE_TAG}/${BUNDLE_FILE}"
CHECKSUMS_URL="${BASE_URL}/${RELEASE_TAG}/SHA256SUMS"

# ── Prerequisites ────────────────────────────────────────────────────────
log "step 2/6 — checking prerequisites"
command -v docker >/dev/null 2>&1 || die "Docker is required (https://docs.docker.com/engine/install/)."
command -v tar >/dev/null 2>&1 || die "tar is required."
if command -v sha256sum >/dev/null 2>&1; then
  SHA256="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA256="shasum -a 256"
else
  die "sha256sum or shasum is required to verify the download."
fi
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  die "curl or wget is required."
fi

fetch_url() { # url dest
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2" || return 1
  else
    wget -qO "$2" "$1" || return 1
  fi
}

# ── Fetch + verify the bundle (H3/M2) ────────────────────────────────────
log "step 3/6 — downloading the local stack bundle"
log "  version: ${VERSION} (tag ${RELEASE_TAG})"
log "  source:  ${BUNDLE_URL}"
log "  target:  ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
TMP_BUNDLE="${INSTALL_DIR}/.${BUNDLE_FILE}.part"
TMP_SUMS="${INSTALL_DIR}/.SHA256SUMS.part"
if ! fetch_url "${BUNDLE_URL}" "${TMP_BUNDLE}"; then
  die "download failed (${BUNDLE_URL}). Check AIKAMI_STACK_VERSION / network."
fi
if ! fetch_url "${CHECKSUMS_URL}" "${TMP_SUMS}"; then
  die "checksums download failed (${CHECKSUMS_URL}). Refusing to install an unverified bundle."
fi
log "  downloaded ${BUNDLE_FILE}"

log "step 4/6 — verifying SHA-256 checksum"
EXPECTED_HASH="$(awk '$2 == "'"${BUNDLE_FILE}"'" { print $1 }' "${TMP_SUMS}" | head -n 1)"
[ -n "${EXPECTED_HASH}" ] || die "SHA256SUMS has no entry for ${BUNDLE_FILE} — refusing to install."
ACTUAL_HASH="$(${SHA256} "${TMP_BUNDLE}" | awk '{ print $1 }')"
if [ "${ACTUAL_HASH}" != "${EXPECTED_HASH}" ]; then
  rm -f "${TMP_BUNDLE}" "${TMP_SUMS}"
  die "checksum mismatch for ${BUNDLE_FILE} (expected ${EXPECTED_HASH}, got ${ACTUAL_HASH}). The download is corrupt or tampered with — re-run to retry."
fi
log "  checksum OK (${EXPECTED_HASH})"

# ── Extract ──────────────────────────────────────────────────────────────
# Preserve an existing wizard-written .env across re-installs: the bundle
# directory is replaced wholesale below, and an existing .env must never be
# silently clobbered (C-418 Feature F). The content is copied to a temp
# location first — the source path dies with the bundle dir.
PREV_ENV_FILE="$(find "${INSTALL_DIR}/bundle" -mindepth 2 -maxdepth 2 -name .env -type f 2>/dev/null | head -n 1 || true)"
PRESERVED_ENV=0
if [ -n "${PREV_ENV_FILE}" ] && [ -f "${PREV_ENV_FILE}" ]; then
  cp "${PREV_ENV_FILE}" "${INSTALL_DIR}/.env.preserved"
  PRESERVED_ENV=1
fi

log "step 5/6 — extracting the bundle"
rm -rf "${INSTALL_DIR}/bundle"
mkdir -p "${INSTALL_DIR}/bundle"
tar -xzf "${TMP_BUNDLE}" -C "${INSTALL_DIR}/bundle" \
  || die "bundle extraction failed — the archive may be corrupt."
rm -f "${TMP_BUNDLE}" "${TMP_SUMS}"

# The bundle tarball carries one versioned top-level directory
# (local-stack-<version>/). Resolve it so the handoff path and the wizard
# path work regardless of which version was fetched.
BUNDLE_DIR="$(find "${INSTALL_DIR}/bundle" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[ -n "${BUNDLE_DIR}" ] || die "bundle archive is empty or malformed."

# H2: the wizard writes .env into BUNDLE_DIR (where compose.yaml lives) so
# `docker compose up -d` in that directory actually reads it.
ENV_FILE="${BUNDLE_DIR}/.env"
if [ "${PRESERVED_ENV}" = "1" ]; then
  cp "${INSTALL_DIR}/.env.preserved" "${ENV_FILE}"
  rm -f "${INSTALL_DIR}/.env.preserved"
  log "  preserved existing .env from previous install"
fi

STACK_INIT="${BUNDLE_DIR}/bin/stack-init"
if [ "${SKIP_WIZARD}" != "1" ] && [ ! -x "${STACK_INIT}" ]; then
  die "compiled stack-init binary missing in the bundle (${STACK_INIT})."
fi

# ── Hardware wizard (host-side) ──────────────────────────────────────────
log "step 6/6 — running the hardware wizard"
if [ "${SKIP_WIZARD}" = "1" ]; then
  log "  skipped (AIKAMI_SKIP_WIZARD=1)"
elif [ -f "${ENV_FILE}" ]; then
  # Never silently overwrite a hand-edited .env (C-418 Feature F).
  log "  .env already exists at ${ENV_FILE} — leaving it untouched."
  log "  Re-run the wizard manually to change hardware:"
  log "    ${STACK_INIT} --env-path ${ENV_FILE}"
else
  if [ -t 0 ]; then
    # Interactive terminal — full hardware-detection wizard.
    "${STACK_INIT}" --env-path "${ENV_FILE}"
  else
    # Piped install (curl | sh) — non-interactive auto-detect.
    log "  non-interactive install — auto-detecting hardware (--yes)"
    "${STACK_INIT}" --yes --env-path "${ENV_FILE}"
  fi
  log "  .env written to ${ENV_FILE}"
fi

# ── Handoff ──────────────────────────────────────────────────────────────
log "done"
log "Start the stack:"
log "  cd ${BUNDLE_DIR} && docker compose up -d"
log ""
log "Enable modalities (text,image,voice,stt,client) by editing"
log "  ${ENV_FILE}  (COMPOSE_PROFILES / COMPOSE_FILE), then re-run"
log "  'docker compose up -d'."
log ""
log "Contributors: clone the repo for source builds — see the README."
