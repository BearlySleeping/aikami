#!/bin/sh
# apps/backend/local-stack/scripts/bundle_stack.sh
#
# C-418 Feature F: builds the release bundle for the one-command installer.
#
#   bundle layout (local-stack-<version>):
#     compose*.yaml  .env.example  bin/stack-init  install.sh
#
#   artifacts:
#     dist/local-stack-<version>.tar.gz
#     dist/SHA256SUMS
#
# `stack-init` is the hardware-detection wizard (stack/init.ts) compiled to a
# single-file Bun binary so the installer can run it on the HOST without a
# repo checkout, Node, or Bun installed. GPU detection never runs inside a
# container (no NVIDIA toolkit — C-418 Feature F).
#
# Platform (M1): by default the binary is compiled for the host OS/arch
# (ubuntu-latest → linux-x64 ELF). Set AIKAMI_BUNDLE_TARGETS to a
# space-separated list of `bun build --target` values (bun-linux-x64,
# bun-linux-arm64, bun-darwin-x64, bun-darwin-arm64) to cross-compile a
# matrix; each target's binary is placed in bin/stack-init-<target> and the
# tarball ships them all. install.sh detects the platform and fails fast
# with a clear message for unsupported combos.
#
# Release naming (single source of truth — matches install.sh and
# publish-local-stack.yml):
#   GitHub release tag:  local-stack-<version>
#   asset:               local-stack-<version>.tar.gz
#   checksums:           SHA256SUMS
#
# Usage: scripts/bundle_stack.sh   (AIKAMI_STACK_VERSION overrides the tag)

set -eu
cd "$(dirname "$0")/.."

VERSION="${AIKAMI_STACK_VERSION:-$(jq -r .version package.json 2>/dev/null || echo 0.1.0)}"
DIST_DIR="${AIKAMI_BUNDLE_DIR:-dist}"
BUNDLE_DIR="${DIST_DIR}/bundle/local-stack-${VERSION}"

log() { printf '\033[1;34m[bundle]\033[0m %s\n' "$*"; }

log "bundling local-stack ${VERSION}"
rm -rf "${DIST_DIR}"
mkdir -p "${BUNDLE_DIR}/bin"

# Compile the wizard binary. Default: host platform. Cross-compile matrix
# via AIKAMI_BUNDLE_TARGETS (e.g. "bun-linux-x64 bun-linux-arm64").
BUNDLE_TARGETS="${AIKAMI_BUNDLE_TARGETS:-}"
if [ -z "${BUNDLE_TARGETS}" ]; then
  log "compiling stack-init binary (bun build --compile, host platform)"
  bun build --compile stack/init.ts --outfile "${BUNDLE_DIR}/bin/stack-init"
else
  log "compiling stack-init binary matrix: ${BUNDLE_TARGETS}"
  for target in ${BUNDLE_TARGETS}; do
    log "  ${target}"
    bun build --compile --target "${target}" stack/init.ts \
      --outfile "${BUNDLE_DIR}/bin/stack-init-${target#bun-}"
  done
fi

log "copying compose topology + env example + installer"
cp compose*.yaml .env.example "${BUNDLE_DIR}/"
cp install.sh "${BUNDLE_DIR}/"

log "creating ${DIST_DIR}/local-stack-${VERSION}.tar.gz"
tar -czf "${DIST_DIR}/local-stack-${VERSION}.tar.gz" -C "${DIST_DIR}/bundle" .

# M2: checksums so install.sh can verify the tarball before extraction.
log "writing ${DIST_DIR}/SHA256SUMS"
(
  cd "${DIST_DIR}"
  sha256sum "local-stack-${VERSION}.tar.gz" > SHA256SUMS
)

log "done: ${DIST_DIR}/local-stack-${VERSION}.tar.gz"
du -h "${DIST_DIR}/local-stack-${VERSION}.tar.gz" | awk '{print "  size: " $1}'
cat "${DIST_DIR}/SHA256SUMS"
