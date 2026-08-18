#!/bin/sh
# apps/backend/local-stack/scripts/bundle_stack.sh
#
# C-418 Feature F: builds the release bundles for the one-command installers.
#
#   per-platform bundle layout (local-stack-<version>-<platform>):
#     compose*.yaml  .env.example  VERSION  bin/stack-init[.exe]
#     POSIX platforms:  install.sh  aikami
#     Windows:          install.ps1 aikami.ps1  aikami.cmd
#
#   artifacts:
#     dist/local-stack-<version>-<platform>.tar.gz   (linux, darwin)
#     dist/local-stack-<version>-windows-x64.zip     (windows)
#     dist/SHA256SUMS                                (covers every asset)
#
# `stack-init` is the hardware-detection wizard (stack/init.ts) compiled to a
# single-file Bun binary so the installer can run it on the HOST without a
# repo checkout, Node, or Bun installed. GPU detection never runs inside a
# container (no NVIDIA toolkit — C-418 Feature F).
#
# Platform (M1): ONE PLATFORM PER ASSET. A compiled Bun binary is ~95 MB
# (~38 MB compressed); shipping all five in one tarball would make every user
# download ~190 MB to run one of them. Each platform therefore gets its own
# archive containing only the binary and the installer that platform can run,
# and install.sh / install.ps1 request their own asset by name.
#
# By default only the HOST platform is built (fast local/CI iteration). The
# publish workflow sets AIKAMI_BUNDLE_TARGETS to the full matrix:
#   AIKAMI_BUNDLE_TARGETS="bun-linux-x64 bun-linux-arm64 bun-darwin-x64 \
#                          bun-darwin-arm64 bun-windows-x64"
#
# Release naming (single source of truth — matches install.sh, install.ps1,
# and publish-local-stack.yml):
#   GitHub release tag:  local-stack-<version>
#   asset:               local-stack-<version>-<platform>.tar.gz|.zip
#   checksums:           SHA256SUMS
#
# Usage: scripts/bundle_stack.sh   (AIKAMI_STACK_VERSION overrides the tag)

set -eu
cd "$(dirname "$0")/.."

# jq is not installed everywhere (notably Git Bash on Windows) — fall back to
# a plain sed read of package.json rather than silently bundling "0.1.0".
read_version() {
  if command -v jq >/dev/null 2>&1; then
    jq -r .version package.json
  else
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n 1
  fi
}

VERSION="${AIKAMI_STACK_VERSION:-$(read_version)}"
[ -n "${VERSION}" ] || VERSION=0.1.0
DIST_DIR="${AIKAMI_BUNDLE_DIR:-dist}"

log() { printf '\033[1;34m[bundle]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[bundle] error:\033[0m %s\n' "$*" >&2; exit 1; }

# ── Which targets? ───────────────────────────────────────────────────────
host_target() {
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    MINGW*|MSYS*|CYGWIN*) os=windows ;;
    *) die "unsupported build host '$(uname -s)' — set AIKAMI_BUNDLE_TARGETS explicitly." ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "unsupported build arch '$(uname -m)' — set AIKAMI_BUNDLE_TARGETS explicitly." ;;
  esac
  printf 'bun-%s-%s' "${os}" "${arch}"
}

BUNDLE_TARGETS="${AIKAMI_BUNDLE_TARGETS:-$(host_target)}"

# ── Archive helpers ──────────────────────────────────────────────────────
# `zip` is absent on plenty of dev machines (Git Bash ships none), so fall
# back to Python's zipfile module and then to PowerShell. Each candidate is
# judged by whether the archive actually appeared, not by its exit status:
# Windows' `python3` is often the Microsoft Store alias stub, which prints an
# ad and exits 0 without creating anything.
make_zip() { # <dist_dir> <archive_name> <top_level_dir>
  zip_dist="$1"; zip_name="$2"; zip_top="$3"
  zip_out="${zip_dist}/${zip_name}"
  rm -f "${zip_out}"

  if command -v zip >/dev/null 2>&1; then
    ( cd "${zip_dist}/bundle" && zip -qr "../${zip_name}" "${zip_top}" ) || true
  fi
  for py in python3 python py; do
    [ -f "${zip_out}" ] && break
    command -v "${py}" >/dev/null 2>&1 || continue
    ( cd "${zip_dist}/bundle" && "${py}" -m zipfile -c "../${zip_name}" "${zip_top}" ) >/dev/null 2>&1 || true
  done
  if [ ! -f "${zip_out}" ] && command -v powershell >/dev/null 2>&1; then
    ( cd "${zip_dist}/bundle" && powershell -NoProfile -Command \
      "Compress-Archive -Path '${zip_top}' -DestinationPath '../${zip_name}' -Force" ) >/dev/null 2>&1 || true
  fi
  [ -f "${zip_out}" ] \
    || die "no working archiver for ${zip_name} — install zip or a real python3 (the Microsoft Store python alias does not count)."
}

sha256_of() { # file
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi
}

# ── Build ────────────────────────────────────────────────────────────────
log "bundling local-stack ${VERSION}"
log "targets: ${BUNDLE_TARGETS}"
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}/bundle"

for target in ${BUNDLE_TARGETS}; do
  platform="${target#bun-}"
  bundle_dir="${DIST_DIR}/bundle/local-stack-${VERSION}-${platform}"
  mkdir -p "${bundle_dir}/bin"

  case "${platform}" in
    windows-*) binary="${bundle_dir}/bin/stack-init.exe" ;;
    *) binary="${bundle_dir}/bin/stack-init" ;;
  esac

  log "compiling ${platform} wizard (bun build --compile --target ${target})"
  bun build --compile --target "${target}" stack/init.ts --outfile "${binary}" >/dev/null \
    || die "bun build failed for ${target}"
  # bun appends .exe for windows targets even when the outfile already has it;
  # normalise so the installer's expected path always exists.
  if [ ! -f "${binary}" ] && [ -f "${binary}.exe" ]; then
    mv "${binary}.exe" "${binary}"
  fi

  log "  copying compose topology + env example + installer"
  cp compose*.yaml .env.example "${bundle_dir}/"
  printf '%s' "${VERSION}" > "${bundle_dir}/VERSION"
  case "${platform}" in
    windows-*)
      cp install.ps1 aikami.ps1 aikami.cmd "${bundle_dir}/"
      archive="local-stack-${VERSION}-${platform}.zip"
      log "  creating ${DIST_DIR}/${archive}"
      make_zip "${DIST_DIR}" "${archive}" "local-stack-${VERSION}-${platform}"
      ;;
    *)
      cp install.sh aikami "${bundle_dir}/"
      chmod +x "${bundle_dir}/aikami" "${bundle_dir}/install.sh"
      archive="local-stack-${VERSION}-${platform}.tar.gz"
      log "  creating ${DIST_DIR}/${archive}"
      tar -czf "${DIST_DIR}/${archive}" -C "${DIST_DIR}/bundle" "local-stack-${VERSION}-${platform}"
      ;;
  esac
done

# M2: checksums so the installers can verify every archive before extraction.
log "writing ${DIST_DIR}/SHA256SUMS"
(
  cd "${DIST_DIR}"
  rm -f SHA256SUMS
  for asset in local-stack-*.tar.gz local-stack-*.zip; do
    [ -f "${asset}" ] || continue
    sha256_of "${asset}" >> SHA256SUMS
  done
)
[ -s "${DIST_DIR}/SHA256SUMS" ] || die "no assets were produced."

log "done"
ls -1 "${DIST_DIR}" | sed 's/^/  /'
cat "${DIST_DIR}/SHA256SUMS"
