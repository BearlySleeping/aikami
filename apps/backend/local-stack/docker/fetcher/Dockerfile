# apps/backend/local-stack/docker/fetcher/Dockerfile
# Model-fetcher image for the local stack (C-390 AC-6/AC-7).
#
# The upstream oven/bun image is a minimal runtime and does NOT ship bzip2,
# which stack/fetch_models.ts needs to extract the Kokoro TTS and Moonshine
# STT .tar.bz2 archives into the shared model volume. Without bzip2 the
# compose-path fetcher fails with 'tar (child): bzip2: Cannot exec' and the
# voice/stt profiles can never obtain models. This image adds the missing
# decompressor; nothing else changes — the fetcher source is mounted
# read-only from the repo tree by compose, so the image never needs a rebuild
# when models.manifest.json changes.
#
# The FROM is pinned to the multi-arch INDEX digest (resolved 2026-08-14 from
# the registry manifest list), so both linux/amd64 and linux/arm64 hosts pull
# the correct platform manifest — pinning the amd64 child manifest instead
# would break Apple Silicon (the Darwin native path).

FROM oven/bun:1.3@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4

RUN apt-get update \
    && apt-get install -y --no-install-recommends bzip2 \
    && rm -rf /var/lib/apt/lists/*
