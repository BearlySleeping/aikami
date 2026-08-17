# apps/backend/worker/Dockerfile
#
# `dist/index.js` is a prebuilt, fully self-contained bundle — build it on
# the host (or in CI) first, THEN docker build:
#
#   cd apps/backend/worker && bun run build
#   docker build -f apps/backend/worker/Dockerfile -t <tag> apps/backend/worker
#
# `bun build --target=bun` inlines every import (workspace packages like
# @aikami/backend-discord-bot and @aikami/logger, plus discord.js) into one
# file, so the image needs no `bun install`, no node_modules, and no
# monorepo source at all — just the runtime and one JS file. See
# scripts/src/lib/discord-bot/deploy.ts for the build+push+rollout script.

FROM oven/bun:1-distroless
WORKDIR /app
ENV NODE_ENV=production
# Elysia's health check + Discord Interactions Endpoint (src/index.ts),
# terminating TLS on 443 (Cloudflare Origin CA cert) when WORKER_TLS_CERT/
# WORKER_TLS_KEY resolve, else plain HTTP on 8080 — see README.md's "HTTP
# surface" section for the firewall rule this needs. Binding 443 needs
# root, which this image runs as by default (no USER directive).
EXPOSE 443 8080
COPY dist/index.js ./dist/
# distroless entrypoint is ["bun"], args append to it → equivalent to: bun run dist/index.js
CMD ["run", "dist/index.js"]
