#!/usr/bin/env bash
set -e

MODELS_DIR="/models"
mkdir -p "$MODELS_DIR/llm" "$MODELS_DIR/image" "$MODELS_DIR/tts" "$MODELS_DIR/stt"

echo "=== Aikami Ultimate Stack Initializing ==="

# Download default Kokoro TTS ONNX model if missing
if [ ! -f "$MODELS_DIR/tts/kokoro-v1.0.onnx" ]; then
    echo "Downloading default Kokoro-82M TTS model..."
    curl -L -o "$MODELS_DIR/tts/kokoro-v1.0.onnx" "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v1.0.onnx"
    curl -L -o "$MODELS_DIR/tts/voices.bin" "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/voices.bin"
fi

# Download default Moonshine STT ONNX model if missing
if [ ! -f "$MODELS_DIR/stt/moonshine-small.onnx" ]; then
    echo "Downloading default Moonshine STT model..."
    curl -L -o "$MODELS_DIR/stt/moonshine-small.onnx" "https://huggingface.co/UsefulSensors/moonshine-streaming-small/resolve/main/model.onnx"
fi

# Start Voice Server
if [ "$ENABLE_VOICE" != "false" ]; then
    echo "Starting Voice Server on port 6006..."
    sherpa-onnx-offline-websocket-server --tts-model="$MODELS_DIR/tts/kokoro-v1.0.onnx" --port=6006 &
fi

# Start Text Engine
if [ "$ENABLE_TEXT" != "false" ] && [ -f "$MODELS_DIR/llm/model.gguf" ]; then
    echo "Starting Shimmy LLM Engine on port 8080..."
    shimmy --model "$MODELS_DIR/llm/model.gguf" --port 8080 &
fi

# Start Client Application
echo "Starting Aikami Client..."
exec bun run start
