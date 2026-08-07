#!/usr/bin/env bash
set -e

MODEL_DIR="$(pwd)/models/tts"
MODEL_PATH="${MODEL_DIR}/kokoro-v1.0.onnx"
VOICES_PATH="${MODEL_DIR}/voices.bin"

if [ ! -f "$MODEL_PATH" ]; then
    echo "Kokoro ONNX model missing in $MODEL_DIR. Downloading..."
    mkdir -p "$MODEL_DIR"
    curl -L -o "$MODEL_PATH" "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v1.0.onnx"
    curl -L -o "$VOICES_PATH" "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/voices.bin"
fi

echo "Starting native sherpa-onnx WebSocket TTS server on port 6006..."
exec sherpa-onnx-offline-websocket-server \
    --tts-model="$MODEL_PATH" \
    --tts-voices="$VOICES_PATH" \
    --port=6006
