# apps/backend/text/Dockerfile
# ============================================================
# Text Microservice — Shimmy LLM Engine
# Serves OpenAI-compatible API on port 11435.
# ============================================================

# ── Stage 1: Build binary from source ───────────────────────
FROM rust:1.88-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    build-essential \
    git \
    libclang-dev \
    cmake \
    && rm -rf /var/lib/apt/lists/*

ARG SHIMMY_VERSION=v2.3.0

WORKDIR /app
RUN git clone --depth 1 --branch ${SHIMMY_VERSION} \
    https://github.com/Michael-A-Kuykendall/shimmy.git .

# Build with HuggingFace features
RUN cargo build --release --features huggingface

# ── Stage 2: Universal Runtime Environment ──────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    curl \
    pciutils \
    libvulkan1 \
    vulkan-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/shimmy /usr/local/bin/shimmy

ENV SHIMMY_HOST=0.0.0.0
ENV SHIMMY_PORT=11435
ENV SHIMMY_BASE_GGUF=/models
ENV XDG_RUNTIME_DIR=/tmp
ENV WGPU_POWER_PREF=high-performance

EXPOSE 11435
VOLUME /models

COPY docker/ /app/docker/
RUN chmod +x /app/docker/*.sh

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD /app/docker/healthcheck.sh

ENTRYPOINT ["/app/docker/start-server.sh"]
