---
id: C-512
title: "Creator Studio and Runtime Asset Generation"
source: "direct — C-510 write seam + user request to streamline local asset creation for end users"
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/341"
  pr_number: 341
created_at: "2026-09-12T00:00:00Z"
---

# Contract C-512: Creator Studio and Runtime Asset Generation

## Metadata

| Field | Value |
|---|---|
| **Source** | Direct request — "streamline it for end user that wants to create their own assets." Builds on C-510's write seam and the existing asset browser. |
| **Target** | `apps/frontend/client/src/lib/views/studio/` (new), `apps/frontend/client/src/lib/views/asset-browser/` (extend), `apps/frontend/client/src/lib/services/image/` (runtime wiring + byte seam), `apps/frontend/client/src/lib/services/assets/` (local-draft management + eviction policy), `apps/frontend/client/src/lib/data/npc_avatar_catalog.ts` (generated-portrait resolution), `apps/frontend/client/src/lib/services/game/bridge_listeners.ts` (trigger caller), `apps/frontend/client/src/lib/constants/routes.ts` + `apps/frontend/client/src/lib/views/dev/layout/layout_view_model.dev.svelte.ts` (route + sandbox nav), `packages/frontend/storage/src/lib/` (generated-row list/rename/delete) |
| **Type** | full |
| **Priority** | P1 — the player-facing half of the generation feature; without it C-510's seam has no user surface |
| **Dependencies** | C-510 (`implemented` — registry write seam; prerequisite), C-511 (`implemented` in code, frontmatter `approved` — audio recipes; optional), C-242 (`completed` — style profiles + prompt compiler), C-243 (`completed` — asset browser), C-239 (`completed` — expression system), C-373 (`implemented` — registry/cache) |
| **Status** | implemented |
| **Promotion** | `—` → `sandbox` once Phase 3 ships the `(dev)/dev/studio` route → `integrated` with the production route + E2E |
| **Docs Impact** | user-facing → `apps/frontend/docs/src/content/docs/guides/creating-assets.mdx` (cross-link `generating-assets.mdx`, the C-510 CLI guide) |
| **Contract version** | 2.1.0 |
| **Production Surface** | route `/studio/assets` (entered from the start menu Advanced section) + `apps/frontend/client/src/lib/services/image/contextual_trigger_service.svelte.ts#fireTrigger`, called from `apps/frontend/client/src/lib/services/game/bridge_listeners.ts` (`NPC_INTERACTED`) |

## Problem & Baseline Evidence

- **Current behavior — generation has no user surface that persists anything.** The dev sandbox (`apps/frontend/client/src/lib/views/dev/image/image_view_model.svelte.ts`, tabs at `:63-72`) generates and holds results as transient object URLs (`:556-611`); nothing is registered. The asset browser is read-only: upload is instructions-only (`asset_browser_view_model.svelte.ts:5-8,243-249`) and `renameAsset`/`deleteAsset` are unimplemented (`:273-281`). The browser is mounted only at `routes/(dev)/dev/asset-browser/+page.svelte` — no production route renders it. There is no route where a player or creator can generate, review, save, and manage their own assets.

- **Current behavior — the runtime trigger builds a prompt and stops, and nothing fires it in play.** `contextual_trigger_service.fireTrigger` compiles a prompt and returns it (`apps/frontend/client/src/lib/services/image/contextual_trigger_service.svelte.ts:110-132`); it never calls `generateImage` or registers the result. Its only callers are `views/dev/image_gen/image_gen_view_model.svelte.ts:294` and tests — `rg "fireTrigger" apps/frontend/client/src/lib/services/game` finds nothing. Contextual generation (NPC portraits, scene backgrounds, expression packs) therefore produces nothing durable and never runs during play.

- **Current behavior — expressions are generated as ephemeral previews.** The dev expression-pack tab loops prompts and keeps object URLs (`image_view_model.svelte.ts:556-611`). Even after C-510 fixes the resolver to consult the registry, generated expressions are never registered, so they remain unreachable.

- **Current behavior — a generated NPC portrait could not render in-game even if registered.** `npc_avatar_catalog.resolveNpcAvatarUrl` requires `NPC_AVATAR_SPRITE_MAP[npcId]` (a hardcoded map) and resolves `portraits:npc:<sprite>:<expression>`; an NPC missing from that map returns `PLACEHOLDER_AVATAR_URL` before any registry lookup (`data/npc_avatar_catalog.ts:122-134`); the registry read itself is at `:168`. The registry seam C-510 added (`expression_asset_resolver.ts`) serves `expressionAssetTag({ npcId, emotion })` = `portraits:<npcId>-<emotion>` — a different tag family.

- **Current behavior — local-generated rows are LRU-evictable and unmanageable.** Eviction protects exactly one pack, `OFFLINE_CORE_PACK_ID` (`asset_cache_eviction.ts:24`, filter at `:47`), while generated rows are written under `GENERATED_ASSET_PACK_ID = 'generated'` (`packages/shared/constants/src/lib/game_assets.ts:374`) — so quota pressure can delete user work. `AssetRegistryRepository` (`packages/frontend/storage/src/lib/assets.ts`) has no rename, delete, or generated-row listing query.

- **Reproduction**:
  1. Open the dev image sandbox, generate, reload — the image is gone (object URL, no persistence).
  2. `rg "registerGenerated" apps/frontend/client/src/lib/views` → no caller.
  3. Trigger `npc_introduced` contextually — no portrait is produced or stored.
  4. `rg "fireTrigger" apps/frontend/client/src/lib/services/game` → no caller; the trigger never fires during play.
  5. `rg "renameAsset|deleteAsset" apps/frontend/client/src/lib/views/asset-browser` → stubs only.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | Registry write seam + `local-generated` source | `services/assets/generated_asset_registration.ts#registerGeneratedAsset`, exposed as `asset_manager.svelte.ts#registerGenerated` (C-510) |
  | Byte → descriptor derivation (`toGeneratedAsset`, `deriveTag`) | `packages/shared/local-ai/src/lib/generated_asset.ts` (C-510) |
  | Recipe registry | `packages/shared/local-ai/src/lib/recipes/recipe_registry.ts` (`listRecipes`, `getRecipe`, `compileRecipeRequest`) |
  | Style profiles + prompt compilation | `services/image/style_profile_service.svelte.ts`, `prompt_compiler.ts` (C-242) |
  | Image engine service + availability probe | `services/image/image_generation_service.svelte.ts` (C-388), `services/image/engine/image_engine_factory.svelte.ts#detectImageEngine` |
  | Contextual triggers + dev trigger caller | `services/image/contextual_trigger_service.svelte.ts`, `views/dev/image_gen/` (C-242) |
  | Expression generation + resolver | `services/expression/expression_service.svelte.ts`, `expression_asset_resolver.ts` (C-239; resolver registry seam fixed in C-510) |
  | NPC portrait tag + resolution | `data/npc_avatar_catalog.ts#resolveNpcAvatarUrl`, `constants` `expressionAssetTag` |
  | Asset browser VM + composition | `views/asset-browser/` (C-243) |
  | Eviction policy seam | `services/assets/asset_cache_eviction.ts` (`EVICTION_PROTECTED_PACKS`, `evictLruCachedAsset({ protectedPacks })`) |
  | Registry queries (list/sources/install state) | `packages/frontend/storage/src/lib/assets.ts` |
  | Dev sandbox generation/expression/edit tabs | `views/dev/image/` |

- **Known gaps**:
  1. No creator route; generation results are not persisted.
  2. `registerGenerated` has no caller in views.
  3. Contextual triggers neither generate nor fire during play.
  4. Rename/delete for local assets unimplemented; provenance not shown; no generated-row listing query.
  5. No eviction protection or quota handling for user-generated assets (the `generated` pack is evictable).
  6. Generated NPC portraits cannot resolve through `resolveNpcAvatarUrl` (hardcoded sprite map short-circuits before the registry).

- **Baseline tests** (run before starting):
  - `apps/frontend/client/src/lib/services/image/*.test.ts` (prompt compiler, style profiles, contextual triggers).
  - `apps/frontend/client/src/lib/views/dev/image/image_view_model.test.ts`.
  - `apps/frontend/client/src/lib/views/asset-browser/*.test.ts`.
  - `apps/frontend/client/src/lib/services/assets/asset_cache_eviction.test.ts`, `asset_manager.test.ts`.
  - `apps/frontend/client/src/lib/data/npc_avatar_catalog.test.ts`.
  - `bun moon run client:test`.

## User Outcome

After this contract, a player can open a Creator Studio, pick an asset type, write or accept a prompt, generate with a local engine, review the result, and save it into their library where it renders in-game via its tag; and NPC portraits / expression packs generated contextually during play are saved and reused instead of vanishing.

Generated NPC portraits and expressions share one tag family — `expressionAssetTag({ npcId, emotion })` (`portraits:<npcId>-<emotion>`) — so a single resolver seam serves both, and `resolveNpcAvatarUrl` consults the registry for that tag before falling back to the hardcoded sprite map.

## Success Measures

- **Time/latency target**: generation never blocks the game loop — `fireTrigger` resolves without awaiting generation (assert: it resolves while the generator promise is still pending); generation runs async with progress and cancel.
- **Offline/degraded behavior**: generation and saving are local; with no engine, the studio shows a clear unavailable state and generation is disabled, with no error surfacing to gameplay.
- **Production journey enabled**: a player generates a portrait or track and it appears in-game through the asset resolver, or is ready to publish (C-513).

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Registry write seam | `services/assets/generated_asset_registration.ts` via `asset_manager.svelte.ts#registerGenerated` (C-510) | reuse |
| Byte → descriptor derivation | `packages/shared/local-ai/src/lib/generated_asset.ts#toGeneratedAsset` | modify — add a tag override so expression/NPC saves land on `expressionAssetTag` |
| Recipe registry | `packages/shared/local-ai/src/lib/recipes/recipe_registry.ts` | reuse — `listRecipes()` drives studio recipe options |
| Image generation service | `services/image/image_generation_service.svelte.ts` | modify — expose bytes + engine id + seed (or add a sibling workflow service); do not add a second generation path |
| Style profiles / prompt compiler | `services/image/style_profile_service.svelte.ts`, `prompt_compiler.ts` | reuse |
| Contextual triggers | `services/image/contextual_trigger_service.svelte.ts` | modify — generate + register after compiling; add an `npcId` option; dedup only after a successful registration |
| Gameplay trigger caller | `services/game/bridge_listeners.ts` (`NPC_INTERACTED`) | modify — call `fireTrigger` on first interaction per NPC |
| Expression pack generation | `views/dev/image/image_view_model.svelte.ts`, `services/expression/` | modify — register instead of discarding, under `expressionAssetTag` |
| NPC portrait resolution | `data/npc_avatar_catalog.ts#resolveNpcAvatarUrl` | modify — consult the registry for a generated portrait before requiring `NPC_AVATAR_SPRITE_MAP` |
| Asset browser | `views/asset-browser/` | modify — local-generated filter, provenance, rename/delete (dev-only today; the studio library is the production surface) |
| Registry queries | `packages/frontend/storage/src/lib/assets.ts` | modify — add generated-row listing + rename/delete mutations |
| Dev image sandbox | `views/dev/image/`, `views/dev/image_gen/` | replace-in-part — move durable behavior to the studio; keep the sandboxes as dev tools |
| Eviction protection | `services/assets/asset_cache_eviction.ts` (`EVICTION_PROTECTED_PACKS`, `evictLruCachedAsset`) | modify — protect `GENERATED_ASSET_PACK_ID` |
| Catalog/publish | C-395, C-513 | do not modify here — publishing is C-513 |

## Overview

C-510 gave generated bytes a registry write path; this contract gives that path a user. It adds a Creator Studio route where a player or developer can choose an asset type (recipe), build a prompt from a style profile or free text, generate against the local engine, review, and save into the local registry with provenance. It wires runtime contextual triggers and expression packs to actually generate and register (with a production trigger caller), makes `resolveNpcAvatarUrl` resolve a generated portrait through the registry, and gives the studio a library where local-generated assets are visible, attributable, renameable, and deletable, and protected from cache eviction. The asset browser keeps its read-only catalog role in the dev sandbox; the studio library is the production surface. Publishing them is C-513.

## Design Reference

- **MVVM**: follow `views/asset-browser/` — a `*_view_model.svelte.ts` with typed capability options and a `*_composition.ts` for production wiring; the VM never imports the services barrel directly (C-243 convention). The studio also ships a `(dev)/dev/studio` sandbox (Pillar 4 dev-sandbox pattern).
- **Services**: reuse `imageGenerationService` and the C-510 `registerGenerated`; the studio is a thin orchestration surface, not a new engine or storage layer.
- **Byte/descriptor seam (required)**: `imageGenerationService.generateImage` returns `{ url }` only (`image_generation_service.svelte.ts:30-33,88`), while `toGeneratedAsset` needs `{ bytes, mimeType, metadata }` and `registerGenerated` needs `GeneratedAsset` + `Uint8Array`. C-512 must close that gap in the service layer — extend `generateImage` to also return the `Blob`/bytes plus the resolved engine id and seed, or add a thin `services/image/generated_asset_workflow.ts` that does it — so no view model fetches a blob URL or touches engine transport to obtain bytes.
- **Prompting**: reuse `compileImagePrompt` + `styleProfileService`; the studio's "review before generate" mirrors the C-242 review flow.
- **Dev sandbox first**: ship the studio at `(dev)/dev/studio` (registered in `views/dev/layout/layout_view_model.dev.svelte.ts`), then promote to `/studio/assets` (Promotion lifecycle).
- **Provenance**: `packages/shared/schemas/src/lib/game/asset_provenance.ts` (`source: 'generated:<engine>'`); C-510 stores it in the `assets.attribution` column, so the library projection reads it from there.
- **Recipe catalog**: `listRecipes()` / `getRecipe()` from `@aikami/local-ai` (`packages/shared/local-ai/src/lib/recipes/recipe_registry.ts`) is the single source of studio recipe options; `engineAvailable` comes from `detectImageEngine` plus the recipe's `modality`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **One generation path.** The studio, contextual triggers, and expression packs all call the same `imageGenerationService`/shared client; no view model builds its own engine request, and bytes reach the registry only through the byte/descriptor seam above.
- **Never block gameplay.** Contextual generation is fire-and-forget with debounce and a single-slot queue; `fireTrigger` must resolve without awaiting generation, and a failed generation must not interrupt dialogue, combat, or movement.
- **Opt-in generation.** Contextual auto-generation is controlled by `ContextualTriggerService.enabled`, which must **default to off** once this contract wires generation (it is `true` today, `contextual_trigger_service.svelte.ts:67`, harmless only because `fireTrigger` never generated); the studio requires an explicit action and never spends GPU/disk on private content by itself.
- **Local-generated assets are user data.** Exclude the `generated` pack from LRU eviction; surface storage usage and a clear delete path.
- **Tag discipline.** Saving to an existing tag with different bytes versions the registry row (C-510 trap) rather than overwriting what save data references. Generated NPC portraits/expressions use `expressionAssetTag`; catalog (seed) tags are never shadowed.
- **Views delegate.** No engine transport, no raw OPFS, no registry SQL in view models — all through services; registry mutations (rename/delete) live in `packages/frontend/storage`, not in a service singleton.

## State & Data Models

TypeBox schemas in `packages/shared/schemas/` (e.g. `src/lib/studio/studio_draft.ts`, `src/lib/studio/library_entry.ts`); types derived with `Static<typeof Schema>` and re-exported from `packages/shared/types/`. All three shapes below cross the client ↔ shared boundary, so the TypeBox Static Inference Law applies — no hand-written duplicates. `AssetProvenance` is currently exported only from `packages/shared/schemas/src/lib/game/asset_provenance.ts`; add the `@aikami/types` re-export so `LibraryEntry` follows the same rule.

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
  /** Set for NPC-bound drafts (portrait / expression pack) — drives the resolver tag. */
  npcId?: string;
  positivePrompt: string;
  negativePrompt?: string;
  referenceImageTag?: string;
  initImageTag?: string;
  /** Last generated result, before saving. `tag` is the resolver tag, not the prompt slug. */
  generated?: { tag: string; sha256: string; engine: GenerationEngineId; seed?: number };
  updatedAt: string;
};

// `StudioRecipeOption.label` derives from the recipe id/category —
// `AssetRecipe` carries no label field.

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

`LibraryEntry` is a projection over the existing registry rows, not a new table; no new persistence schema is introduced beyond C-510's `local-generated` source. Projection mapping: `assets.id` → `tag`, `assets.category`, `assets.hash` → `sha256`, `assets.size_bytes`, and `assets.attribution` → `provenance.source` (C-510 writes `generated:<engine>` into `attribution`); `asset_sources.backend === 'local-generated'` → `localGenerated`; `ext` comes from the recipe's `output.ext` (or the cached blob's MIME type). No `created_at` column exists — project `install_state.downloaded_at` (written by the cache write) and document that fallback.

**Tag family (one convention, two consumers).** Generated NPC portraits and expressions are both registered as `expressionAssetTag({ npcId, emotion })` (`portraits:<npcId>-<emotion>`, `packages/shared/constants/src/lib/game_assets.ts:366`). `toGeneratedAsset` derives tags from the prompt slug (`deriveTag`), which for an expression yields `portraits:<prompt-slug>` — the resolver would never find it, so the descriptor must accept an explicit tag override. Catalog NPC sprites keep their own `portraits:npc:<sprite>:<expression>` tags and are never overwritten (`registerGeneratedAsset` refuses seed tags).

## Quality Requirements

- **Offline/degraded mode**: the studio and contextual generation work offline against a local engine; when no engine responds, generation is disabled with an explanation and the rest of the app is unaffected.
- **Accessibility/input**: studio controls are labelled native controls with keyboard navigation; generation progress and errors are announced; disabled controls carry a reason (C-388 AC-5 precedent).
- **Performance budget**: contextual triggers return within one frame; generation runs async; the library renders incrementally and reads generated rows through a pack-scoped query (`pack_id = 'generated'`), never a full registry scan per save.
- **Security/privacy**: never auto-generate from private chat content without opt-in; local paths and prompts are not uploaded; logs record byte lengths, not payloads.
- **Persistence/migration**: local-generated rows survive reload; they must not perturb the seed derivation revision; eviction skips the `generated` pack.
- **Cancellation/retry/idempotency**: generation is cancellable and retryable; saving the same bytes to the same tag is idempotent (`unchanged: true`, no version bump); a failed save leaves no partial row and no orphan cache bytes.
- **Observability**: log recipe, engine, duration, and save tag at debug; log quota/eviction skips at info.

## Migration & Rollback

- **Old data compatibility**: existing read-only asset browser behavior and catalog assets are unchanged. Local-generated rows are additive (`pack_id = 'generated'`, `asset_sources.backend = 'local-generated'`); an older client that does not know the route simply lacks the studio and ignores those rows.
- **Migration**: no schema migration beyond C-510. Existing dev-sandbox output directories are not imported. Rename/delete are new registry mutations and must only ever touch rows whose `pack_id = 'generated'`; a seed/catalog row is refused (`isSeedTag`).
- **Rollback**: gate the studio route and contextual generation behind the C-510 `PUBLIC_ASSET_GENERATION` flag; disable and ignore local-generated rows. No destructive change. Note the flag is read at build time (`$app/env/public`, `src/env.ts`), so rollback is a rebuild rather than a runtime switch.
- **Feature flag or kill switch**: `PUBLIC_ASSET_GENERATION` plus the per-feature contextual opt-in toggle (default off — see AC-2).
- **Failure recovery**: a failed save removes partial cache bytes (C-510 rollback in `generated_asset_registration.ts`); a failed rename/delete is per-row transactional and reported to the user — the library remains consistent.

## Scope Boundaries

- **In Scope:**
  - New Creator Studio route (`/studio/assets`) + `(dev)/dev/studio` sandbox + view model + composition, registered in `constants/routes.ts` and the dev nav registry.
  - Generate → review → save flow for image (and audio once C-511 ships) recipes, including the byte/descriptor seam that feeds `registerGenerated`.
  - Contextual trigger wiring: generate + register (opt-in, non-blocking, queued), with a production caller in `bridge_listeners.ts` (`NPC_INTERACTED`).
  - Expression pack save to the registry per NPC/emotion under `expressionAssetTag`.
  - `resolveNpcAvatarUrl` consults the registry for a generated portrait before the hardcoded sprite map.
  - Studio library: local-generated filter, provenance/size display, rename/delete for local assets (registry seam in `packages/frontend/storage`).
  - Eviction protection for the `generated` pack + storage usage/delete UX + quota error surfacing.
  - Docs: `guides/creating-assets.mdx`.
- **Out of Scope:**
  - The engine client, recipe registry, and `registerGenerated` itself (C-510); `toGeneratedAsset` changes are limited to the tag override.
  - Audio engine/profile/manifest (C-511) — audio recipes show as unavailable until C-511 ships.
  - Publishing, community sharing, moderation (C-513).
  - Persona avatar editing (existing persona flow stays; it may adopt the seam later).
  - Model/provider configuration UI (settings own that).
  - Cloud sync, auth, or backup of local-generated assets — everything here is local-only.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — *a user can generate and keep their own assets, and the runtime reuses them*. Studio UI, contextual wiring, and expression persistence share one data model (`LibraryEntry` over C-510 rows) and one invariant (tag + hash identity); splitting them would ship a studio whose saves the runtime cannot reuse, or runtime generation the user cannot see or manage. Publishing is a separate system and contract (C-513).

## Acceptance Criteria

### AC-1: Creator Studio generates and saves
**Given** the app at `/studio/assets` (no campaign required), a reachable local engine (`detectImageEngine` resolves), and at least one image recipe in `listRecipes()`
**When** the user picks a recipe, enters a prompt, generates, reviews the result, and saves
**Then** the bytes reach the registry through `assetManager.registerGenerated` (verified cache write, `assets` row, `local-generated` source at `priority = -1`), the row carries the recipe's category and `generated:<engine>` provenance, and after a reload the asset appears in the studio library and resolves to a blob URL through the asset resolver.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + E2E | `studio_view_model.test.ts` + `apps/e2e/tests/client/creator_studio.spec.ts` | route `/studio/assets` (entered from the start menu Advanced section) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: generate → save → reload → resolve offline, with the engine endpoints stubbed (`**/sdapi/v1/sd-models`, `**/sdapi/v1/txt2img`) so the E2E is deterministic and needs no live engine
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/creator_studio.spec.ts` — navigate from the start menu, generate, save, reload, assert the library entry
    - **Visual**: `apps/e2e/src/visual/suites/creator_studio.visual.ts` — library grid renders saved assets with provenance chips

**Watch Points**:
- Saving to an existing tag with different bytes must version the row (C-510 `version` bump), not overwrite what save data references.
- Bytes must arrive through the service seam — no engine transport, blob-URL fetch, or OPFS access in the view model.
- With `PUBLIC_ASSET_GENERATION` off, `registerGenerated` is a documented no-op; the UI must say so instead of reporting a false success.

### AC-2: Contextual generation is non-blocking, opt-in, and reachable in play
**Given** contextual auto-generation is enabled (opt-in toggle on) and a first `NPC_INTERACTED` bridge event fires for an NPC
**When** the trigger runs
**Then** `fireTrigger` resolves within one frame without awaiting generation (generation is queued fire-and-forget), the portrait is registered under `expressionAssetTag({ npcId, emotion: 'neutral' })`, `resolveNpcAvatarUrl` returns the registered portrait for that NPC, and replaying the same NPC in-session does not regenerate.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Integration | `contextual_trigger_service.test.ts`, `bridge_listeners.test.ts`, `npc_avatar_catalog.test.ts` | `contextual_trigger_service.svelte.ts#fireTrigger` called from `services/game/bridge_listeners.ts` (`NPC_INTERACTED`) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: fire the trigger with a generator whose promise never settles and assert `fireTrigger` still resolves; then with a resolved fixture generator assert the registered tag and resolver hit
- E2E / Visual: `apps/e2e/tests/client/contextual_generation.spec.ts` — interact with an NPC and verify the asset appears in the studio library

**Watch Points**:
- Single-slot engines: queue contextual jobs; never fire concurrent generations that interleave polls.
- A failed generation must not interrupt gameplay, and must **not** mark the NPC as done: `_npcPortraitCache` is currently populated before generation (`contextual_trigger_service.svelte.ts:101-108`), so one transient failure would permanently suppress that NPC for the session. Mark only after a successful registration.
- Dedup is session-scoped, not persisted — a later session may regenerate; the row must version, not duplicate.
- `fireTrigger` has no `npcId` today (only `context`, `characterName`); add an optional `npcId` so the resolver tag is deterministic.

### AC-3: Expression packs persist under resolver tags
**Given** an uploaded/reference face and the expression generator
**When** the user generates a pack and saves it
**Then** each emotion is registered under `expressionAssetTag({ npcId, emotion })` (explicit tag override, not the prompt-derived slug) and the (C-510) expression resolver returns the registered asset in-game.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + E2E | `expression_asset_resolver.test.ts` + expression service/VM tests + `apps/e2e/tests/client/expression_pack_save.spec.ts` | dialogue avatar / expression resolution via `resolveNpcAvatarUrl` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: generate a pack, enter the game, assert the expression renders
- E2E / Visual: `apps/e2e/tests/client/expression_pack_save.spec.ts`

**Watch Points**:
- `toGeneratedAsset` currently derives the tag from the prompt slug (`deriveTag`), so an expression would land on `portraits:<prompt-slug>` and never resolve — the descriptor needs the tag override (Reuse Map).
- Reference-image consistency is the point; do not register inconsistent outputs under one NPC without a review step.

### AC-4: Library management and eviction protection
**Given** saved local-generated assets and a full cache
**When** the cache needs to evict, or the user renames/deletes a local asset from the studio library
**Then** local-generated assets are never evicted, and rename/delete succeed through the registry (row + source row + cache bytes), with provenance and size shown per entry.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + E2E | `asset_cache_eviction.test.ts` (protection), `asset_manager.test.ts` / storage tests (rename/delete), `apps/e2e/tests/client/creator_studio.spec.ts` (library actions) | studio library at `/studio/assets` (the `(dev)/dev/asset-browser` route is dev-only, not a production path) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: fill the cache, confirm protection; rename/delete a local asset and confirm the row, source row, and cache bytes are gone
- E2E / Visual: `apps/e2e/tests/client/creator_studio.spec.ts` — provenance chip, rename, delete

**Watch Points**:
- Deleting a local asset must not break a save that references its tag. There is no reference-index API today: scan the active campaign's save payloads (`SELECT payload FROM saves`) for the tag and refuse (or require explicit confirmation) on a hit; refuse seed tags outright via `isSeedTag`. Document the substring-scan limitation.
- Eviction protection is per pack: add `GENERATED_ASSET_PACK_ID` (`'generated'`) to the protected set. Do **not** protect by category — `portraits`/`props` would protect the whole catalog and defeat LRU.

### AC-5: Degraded mode
**Given** no local engine is reachable (`detectImageEngine` returns undefined)
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

### AC-6: Quota exhaustion is surfaced and recoverable
**Given** a cache backend that throws `QuotaExceededError` on write
**When** the user saves a generated asset
**Then** the save fails with a visible, actionable message (storage full, with a path to delete local assets), no partial registry row or orphan cache bytes remain, and retrying after freeing space succeeds.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit + Integration | studio VM save-failure test + `generated_asset_registration` rollback test | route `/studio/assets` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: quota-failing backend, then free space and retry
- E2E / Visual: N/A — reason: covered by unit tests with a fault-injecting backend

**Watch Points**:
- `registerGenerated` already rolls the cache write back when the registry write fails (`generated_asset_registration.ts`); the studio must surface the thrown error rather than swallowing it into a silent no-op.

## Implementation Sequence

1. **Phase 1 (Seams)**: schema/type additions (studio draft, library entry, `AssetProvenance` re-export), byte → descriptor seam in `services/image/`, registry `listGenerated`/`renameGenerated`/`deleteGenerated` in `packages/frontend/storage`, `GENERATED_ASSET_PACK_ID` added to `EVICTION_PROTECTED_PACKS`, tag override in `toGeneratedAsset`.
2. **Phase 2 (Studio data + VM)**: recipe options from `listRecipes()` + engine availability, draft/library projection, view model + composition; register `/studio/assets` in `constants/routes.ts`.
3. **Phase 3 (Studio UI + sandbox)**: route + view, generate/review/save flow, capability-gated controls; `(dev)/dev/studio` sandbox + dev nav entry (`views/dev/layout/layout_view_model.dev.svelte.ts`); start-menu Advanced entry (`start_view_model.svelte.ts#advancedItems`).
4. **Phase 4 (Runtime wiring)**: contextual triggers generate + register (queue, dedup after success, `npcId` option), production caller in `bridge_listeners.ts`, expression packs save under `expressionAssetTag`, `resolveNpcAvatarUrl` registry-first.
5. **Phase 5 (Library)**: studio library local filter, provenance, rename/delete, quota UX.
6. **Phase 6 (Validation)**: `bun moon run client:test`; E2E + visual suites; manual offline smoke; docs guide `guides/creating-assets.mdx`.

## Edge Cases & Gotchas

- **Frame stalls**: generation must never be awaited on the game loop; contextual triggers are fire-and-forget and must resolve before generation settles.
- **Privacy/cost**: auto-generation from private chat must remain opt-in and default **off** — the existing `enabled = $state(true)` must not become a silent generator; a user who never opens the studio should not accrue gigabytes of generated assets.
- **Save references**: deleting/renaming a tag a save uses is destructive; scan the active campaign's save payloads for the tag before deleting and refuse (or require explicit confirmation) on a hit.
- **Quota exhaustion**: surface a clear, recoverable error; never silently fail a save.
- **Single-slot queue**: serialize; expose queued state in the UI.
- **Seed reuse**: preserve seed so the user can reproduce a result (the CLI prints it; the studio should too).
- **Expression consistency**: generated emotions for one NPC must share a reference; otherwise the set is unusable.
- **Tag override**: expression/NPC saves must use `expressionAssetTag`, not the prompt-derived slug — otherwise the resolver never finds them.
- **Dedup before success**: `_npcPortraitCache` is populated before generation today; a transient failure would permanently suppress that NPC for the session.
- **Seed-tag collision**: registering under a catalog tag throws `GeneratedTagCollisionError`; the studio must surface it as "pick a different name", not an unhandled rejection.

## Open Questions

Resolved during critique from codebase evidence; none remain open before `approved`.

- **Q1 — production route path?** Confirmed `/studio/assets`, entered from the start menu's Advanced section (`start_view_model.svelte.ts#advancedItems`) and registered in `apps/frontend/client/src/lib/constants/routes.ts` (the router navigates from its own route table via `$routes`, so a SvelteKit route file alone is not reachable through `routerService.goToRoute`). Dev sandbox: `(dev)/dev/studio`, matching the existing `(dev)/dev/<feature>` convention and registered in `views/dev/layout/layout_view_model.dev.svelte.ts`.
- **Q2 — default contextual generation state?** Off. `ContextualTriggerService.enabled` defaults to `true` today (`contextual_trigger_service.svelte.ts:67`), which was harmless while `fireTrigger` only compiled a prompt; once it generates and writes bytes the default must flip to `false`, with an explicit persisted opt-in (same pattern as `gameplay_settings.ts`). AC-2's Given clause states the toggle is on.
- **Q3 — persona avatars adopt the seam?** Confirmed: no. Persona rows keep their current storage; out of scope, revisit later.
- **Q4 — which gameplay event fires the trigger?** `bridge.on('NPC_INTERACTED')` in `services/game/bridge_listeners.ts` — first interaction per NPC, which already supplies `npcId`/`npcName`. No new event bus.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.1.0 | 2026-09-12 | Draft revision during critique: ACs tightened (tag family, byte seam, production paths, dedup-after-success), AC-6 (quota exhaustion) added, storage / NPC-portrait-resolution / gameplay-trigger-caller seams named, Open Questions resolved. | pending user approval |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Summary

The Creator Studio now exists as a production route (`/studio/assets`, entered from
the start menu's Advanced section) plus a `(dev)/dev/studio` sandbox that renders
the same ViewModel and View. It closes the C-510 byte/descriptor gap with a
service-layer seam (`services/image/generated_asset_workflow.ts`) so no ViewModel
touches engine transport, adds generated-row listing/rename/delete to the registry
(`packages/frontend/storage`), projects those rows into a `LibraryEntry` library
with provenance and size, and protects the `generated` pack from LRU eviction.
Contextual generation is wired end-to-end (opt-in, default off, non-blocking,
single-slot queue, dedup only after a successful registration) with the production
caller in `bridge_listeners.ts` (`NPC_INTERACTED`), and `resolveNpcAvatarUrl` now
consults `expressionAssetTag({ npcId, emotion })` before the hardcoded sprite map.
Deferred: the dev expression-pack loop (`views/dev/image`) still keeps object URLs
and was not rewired to register per emotion; audio recipes are listed but disabled
in the studio; non-NPC contextual events still compile prompts without generating.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ⚠️ | Unit-verified end to end (workflow + VM + registry row/source/priority). E2E spec `apps/e2e/tests/client/creator_studio.spec.ts` authored but **not executed** — no browser/dev-server tooling in this stage's toolset, so the production-path visual evidence is missing and must be produced by the verifier. |
| AC-2 | ✅ | Unit-verified: `fireTrigger` resolves while the generator promise is still pending; portrait registered under `portraits:<npc>-neutral`; replay does not regenerate; failure does not cache the NPC; `enabled` defaults to off with a persisted opt-in; `bridge_listeners` calls the trigger on `NPC_INTERACTED` and a trigger failure does not break dialogue. |
| AC-3 | ⚠️ | The NPC-bound studio path registers under `expressionAssetTag({ npcId, emotion })` (explicit tag override, unit-verified), and the C-510 expression resolver + `resolveNpcAvatarUrl` return it. The multi-emotion **pack loop** in the dev sandbox was not rewired to register per emotion — only the studio's single-emotion NPC save persists today. |
| AC-4 | ⚠️ | Unit-verified: `generated` pack excluded from LRU eviction; `listGenerated`/`renameGenerated`/`deleteGenerated` operate on the row + source + install state and refuse seed tags; delete refuses a tag a save payload mentions unless forced; the library VM shows provenance/size and drives rename/delete. The E2E library-action assertions were authored but not executed. |
| AC-5 | ✅ | Unit-verified: with no reachable engine every recipe reports `engineAvailable: false`, generation is disabled with a visible reason, and a generation rejection clears the pending result and surfaces an error instead of rejecting into the UI. |
| AC-6 | ✅ | Unit-verified: a `QuotaExceededError` from the registry write propagates out of `save()`, the VM surfaces it and keeps the reviewed result; the cache-write rollback itself is C-510's (`generated_asset_registration.ts`) and remains covered by its tests. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/studio/studio.ts` | `StudioRecipeOption` / `StudioDraft` / `LibraryEntry` TypeBox schemas (C-512 State & Data Models) |
| `packages/shared/types/src/lib/studio/studio.ts` | `Static`-derived studio types (Static Inference Law) |
| `packages/shared/types/src/lib/game/asset_provenance.ts` | `@aikami/types` re-export of `AssetProvenance` so `LibraryEntry` follows the same rule |
| `packages/shared/constants/src/lib/studio.ts` | Recipe labels (`studioRecipeLabel`) and the generated pack id re-export |
| `apps/frontend/client/src/lib/types/studio.ts` | Client-local seam types (`GeneratedAssetOutcome` / `…SaveOutcome` / `…DeleteOutcome`) |
| `apps/frontend/client/src/lib/services/image/generated_asset_workflow.ts` | The byte/descriptor seam: generate → descriptor → save; NPC tag override; ext reconciliation; bounded pending-bytes map; the shared production singleton |
| `apps/frontend/client/src/lib/services/assets/generated_library.ts` | `LibraryEntry` projection over the `generated` pack + rename/delete (row, source, install state, cache bytes, save-reference guard) |
| `apps/frontend/client/src/lib/views/studio/studio_view_model.svelte.ts` | Studio ViewModel (recipes, draft, generate/review/save, library management, degraded mode) |
| `apps/frontend/client/src/lib/views/studio/studio_composition.ts` | Production wiring (the only studio module importing `$services`) |
| `apps/frontend/client/src/lib/views/studio/studio_view.svelte` | Logicless studio View |
| `apps/frontend/client/src/lib/views/studio/studio_view_model.test.ts` | Studio ViewModel unit tests |
| `apps/frontend/client/src/lib/views/start/start_advanced_items.ts` | Advanced-section entries extracted from `StartViewModel` (C-512 entry added; keeps the VM inside its size budget) |
| `apps/frontend/client/src/routes/studio/assets/+page.svelte` | Production route |
| `apps/frontend/client/src/routes/(dev)/dev/studio/+page.svelte` | Dev sandbox route |
| `apps/frontend/client/src/lib/services/image/generated_asset_workflow.test.ts` | Seam unit tests (tag override, ext reconciliation, save, quota propagation) |
| `apps/frontend/client/src/lib/services/image/contextual_trigger_service.test.ts` | Contextual generation unit tests (opt-in, non-blocking, dedup-after-success) |
| `apps/frontend/client/src/lib/data/npc_avatar_catalog_generated.test.ts` | Registry-first portrait resolution tests |
| `apps/e2e/tests/client/creator_studio.spec.ts` | E2E functional spec (authored, not executed here) |
| `apps/e2e/src/visual/suites/creator_studio.visual.ts` | Visual suite (authored, not executed here) |
| `apps/frontend/docs/src/content/docs/guides/creating-assets.mdx` | User-facing guide |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/local-ai/src/lib/generated_asset.ts` | `ToGeneratedAssetOptions.tag` override (validated against the tag grammar) + `extForMimeType` |
| `apps/frontend/client/src/lib/services/assets/asset_cache_eviction.ts` | `GENERATED_ASSET_PACK_ID` added to `EVICTION_PROTECTED_PACKS` |
| `apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts` | `listGeneratedAssets` / `renameGeneratedAsset` / `deleteGeneratedAsset` |
| `packages/frontend/storage/src/lib/assets_generated.ts` | `listGeneratedAssetRows`, `renameGeneratedAssetRow`, `deleteGeneratedAssetRow`, `findSaveReferences` |
| `packages/frontend/storage/src/lib/assets.ts` | Repository methods for the above |
| `apps/frontend/client/src/lib/services/image/image_generation_service.svelte.ts` | `generateImage` now also returns `blob` / `mimeType` / `engineId` / `seed` |
| `apps/frontend/client/src/lib/services/image/contextual_trigger_service.svelte.ts` | Opt-in `enabled` (default off, persisted), `setEnabled`, `npcId` option, generate + register fire-and-forget, single-slot queue, dedup only after success, `drain()` |
| `apps/frontend/client/src/lib/services/game/bridge_listeners.ts` | `NPC_INTERACTED` calls `fireTrigger` (optional param) |
| `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` | Passes the contextual trigger singleton; awaits `drain()` on dispose |
| `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` | `drain()` on teardown |
| `apps/frontend/client/src/lib/data/npc_avatar_catalog.ts` | Registry-first generated-portrait lookup (requested emotion, then `neutral`) |
| `apps/frontend/client/src/lib/constants/routes.ts` | `studioAssets` route entry |
| `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` | `openCreatorStudio()`, Advanced entry, `AdvancedEntry` re-export |
| `apps/frontend/client/src/lib/views/dev/layout/layout_view_model.dev.svelte.ts` | `/dev/studio` label + fallback route list |
| `apps/frontend/client/src/lib/services/index.ts` | Barrel exports: `asset_generation_flag`, `asset_manager`, `generated_library`, `generated_asset_workflow` |
| `apps/frontend/client/src/lib/types/index.ts` | `$types/studio` export |
| `apps/frontend/client/src/lib/views/chat/testing/chat_fixtures.ts` | Inert image capability updated for the extended `generateImage` result |
| `scripts/src/lib/ops/guard_source_file_size_baseline.json` | Locked in the `start_view_model.svelte.ts` reduction (937 from 953) |
| `scripts/src/lib/ops/guard_orphaned_capability_baseline.json` | Locked in the `detectImageEngine` improvement (now consumed by the studio composition) |
| Test files | `generated_asset.test.ts`, `asset_cache_eviction.test.ts`, `assets_registry.test.ts`, `bridge_listeners.test.ts` extended |

### Deviations from Spec

1. **Ext reconciliation in the seam (proposed Amendment).** `toGeneratedAsset` rejects PNG bytes for the `portrait`/`expression` recipes, which declare `.webp`, while sd-server always returns PNG — so a portrait could not be saved at all. The seam reconciles the effective recipe's `output.ext` with the engine's actual MIME type (logged as a warning) rather than registering bytes under a MIME they do not have. Proposed amendment: fix `recipes.json` (`portrait`/`expression` → `.png`) or make the sd-server adapter convert. Recipe data was left untouched (out of scope).
2. **AC-3 pack loop not rewired.** The dev expression-pack generator (`views/dev/image/image_view_model.svelte.ts#generateExpressions`) still holds object URLs; it has no NPC id, so per-emotion registration could not be derived there. The studio's NPC-bound save covers one emotion (`neutral`) under the resolver tag. Full multi-emotion packs remain open.
3. **Non-NPC contextual events do not generate.** `location_changed` / `combat_started` / `dramatic_moment` / `quest_completed` still compile prompts only — AC-2's Then-clause is NPC-specific and no scene-background tag family exists to register against.
4. **Audio recipes are listed but disabled** in the studio: the client generation path is `imageGenerationService`; C-511's engine is server-side with no client wiring.
5. **Two workflow instances.** The studio owns its own seam instance (pending bytes across the review step) while contextual generation uses the shared singleton, so a studio review cannot evict a contextual result.
6. **`drain()` added to the composition root's `dispose()`** — a production caller for the queue-drain seam (also resolves the orphaned-capability guard).
7. **Tooling notes.** `validate()` failed with `Parse failed: Invalid project record at index 1` (moon project detection), so per-project `moon_run_task` typecheck/build were used instead; `moon_run_task` returned `No test output captured` for every test target, so the same project test commands (`bun run test:unit`, `bun test`) were run scoped with explicit timeouts to read results.
8. **No screenshot/visual verification.** This stage's toolset has no `browser screenshot` / `ai_validate_image` / `herdr_session`, so the mandatory production-path visual evidence for AC-1/AC-3/AC-4 is missing and the E2E + visual suites have not been executed. The verifier must run them.

### Test Results

- Unit (local-ai): 257 PASS / 0 FAIL
- Unit (frontend-storage): 79 PASS / 0 FAIL
- Unit (client, full suite): 2989 PASS / 7 skipped / 2 todo / 0 FAIL
- Unit (schemas): 652 PASS / 0 FAIL; (constants): 146 PASS / 0 FAIL
- Typecheck: `client:typecheck` ✅ 0 errors (svelte-check); `e2e:typecheck` (`tsgo --noEmit`) ✅; `local-ai` / `frontend-storage` / `schemas` / `types` / `constants` typecheck ✅
- Build: `client:build` ✅ (bundle cycle check clean)
- Guards: `bun run guard` ✅ all nine guards (two baselines locked in: a file-size reduction and one orphan improvement)
- E2E: 4 specs authored, 0 executed
- Visual: 1 suite authored, not executed
- Baseline: not captured pre-change (tooling unavailable); the full client suite is green post-change with 0 failures
