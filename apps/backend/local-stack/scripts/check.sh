#!/usr/bin/env bash
# apps/backend/local-stack/scripts/check.sh
# Structural smoke tests for the local-stack package: bash syntax of every
# launcher/entrypoint, validity of every compose configuration, and presence
# of the artifacts the images depend on. Exits non-zero on any failure.
set -euo pipefail

cd "$(dirname "$0")/.."

fail=0
check() {
    local desc="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        echo "ok   - $desc"
    else
        echo "FAIL - $desc"
        fail=1
    fi
}

# Bash syntax of all shell scripts
check "bash syntax: bin/run-native-tts.sh" bash -n bin/run-native-tts.sh
check "bash syntax: bin/run-native-stt.sh" bash -n bin/run-native-stt.sh
check "bash syntax: bin/run-native-llm.sh" bash -n bin/run-native-llm.sh
check "bash syntax: docker/voice/entrypoint.sh" bash -n docker/voice/entrypoint.sh
check "bash syntax: docker/scripts/entrypoint-ultimate.sh" bash -n docker/scripts/entrypoint-ultimate.sh

# Launchers are executable
check "executable: bin/run-native-tts.sh" test -x bin/run-native-tts.sh
check "executable: bin/run-native-stt.sh" test -x bin/run-native-stt.sh
check "executable: bin/run-native-llm.sh" test -x bin/run-native-llm.sh

# Compose configurations parse (default + full profile + lite)
check "compose config: default" docker compose config --quiet
check "compose config: full profile" docker compose --profile full config --quiet
check "compose config: lite" docker compose -f docker-compose.lite.yml config --quiet

# Artifacts the images depend on exist
check "file: Dockerfile.client" test -f Dockerfile.client
check "file: Dockerfile.ultimate" test -f Dockerfile.ultimate
check "file: docker/voice/Dockerfile.sherpa" test -f docker/voice/Dockerfile.sherpa
check "file: docker/client/nginx.conf" test -f docker/client/nginx.conf
check "file: docker/client-server/client_server.ts" test -f docker/client-server/client_server.ts
check "file: docker/voice/tts_server.py" test -f docker/voice/tts_server.py
check "file: staged client build (.build/client/index.html)" test -f .build/client/index.html
check "file: staged runtime config (.build/client/config.json)" test -f .build/client/config.json
check "config.json parses" node -e "JSON.parse(require('fs').readFileSync('.build/client/config.json','utf8'))"

# ── C-389 AC-1: the staged SPA bundle must not embed engine URL literals ──
# The production build is topology-agnostic; engine URLs live only in the
# emitted config.json (which is NOT part of the bundle).
if grep -rE "localhost:(8080|8089|8188|11434|6006|8880)" .build/client \
    --include='*.js' --include='*.mjs' --include='*.html' --include='*.css' >/dev/null 2>&1; then
    echo "FAIL - no engine URL literals in staged build (C-389 AC-1)"
    fail=1
else
    echo "ok   - no engine URL literals in staged build (C-389 AC-1)"
fi

# ── C-389 AC-10: the staged build serves standalone with config swap ─────
# Serve the static dist with the Bun client-server, fetch index.html + the
# runtime config, swap config.json, and confirm the new config is served
# without any rebuild.
PORT=31873
CLIENT_ROOT="$(pwd)/.build/client"
CLIENT_PORT=$PORT CLIENT_ROOT="$CLIENT_ROOT" bun docker/client-server/client_server.ts >/tmp/aikami-serve.log 2>&1 &
SERVE_PID=$!
cleanup_serve() {
    kill "$SERVE_PID" 2>/dev/null || true
    wait "$SERVE_PID" 2>/dev/null || true
}
trap cleanup_serve EXIT
sleep 1
if curl -fsS "http://127.0.0.1:$PORT/" -o /dev/null; then
    echo "ok   - static serve: index.html loads (AC-10)"
else
    echo "FAIL - static serve: index.html loads (AC-10)"
    fail=1
fi
if curl -fsS "http://127.0.0.1:$PORT/config.json" | grep -q '"text"'; then
    echo "ok   - static serve: config.json served (AC-10)"
else
    echo "FAIL - static serve: config.json served (AC-10)"
    fail=1
fi
# Swap the config and confirm the new endpoint is served without a rebuild.
cat > .build/client/config.json <<'SWAP'
{
  "text": { "url": "http://10.99.99.99:9999/v1" },
  "image": { "url": "http://10.99.99.99:8188" },
  "voice": { "tts": { "mode": "browser", "url": null }, "stt": { "url": null } },
  "models": { "originUrl": "https://huggingface.co" }
}
SWAP
if curl -fsS "http://127.0.0.1:$PORT/config.json" | grep -q "10.99.99.99:9999"; then
    echo "ok   - static serve: config swap served without rebuild (AC-10)"
else
    echo "FAIL - static serve: config swap served without rebuild (AC-10)"
    fail=1
fi
# Restore the emitted config so later checks see the original.
./scripts/emit_config.sh > .build/client/config.json
cleanup_serve
trap - EXIT

if [ "$fail" -ne 0 ]; then
    echo "❌ local-stack checks failed"
    exit 1
fi
echo "✅ local-stack checks passed"
