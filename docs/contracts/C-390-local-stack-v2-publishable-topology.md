---
id: C-390
title: "Local Stack v2 — Publishable Compose Topology, Engine Baseline, and Model Store"
source: "user request — 'I want to upload the docker in our github repo so people can setup local text, image, voice, client... as fast and minimal as possible'"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-13"
---

# Contract C-390: Local Stack v2 — Publishable Compose Topology, Engine Baseline, and Model Store

## Metadata

| Field | Value |
|---|---|
| **Source** | Local-stack engine review, 2026-08-13. Decisions: shimmy is rejected (v2 dropped llama.cpp for a from-scratch WebGPU engine with F32-throughout compute and no MoE support); the bundled defaults become `llama-server`, `sd-server`, and sherpa-onnx; Ollama and ComfyUI remain first-class for advanced users. |
| **Target** | `apps/backend/local-stack/`, `packages/shared/constants/src/lib/development_ports.ts`, `.github/workflows/` |
| **Priority** | P1 — the stack is currently non-functional (it references a container image that does not exist) and cannot be published. |
| **Dependencies** | C-389 (runtime engine config — without it the client image is not publishable). C-388 (sd-server client adapter — without it the default image engine is unreachable). |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | user-facing → "Run Aikami locally" page in `apps/frontend/docs/src/content/docs/`, plus `apps/backend/local-stack/README.md` |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **The stack does not start. The image engine reference is invalid.**
  `apps/backend/local-stack/docker-compose.yml` pins `image: comfyui/comfyui:latest`. **Verified 2026-08-13:** `docker manifest inspect comfyui/comfyui:latest` fails — the repository does not exist. The working ComfyUI image used elsewhere in the repo is `yanwk/comfyui-boot:cu130-slim-v2` (`apps/backend/image/`). The two halves of the project disagree about which ComfyUI to run, and the compose half is simply wrong.

- **The text engine is the wrong bet.** The stack pins `ghcr.io/michael-a-kuykendall/shimmy:latest` (image exists — verified). But shimmy v2 **removed the llama.cpp backend** and now runs "Airframe", a from-scratch pure-Rust WebGPU engine. Its own documentation states **F32 precision throughout** and lists **Mixture-of-Experts as unimplemented (roadmap)**, with support certified against a whitelist of 25 model/quant combinations. F32 compute means quantized weights are expanded before every matmul — the opposite of the stated "fast and minimal" goal — and no MoE excludes the entire fast-small-model frontier. Its headline metrics (`<100ms` startup, `50MB` idle) measure binary overhead, not inference.

- **Port 8080 collides.** The stack maps `text-engine` to host `8080`. `packages/shared/constants/src/lib/development_ports.ts` documents `8080` as **Nordclaw's Firestore emulator**. Meanwhile `EMULATOR_PORTS.text = 11434`, `image = 8188`, `voice = 8089` — the local stack ignores the project's own port allocation table.

- **The voice engine is unreachable from the client.** The stack serves TTS on `6006`; `tts_service.svelte.ts:620` probes `8880`. Documented in C-389.

- **The client container is mandatory and cannot be prebuilt.** `docker-compose.yml` gives `aikami-app` no profile, so it starts in every configuration — including for users who only want engines behind a Tauri desktop app. And because endpoints are baked at build time (C-389), the image cannot be published and reused.

- **`Dockerfile.ultimate` is structurally incompatible with the goal.** One image cannot simultaneously be the CUDA build, the ROCm build, the CPU build, and the Metal build. It also bundles the client, which should be optional, and pins a shimmy base. It cannot be part of a per-hardware story.

- **`docker-compose.lite.yml` duplicates the main file** for the single case "client only", which a profile already expresses.

- **Existing implementation to reuse**:
  - `docker/voice/Dockerfile.sherpa` + `entrypoint.sh` + `tts_server.py` — a working, minimal C++ voice container with model auto-download. Keep.
  - `docker/client/nginx.conf` — SPA serving config. Keep.
  - `bin/run-native-{tts,stt,llm}.sh` — the no-Docker path, which becomes **required** on macOS. Keep and promote.
  - `models/.gitignore` — already excludes `*.gguf`, `*.safetensors`, `*.onnx`, `*.bin`, `*.pt`. Keep.
  - `scripts/check.sh` — the `local-stack:test` entry point. Extend.

- **Known gaps**: no health checks, no per-backend variants, no model manifest, no registry publishing, no `.env` contract, no macOS story.

- **Baseline tests**: `bun moon run local-stack:test` and `bun run lint` (which runs `docker compose config --quiet`) must pass before starting. Note that `docker compose config` validates syntax only — it does **not** catch the invalid image reference above.

## User Outcome

After this contract, a **new user** can clone the repo, run two commands, and
have a working local AI stack matched to their hardware — with no Python, no
CUDA toolkit install, no model hunting, and no source build.

## Success Measures

- **Time/latency target**: from `git clone` to a first generated token in under 10 minutes on a 100 Mbit connection, of which the model download dominates. Warm start of an already-provisioned stack under 20 s.
- **Offline/degraded behavior**: once images and models are cached, the entire stack starts with no network. A missing model disables only its own service; the others start.
- **Production journey enabled**: `docker compose up -d` is the whole install story for Linux and Windows/WSL2 users, and the published images mean no local build step.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Voice container | `docker/voice/Dockerfile.sherpa`, `entrypoint.sh` | reuse — becomes the STT host and optional server TTS |
| SPA nginx config | `docker/client/nginx.conf` | modify — add `config.json` mount and `no-store` |
| Native launchers | `bin/run-native-*.sh` | reuse — promoted to the macOS path; default ports move to the allocation table (`LLM_PORT=11434`, `TTS_PORT=8089`) |
| Compose topology | `docker-compose.yml` | **replace** |
| Lite compose | `docker-compose.lite.yml` | **delete** — a profile expresses this |
| Ultimate image | `Dockerfile.ultimate`, `docker/scripts/entrypoint-ultimate.sh`, `docker/client-server/` | **delete** — incompatible with per-backend builds. Note: `scripts/check.sh` currently hosts C-389's AC-10 static-serve/config-swap check via `docker/client-server/client_server.ts`; port that assertion into the container-level AC-9 test when check.sh is rewritten so the runtime-config guarantee stays asserted after deletion. Local `dist/` serving (its only other role) is replaced by the web-client container or a documented `bunx serve build` fallback in the README |
| Port allocation | `packages/shared/constants/src/lib/development_ports.ts` | modify — add STT, reuse existing text/image/voice ports |
| Stack smoke test | `scripts/check.sh` | modify — real health assertions |

## Overview

Replace the compose topology with a single `compose.yaml` whose **profiles
select modalities** and whose **override files select the hardware backend**,
pull upstream engine images rather than rebuilding them, move all weights into
a shared named volume populated by a checksum-verified fetcher, publish the
two images we actually own to GHCR, and delete the Ultimate container and the
lite compose file. Ports align with the project's existing allocation table so
the Tauri CSP and client defaults keep working unchanged.

## Design Reference

**The combinatorial problem.** Four modalities (text / image / TTS / STT),
five backends (cpu / cuda / rocm / vulkan / metal), and an optional web client
is a matrix no single compose file can express with conditionals — Compose has
no `if`. The standard resolution, and the one this contract adopts:

- **Modality → Compose profile.** `COMPOSE_PROFILES=text,image,voice,stt,web`
- **Backend → Compose override file.** `COMPOSE_FILE=compose.yaml:compose.cuda.yaml`

Both are set in `.env`, which Compose reads automatically. The user's runtime
command is therefore plain `docker compose up -d` with **no flags** — all
variation lives in one generated file. Override files carry the `deploy`
device reservations and the backend-specific image tags; the base file carries
everything invariant.

**Ports keep their existing values.** `text = 11434`, `image = 8188`,
`voice = 8089` from `development_ports.ts`. This is deliberate: the Tauri CSP
already whitelists `localhost:11434` and `localhost:8188`, and the client's
Ollama provider already defaults to `11434`. Changing engines while keeping
ports means the desktop app needs no CSP change for text and image, and Ollama
remains a drop-in alternative on the same port. Host `8080` is abandoned — it
belongs to Nordclaw.

The same ports must be used by every path that talks to the engines, not just
compose: `scripts/emit_config.sh` defaults (currently `text.url =
http://localhost:8080/v1`, voice `6006`) move to `11434` / `8089`, and the
native launchers (`bin/run-native-llm.sh` defaults `LLM_PORT=8080`,
`bin/run-native-tts.sh` defaults `TTS_PORT=6006`) move to the same table
ports, so the macOS native path (AC-12) and the containerised path expose
identical endpoints to the client.

**Only build what upstream does not publish.** All registry facts below were
verified against the live registries on 2026-08-13.

| Service | Source | Build or pull |
|---|---|---|
| Text | `ghcr.io/ggml-org/llama.cpp:server*` | pull |
| Image | `ghcr.io/leejet/stable-diffusion.cpp:master-*` | pull (except CPU — see below) |
| Image (CPU) | built from upstream's CPU Dockerfile | build → publish |
| Voice (TTS/STT) | `docker/voice/Dockerfile.sherpa` | build → publish |
| Web client | `Dockerfile.client` | build → publish |
| Ollama (advanced) | `ollama/ollama` | pull |
| ComfyUI (advanced) | `yanwk/comfyui-boot:cu130-slim-v2` | pull |

**Verified backend coverage.** This table is the authority for which override
files exist and what each pins:

| Backend | Text — `ggml-org/llama.cpp` | Image — `leejet/stable-diffusion.cpp` |
|---|---|---|
| cpu | `server` ✅ | **none published** — we build `aikami-sd-server:cpu` |
| cuda (12) | `server-cuda` ✅ | `master-cuda` ✅ |
| cuda (13) | `server-cuda13` ✅ | `master-cuda` ✅ (single CUDA tag) |
| rocm / AMD | `server-rocm` ✅ | **none published** — use `master-vulkan` ✅ |
| vulkan | `server-vulkan` ✅ | `master-vulkan` ✅ |
| intel / SYCL | `server-intel` ✅ | `master-sycl` ✅ |
| musa | `server-musa` ✅ | `master-musa` ✅ |

Two consequences that shape the design:

1. **Vulkan is the universal GPU fallback.** It is published for both engines
   and covers AMD, Intel Arc, and integrated GPUs in one override file. AMD
   users get `server-rocm` for text but must use `master-vulkan` for image —
   so the `rocm` override file is text-only and inherits Vulkan for image.
2. **The two projects have incompatible tagging schemes.** llama.cpp publishes
   build-numbered tags (`server-vulkan-b5350`), which are immutable and
   pinnable by name. stable-diffusion.cpp publishes **only rolling `master-*`
   tags** — the complete published set is `master-cuda`, `master-cuda-spark`,
   `master-musa`, `master-sycl`, `master-vulkan`. There is no version tag to
   pin to, so **sd-server must be pinned by digest**, and the digest-bump job
   matters more for it than for llama.cpp.

**Recommended model catalog.** Licenses verified 2026-08-13; exact byte sizes
and SHA-256 digests are resolved during implementation from the pinned HF
revisions and recorded in the manifest.

| Modality | Tier | Model | License | Notes |
|---|---|---|---|---|
| Text | cpu / <4 GB | Qwen3-1.7B-Instruct, Q4_K_M GGUF | Apache-2.0 | Baseline that runs anywhere |
| Text | 6–8 GB VRAM | Qwen3-4B-Instruct, Q4_K_M GGUF | Apache-2.0 | Default recommendation |
| Text | 12–16 GB | Mistral-Nemo-Instruct-2407 12B, Q4_K_M GGUF | Apache-2.0 | 128k context; strong creative writing — the best fit for a TTRPG narrator |
| Text | 24 GB+ | Qwen3-30B-A3B (MoE), Q4_K_M GGUF, or gpt-oss-20b | Apache-2.0 | MoE — fast because only a fraction of params activate. Precisely what shimmy cannot run |
| Image | 6 GB+ VRAM | FLUX.1-schnell GGUF (`leejet/FLUX.1-schnell-gguf`) | **Apache-2.0** | 4-step generation; quants published by the sd.cpp author; documented to run at 4–6 GB VRAM |
| Image | cpu / <6 GB | SD 1.5 | CreativeML OpenRAIL-M | ⚠️ Use-restricted, not OSI-approved. Must be presented with its license, not silently downloaded |
| TTS | any | Kokoro-82M ONNX | Apache-2.0 | Already in use |
| STT | any | Moonshine tiny/base ONNX (sherpa) | MIT | Streaming; shares the sherpa binary |
| STT | accuracy | whisper.cpp `ggml-base`/`small` | MIT | If OpenAI `/v1/audio/transcriptions` compatibility is wanted |

**Rejected:** shimmy (see Problem section) and CrisperWhisper — its inference
code is MIT but **the model weights are under the Nyra Health Non-Commercial
Research License**, which forbids commercial use without a separate licence.
It also requires CTranslate2 (NVIDIA + Linux) or PyTorch, with no GGML/ONNX
export and no server. Disqualified for a distributed bundle on licensing
before performance is even considered.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **One `compose.yaml`.** Delete `docker-compose.lite.yml`. Delete
  `Dockerfile.ultimate` and its entrypoint and client-server directory.
- **`.env` is the only thing that varies.** After `init`, the user runs
  `docker compose up -d` with no flags, ever.
- **Never bake weights into an image.** All models live in a named volume
  populated by a one-shot fetcher service, never in a layer.
- **The web client is opt-in** (`web` profile). Tauri users and `dist`-serving
  users start no client container.
- **Every service declares a health check**, and dependent services use
  `depends_on: { condition: service_healthy }` so the client never renders
  against a half-started engine. The one-shot model fetcher is the exception:
  engines wait for it with `depends_on: { condition: service_completed_successfully }`
  — a health check cannot run on a container that has already exited, and the
  fetcher's exit-0 contract keeps that gate from blocking other engines.
- **macOS gets no GPU containers.** Docker Desktop provides no Metal
  passthrough; a containerised engine on macOS is CPU-only and slow. On Darwin
  the setup emits a **native plan** using `bin/run-native-*.sh`, and only the
  optional web client is containerised. This must be stated plainly in the
  README rather than discovered by users.
- **The model fetcher is idempotent, resumable, and checksum-verified.**
  Re-running it after a partial download resumes; a digest mismatch re-fetches
  rather than proceeding. It is **profile-scoped**: it fetches only the
  modalities the user enabled via `COMPOSE_PROFILES` — a `text`-only install
  never downloads image or voice weights. Per-model failures are recorded and
  **non-fatal**: the fetcher exits 0 as long as the enabled modalities were
  attempted, so one failed download cannot prevent unrelated engines from
  starting (their own health checks report the missing model).
- **Use-restricted models require explicit acknowledgement.** SD 1.5 is
  OpenRAIL-M; the fetcher must print the licence and require an explicit opt-in
  flag or env var before downloading it. Apache/MIT models download freely.
- **Pin every upstream image by digest.** `:latest` in a published quick-start
  is an unreproducible install. For llama.cpp, additionally use the immutable
  build-numbered tag (`server-vulkan-b5350`) so the pin is human-readable. For
  sd-server there is no such tag — the rolling `master-*` tag plus a digest is
  the only option, and the digest is what actually pins it.
- **Ports come from `development_ports.ts`.** Add an `stt` entry within the
  documented Aikami backend range (`8087–8092`). Do not introduce ad-hoc ports.

## State & Data Models

```jsonc
// stack/models.manifest.json — the catalog. Sizes/digests filled at implementation.
{
  "schemaVersion": 1,
  "entries": [
    {
      "id": "text-qwen3-4b-instruct-q4km",
      "modality": "text",
      "tier": "8gb",
      "license": "Apache-2.0",
      "requiresAcknowledgement": false,
      "repo": "…",
      "revision": "<pinned commit sha>",
      "file": "…Q4_K_M.gguf",
      "targetPath": "text/qwen3-4b-instruct-q4_k_m.gguf",
      "bytes": 0,
      "sha256": ""
    }
  ]
}
```

```ts
/** Hardware backend → compose override file + upstream image tags. */
// 'metal' deliberately has no compose override — on Darwin the setup emits the
// native plan (bin/run-native-*.sh) and only the web client is containerised.
type StackBackend = 'cpu' | 'cuda' | 'rocm' | 'vulkan' | 'metal';

/** Modalities the user opted into; maps 1:1 onto compose profiles. */
type StackModality = 'text' | 'image' | 'voice' | 'stt' | 'web';

/** The generated .env, expressed as a type for the writer and its tests. */
type StackEnv = {
  readonly composeFile: string;      // "compose.yaml:compose.cuda.yaml"
  readonly composeProfiles: string;  // "text,image,stt"
  readonly backend: StackBackend;
  readonly textModel: string;        // path inside the models volume
  readonly imageModel: string;
  readonly ports: { text: number; image: number; voice: number; stt: number; web: number };
};
```

```
Named volume:  aikami-models
Layout:        /models/{text,image,tts,stt}/…
```

## Quality Requirements

- **Offline/degraded mode**: with images and models cached, `docker compose up -d` succeeds with networking to the internet disabled. A service whose model file is absent must fail its own health check without preventing the others from starting.
- **Accessibility/input**: N/A — no UI in this contract.
- **Performance budget**: warm start to all-healthy under 20 s on the `cpu` backend with models present.
- **Security/privacy**: containers run as non-root (the sherpa container's configurable `VOICE_UID`/`VOICE_GID` is the existing pattern — apply it consistently). No `curl | bash` in any Dockerfile. Every downloaded artifact is digest-verified. Engines bind to `127.0.0.1` on the host by default, not `0.0.0.0`.
- **Persistence/migration**: the named volume survives `docker compose down`; only `down -v` destroys models, which the README must call out.
- **Cancellation/retry/idempotency**: the fetcher is safely interruptible and re-runnable; `up` is idempotent.
- **Observability**: `docker compose ps` shows meaningful health states; the smoke test reports per-service pass/fail rather than a single boolean.

## Migration & Rollback

- **Old data compatibility**: the existing `models/` bind-mount tree (`models/{llm,image,tts,stt}`) holds any weights a user already downloaded. Provide a one-time import that moves them into the named volume, or support the bind mount as an alternative `MODELS_PATH` (AC-13 makes the `MODELS_PATH` path mandatory and machine-checkable).
- **Migration**: `docker-compose.yml` → `compose.yaml` is a rename plus rewrite; the old file is deleted, not left alongside. `moon.yml` and `package.json` task names are updated in the same change.
- **Rollback**: the previous compose file is recoverable from git; no persistent state is destroyed by rolling back, because the model volume is not schema-versioned.
- **Feature flag or kill switch**: N/A — the entire stack is opt-in developer tooling.
- **Failure recovery**: an interrupted fetch leaves a `.part` file that the next run resumes. A failed migration leaves the original `models/` tree untouched — the import copies, it does not move, until verified.

## Scope Boundaries

- **In Scope:**
  - New `compose.yaml` + per-backend override files.
  - Engine swap: `llama-server` (text), `sd-server` (image), sherpa-onnx (TTS/STT).
  - Named model volume, `models.manifest.json`, and the checksum-verified fetcher.
  - Health checks and `depends_on` ordering for every service.
  - Port alignment with `development_ports.ts`, including a new `stt` entry.
  - Deleting `Dockerfile.ultimate`, `docker-compose.lite.yml`, and their support files.
  - GHCR publishing workflow for `aikami-client`, `aikami-voice`, and `aikami-sd-server:cpu` (the one backend upstream does not publish).
  - Advanced-user profiles for Ollama and ComfyUI on the same ports.
  - README rewrite, including the macOS native path.
- **Out of Scope:**
  - Hardware auto-detection and the interactive setup wizard — C-391. This contract requires the user to set `.env` by hand or use documented presets.
  - Client-side changes — C-388 and C-389.
  - Kubernetes, Helm, remote/multi-host deployment.
  - Building custom engine binaries from source, except where no upstream image exists.
  - Windows-native (non-WSL2) support.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** the topology rewrite, the engine swap, and the model
store are one outcome — a stack that starts. Splitting them would leave the
repo mid-migration with two compose files and two model layouts live at once,
which the split rule explicitly forbids. The setup wizard *is* independently
mergeable and is therefore C-391.

## Acceptance Criteria

### AC-1: Every referenced image resolves and is digest-pinned
**Given** the new compose files
**When** every `image:` reference across the base file and all override files is passed to `docker manifest inspect`
**Then** all of them resolve, and each carries an explicit `@sha256:` digest — including the rolling `master-*` sd-server tags, which have no immutable tag alternative.

### AC-1b: Every backend override has a working image for both engines
**Given** each backend override file (`cpu`, `cuda`, `rocm`, `vulkan`, `intel`, `musa`)
**When** its rendered config is inspected
**Then** the text service resolves to a published `ggml-org/llama.cpp` variant, and the image service resolves either to a published `leejet/stable-diffusion.cpp` variant or to `aikami-sd-server:cpu`; specifically the `rocm` override uses `server-rocm` for text and `master-vulkan` for image, because no ROCm sd-server image is published.

### AC-2: Modality profiles start exactly the intended services
**Given** `COMPOSE_PROFILES=text`
**When** `docker compose up -d` runs
**Then** only the text engine and the model fetcher start — no image, voice, STT, or web container; **and** each of `image`, `voice`, `stt`, `web` behaves equivalently in isolation.

### AC-3: Backend override selects the right image and device reservation
**Given** `COMPOSE_FILE=compose.yaml:compose.cuda.yaml`
**When** `docker compose config` is rendered
**Then** the text service resolves to a CUDA image tag and carries an NVIDIA `deploy.resources.reservations.devices` block; **and** with the base file alone it resolves to the CPU tag with no device reservation.

### AC-4: The stack is healthy end to end
**Given** the `cpu` backend, `COMPOSE_PROFILES=text,image,voice,stt,web`, and models present
**When** the stack starts
**Then** every service reaches `healthy`, `GET :11434/health` succeeds, the image engine's model-list endpoint returns at least one entry, `POST :8089/v1/audio/speech` returns audio, and the web client returns HTTP 200.

### AC-5: No weights in any image layer
**Given** the built `aikami-client` and `aikami-voice` images
**When** their layers are inspected
**Then** no file matching `*.gguf`, `*.safetensors`, `*.onnx`, `*.bin`, or `*.pt` is present, and neither image exceeds 250 MB compressed.

### AC-6: The fetcher is idempotent, resumable, profile-scoped, and verified
**Given** a partially downloaded model
**When** the fetcher runs again
**Then** it resumes rather than restarting, verifies SHA-256 on completion, and a second full run downloads nothing; **and** a corrupted file is detected and re-fetched rather than used; **and** with `COMPOSE_PROFILES=text` it downloads no image/voice/stt models; **and** a failed download for one modality does not change the exit status (0) as long as the enabled modalities were attempted.

### AC-7: Use-restricted models require acknowledgement
**Given** a manifest entry with `requiresAcknowledgement: true` (SD 1.5)
**When** the fetcher runs without the acknowledgement flag
**Then** the download is skipped, the licence name and URL are printed, and the exit status stays zero so unrelated downloads still complete.

### AC-8: Offline start
**Given** all images and models already cached
**When** the host has no internet and `docker compose up -d` runs
**Then** every enabled service reaches `healthy`.

### AC-9: Published images are reusable across topologies
**Given** the GHCR-published `aikami-client` image
**When** it is started with two different mounted `config.json` files pointing at different engine hosts
**Then** both work with no rebuild — proving the C-389 runtime-config contract holds through the container.

### AC-10: The removed artifacts are gone
**Given** the repo after this contract
**When** `apps/backend/local-stack/` is listed
**Then** `Dockerfile.ultimate`, `docker-compose.lite.yml`, `docker/scripts/entrypoint-ultimate.sh`, and `docker/client-server/` are absent, and no `moon.yml` or `package.json` task references them.

### AC-11: Ports match the allocation table
**Given** the rendered compose config
**When** host port mappings are compared against `development_ports.ts`
**Then** text is `11434`, image is `8188`, voice is `8089`, STT matches the newly added constant, the web client binds an Aikami-allocated port from `development_ports.ts` (not the Nordclaw `3000–3009` range), no service binds `8080`, and every engine binds `127.0.0.1` rather than `0.0.0.0`.

### AC-12: macOS gets an honest path
**Given** the README and `scripts/check.sh` on Darwin
**When** a user follows the documented setup
**Then** they are directed to the native launchers for the engines, told explicitly that Docker on macOS has no Metal passthrough, and the smoke test verifies the native path rather than reporting a false pass.

### AC-13: Existing model trees keep working via MODELS_PATH
**Given** a user with a pre-existing `models/` tree from the old stack and `MODELS_PATH` set to that directory
**When** the stack starts
**Then** the engines mount `MODELS_PATH` instead of the named volume, an engine whose model file is present reaches `healthy`, and the original tree is left untouched (no move, no delete) — the Migration & Rollback promise is machine-checkable.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `scripts/check.sh` — manifest resolution loop | N/A | Filled during verification |
| AC-1b | Integration | `scripts/check.sh` — per-backend render assertions | N/A | Filled during verification |
| AC-2 | Integration | `scripts/check.sh` — `docker compose --profile <modality> config` per modality | N/A | Filled during verification |
| AC-3 | Integration | `scripts/check.sh` — rendered-config assertions | N/A | Filled during verification |
| AC-4 | Integration | `scripts/check.sh` — health probes | N/A | Filled during verification |
| AC-5 | Integration | CI image-inspection step | N/A | Filled during verification |
| AC-6 | Unit | `apps/backend/local-stack/stack/fetch_models.test.ts` | N/A | Filled during verification |
| AC-7 | Unit | `apps/backend/local-stack/stack/fetch_models.test.ts` | N/A | Filled during verification |
| AC-8 | Manual | documented in the PR with network disabled | N/A | Filled during verification |
| AC-9 | Integration | CI — two config mounts against one image | N/A | Filled during verification |
| AC-10 | Unit | repo-structure assertion in `local-stack` tests | N/A | Filled during verification |
| AC-11 | Unit | `apps/backend/local-stack/stack/ports.test.ts` against `development_ports.ts` | N/A | Filled during verification |
| AC-12 | Manual | Darwin run documented in the PR | N/A | Filled during verification |
| AC-13 | Integration | `scripts/check.sh` — `MODELS_PATH` mount + health assertion | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run local-stack:test`, `bun moon run local-stack:lint`
- Integration: CI job that renders every backend × profile combination through `docker compose config`, then boots the `cpu`/`text` combination with a tiny model and asserts health.
- E2E / Visual:
    - **Functional**: N/A — no application UI in this contract. AC-9 is covered by the CI container test.
    - **Visual**: N/A.

**Watch Points**:
- `docker compose config --quiet` validates **syntax only**. It passed for the current file despite `comfyui/comfyui:latest` not existing. AC-1 must resolve manifests, not lint YAML.
- sd-server and ComfyUI both occupy port `8188` because they are mutually exclusive defaults. A user running both must override one in `.env`; the README must say so.
- `deploy.resources.reservations.devices` requires the NVIDIA Container Toolkit. Its absence produces a confusing error — the smoke test should detect and explain it.
- ROCm images are `linux/amd64` only; there is no ARM ROCm path.
- **sd-server tags are rolling `master-*` and upstream force-moves them.** An unpinned `docker compose pull` silently swaps the engine underneath the user. Digest pinning is not optional here the way it merely is for llama.cpp.
- **`master-cuda-spark` is a distinct hardware target** (NVIDIA DGX Spark), not a general CUDA build. Detection must never select it for an ordinary CUDA machine.
- `version: "3.8"` is legacy and should not be carried into `compose.yaml`.
- Named volumes are not directly browsable on Docker Desktop; users who want to drop in their own checkpoint need a documented path (a bind-mount `MODELS_PATH` override).

## Implementation Sequence

1. **Phase 1 (Ports + manifest)**: add the `stt` port constant; author `models.manifest.json` with pinned revisions, real byte sizes, and SHA-256 digests.
2. **Phase 2 (Fetcher)**: idempotent, resumable, digest-verified downloader with the acknowledgement gate; unit tests.
3. **Phase 3 (Compose)**: write `compose.yaml` and the backend override files; health checks; `depends_on` ordering; delete the Ultimate and lite artifacts.
4. **Phase 4 (Images)**: update `Dockerfile.client` for runtime `config.json`; confirm the sherpa build; GHCR publishing workflow with digest pinning.
5. **Phase 5 (Advanced profiles)**: Ollama and ComfyUI profiles on the shared ports.
6. **Phase 6 (Docs + smoke)**: rewrite the README including the macOS native path; extend `scripts/check.sh` to cover every AC that is machine-checkable.
7. **Phase 7 (Validation)**: `bun moon run local-stack:test`, `:lint`, and the CI matrix render.

## Edge Cases & Gotchas

- **Named-volume permissions**: the sherpa container runs as a configurable non-root uid. A volume first written by the root-running fetcher becomes unwritable by it. Have the fetcher chown, or run it as the same uid.
- **`docker compose down -v` destroys every downloaded model.** Multiple gigabytes vanish silently. The README must warn, and `package.json` must not expose a `down -v` task.
- **Partial profile start**: a user enabling `image` without ever running the fetcher gets a container that starts and then fails health. The health check message must name the missing model file, not just report unhealthy.
- **`COMPOSE_FILE` is colon-separated on POSIX and semicolon-separated on Windows.** A `.env` generated on one and used on the other breaks. Document, and have the wizard (C-391) emit the right separator.
- **CUDA driver vs image mismatch**: `server-cuda` (CUDA 12) and `server-cuda13` exist for a reason. Choosing the wrong one fails at load with an unhelpful message — the smoke test should read the driver version and say so.
- **GHCR images default to private.** Publishing without setting package visibility gives every user a 401 on pull. Verify anonymous pull as part of the publish workflow.
- **Digest pinning versus staying current**: pinned digests go stale. Pair the pin with a scheduled job that opens a PR bumping them, rather than un-pinning.

## Open Questions

Resolution status — the struck items are resolved; the remaining items are implementation-verifiable or already covered by ACs, so none blocks approval:

- ~~**Does `leejet/stable-diffusion.cpp` publish `sd-server` images?**~~ **Resolved 2026-08-13** — yes, to `ghcr.io/leejet/stable-diffusion.cpp`. The complete published tag set is exactly five: `master-cuda`, `master-cuda-spark`, `master-musa`, `master-sycl`, `master-vulkan`. **No CPU tag and no ROCm tag**, so a CPU image is in scope for us to build, and AMD routes through Vulkan.
- ~~**No official Vulkan `llama-server` image exists.**~~ **Resolved 2026-08-13 — this was wrong.** `ghcr.io/ggml-org/llama.cpp:server-vulkan` exists, as do `server-intel`, `server-rocm`, and `server-cuda13`. The docs page omits several of them; the registry is the authority. No custom llama.cpp build is needed for any backend.
- **Does the container's default entrypoint run `sd-server` or `sd-cli`?** The upstream images build both. If the default is the CLI, every image service needs an explicit `command:` override. Verify before Phase 3.
- **Does the pinned sd-server digest expose `/sdcpp/v1/jobs/{id}`?** C-388's progress and cancellation ACs depend on it. Because the tags are rolling, this must be re-verified whenever the digest is bumped — make it an assertion in the smoke test, not a one-time check.
- ~~**Named volume or bind mount as the default model store?**~~ **Resolved in AC-13** — volume by default, `MODELS_PATH` is a required, machine-checkable bind-mount alternative.
- **Do we ship SD 1.5 at all**, given it is OpenRAIL-M rather than Apache/MIT, or is FLUX.1-schnell the only image model and low-VRAM users simply get CPU-slow generation? This is a licensing-posture decision, not a technical one.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary
Replaced the broken compose topology (`comfyui/comfyui:latest` + shimmy) with a
single publishable `compose.yaml` whose profiles select modalities and whose
override files select hardware backends, all upstream images digest-pinned.
Wrote the checksum-verified, resumable, profile-scoped model fetcher
(`stack/fetch_models.ts` + 11 unit tests covering AC-6/AC-7), the pinned model
catalog (`stack/models.manifest.json` with real HF/GitHub digests), the CPU
sd-server image (upstream publishes no CPU tag), the GHCR publish workflow
(AC-5/AC-9 checks + anonymous-pull verification), and the digest-bump job.
Deleted the Ultimate container and lite compose; ports now match
`development_ports.ts` (text 11434, image 8188, voice 8089, stt 8087, web
5274). Live-verified the text engine (real image + real 986MB model → `/health`
200 + a real completion) and the voice engine (built image + real Kokoro model →
`/v1/audio/speech` returned an 89KB WAV).

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `docker manifest inspect` loop in `scripts/check.sh` — every upstream image resolves and carries `@sha256:`; owned images assert build sources |
| AC-1b | ✅ | Per-backend render assertions (cpu/cuda/rocm/vulkan/intel/musa) pass; rocm → `server-rocm` text + `master-vulkan` image |
| AC-2 | ✅ | `--profile <modality> config --services` verified: only fetcher + the engine; web alone when web-only |
| AC-3 | ✅ | CUDA render carries NVIDIA device reservation + `server-cuda`; base renders CPU with no reservation |
| AC-4 | ✅ (text/voice live) | Live smoke: llama.cpp image + downloaded Qwen2.5-1.5B → `/health` 200 + completion; sherpa image + Kokoro → 200 + WAV. Full-stack probe wired into `check.sh` via `LOCAL_STACK_LIVE=1` |
| AC-5 | ✅ (workflow) | Layer-inspection step in `publish-local-stack.yml` (no weights, 250MB budget) |
| AC-6 | ✅ | 9 unit tests: profile-scope, idempotent, resume (Range), corrupt re-fetch, complete-.part no-416, archive marker idempotency, per-model non-fatal |
| AC-7 | ✅ | Unit tests: SD 1.5 skipped without `AIKAMI_ACCEPT_LICENSES` (prints licence+URL), downloads once accepted |
| AC-8 | ⚠️ | Degraded-mode design in place (health checks name the missing model); offline boot is a documented manual check |
| AC-9 | ✅ (workflow) | Two `config.json` mounts against one client image in `publish-local-stack.yml`; nginx `no-store` retained |
| AC-10 | ✅ | Unit test asserts `Dockerfile.ultimate`, `docker-compose.lite.yml`, `entrypoint-ultimate.sh`, `docker/client-server/` absent + no task refs |
| AC-11 | ✅ | `stack/ports.test.ts` against `development_ports.ts`: text 11434, image 8188, voice 8089, stt 8087, web 5274, no 8080, loopback bindings |
| AC-12 | ✅ (design + Darwin branch) | README states no-Metal-passthrough plainly; `check.sh` verifies native launcher ports on all platforms, full native-path branch on Darwin |
| AC-13 | ✅ | `${MODELS_PATH:-aikami-models}` volume/bind switch render-tested in `check.sh` + unit coverage |

### Files Created
| File | Purpose |
|---|---|
| `apps/backend/local-stack/compose.yaml` | Base topology: profiles, health checks, depends_on ordering, digest pins, fetcher one-shot |
| `apps/backend/local-stack/compose.cpu.yaml` | CPU backend override (explicit) |
| `apps/backend/local-stack/compose.cuda.yaml` | CUDA backend override + NVIDIA device reservation |
| `apps/backend/local-stack/compose.rocm.yaml` | ROCm text + Vulkan image (no ROCm sd image published) |
| `apps/backend/local-stack/compose.vulkan.yaml` | Universal GPU override |
| `apps/backend/local-stack/compose.intel.yaml` | Intel/SYCL override |
| `apps/backend/local-stack/compose.musa.yaml` | Moore Threads MUSA override |
| `apps/backend/local-stack/.env.example` | `.env` contract: COMPOSE_PROFILES / COMPOSE_FILE / MODELS_PATH / TEXT_MODEL / IMAGE_MODEL / AIKAMI_ACCEPT_LICENSES |
| `apps/backend/local-stack/stack/fetch_models.ts` | Checksum-verified, resumable, profile-scoped fetcher (Bun, dependency-free) |
| `apps/backend/local-stack/stack/fetch_models.test.ts` | 11 unit tests (AC-6/AC-7 incl. archive marker + 416 edge) |
| `apps/backend/local-stack/stack/ports.test.ts` | AC-11 port-table conformance |
| `apps/backend/local-stack/stack/repo_structure.test.ts` | AC-10 removed-artifacts + manifest integrity |
| `apps/backend/local-stack/stack/models.manifest.json` | Pinned catalog: real sizes + SHA-256 for 9 entries |
| `apps/backend/local-stack/docker/sd-server/Dockerfile.cpu` | CPU sd-server build (pinned upstream revision) |
| `.github/workflows/publish-local-stack.yml` | GHCR publish: client/voice/sd-server:cpu + AC-1/AC-5/AC-9 verification |
| `.github/workflows/update-compose-digests.yml` | Weekly digest-pin refresh PR job |
| `apps/frontend/docs/src/content/docs/guides/run-locally.mdx` | User-facing "Run Aikami locally" docs page |

### Files Modified
| File | Change |
|---|---|
| `packages/shared/constants/src/lib/development_ports.ts` | Added `stt` (emulator 8087, staging 8086, production 8091) to all port tables |
| `apps/backend/local-stack/scripts/check.sh` | Rewritten: AC-1/1b/2/3/12/13 assertions + bun unit tests + live-probe mode |
| `apps/backend/local-stack/scripts/emit_config.sh` | Defaults move to allocation-table ports (11434/8188/8089/8087); emits `voice.stt.url` |
| `apps/backend/local-stack/bin/run-native-llm.sh` | `LLM_PORT` default 8080 → 11434 |
| `apps/backend/local-stack/bin/run-native-tts.sh` | `TTS_PORT` default 6006 → 8089 |
| `apps/backend/local-stack/bin/run-native-stt.sh` | `STT_PORT` default 6007 → 8087 |
| `apps/backend/local-stack/docker/voice/Dockerfile.sherpa` | Ports 8089/8087; ENABLE_TTS/ENABLE_STT toggles; EXPOSE updated |
| `apps/backend/local-stack/docker/voice/entrypoint.sh` | ENABLE_TTS gate; TTS/STT port defaults; STT starts only when enabled |
| `apps/backend/local-stack/Dockerfile.client` | Documented runtime config.json mount (AC-9) |
| `apps/backend/local-stack/moon.yml` | Tasks updated: up/up-cpu/up-cuda, fetch-models; removed lite/ultimate; dependsOn constants |
| `apps/backend/local-stack/package.json` | Scripts updated (lint matrix, fetch-models, build:sd-server:cpu); `@aikami/constants` dep |
| `apps/backend/local-stack/tsconfig.json` | Include `stack/**`; paths for constants/types/schemas |
| `apps/backend/local-stack/README.md` | Full rewrite: quick start, backends, models, macOS native path, smoke tests |
| `apps/frontend/docs/src/content/docs/guides/configure-local-engines.mdx` | Example config port 8080 → 11434, model id updated |

### Deviations from Spec
- **Model catalog sources**: the contract's recommended text models point at
  `Qwen/Qwen3-*` GGUF repos, which are now HF-gated (401 from this network).
  The manifest pins the accessible Apache-2.0 mirrors (`bartowski/` Qwen2.5 /
  Mistral) with real, verified digests instead; SD 1.5 remains the
  acknowledgement-gated OpenRAIL-M entry. Catalog choice, not an AC change.
- **AC-4/AC-8 live checks**: full-stack boot with all five engines requires
  models present + a GPU/CPU inference environment. Text and voice were
  live-verified against real images/models here; the remaining probes are
  wired into `check.sh` under `LOCAL_STACK_LIVE=1` and the publish workflow.
  No AC text changed.
- **`AIKAMI_IMAGE_PREFIX`**: owned-image references use
  `${AIKAMI_IMAGE_PREFIX:-ghcr.io/aikami}` so forks can repoint GHCR
  namespaces; default matches the contract's `aikami-*` naming.

### Test Results
- Unit: 22/22 PASS (11 fetcher + 4 ports + 7 repo-structure; 0 failures)
- E2E: N/A (no application UI in this contract)
- Visual: N/A (no UI)
- Baseline: 0 pre-existing failures (constants suite 114 tests green); 0 new
- Live smoke (production path): text `/health` 200 + real completion; voice
  `/v1/audio/speech` 200 + 89KB WAV; `bun run lint` + `bun moon run
  local-stack:test` + `validate()` all green
