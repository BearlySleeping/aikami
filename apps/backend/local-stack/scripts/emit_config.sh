#!/usr/bin/env bash
# apps/backend/local-stack/scripts/emit_config.sh
#
# Emits the runtime engine config.json for the staged client build (C-389).
# Replaces the old build-time PUBLIC_* endpoint baking: the SPA bundle is now
# topology-agnostic, and each deployment path writes the config file it needs.
#
# Defaults follow the C-390 allocation table (development_ports.ts):
# text 11434, image 8188, voice 8089, stt 8087. Override with
# LLM_ENDPOINT / IMAGE_ENDPOINT / VOICE_ENDPOINT / STT_ENDPOINT.
set -euo pipefail

LLM="${LLM_ENDPOINT:-http://localhost:11434/v1}"
IMAGE="${IMAGE_ENDPOINT:-http://localhost:8188}"
VOICE="${VOICE_ENDPOINT:-http://localhost:8089}"
STT="${STT_ENDPOINT:-http://localhost:8087}"

if [ -n "$VOICE" ]; then
    VOICE_MODE="server"
    VOICE_URL="\"${VOICE}\""
else
    VOICE_MODE="browser"
    VOICE_URL="null"
fi

if [ -n "$STT" ]; then
    STT_URL="\"${STT}\""
else
    STT_URL="null"
fi

cat <<EOF
{
  "text": { "url": "${LLM}", "model": "qwen3-4b-instruct" },
  "image": { "url": "${IMAGE}", "engine": "auto" },
  "voice": {
    "tts": { "mode": "${VOICE_MODE}", "url": ${VOICE_URL} },
    "stt": { "url": ${STT_URL} }
  },
  "models": { "originUrl": "https://huggingface.co" }
}
EOF
