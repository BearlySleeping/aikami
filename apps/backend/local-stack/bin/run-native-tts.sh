#!/usr/bin/env bash
# apps/backend/local-stack/bin/run-native-tts.sh
# Native host launcher for local text-to-speech (TTS) without Docker.
#
# Runs the sherpa-onnx Kokoro TTS behind an OpenAI-compatible
# /v1/audio/speech HTTP endpoint (the API the Aikami client calls).
set -euo pipefail

MODEL_DIR="$(pwd)/models/tts"
KOKORO_DIR="${MODEL_DIR}/kokoro-multi-lang-v1_0"
KOKORO_TARBALL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2"
# Port from packages/shared/constants development_ports.ts (C-390 AC-11).
PORT="${TTS_PORT:-8089}"
# tts_server.py lives in the sibling docker/voice tree
TTS_SERVER="$(cd "$(dirname "$0")/.." && pwd)/docker/voice/tts_server.py"

# Verify Python + sherpa-onnx are available BEFORE downloading any model.
if ! command -v python3 >/dev/null 2>&1; then
    echo "❌ python3 is not installed on the host."
    exit 1
fi
if ! python3 -c "import sherpa_onnx" >/dev/null 2>&1; then
    echo "❌ sherpa-onnx is not installed in the active Python environment."
    echo "   Install it with:  pip install sherpa-onnx"
    exit 1
fi

# Only skip the download when the complete model directory exists (model.onnx,
# voices.bin, tokens.txt, espeak-ng-data). Fetch to a temp location and move
# atomically so interrupted downloads never leave a partial model dir.
if [ ! -d "$KOKORO_DIR" ]; then
    echo "Kokoro TTS model missing in $MODEL_DIR. Downloading..."
    mkdir -p "$MODEL_DIR"
    curl -fSL --retry 3 -o "$MODEL_DIR/kokoro.tar.bz2" "$KOKORO_TARBALL_URL"
    rm -rf "$MODEL_DIR/.kokoro-tmp"
    mkdir -p "$MODEL_DIR/.kokoro-tmp"
    tar xjf "$MODEL_DIR/kokoro.tar.bz2" -C "$MODEL_DIR/.kokoro-tmp"
    mv "$MODEL_DIR/.kokoro-tmp"/kokoro-multi-lang-v1_0 "$KOKORO_DIR"
    rm -rf "$MODEL_DIR/.kokoro-tmp" "$MODEL_DIR/kokoro.tar.bz2"
fi

echo "Starting native sherpa-onnx Kokoro TTS server on port $PORT..."
exec python3 "$TTS_SERVER" "$PORT"
