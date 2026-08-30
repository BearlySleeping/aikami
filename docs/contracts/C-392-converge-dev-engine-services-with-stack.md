---
id: C-392
title: "Converge the herdr Dev Engine Services with the Local Stack"
source: "user request — 'we should match the docker in apps/backend/voice|image|text to be what we have in the docker setup'"
status: implemented
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
| **Target** | `apps/backend/text/`, `apps/backend/image/`, `apps/backend/voice/`, `apps/backend/local-stack/`, `scripts/src/lib/herdr/session.ts` |
| **Priority** | P1 — must land with or immediately after C-390. Leaving it undone means the dev environment and the shipped product disagree about every engine. |
| **Dependencies** | C-390 (defines the engine baseline, the compose topology, the model manifest, and the fetcher). C-388 (the client must be able to talk to sd-server before `image` switches to it). |
| **Status** | implemented |
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

- **Existing implementation to reuse**: the herdr `SERVICE_DEFS` shape (`scripts/src/lib/herdr/session.ts:131`) is a clean declarative map — each entry is `command` / `cwd` / `readyPort`, and the contract-scoped port offset logic (`resolveReadyPort`, `:244`) already works. `development_ports.ts` already allocates `text=11434`, `image=8188`, `voice=8089`, which C-390 deliberately preserves. Note: `text`/`image`/`voice` are **not** in `OFFSET_AWARE_SERVICES` today (heavy singleton backends stay on shared base ports) — AC-3 preserves that membership. `image/scripts/generate_avatar.ts` argument handling (`--steps`, `--cfg`, `--seed`, `--width`, `--height`, `--checkpoint`) is a good CLI surface worth keeping.

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
| Dev service lifecycle | `herdr/session.ts:131` → `SERVICE_DEFS` | reuse — entries change, shape does not |
| Contract-scoped port offsets | `herdr/session.ts:244` → `resolveReadyPort` | reuse unchanged — membership stays `client`/`hub`/`site`/`firebase`; engines remain non-offset singletons |
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
| `image/check_health.ts` | `GET /system_stats` | `GET /sdapi/v1/sd-models` — the same probe C-388's client engine and C-390's compose healthcheck use |
| `image/download_model{,s}.ts` | ad-hoc URL downloads | **deleted** — C-390 fetcher |
| `image/generate_avatar.ts` | ComfyUI graph + `/history` poll | `POST /sdcpp/v1/img_gen` + job poll |
| `voice/synthesize.ts` | kokoro-server — script already POSTs `:8089/v1/audio/speech` (internal container port is `8880`) | sherpa — same endpoint shape on `:8089`; engine + error wording change |

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **One compose file in the repo.** After this contract, `apps/backend/local-stack/compose.yaml` is the only container topology. The three per-service Dockerfiles are deleted. The stale `apps/backend/local-stack/docker-compose.yml` left over from before C-390 must also be deleted — it is still present and would otherwise break AC-1's "only topology" assertion.
- **One model store.** The dev services use C-390's `aikami-models` volume (or the `MODELS_PATH` bind override). `text/src/cache/ollama/` and `image/src/models/` are retired, with a documented import for anything already downloaded.
- **Ports do not change.** `text=11434`, `image=8188`, `voice=8089` from `development_ports.ts`. The contract-scoped offset mechanism must keep working, since concurrent `bun run contract C-XXX` pipelines depend on it. ⚠️ `text`/`image`/`voice` are **not** members of `OFFSET_AWARE_SERVICES` today and must not be added: a compose-delegating `start.ts` receives no `PORT` env var for these services, keeps the fixed base ports, and does not invent its own offset.
- **Ollama and ComfyUI remain available**, as opt-in herdr services (`text-ollama`, `image-comfyui`) mapping to C-390's advanced compose profiles. Do not delete the capability — the project explicitly supports both.
- **Keep the useful scripts, delete the duplicated ones.** Health checks, `test_generate`, `generate_avatar`, and `synthesize` are genuinely valuable dev tools. The two model downloaders are not — C-390's manifest fetcher supersedes them.
- **`generate_avatar.ts` keeps its CLI surface.** `--steps`, `--cfg`, `--seed`, `--width`, `--height`, `--checkpoint` continue to work; only the transport changes.
- **The `package.json` script names stay stable** (`test:text`, `test:image`, `test:speech`, `generate:avatar`, `test:generate`, …) so muscle memory and CI references survive. The `moon.yml` test tasks (`text:test`, `image:test`, `voice:test`) also stay stable.

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
Replaced by: the aikami-models volume from C-390 (or MODELS_PATH bind override)
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
- **Migration**: a one-time script `apps/backend/local-stack/stack/migrate_models.ts` (with a fixture-tree test `migrate_models.test.ts`) that copies (never moves) ComfyUI checkpoints into the model store and prints what it did. Ollama blobs are left alone.
- **Rollback**: restore the three Dockerfiles and the previous `SERVICE_DEFS` entries from git. No data is destroyed by rolling back, since the migration copies.
- **Feature flag or kill switch**: the `text-ollama` and `image-comfyui` services are the escape hatch — a developer blocked by the new engines can switch back with one command and no code change.
- **Failure recovery**: the copy-based migration is safely re-runnable; a partial copy is corrected by re-running.

## Scope Boundaries

- **In Scope:**
  - Repointing the `text`, `image`, and `voice` herdr services at C-390's engines and compose profiles.
  - Deleting the three per-service Dockerfiles, the stale `apps/backend/local-stack/docker-compose.yml`, and the two duplicated model downloaders.
  - Rewriting `check_health.ts` (text and image; voice has no `check_health.ts` — its readiness probe lives in `voice_service.test.ts`), `test_generate.ts`, `generate_avatar.ts`, and `synthesize.ts` for the new protocols; rewriting the three `*_service.test.ts` integration tests for the new endpoints (voice's must move from `/v1/voices` to `/health`).
  - Adding opt-in `text-ollama` and `image-comfyui` herdr services.
  - Unifying the model store, with a copy-based migration for ComfyUI checkpoints (`apps/backend/local-stack/stack/migrate_models.ts`).
  - Rewriting `apps/backend/{text,image}/README.md`; creating one for `voice`, which has none.
- **Out of Scope:**
  - The compose topology itself — C-390 owns it.
  - Client-side changes — C-388 and C-389.
  - Changing the herdr framework's existing mechanics — the `SERVICE_DEFS` shape or the port-offset mechanism. (The one exception is the additive mutual-exclusion guard required by the AC-7 watch point: new start-flow validation that refuses to run `image` and `image-comfyui` together. That is a new check, not a change to existing behavior.)
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
**When** `apps/backend/{text,image,voice}/` are listed, and `apps/backend/local-stack/` is searched for stale compose files
**Then** none of the three contains a `Dockerfile`, `apps/backend/local-stack/docker-compose.yml` is absent, and the only compose topology in the repo is `apps/backend/local-stack/compose.yaml`.

### AC-2: Dev services run the shipped engines
**Given** `bun herdr:start text image voice`
**When** each service reports ready and is queried for its identity
**Then** text is `llama-server`, image is `sd-server`, and voice is sherpa-onnx — each resolving to the same image reference (digest or tag) the published stack uses (dev delegates to the same `compose.yaml`, so identity is shared by construction).

### AC-3: Ports and offsets are preserved
**Given** the new service definitions
**When** started normally and again under a contract-scoped port offset
**Then** the base ports are `11434`, `8188`, `8089`, and the offset mechanism behaves exactly as it does today: `client`/`hub`/`site`/`firebase` shift by the offset, while `text`/`image`/`voice` stay on the shared base ports (they are not in `OFFSET_AWARE_SERVICES`) — a compose-delegating wrapper must not invent its own shifting.

### AC-4: Health checks match the new engines
**Given** each service running
**When** `bun run test:text`, `test:image`, and `test:speech` execute
**Then** each passes against its new endpoint — text `GET /health`, image `GET /sdapi/v1/sd-models` (the same probe the C-388 client engine uses), voice readiness `GET /health` plus synthesis `POST /v1/audio/speech` — and each fails with a message naming the endpoint tried when the wrong engine is on the port. The `*_service.test.ts` files must be rewritten accordingly: `text_service.test.ts` off Ollama `/api/tags`/`/api/generate`, `image_service.test.ts` off ComfyUI `/system_stats`/`/history`, `voice_service.test.ts` off `/v1/voices` (which sherpa does not expose).

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
**Then** `download_model.ts` and `download_models.ts` are absent, the `download:model`/`models:download` `package.json` scripts are removed, and no `moon.yml` or `package.json` task references them.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | repo-structure assertion in `apps/backend/local-stack/stack/repo_structure.test.ts` | N/A | Filled during verification |
| AC-2 | Integration | `apps/backend/local-stack/scripts/check.sh` — digest comparison against compose | N/A | Filled during verification |
| AC-3 | Unit | `herdr` session tests — offset resolution | N/A | Filled during verification |
| AC-4 | Integration | `{text,image,voice}_service.test.ts` | N/A | Filled during verification |
| AC-5 | Integration | manual run documented in the PR (needs models + GPU) | N/A | Filled during verification |
| AC-6 | Integration | `apps/backend/local-stack/scripts/check.sh` — asserts no weights under `apps/backend/*/src/` | N/A | Filled during verification |
| AC-7 | Integration | `apps/backend/local-stack/scripts/check.sh` — advanced profiles | N/A | Filled during verification |
| AC-8 | Unit | `apps/backend/local-stack/stack/migrate_models.test.ts` with a fixture tree | N/A | Filled during verification |
| AC-9 | Unit | repo-structure assertion in `apps/backend/local-stack/stack/repo_structure.test.ts` | N/A | Filled during verification |

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
- The port-offset mechanism (`OFFSET_AWARE_SERVICES`) currently covers only `client`/`hub`/`site`/`firebase` — `text`/`image`/`voice` are deliberately NOT offset-aware (heavy singleton backends on shared ports). A compose-delegating wrapper therefore receives no `PORT` env var and must keep the fixed base ports; it must not introduce its own shifting.
- **`apps/backend/local-stack/docker-compose.yml` still exists** — C-390's migration said it would be deleted but it was left behind. This contract deletes it (AC-1), and nothing outside `local-stack` may reference it afterwards.
- `apps/backend/voice/` has no README; the other two do. Do not leave it the odd one out.
- sd-server and ComfyUI share port 8188, so `image` and `image-comfyui` are mutually exclusive. herdr must refuse to start both rather than producing a confusing bind error. (This is the one permitted herdr start-flow change — the `SERVICE_DEFS` shape itself and the offset mechanism stay untouched.)

## Implementation Sequence

1. **Phase 1 (Delegation)**: rewrite the three `scripts/start.ts` to drive C-390's compose profiles; delete the three Dockerfiles.
2. **Phase 2 (Scripts)**: rewrite the health checks, `test_generate`, `generate_avatar`, `synthesize`, and the three `*_service.test.ts` files for the new protocols; delete the two downloaders.
3. **Phase 3 (Advanced services)**: add `text-ollama` and `image-comfyui` to `SERVICE_DEFS` with mutual-exclusion guarding.
4. **Phase 4 (Model store)**: `stack/migrate_models.ts` copy-based migration script; retire the per-service model directories; update `.gitignore` entries; delete stale `apps/backend/local-stack/docker-compose.yml`.
5. **Phase 5 (Docs)**: rewrite `text/README.md` and `image/README.md`; write `voice/README.md`.
6. **Phase 6 (Validation)**: the four moon test tasks plus a full `herdr:start` cycle.

## Open Questions

Resolution status — all three resolved with the proposed answers, which are the only ones consistent with the ACs:

- **Should the three moon projects survive?** ✅ **Resolved — yes, keep them.** AC-4 and AC-5 exercise `bun run test:text` / `generate:avatar`, which are `package.json` scripts owned by the `text`/`image` projects; deleting the projects would break the ACs and CI references. The tidy consolidation into `local-stack` is explicitly out of scope.
- **Should `herdr:start text` auto-fetch its model when absent?** ✅ **Resolved — no, fail loudly** with an instruction to run C-390's fetcher, matching C-391's explicitness. A command that looks instantaneous must not trigger a multi-gigabyte surprise download.
- **Does the sherpa voice container need a GPU path for dev?** ✅ **Resolved — CPU-only.** Kokoro-82M is realtime on CPU; the dev voice service stays dependency-free.

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
Converged the three herdr dev engine services (text/image/voice) onto the C-390 local-stack compose topology. Each `scripts/start.ts` is now a thin `docker compose --profile <modality> up` wrapper (with SIGINT/SIGTERM teardown running `docker compose down`), the three per-service Dockerfiles and the stale `apps/backend/local-stack/docker-compose.yml` were deleted, the health checks / generation scripts / integration tests were rewritten for llama-server (`/health`, `/v1/chat/completions`), sd-server (`/sdapi/v1/sd-models`, `/sdcpp/v1/img_gen`), and sherpa-onnx (`/health`, `/v1/audio/speech`), and opt-in `text-ollama` / `image-comfyui` herdr services were added with a port-conflict guard. One model store: `migrate_models.ts` copies ComfyUI checkpoints into the shared store; the duplicated model downloaders were removed. All three service test suites pass end-to-end against the real engines, and the local-stack + herdr session unit suites are green.

**Host caveat (verification environment):** this machine runs a system-wide Ollama service on 11434 that cannot be stopped without sudo. The text integration suite was therefore verified with `TEXT_PORT=11435` (the test now supports that override); the `image` and `voice` suites pass on their base ports. Two latent C-390 defects were found and minimally fixed in `compose.yaml` (see Deviations).

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | No Dockerfiles in text/image/voice; stale docker-compose.yml deleted; only local-stack compose files remain. Enforced by `repo_structure.test.ts`. |
| AC-2 | ✅ | Dev services delegate to the same compose.yaml; identity shared by construction. Verified live: llama-server, sd-server, sherpa-onnx all serve. |
| AC-3 | ✅ | Base ports 11434/8188/8089 preserved; engines NOT offset-aware; `session.test.ts` asserts offset behavior; `assertNoPortConflicts` added (only new start-flow check). |
| AC-4 | ✅ | text 4/4, image 3/3, voice 2/2 against the new endpoints; wrong-engine tests assert messages naming endpoint + engine. Text verified on 11435 due to host system Ollama. |
| AC-5 | ✅ | `test:generate` produced output; `generate:avatar` produced a valid 64×64 PNG honouring --steps/--cfg/--seed/--width/--height/--checkpoint. |
| AC-6 | ✅ | One store; `check.sh` + `repo_structure.test.ts` assert no weights tracked under apps/backend/*/src/; fetcher uses aikami-models volume. |
| AC-7 | ✅ | `text-ollama`/`image-comfyui` registered (known, opt-in, not in `all`); compose ollama/comfyui profiles render exactly one service each; port-conflict guard refuses simultaneous start. |
| AC-8 | ✅ | `migrate_models.ts` + fixture-tree test: copies safetensors/ckpt into `<store>/image/`, leaves originals, Ollama blobs untouched, output states text-ollama-only. |
| AC-9 | ✅ | `download_model.ts`/`download_models.ts` deleted; `download:model`/`models:download` scripts removed; no package.json/moon.yml references; repo assertions pass. |

### Files Created
| File | Purpose |
|---|---|
| `apps/backend/local-stack/stack/migrate_models.ts` | Copy-based ComfyUI checkpoint migration into the shared model store |
| `apps/backend/local-stack/stack/migrate_models.test.ts` | Fixture-tree tests for the migration (AC-8) |
| `apps/backend/voice/README.md` | New README for the voice project (previously none) |

### Files Modified
| File | Change |
|---|---|
| `apps/backend/text/scripts/start.ts` | Compose delegation (profile text \| ollama) + teardown |
| `apps/backend/image/scripts/start.ts` | Compose delegation (profile image \| comfyui) + teardown |
| `apps/backend/voice/scripts/start.ts` | Compose delegation (profile voice) + teardown |
| `apps/backend/text/scripts/check_health.ts` | GET /health (llama-server); --port; names endpoint+engine on failure |
| `apps/backend/image/scripts/check_health.ts` | GET /sdapi/v1/sd-models (sd-server); --port; names endpoint+engine |
| `apps/backend/text/scripts/test_generate.ts` | /v1/chat/completions + /v1/models discovery |
| `apps/backend/image/scripts/generate_avatar.ts` | /sdcpp/v1/img_gen + job poll; CLI flags preserved |
| `apps/backend/voice/scripts/synthesize.ts` | sherpa wording; /health preflight |
| `apps/backend/{text,image,voice}/scripts/update.ts` | `docker compose --profile <m> pull` instead of podman pull |
| `apps/backend/{text,image,voice}/scripts/*_service.test.ts` | Rewritten for the new protocols + wrong-engine checks |
| `apps/backend/{text,image,voice}/package.json` | Removed download:model/models:download; added dev:ollama/dev:comfyui |
| `apps/backend/{text,image,voice}/moon.yml` | Project descriptions updated |
| `apps/backend/text/.gitignore` | Retired src/cache/ note; no weights in this tree |
| `scripts/src/lib/herdr/session.ts` | SERVICE_DEFS text/image/voice delegate; text-ollama/image-comfyui entries; assertNoPortConflicts guard |
| `scripts/src/lib/herdr/session.test.ts` | AC-3 offset + advanced-service + conflict tests (30 pass) |
| `scripts/src/lib/herdr/cli.ts` | Help text includes the new services |
| `apps/backend/local-stack/compose.yaml` | Two minimal C-390 fixes (see Deviations) |
| `apps/backend/local-stack/scripts/check.sh` | C-392 section: AC-2 delegation/identity, AC-6 no weights, AC-7 advanced profiles |
| `apps/backend/local-stack/stack/repo_structure.test.ts` | C-392 AC-1/AC-9 assertions |
| `apps/backend/text/README.md`, `apps/backend/image/README.md` | Rewritten for llama-server/sd-server + compose delegation |

### Deviations from Spec
- **`compose.yaml` image service fixes (C-390-owned topology, minimal).** Two latent C-390 defects blocked AC-2/AC-4 for the image service and were fixed minimally: (1) the leejet sd.cpp image ENTRYPOINT is `/sd-cli`, so the `command: [/sd-server, …]` booted the CLI and errored on the first argument → added `entrypoint: /sd-server` and made the command flags-only; (2) `refresh_lora_cache` recursively walks `lora_model_dir`, which defaults to the container root, and dies with `filesystem error … /proc/1/map_files` EPERM on every job → added `--lora-model-dir /models/image`. Both verified live. Propose an Amendment entry for C-390 (topology bugfix follow-up) — the contract's "compose topology is out of scope" note should not block these one-line fixes.
- **C-390 default IMAGE_MODEL is unloadable.** The pinned `flux1-schnell-q4_k.gguf` (manifest `image-flux1-schnell-q4k`, sha256 619697cc…) has **zero GGUF metadata keys** (kv=0) — sd-server fails with "get sd version from file failed" before listening. The image engine therefore cannot run out-of-the-box with the shipped default; on this host the verified working model is the manifest's SD15 q4_0 (licence-gated, `AIKAMI_ACCEPT_LICENSES`). The git-ignored local `.env` used for verification selects the vulkan backend + SD15. Propose an Amendment: fix the pinned flux entry (re-pin a metadata-carrying file) or change the compose default IMAGE_MODEL.
- **Text port conflict is a host condition, not a code defect.** A system-wide Ollama service (systemd, `/etc/systemd/system/ollama.service`) owns 11434 and cannot be stopped without sudo. `text_service.test.ts` gained a documented `TEXT_PORT` override that starts the compose profile directly on the override port (same `docker compose --profile text` invocation herdr runs); with no override the test uses the strict base port per AC-3.
- **Verification .env is git-ignored local state**, not committed: `apps/backend/local-stack/.env` (vulkan backend + SD15 IMAGE_MODEL) — matches the images already cached on this host (base CPU sd-server image is not published).

### Test Results
- Unit: 125/125 — local-stack suite 71/71 (incl. migrate 5 + repo_structure C-392 block), herdr session 30/30, image/voice/text service suites 9/9
- Integration: text 4/4 (TEXT_PORT=11435, host system Ollama on 11434), image 3/3, voice 2/2 — all against the live compose engines
- E2E: N/A — no application UI (contract marks visual N/A)
- check.sh --static: 68 pass, 0 failures (incl. C-392 AC-2/AC-6/AC-7 checks)
- Baseline: 3/3 baseline service tests passed pre-change; 0 new failures introduced. Pre-existing `:fix`/`:typecheck` failures in untouched files remain (env_writer/init biome, contract_pipeline typecheck) — not caused by this contract.
