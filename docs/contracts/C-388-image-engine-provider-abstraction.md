---
id: C-388
title: "Image Engine Provider Abstraction (ComfyUI ⇄ sd-server)"
source: "user request — local-stack engine review: 'Can we create a nice abstract class interface so we can toggle between comfyui and sd-server?'"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-13"
---

# Contract C-388: Image Engine Provider Abstraction (ComfyUI ⇄ sd-server)

## Metadata

| Field | Value |
|---|---|
| **Source** | Local-stack engine review, 2026-08-13. Decision: ComfyUI stays as the *advanced* image engine; `sd-server` (stable-diffusion.cpp) becomes the *bundled default* because it is a single C++/ggml binary with no Python or PyTorch. Both must be selectable at runtime. |
| **Target** | `apps/frontend/client/src/lib/services/image/`, `apps/frontend/client/src/lib/services/ai/clients/ai/` — image generation provider layer |
| **Priority** | P1 — blocks C-390 (the bundled stack cannot ship sd-server until the client can talk to it), and fixes a live quality bug (negative prompts are discarded). |
| **Dependencies** | None. Independently mergeable — the de-duplication alone is a net win even if sd-server is never enabled. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | user-facing → image-engine selection page in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior — four independent ComfyUI implementations exist and none uses another.**
  1. `apps/frontend/client/src/lib/services/ai/clients/ai/clients/comfyui_client.ts:32` — `ComfyUiClient implements FrontendAiInterface`, declares `capabilities.image`, and builds a ComfyUI graph at lines 170–230 (`KSampler`, `CheckpointLoaderSimple`, `EmptyLatentImage`, 2× `CLIPTextEncode`, `VAEDecode`, `SaveImage`).
  2. `apps/frontend/client/src/lib/services/image/image_generation_service.svelte.ts` — the service the persona/gateway paths call. It **bypasses `FrontendAiInterface` entirely** and re-implements the same thing: `_buildWorkflow` (`:287`), `POST /prompt` (`:236`), `GET /object_info` (`:168`), `GET /history/{promptId}` (`:377`), `GET /view?filename=…` (`:256`).
  3. `apps/frontend/client/src/lib/views/dev/image/image_view_model.svelte.ts` — the dev sandbox image UI (`routes/(dev)/dev/image`). It bypasses the service too: `_buildTxt2ImgWorkflow` / `_buildImg2ImgWorkflow`, `_executeWorkflow` (`POST /api/image/prompt`), `_uploadImage` (`POST /api/image/upload/image`), `GET /api/image/history/{id}`.
  4. `apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.svelte.ts:600-714` — the user-facing persona-creation route (`routes/personas/create`). `_editAvatarImage` repeats the same upload → workflow → queue → poll → view cycle against `/api/image/*`.

  Adding sd-server naively produces a fifth and sixth copy. The contract's own integration hook (run the dev sandbox image route against sd-server) is unreachable unless the view-model copies are collapsed too.

- **Verified quality bug — the negative prompt is computed and then discarded.**
  `prompt_compiler.ts` implements a 17-pattern negative-extraction pipeline (`NEGATIVE_EXTRACTION_PATTERNS`, `:16`) and returns `{ positive, negative }` (`:144`). `contextual_trigger_service.svelte.ts:55` propagates both. But `image_generation_service.generateImage()` accepts only `{ prompt, checkpoint }` (`:224`), and `_buildWorkflow` hardcodes the negative node:
  ```ts
  '7': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
  ```
  Every generated image is produced with an **empty negative prompt**. The `bad anatomy` / `bad hands` / `watermark` / `lowres` extraction does nothing.

- **`ImageOptions` cannot express what either engine supports.** `apps/frontend/client/src/lib/services/ai/clients/ai/types.ts:131` carries only `model`, `width`, `height`, `steps`, `cfgScale`. No negative prompt, seed, sampler, init image, mask, LoRA, or reference images.

- **Generation parameters are hardcoded.** `_buildWorkflow` fixes 512×512, `euler`, `normal` scheduler, 20 steps, cfg 7.0, `denoise: 1`, `batch_size: 1`. There is no way to request a different resolution for a portrait vs a scene.

- **The expression pipeline has no character-consistency mechanism.** `expression_asset_resolver.ts` short-circuits to a pre-generated static asset when one exists; when it does not, generation falls through to a plain txt2img call with no reference image. Generated expressions for the same NPC will not resemble each other.

- **Existing implementation to reuse**:
  - `FrontendAiInterface` + `AiProviderCapabilities` (`.../ai/types.ts:14`) — the capability-flag pattern is already correct, it is simply unused by the image path.
  - `comfyui_client.ts` graph construction — reuse as the body of the ComfyUI engine adapter.
  - `image_generation_service.svelte.ts` reactive surface (`isGenerating`, `generationProgress`, `generationStatus`, `checkpoints`, `selectedCheckpoint`, persisted-checkpoint restore at `:190`) — keep the public shape, replace the internals.
  - `prompt_compiler.ts` — reuse unchanged; it already produces exactly what the new options type needs.

- **Known gaps**: no engine-selection mechanism, no progress reporting for sd-server, no capability introspection so the UI can hide unsupported controls.

- **Baseline tests**: `image_generation_service.test.ts`, `image_view_model.test.ts`, and `persona_create_view_model.test.ts` must pass before starting; run `bun moon run client:test`. (There is no `prompt_compiler.test.ts` in the repo.)

## User Outcome

After this contract, a **developer or player** can run Aikami against either
ComfyUI or sd-server with no code change — the engine is selected by
configuration or auto-detected — and generated images finally honour the
negative prompt the style profile already computes.

## Success Measures

- **Time/latency target**: engine auto-detection completes in under 500 ms (two parallel probes with a hard timeout); it never blocks first paint.
- **Offline/degraded behavior**: when no image engine responds, `isReady` stays `false`, the UI shows the existing demo/placeholder path, and no unhandled rejection surfaces.
- **Production journey enabled**: the bundled all-in-one stack (C-390) can ship a 100 MB C++ image engine instead of a multi-gigabyte PyTorch one, which is what makes a one-command install viable.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Provider interface + capability flags | `.../ai/types.ts:14`, `frontend_ai_interface.ts` | modify (extend for image) |
| ComfyUI graph construction | `comfyui_client.ts:170-230` | reuse — becomes the ComfyUI adapter body |
| Duplicate ComfyUI implementations | `image_generation_service.svelte.ts:168,236,256,287,377`, `image_view_model.svelte.ts`, `persona_create_view_model.svelte.ts:600-714` | **replace** — delete all three, delegate to the adapter |
| Reactive UI state surface | `image_generation_service.svelte.ts` | reuse — same public interface, new internals |
| Prompt compilation (positive + negative) | `prompt_compiler.ts` | reuse unchanged |
| Checkpoint persistence | `image_generation_service.svelte.ts:190` | reuse |
| Dev-sandbox ComfyUI transport | `image_view_model.svelte.ts` (`_executeWorkflow`, `_buildTxt2ImgWorkflow`, `_buildImg2ImgWorkflow`, `_uploadImage`) | **replace** — delegate to the engine abstraction; delete the private transport |
| Persona avatar-edit transport | `persona_create_view_model.svelte.ts:600-714` (`_editAvatarImage`) | **replace** — delegate via `initImage` + `denoise`; delete the private transport |
| Legacy shared image schema | `packages/shared/schemas/src/lib/media/image_generation.ts` (`ImageGenerationRequestSchema`, `ImageGenerationProviderInterface`, `ProviderCapabilities`) | leave — unused legacy (DALL·E-era, OpenAI-flavoured `size`/`style`/`quality`); do not reuse or delete here |
| AI gateway image adapter | `packages/frontend/ai-gateway/src/lib/image_adapter.ts` (C-320 `createDelegatingImageAdapter`) | leave — boundary unchanged; it delegates to `imageGenerationService.generateImage` |

## Overview

Collapse the four ComfyUI implementations into one adapter behind a new
`ImageEngineClient` abstraction, add a second adapter for sd-server, extend
the image options type so it can carry everything both engines accept, and
turn `image_generation_service` into a thin reactive wrapper that delegates to
whichever engine is selected. The dev sandbox image view and the persona
avatar-edit path delegate through the same abstraction instead of carrying
their own ComfyUI transports. Engine choice is configuration-driven with
auto-detection as the default.

## Design Reference

Follow the existing provider pattern in `.../ai/clients/ai/`: a narrow
interface, one file per implementation, capability flags on the instance, and
a factory that selects one. `factory.ts` is the closest analogue — mirror its
shape rather than inventing a new registration mechanism.

sd-server API surface (verified against
`leejet/stable-diffusion.cpp/examples/server/api.md`):

| Need | Endpoint / field |
|---|---|
| txt2img | `POST /sdcpp/v1/img_gen` (native) or `POST /sdapi/v1/txt2img` (A1111-compatible) |
| img2img | `POST /sdapi/v1/img2img`, `init_images` (base64 or data URL) |
| Inpainting | `mask` (single-channel) |
| Character consistency | `ref_images` (PhotoMaker-style conditioning) |
| ControlNet | `control_image` + `control_strength` |
| LoRA | `lora` array of `{ path, multiplier, is_high_noise }` |
| Model list | `GET /sdapi/v1/sd-models`, `GET /v1/models` |
| Progress / cancel | `GET /sdcpp/v1/jobs/{id}`, `POST /sdcpp/v1/jobs/{id}/cancel`; states `queued`/`generating`/`completed`/`failed`/`cancelled` |
| Parameters | `sample_steps`, `txt_cfg`, `img_cfg`, `sample_method`, `scheduler`, `seed`, `width`, `height`, `negative_prompt`, `clip_skip`, `batch_count`, `hires` |

Prefer the **native `/sdcpp/v1` family** over the A1111 compatibility layer:
it is the only one exposing async job polling and cancellation, which map
directly onto the existing `generationProgress` / `generationStatus` surface.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **One ComfyUI implementation, not two.** The graph-building code from
  `comfyui_client.ts` is the survivor; the copy inside
  `image_generation_service.svelte.ts` is deleted. Do not leave both live.
- **The engine abstraction is image-specific.** Do not widen
  `FrontendAiInterface` (which also covers dialogue, TTS, and structured
  generation) to carry image-only concerns like masks and LoRA arrays. Define
  a separate `ImageEngineClient` and let `ComfyUiClient` compose it.
- **`ImageOptions` stays for the wide interface.**
  `FrontendAiInterface.generateImage(prompt, options?: ImageOptions)` keeps
  the five-field `ImageOptions` — the other implementers (openai, gemini,
  ollama, local-tts, mock) are out of scope. The image path uses the new
  `ImageGenerationRequest`; `ImageOptions` is superseded there, not deleted.
- **View models delegate; they do not transport.** `image_view_model.svelte.ts`
  and `persona_create_view_model.svelte.ts` keep their view-model interfaces
  but drop their private ComfyUI transports and workflow builders. All
  generation and uploads go through the engine abstraction so the sandbox and
  the persona route honour the engine toggle.
- **Capabilities are per-engine and queried by the UI**, not discovered by
  failing a request. A control the active engine cannot honour must not be
  rendered.
- **Progress is a callback, not a polling contract.** ComfyUI reports over its
  websocket, sd-server over job polling. Both push into the same
  `onProgress(fraction, label)` callback so the service layer is engine-blind.
- **Cancellation is mandatory for both.** sd-server has a native cancel
  endpoint; ComfyUI uses `POST /interrupt`. An abandoned generation must not
  keep the GPU busy.
- **Auto-detection must be cheap and non-blocking.** Probe both engines in
  parallel with a short timeout at first use, cache the result, and let an
  explicit config value skip probing entirely.

## State & Data Models

```ts
/** Which image backend to talk to. `auto` probes both, sd-server first. */
type ImageEngineId = 'auto' | 'sdcpp' | 'comfyui';

/** What a given engine can actually do. Drives UI affordances. */
type ImageEngineCapabilities = {
  negativePrompt: boolean;
  seed: boolean;
  sampler: boolean;
  initImage: boolean;
  mask: boolean;
  referenceImages: boolean;
  controlNet: boolean;
  lora: boolean;
  cancel: boolean;
  progress: boolean;
};

/** Supersedes the five-field ImageOptions in the image path (.../ai/types.ts);
 *  FrontendAiInterface.generateImage keeps ImageOptions for the other providers. */
type ImageGenerationRequest = {
  positivePrompt: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  sampler?: string;
  /** Base64 or data URL — img2img source. */
  initImage?: string;
  /** 0..1; only meaningful with initImage. */
  denoise?: number;
  /** Base64 or data URL, single-channel. */
  mask?: string;
  /** Base64 or data URLs — character consistency for expression packs. */
  referenceImages?: readonly string[];
  loras?: readonly { path: string; multiplier: number }[];
};

type ImageModelInfo = {
  readonly id: string;
  readonly description: string;
};

type ImageProgress = {
  /** 0..1. Engines that cannot report fine-grained progress emit 0 then 1. */
  readonly fraction: number;
  readonly label: string;
};

type ImageEngineClient = {
  readonly id: Exclude<ImageEngineId, 'auto'>;
  readonly capabilities: ImageEngineCapabilities;
  healthCheck(): Promise<boolean>;
  listModels(): Promise<readonly ImageModelInfo[]>;
  generate(
    request: ImageGenerationRequest,
    options?: { signal?: AbortSignal; onProgress?: (p: ImageProgress) => void },
  ): Promise<{ blob: Blob; width: number; height: number; mimeType: string }>;
};
```

**Base URL resolution**: both adapters resolve their base URL from
`PUBLIC_IMAGE_URL` (default `http://localhost:8188`; in emulator dev this is
the Vite proxy path `/api/image` → `localhost:8188`, see
`apps/frontend/client/vite.config.ts`). Per C-390 the bundled sd-server also
binds `8188` (the two engines are mutually exclusive defaults), so the
sd-server adapter reuses the same base URL; a `PUBLIC_SDCPP_URL` override is
only needed when sd-server runs on a different port.

TypeBox schemas for the persisted engine preference go in
`packages/shared/schemas/`; derived types in `packages/shared/types/`. The new
request/result/capability types are client-local transport types (single-app,
per Pillar 2); the legacy shared `media/image_generation.ts` schema is left
untouched.

## Quality Requirements

- **Offline/degraded mode**: both probes fail → `isReady === false`, existing demo path unchanged, no thrown error reaches the UI.
- **Accessibility/input**: engine selector is a labelled native control; disabled capability controls carry an explanatory `title`/`aria-describedby` rather than vanishing without explanation.
- **Performance budget**: detection ≤ 500 ms wall clock, run once per session and cached; zero additional network calls on the happy path once an engine is known.
- **Security/privacy**: engine base URLs are localhost-by-default; reject non-`http(s)` schemes. Never log full base64 image payloads — log byte lengths.
- **Persistence/migration**: the persisted checkpoint key currently stores a ComfyUI checkpoint id. See Migration below.
- **Cancellation/retry/idempotency**: every `generate()` accepts an `AbortSignal`; aborting issues the engine's native cancel and resolves the promise as rejected with a distinguishable `AbortError`.
- **Observability**: log engine id, resolved model, and duration per generation at debug level. Log detection outcome once at info level.

## Migration & Rollback

- **Old data compatibility**: the persisted checkpoint id is engine-specific (ComfyUI stores `name` without the `.safetensors` suffix — `:184`). Namespace the storage key per engine (`imageCheckpoint:comfyui`, `imageCheckpoint:sdcpp`) and treat the legacy unnamespaced key as the ComfyUI value on first read, then migrate it forward.
- **Migration**: one-time read of the legacy key inside the ComfyUI adapter's checkpoint restore. No schema version bump needed.
- **Rollback**: set `PUBLIC_IMAGE_ENGINE=comfyui` — the ComfyUI adapter is behaviourally identical to today's code path apart from the negative prompt now being sent.
- **Feature flag or kill switch**: `PUBLIC_IMAGE_ENGINE` (`auto` | `sdcpp` | `comfyui`).
- **Failure recovery**: N/A — no destructive migration.

## Scope Boundaries

- **In Scope:**
  - `ImageEngineClient` interface, capability type, and request/result types.
  - `ComfyUiEngine` adapter (single surviving implementation) and `SdCppEngine` adapter.
  - Engine factory with `auto` detection and explicit override.
  - Extending the options type and threading `negativePrompt` from `prompt_compiler` through to the engine.
  - Rewriting `image_generation_service.svelte.ts` internals while preserving its public interface.
  - Rewiring `image_view_model.svelte.ts` and `persona_create_view_model.svelte.ts` to delegate generation and image upload to the engine abstraction, deleting their private ComfyUI transports and workflow builders (required for AC-1 and for the sd-server integration hook).
  - Engine selector + capability-gated controls in the dev sandbox image view (`routes/(dev)/dev/image`), which is where AC-5 is exercised.
  - Cancellation and progress for both engines.
- **Out of Scope:**
  - Any Docker, compose, or model-download work — that is C-390.
  - Wiring `referenceImages` into the expression pipeline. This contract exposes the capability; consuming it for NPC consistency is a separate contract.
  - ControlNet and LoRA **UI**. The request type carries them and the sd-server adapter forwards them; no controls are built.
  - Touching the dialogue, TTS, or structured-generation providers.
  - Changing `prompt_compiler` logic.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — the image path becomes engine-agnostic.
The de-duplication and the sd-server adapter are not independently mergeable:
shipping the abstraction without a second implementation leaves an unproven
interface, and shipping sd-server without the abstraction adds a third
duplicate. Kept as one contract.

## Acceptance Criteria

### AC-1: Single ComfyUI implementation
**Given** the repo after this contract
**When** searching for ComfyUI graph node names (`CheckpointLoaderSimple`, `KSampler`) outside of tests
**Then** exactly one non-test source file contains them, and none of
`image_generation_service.svelte.ts`, `image_view_model.svelte.ts`, or
`persona_create_view_model.svelte.ts` contains a `class_type`, `/prompt`,
`/object_info`, `/history`, `/view`, or `/api/image` ComfyUI transport literal
(all four current copies are collapsed into the single adapter).

### AC-2: Negative prompt reaches the engine
**Given** a style profile whose compiled prompt yields a non-empty `negative`
**When** an image is generated on the ComfyUI engine
**Then** the outgoing graph's negative `CLIPTextEncode` node carries that text — not `''` — and on the sd-server engine the request body's `negative_prompt` carries it.

### AC-3: Engine toggle changes the wire protocol
**Given** `PUBLIC_IMAGE_ENGINE=sdcpp`
**When** `generateImage` is called (directly or via the dev sandbox / persona avatar-edit view models)
**Then** the request targets the `/sdcpp/v1` family and no ComfyUI endpoint is contacted; **and** with `PUBLIC_IMAGE_ENGINE=comfyui` the inverse holds.

### AC-4: Auto-detection prefers sd-server and degrades cleanly
**Given** `PUBLIC_IMAGE_ENGINE=auto`
**When** only ComfyUI responds → the ComfyUI engine is selected; when only sd-server responds → sd-server is selected; when both respond → sd-server is selected; when neither responds → `isReady` is `false` and no error propagates to the UI.

### AC-5: Capabilities gate the UI
**Given** the active engine reports `capabilities.mask === false`
**When** the dev sandbox image controls render (engine selector + generation options)
**Then** the mask control is not offered, and no request is ever sent carrying a field the active engine does not declare support for. The capability query drives the view-model's exposed control list; a view-model test asserts unsupported controls are absent and the adapter test asserts unsupported fields are stripped before dispatch.

### AC-6: Cancellation stops the engine
**Given** a generation is in flight
**When** the caller aborts its `AbortSignal`
**Then** the engine's native cancel is issued (`POST /sdcpp/v1/jobs/{id}/cancel` or ComfyUI `POST /interrupt`), the promise rejects with an `AbortError`, and `isGenerating` returns to `false`.

### AC-7: Progress is engine-agnostic
**Given** either engine is active
**When** a generation runs
**Then** `generationProgress` advances monotonically from 0 to 100 and `generationStatus` passes through a queued → generating → complete sequence, with no engine-specific string leaking into the UI.

### AC-8: Model listing works on both
**Given** either engine is active
**When** `loadCheckpoints()` runs
**Then** the list is populated from `GET /object_info` (ComfyUI) or `GET /sdapi/v1/sd-models` (sd-server), and the persisted per-engine selection is restored when it matches an available entry.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | grep assertion over non-test source (in `image_engine_factory.test.ts` or `image_generation_service.test.ts`) + updated `image_view_model.test.ts` / `persona_create_view_model.test.ts` | N/A | Filled during verification |
| AC-2 | Unit | `image_generation_service.test.ts` — asserts outgoing body for both engines | `/game/...` | Filled during verification |
| AC-3 | Unit | `image_engine_factory.test.ts` + view-model tests asserting the sandbox/persona paths honour the toggle | N/A | Filled during verification |
| AC-4 | Unit | `image_engine_factory.test.ts` — four probe permutations | N/A | Filled during verification |
| AC-5 | Unit | `image_engine_capabilities.test.ts` | N/A | Filled during verification |
| AC-6 | Unit | `sdcpp_engine.test.ts`, `comfyui_engine.test.ts` | N/A | Filled during verification |
| AC-7 | Unit | `image_generation_service.test.ts` | N/A | Filled during verification |
| AC-8 | Integration | `image_generation_service.test.ts` with mocked fetch | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`, `bun moon run client:typecheck`
- Integration: with a real `sd-server` bound to `:8188` (the C-390 bundled default — both engines bind 8188 mutually exclusively), run the dev sandbox image route and confirm a generation completes end to end.
- E2E / Visual:
    - **Functional**: N/A — no new user-facing route; covered by unit tests with mocked transports.
    - **Visual**: N/A — output pixels depend on the model and are not deterministic across engines.

**Watch Points**:
- ComfyUI returns `ckpt_name` as a **nested** array (`[["a.safetensors", …]]`) — `:180` already handles this; do not regress it during the move.
- ComfyUI's `/view` fetch exists to dodge CORP restrictions (`:254`); sd-server returns image data inline, so the sd-server adapter must not reintroduce a second fetch hop.
- The two view models' img2img paths upload via ComfyUI's `POST /upload/image` and then reference the returned filename. `ImageGenerationRequest.initImage` is inline base64 — the ComfyUI adapter must absorb the upload (base64 → `/upload/image`) and the view models must pass their existing `inputImageDataUrl` / blob directly instead of uploading first.
- sd-server's OpenAI family (`/v1/images/generations`) is synchronous and exposes no progress. Using it would silently break AC-7 — use `/sdcpp/v1`.

## Implementation Sequence

1. **Phase 1 (Types + interface)**: define `ImageEngineClient`, `ImageEngineCapabilities`, `ImageGenerationRequest`, `ImageProgress`. Extend/replace `ImageOptions`. No behaviour change yet.
2. **Phase 2 (ComfyUI adapter)**: move the graph builder from `comfyui_client.ts` into `ComfyUiEngine` implementing the new interface; add negative prompt, seed, resolution, cancel, websocket progress. Delete the duplicate in `image_generation_service.svelte.ts` and delegate.
3. **Phase 3 (sd-server adapter)**: implement `SdCppEngine` against `/sdcpp/v1` with job polling, cancel, and model listing.
4. **Phase 4 (Factory + wiring)**: `PUBLIC_IMAGE_ENGINE` resolution with parallel probes and caching; per-engine checkpoint persistence with legacy-key migration.
5. **Phase 5 (Validation)**: `bun moon run client:test`, `bun moon run client:typecheck`, `bun moon run client:lint`.

## Edge Cases & Gotchas

- **Engine disappears mid-session**: a generation started against an engine that then dies must reject with a typed error and flip `isReady` to `false`, not hang on the poll loop. Bound total poll time.
- **sd-server single-slot queue**: sd-server processes one job at a time. Two concurrent `generate()` calls must queue client-side or the second must be rejected with a clear message — do not fire both and interleave polls.
- **Legacy checkpoint key collision**: a user who previously selected a ComfyUI checkpoint and then switches to sd-server must not have that id sent to sd-server. Namespacing must land in the same change as the engine toggle.
- **Port 8188 is shared by both engines**: per C-390, sd-server and ComfyUI are mutually exclusive defaults on the same port, so `PUBLIC_IMAGE_URL` serves both; the engine id selects the protocol. If a user runs sd-server elsewhere, `PUBLIC_SDCPP_URL` overrides it — the two adapters never share a live socket.
- **`denoise` without `initImage`**: meaningless and rejected by some backends — strip it in the adapter rather than forwarding.
- **Base64 payload size**: reference images and masks are sent inline. Cap the encoded size and fail fast with a readable error rather than letting the request stall.
- **`prompt_compiler` returns comma-joined tags** — sd-server expects a plain prompt string, which is compatible, but do not re-tokenise or re-order.

## Open Questions

Must be resolved before status becomes `approved`:

- Should `auto` prefer sd-server or the **first responder**? Preferring sd-server is deterministic but will surprise a user who deliberately started ComfyUI while sd-server was still running from the bundled stack. Proposed: prefer sd-server, and surface the active engine in the UI so the choice is visible.
- Does the sd-server build shipped in C-390 expose `/sdcpp/v1/jobs/{id}` in the pinned version, or only in master? The pin must be verified before AC-6 and AC-7 can be met.

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
Implemented the image engine provider abstraction: a new `ImageEngineClient`
interface with `ComfyUiEngine` (single surviving ComfyUI implementation) and
`SdCppEngine` (sd-server native `/sdcpp/v1` family) adapters, plus a factory
with `PUBLIC_IMAGE_ENGINE` resolution and parallel auto-detection (sd-server
preferred on a tie, cached per session). `image_generation_service` is now a
thin reactive wrapper delegating to the active engine while preserving its
public surface; the dev image sandbox and persona avatar-edit view models
delegate through the abstraction and their private ComfyUI transports were
deleted. The negative prompt from `prompt_compiler` now reaches both engines.
Engine selector + capability-gated controls landed in the dev sandbox route;
per-engine checkpoint persistence with legacy-key migration was added.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Exactly one non-test source file (`engine/comfyui_engine.svelte.ts`) contains `CheckpointLoaderSimple`/`KSampler`; the three rewritten files contain no transport literals (grep-asserted in `image_engine_factory.test.ts`) |
| AC-2 | ✅ | `image_generation_service.test.ts` + engine tests assert the negative prompt lands in ComfyUI node 7 / sd-server `negative_prompt` |
| AC-3 | ✅ | `image_engine_factory.test.ts` asserts `PUBLIC_IMAGE_ENGINE`/runtime override selects the right engine; VM tests assert sandbox/persona delegate through the service |
| AC-4 | ✅ | Four probe permutations tested (both→sdcpp, comfyui-only, sdcpp-only, neither→undefined); detection cached and resettable |
| AC-5 | ✅ | `image_engine_capabilities.test.ts` + `image_view_model.test.ts` assert unsupported controls absent; adapters strip unsupported fields before dispatch |
| AC-6 | ✅ | `comfyui_engine.test.ts` asserts `POST /interrupt`; `sdcpp_engine.test.ts` asserts `POST /sdcpp/v1/jobs/{id}/cancel`; both reject with AbortError |
| AC-7 | ✅ | Service maps engine progress to 0–100 with engine-agnostic labels; tests assert queued→generating→complete sequence |
| AC-8 | ✅ | `listModels` populates from `/object_info` (ComfyUI) and `/sdapi/v1/sd-models` (sd-server); per-engine persisted checkpoint restored when it matches |

### Files Created
| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/media/image_engine.ts` | TypeBox schema for `ImageEngineId` / `ImageEnginePreference` (persisted engine preference) |
| `packages/shared/types/src/lib/media/image_engine.ts` | Derived `ImageEngineId` / `ImageEnginePreference` types |
| `apps/frontend/client/src/lib/services/image/engine/types.ts` | `ImageEngineClient`, `ImageEngineCapabilities`, `ImageGenerationRequest`, `ImageModelInfo`, `ImageProgress` |
| `apps/frontend/client/src/lib/services/image/engine/base_url.ts` | Base URL resolution + http(s)/relative-path scheme validation |
| `apps/frontend/client/src/lib/services/image/engine/comfyui_engine.svelte.ts` | ComfyUI adapter — the single surviving implementation (graph builder, transport, interrupt cancel, progress) |
| `apps/frontend/client/src/lib/services/image/engine/sdcpp_engine.svelte.ts` | sd-server adapter — `/sdcpp/v1/img_gen` + job polling + cancel + inline image extraction |
| `apps/frontend/client/src/lib/services/image/engine/image_engine_factory.svelte.ts` | Engine factory: `PUBLIC_IMAGE_ENGINE` resolution, parallel auto-detection, cache, runtime override |
| `apps/frontend/client/src/lib/services/image/engine/index.ts` | Engine barrel |
| `apps/frontend/client/src/lib/services/image/engine/comfyui_engine.test.ts` | ComfyUI adapter tests (AC-2/5/6/7/8) |
| `apps/frontend/client/src/lib/services/image/engine/sdcpp_engine.test.ts` | sd-server adapter tests (AC-2/3/5/6/7/8, single-slot queue) |
| `apps/frontend/client/src/lib/services/image/engine/image_engine_factory.test.ts` | Factory tests (AC-1 grep, AC-3, AC-4) |
| `apps/frontend/client/src/lib/services/image/engine/image_engine_capabilities.test.ts` | Capability-surface tests (AC-5) |
| `apps/frontend/docs/src/content/docs/guides/image-engine-selection.mdx` | User-facing docs for engine selection |

### Files Modified
| File | Change |
|---|---|
| `packages/shared/schemas/src/index.ts` | Export new image_engine schema |
| `packages/shared/types/src/index.ts` | Export new image_engine types |
| `apps/frontend/client/src/lib/services/image/image_generation_service.svelte.ts` | Rewritten internals: delegates to active engine; keeps public surface; adds negative prompt, `cancel()`, `engineId`/`capabilities`, `setEngine()`; per-engine checkpoint persistence with legacy migration |
| `apps/frontend/client/src/lib/services/image/image_generation_service.test.ts` | Rewritten for AC-2/3/7/8 + demo + persistence |
| `apps/frontend/client/src/lib/views/dev/image/image_view_model.svelte.ts` | Deleted private ComfyUI transports/workflow builders; delegates via service; adds engine selector state + `availableControls` (AC-5) |
| `apps/frontend/client/src/lib/views/dev/image/image_view.svelte` | Engine selector UI + capability-gated controls (negative/seed/sampler/mask) |
| `apps/frontend/client/src/lib/views/dev/image/image_view_model.test.ts` | Rewritten for delegation + AC-5 gating |
| `apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.svelte.ts` | `_editAvatarImage` delegates via `initImage`+`denoise`; added `blobToDataUrl` helper; removed ComfyUI transport |
| `apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.test.ts` | Updated barrel mock path (worktree-compatible) + C-388 delegation tests |
| `apps/frontend/client/src/lib/services/ai/clients/ai/clients/comfyui_client.ts` | Refactored to compose `ComfyUiEngine`; graph builder removed (AC-1) |
| `apps/frontend/client/src/lib/views/settings/providers/providers_view_model.test.ts` | Mock paths made worktree-compatible (pre-existing artifact) |
| `apps/frontend/docs/src/content/docs/guides/image-generation.mdx` | Added link to engine-selection guide |

### Deviations from Spec
- ComfyUI progress is derived from poll cadence rather than the websocket
  (the Vite `/api/image` proxy does not expose ComfyUI's `/ws` channel).
  Progress still flows through the same `onProgress` callback so AC-7 holds;
  no engine-specific string reaches the UI. Noted here for the verifier.
- The dev sandbox engine selector sets a **runtime override** via
  `setImageEngineOverride` (session-scoped, not persisted) so the toggle is
  exercisable without a rebuild; `PUBLIC_IMAGE_ENGINE` remains the
  persistent kill switch per the contract.
- `ImageGenerationRequest` follows the contract shape; scheduler was not
  added to the request type (sd-server maps sampler→`sample_method`;
  ComfyUI hardcodes `scheduler: 'normal'` as before).
- Open Question 2 (sd-server pin exposing `/sdcpp/v1/jobs/{id}`) is deferred
  to C-390 verification — the adapter targets the documented native API and
  also accepts inline-image responses for builds that return them directly.

### Test Results
- Unit (focused, worktree): 226 pass / 0 fail across engine, factory,
  capabilities, service, image VM, persona VM, providers VM, ai, combat.
- Full client suite: 1751 pass / 1 pre-existing fail (`GameBootService`
  cancellation — confirmed failing in the main repo before this contract,
  unrelated to image generation), 0 new failures.
- schemas: 301 pass / 0 fail. ai-gateway: 58 pass / 0 fail.
- Visual: dev image route 100/100, persona create 95/100 (PASS).
- Baseline: 1 pre-existing failure, 0 new failures.
