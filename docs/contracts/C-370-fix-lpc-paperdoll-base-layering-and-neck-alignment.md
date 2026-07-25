# Contract C-370: Fix LPC Paperdoll Base Layering and Neck Alignment

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — C-370: Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | `packages/frontend/engine` — LPC paperdoll sprite composition, layer manifest, recipe resolver, and the two client-side `_buildLpcPipeline` recipe resolvers in `game_engine_service.svelte.ts` and `game_boot_service.svelte.ts`. |
| **Priority** | P0 — paperdoll recipes currently render garments (e.g. overalls) without a guaranteed base body layer, causing background color bleed-through at the neck and chest. |
| **Dependencies** | C-325 (LPC Appearance Preview — implemented). C-325 provides the generated LPC slot catalog, `REQUIRED_LPC_SLOTS` constant, and the 6-layer Appearance ECS component that this contract modifies. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | None — internal rendering fix |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: When a character equips a torso garment (e.g. overalls, chainmail) that covers the chest but leaves the neck exposed — or when the initial persona appearance omits the body layer — the paperdoll recipe resolver generates recipes without a base body/skin layer. The background key color or map tile shows through the neck and chest gap between the head sprite's bottom edge and the torso garment's top edge. Additionally, `_updatePlayerAppearanceFromEquipment` in `ecs_worker.ts` only writes `layer2` (torso) without ensuring `layer0` (body) is non-zero.

- **Reproduction**:
  1. Create a character with a torso garment but no explicit body layer in the Appearance component (layer0 = 0).
  2. Or: equip armor via the combat sandbox — `_updatePlayerAppearanceFromEquipment` sets `newLayers[2]` from armor mapping, leaving `newLayers[0]` at its previous value (potentially 0 if the initial recipe had no body layer).
  3. Observe: the worker recipe resolver (`workerRecipeResolver` at `ecs_worker.ts:552`) only pushes recipes for layers where `layerIds[i] > 0`. With layer0 = 0, no body recipe is generated.
  4. The sprite composer's `_loadAndComposeMultiLayer` sorts recipes by `LPC_SLOT_Z_ORDER` — if the body slot is missing, the background shows through in the neck/chest gap between head and torso layers.
  5. The main-thread recipe resolvers in `game_engine_service.svelte.ts:626` and `game_boot_service.svelte.ts:746` have the same gap: they skip slots where the variant lookup fails or the layer ID is 0.

- **Existing implementation to reuse**:
  - `packages/frontend/engine/src/rendering/sprite_composer.ts` — `LPC_SLOT_Z_ORDER` (body:0, legs:1, feet:2, torso:3, head:4, hair:5), `_getSlotZ()`, `packRecipeToUboBuffer()`, `_loadAndComposeMultiLayer()`. The z-order enum and packing logic are correct and reusable; only the layer validation needs augmentation.
  - `packages/frontend/engine/src/components/appearance.ts` — `Appearance` SoA (6 layers), `getAppearanceLayers()`, `setAppearanceLayers()`, `EXPRESSION_MAP`, `APPEARANCE_LAYER_COUNT`. These are correct and reusable.
  - `packages/frontend/engine/src/worker/ecs_worker.ts:538` — `WORKER_SLOT_NAMES = ['body', 'hair', 'torso', 'legs', 'feet', 'head']` and `_updatePlayerAppearanceFromEquipment()` (lines ~470–533). Modify these to enforce the body base layer invariant.
  - `apps/frontend/client/src/lib/data/lpc_asset_catalog.ts` — `REQUIRED_LPC_SLOTS = ['head', 'body', 'torso']` as const. Already declares the invariant — needs runtime enforcement.
  - `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts:614–666` — `_buildLpcPipeline()` recipe resolver. Production path that needs base layer enforcement.
  - `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts:727–786` — `_buildLpcPipeline()` recipe resolver in boot service. Same pattern, same gap.
  - `packages/frontend/engine/src/entities/create_sandbox_avatar.ts` — `SANDBOX_PLAYER_LAYERS` and `SANDBOX_NPC_LAYERS` already include a body layer (index 0). These are correct and demonstrate the desired invariant.
  - `packages/frontend/engine/src/entities/create_player.ts` — `createPlayer()` defaults `appearanceLayers` to `[1, 1, 1, 1, 1, 95]` which includes body. Correct baseline.

- **Known gaps**:
  - No runtime enforcement that `layer0` (body) is always non-zero across all Appearance write paths.
  - `_updatePlayerAppearanceFromEquipment` only writes `layer2` — it never validates or repairs layer0.
  - `workerRecipeResolver` skips layers where `layerIds[i] > 0` — no fallback to a default body asset.
  - The main-thread recipe resolvers skip slots with no variant match — no body fallback.
  - No canonical default body asset ID constant for fallback injection.
  - No test coverage for the "body layer missing → background bleed-through" scenario.

- **Baseline tests**:
  - `packages/frontend/engine/src/__tests__/rendering.test.ts` — `testRecipeResolver` (line 1198) maps 5 slot names (body, hair, torso, legs, feet). Includes `syncAppearanceSystem` integration tests. Does NOT test the missing-body-layer scenario.

## User Outcome

After this contract, a player equipping any torso garment (or starting a game with any appearance recipe) always sees opaque skin pixels filling the neck and chest region — no background color bleed-through. The paperdoll assembly guarantees a base body layer beneath all clothing slots, and head/torso sprites align seamlessly on integer grid boundaries across all animation states and directions.

## Success Measures

- **Time/latency target**: No measurable performance regression. The base layer injection is a single array check and lookup — under 0.1ms.
- **Offline/degraded behavior**: N/A — this is a rendering pipeline fix with no network dependency. All assets are local.
- **Production journey enabled**: Player creates a character with any valid appearance recipe → enters the game world → equips armor → the paperdoll always renders with a complete, gap-free body beneath all clothing.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| LPC slot Z-order manifest | `sprite_composer.ts` `LPC_SLOT_Z_ORDER` | **Reuse** as-is |
| UBO packing + multi-layer compositing | `sprite_composer.ts` `packRecipeToUboBuffer`, `_loadAndComposeMultiLayer` | **Reuse** as-is |
| Appearance ECS component (6-layer SoA) | `components/appearance.ts` | **Reuse** as-is |
| Worker recipe resolver | `ecs_worker.ts:552` `workerRecipeResolver` | **Modify** — add body fallback |
| Worker equipment→appearance bridge | `ecs_worker.ts:470` `_updatePlayerAppearanceFromEquipment` | **Modify** — enforce body invariant |
| Main-thread recipe resolvers (×2) | `game_engine_service.svelte.ts:626`, `game_boot_service.svelte.ts:746` | **Modify** — add body fallback |
| Required slots constant | `lpc_asset_catalog.ts` `REQUIRED_LPC_SLOTS` | **Reuse** as reference |
| Sandbox avatar defaults | `create_sandbox_avatar.ts` | **Reuse** — demonstrates correct invariant |
| Player factory defaults | `create_player.ts` | **Reuse** — already provides body layer |
| Rendering integration tests | `__tests__/rendering.test.ts` | **Extend** — add missing-body-layer test |

## Overview

Enforce a mandatory base body (skin) layer in the LPC paperdoll recipe pipeline. When a character recipe omits the body layer — whether from equipment changes (`_updatePlayerAppearanceFromEquipment`), persona data (`appearanceLayers` with layer0=0), or recipe resolution — the resolver automatically injects a canonical default body asset at the correct z-depth (behind all clothing). Additionally, verify that the head and torso sprite alignment produces zero visible gap pixels across all animation frames and directional headings.

## Design Reference

- **Body fallback pattern**: The main-thread recipe resolver already has a head fallback pattern (`effectiveIdx = 94` for `head/heads/human_male` at `game_engine_service.svelte.ts:641–646`). Follow the same pattern for body: if layer0 is 0 or the body variant lookup fails, inject the default body asset (`body/bodies/male/light` — variant index 0 in the `body` slot).
- **Worker-side enforcement**: `_updatePlayerAppearanceFromEquipment` currently reads `currentLayers` and only modifies `newLayers[2]`. After reading, check `newLayers[0]` — if 0 or undefined, set it to 1 (the default body variant).
- **Z-order verification**: The existing `LPC_SLOT_Z_ORDER` in `sprite_composer.ts` is correct per the spec (`body:0, legs:1, feet:2, torso:3, head:4, hair:5`). No changes needed — this contract validates it, doesn't modify it.
- **Neck alignment**: The head sprite and torso sprite are both 64×64 spritesheet cells with standardized LPC offsets. The alignment gap (if present) is a compositing artifact, not a per-asset issue. Verify that sprite origins and frame extraction use identical integer coordinates across all layers.
- **Test pattern**: Follow the existing `testRecipeResolver` pattern in `rendering.test.ts` — create a resolver that injects a body fallback and verify the body recipe appears even when layer0 = 0.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Engine — Appearance component** (`packages/frontend/engine/src/components/appearance.ts`): Add a `DEFAULT_BODY_LAYER_ID = 1` constant. No structural changes to the SoA layout.
- **Engine — Worker recipe resolver** (`packages/frontend/engine/src/worker/ecs_worker.ts:538–564`): Add `WORKER_BODY_SLOT_INDEX = 0` constant. Modify `workerRecipeResolver` to inject a body recipe (`slot: 'body', assetId: String(DEFAULT_BODY_LAYER_ID)`) when `layerIds[0] <= 0`. Same for `_updatePlayerAppearanceFromEquipment` — after the `newLayers = [...currentLayers]` copy, enforce that `newLayers[0]` is always ≥ 1.
- **Engine — Sprite composer** (`packages/frontend/engine/src/rendering/sprite_composer.ts`): No structural changes. Verify z-order manifest is correct. Add runtime assertion or debug log if body slot is missing from recipes (defense-in-depth).
- **Client — Game engine service** (`apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts:614–666`): In `_buildLpcPipeline()`, after building recipes, check if a body recipe exists. If not, look up the default body variant from `GENERATED_LPC_SLOTS` and inject it.
- **Client — Game boot service** (`apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts:727–786`): Same body fallback injection as game engine service.
- **Client data** (`apps/frontend/client/src/lib/data/lpc_asset_catalog.ts`): Export a `LPC_DEFAULT_BODY_ASSET_ID` constant. Already has `REQUIRED_LPC_SLOTS` and `LPC_DEFAULT_HEAD_ASSET_ID` — this adds the body counterpart.
- **Shared packages**: No changes.

## State & Data Models

No schema changes. The `Appearance` component's 6-layer SoA layout is unchanged. The contract adds a constant and modifies resolver logic only.

```typescript
// packages/frontend/engine/src/components/appearance.ts — new constant

/** Default body variant index used when Appearance.layer0 is 0 or unset. */
export const DEFAULT_BODY_LAYER_ID = 1;
```

```typescript
// apps/frontend/client/src/lib/data/lpc_asset_catalog.ts — new constant

/** Default body asset used as fallback when a character's body layer is missing. */
export const LPC_DEFAULT_BODY_ASSET_ID = 'body/bodies/male/light';
```

```typescript
// Worker recipe resolver — modified signature behavior (pseudocode)
// packages/frontend/engine/src/worker/ecs_worker.ts

const WORKER_SLOT_NAMES = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;
const WORKER_BODY_SLOT_INDEX = 0;

const workerRecipeResolver = (layerIds: readonly number[]): LpcLayerRecipe[] => {
  const recipes: LpcLayerRecipe[] = [];
  for (let i = 0; i < layerIds.length; i++) {
    const effectiveId = (i === WORKER_BODY_SLOT_INDEX && (layerIds[i] ?? 0) <= 0)
      ? DEFAULT_BODY_LAYER_ID
      : layerIds[i];
    if (effectiveId > 0) {
      recipes.push({
        slot: WORKER_SLOT_NAMES[i] ?? `layer_${i}`,
        assetId: String(effectiveId),
        hexPalette: new Uint8Array(1024),
      });
    }
  }
  return recipes;
};
```

## Quality Requirements

- **Offline/degraded mode**: N/A — all rendering is local. No network dependency.
- **Accessibility/input**: N/A — no user-facing UI changes.
- **Performance budget**: Body fallback check is O(1) per entity per frame. No measurable impact (<< 0.1ms). No additional GPU draw calls — the body sprite was already allocated in the UBO; this ensures it's populated instead of skipped.
- **Security/privacy**: N/A — no auth, no data exposure, no input handling changes.
- **Persistence/migration**: N/A — no persistent state changes. The fix is computed at render time from existing layer IDs. Existing saved games with incomplete layers automatically get the body fallback.
- **Cancellation/retry/idempotency**: The body fallback is idempotent — applying it multiple times produces the same result. No async operations to cancel.
- **Observability**: Add `this.debug()` logs in the worker recipe resolver when the body fallback is triggered (low frequency — once per entity creation/equipment change). In the main-thread resolvers, use the existing `this.debug()` pattern from `BaseClass`.

## Migration & Rollback

N/A — no persistent state changes. The fix operates at recipe resolution time (computed during rendering). Existing Appearances with layer0=0 are automatically repaired without data migration. Rollback is a code revert with no data consequences.

## Scope Boundaries

- **In Scope:**
  - Enforce body layer invariant in `workerRecipeResolver` (worker-side)
  - Enforce body layer invariant in `_updatePlayerAppearanceFromEquipment` (worker-side)
  - Enforce body layer invariant in game_engine_service `_buildLpcPipeline` recipe resolver
  - Enforce body layer invariant in game_boot_service `_buildLpcPipeline` recipe resolver
  - Add `DEFAULT_BODY_LAYER_ID` constant to Appearance component
  - Add `LPC_DEFAULT_BODY_ASSET_ID` constant to LPC asset catalog
  - Add unit test for missing-body-layer → body-injected scenario
  - Verify `LPC_SLOT_Z_ORDER` matches spec (body→legs→feet→torso→head→hair)
  - Verify head/torso alignment across idle/walk animation frames at 4 headings through visual inspection

- **Out of Scope:**
  - Changing the 6-layer SoA layout or `APPEARANCE_LAYER_COUNT`
  - Adding a shadow layer (layer order position 0, below body) — deferred to future sprite polish
  - Palette/tint changes for the body fallback (uses default palette)
  - Equipment slot reordering or new equipment types
  - Expression system changes (FACE_LAYER_INDEX = 1 is preserved)
  - LPC asset generation or catalog regeneration
  - E2E visual test suite changes (visual AC can be covered by existing `lpc.visual.ts` suite or manual inspection)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 3 ACs, 1 logical system (paperdoll recipe resolution pipeline), 1 primary project (`packages/frontend/engine`) with 2 client-side resolver patches. No split needed — all three fixes are tightly coupled and must ship together to close the neck-bleed gap.

## Acceptance Criteria

### AC-1: Recipe Contains Clothing but No Explicit Skin Layer
**Given** a character entity with Appearance layers where layer0 (body) is 0 and layer2 (torso) is a valid garment variant (e.g. overalls, chainmail),
**When** the paperdoll recipe resolver compiles the texture stack (via `workerRecipeResolver` or the main-thread `_buildLpcPipeline` resolver),
**Then** the resolver automatically includes a body recipe (`slot: 'body'`) with the default body asset ID, positioned at z-index 0 (behind all clothing layers).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/frontend/engine/src/__tests__/rendering.test.ts` | N/A (engine unit) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: N/A — unit-level resolver test suffices
- E2E / Visual:
    - **Functional**: N/A — no UI surface
    - **Visual**: N/A — covered by AC-3 visual inspection

**Watch Points**:
- The body fallback must use the same slot name (`'body'`) and z-index (0) as a normal body layer so the UBO packing and GPU compositing treat it identically.
- The fallback must not override a valid body layer — only inject when layer0 ≤ 0.

### AC-2: Equipment Changes Preserve the Body Layer
**Given** a player entity with valid Appearance layers (including body) that equips armor via `_updatePlayerAppearanceFromEquipment`,
**When** the equipment update maps the armor to `newLayers[2]` and applies all 6 layers,
**Then** layer0 (body) remains at its original non-zero value and is not zeroed out, deleted, or skipped by the update logic.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/frontend/engine/src/__tests__/rendering.test.ts` | N/A (engine unit) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: N/A — unit test suffices
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A — covered by AC-3 visual inspection

**Watch Points**:
- `newLayers = [...currentLayers]` copies the current body layer correctly. The fix ensures this invariant is checked: if `newLayers[0]` is undefined or 0 after the copy, set it to `DEFAULT_BODY_LAYER_ID`.
- Equipment changes that remove armor (`newLayers[2] = 1`) must not affect layer0.

### AC-3: Visual Continuity at the Neck Boundary
**Given** a character rendered on screen with a background color or map tile beneath,
**When** inspecting the pixel region between the lower jaw/head sprite and the top strap/neck line of the torso garment across all 4 directional headings (North, South, East, West) and both idle and walk animation frames,
**Then** opaque skin pixels from the body layer fill the neck/chest gap, leaving 0 transparent or background pixels showing through between head and torso.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Visual | `apps/e2e/src/visual/suites/lpc.visual.ts` (extend existing suite) | `/game` or sandbox route | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:visual` (or manual `validate()`)
- Integration: Load the combat or appearance sandbox with overalls equipped, cycle through animation states and headings, verify visually.
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: Extend the existing `lpc.visual.ts` suite with a new test case: character with overalls/torso garment only (no explicit body layer), rendered at high zoom (4x), AI evaluation prompt: "Score 90+: No green/transparent pixels visible between the character's chin and the top of their torso garment. The neck region shows continuous skin-colored pixels from chin to garment neckline. Character must be clearly visible with head and body connected seamlessly."

**Watch Points**:
- The alignment gap (if present) may be smaller than 1 pixel at 1x zoom but visible at higher zoom levels. Test at 4x zoom.
- Some LPC head variants (e.g., elf ears) have different silhouette shapes — the body layer should still fill the neck gap regardless.
- Animation frame offsets must produce identical pixel alignment for head and torso layers. If frame extraction introduces a 1px offset between head and body spritesheets, this is a sprite asset issue (out of scope), not a compositing bug.

## Implementation Sequence

1. **Phase 1 (Constants + Resolver Logic)**:
   - Add `DEFAULT_BODY_LAYER_ID = 1` to `packages/frontend/engine/src/components/appearance.ts`
   - Add `LPC_DEFAULT_BODY_ASSET_ID` to `apps/frontend/client/src/lib/data/lpc_asset_catalog.ts`
   - Modify `workerRecipeResolver` in `ecs_worker.ts` to inject body fallback
   - Modify `_updatePlayerAppearanceFromEquipment` in `ecs_worker.ts` to preserve body layer
   - Modify both main-thread recipe resolvers (`game_engine_service.svelte.ts` and `game_boot_service.svelte.ts`) to inject body fallback
   - Add debug logging when body fallback is triggered

2. **Phase 2 (Tests)**:
   - Add unit tests for recipe resolver body fallback (missing body → body injected)
   - Add unit test for equipment update preserving body layer
   - Extend `rendering.test.ts` with AC-1 and AC-2 scenarios
   - Run `bun moon run frontend-engine:test`

3. **Phase 3 (Validation)**:
   - Run `validate()` across all affected projects
   - Manual visual verification: sandbox with overalls equipped across all animation states and headings
   - Extend `lpc.visual.ts` with the neck-gap AI evaluation case (per Evidence Matrix)

## Edge Cases & Gotchas

- **Body layer at non-zero but invalid variant index**: If `layer0 = 99` but the body slot only has 5 variants, the main-thread resolver's variant lookup fails → falls through. The contract's body fallback should trigger when the resolved recipe list has no body entry, not just when layer0 = 0.
- **Worker vs main-thread parity**: The worker resolver uses a simplified slot→assetId mapping (no catalog lookup). The main-thread resolvers have full catalog access. Both paths must produce equivalent body fallback behavior.
- **Expression layer conflict**: `FACE_LAYER_INDEX = 1` (hair slot). The body fallback at index 0 does not overlap with the expression system.
- **Zero-length layer arrays**: `getAppearanceLayers()` always returns 6 elements. No risk.
- **NPC entities**: `createDefaultSandboxAvatar` already provides all 6 layers including body for sandbox entities. Production NPC creation should follow the same pattern; the recipe resolver fallback provides defense-in-depth.

## Open Questions

None.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
