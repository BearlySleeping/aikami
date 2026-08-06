# apps/frontend/hub/Dockerfile
# ======================================================================================
# Dockerfile for Hub SvelteKit SSR Application on Google Cloud Run (Bun Runtime)
# Base Image: Distroless Bun
# ======================================================================================

# Stage 1: Install dependencies from the minimal package.json generated in build/
FROM oven/bun:latest AS builder
WORKDIR /app
COPY build/package.json .
RUN bun install --production

# Stage 2: Final Distroless image
FROM oven/bun:distroless
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0

# Copy node_modules from the builder stage
COPY --from=builder /app/node_modules ./node_modules
# Copy the built SvelteKit app
COPY build/ .

EXPOSE 8080
CMD ["index.js"]
