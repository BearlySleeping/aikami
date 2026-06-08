# @aikami/text

Local LLM text generation microservice using the official `ollama/ollama` Docker image.

## Use Case

- Provides a containerized Ollama API for local LLM text generation
- Exposes Ollama REST endpoints on port 11436
- Model weights persisted in `src/cache/ollama/` (bind-mounted into container)

## Where It's Used

- Text generation workflows in the PWA and backend functions
- Managed by the tmux orchestrator alongside voice, imagem, emulators, and pwa

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

None — container-only microservice.

## Tasks

| Task         | Command                           | Description                      |
| ------------ | --------------------------------- | -------------------------------- |
| `dev`        | `bun run dev:docker`              | Start Ollama container           |
| `test:text`     | `bun run scripts/check_health.ts`   | Health check via /               |
| `download:model` | `bun run scripts/download_model.ts`  | Pull qwen3.5:4b (idempotent)     |
| `test:generate`  | `bun run scripts/test_generate.ts`   | Test generation with a prompt    |
| `typecheck`  | `true`                            | No TypeScript source to check    |
| `format`     | `true`                            | No source to format              |
| `lint`       | `true`                            | No source to lint                |
| `fix`        | `true`                            | No source to fix                 |

## Usage

```bash
# Start the container via tmux
bun tmux:start text

# Check health
bun run test:text

# Test generation with a prompt
bun run test:generate "Hello!"
bun run test:generate --model llama3.2:3b "Write a haiku"

# Stop
bun tmux:stop text
```

## Directory Layout

```
apps/backend/text/
├── scripts/
│   ├── check_health.ts     # Health check → /
│   ├── download_model.ts   # Pull qwen3.5:4b (idempotent)
│   └── test_generate.ts    # Send prompt + stream response
├── src/                    # Ollama data — mounted into container (git-ignored)
│   └── cache/ollama/       # Model weights, pulled images
├── Dockerfile
├── package.json
├── moon.yml
└── tsconfig.json
```

## Architecture — Container Setup

### Image

`ollama/ollama` — Official Ollama image providing local LLM serving.

### Podman Run Flags

| Flag / Mount | Purpose |
|---|---|
| `--pull=newer` | Always check for a newer image tag before starting |
| `--security-opt label=disable` | Disable SELinux label enforcement (required for bind mounts on some systems) |
| `-p 11434:11434` | Expose Ollama on host port 11434 |
| `--rm` | Auto-remove container on stop (no stale state) |
| `--name aikami-text-dev` | Fixed container name for tmux orchestration |

### Volume Mounts

| Host (`src/…`) | Container | Why |
|---|---|---|
| `cache/ollama/` | `/root/.ollama` | Model weights and pulled images — git-ignored |

### Scripts

| Script | What it does |
|---|---|
| `scripts/check_health.ts` | Hits `/` to verify container is up and serving |

### Reproducibility

A fresh clone on another machine needs only:

```bash
cd apps/backend/text
bun run dev                        # starts container
bun run test:text                  # verifies Ollama is running
```
