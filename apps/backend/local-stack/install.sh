#!/bin/sh
# apps/backend/local-stack/install.sh
#
# Aikami Local Stack — one-command installer (C-418 Feature F).
#
# Usage (recommended):
#   curl -fsSL https://aikami.sh/install | sh
#
# Windows has its own twin with the same guarantees and the same layout:
#   powershell -c "irm https://aikami.sh/install.ps1 | iex"
#
# What it does, step by step (each step is logged so a failure is
# diagnosable from output alone):
#   1. Checks prerequisites (docker, tar, curl/wget) and that this OS/arch
#      is supported (compiled `stack-init` binaries are platform-specific,
#      so each platform gets its own bundle asset).
#   2. Resolves the release version (default: the newest `local-stack-*`
#      release) and downloads the versioned bundle tarball + SHA256SUMS.
#   3. Verifies the tarball SHA-256 against SHA256SUMS BEFORE extraction —
#      nothing is ever executed from an unverified download.
#   4. Extracts into the compose project directory ($AIKAMI_STACK_DIR/current
#      — a stable path, never a version glob) and runs the hardware wizard on
#      the HOST (never inside a container — GPU detection without the NVIDIA
#      toolkit is unreliable, C-418 Feature F). Interactive terminals get the
#      full wizard; piped installs run non-interactive (`--yes`, auto-detect)
#      so `curl | sh` just works.
#   5. Installs the `aikami` control command, then optionally starts the
#      stack and installs the desktop app.
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
# Overrides (env vars — the `curl | sh` form cannot take flags):
#   AIKAMI_STACK_DIR        install directory (default: $HOME/.aikami-stack)
#   AIKAMI_STACK_VERSION    release version, e.g. 0.1.0 (default: latest)
#   AIKAMI_INSTALL_BASE_URL bundle base URL (default: GitHub releases;
#                           once aikami.sh DNS is live (C-418 OQ-5) this
#                           defaults to https://aikami.sh)
#   AIKAMI_SKIP_WIZARD      1 = skip the hardware wizard (fetch only)
#   AIKAMI_START            1 = start the stack when the install finishes
#   AIKAMI_CLIENT           1 = install the desktop app
#   AIKAMI_NO_PATH          1 = do not link `aikami` into ~/.local/bin
#   AIKAMI_YES              1 = never prompt (assume the default answer)
#
# The release bundle layout (produced by scripts/bundle_stack.sh):
#   compose*.yaml  .env.example  bin/stack-init  install.sh  aikami  VERSION
#
# Release naming (single source of truth — see publish-local-stack.yml):
#   GitHub release tag:  local-stack-<version>
#   asset:               local-stack-<version>-<platform>.tar.gz
#   checksums:           SHA256SUMS

set -eu

log() { printf '\033[1;34m[aikami]\033[0m %s\n' "$*"; }
info() { printf '         %s\n' "$*"; }
warn() { printf '\033[1;33m[aikami] warning:\033[0m %s\n' "$*"; }
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
WANT_START="${AIKAMI_START:-0}"
WANT_CLIENT="${AIKAMI_CLIENT:-0}"
NO_PATH="${AIKAMI_NO_PATH:-0}"
ASSUME_YES="${AIKAMI_YES:-0}"

# Interactive only when stdin is a terminal AND the caller did not opt out.
# `curl | sh` has stdin bound to the pipe, so this is false there — the same
# test that picks the wizard's --yes mode below.
INTERACTIVE=0
if [ -t 0 ] && [ "${ASSUME_YES}" != "1" ]; then
  INTERACTIVE=1
fi

confirm() { # question default(y|n) → 0 = yes
  if [ "${INTERACTIVE}" != "1" ]; then
    [ "$2" = "y" ]
    return
  fi
  if [ "$2" = "y" ]; then suffix="[Y/n]"; else suffix="[y/N]"; fi
  printf '\033[1;34m[aikami]\033[0m %s %s ' "$1" "${suffix}"
  read -r answer </dev/tty || answer=""
  case "$(printf '%s' "${answer}" | tr '[:upper:]' '[:lower:]')" in
    y|yes) return 0 ;;
    n|no) return 1 ;;
    *) [ "$2" = "y" ] ;;
  esac
}

# ── Platform support (M1) ────────────────────────────────────────────────
# `stack-init` is a compiled Bun binary; each platform gets its own bundle
# asset so nobody downloads four binaries they cannot run. The installer
# fails fast with a clear message for unsupported platforms instead of
# downloading an archive whose binary cannot execute.
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
  MINGW*|MSYS*|CYGWIN*)
    die "this is the POSIX installer — on Windows run instead:\n  powershell -c \"irm https://aikami.sh/install.ps1 | iex\""
    ;;
  *)
    die "unsupported OS '${OS_NAME}' — the one-command installer supports Linux, macOS, and Windows (install.ps1); run 'bun run stack init' from a repo clone instead."
    ;;
esac
log "platform: ${OS_NAME}/${MACHINE} (${PLATFORM})"

# ── Prerequisites ────────────────────────────────────────────────────────
log "step 1/6 — checking prerequisites"
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
if ! command -v docker >/dev/null 2>&1; then
  # Not fatal: the wizard and the bundle are still worth installing, and the
  # user may be provisioning a machine before Docker. `aikami doctor` says the
  # same thing later, so the failure mode is never a mystery.
  warn "Docker was not found on PATH — install it before \`aikami up\`: https://docs.docker.com/engine/install/"
elif ! docker info >/dev/null 2>&1; then
  warn "Docker is installed but the engine is not responding — start it before \`aikami up\`."
else
  info "docker engine is running"
fi

fetch_url() { # url dest
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2" || return 1
  else
    wget -qO "$2" "$1" || return 1
  fi
}
fetch_stdout() { # url
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" 2>/dev/null || true
  else
    wget -qO- "$1" 2>/dev/null || true
  fi
}

# ── Resolve the release version (H3) ─────────────────────────────────────
# Naming contract: release tag `local-stack-<version>`, asset
# `local-stack-<version>-<platform>.tar.gz`. This repo publishes BOTH desktop
# app releases (`v*`) and local-stack releases, so /releases/latest is the
# WRONG endpoint — it returns whichever release is newest overall. List
# releases (newest first) and take the first `local-stack-*` tag.
log "step 2/6 — resolving the release"
if [ "${VERSION}" = "latest" ]; then
  RELEASES_JSON="$(fetch_stdout "${API_BASE_URL}/releases?per_page=100")"
  RELEASE_TAG="$(printf '%s' "${RELEASES_JSON}" \
    | tr ',' '\n' \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\(local-stack-[^"]*\)".*/\1/p' \
    | head -n 1)"
  [ -n "${RELEASE_TAG}" ] || die "could not resolve the newest local-stack release from the GitHub API. Set AIKAMI_STACK_VERSION=<version> explicitly."
  VERSION="${RELEASE_TAG#local-stack-}"
  info "resolved version ${VERSION} (tag ${RELEASE_TAG})"
fi
case "${VERSION}" in
  local-stack-*) VERSION="${VERSION#local-stack-}" ;; # tolerate full-tag form
esac
RELEASE_TAG="local-stack-${VERSION}"
BUNDLE_FILE="local-stack-${VERSION}-${PLATFORM}.tar.gz"
BUNDLE_URL="${BASE_URL}/${RELEASE_TAG}/${BUNDLE_FILE}"
CHECKSUMS_URL="${BASE_URL}/${RELEASE_TAG}/SHA256SUMS"

# ── Fetch + verify the bundle (H3/M2) ────────────────────────────────────
log "step 3/6 — downloading the local stack bundle"
info "version: ${VERSION} (tag ${RELEASE_TAG})"
info "source:  ${BUNDLE_URL}"
info "target:  ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
TMP_BUNDLE="${INSTALL_DIR}/.${BUNDLE_FILE}.part"
TMP_SUMS="${INSTALL_DIR}/.SHA256SUMS.part"
if ! fetch_url "${BUNDLE_URL}" "${TMP_BUNDLE}"; then
  die "download failed (${BUNDLE_URL}). Check AIKAMI_STACK_VERSION / network."
fi
if ! fetch_url "${CHECKSUMS_URL}" "${TMP_SUMS}"; then
  die "checksums download failed (${CHECKSUMS_URL}). Refusing to install an unverified bundle."
fi
info "downloaded ${BUNDLE_FILE}"

log "step 4/6 — verifying SHA-256 checksum"
EXPECTED_HASH="$(awk '$2 == "'"${BUNDLE_FILE}"'" || $2 == "*'"${BUNDLE_FILE}"'" { print $1 }' "${TMP_SUMS}" | head -n 1)"
[ -n "${EXPECTED_HASH}" ] || die "SHA256SUMS has no entry for ${BUNDLE_FILE} — refusing to install."
ACTUAL_HASH="$(${SHA256} "${TMP_BUNDLE}" | awk '{ print $1 }')"
if [ "${ACTUAL_HASH}" != "${EXPECTED_HASH}" ]; then
  rm -f "${TMP_BUNDLE}" "${TMP_SUMS}"
  die "checksum mismatch for ${BUNDLE_FILE} (expected ${EXPECTED_HASH}, got ${ACTUAL_HASH}). The download is corrupt or tampered with — re-run to retry."
fi
info "checksum OK (${EXPECTED_HASH})"

# ── Extract ──────────────────────────────────────────────────────────────
# The stack always lands in $INSTALL_DIR/current — a stable path, so the
# handoff is `cd ~/.aikami-stack/current` and never a version glob, and an
# upgrade replaces the same directory. Preserve an existing wizard-written
# .env across re-installs: the project directory is replaced wholesale below,
# and an existing .env must never be silently clobbered (C-418 Feature F).
log "step 5/6 — extracting the bundle"
PROJECT_DIR="${INSTALL_DIR}/current"
ENV_FILE="${PROJECT_DIR}/.env"
PRESERVED_ENV=0
if [ -f "${ENV_FILE}" ]; then
  cp "${ENV_FILE}" "${INSTALL_DIR}/.env.preserved"
  PRESERVED_ENV=1
fi

STAGING="${INSTALL_DIR}/.staging"
rm -rf "${STAGING}"
mkdir -p "${STAGING}"
tar -xzf "${TMP_BUNDLE}" -C "${STAGING}" \
  || die "bundle extraction failed — the archive may be corrupt."
rm -f "${TMP_BUNDLE}" "${TMP_SUMS}"

# The bundle tarball carries one versioned top-level directory
# (local-stack-<version>-<platform>/).
EXTRACTED="$(find "${STAGING}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[ -n "${EXTRACTED}" ] || die "bundle archive is empty or malformed."
rm -rf "${PROJECT_DIR}"
mv "${EXTRACTED}" "${PROJECT_DIR}"
rm -rf "${STAGING}"
printf '%s' "${VERSION}" > "${PROJECT_DIR}/VERSION"

if [ "${PRESERVED_ENV}" = "1" ]; then
  cp "${INSTALL_DIR}/.env.preserved" "${ENV_FILE}"
  rm -f "${INSTALL_DIR}/.env.preserved"
  info "preserved existing .env from the previous install"
fi

# `aikami` control command: lives in the install root (not the replaceable
# project dir) so upgrades keep the same command on PATH.
if [ -f "${PROJECT_DIR}/aikami" ]; then
  cp "${PROJECT_DIR}/aikami" "${INSTALL_DIR}/aikami"
  chmod +x "${INSTALL_DIR}/aikami"
  if [ "${NO_PATH}" != "1" ]; then
    mkdir -p "${HOME}/.local/bin"
    ln -sf "${INSTALL_DIR}/aikami" "${HOME}/.local/bin/aikami"
    case ":${PATH}:" in
      *":${HOME}/.local/bin:"*) info "\`aikami\` is on your PATH" ;;
      *) info "add ~/.local/bin to your PATH to use \`aikami\` (or run ${INSTALL_DIR}/aikami)" ;;
    esac
  fi
fi

STACK_INIT="${PROJECT_DIR}/bin/stack-init"
if [ "${SKIP_WIZARD}" != "1" ] && [ ! -x "${STACK_INIT}" ]; then
  die "compiled stack-init binary missing in the bundle (${STACK_INIT})."
fi

# ── Hardware wizard (host-side) ──────────────────────────────────────────
log "step 6/6 — running the hardware wizard"
if [ "${SKIP_WIZARD}" = "1" ]; then
  info "skipped (AIKAMI_SKIP_WIZARD=1)"
elif [ -f "${ENV_FILE}" ]; then
  # Never silently overwrite a hand-edited .env (C-418 Feature F).
  info ".env already exists at ${ENV_FILE} — leaving it untouched."
  info "Re-run the wizard to change hardware:  aikami wizard"
else
  if [ "${INTERACTIVE}" = "1" ]; then
    # Interactive terminal — full hardware-detection wizard.
    "${STACK_INIT}" --env-path "${ENV_FILE}"
  else
    # Piped install (curl | sh) — non-interactive auto-detect.
    info "non-interactive install — auto-detecting hardware (--yes)"
    "${STACK_INIT}" --yes --env-path "${ENV_FILE}"
  fi
  # Verify that the wizard actually wrote .env — when the user cancels
  # (Ctrl-C or declines prompts), stack-init exits 0 but creates no file.
  if [ ! -f "${ENV_FILE}" ]; then
    printf '\n'
    info "Setup cancelled — no .env was created."
    info "Re-run the installer when you're ready to complete the setup."
    exit 0
  fi
  info ".env written to ${ENV_FILE}"
fi

# ── Optional: start the stack ────────────────────────────────────────────
# Only ever offered interactively: a piped `curl | sh` must not start pulling
# multi-GB images and model weights that nobody asked for. Scripts opt in with
# AIKAMI_START=1 / AIKAMI_CLIENT=1.
if [ "${WANT_START}" != "1" ] && [ "${INTERACTIVE}" = "1" ] \
  && confirm "Start the stack now? (pulls images and downloads models)" y; then
  WANT_START=1
fi
if [ "${WANT_START}" = "1" ]; then
  log "starting the stack (docker compose up -d)"
  if ( cd "${PROJECT_DIR}" && docker compose up -d ); then
    log "stack started. Follow the first-run model download with:  aikami logs"
  else
    warn "docker compose failed — check the output above, then retry with 'aikami up'."
  fi
fi

# ── Optional: desktop app ────────────────────────────────────────────────
if [ "${WANT_CLIENT}" != "1" ] && [ "${INTERACTIVE}" = "1" ] \
  && confirm "Install the Aikami desktop app (latest GitHub release)?" y; then
  WANT_CLIENT=1
fi
if [ "${WANT_CLIENT}" = "1" ] && [ -x "${INSTALL_DIR}/aikami" ]; then
  "${INSTALL_DIR}/aikami" client || warn "desktop app install skipped — run 'aikami client' to retry."
fi

# ── Handoff ──────────────────────────────────────────────────────────────
printf '\n'
log "done"
printf '\n'
printf '  \033[1;36maikami up\033[0m        start the stack\n'
printf '  \033[1;36maikami status\033[0m    per-service health\n'
printf '  \033[1;36maikami logs\033[0m      follow the logs (first run downloads models)\n'
printf '  \033[1;36maikami client\033[0m    install / launch the desktop app\n'
printf '  \033[1;36maikami doctor\033[0m    diagnose Docker, ports, and engine health\n'
printf '  \033[1;36maikami down\033[0m      stop the stack\n'
printf '\n'
info "installed at ${PROJECT_DIR}"
info "Change modalities or hardware by editing ${ENV_FILE} (or: aikami wizard)."
info "Contributors: clone the repo for source builds — see the README."
