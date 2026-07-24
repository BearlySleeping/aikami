#!/usr/bin/env bash
# apps/backend/text/docker/start-server.sh
# Universal startup script for Shimmy text microservice.

set -euo pipefail

: "${SHIMMY_HOST:=0.0.0.0}"
: "${SHIMMY_PORT:=11435}"
: "${SHIMMY_BASE_GGUF:=/models}"
: "${SHIMMY_KV_QUANT:=int4}"   # Default to TurboShimmy for 60%+ VRAM savings

echo "========================================="
echo "   Aikami Text Service — Shimmy Engine   "
echo "========================================="
echo "Host:       ${SHIMMY_HOST}"
echo "Port:       ${SHIMMY_PORT}"
echo "Models dir: ${SHIMMY_BASE_GGUF}"

# ── 1. Hardware & GPU Detection ──────────────────────────────
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
export WGPU_POWER_PREF="${WGPU_POWER_PREF:-high-performance}"

if command -v lspci &>/dev/null && lspci | grep -i -q "nvidia"; then
  echo "✓ NVIDIA GPU detected in system. Setting PRIME offload flags..."
  export __NV_PRIME_RENDER_OFFLOAD=1
  export __GLX_VENDOR_LIBRARY_NAME=nvidia
fi

# ── 2. Scan GGUF Models ──────────────────────────────────────
echo ""
echo "--- Scanning for GGUF models ---"
MODEL_COUNT=0

if [[ -d "${SHIMMY_BASE_GGUF}" ]]; then
  while IFS= read -r -d '' GGUF_FILE; do
    MODEL_COUNT=$((MODEL_COUNT + 1))
    SIZE=$(du -h "${GGUF_FILE}" 2>/dev/null | cut -f1)
    echo "  ✓ Found: $(basename "${GGUF_FILE}") (${SIZE})"
  done < <(find "${SHIMMY_BASE_GGUF}" -maxdepth 2 -name '*.gguf' -print0 2>/dev/null || true)
elif [[ -f "${SHIMMY_BASE_GGUF}" ]]; then
  MODEL_COUNT=1
  SIZE=$(du -h "${SHIMMY_BASE_GGUF}" 2>/dev/null | cut -f1)
  echo "  ✓ Found model file: $(basename "${SHIMMY_BASE_GGUF}") (${SIZE})"
else
  echo "  ✗ Model path not found: ${SHIMMY_BASE_GGUF}"
fi

if [[ ${MODEL_COUNT} -eq 0 ]]; then
  echo "⚠ WARNING: No GGUF models found in ${SHIMMY_BASE_GGUF}."
  echo "  Ensure model files are mounted or downloaded."
fi

# ── 3. Build Shimmy CLI Arguments ────────────────────────────
CMD_ARGS=("--bind" "${SHIMMY_HOST}:${SHIMMY_PORT}")

if [[ -n "${SHIMMY_KV_QUANT:-}" ]]; then
  echo "TurboShimmy KV Quant: ${SHIMMY_KV_QUANT}"
  CMD_ARGS+=("--kv-quant" "${SHIMMY_KV_QUANT}")
fi

if [[ -n "${SHIMMY_MAX_CTX:-}" ]]; then
  echo "Max Context:          ${SHIMMY_MAX_CTX}"
  CMD_ARGS+=("--max-ctx" "${SHIMMY_MAX_CTX}")
fi

if [[ -n "${SHIMMY_PREFILL_CHUNK:-}" ]]; then
  echo "Prefill Chunk:        ${SHIMMY_PREFILL_CHUNK}"
  CMD_ARGS+=("--prefill-chunk" "${SHIMMY_PREFILL_CHUNK}")
fi

echo ""
echo "Starting Shimmy server..."
echo "========================================="

exec shimmy serve "${CMD_ARGS[@]}"
