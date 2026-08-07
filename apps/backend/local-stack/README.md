# Aikami Local Stack — Docker & Native Binary Orchestration

Orchestration package for the **local AI engine stack**: text (LLM), image
(ComfyUI), voice (sherpa-onnx TTS/STT) and the client UI — either as
containerized services or as lightweight native host binaries (no Docker /
PyTorch / CUDA overhead).

The client is **built on the host** and its static output is staged into
`.build/client/` (git-ignored) — only the local-stack tree enters a build
context, never the monorepo source.

```
apps/backend/local-stack/
├── moon.yml                        # Moon project definition
├── package.json                    # Task scripts for Moon / Bun
├── README.md                       # This file
├── docker-compose.yml              # Profile-based modular multi-container stack
├── docker-compose.lite.yml         # Minimal client-only compose configuration
├── Dockerfile.client               # Lightweight client UI container (nginx SPA)
├── Dockerfile.ultimate             # Single all-in-one container (Models + Runtimes + Client)
├── bin/                            # Native Host Binary Mode Launchers (No-Docker)
│   ├── run-native-tts.sh           # sherpa-onnx Kokoro TTS (websocket, :6006)
│   ├── run-native-stt.sh           # sherpa-onnx Moonshine STT (websocket, :6007)
│   └── run-native-llm.sh           # shimmy / llama.cpp LLM (OpenAI-compatible, :8080)
├── docker/
│   ├── voice/
│   │   ├── Dockerfile.sherpa       # Lightweight C++ STT/TTS container
│   │   └── entrypoint.sh           # Model auto-download + server supervisor
│   ├── scripts/
│   │   └── entrypoint-ultimate.sh  # Auto-model downloader & multi-process supervisor
│   ├── runtime/                    # Bun static server used by the Ultimate container
│   └── client/                     # nginx SPA config
└── models/                         # Git-ignored local model store
    ├── llm/  image/  tts/  stt/
```

---

## Quick start

All commands run from `apps/backend/local-stack/`, or via Moon/Bun from the
repo root:

| What | Command |
| --- | --- |
| Build the client SPA (host, production mode) | `bun run build:client` |
| Client image + run | `bun run build:client:docker` / `docker compose up -d` |
| Client + voice | `docker compose --profile voice up -d` |
| Everything (GPU) | `docker compose --profile full up -d` |
| Minimal client-only stack | `docker compose -f docker-compose.lite.yml up -d` |
| Ultimate single container | `bun run build:ultimate` |
| Native TTS (no Docker) | `bash bin/run-native-tts.sh` |
| Native STT (no Docker) | `bash bin/run-native-stt.sh` |
| Native LLM (no Docker) | `bash bin/run-native-llm.sh` |

Moon equivalents (repo root):

```bash
bun moon run local-stack:build-client   # host-side SPA build (production mode)
bun moon run local-stack:up             # client only
bun moon run local-stack:up-full        # full profile
bun moon run local-stack:up-voice       # voice profile
bun moon run local-stack:up-lite        # lite compose file
bun moon run local-stack:run-native-voice
```

> **Prerequisite:** `bun run build:client` (or `build:client:docker`) must run
> before any `docker compose ... up --build`, because it builds the SPA and
> stages it into `.build/client/`. The compose services that pull prebuilt
> images (text/image/voice) work immediately.

### Endpoints

| Service | Container | Host | Protocol |
| --- | --- | --- | --- |
| Client UI | `aikami-app` | http://localhost:3000 | HTTP (SPA) |
| Text (LLM) | `text-engine` | http://localhost:8080/v1 | OpenAI-compatible |
| Image (ComfyUI) | `image-engine` | http://localhost:8188 | HTTP |
| Voice TTS | `voice-engine` | ws://localhost:6006 | WebSocket |
| Voice STT | `voice-engine` | ws://localhost:6007 | WebSocket (`ENABLE_STT=true`) |

### Services & profiles

| Service | Image | Profile | Purpose |
| --- | --- | --- | --- |
| `aikami-app` | built (`Dockerfile.client`) | always | SvelteKit SPA served by nginx |
| `text-engine` | `ghcr.io/michael-a-kuykendall/shimmy:latest` | `text`, `full` | llama.cpp OpenAI-compatible LLM server |
| `image-engine` | `comfyui/comfyui:latest` | `vision`, `full` | Headless ComfyUI image generation |
| `voice-engine` | built (`docker/voice/Dockerfile.sherpa`) | `voice`, `full` | sherpa-onnx C++ TTS + STT websocket servers |

**GPU:** `text-engine` and `image-engine` request NVIDIA GPUs through the
compose `deploy` schema. Install [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
on the host. To run CPU-only, remove the `deploy:` blocks.

---

## Building the client (host-side)

The client is a static SPA; its engine endpoints are baked at build time via
`PUBLIC_*` env vars. `bun run build:client` builds with **production mode**
(`build:production` → `.env.production`, i.e. live Firebase cloud sync),
stages the output into `.build/client/`, and defaults the engine URLs to the
compose stack's host-mapped ports:

| Env var | Default |
| --- | --- |
| `PUBLIC_OLLAMA_BASE_URL` (from `LLM_ENDPOINT`) | `http://localhost:8080/v1` |
| `PUBLIC_IMAGE_URL` (from `IMAGE_ENDPOINT`) | `http://localhost:8188` |
| `PUBLIC_VOICE_URL` (from `VOICE_ENDPOINT`) | `ws://localhost:6006` |

Overrides:

```bash
# Emulator mode (local Firebase emulators) instead of live cloud sync
CLIENT_MODE=emulator bun run build:client

# Point at a different LLM endpoint
LLM_ENDPOINT=http://text-engine:8080/v1 bun run build:client
```

> Only `PUBLIC_*` variables are exposed to the client bundle (Vite
> `envPrefix: ['PUBLIC_']`) — non-public env never leaks into the SPA.

---

## Docker modes

### 1. Modular compose stack (`docker-compose.yml`)

Profile-based; each engine is an isolated container. Recommended dev setup.

```bash
bun run build:client:docker     # build SPA + client image
docker compose --profile full up -d
docker compose logs -f
docker compose --profile full down
```

### 2. Lite client-only (`docker-compose.lite.yml`)

Runs just the client against engines already running on the host (e.g. via
`herdr` or the native launchers).

```bash
bun run build:client:docker
docker compose -f docker-compose.lite.yml up -d
```

### 3. Ultimate single container (`Dockerfile.ultimate`)

One image bundling shimmy (LLM), sherpa-onnx (TTS/STT) and the prebuilt
client. The entrypoint downloads default models into `/models` on first start
and supervises all processes.

```bash
bun run build:ultimate    # host SPA build + stage + image build

docker run --rm -p 3000:3000 -p 8080:8080 -p 6006:6006 \
  -v "$(pwd)/models:/models" \
  aikami-ultimate
```

Environment toggles: `ENABLE_VOICE` / `ENABLE_TEXT` (default `true`), model
paths under `/models`. The LLM only starts when `/models/llm/model.gguf`
exists.

---

## Native Host Binary Mode (no Docker)

For CPU-bound voice workloads the C++ sherpa-onnx binaries run **directly on
the host** — no containers, no PyTorch, no CUDA image layers.

Prerequisites: install `sherpa-onnx` (`pip install sherpa-onnx` provides the
native binaries) and optionally `llama.cpp` (`llama-server`) for the LLM.

```bash
bash bin/run-native-tts.sh   # Kokoro TTS  → ws://localhost:6006
bash bin/run-native-stt.sh   # Moonshine   → ws://localhost:6007
bash bin/run-native-llm.sh   # llama-server → http://localhost:8080/v1
```

Each launcher auto-downloads its default model into `models/` on first run and
fails with installation hints when the host binary is missing.

---

## Models

Model weights are **never committed** (`models/.gitignore` ignores `*.gguf`,
`*.safetensors`, `*.onnx`, `*.bin`, `*.pt`, archives and caches) and are
excluded from every build context. They are auto-downloaded on first start:

- **TTS:** Kokoro-82M (`kokoro-v1.0.onnx` + `voices.bin`) → `models/tts/`
- **STT:** Moonshine tiny int8 (sherpa-onnx tarball) → `models/stt/`
- **LLM:** drop a `model.gguf` into `models/llm/` (native launcher offers an
  auto-download default)

Bind mounts: `models/llm` → text-engine `/models`, `models/tts` + `models/stt`
→ voice-engine `/models/tts` + `/models/stt`, `models/image` → ComfyUI
`/app/models`.

---

## Notes & known limitations

- The compose `version: "3.8"` key is legacy — modern Compose v2 ignores it
  with a warning and uses the full spec.
- All build contexts are self-contained (`apps/backend/local-stack` and
  `docker/voice`); the monorepo never enters a context. The root
  `.dockerignore` remains as a safety net for direct repo-root `docker build`
  invocations.
- `text-engine` shimmy serves an OpenAI-compatible API; the client's Ollama
  provider talks to it via `/v1`.
- The Ultimate entrypoint downloads the raw HuggingFace Moonshine `model.onnx`
  (per the original design); the sherpa-onnx STT server needs the full
  preprocessor/encoder/decoder/tokens layout — see
  `bin/run-native-stt.sh` / `docker/voice/entrypoint.sh` for the working
  tarball download.
- Kokoro TTS benefits from `tokens.txt` + `espeak-ng-data` (full sherpa-onnx
  tarball layout); the minimal hexgrad download works without them for basic
  synthesis.

## References

- Container config patterns follow `examples/Marinara-Engine`
  (multi-stage builds, entrypoint supervision, env-driven config) and the
  hub's prebuilt-output pattern.
- sherpa-onnx docs: https://k2-fsa.github.io/sherpa/onnx/
- shimmy: https://github.com/Michael-A-Kuykendall/shimmy
