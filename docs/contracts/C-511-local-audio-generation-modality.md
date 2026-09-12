---
id: C-511
title: "Local Audio Generation Modality — Music and Sound Effects"
source: "direct — C-510 deferred audio/video; user request to generate music and sound effects locally"
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-12T00:00:00Z"
---

# Contract C-511: Local Audio Generation Modality — Music and Sound Effects

## Metadata

| Field | Value |
|---|---|
| **Source** | Direct request — local generation for "music, sound effect" assets. C-249 (`completed`) explicitly excluded generation; C-510 deferred this modality. |
| **Target** | `packages/shared/local-ai/` (ACE-Step engine adapter), `packages/shared/schemas/` + `packages/shared/types/` (audio generation options), `apps/backend/local-stack/` (audio profile + manifest + overrides), `packages/shared/constants/` + `scripts/src/lib/herdr/` (service + port), `apps/backend/image/` or the generation app (recipes + CLI) |
| **Type** | full |
| **Priority** | P2 — completes the asset taxonomy (music/sfx/ambient exist as categories but cannot be produced locally) |
| **Dependencies** | C-510 (shared engine client + registry write seam — prerequisite), C-392 (converge dev engine services — `implemented`), C-373 (asset registry — `implemented`), C-395 (R2 publish — `implemented`), C-249 (Music DJ playback — `completed`; this contract only produces audio, it does not play it) |
| **Status** | draft |
| **Promotion** | `—` |
| **Docs Impact** | user-facing → `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx` (extend the C-510 guide with audio) |
| **Contract version** | 2.0.0 |
| **Production Surface** | tooling: `bun run generate:asset music "<prompt>"` and `apps/frontend/client/src/lib/services/assets/audio_asset_resolver.ts` (BGM/SFX/ambient tag resolution) |

## Problem & Baseline Evidence

- **Current behavior — music/SFX cannot be generated at all.** The model manifest contains only `text`, `image`, `tts`, and `stt` modalities (`apps/backend/local-stack/stack/models.manifest.json`); no audio-generation model is declared. `fetch_models.ts` `PROFILE_MODALITY` (`apps/backend/local-stack/stack/fetch_models.ts:71`) has no audio entry, and `compose.yaml` has no audio service/profile. C-249 (`docs/contracts/C-249-music-dj-audio-player.md:136-138`) explicitly places "Music generation/creation" and "Sound effect generation or modification" out of scope — it only plays existing tracks.

- **Current behavior — the categories exist but are empty of local producers.** `ASSET_CATEGORIES` defines `music`, `sfx`, and `ambient` (`packages/shared/constants/src/lib/game_assets.ts:82-102`) with `AUDIO_EXTS`, and the catalog covers them (`packages/shared/schemas/src/lib/catalog/catalog_index.ts:40-55`). Only the CI publish pipeline can populate them; no local generation path exists.

- **Reproduction**:
  1. `rg -i 'audio|music' apps/backend/local-stack/stack/models.manifest.json` → no audio generation entries.
  2. `rg 'music|sfx|ambient' apps/backend/image/scripts` → no generator.
  3. `bun run generate:asset sfx "sword clash"` → no such recipe/engine.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | Shared generation client + recipes | `packages/shared/local-ai/src/lib/` (C-510) |
  | Registry write seam + `local-generated` source | `apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts` (C-510) |
  | Audio tag resolution | `apps/frontend/client/src/lib/services/assets/audio_asset_resolver.ts` |
  | Engine service pattern (add profile + probe) | `scripts/src/lib/herdr/session.ts:261` (`voice`), `packages/shared/constants/src/lib/dev_services.ts` |
  | Model manifest + companions + licence gate | `apps/backend/local-stack/stack/models.manifest.json`, C-391 |
  | Profile-scoped model fetching | `apps/backend/local-stack/stack/fetch_models.ts:71` (`PROFILE_MODALITY`) |
  | GPU backend overrides | `apps/backend/local-stack/compose.{cpu,cuda,rocm,vulkan,intel,musa}.yaml` |
  | Port allocation table | `packages/shared/constants/src/lib/development_ports.ts` (`image`/`voice`/`text`) |
  | Playback + tag registry (consumer) | C-249, `track_registry_service.svelte.ts` |

- **Known gaps**:
  1. No audio-generation engine adapter in the shared client.
  2. No `audio` compose profile, herdr `DevService`, model-fetcher mapping, or port constant.
  3. No `music`/`sfx`/`ambient` recipes.
  4. No audio result normalization (duration, sample rate, container) in `GenerationResult` handling.
  5. No licence/revision provenance for audio models.

- **Baseline tests** (run before starting):
  - `packages/shared/local-ai/src/lib/*.test.ts` (C-510 additions).
  - `apps/backend/local-stack/stack/ports.test.ts`, `stack/fetch_models.test.ts`, `stack/init.test.ts`.
  - `bun moon run local-ai:test`, `bun moon run local-stack:test`.

## User Outcome

After this contract, a developer or agent can run `bun run generate:asset music "calm forest exploration loop"` or `bun run generate:asset sfx "metal gate slam"` against a local engine, and the resulting audio is registered as a `music`/`sfx`/`ambient` asset with `generated:<engine>` provenance and resolved by the game through the audio asset resolver — all offline, with no ComfyUI or Python dependency on the default path.

## Success Measures

- **Time/latency target**: recipe resolution + engine submission within 200 ms of CLI start; longer audio jobs report progress via the shared client's `onProgress` and are cancellable.
- **Offline/degraded behavior**: the audio engine is loopback-only and local; generation and registration require no network or sign-in. The audio profile is opt-in and absent from the shipped default `COMPOSE_PROFILES`.
- **Production journey enabled**: a creator generates a track/effect, it appears in the game via its `music:`/`sfx:`/`ambient:` tag, and the existing Music DJ (C-249) can select it.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Shared generation contract | `packages/shared/local-ai/` (C-510) | modify — add an audio engine adapter + audio request/result fields |
| Registry write seam | `asset_manager.svelte.ts` (C-510) | reuse |
| Audio category/tag/ext helpers | `packages/shared/constants/src/lib/game_assets.ts` | reuse |
| Engine service definition | `scripts/src/lib/herdr/session.ts`, `dev_services.ts` | modify — add `audio` service + identity probe |
| Compose topology | `apps/backend/local-stack/compose.yaml`, `compose.cuda.yaml` and siblings | modify — add an `audio` service/profile + GPU reservation |
| Model manifest | `stack/models.manifest.json`, `stack/fetch_models.ts` | modify — add audio entries + `audio` profile mapping |
| Ports | `packages/shared/constants/src/lib/development_ports.ts` | modify — add `AUDIO_PORT` beside `image`/`voice`/`text` |
| Playback/selection | C-249 `track_registry_service.svelte.ts`, `audio_service.svelte.ts` | do not modify — this contract only produces assets |

## Overview

C-510 made generation engine-agnostic for images and gave generated bytes a registry write path. This contract adds audio as a modality: a new local engine adapter (ACE-Step 1.5 REST for music, with Stable Audio-class support for effects, or ComfyUI hosting the same models when the user has it), an opt-in `audio` compose profile and herdr service, model-manifest entries with licences, and music/sfx/ambient recipes so `generate:asset` can produce them. Generated audio registers through the C-510 seam and resolves through the existing audio asset resolver; playback and selection stay owned by C-249.

## Design Reference

- **Engine pattern**: the C-510 `GenerationEngineClient` — one adapter per engine, capability flags, factory selection. Audio is a second `modality`; do not fork the interface.
- **Service/profile pattern**: mirror `voice` (`scripts/src/lib/herdr/session.ts:261`, `compose.yaml:184`) — opt-in tooling, identity probe, `depends_on: model-fetcher`. Audio inherits the STT precedent of being opt-in and absent from shipped defaults (`README` STT note).
- **Manifest pattern**: `models.manifest.json` entries with `repo`/`revision`/`file`/`targetPath`/`bytes`/`sha256`/`license`/`requiresAcknowledgement`; use `companions` only if a model ships split. See `image-anima-aesthetic-v1.1` for the multi-file shape.
- **Provenance**: `packages/shared/schemas/src/lib/game/asset_provenance.ts` — `source: "generated:<engine>"`.
- **Recipes**: extend the C-510 `AssetRecipe` registry; do not add a parallel config format.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Audio is opt-in.** Do not add `audio` to the shipped `COMPOSE_PROFILES`; a multi-gigabyte Python engine must never start unasked (STT precedent, `README`).
- **Keep the modality engine-independent.** Prefer the audio model's standalone REST server over requiring ComfyUI, so the default path stays Python-free and ComfyUI stays opt-in. ComfyUI hosting the same models is a supported alternative, not the default.
- **One adapter contract.** The audio adapter returns the same `GenerationResult` shape (`bytes`, `mimeType`, duration in `metadata`); image-only fields are invalid for audio and must be rejected by capability validation.
- **Licence honesty.** Every audio model entry pins revision + sha256 + licence; `requiresAcknowledgement` is honoured by the fetcher. A generated asset's provenance records the model id so the publish preflight can gate it.
- **No playback changes.** This contract produces assets only. `audioService`/track registry/ Music DJ are untouched.
- **Size and duration bounds.** Enforce a maximum output size and duration; fail fast rather than filling OPFS.

## State & Data Models

TypeBox schemas in `packages/shared/schemas/`; derived types in `packages/shared/types/`.

```ts
// Extends the C-510 GenerationRequest / GenerationResult for audio.
type AudioGenerationOptions = {
  /** Song/effect structure tags (genre, mood, instrumentation). */
  tags?: string;
  /** Optional lyrics for vocal tracks; empty or absent = instrumental. */
  lyrics?: string;
  /** Target length in seconds. */
  durationSeconds?: number;
  /** Optional musical metadata; engines may infer it. */
  bpm?: number;
  key?: string;
  /** true = effect/one-shot, false = structured music. */
  instrumental?: boolean;
};

type AudioGenerationMetadata = {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  format: 'wav' | 'flac' | 'mp3' | 'ogg';
  bpm?: number;
  key?: string;
};
```

```ts
// Recipe additions (data files, not code).
type AudioAssetRecipe = {
  id: 'music' | 'sfx' | 'ambient';
  category: 'music' | 'sfx' | 'ambient';
  modality: 'audio';
  engine: 'ace-step' | 'comfyui';
  model?: string;
  promptTemplate: string;
  defaults?: Partial<AudioGenerationOptions>;
  output: { ext: 'wav' | 'flac' | 'mp3' | 'ogg' };
  tagTemplate?: string;
};
```

The shared client's `GenerationEngineId` union gains `'ace-step'`; `GenerationModality` already includes `'audio'` (C-510).

## Quality Requirements

- **Offline/degraded mode**: audio generation targets a loopback engine; registration is local. No network dependency. Missing GPU falls back to the CPU/quantized path if the engine supports it, else the profile is unavailable and the CLI fails with a readable message.
- **Accessibility/input**: N/A — CLI/engine only in this contract.
- **Performance budget**: enforce max output bytes (`MAX_UPLOAD_SIZE`, `constants/game_assets.ts:328`) and max duration; stream/download without loading multiple copies into memory.
- **Security/privacy**: loopback by default; never log full prompt-injected lyrics/audio payloads; validate engine URLs (http(s), loopback).
- **Persistence/migration**: no new catalog category; `music`/`sfx`/`ambient` already exist. Generated rows use the C-510 `local-generated` source. The seed derivation revision must not be perturbed.
- **Cancellation/retry/idempotency**: `generate()` accepts an `AbortSignal`; the adapter issues the engine's native cancel where available. Registration is idempotent by sha256 + tag.
- **Observability**: log engine id, model, duration, and output size at debug; never log raw audio.

## Migration & Rollback

- **Old data compatibility**: existing `music`/`sfx`/`ambient` rows and tracks are unaffected. New generated rows are additive. The `ace-step` engine id is config-only.
- **Migration**: adding a manifest entry requires `stack init`/`fetch-models` to download it; existing installs without the `audio` profile are unaffected. `AUDIO_PORT` is new; no collisions given the reserved port table.
- **Rollback**: disable the `audio` profile and `PUBLIC_ASSET_GENERATION`; remove/ignore generated audio rows. No destructive change.
- **Feature flag or kill switch**: `PUBLIC_ASSET_GENERATION` (C-510) plus absence of the `audio` profile.
- **Failure recovery**: registration writes cache bytes then the registry row; on failure, bytes are removed. A rejected model download leaves the stack otherwise functional (fetcher is profile-scoped).

## Scope Boundaries

- **In Scope:**
  - `ace-step` engine adapter in the shared client (+ optional ComfyUI-hosted audio via the existing ComfyUI adapter).
  - Audio request/result/metadata types and capability validation.
  - Opt-in `audio` compose profile + `DevService` + identity probe + `AUDIO_PORT` + `.env.example` keys + GPU overrides.
  - Model-manifest audio entries with licence/revision/sha256.
  - `music`/`sfx`/`ambient` recipes and `generate:asset` support.
  - Generated audio registration through the C-510 seam and resolution via `audio_asset_resolver`.
- **Out of Scope:**
  - Playback, Music DJ selection, crossfade, or track registry changes (C-249 owns these).
  - Vocal cloning / speech synthesis (the voice profile owns speech).
  - Video-modality generation.
  - Training/fine-tuning audio LoRAs.
  - MCP front door and end-user publishing (C-512/C-513 and the deferred MCP work).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — *local audio (music/sfx/ambient) assets can be generated and resolved*. The engine adapter, profile, manifest, recipes, and registration are one vertical slice; splitting them would leave an unusable half (a profile with no adapter, or a generator with no category). Video is deferred; this contract's `modality` and metadata are designed to accept it separately.

## Acceptance Criteria

### AC-1: Audio engine adapter satisfies the shared contract
**Given** the shared `GenerationEngineClient` contract
**When** an audio `GenerationRequest` is generated through the `ace-step` adapter
**Then** it returns a `GenerationResult` with audio `mimeType` and `AudioGenerationMetadata` (duration, sample rate, channels, format), and rejects image-only fields via capability validation.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/local-ai/src/lib/engines/ace_step.test.ts` | `tooling: \`bun run generate:asset music "<prompt>"\`` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run local-ai:test`
- Integration: live ACE-Step REST server
- E2E / Visual: N/A

**Watch Points**:
- Normalize container/sample rate before registration; do not register an unplayable format.

### AC-2: `audio` profile provisions and reports readiness
**Given** the `audio` profile is enabled and models fetched
**When** herdr starts the `audio` service
**Then** it reaches a healthy state recognized by its identity probe, and is absent from the shipped default `COMPOSE_PROFILES`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `apps/backend/local-stack/stack/*.test.ts` + herdr service test | `tooling: \`bun herdr:start audio\`` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run local-stack:test`
- Integration: start the audio profile and probe readiness
- E2E / Visual: N/A

**Watch Points**:
- The identity probe must distinguish the audio engine from image/voice servers if ports are shared; give audio its own `AUDIO_PORT`.

### AC-3: Music and SFX generate and register
**Given** a running audio engine
**When** `bun run generate:asset music "calm forest loop"` and `bun run generate:asset sfx "metal gate slam"` run
**Then** each produces audio bytes plus a catalog-ready `GeneratedAsset` with the correct `music`/`sfx` category, and registering it makes `audio_asset_resolver` resolve the tag offline.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | generation app `generate_asset.test.ts` + resolver test | `apps/frontend/client/src/lib/services/assets/audio_asset_resolver.ts` | Filled during verification |

**Test Hooks**:
- Moon Task: generation app test + `bun moon run client:test`
- Integration: generate → register → resolve with the network down
- E2E / Visual: N/A

**Watch Points**:
- Enforce max size/duration; reject oversized output before registration.
- Regenerating a tag with new bytes must version the row (C-510 trap), never silently repoint existing references.

### AC-4: Licence and provenance recorded
**Given** a generated audio asset
**When** it is inspected before publish
**Then** its provenance records `generated:<engine>` and the model id, and the manifest entry's licence is surfaced by the publish preflight.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `packages/shared/local-ai/src/lib/recipes/*.test.ts` + provenance test | `tooling: \`bun run generate:asset\`` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run local-ai:test`, `bun moon run schemas:test`
- Integration: N/A
- E2E / Visual: N/A

**Watch Points**:
- A licence-required model must not be silently downloadable; `requiresAcknowledgement` is enforced by the fetcher.

## Implementation Sequence

1. **Phase 1 (Types + adapter)**: audio options/metadata types + `ace-step` adapter in the shared client.
2. **Phase 2 (Topology)**: manifest entries, `PROFILE_MODALITY.audio`, compose profile, GPU overrides, `AUDIO_PORT`, herdr `DevService` + probe.
3. **Phase 3 (Recipes + CLI)**: music/sfx/ambient recipes; extend `generate:asset` to audio.
4. **Phase 4 (Registration)**: route generated audio through the C-510 seam; resolver smoke.
5. **Phase 5 (Validation)**: `bun moon run local-ai:test`, `local-stack:test`, `client:test`; live offline generate → register → resolve.

## Edge Cases & Gotchas

- **Opt-in discipline**: never ship `audio` in default profiles; a surprise multi-GB download or GPU grab is worse than a missing feature.
- **Large outputs**: long songs can exceed `MAX_UPLOAD_SIZE`; enforce duration/size caps and a clear error.
- **OPFS quota**: audio grows fast; user-generated audio should be eviction-protected like offline-core assets (C-510/C-512 concern).
- **Model hot-swap**: like sd.cpp, some engines cannot swap models at runtime; a recipe naming a different model must fail fast.
- **Format normalization**: engines differ on container/sample rate; normalize or record exactly what was produced.
- **ComfyUI alternative is GPL/Python**: if a user hosts audio via ComfyUI, the shipped bundle is unaffected, but do not make it the default.

## Open Questions

Must be resolved before status becomes `approved`:

- **Q1 — default audio engine?** Proposed: ACE-Step 1.5 standalone REST (opt-in profile), not ComfyUI. Confirm.
- **Q2 — SFX model?** Proposed: a Stable-Audio-class text-to-audio model via the same adapter family; final choice pinned in the manifest with licence. Confirm.
- **Q3 — one `audio` profile or `music`/`sfx` split?** Proposed: one `audio` profile serving both. Confirm.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
