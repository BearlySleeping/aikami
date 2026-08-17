#!/bin/sh
# apps/backend/local-stack/scripts/install.test.sh
#
# Self-test for the one-command installer (C-418 Feature F AC-6 integration
# hook). Exercises the installer against a LOCAL bundle served over HTTP —
# no Docker, no network, no real hardware wizard (a fake `stack-init` writes
# the .env). Run via:  bun moon run local-stack:test-install
#
# Asserts:
#   1. install.sh is valid POSIX sh (dash -n).
#   2. The installer downloads + extracts the bundle and runs the wizard.
#   3. An existing .env is never overwritten.
#   4. AIKAMI_SKIP_WIZARD=1 skips the wizard (fetch-only).
#   5. The bundle script produces a tarball with the expected layout.

set -eu
cd "$(dirname "$0")/.."

log() { printf '\033[1;34m[install.test]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[install.test] FAIL:\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Syntax check (POSIX sh; fall back to sh when dash is absent)
log "syntax check (sh -n)"
SYNTAX_CHECKER="${POSIX_SH:-sh}"
$SYNTAX_CHECKER -n install.sh || fail "install.sh is not valid POSIX sh"
$SYNTAX_CHECKER -n scripts/bundle_stack.sh || fail "bundle_stack.sh is not valid POSIX sh"

# 2. Build a fake bundle
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BUNDLE_DIR="$TMP/bundle/local-stack-test"
mkdir -p "$BUNDLE_DIR/bin"

cat > "$BUNDLE_DIR/bin/stack-init" <<'EOF'
#!/bin/sh
# Fake hardware wizard: writes .env the way the real one would.
env_path=
for arg in "$@"; do
  if [ "$prev" = "--env-path" ]; then
    env_path="$arg"
  fi
  prev="$arg"
done
[ -n "$env_path" ] || { echo "fake-stack-init: missing --env-path" >&2; exit 2; }
printf 'COMPOSE_PROFILES=text,image,voice\nCOMPOSE_FILE=compose.yaml:compose.cpu.yaml\n' > "$env_path"
echo "fake-stack-init: wrote $env_path"
EOF
chmod +x "$BUNDLE_DIR/bin/stack-init"
printf 'COMPOSE_PROFILES=text,image,voice\n' > "$BUNDLE_DIR/.env.example"
: > "$BUNDLE_DIR/compose.yaml"
: > "$BUNDLE_DIR/compose.cpu.yaml"

# 3. Create the tarball + serve it over HTTP (path mirrors GitHub releases
#    /download/<version>/<asset>)
tar -czf "$TMP/local-stack-test.tar.gz" -C "$TMP/bundle" .
mkdir -p "$TMP/test"
cp "$TMP/local-stack-test.tar.gz" "$TMP/test/local-stack-test.tar.gz"
PORT="$(shuf -i 20000-40000 -n 1)"
(cd "$TMP" && python3 -m http.server "$PORT" >/dev/null 2>&1) &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMP"' EXIT
sleep 1

BASE_URL="http://127.0.0.1:${PORT}"
INSTALL_DIR="$TMP/install-root"
export AIKAMI_INSTALL_BASE_URL="$BASE_URL"
export AIKAMI_STACK_VERSION="test"
export AIKAMI_STACK_DIR="$INSTALL_DIR"

# 4. First install — wizard runs, .env written
log "first install (wizard)"
INSTALL_OUT="$(sh install.sh 2>&1)" || fail "installer exited non-zero on first run"
echo "$INSTALL_OUT" | grep -q "step 5/5" || fail "installer did not complete all steps"
[ -f "$INSTALL_DIR/.env" ] || fail ".env was not written by the wizard"
grep -q "COMPOSE_PROFILES=text,image,voice" "$INSTALL_DIR/.env" || fail ".env content wrong"

# 5. Second install — .env must NOT be overwritten
log "second install (.env protection)"
SECOND_ENV="$INSTALL_DIR/.env"
printf 'COMPOSE_PROFILES=my-custom-value\n' > "$SECOND_ENV"
sh install.sh >/dev/null 2>&1 || fail "installer exited non-zero on second run"
grep -q "COMPOSE_PROFILES=my-custom-value" "$INSTALL_DIR/.env" \
  || fail "existing .env was overwritten"

# 6. Skip-wizard mode
log "skip-wizard mode"
rm -rf "$TMP/install-root2"
export AIKAMI_STACK_DIR="$TMP/install-root2"
export AIKAMI_SKIP_WIZARD=1
sh install.sh >/dev/null 2>&1 || fail "installer exited non-zero with AIKAMI_SKIP_WIZARD=1"
[ ! -f "$TMP/install-root2/.env" ] || fail ".env should not be written in skip-wizard mode"
unset AIKAMI_SKIP_WIZARD

# 7. Bundle script layout
log "bundle script layout"
AIKAMI_BUNDLE_DIR="$TMP/dist" AIKAMI_STACK_VERSION="test" sh scripts/bundle_stack.sh >/dev/null 2>&1 \
  || fail "bundle_stack.sh failed"
[ -f "$TMP/dist/local-stack-test.tar.gz" ] || fail "bundle tarball missing"
tar -tzf "$TMP/dist/local-stack-test.tar.gz" | grep -q "local-stack-test/bin/stack-init" \
  || fail "bundle tarball missing bin/stack-init"
tar -tzf "$TMP/dist/local-stack-test.tar.gz" | grep -q "local-stack-test/compose.yaml" \
  || fail "bundle tarball missing compose.yaml"

log "all installer checks passed"
