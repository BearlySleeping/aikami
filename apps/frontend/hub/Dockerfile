# apps/frontend/hub/Dockerfile
# ======================================================================================
# Dockerfile for Hub SvelteKit SSR Application on Google Cloud Run (Bun Runtime)
# Base Image: Distroless Bun
# ======================================================================================

# Stage 1: Install dependencies from the minimal package.json generated in build/
# Pinned to an immutable Bun version tag (not :latest) for reproducible builds.
FROM oven/bun:1.3.13 AS builder
WORKDIR /app
COPY build/package.json .
# Generate a lockfile from the production dependency set, then install strictly
# against it so the runtime dependency set is reproducible.
RUN bun install --production --lockfile-only \
    && bun install --production --frozen-lockfile

# Stage 2: Final Distroless image
FROM oven/bun:1.3.13-distroless
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0

# Copy node_modules from the builder stage
COPY --from=builder /app/node_modules ./node_modules
# Copy the built SvelteKit app
COPY build/ .
# Copy the pre-runtime stream primer (seeds Bun's CJS stream cache)
COPY start.js .

EXPOSE 8080
# Use the pre-runtime stream primer to seed Bun's CJS module cache before SvelteKit evaluates
CMD ["start.js"]
