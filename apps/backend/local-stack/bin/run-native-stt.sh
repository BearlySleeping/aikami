#!/usr/bin/env bash
# apps/backend/local-stack/bin/run-native-stt.sh
# Native host launcher for local speech-to-text (STT) without Docker — the
# macOS path (Docker Desktop has no Metal passthrough; this is a
# latency-sensitive service, C-393 AC-12).
#
# Starts the SAME service the container runs, on the same port and protocol:
#   - python3 docker/voice/stt_server.py on $STT_PORT (8087) — the C-393
#     streaming websocket (WS /v1/stream, Moonshine + Silero VAD), plus
#     GET /v1/capabilities, GET /health, and the OpenAI-compatible batch
#     proxy.
#   - whisper-server (whisper.cpp) on the internal WHISPER_PORT when the
#     binary is present — batch transcription (POST /v1/audio/transcriptions).
#
# Host requirements:
#   - python3 (any modern 3.x) with the sherpa-onnx wheel:
#       pip install sherpa-onnx
#     (and a C compiler + cmake if you build sherpa-onnx from source)
#   - whisper.cpp server for batch (optional but recommended):
#       brew install whisper-cpp        # provides whisper-cli
#       # whisper-server needs a source build with WHISPER_BUILD_SERVER=ON:
#       #   git clone https://github.com/ggml-org/whisper.cpp
#       #   cmake -B build -DWHISPER_BUILD_SERVER=ON && cmake --build build --target whisper-server
#       #   ln -s "$PWD/build/bin/whisper-server" /usr/local/bin/
#
# Models live in ./models/stt and are provisioned by the stack/model
# fetcher — this script never downloads them; it verifies the files exist
# and exits with a fetch hint when a model is missing. Model selection
# mirrors the container:
#   STT_STREAM_MODEL / STT_BATCH_MODEL / STT_VAD_MODEL (manifest targetPaths).
set -euo pipefail

# Ports from packages/shared/constants development_ports.ts (C-390 AC-11).
PORT="${STT_PORT:-8087}"
# Export so stt_server.py's batch proxy reads the SAME internal port the
# whisper-server was launched on (it defaults to 8091 on its own).
export WHISPER_PORT="${WHISPER_PORT:-8091}"
BIND="${STT_BIND_ADDRESS:-127.0.0.1}"

# C-393 model selection (manifest targetPaths, mirror the container defaults).
STT_STREAM_MODEL="${STT_STREAM_MODEL:-stt/sherpa-onnx-moonshine-tiny-en-int8}"
STT_BATCH_MODEL="${STT_BATCH_MODEL:-stt/whisper-tiny/ggml-tiny.bin}"
STT_VAD_MODEL="${STT_VAD_MODEL:-stt/silero_vad.onnx}"

MODELS_DIR="$(cd "$(dirname "$0")/.." && pwd)/models"
STREAM_DIR="$MODELS_DIR/$STT_STREAM_MODEL"
BATCH_FILE="$MODELS_DIR/$STT_BATCH_MODEL"
VAD_FILE="$MODELS_DIR/$STT_VAD_MODEL"

# Verify the streaming model files exist BEFORE fetching anything the server
# cannot run — the service must not claim readiness without its model.
if [ ! -d "$STREAM_DIR" ] || [ ! -f "$STREAM_DIR/encode.int8.onnx" ]; then
    echo "❌ Moonshine STT model missing in $MODELS_DIR/$STT_STREAM_MODEL."
    echo "   Run the model fetcher:  bun stack/fetch_models.ts --entry stt-moonshine-tiny-en-int8 --entry stt-whisper-tiny"
    echo "   (or download the tarball from the k2-fsa sherpa-onnx releases and"
    echo "   extract it to $STREAM_DIR)"
    exit 1
fi
if [ ! -f "$VAD_FILE" ]; then
    echo "❌ Silero VAD model missing at $VAD_FILE — fetch it with the model fetcher."
    exit 1
fi

# Export the model paths for stt_server.py (it resolves defaults itself, but
# the explicit exports keep this script the single source of truth).
export MODELS_DIR STT_STREAM_MODEL STT_BATCH_MODEL STT_VAD_MODEL STT_BIND_ADDRESS="$BIND"

# Batch engine (optional on the host): whisper-server must be installed
# separately; without it the service still streams and reports batch
# unavailable via /v1/capabilities.
if command -v whisper-server >/dev/null 2>&1; then
    if [ ! -f "$BATCH_FILE" ]; then
        echo "⚠ whisper batch model missing at $BATCH_FILE — batch will be unavailable"
        echo "  (fetch it with: bun stack/fetch_models.ts --entry stt-whisper-tiny)"
    else
        echo "Starting whisper.cpp batch server on 127.0.0.1:$WHISPER_PORT ..."
        WHISPER_LOG="$(mktemp "${TMPDIR:-/tmp}/whisper-server.XXXXXX.log")"
        whisper-server \
            --host 127.0.0.1 \
            --port "$WHISPER_PORT" \
            --model "$BATCH_FILE" \
            --threads "${STT_WHISPER_THREADS:-4}" \
            --no-gpu \
            > "$WHISPER_LOG" 2>&1 &
        WHISPER_PID=$!
    fi
else
    echo "⚠ whisper-server not found on the host — batch endpoint unavailable (streaming still works)"
fi

# Keep the background whisper-server alive while stt_server.py runs and
# clean it up (plus its unique temp log) when the script exits — an exec
# handoff would orphan the batch process once the STT server stopped.
cleanup() {
    if [ -n "${WHISPER_PID:-}" ]; then
        kill "$WHISPER_PID" 2>/dev/null || true
        wait "$WHISPER_PID" 2>/dev/null || true
    fi
    rm -f "${WHISPER_LOG:-}"
}
trap cleanup EXIT

echo "Starting native STT server on $BIND:$PORT ..."
python3 "$(dirname "$0")/../docker/voice/stt_server.py" "$PORT"
