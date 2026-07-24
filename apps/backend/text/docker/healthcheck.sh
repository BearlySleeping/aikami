#!/usr/bin/env bash
# apps/backend/text/docker/healthcheck.sh

set -euo pipefail

SHIMMY_PORT="${SHIMMY_PORT:-11435}"
BASE_URL="http://127.0.0.1:${SHIMMY_PORT}"

# Check /health endpoint
if HEALTH_RESPONSE=$(curl -fsS --max-time 5 "${BASE_URL}/health" 2>/dev/null); then
  echo "✓ Shimmy /health responded: ${HEALTH_RESPONSE}"
  exit 0
fi

# Fallback: check /v1/models endpoint
if MODELS_RESPONSE=$(curl -fsS --max-time 5 "${BASE_URL}/v1/models" 2>/dev/null); then
  if echo "${MODELS_RESPONSE}" | grep -q '"data"'; then
    echo "✓ Shimmy /v1/models responded"
    exit 0
  fi
fi

echo "✗ Shimmy is not reachable on port ${SHIMMY_PORT}"
exit 1
