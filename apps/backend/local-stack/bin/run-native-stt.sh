#!/usr/bin/env bash
# apps/backend/local-stack/bin/run-native-stt.sh
# Native host launcher for local speech-to-text (STT) without Docker.
#
# Runs the sherpa-onnx C++ offline websocket STT server with a Moonshine
# int8-quantized ONNX model. whisper.cpp users can swap the binary below for
# `whisper-server` (whisper.cpp example server) — the websocket protocol the
# client speaks is what matters.
set -euo pipefail

MODEL_DIR="$(pwd)/models/stt"
MODEL_NAME="sherpa-onnx-moonshine-tiny-en-int8"
MODEL_PATH="$MODEL_DIR/$MODEL_NAME"
# Port from packages/shared/constants development_ports.ts (C-390 AC-11).
PORT="${STT_PORT:-8087}"

# Verify the sherpa-onnx binary is installed on the host BEFORE downloading
# any model — don't pull gigabytes of weights for a server that can't run.
if ! command -v sherpa-onnx-offline-websocket-server >/dev/null 2>&1; then
    echo "❌ sherpa-onnx is not installed on the host."
    echo "   Install it with:  pip install sherpa-onnx"
    echo "   or download the prebuilt C++ binaries from the k2-fsa GitHub releases."
    exit 1
fi

if [ ! -d "$MODEL_PATH" ]; then
    echo "Moonshine STT model missing in $MODEL_DIR. Downloading..."
    mkdir -p "$MODEL_DIR"
    curl -fSL -o "$MODEL_DIR/moonshine.tar.bz2" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2"
    tar xjf "$MODEL_DIR/moonshine.tar.bz2" -C "$MODEL_DIR"
    rm -f "$MODEL_DIR/moonshine.tar.bz2"
fi

echo "Starting native sherpa-onnx WebSocket STT server on port $PORT..."
exec sherpa-onnx-offline-websocket-server \
    --port="$PORT" \
    --moonshine-preprocessor="$MODEL_PATH/preprocess.onnx" \
    --moonshine-encoder="$MODEL_PATH/encode.int8.onnx" \
    --moonshine-uncached-decoder="$MODEL_PATH/uncached_decode.int8.onnx" \
    --moonshine-cached-decoder="$MODEL_PATH/cached_decode.int8.onnx" \
    --tokens="$MODEL_PATH/tokens.txt"
