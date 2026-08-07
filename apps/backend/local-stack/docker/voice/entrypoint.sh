#!/usr/bin/env bash
# apps/backend/local-stack/docker/voice/entrypoint.sh
# Entrypoint for the sherpa-onnx voice container.
#
# Starts the Kokoro TTS OpenAI-compatible server (/v1/audio/speech) on
# $TTS_PORT (6006). If ENABLE_STT=true, additionally downloads a Moonshine
# STT model and starts an offline STT websocket server on $STT_PORT (6007).
#
# Models live under /models (bind-mounted from apps/backend/local-stack/models):
#   /models/tts/kokoro-multi-lang-v1_0  (TTS, auto-downloaded)
#   /models/stt/sherpa-onnx-moonshine-tiny-en-int8  (STT, auto-downloaded when enabled)
set -euo pipefail

MODELS_DIR="/models"
KOKORO_DIR="${KOKORO_DIR:-$MODELS_DIR/tts/kokoro-multi-lang-v1_0}"
KOKORO_TARBALL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2"
TTS_MODEL="${TTS_MODEL:-$KOKORO_DIR/model.onnx}"
TTS_VOICES="${TTS_VOICES:-$KOKORO_DIR/voices.bin}"
TTS_PORT="${TTS_PORT:-6006}"
STT_PORT="${STT_PORT:-6007}"
ENABLE_STT="${ENABLE_STT:-false}"

mkdir -p "$MODELS_DIR/tts" "$MODELS_DIR/stt"

# ── TTS: skip the download only when the complete model directory exists
#    (model.onnx + voices.bin + tokens.txt + espeak-ng-data); fetch to a
#    temp location and move atomically so interrupted downloads never leave
#    a partial model dir that later starts would trust. ──
if [ ! -d "$KOKORO_DIR" ]; then
    echo "[voice] Kokoro-82M TTS model missing — downloading into $MODELS_DIR/tts ..."
    curl -fSL --retry 3 -o "$MODELS_DIR/tts/kokoro.tar.bz2" "$KOKORO_TARBALL_URL"
    rm -rf "$MODELS_DIR/tts/.kokoro-tmp"
    mkdir -p "$MODELS_DIR/tts/.kokoro-tmp"
    tar xjf "$MODELS_DIR/tts/kokoro.tar.bz2" -C "$MODELS_DIR/tts/.kokoro-tmp"
    mv "$MODELS_DIR/tts/.kokoro-tmp"/kokoro-multi-lang-v1_0 "$KOKORO_DIR"
    rm -rf "$MODELS_DIR/tts/.kokoro-tmp" "$MODELS_DIR/tts/kokoro.tar.bz2"
fi

# ── TTS: OpenAI-compatible HTTP server (/v1/audio/speech) via sherpa-onnx ──
echo "[voice] Starting Kokoro TTS server on port $TTS_PORT ..."
python3 /tts_server.py "$TTS_PORT" &

# ── STT (optional): Moonshine offline websocket server ────────────────────
if [ "$ENABLE_STT" = "true" ]; then
    STT_DIR="$MODELS_DIR/stt/sherpa-onnx-moonshine-tiny-en-int8"
    if [ ! -d "$STT_DIR" ]; then
        echo "[voice] Moonshine STT model missing — downloading ..."
        curl -fSL -o /tmp/moonshine.tar.bz2 \
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2"
        tar xjf /tmp/moonshine.tar.bz2 -C "$MODELS_DIR/stt"
        rm -f /tmp/moonshine.tar.bz2
    fi

    echo "[voice] Starting Moonshine STT websocket server on port $STT_PORT ..."
    sherpa-onnx-offline-websocket-server \
        --port="$STT_PORT" \
        --moonshine-preprocessor="$STT_DIR/preprocess.onnx" \
        --moonshine-encoder="$STT_DIR/encode.int8.onnx" \
        --moonshine-uncached-decoder="$STT_DIR/uncached_decode.int8.onnx" \
        --moonshine-cached-decoder="$STT_DIR/cached_decode.int8.onnx" \
        --tokens="$STT_DIR/tokens.txt" &
fi

# Keep the container alive and surface logs
wait
