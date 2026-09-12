---
id: C-512
title: "Creator Studio and Runtime Asset Generation"
source: "direct — C-510 write seam + user request to streamline local asset creation for end users"
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-12T00:00:00Z"
---

# Contract C-512: Creator Studio and Runtime Asset Generation

## Metadata

| Field | Value |
|---|---|
| **Source** | Direct request — "streamline it for end user that wants to create their own assets." Builds on C-510's write seam and the existing asset browser. |
| **Target** | `apps/frontend/client/src/lib/views/studio/` (new), `apps/frontend/client/src/lib/views/asset-browser/` (extend), `apps/frontend/client/src/lib/services/image/` (runtime wiring), `apps/frontend/client/src/lib/services/assets/` (local-draft management) |
| **Type** | full |
| **Priority** | P1 — the player-facing half of the generation feature; without it C-510's seam has no user surface |
| **Dependencies** | C-510 (registry write seam — prerequisite), C-511 (audio recipes — optional), C-242 (`completed` — style profiles + prompt compiler), C-243 (`completed` — asset browser), C-239 (`completed` — expression system), C-373 (`implemented` — registry/cache) |
| **Status** | draft |
| **Promotion** | `—` |
| **Docs Impact** | user-facing → `apps/frontend/docs/src/content/docs/guides/creating-assets.mdx` |
| **Contract version** | 2.0.0 |
| **Production Surface** | route `/studio/assets` + `apps/frontend/client/src/lib/services/image/contextual_trigger_service.svelte.ts#fireTrigger` |

## Problem & Baseline Evidence

- **Current behavior — generation has no user surface that persists anything.** The dev sandbox (`apps/frontend/client/src/lib/views/dev/image/image_view_model.svelte.ts`, tabs at `:63-72`) generates and holds results as transient object URLs (`:564-595`); nothing is registered. The asset browser is read-only: upload is instructions-only (`asset_browser_view_model.svelte.ts:5-8,243-249`) and `renameAsset`/`deleteAsset` are unimplemented (`:273-281`). There is no route where a player or creator can generate, review, save, and manage their own assets.

- **Current behavior — the runtime trigger builds a prompt and stops.** `contextual_trigger_service.fireTrigger` compiles a prompt and returns it (`apps/frontend/client/src/lib/services/image/contextual_trigger_service.svelte.ts:110-132`); it never calls `generateImage` or registers the result. Contextual generation (NPC portraits, scene backgrounds, expression packs) therefore produces nothing durable.

- **Current behavior — expressions are generated as ephemeral previews.** The dev expression-pack tab loops prompts and keeps object URLs (`image_view_model.svelte.ts:556-611`). Even after C-510 fixes the resolver to consult the registry, generated expressions are never registered, so they remain unreachable.

- **Reproduction**:
  1. Open the dev image sandbox, generate, reload — the image is gone (object URL, no persistence).
  2. `rg "registerGenerated" apps/frontend/client/src/lib/views` → no caller.
  3. Trigger `npc_introduced` contextually — no portrait is produced or stored.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | Registry write seam + `local-generated` source | `asset_manager.svelte.ts#registerGenerated` (C-510) |
  | Style profiles + prompt compilation | `services/image/style_profile_service.svelte.ts`, `prompt_compiler.ts` (C-242) |
  | Image engine service (engine-agnostic) | `services/image/image_generation_service.svelte.ts` (C-388) |
  | Expression generation + resolver | `services/expression/expression_service.svelte.ts`, `expression_asset_resolver.ts` (C-239; resolver fixed in C-510) |
  | Asset browser VM + composition | `views/asset-browser/` (C-243) |
  | Eviction protection precedent | `asset_manager.svelte.ts` `_EVICTION_PROTECTED_PACKS` |
  | Dev sandbox generation/expression/edit tabs | `views/dev/image/` |

- **Known gaps**:
  1. No creator route; generation results are not persisted.
  2. `registerGenerated` has no caller in views.
  3. Contextual triggers do not generate.
  4. Rename/delete for local assets unimplemented; provenance not shown.
  5. No eviction protection or quota handling for user-generated assets.

- **Baseline tests** (run before starting):
  - `apps/frontend/client/src/lib/services/image/*.test.ts` (prompt compiler, style profiles, contextual triggers).
  - `apps/frontend/client/src/lib/views/dev/image/image_view_model.test.ts`.
  - `apps/frontend/client/src/lib/views/asset-browser/*.test.ts`.
  - `bun moon run client:test`.

## User Outcome

After this contract, a player can open a Creator Studio, pick an asset type, write or accept a prompt, generate with a local engine, review the result, and save it into their library where it renders in-game via its tag; and NPC portraits / expression packs generated contextually during play are saved and reused instead of vanishing.

## Success Measures

- **Time/latency target**: generation never blocks the game loop — triggering a contextual portrait must return within one frame; generation runs async with progress and cancel.
- **Offline/degraded behavior**: generation and saving are local; with no engine, the studio shows a clear unavailable state and generation is disabled, with no error surfacing to gameplay.
- **Production journey enabled**: a player generates a portrait or track and it appears in-game through the asset resolver, or is ready to publish (C-513).

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Registry write seam | `asset_manager.svelte.ts#registerGenerated` (C-510) | reuse |
| Image generation service | `services/image/image_generation_service.svelte.ts` | reuse — do not add a second generation path |
| Style profiles / prompt compiler | `services/image/style_profile_service.svelte.ts`, `prompt_compiler.ts` | reuse |
| Contextual triggers | `services/image/contextual_trigger_service.svelte.ts` | modify — generate + register after compiling |
| Expression pack generation | `views/dev/image/image_view_model.svelte.ts`, `services/expression/` | modify — register instead of discarding |
| Asset browser | `views/asset-browser/` | modify — local-generated filter, provenance, rename/delete |
| Dev image sandbox | `views/dev/image/` | replace-in-part — move durable behavior to the studio; keep the sandbox as a dev tool |
| Eviction protection | `asset_manager.svelte.ts` `_EVICTION_PROTECTED_PACKS` | modify — protect user-generated assets |
| Catalog/publish | C-395, C-513 | do not modify here — publishing is C-513 |

## Overview

C-510 gave generated bytes a registry write path; this contract gives that path a user. It adds a Creator Studio route where a player or developer can choose an asset type (recipe), build a prompt from a style profile or free text, generate against the local engine, review, and save into the local registry with provenance. It wires runtime contextual triggers and expression packs to actually generate and register, and extends the asset browser so local-generated assets are visible, attributable, renameable, and deletable, and protected from cache eviction. Publishing them is C-513.

## Design Reference

- **MVVM**: follow `views/asset-browser/` — a `*_view_model.svelte.ts` with typed capability options and a `*_composition.ts` for production wiring; the VM never imports the services barrel directly (C-243 convention).
- **Services**: reuse `imageGenerationService` and the C-510 `registerGenerated`; the studio is a thin orchestration surface, not a new engine or storage layer.
- **Prompting**: reuse `compileImagePrompt` + `styleProfileService`; the studio's "review before generate" mirrors the C-242 review flow.
- **Dev sandbox first**: ship the studio behind the dev sandbox route, then promote to the production route (Promotion lifecycle).
- **Provenance**: `packages/shared/schemas/src/lib/game/asset_provenance.ts`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **One generation path.** The studio, contextual triggers, and expression packs all call the same `imageGenerationService`/shared client; no view model builds its own engine request.
- **Never block gameplay.** Contextual generation is fire-and-forget with debounce and a single-slot queue; a failed generation must not interrupt dialogue, combat, or movement.
- **Opt-in generation.** Contextual auto-generation is controlled by the existing `enabled` flag and defaults must not silently spend GPU/disk on private content; the studio requires an explicit action.
- **Local-generated assets are user data.** Exclude them from LRU eviction; surface storage usage and a clear delete path.
- **Tag discipline.** Saving to an existing tag with different bytes versions the registry row (C-510 trap) rather than overwriting what save data references.
- **Views delegate.** No engine transport, no raw OPFS, no registry SQL in view models — all through services.

## State & Data Models

TypeBox schemas in `packages/shared/schemas/`; derived types in `packages/shared/types/`.

```ts
type StudioRecipeOption = {
  recipeId: string;
  label: string;
  category: CatalogCategory;
  modality: GenerationModality;
  engineAvailable: boolean;
};

type StudioDraft = {
  id: string;
  recipeId: string;
  positivePrompt: string;
  negativePrompt?: string;
  referenceImageTag?: string;
  initImageTag?: string;
  /** Last generated result, before saving. */
  generated?: { tag: string; sha256: string; engine: GenerationEngineId; seed?: number };
  updatedAt: string;
};

type LibraryEntry = {
  tag: string;
  category: CatalogCategory;
  sha256: string;
  sizeBytes: number;
  ext: string;
  provenance: AssetProvenance;   // source: `generated:<engine>` | 'authored' | ...
  createdAt: string;
  /** true = generated on this device, not fetched from a catalog. */
  localGenerated: boolean;
};
```

`LibraryEntry` is a projection over the existing registry rows, not a new table; no new persistence schema is introduced beyond C-510's `local-generated` source.

## Quality Requirements

- **Offline/degraded mode**: the studio and contextual generation work offline against a local engine; when no engine responds, generation is disabled with an explanation and the rest of the app is unaffected.
- **Accessibility/input**: studio controls are labelled native controls with keyboard navigation; generation progress and errors are announced; disabled controls carry a reason (C-388 AC-5 precedent).
- **Performance budget**: contextual triggers return within one frame; generation runs async; the library renders incrementally; no full manifest rescan per save.
- **Security/privacy**: never auto-generate from private chat content without opt-in; local paths and prompts are not uploaded; logs record byte lengths, not payloads.
- **Persistence/migration**: local-generated rows survive reload; they must not perturb the seed derivation revision; eviction skips them.
- **Cancellation/retry/idempotency**: generation is cancellable and retryable; saving the same bytes to the same tag is idempotent.
- **Observability**: log recipe, engine, duration, and save tag at debug; log quota/eviction skips at info.

## Migration & Rollback

- **Old data compatibility**: existing read-only asset browser behavior and catalog assets are unchanged. Local-generated rows are additive; an older client that does not know the route simply lacks the studio.
- **Migration**: no schema migration beyond C-510. Existing dev-sandbox output directories are not imported.
- **Rollback**: gate the studio route and contextual generation behind the C-510 `PUBLIC_ASSET_GENERATION` flag; disable and ignore local-generated rows. No destructive change.
- **Feature flag or kill switch**: `PUBLIC_ASSET_GENERATION` plus the per-feature contextual `enabled` toggle.
- **Failure recovery**: a failed save removes partial cache bytes; the library remains consistent.

## Scope Boundaries

- **In Scope:**
  - New Creator Studio route + view model + composition.
  - Generate → review → save flow for image (and audio once C-511 ships) recipes.
  - Contextual trigger wiring to generate + register (opt-in, non-blocking).
  - Expression pack save to registry per NPC/emotion.
  - Asset browser: local-generated filter, provenance display, rename/delete for local assets.
  - Eviction protection + storage usage/delete UX for local-generated assets.
- **Out of Scope:**
  - The engine client, recipe registry, and `registerGenerated` (C-510).
  - Audio engine/profile/manifest (C-511).
  - Publishing, community sharing, moderation (C-513).
  - Persona avatar editing (existing persona flow stays; it may adopt the seam later).
  - Model/provider configuration UI (settings own that).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — *a user can generate and keep their own assets, and the runtime reuses them*. Studio UI, contextual wiring, and expression persistence share one data model (`LibraryEntry` over C-510 rows) and one invariant (tag + hash identity); splitting them would ship a studio whose saves the runtime cannot reuse, or runtime generation the user cannot see or manage. Publishing is a separate system and contract (C-513).

## Acceptance Criteria

### AC-1: Creator Studio generates and saves
**Given** a running local engine and an available recipe
**When** the user opens `/studio/assets`, enters a prompt, generates, reviews, and saves
**Then** the asset is registered with the correct category/tag and `generated:<engine>` provenance, appears in the library after reload, and resolves through the asset resolver.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E | `apps/e2e/tests/client/creator_studio.spec.ts` + VM test | route `/studio/assets` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: generate → save → reload → resolve offline
- E2E / Visual:
    - **Functional**: `tests/client/creator_studio.spec.ts` — generate and save flow
    - **Visual**: `suites/creator_studio.visual.ts` — library grid renders saved assets with provenance chips

**Watch Points**:
- Saving to an existing tag with different bytes must version, not overwrite.

### AC-2: Contextual generation is non-blocking and opt-in
**Given** contextual auto-generation is enabled and an `npc_introduced` event fires
**When** the trigger runs
**Then** it returns within one frame, generation proceeds asynchronously, the resulting portrait is registered under the NPC tag, and replaying the same NPC in-session does not regenerate (dedup preserved).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Integration | `contextual_trigger_service.test.ts` | `contextual_trigger_service.svelte.ts#fireTrigger` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: trigger during a live session; assert no frame stall and a registered asset
- E2E / Visual: `tests/client/contextual_generation.spec.ts` — trigger and verify the asset appears in the library

**Watch Points**:
- Single-slot engines: queue contextual jobs; never fire concurrent generations that interleave polls.
- A failed generation must not interrupt gameplay.

### AC-3: Expression packs persist
**Given** an uploaded/reference face and the expression generator
**When** the user generates a pack and saves it
**Then** each emotion is registered under the NPC/emotion tag and the (C-510) expression resolver returns the registered asset in-game.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + E2E | expression service/VM tests | expressions rendered via `/game/...` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: generate a pack, enter the game, assert the expression renders
- E2E / Visual: `tests/client/expression_pack_save.spec.ts`

**Watch Points**:
- Reference-image consistency is the point; do not register inconsistent outputs under one NPC without a review step.

### AC-4: Library management and eviction protection
**Given** saved local-generated assets and a full cache
**When** the cache needs to evict
**Then** local-generated assets are not evicted, and the asset browser lets the user rename/delete local assets and shows their provenance and size.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `asset_manager.test.ts` eviction tests + asset-browser VM tests | `apps/frontend/client/src/lib/views/asset-browser` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: fill the cache, confirm protection; rename/delete a local asset
- E2E / Visual: N/A — reason: covered by the studio E2E

**Watch Points**:
- Deleting a local asset must not break a save that references its tag; warn or refuse when referenced.

### AC-5: Degraded mode
**Given** no local engine is reachable
**When** the studio and contextual triggers run
**Then** generation is disabled with a visible reason, no unhandled rejection reaches the UI, and the rest of the app continues normally.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | studio VM + contextual trigger tests with a failed health check | route `/studio/assets` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: stop the engine, open the studio
- E2E / Visual: N/A — reason: covered by unit tests with a mocked engine

**Watch Points**:
- Engine death mid-generation must reject and flip availability to false, not hang.

## Implementation Sequence

1. **Phase 1 (Studio data + VM)**: recipe options, draft/library projection, view model + composition.
2. **Phase 2 (Studio UI)**: route, generate/review/save flow, capability-gated controls.
3. **Phase 3 (Runtime wiring)**: contextual triggers + expression packs generate and register; queue + dedup.
4. **Phase 4 (Library)**: asset-browser local filter, provenance, rename/delete, eviction protection, quota UX.
5. **Phase 5 (Validation)**: `bun moon run client:test`; E2E + visual suites; manual offline smoke.

## Edge Cases & Gotchas

- **Frame stalls**: generation must never be awaited on the game loop; contextual triggers are fire-and-forget.
- **Privacy/cost**: auto-generation from private chat must remain opt-in; a user who never opens the studio should not accrue gigabytes of generated assets.
- **Save references**: deleting/renaming a tag a save uses is destructive; detect references before deletion.
- **Quota exhaustion**: surface a clear, recoverable error; never silently fail a save.
- **Single-slot queue**: serialize; expose queued state in the UI.
- **Seed reuse**: preserve seed so the user can reproduce a result (the CLI prints it; the studio should too).
- **Expression consistency**: generated emotions for one NPC must share a reference; otherwise the set is unusable.

## Open Questions

Must be resolved before status becomes `approved`:

- **Q1 — production route path?** Proposed: `/studio/assets`; dev sandbox `(dev)/dev/studio`. Confirm.
- **Q2 — default contextual generation state?** Proposed: portrait/background auto-generation off until the user has generated once manually (avoids surprise disk/GPU use). Confirm.
- **Q3 — persona avatars adopt the seam?** Proposed: leave the persona row storage as-is in this contract; migrate later. Confirm.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
