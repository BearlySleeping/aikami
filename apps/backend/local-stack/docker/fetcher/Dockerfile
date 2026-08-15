# apps/backend/local-stack/docker/fetcher/Dockerfile
# Model-fetcher image for the local stack (C-390 AC-6/AC-7).
#
# The upstream oven/bun image is a minimal runtime and does NOT ship bzip2,
# which stack/fetch_models.ts needs to extract the Kokoro TTS and Moonshine
# STT .tar.bz2 archives into the shared model volume. Without bzip2 the
# compose-path fetcher fails with 'tar (child): bzip2: Cannot exec' and the
# voice/stt profiles can never obtain models. This image adds the missing
# decompressor.
#
# The fetch script and manifest are baked in (see COPY below) rather than
# bind-mounted from the repo, so the published image is self-contained and
# `docker compose up -d` works from a standalone compose.yaml with no repo
# checkout. fetch_models.ts has zero @aikami/* workspace imports (only
# node:* builtins) so it needs no bundling. Contributors editing the fetcher
# or the manifest just rebuild: `docker compose build model-fetcher`.
#
# Build context is the local-stack root (`.`), not this directory — the COPY
# below reaches up into stack/.
#
# The FROM is pinned to the multi-arch INDEX digest (resolved 2026-08-14 from
# the registry manifest list), so both linux/amd64 and linux/arm64 hosts pull
# the correct platform manifest — pinning the amd64 child manifest instead
# would break Apple Silicon (the Darwin native path).

FROM oven/bun:1.3@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4

RUN apt-get update \
    && apt-get install -y --no-install-recommends bzip2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY stack/fetch_models.ts stack/models.manifest.json /app/stack/
