#!/usr/bin/env bash
# apps/backend/local-stack/docker/voice/entrypoint.sh
# Entrypoint for the sherpa-onnx voice container.
#
# Starts the Kokoro TTS OpenAI-compatible server (/v1/audio/speech) on
# $TTS_PORT (8089). If ENABLE_STT=true, additionally starts the C-393 STT
# service on $STT_PORT (8087):
#   - stt_server.py  — WS /v1/stream streaming (Moonshine + Silero VAD),
#     GET /v1/capabilities, GET /health, and the OpenAI-compatible batch
#     proxy POST /v1/audio/transcriptions
#   - whisper-server — whisper.cpp batch engine on the INTERNAL $WHISPER_PORT
#     (8091, never published) that the proxy forwards to
#
# Models live under /models (the shared aikami-models volume or the MODELS_PATH
# bind mount, populated by the model fetcher):
#   /models/tts/kokoro-multi-lang-v1_0                      (TTS)
#   /models/stt/<STT_STREAM_MODEL>  Moonshine streaming     (STT)
#   /models/stt/<STT_BATCH_MODEL>   whisper.cpp batch model (STT)
#   /models/stt/<STT_VAD_MODEL>     Silero VAD              (STT)
#
# STT models are fetched ONLY by the C-390 model fetcher (AC-11) — the
# auto-download branch below is TTS-only. A missing STT model is not fatal:
# stt_server.py reports unhealthy on /health naming the missing file (AC-10)
# and streaming sessions get error model-not-loaded.
set -euo pipefail

MODELS_DIR="/models"
KOKORO_DIR="${KOKORO_DIR:-$MODELS_DIR/tts/kokoro-multi-lang-v1_0}"
KOKORO_TARBALL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2"
TTS_MODEL="${TTS_MODEL:-$KOKORO_DIR/model.onnx}"
TTS_VOICES="${TTS_VOICES:-$KOKORO_DIR/voices.bin}"
TTS_PORT="${TTS_PORT:-8089}"
STT_PORT="${STT_PORT:-8087}"
WHISPER_PORT="${WHISPER_PORT:-8091}"
ENABLE_STT="${ENABLE_STT:-false}"

# C-393 engine/model selection — values are manifest targetPaths (relative
# to the models volume). STT_BATCH_MODEL is only used when STT_BATCH_ENGINE
# is whisper-cpp (the seam for a future licensed provider).
STT_STREAM_ENGINE="${STT_STREAM_ENGINE:-moonshine}"
STT_BATCH_ENGINE="${STT_BATCH_ENGINE:-whisper-cpp}"
STT_STREAM_MODEL="${STT_STREAM_MODEL:-stt/sherpa-onnx-moonshine-tiny-en-int8}"
STT_BATCH_MODEL="${STT_BATCH_MODEL:-stt/whisper-tiny/ggml-tiny.bin}"
STT_VAD_MODEL="${STT_VAD_MODEL:-stt/silero_vad.onnx}"

export STT_STREAM_ENGINE STT_BATCH_ENGINE STT_STREAM_MODEL STT_BATCH_MODEL STT_VAD_MODEL

# The fetcher pre-populates the shared volume with checksum-verified
# downloads (and, on the named-volume path, chowns it to the engine uid); the
# mkdirs below are defensive only — they must not hard-fail when a directory
# already exists but is unwritable (e.g. a MODELS_PATH bind owned by another
# uid), or the container would crash-loop.
mkdir -p "$MODELS_DIR/tts" 2>/dev/null || true
if [ "$ENABLE_STT" = "true" ]; then
    mkdir -p "$MODELS_DIR/stt" 2>/dev/null || true
fi

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

# ── STT (optional): C-393 streaming + batch servers ─────────────────────
if [ "$ENABLE_STT" = "true" ]; then
    echo "[voice] STT enabled: stream=$STT_STREAM_ENGINE ($STT_STREAM_MODEL), batch=$STT_BATCH_ENGINE ($STT_BATCH_MODEL)"

    # Batch engine: whisper.cpp whisper-server on the internal port. Not
    # published to the host; stt_server.py proxies /v1/audio/transcriptions
    # to it. Missing binary (native host without whisper.cpp) is tolerated —
    # capabilities report batch unavailable.
    if [ "$STT_BATCH_ENGINE" = "whisper-cpp" ] && command -v whisper-server >/dev/null 2>&1; then
        echo "[voice] Starting whisper.cpp batch server on 127.0.0.1:$WHISPER_PORT ..."
        # Print flags default off in whisper-server, so transcript text never
        # reaches any log (AC-8); the log file carries model-load lines only.
        whisper-server \
            --host 127.0.0.1 \
            --port "$WHISPER_PORT" \
            --model "/models/$STT_BATCH_MODEL" \
            --threads "${STT_WHISPER_THREADS:-4}" \
            --no-gpu \
            > /tmp/whisper-server.log 2>&1 &
    elif [ "$STT_BATCH_ENGINE" = "whisper-cpp" ]; then
        echo "[voice] whisper-server binary not found — batch endpoint will report unavailable"
    fi

    echo "[voice] Starting STT streaming server on port $STT_PORT ..."
    python3 /stt_server.py "$STT_PORT" &
fi

# Keep the container alive and surface logs
wait
