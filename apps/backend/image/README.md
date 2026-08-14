# @aikami/image

Headless image generation microservice. The dev engine is **sd-server**
(stable-diffusion.cpp) from the C-390 local-stack compose topology — the same
engine the published stack ships (C-392). ComfyUI remains available as an
opt-in advanced service.

## Use Case

- Provides an image generation API on port 8188
- Dev service delegates to `apps/backend/local-stack/compose.yaml` (profile `image`)
- Model weights live in the shared `aikami-models` store, not in this tree

## Where It's Used

- Avatar / image generation workflows in the PWA and backend functions
- Managed by the herdr orchestrator alongside voice, text, emulators, and client

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Tasks

| Task             | Command                              | Description                                        |
| `dev`            | `bun run dev:docker`                 | Start sd-server via compose (profile `image`)      |
| `dev:comfyui`    | `bun run dev:docker comfyui`         | Start opt-in ComfyUI (advanced, same port)         |
| `test:image`     | `bun run scripts/check_health.ts`    | Health check → GET /sdapi/v1/sd-models             |
| `generate:avatar`| `bun run scripts/generate_avatar.ts` | Generate a character avatar via /sdcpp/v1/img_gen  |
| `update`         | `bun run scripts/update.ts`          | `docker compose --profile image pull`              |
| `typecheck`/`lint`/`fix` | `true`                       | No TypeScript source to check                      |

## Usage

```bash
# Start the engine via herdr
bun herdr:start image

# Check health (GET /sdapi/v1/sd-models — same probe the client uses)
bun run test:image

# Generate a pixel art avatar
bun run generate:avatar "an elven ranger, pixel art"
bun run generate:avatar "a knight" --steps 20 --cfg 7 --seed 42 \
  --width 512 --height 512 --checkpoint flux1-schnell-q4_k.gguf

# Fetch the model into the shared store first (C-390 manifest fetcher)
cd apps/backend/local-stack && bun run fetch-models

# Stop
bun herdr:stop image
```

## Directory Layout

```
apps/backend/image/
├── scripts/
│   ├── check_health.ts     # Health check → GET /sdapi/v1/sd-models
│   ├── generate_avatar.ts  # Avatar CLI → POST /sdcpp/v1/img_gen + job poll
│   ├── start.ts            # Compose delegation (profile: image | comfyui)
│   └── update.ts           # docker compose pull
└── src/                    # Legacy ComfyUI data tree (retired, git-ignored)
    └── output/             # Generated images from generate_avatar
```

No `Dockerfile` — the container definition lives in
`apps/backend/local-stack/compose.yaml` (C-390), the only topology in the repo.

## Architecture — Engine Setup

### Engine

`aikami-sd-server` (CPU) or the published `leejet/stable-diffusion.cpp`
variants (CUDA/ROCm/…, selected by the compose backend override) — sd-server.
Readiness and model listing are `GET /sdapi/v1/sd-models`; generation is
`POST /sdcpp/v1/img_gen` with job polling via `GET /sdcpp/v1/jobs/{id}`. The
job payload carries the image inline (base64) — no second fetch hop.

### Model Store

The compose `image` profile mounts the shared `aikami-models` volume at
`/models` and starts sd-server with `--model /models/image/<GGUF>`. Models
are fetched once by C-390's manifest-driven fetcher
(`apps/backend/local-stack/stack/fetch_models.ts`) — the per-service
downloaders were removed in C-392.

### Opt-in Advanced: ComfyUI

`bun herdr:start image-comfyui` starts ComfyUI on the same port 8188 via the
compose `comfyui` profile. It is mutually exclusive with the default `image`
service (herdr refuses to start both). Existing ComfyUI checkpoints from the
legacy `src/models/` tree can be copied into the shared store:

```bash
cd apps/backend/local-stack && bun run stack/migrate_models.ts
```

### generate_avatar CLI

The CLI surface is preserved from the pre-C-392 ComfyUI version (AC-5):
`--steps`, `--cfg`, `--seed`, `--width`, `--height`, `--checkpoint` all keep
working. `--checkpoint` maps to the sd-server `model` field (the GGUF file
name under `/models/image/`, default `flux1-schnell-q4_k.gguf`). Output PNGs
are saved to `src/output/<timestamp>/avatar.png`.

## Reproducibility

A fresh clone on another machine needs only:

```bash
bun herdr:start image                # starts compose profile image
cd apps/backend/local-stack && bun run fetch-models   # first model fetch
bun run test:image                   # verifies sd-server model list
bun run generate:avatar "prompt"     # generates first image
```
