# @aikami/voice

Local text-to-speech microservice. The dev engine is **sherpa-onnx** (Kokoro
TTS) from the C-390 local-stack compose topology — the same engine the
published stack ships (C-392).

## Use Case

- Provides an OpenAI-shaped `/v1/audio/speech` TTS API on port 8089
- Readiness probe is `GET /health` (the compose healthcheck uses the same)
- Dev service delegates to `apps/backend/local-stack/compose.yaml` (profile `voice`)
- Model weights live in the shared `aikami-models` store, not in this tree

## Where It's Used

- Voice synthesis workflows in the PWA (TTS) and backend functions
- Managed by the herdr orchestrator alongside text, image, emulators, and client

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Tasks

| Task             | Command                              | Description                            |
|------------------|--------------------------------------|----------------------------------------|
| `dev`            | `bun run dev:docker`                 | Start sherpa-onnx via compose          |
| `test:speech`    | `bun run scripts/synthesize.ts`      | Synthesize + play (mpv/ffplay/aplay)   |
| `update`         | `bun run scripts/update.ts`          | `docker compose --profile voice pull`  |
| `lint`           | `bun run lint`                       | Biome lint of `scripts/`               |
| `fix`            | `bun run fix`                        | Biome autofix + format of `scripts/`   |

> Lint/format use Biome (repo convention): `bun run lint` / `bun run fix`; full validation: `bun moon run :validate`.

## Usage

```bash
# Start the engine via herdr
bun herdr:start voice

# Synthesize speech (default "Hello world")
bun run test:speech
bun run test:speech "Welcome to Aikami"
bun run test:speech "Hello" af_bella

# Stop
bun herdr:stop voice
```

## Directory Layout

```text
apps/backend/voice/
├── scripts/
│   ├── synthesize.ts       # /v1/audio/speech smoke test + playback
│   ├── start.ts            # Compose delegation (profile: voice)
│   └── update.ts           # docker compose pull
├── package.json
├── moon.yml
└── tsconfig.json
```

No `Dockerfile` — the container definition lives in
`apps/backend/local-stack/compose.yaml` (C-390), the only topology in the
repo. The sherpa image is built from `apps/backend/local-stack/docker/voice/`.

## Architecture — Engine Setup

### Engine

`sherpa-onnx` serving Kokoro-82M, built from
`apps/backend/local-stack/docker/voice/Dockerfile.sherpa`. Readiness is
`GET /health`; synthesis is `POST /v1/audio/speech` with the same payload
shape the pre-C-392 kokoro-server exposed (`model`, `input`, `voice`,
`response_format`). The container is CPU-only — Kokoro-82M is realtime on CPU.

### Model Store

The compose `voice` profile mounts the shared `aikami-models` volume at
`/models` and points `KOKORO_DIR` at `/models/tts/kokoro-multi-lang-v1_0`.
Models are fetched once by C-390's manifest-driven fetcher
(`apps/backend/local-stack/stack/fetch_models.ts`).

## Reproducibility

A fresh clone on another machine needs only:

```bash
bun herdr:start voice                # starts compose profile voice
cd apps/backend/local-stack && bun run fetch-models   # first model fetch
bun run test:speech                  # synthesizes and plays
```
