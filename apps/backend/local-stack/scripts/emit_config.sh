#!/usr/bin/env bash
# apps/backend/local-stack/scripts/emit_config.sh
#
# Emits the runtime engine config.json for the staged client build (C-389).
# Replaces the old build-time PUBLIC_* endpoint baking: the SPA bundle is now
# topology-agnostic, and each deployment path writes the config file it needs.
#
# Values mirror the pre-contract defaults so there is no user-visible change
# on upgrade. Override with LLM_ENDPOINT / IMAGE_ENDPOINT / VOICE_ENDPOINT.
set -euo pipefail

LLM="${LLM_ENDPOINT:-http://localhost:8080/v1}"
IMAGE="${IMAGE_ENDPOINT:-http://localhost:8188}"
VOICE="${VOICE_ENDPOINT:-http://localhost:6006}"

if [ -n "$VOICE" ]; then
    VOICE_MODE="server"
    VOICE_URL="\"${VOICE}\""
else
    VOICE_MODE="browser"
    VOICE_URL="null"
fi

cat <<EOF
{
  "text": { "url": "${LLM}", "model": "qwen3-4b-instruct" },
  "image": { "url": "${IMAGE}", "engine": "auto" },
  "voice": {
    "tts": { "mode": "${VOICE_MODE}", "url": ${VOICE_URL} },
    "stt": { "url": null }
  },
  "models": { "originUrl": "https://huggingface.co" }
}
EOF
