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
# models/llm/. Override with LLM_MODEL_URL / LLM_MODEL_FILE.
set -e

MODEL_DIR="$(pwd)/models/llm"
PORT="${LLM_PORT:-8080}"

LLM_MODEL_URL="${LLM_MODEL_URL:-https://huggingface.co/Qwen/Qwen3-0.6B-Instruct-GGUF/resolve/main/qwen3-0.6b-instruct-q4_k_m.gguf}"
LLM_MODEL_FILE="${LLM_MODEL_FILE:-qwen3-0.6b-instruct-q4_k_m.gguf}"
MODEL_PATH="$MODEL_DIR/$LLM_MODEL_FILE"

if [ ! -f "$MODEL_PATH" ]; then
    echo "LLM GGUF model missing in $MODEL_DIR. Downloading..."
    mkdir -p "$MODEL_DIR"
    curl -L -o "$MODEL_PATH" "$LLM_MODEL_URL"
fi

if command -v shimmy >/dev/null 2>&1; then
    echo "Starting shimmy (OpenAI-compatible) on port $PORT..."
    exec shimmy serve --model "$MODEL_PATH" --port "$PORT" --host 0.0.0.0
fi

if command -v llama-server >/dev/null 2>&1; then
    echo "Starting llama-server (OpenAI-compatible) on port $PORT..."
    exec llama-server -m "$MODEL_PATH" --port "$PORT" --host 0.0.0.0
fi

echo "❌ Neither 'shimmy' nor 'llama-server' is installed on the host."
echo "   - llama.cpp: https://github.com/ggml-org/llama.cpp (build llama-server)"
echo "   - shimmy (container): ghcr.io/michael-a-kuykendall/shimmy:latest"
exit 1
