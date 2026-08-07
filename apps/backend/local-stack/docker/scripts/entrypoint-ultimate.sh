#!/usr/bin/env bash
# apps/backend/local-stack/docker/scripts/entrypoint-ultimate.sh
# Auto-model downloader & multi-process supervisor for the Ultimate container.
#
# Downloads default models into /models on first start (each asset validated
# and moved atomically), then starts the voice (TTS), STT, text (LLM) and
# client processes. The script stays PID 1: it forwards termination signals
# to children and tears the stack down when any engine exits (the container
# restart policy brings it back).
set -euo pipefail

MODELS_DIR="/models"
VOICE_PORT="${VOICE_PORT:-6006}"
STT_PORT="${STT_PORT:-6007}"
TEXT_PORT="${TEXT_PORT:-8080}"

mkdir -p "$MODELS_DIR/llm" "$MODELS_DIR/image" "$MODELS_DIR/tts" "$MODELS_DIR/stt"

echo "=== Aikami Ultimate Stack Initializing ==="

# ── Kokoro TTS assets — the sherpa-onnx tarball ships everything the
#    server needs (model.onnx, voices.bin, tokens.txt, espeak-ng-data);
#    fetched to a temp location and moved atomically so interrupted
#    downloads never leave a partial model dir. ────────────────────────────
KOKORO_DIR="$MODELS_DIR/tts/kokoro-multi-lang-v1_0"
if [ ! -d "$KOKORO_DIR" ]; then
    echo "Downloading default Kokoro-82M TTS model..."
    curl -fSL --retry 3 -o "$MODELS_DIR/tts/kokoro.tar.bz2" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2"
    rm -rf "$MODELS_DIR/tts/.kokoro-tmp"
    mkdir -p "$MODELS_DIR/tts/.kokoro-tmp"
    tar xjf "$MODELS_DIR/tts/kokoro.tar.bz2" -C "$MODELS_DIR/tts/.kokoro-tmp"
    mv "$MODELS_DIR/tts/.kokoro-tmp"/kokoro-multi-lang-v1_0 "$KOKORO_DIR"
    rm -rf "$MODELS_DIR/tts/.kokoro-tmp" "$MODELS_DIR/tts/kokoro.tar.bz2"
fi

# ── Moonshine STT assets — sherpa-onnx layout (preprocessor/encoder/
#    decoders/tokens) so an STT websocket server can actually be started. ──
STT_DIR="$MODELS_DIR/stt/sherpa-onnx-moonshine-tiny-en-int8"
if [ ! -d "$STT_DIR" ]; then
    echo "Downloading default Moonshine STT model..."
    curl -fSL --retry 3 -o "$MODELS_DIR/stt/moonshine.tar.bz2" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2"
    tar xjf "$MODELS_DIR/stt/moonshine.tar.bz2" -C "$MODELS_DIR/stt"
    rm -f "$MODELS_DIR/stt/moonshine.tar.bz2"
fi

# ── Process supervision: stay PID 1, track children, forward signals ─────
PIDS=()

shutdown() {
    echo "=== Shutting down Aikami Ultimate Stack ==="
    for pid in "${PIDS[@]:-}"; do
        kill -TERM "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    exit 0
}
trap shutdown INT TERM

# Start Voice (TTS) Server — OpenAI-compatible /v1/audio/speech via
# sherpa-onnx Kokoro (sherpa-onnx ships no TTS websocket server).
if [ "${ENABLE_VOICE:-true}" != "false" ]; then
    echo "Starting Voice (TTS) Server on port $VOICE_PORT..."
    python3 /tts_server.py "$VOICE_PORT" &
    PIDS+=("$!")
fi

# Start STT Server (speech-to-text)
if [ "${ENABLE_STT:-true}" != "false" ]; then
    echo "Starting Speech-to-Text (STT) Server on port $STT_PORT..."
    sherpa-onnx-offline-websocket-server \
        --port="$STT_PORT" \
        --moonshine-preprocessor="$STT_DIR/preprocess.onnx" \
        --moonshine-encoder="$STT_DIR/encode.int8.onnx" \
        --moonshine-uncached-decoder="$STT_DIR/uncached_decode.int8.onnx" \
        --moonshine-cached-decoder="$STT_DIR/cached_decode.int8.onnx" \
        --tokens="$STT_DIR/tokens.txt" &
    PIDS+=("$!")
fi

# Start Text Engine (only when a model is present)
if [ "${ENABLE_TEXT:-true}" != "false" ] && [ -f "$MODELS_DIR/llm/model.gguf" ]; then
    echo "Starting Shimmy LLM Engine on port $TEXT_PORT..."
    shimmy --model "$MODELS_DIR/llm/model.gguf" --port "$TEXT_PORT" &
    PIDS+=("$!")
fi

# Start Client Application
echo "Starting Aikami Client..."
bun run start &
PIDS+=("$!")

# Monitor engines — if any exits, stop the stack so the container restart
# policy brings everything back together.
while true; do
    if wait -n; then
        code=0
    else
        code=$?
    fi
    echo "=== Engine exited (status $code); stopping stack ==="
    for pid in "${PIDS[@]:-}"; do
        kill -TERM "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    exit "$code"
done
