#!/bin/sh
# apps/backend/local-stack/scripts/install.test.sh
#
# Self-test for the POSIX one-command installer (C-418 Feature F AC-6
# integration hook). Exercises the installer against a LOCAL bundle served
# over HTTP — no network, no real hardware wizard (a fake `stack-init` writes
# the .env). When Docker is available it ALSO proves the wizard-written .env is
# actually read by `docker compose config` in the compose project dir (H2).
# Run via:  bun moon run local-stack:test-install
#
# The Windows twin is scripts/install.test.ps1.
#
# Asserts:
#   1. install.sh + bundle_stack.sh are valid POSIX sh (sh -n).
#   2. Platform detection runs and accepts the host platform.
#   3. The installer downloads + checksum-verifies + extracts + runs wizard;
#      the wizard .env lands in the compose project dir (<dir>/current/.env).
#   4. The `aikami` control command is installed and resolves the project dir.
#   5. An existing .env is never overwritten.
#   6. AIKAMI_SKIP_WIZARD=1 skips the wizard (fetch-only).
#   7. A tampered tarball (checksum mismatch) is rejected before extraction.
#   8. The bundle script produces per-platform archives + SHA256SUMS.
#   9. (docker available) docker compose config in the project dir honors the
#      wizard-written COMPOSE_PROFILES.

set -eu
cd "$(dirname "$0")/.."

log() { printf '\033[1;34m[install.test]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[install.test] FAIL:\033[0m %s\n' "$*" >&2; exit 1; }
skip() { printf '\033[1;33m[install.test] SKIP:\033[0m %s\n' "$*"; }

# 1. Syntax check (POSIX sh; fall back to sh when dash is absent)
log "syntax check (sh -n)"
SYNTAX_CHECKER="${POSIX_SH:-sh}"
$SYNTAX_CHECKER -n install.sh || fail "install.sh is not valid POSIX sh"
$SYNTAX_CHECKER -n scripts/bundle_stack.sh || fail "bundle_stack.sh is not valid POSIX sh"
$SYNTAX_CHECKER -n aikami || fail "aikami control script is not valid POSIX sh"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    skip "Windows host — install.sh is the POSIX installer; run scripts/install.test.ps1 instead"
    exit 0
    ;;
esac

# 2. The asset name is platform-scoped (one binary per archive), so the fake
#    bundle has to carry the same platform suffix install.sh will request.
case "$(uname -s)" in
  Linux) TEST_OS=linux ;;
  Darwin) TEST_OS=darwin ;;
  *) fail "unsupported test host $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) TEST_ARCH=x64 ;;
  aarch64|arm64) TEST_ARCH=arm64 ;;
  *) fail "unsupported test arch $(uname -m)" ;;
esac
PLATFORM="${TEST_OS}-${TEST_ARCH}"
ASSET="local-stack-test-${PLATFORM}.tar.gz"
log "host platform: ${PLATFORM} (asset ${ASSET})"

# 3. Build a fake bundle (real-enough compose files for the docker check)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BUNDLE_DIR="$TMP/bundle/local-stack-test-${PLATFORM}"
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
cat > "$BUNDLE_DIR/compose.yaml" <<'EOF'
services:
  text-engine:
    image: busybox
    profiles: ["text"]
EOF
: > "$BUNDLE_DIR/compose.cpu.yaml"
cp aikami "$BUNDLE_DIR/aikami"
chmod +x "$BUNDLE_DIR/aikami"

# 4. Create the tarball + SHA256SUMS + serve over HTTP (path mirrors the
#    GitHub releases scheme: /download/<tag>/<asset>)
tar -czf "$TMP/${ASSET}" -C "$TMP/bundle" "local-stack-test-${PLATFORM}"
mkdir -p "$TMP/local-stack-test"
cp "$TMP/${ASSET}" "$TMP/local-stack-test/${ASSET}"
(
  cd "$TMP/local-stack-test"
  sha256sum "${ASSET}" > SHA256SUMS
)
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
# Never prompt, never auto-start, never touch the tester's PATH.
export AIKAMI_YES=1
export AIKAMI_NO_PATH=1

# 5. First install — wizard runs, .env written INTO the compose project dir
log "first install (wizard → .env in project dir)"
INSTALL_OUT="$(sh install.sh 2>&1)" || fail "installer exited non-zero on first run"
echo "$INSTALL_OUT" | grep -q "checksum OK" || fail "installer did not verify the checksum"
echo "$INSTALL_OUT" | grep -q "step 6/6" || fail "installer did not complete all steps"
PROJECT_DIR="$INSTALL_DIR/current"
[ -f "$PROJECT_DIR/.env" ] || fail "wizard .env was not written into the compose project dir ($PROJECT_DIR/.env)"
grep -q "COMPOSE_PROFILES=text,image,voice" "$PROJECT_DIR/.env" || fail ".env content wrong"
[ -f "$PROJECT_DIR/VERSION" ] || fail "VERSION marker missing from the project dir"

# 6. The `aikami` control command is installed at the stable install root and
#    resolves the project dir through the `current` indirection.
log "aikami control command"
[ -x "$INSTALL_DIR/aikami" ] || fail "aikami control command was not installed at $INSTALL_DIR/aikami"
RESOLVED_DIR="$("$INSTALL_DIR/aikami" dir)" || fail "aikami dir failed"
[ "$RESOLVED_DIR" = "$PROJECT_DIR" ] || fail "aikami dir resolved '$RESOLVED_DIR', expected '$PROJECT_DIR'"
"$INSTALL_DIR/aikami" version | grep -q "test" || fail "aikami version did not report the installed version"

# 7. docker compose actually reads the wizard-written .env (H2)
log "compose reads wizard .env"
if command -v docker >/dev/null 2>&1; then
  ( cd "$PROJECT_DIR" && docker compose config ) 2>&1 \
    | grep -q "text-engine" || fail "docker compose config did not honor COMPOSE_PROFILES from the wizard .env"
  log "  docker compose config honored COMPOSE_PROFILES=text from $PROJECT_DIR/.env"
else
  skip "docker not installed — compose-reads-.env check skipped (CI runs it)"
fi

# 8. Second install — .env must NOT be overwritten
log "second install (.env protection)"
printf 'COMPOSE_PROFILES=my-custom-value\n' > "$PROJECT_DIR/.env"
sh install.sh >/dev/null 2>&1 || fail "installer exited non-zero on second run"
grep -q "COMPOSE_PROFILES=my-custom-value" "$PROJECT_DIR/.env" \
  || fail "existing .env was overwritten"

# 9. Skip-wizard mode
log "skip-wizard mode"
rm -rf "$TMP/install-root2"
export AIKAMI_STACK_DIR="$TMP/install-root2"
export AIKAMI_SKIP_WIZARD=1
sh install.sh >/dev/null 2>&1 || fail "installer exited non-zero with AIKAMI_SKIP_WIZARD=1"
[ ! -f "$TMP/install-root2/current/.env" ] \
  || fail ".env should not be written in skip-wizard mode"
unset AIKAMI_SKIP_WIZARD

# 10. Tampered tarball must be rejected before extraction (M2)
log "checksum rejection (tampered tarball)"
rm -rf "$TMP/install-root3"
export AIKAMI_STACK_DIR="$TMP/install-root3"
printf 'COMPOSE_PROFILES=text,image,voice\n' > "$TMP/local-stack-test/${ASSET}"
if sh install.sh >/dev/null 2>&1; then
  fail "installer accepted a tampered tarball (checksum mismatch must abort)"
fi
[ ! -d "$TMP/install-root3/current" ] || fail "tampered tarball was extracted before checksum verification"
log "  tampered tarball rejected, nothing extracted"
# restore the good tarball for the bundle-layout step
tar -czf "$TMP/${ASSET}" -C "$TMP/bundle" "local-stack-test-${PLATFORM}"
cp "$TMP/${ASSET}" "$TMP/local-stack-test/${ASSET}"
(
  cd "$TMP/local-stack-test"
  sha256sum "${ASSET}" > SHA256SUMS
)
unset AIKAMI_STACK_DIR

# 11. Bundle script layout + SHA256SUMS (M2/H3 naming)
log "bundle script layout"
AIKAMI_BUNDLE_DIR="$TMP/dist" AIKAMI_STACK_VERSION="test" sh scripts/bundle_stack.sh >/dev/null 2>&1 \
  || fail "bundle_stack.sh failed"
BUNDLED_ASSET="$TMP/dist/local-stack-test-${PLATFORM}.tar.gz"
[ -f "$BUNDLED_ASSET" ] || fail "bundle tarball missing ($BUNDLED_ASSET)"
[ -f "$TMP/dist/SHA256SUMS" ] || fail "SHA256SUMS missing"
grep -q "local-stack-test-${PLATFORM}.tar.gz" "$TMP/dist/SHA256SUMS" \
  || fail "SHA256SUMS does not reference the tarball"
for entry in bin/stack-init compose.yaml install.sh aikami VERSION; do
  tar -tzf "$BUNDLED_ASSET" | grep -q "local-stack-test-${PLATFORM}/${entry}" \
    || fail "bundle tarball missing ${entry}"
done

log "all installer checks passed"
