# @aikami/text

Local LLM text generation microservice. The dev engine is **llama-server**
(llama.cpp) from the C-390 local-stack compose topology — the same engine the
published stack ships (C-392). Ollama remains available as an opt-in advanced
service.

## Use Case

- Provides an OpenAI-compatible LLM API on port 11434
- Dev service delegates to `apps/backend/local-stack/compose.yaml` (profile `text`)
- Model weights live in the shared `aikami-models` store, not in this tree

## Where It's Used

- Text generation workflows in the PWA and backend functions
- Managed by the herdr orchestrator alongside voice, image, emulators, and client

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Tasks

| Task             | Command                              | Description                                     |
|------------------|--------------------------------------|-------------------------------------------------|
| `dev`            | `bun run dev:docker`                 | Start llama-server via compose (profile `text`) |
| `dev:ollama`     | `bun run dev:docker ollama`          | Start opt-in Ollama (advanced, same port)       |
| `test:text`      | `bun run scripts/check_health.ts`    | Health check → GET /health                      |
| `test:generate`  | `bun run scripts/test_generate.ts`   | Generation via /v1/chat/completions             |
| `update`         | `bun run scripts/update.ts`          | `docker compose --profile text pull`            |
| `lint`           | `bun run lint`                       | Biome lint of `scripts/`                        |
| `fix`            | `bun run fix`                        | Biome autofix + format of `scripts/`            |

> Lint/format use Biome (repo convention): `bun run lint` / `bun run fix`; full validation: `bun moon run :validate`.

## Usage

```bash
# Start the engine via herdr
bun herdr:start text

# Check health (GET /health)
bun run test:text

# Test generation
bun run test:generate "Hello!"
bun run test:generate --model qwen2.5-1.5b-instruct-q4_k_m "Write a haiku"

# Fetch the model into the shared store first (C-390 manifest fetcher)
(cd apps/backend/local-stack && bun run fetch-models)

# Stop
bun herdr:stop text
```

## Directory Layout

```text
apps/backend/text/
├── scripts/
│   ├── check_health.ts     # Health check → GET /health (llama-server)
│   ├── test_generate.ts    # /v1/chat/completions smoke test
│   ├── start.ts            # Compose delegation (profile: text | ollama)
│   └── update.ts           # docker compose pull
├── package.json
├── moon.yml
└── tsconfig.json
```

No `Dockerfile` — the container definition lives in
`apps/backend/local-stack/compose.yaml` (C-390), the only topology in the repo.

## Architecture — Engine Setup

### Engine

`ghcr.io/ggml-org/llama.cpp:server` (digest-pinned in compose) — llama.cpp's
OpenAI-compatible server. Readiness is `GET /health`; models are listed via
`GET /v1/models`; generation is `POST /v1/chat/completions`.

### Model Store

The compose `text` profile mounts the shared `aikami-models` volume at
`/models` and starts llama-server with `--model /models/text/<GGUF>`.
Models are fetched once by C-390's manifest-driven fetcher
(`apps/backend/local-stack/stack/fetch_models.ts`) — never per-service
downloaders (those were removed in C-392).

### Opt-in Advanced: Ollama

`bun herdr:start text-ollama` starts Ollama on the same port 11434 via the
compose `ollama` profile. It is mutually exclusive with the default `text`
service (herdr refuses to start both). Ollama keeps its store in the
`aikami-ollama-models` named volume, so blobs from the retired legacy
`src/cache/ollama/` tree are not mounted automatically — copy them into that
volume manually if you want to reuse them. Ollama's content-addressed blobs
are not GGUF files and cannot be handed to llama-server. Migrate ComfyUI
checkpoints (not Ollama) with:

```bash
cd apps/backend/local-stack && bun run stack/migrate_models.ts
```

## Reproducibility

A fresh clone on another machine needs only:

```bash
bun herdr:start text                 # starts compose profile text
(cd apps/backend/local-stack && bun run fetch-models)   # first model fetch
bun run test:text                    # verifies llama-server /health
```
