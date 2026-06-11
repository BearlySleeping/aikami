# @aikami/image

Headless ComfyUI image generation microservice using the `yanwk/comfyui-boot:cu130-slim-v2` Docker image.

## Use Case

- Provides a containerized ComfyUI API for AI image generation
- Exposes `/system_stats` and ComfyUI REST endpoints on port 8188
- Models and caches persisted in `src/` directory (bind-mounted into container)

## Where It's Used

- Image generation workflows in the PWA and backend functions
- Managed by the tmux orchestrator alongside voice, emulators, and client

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

None — container-only microservice.

## Tasks

| Task            | Command                             | Description                         |
| --------------- | ----------------------------------- | ----------------------------------- |
| `dev`           | `bun run dev:docker`                | Start ComfyUI container with GPU    |
| `test:image`    | `bun run scripts/check_health.ts`   | Health check via /system_stats      |
| `download:model`| `bun run download:model sd15`       | Download SD 1.5 checkpoint          |
| `models:download`| `bun run models:download <url>`    | Idempotent streaming model download |
| `generate:avatar`| `bun run generate:avatar`          | Generate pixel art character avatar |
| `typecheck`     | `true`                              | No TypeScript source to check       |
| `format`        | `true`                              | No source to format                 |
| `lint`          | `true`                              | No source to lint                   |
| `fix`           | `true`                              | No source to fix                    |

## Usage

```bash
# Start the container via tmux
bun tmux:start image

# Download a model for image generation
bun run models:download "https://..."

# Check health
bun run test:image

# Generate a pixel art avatar
bun run generate:avatar "an elven ranger, pixel art"

# Stop
bun tmux:stop image
```

## Directory Layout

```
apps/backend/image/
├── scripts/
│   ├── check_health.ts     # Health check → /system_stats
│   └── download_model.ts   # Model downloader (SD 1.5, custom URLs)
├── src/                    # ComfyUI data — mounted into container (git-ignored)
│   ├── cache/              # HuggingFace, Torch, config caches
│   ├── custom_nodes/       # ComfyUI custom nodes
│   ├── input/              # Input images
│   ├── models/             # Checkpoints, LoRAs, VAEs
│   ├── output/             # Generated images
│   └── user/               # ComfyUI user profile + workflows
├── Dockerfile
├── package.json
├── moon.yml
└── tsconfig.json
```

## Architecture — Container Setup

### Image

`yanwk/comfyui-boot:cu130-slim-v2` — ComfyUI with CUDA 13.0, Python 3.13,
PyTorch 2.12, ComfyUI-Manager 4.x. Slim variant starts lean; custom nodes
and models are mounted from local directories.

### Podman Run Flags

| Flag / Mount | Purpose |
|---|---|
| `--pull=newer` | Always check for a newer image tag before starting |
| `--device nvidia.com/gpu=all` | Pass NVIDIA GPU through to the container via CDI |
| `--security-opt label=disable` | Disable SELinux label enforcement (required for bind mounts on some systems) |
| `-p 8188:8188` | Expose ComfyUI on host port 8188 |
| `--rm` | Auto-remove container on stop (no stale state) |
| `--name aikami-image-dev` | Fixed container name for tmux orchestration |

### Volume Mounts

Every mount maps a local directory under `src/` into the container to
persist state between restarts and share files without rebuilding:

| Host (`src/…`) | Container | Why |
|---|---|---|
| `cache/` | `/root/.cache` | Python pip/wheel cache, avoids reinstalling deps on restart |
| `cache/dot-config/` | `/root/.config` | ComfyUI user config files |
| `cache/huggingface/` | `/root/.cache/huggingface/hub` | HuggingFace model downloads (huge — git-ignored) |
| `cache/torch/` | `/root/.cache/torch/hub` | PyTorch Hub cache |
| `models/` | `/root/ComfyUI/models` | Checkpoints, LoRAs, VAEs, embeddings (git-ignored) |
| `input/` | `/root/ComfyUI/input` | Input images for img2img workflows |
| `output/` | `/root/ComfyUI/output` | Generated images (git-ignored) |
| `user/` | `/root/ComfyUI/user` | Workflows, settings, Manager config (tracked) |
| `custom_nodes/` | `/root/ComfyUI/custom_nodes` | Custom node Python packages (recreated by image) |

### Environment Variables

| Variable | Value | Purpose |
|---|---|---|
| `CLI_ARGS` | `--fast` | Enable fp8 matrix math on Ada Lovelace+ GPUs (RTX 4090). Speeds up inference ~2× at minor quality trade-off |
| `HF_XET_HIGH_PERFORMANCE` | `1` | Use HuggingFace Hub's Rust-backed high-performance transfer (faster model downloads on stable connections) |

### Scripts

| Script | What it does |
|---|---|
| `scripts/check_health.ts` | Hits `/system_stats` to verify container is up and GPU is detected |
| `scripts/download_model.ts` | Legacy single-model downloader (SD 1.5) |
| `scripts/download_models.ts` | Idempotent streaming downloader with progress bar. Config array in-file documents known pixel-art models |
| `scripts/generate_avatar.ts` | Submits a txt2img prompt to ComfyUI API, polls for completion, downloads the PNG. Supports `--steps`, `--cfg`, `--seed`, `--width`, `--height`, `--checkpoint` |

### Reproducibility

A fresh clone on another machine needs only:

```bash
cd apps/backend/image
bun run dev                        # starts container with same GPU mounts
bun run models:download "URL"      # pulls checkpoint into src/models/
bun run generate:avatar "prompt"   # generates first image
```

Config files (`user/__manager/config.ini`, `user/default/comfy.settings.json`)
are tracked in git so ComfyUI Manager security level and UI settings are
identical across machines.

