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

if [ "$fail" -ne 0 ]; then
    echo "❌ local-stack checks failed"
    exit 1
fi
echo "✅ local-stack checks passed"
