#!/bin/sh
# apps/backend/local-stack/docker/client/generate_config.sh
#
# Generates the runtime engine config.json at container start (mirrors
# scripts/emit_config.sh) so the published aikami-client image is
# self-sufficient — no host build step, no bind mount, no repo checkout
# required. Runs automatically via nginx's /docker-entrypoint.d/ convention
# (any executable *.sh in that directory runs before nginx starts).
#
# Defaults follow the C-390 allocation table (development_ports.ts): text
# 11434, image 8188, voice 8089, stt 8087. Override LLM_ENDPOINT /
# IMAGE_ENDPOINT / VOICE_ENDPOINT / STT_ENDPOINT via compose `environment:`
# for a non-default topology. A config.json bind-mounted read-only over this
# path (AC-9: two config mounts against one image) wins — this script leaves
# it alone instead of failing on the read-only write.
set -eu

CONFIG_PATH="/usr/share/nginx/html/config.json"

if [ -f "$CONFIG_PATH" ] && [ ! -w "$CONFIG_PATH" ]; then
  echo "generate_config: config.json is pre-mounted read-only, leaving it as-is" >&2
  exit 0
fi

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

cat > "$CONFIG_PATH" <<EOF
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
