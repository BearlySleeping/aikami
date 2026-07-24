# @aikami/text

Local LLM text generation microservice using Shimmy — a lightweight, pure-Rust WebGPU/WGSL inference server with 100% OpenAI-compatible API endpoints for GGUF models. Downloads the pre-built Linux binary from GitHub Releases onto Ubuntu 24.04.

## Use Case

- Provides a containerized Shimmy API for local LLM text generation
- Exposes OpenAI-compatible REST endpoints on port 11434 (`/v1/chat/completions`, `/v1/models`)
- GGUF model weights persisted in `src/cache/models/` (bind-mounted into container)

## Where It's Used

- Text generation workflows in the PWA and backend functions
- Managed by the herdr orchestrator alongside voice, image, emulators, and client

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

None — container-only microservice. Requires Podman or Docker to run the Shimmy container.

## Tasks

| Task              | Command                            | Description                              |
| ----------------- | ---------------------------------- | ---------------------------------------- |
| `dev`             | `bun run dev:docker`               | Start Shimmy container                   |
| `test:text`       | `bun run scripts/check_health.ts`  | Health check via /health or /v1/models   |
| `download:model`  | `bun run scripts/download_model.ts`| List available GGUF models               |
| `test:generate`   | `bun run scripts/test_generate.ts` | Test generation via /v1/chat/completions |
| `typecheck`       | `true`                             | No TypeScript source to check            |
| `format`          | `true`                             | No source to format                      |
| `lint`            | `true`                             | No source to lint                        |
| `fix`             | `true`                             | No source to fix                         |

## Usage

```bash
# Start the container via herdr
bun herdr:start text

# Check health
bun run test:text

# List available GGUF models
bun run download:model

# Test generation with a prompt
bun run test:generate "Hello!"
bun run test:generate --model default "Write a haiku"

# Stop
bun herdr:stop text
```

## Directory Layout

```
apps/backend/text/
├── docker/
│   ├── start-server.sh     # Docker ENTRYPOINT — starts shimmy serve
│   └── healthcheck.sh      # Docker HEALTHCHECK — /health + /v1/models
├── scripts/
│   ├── check_health.ts     # CLI health check → /health or /v1/models
│   ├── download_model.ts   # List available GGUF models via /v1/models
│   ├── test_generate.ts    # Send prompt + stream via /v1/chat/completions
│   ├── start.ts            # Podman/Docker build + run for local dev
│   └── update.ts           # Check GitHub + update .shimmy-version + rebuild
├── src/
│   └── cache/models/       # GGUF model files — mounted into container (git-ignored)
├── .shimmy-version         # Single source of truth for Shimmy release tag
├── Dockerfile
├── package.json
├── moon.yml
└── tsconfig.json
```

## Architecture — Container Setup

### Image

Pre-built `shimmy-linux-x86_64` binary from GitHub Releases running on Ubuntu 24.04.

### Podman Run Flags

| Flag / Mount                          | Purpose                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `--security-opt label=disable`        | Disable SELinux label enforcement (required for bind mounts on some systems) |
| `-p 11434:11434`                      | Expose Shimmy on host port 11434                                        |
| `--rm`                                | Auto-remove container on stop (no stale state)                          |
| `--name aikami-text-dev`              | Fixed container name for herdr orchestration                            |

### Environment Variables

| Variable             | Default    | Purpose                                   |
| -------------------- | ---------- | ----------------------------------------- |
| `SHIMMY_PORT`        | `11434`    | Server port                               |
| `SHIMMY_BASE_GGUF`   | `/models`  | Models directory or specific GGUF path    |
| `SHIMMY_HOST`        | `0.0.0.0`  | Listen address                            |
| `SHIMMY_MAX_CTX`     | (optional) | Maximum context length (e.g. `4096`)      |
| `SHIMMY_KV_QUANT`    | (optional) | Set to `int4` for TurboShimmy INT4 KV     |

### Volume Mounts

| Host (`src/…`)      | Container  | Why                                    |
| ------------------- | ---------- | -------------------------------------- |
| `cache/models/`     | `/models`  | GGUF model files — git-ignored         |

### Scripts

| Script                        | What it does                                          |
| ----------------------------- | ----------------------------------------------------- |
| `docker/start-server.sh`      | Docker ENTRYPOINT — scans for GGUF files, starts shimmy serve |
| `docker/healthcheck.sh`       | Docker HEALTHCHECK — polls /health then /v1/models    |
| `scripts/check_health.ts`     | CLI health check — /health or /v1/models              |

### Reproducibility

A fresh clone on another machine needs only:

```bash
cd apps/backend/text
# Place .gguf model files in src/cache/models/
bun run dev                        # starts container
bun run test:text                  # verifies Shimmy is running
bun run test:generate              # test a generation
```
