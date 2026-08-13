---
id: C-392
title: "Converge the herdr Dev Engine Services with the Local Stack"
source: "user request — 'we should match the docker in apps/backend/voice|image|text to be what we have in the docker setup'"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-13"
---

# Contract C-392: Converge the herdr Dev Engine Services with the Local Stack

## Metadata

| Field | Value |
|---|---|
| **Source** | Local-stack engine review, 2026-08-13. C-390 migrates the shipped stack to `llama-server` / `sd-server` / sherpa-onnx. The three herdr-managed dev services still run Ollama, ComfyUI, and `hwdsl2/kokoro-server` — so developers would be testing against engines no user runs. |
| **Target** | `apps/backend/text/`, `apps/backend/image/`, `apps/backend/voice/`, `scripts/src/lib/herdr/session.ts` |
| **Priority** | P1 — must land with or immediately after C-390. Leaving it undone means the dev environment and the shipped product disagree about every engine. |
| **Dependencies** | C-390 (defines the engine baseline, the compose topology, the model manifest, and the fetcher). C-388 (the client must be able to talk to sd-server before `image` switches to it). |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal → `apps/backend/{text,image}/README.md` rewrites; developer setup notes |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **After C-390, the dev environment and the shipped stack run different engines for all three modalities.** Verified current state:

  | Service | Dockerfile (today) | Port | C-390 shipped engine |
  |---|---|---|---|
  | `apps/backend/text` | `FROM ollama/ollama` | 11434 | `llama-server` |
  | `apps/backend/image` | `FROM yanwk/comfyui-boot:cu130-slim-v2` | 8188 | `sd-server` |
  | `apps/backend/voice` | `FROM hwdsl2/kokoro-server:latest` | 8880→8089 | sherpa-onnx |

  A developer running `bun herdr:start image` would exercise the ComfyUI graph
  path while every user of the bundled stack exercises the sd-server path.
  C-388's engine abstraction makes both *work*, but only one of them gets
  tested day to day.

- **All three Dockerfiles are two-line wrappers.** Each is `FROM <upstream>` plus `EXPOSE`, adding nothing. Their real content lives in `scripts/start.ts` (podman run flags) and the sibling scripts.

- **The voice service already has an internal/external port disagreement.** `apps/backend/voice/Dockerfile` exposes 8880 while the herdr service maps `PORTS[mode].voice` = 8089. The C-389 client change removes the 8880 assumption from the client; this contract removes it from the service.

- **The engine-specific scripts encode engine-specific protocols.**
  - `text/scripts/download_model.ts` pulls `qwen3.5:4b` via the **Ollama pull API** — a concept `llama-server` does not have; it takes a GGUF file path.
  - `text/scripts/check_health.ts` hits `/` (Ollama's root banner); `llama-server` exposes `/health`.
  - `image/scripts/check_health.ts` hits `/system_stats` (ComfyUI); sd-server exposes `/v1/models` and `/sdapi/v1/sd-models`.
  - `image/scripts/generate_avatar.ts` submits a **ComfyUI graph** and polls `/history`.
  - `image/scripts/download_models.ts` and `download_model.ts` are two overlapping downloaders, duplicating what C-390's manifest-driven fetcher does properly.

- **Model storage is duplicated three ways.** `text/src/cache/ollama/`, `image/src/models/`, and C-390's `aikami-models` named volume would all hold weights. A developer would download the same model twice.

- **Existing implementation to reuse**: the herdr `SERVICE_DEFS` shape (`scripts/src/lib/herdr/session.ts:115`) is a clean declarative map — each entry is `command` / `cwd` / `readyPort`, and the contract-scoped port offset logic (`resolveReadyPort`, `:210`) already works. `development_ports.ts` already allocates `text=11434`, `image=8188`, `voice=8089`, which C-390 deliberately preserves. `image/scripts/generate_avatar.ts` argument handling (`--steps`, `--cfg`, `--seed`, `--width`, `--height`, `--checkpoint`) is a good CLI surface worth keeping.

- **Known gaps**: no shared model store, no engine-agnostic health check, no way to run the dev service against the same image the user gets.

- **Baseline tests**: `bun moon run text:test`, `image:test`, `voice:test` (each runs a `*_service.test.ts`) must pass before starting.

## User Outcome

After this contract, a **developer** runs `bun herdr:start text image voice`
and gets byte-identical engines to the ones a user gets from the published
stack, sharing one model store — so a bug reproduced locally is a bug the user
actually has.

## Success Measures

- **Time/latency target**: no regression in `herdr:start` time to ready; the sherpa and llama-server images are substantially smaller than the PyTorch images they replace, so cold pull should improve.
- **Offline/degraded behavior**: with images and models cached, all three services start with no network — an improvement over Ollama, which reaches out on pull.
- **Production journey enabled**: the dev loop and the shipped artifact become the same thing, which is what makes the published stack trustworthy.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Dev service lifecycle | `herdr/session.ts:115` → `SERVICE_DEFS` | reuse — entries change, shape does not |
| Contract-scoped port offsets | `herdr/session.ts:210` → `resolveReadyPort` | reuse unchanged |
| Port allocation | `development_ports.ts` | reuse — values are already correct |
| Engine base images | the three `Dockerfile`s | **replace** — delegate to C-390's compose |
| Model download | `text/scripts/download_model.ts`, `image/scripts/download_model{,s}.ts` | **replace** with C-390's manifest fetcher |
| Health checks | `*/scripts/check_health.ts` | modify — new endpoints |
| Avatar generation CLI | `image/scripts/generate_avatar.ts` | modify — keep the flags, swap the protocol |
| Speech smoke test | `voice/scripts/synthesize.ts` | modify — sherpa endpoint |

## Overview

Point the three herdr dev services at the same engines, images, and model
store that C-390 ships, delete the per-service Dockerfiles and downloaders
that duplicate the stack, and rewrite the health checks and smoke scripts for
the new protocols. Ollama and ComfyUI survive as opt-in advanced services
rather than defaults.

## Design Reference

**Delegate, do not duplicate.** The strongest version of this change is that
`apps/backend/{text,image,voice}` stop owning container definitions entirely
and instead drive C-390's compose profiles. Each `scripts/start.ts` becomes a
thin wrapper over `docker compose --profile <modality> up -d` against
`apps/backend/local-stack`, and the two-line Dockerfiles are deleted. The moon
projects survive for what they uniquely provide — health checks, generation
smoke tests, and the avatar CLI — not for container plumbing.

This keeps `bun herdr:start image` working exactly as developers expect while
guaranteeing it cannot drift from what users run: there is only one compose
file in the repo, and both paths use it.

Endpoint changes the scripts must follow:

| Script | Today | After |
|---|---|---|
| `text/check_health.ts` | `GET /` (Ollama banner) | `GET /health` (llama-server) |
| `text/download_model.ts` | Ollama pull `qwen3.5:4b` | **deleted** — C-390 fetcher |
| `text/test_generate.ts` | Ollama generate | `POST /v1/chat/completions` |
| `image/check_health.ts` | `GET /system_stats` | `GET /v1/models` |
| `image/download_model{,s}.ts` | ad-hoc URL downloads | **deleted** — C-390 fetcher |
| `image/generate_avatar.ts` | ComfyUI graph + `/history` poll | `POST /sdcpp/v1/img_gen` + job poll |
| `voice/synthesize.ts` | kokoro-server `:8880` | sherpa `POST /v1/audio/speech` on `:8089` |

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **One compose file in the repo.** After this contract, `apps/backend/local-stack/compose.yaml` is the only container topology. The three per-service Dockerfiles are deleted.
- **One model store.** The dev services use C-390's `aikami-models` volume (or the `MODELS_PATH` bind override). `text/src/cache/ollama/` and `image/src/models/` are retired, with a documented import for anything already downloaded.
- **Ports do not change.** `text=11434`, `image=8188`, `voice=8089` from `development_ports.ts`. The contract-scoped offset mechanism must keep working, since concurrent `bun run contract C-XXX` pipelines depend on it.
- **Ollama and ComfyUI remain available**, as opt-in herdr services (`text-ollama`, `image-comfyui`) mapping to C-390's advanced compose profiles. Do not delete the capability — the project explicitly supports both.
- **Keep the useful scripts, delete the duplicated ones.** Health checks, `test_generate`, `generate_avatar`, and `synthesize` are genuinely valuable dev tools. The two model downloaders are not — C-390's manifest fetcher supersedes them.
- **`generate_avatar.ts` keeps its CLI surface.** `--steps`, `--cfg`, `--seed`, `--width`, `--height`, `--checkpoint` continue to work; only the transport changes.
- **The `moon.yml` task names stay stable** (`test:text`, `test:image`, `generate:avatar`, …) so muscle memory and CI references survive.

## State & Data Models

No new persisted data. The changed surface is the herdr service map:

```ts
/** SERVICE_DEFS entries after this contract. Shape is unchanged. */
type DevEngineService =
  | 'text'           // llama-server   → compose profile "text",  :11434
  | 'image'          // sd-server      → compose profile "image", :8188
  | 'voice'          // sherpa-onnx    → compose profile "voice", :8089
  | 'text-ollama'    // advanced, opt-in, :11434
  | 'image-comfyui'; // advanced, opt-in, :8188
```

```
Retired:  apps/backend/text/src/cache/ollama/
          apps/backend/image/src/models/
Replaces: the aikami-models volume from C-390 (or MODELS_PATH)
```

## Quality Requirements

- **Offline/degraded mode**: all three start from cache with no network.
- **Accessibility/input**: N/A — CLI and containers only.
- **Performance budget**: no regression in time-to-ready versus the current services.
- **Security/privacy**: keep the existing non-root posture; do not reintroduce `--security-opt label=disable` unless the new images actually require it — re-evaluate rather than copying it forward.
- **Persistence/migration**: existing developer model downloads must not be silently orphaned. See Migration.
- **Cancellation/retry/idempotency**: `herdr:start`/`stop` remain idempotent; the compose delegation must not leave orphan containers when herdr is killed.
- **Observability**: health-check failures must name the endpoint tried and the engine expected, so a developer running the wrong engine on the right port gets a comprehensible message.

## Migration & Rollback

- **Old data compatibility**: developers have GGUF and safetensors weights in `text/src/cache/ollama/` and `image/src/models/`. Ollama stores blobs in a content-addressed layout that is **not** directly reusable as GGUF files — an Ollama model cannot simply be moved into the new store. Document this honestly: Ollama-pulled models stay usable via the `text-ollama` service, and the new `text` service downloads its GGUF fresh. ComfyUI checkpoints in `image/src/models/` **are** plain safetensors and can be copied or symlinked into the new store.
- **Migration**: a one-time script that copies (never moves) ComfyUI checkpoints into the model store and prints what it did. Ollama blobs are left alone.
- **Rollback**: restore the three Dockerfiles and the previous `SERVICE_DEFS` entries from git. No data is destroyed by rolling back, since the migration copies.
- **Feature flag or kill switch**: the `text-ollama` and `image-comfyui` services are the escape hatch — a developer blocked by the new engines can switch back with one command and no code change.
- **Failure recovery**: the copy-based migration is safely re-runnable; a partial copy is corrected by re-running.

## Scope Boundaries

- **In Scope:**
  - Repointing the `text`, `image`, and `voice` herdr services at C-390's engines and compose profiles.
  - Deleting the three per-service Dockerfiles and the two duplicated model downloaders.
  - Rewriting `check_health.ts` (×3), `test_generate.ts`, `generate_avatar.ts`, and `synthesize.ts` for the new protocols.
  - Adding opt-in `text-ollama` and `image-comfyui` herdr services.
  - Unifying the model store, with a copy-based migration for ComfyUI checkpoints.
  - Rewriting `apps/backend/{text,image}/README.md`; creating one for `voice`, which has none.
- **Out of Scope:**
  - The compose topology itself — C-390 owns it.
  - Client-side changes — C-388 and C-389.
  - Changing the herdr framework, the `SERVICE_DEFS` shape, or the port-offset mechanism.
  - Adding an STT dev service. C-390 defines the port; the consumer is C-359.
  - Changing port allocations.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** three services, one outcome — the dev environment
matches the shipped stack. Splitting per service would leave the repo with a
half-converged toolchain and two model stores live at once, which the split
rule forbids. It is separated from C-390 because C-390 is independently
mergeable and useful on its own: the published stack works whether or not the
dev services have caught up.

## Acceptance Criteria

### AC-1: No per-service container definitions remain
**Given** the repo after this contract
**When** `apps/backend/{text,image,voice}/` are listed
**Then** none contains a `Dockerfile`, and the only compose topology in the repo is `apps/backend/local-stack/compose.yaml`.

### AC-2: Dev services run the shipped engines
**Given** `bun herdr:start text image voice`
**When** each service reports ready and is queried for its identity
**Then** text is `llama-server`, image is `sd-server`, and voice is sherpa-onnx — each resolving to the same pinned digest the published stack uses.

### AC-3: Ports and offsets are preserved
**Given** the new service definitions
**When** started normally and again under a contract-scoped port offset
**Then** the base ports are `11434`, `8188`, `8089`, and the offset mechanism shifts them exactly as it does today — two concurrent contract pipelines do not collide.

### AC-4: Health checks match the new engines
**Given** each service running
**When** `bun run test:text`, `test:image`, and `test:speech` execute
**Then** each passes against its new endpoint (`/health`, `/v1/models`, `/v1/audio/speech`), and each fails with a message naming the endpoint tried when the wrong engine is on the port.

### AC-5: Generation smoke tests work end to end
**Given** the new engines with models present
**When** `bun run test:generate "Hello!"` and `bun run generate:avatar "an elven ranger, pixel art"` run
**Then** both produce output, and `generate_avatar` still honours `--steps`, `--cfg`, `--seed`, `--width`, `--height`, and `--checkpoint`.

### AC-6: One model store
**Given** the converged services
**When** a model is fetched once via C-390's fetcher
**Then** the dev service uses it without a second download, and no weights are written under `apps/backend/*/src/`.

### AC-7: Advanced engines remain one command away
**Given** `bun herdr:start text-ollama` and `bun herdr:start image-comfyui`
**When** each starts
**Then** Ollama serves on `11434` and ComfyUI on `8188`, and the client (via C-388 auto-detection and C-389 runtime config) works against both without a rebuild.

### AC-8: Migration preserves existing downloads
**Given** a developer with ComfyUI checkpoints in `image/src/models/` and Ollama models in `text/src/cache/ollama/`
**When** the migration script runs
**Then** the ComfyUI checkpoints are **copied** into the shared store and remain in place at their origin, the Ollama blobs are untouched, and the output states plainly that Ollama models remain usable only via `text-ollama`.

### AC-9: Duplicated downloaders are gone
**Given** the repo after this contract
**When** `apps/backend/{text,image}/scripts/` are listed
**Then** `download_model.ts` and `download_models.ts` are absent, and no `moon.yml` or `package.json` task references them.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | repo-structure assertion in `text_service.test.ts` | N/A | Filled during verification |
| AC-2 | Integration | `scripts/check.sh` — digest comparison against compose | N/A | Filled during verification |
| AC-3 | Unit | `herdr` session tests — offset resolution | N/A | Filled during verification |
| AC-4 | Integration | `{text,image,voice}_service.test.ts` | N/A | Filled during verification |
| AC-5 | Integration | manual run documented in the PR (needs models + GPU) | N/A | Filled during verification |
| AC-6 | Integration | `scripts/check.sh` — asserts no weights under `apps/backend/*/src/` | N/A | Filled during verification |
| AC-7 | Integration | `scripts/check.sh` — advanced profiles | N/A | Filled during verification |
| AC-8 | Unit | `migrate_models.test.ts` with a fixture tree | N/A | Filled during verification |
| AC-9 | Unit | repo-structure assertion | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run text:test`, `bun moon run image:test`, `bun moon run voice:test`, `bun moon run local-stack:test`
- Integration: start all three via herdr, run each health check, then run both generation smoke tests.
- E2E / Visual:
    - **Functional**: N/A — no application UI. The client-side equivalent is covered by C-388.
    - **Visual**: N/A.

**Watch Points**:
- **Ollama's content-addressed blob store is not a GGUF directory.** Any migration that assumes a developer's pulled Ollama models can be handed to `llama-server` will silently produce a broken model path. Do not attempt it.
- The `--security-opt label=disable` flag currently used by these services exists for SELinux bind-mount interaction. Whether it is still needed with a named volume must be re-tested, not assumed either way.
- `herdr:start` kills its children on exit; a compose-delegating `start.ts` must ensure `docker compose down` runs on teardown, or containers leak between sessions.
- The port-offset mechanism (`OFFSET_AWARE_SERVICES`) passes `PORT` as an env var into the service command. A compose-delegating wrapper must forward it into the compose port mapping, not just set it in its own environment.
- `apps/backend/voice/` has no README; the other two do. Do not leave it the odd one out.
- sd-server and ComfyUI share port 8188, so `image` and `image-comfyui` are mutually exclusive. herdr must refuse to start both rather than producing a confusing bind error.

## Implementation Sequence

1. **Phase 1 (Delegation)**: rewrite the three `scripts/start.ts` to drive C-390's compose profiles; delete the three Dockerfiles.
2. **Phase 2 (Scripts)**: rewrite the health checks, `test_generate`, `generate_avatar`, and `synthesize` for the new protocols; delete the two downloaders.
3. **Phase 3 (Advanced services)**: add `text-ollama` and `image-comfyui` to `SERVICE_DEFS` with mutual-exclusion guarding.
4. **Phase 4 (Model store)**: copy-based migration script; retire the per-service model directories; update `.gitignore` entries.
5. **Phase 5 (Docs)**: rewrite `text/README.md` and `image/README.md`; write `voice/README.md`.
6. **Phase 6 (Validation)**: the four moon test tasks plus a full `herdr:start` cycle.

## Open Questions

Must be resolved before status becomes `approved`:

- Should the three moon projects survive at all, or should their scripts move into `local-stack` and the projects be deleted? Keeping them preserves `bun herdr:start image` and the existing task names, which is the conservative choice and what this contract assumes. Consolidating into `local-stack` would be tidier but breaks muscle memory and CI references.
- Should `herdr:start text` **auto-fetch** its model when absent, or fail with an instruction to run the fetcher? Auto-fetch is friendlier; failing loudly avoids a surprise multi-gigabyte download from a command that looks instantaneous. C-391 resolved the same question in favour of explicitness — matching that is proposed.
- Does the sherpa voice container need a GPU path for dev, or is CPU sufficient? Kokoro-82M is realtime on CPU, so CPU-only is proposed, keeping the dev voice service dependency-free.

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
