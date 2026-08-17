#!/bin/sh
# apps/backend/local-stack/scripts/bundle_stack.sh
#
# C-418 Feature F: builds the release bundle for the one-command installer.
#
#   bundle layout (local-stack-<version>):
#     compose*.yaml  .env.example  bin/stack-init  install.sh
#
#   artifact: dist/local-stack-<version>.tar.gz
#
# `stack-init` is the hardware-detection wizard (stack/init.ts) compiled to a
# single-file Bun binary so the installer can run it on the HOST without a
# repo checkout, Node, or Bun installed. GPU detection never runs inside a
# container (no NVIDIA toolkit — C-418 Feature F).
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

log "compiling stack-init binary (bun build --compile)"
bun build --compile stack/init.ts --outfile "${BUNDLE_DIR}/bin/stack-init"

log "copying compose topology + env example + installer"
cp compose*.yaml .env.example "${BUNDLE_DIR}/"
cp install.sh "${BUNDLE_DIR}/"

log "creating ${DIST_DIR}/local-stack-${VERSION}.tar.gz"
tar -czf "${DIST_DIR}/local-stack-${VERSION}.tar.gz" -C "${DIST_DIR}/bundle" .

log "done: ${DIST_DIR}/local-stack-${VERSION}.tar.gz"
du -h "${DIST_DIR}/local-stack-${VERSION}.tar.gz" | awk '{print "  size: " $1}'
