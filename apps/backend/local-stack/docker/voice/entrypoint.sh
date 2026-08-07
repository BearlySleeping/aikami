#!/usr/bin/env bash
# apps/backend/local-stack/docker/voice/entrypoint.sh
# Entrypoint for the sherpa-onnx voice container.
#
# Starts the Kokoro TTS offline websocket server on $TTS_PORT (6006).
# If ENABLE_STT=true, additionally downloads a Moonshine STT model and starts
# an offline STT websocket server on $STT_PORT (6007).
#
# Models live under /models (bind-mounted from apps/backend/local-stack/models):
#   /models/tts/kokoro-v1.0.onnx  + voices.bin   (TTS, auto-downloaded)
#   /models/stt/moonshine-tiny-en  (STT, auto-downloaded when enabled)
set -e

MODELS_DIR="/models"
TTS_MODEL="${TTS_MODEL:-$MODELS_DIR/tts/kokoro-v1.0.onnx}"
TTS_VOICES="${TTS_VOICES:-$MODELS_DIR/tts/voices.bin}"
TTS_PORT="${TTS_PORT:-6006}"
STT_PORT="${STT_PORT:-6007}"
ENABLE_STT="${ENABLE_STT:-false}"

mkdir -p "$MODELS_DIR/tts" "$MODELS_DIR/stt"

# ── TTS: auto-download default Kokoro model if missing ────────────────────
if [ ! -f "$TTS_MODEL" ]; then
    echo "[voice] Kokoro-82M ONNX model missing — downloading into $MODELS_DIR/tts ..."
    curl -fSL -o "$TTS_MODEL" "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v1.0.onnx"
    curl -fSL -o "$TTS_VOICES" "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/voices.bin"
fi

# Optional model assets — pass them when using the full sherpa-onnx Kokoro
# tarball layout (kokoro-multi-lang-v1_0: tokens.txt + espeak-ng-data).
TTS_ARGS=(--tts-model="$TTS_MODEL" --tts-voices="$TTS_VOICES" --port="$TTS_PORT")
if [ -f "$MODELS_DIR/tts/tokens.txt" ]; then
    TTS_ARGS+=(--tts-tokens="$MODELS_DIR/tts/tokens.txt")
fi
if [ -d "$MODELS_DIR/tts/espeak-ng-data" ]; then
    TTS_ARGS+=(--tts-data-dir="$MODELS_DIR/tts/espeak-ng-data")
fi

echo "[voice] Starting Kokoro TTS websocket server on port $TTS_PORT ..."
sherpa-onnx-offline-websocket-server "${TTS_ARGS[@]}" &

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
