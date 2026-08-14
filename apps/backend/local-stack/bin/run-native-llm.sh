#!/usr/bin/env bash
# apps/backend/local-stack/bin/run-native-llm.sh
# Native host launcher for the local LLM (OpenAI-compatible) without Docker.
#
# Tries in order:
#   1. shimmy   — llama.cpp wrapper with an OpenAI-compatible API
#                (container-only distribution; see the compose stack instead)
#   2. llama-server — llama.cpp's native server (OpenAI-compatible /v1 API)
#
# First run downloads a default GGUF model (Qwen3 0.6B instruct) into
# models/llm/. Override with LLM_MODEL_URL / LLM_MODEL_FILE / LLM_PORT /
# LLM_HOST.
set -euo pipefail

MODEL_DIR="$(pwd)/models/llm"
# Port from packages/shared/constants development_ports.ts (C-390 AC-11).
PORT="${LLM_PORT:-11434}"
# Bind to loopback by default; set LLM_HOST=0.0.0.0 to expose on the network.
HOST="${LLM_HOST:-127.0.0.1}"

LLM_MODEL_URL="${LLM_MODEL_URL:-https://huggingface.co/Qwen/Qwen3-0.6B-Instruct-GGUF/resolve/main/qwen3-0.6b-instruct-q4_k_m.gguf}"
LLM_MODEL_FILE="${LLM_MODEL_FILE:-qwen3-0.6b-instruct-q4_k_m.gguf}"
MODEL_PATH="$MODEL_DIR/$LLM_MODEL_FILE"

# Validate that a server binary exists BEFORE downloading any model.
ENGINE=""
if command -v shimmy >/dev/null 2>&1; then
    ENGINE="shimmy"
elif command -v llama-server >/dev/null 2>&1; then
    ENGINE="llama-server"
else
    echo "❌ Neither 'shimmy' nor 'llama-server' is installed on the host."
    echo "   - llama.cpp: https://github.com/ggml-org/llama.cpp (build llama-server)"
    echo "   - shimmy (container): ghcr.io/michael-a-kuykendall/shimmy:latest"
    exit 1
fi

if [ ! -f "$MODEL_PATH" ]; then
    echo "LLM GGUF model missing in $MODEL_DIR. Downloading..."
    mkdir -p "$MODEL_DIR"
    # Download to a temp file and move atomically so interrupted downloads
    # never leave a truncated model that later starts would trust.
    curl -fSL -o "$MODEL_PATH.tmp" "$LLM_MODEL_URL"
    mv "$MODEL_PATH.tmp" "$MODEL_PATH"
fi

if [ "$ENGINE" = "shimmy" ]; then
    echo "Starting shimmy (OpenAI-compatible) on $HOST:$PORT..."
    exec shimmy serve --model "$MODEL_PATH" --port "$PORT" --host "$HOST"
fi

echo "Starting llama-server (OpenAI-compatible) on $HOST:$PORT..."
exec llama-server -m "$MODEL_PATH" --port "$PORT" --host "$HOST"
