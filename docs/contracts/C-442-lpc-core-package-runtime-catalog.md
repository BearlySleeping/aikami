---
id: C-442
title: "LPC Core Package — One Catalog, Derived From the Published Index"
source: "user request 2026-08-26 — single source of truth for LPC across hub, client dev, and the game"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-26"
---

# Contract C-442: LPC Core Package — One Catalog, Derived From the Published Index

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-26): *"I would like to have a single source of truth. Like one place for both hub, client dev, and client actual game."* |
| **Target** | `packages/shared/lpc/` (new), `apps/frontend/client/src/lib/data/lpc_*`, `packages/frontend/engine/src/rendering/lpc_*`, `scripts/src/lib/ops/collect_lpc_assets.ts` |
| **Priority** | P0 — the committed LPC catalog is empty at HEAD, so character creation, onboarding, the AI character prompt, and every sandbox resolve against zero assets. This is a live break, not a refactor. |
| **Dependencies** | C-395 (published catalog index), C-400 (unified appearance resolver), C-433 (categories), C-435 (de-bundle). All `implemented`. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior — the catalog is empty.**
  `apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts` is committed
  at HEAD with:
  ```ts
  export const GENERATED_LPC_SLOTS: readonly LpcSlotDefinition[] = [];
  export const LPC_ASSET_IDS_BY_SLOT: Record<string, string[]> = {};
  export const ALL_GENERATED_ASSET_IDS: readonly string[] = [];
  ```
  Verify:
  ```bash
  git show HEAD:apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts
  ```

- **Root cause.** `scripts/src/lib/ops/collect_lpc_assets.ts:39-75` scans a
  checkout that lives **outside the repo**
  (`../../../../examples/Universal-LPC-Spritesheet-Character-Generator/spritesheets`)
  and writes both the webp assets into `apps/frontend/client/static/game-data/lpc/`
  (gitignored since C-435, `.gitignore:255`) and the TypeScript catalog into
  `apps/frontend/client/src/lib/data/` (committed). Re-running the generator on a
  machine without the upstream checkout emits an empty catalog, and that empty
  catalog was committed. There is no CI gate that would have caught it.

- **Blast radius — every consumer resolves against nothing:**
  | Consumer | Line |
  |---|---|
  | `views/onboarding/onboarding_appearance_step_view.svelte` | 58 |
  | `views/onboarding/onboarding_review_view.svelte` | 45 |
  | `views/character/persona/create/persona_create_view_model.svelte.ts` | 35, 752 |
  | `data/ai_prompts/character_extraction_schema.ts` | 93 — the LLM prompt now lists zero asset ids |
  | `services/game/game_boot_service.svelte.ts` | 983 |
  | `services/game/game_engine_service.svelte.ts` | 734 |
  | `views/dev/lpc/lpc_view_model.svelte.ts` | 40 |
  | `views/dev/lpc_ai/lpc_ai_test_view_model.svelte.ts` | 58 |
  | `views/dev/sandbox/shared/lpc_sandbox_resolver.ts` | 13, 42 |

  **Cascading imports**: deleting `lpc_models.ts` and `lpc_tags.ts` also breaks
  ~7 additional files that import from them directly (sandbox ViewModels,
  `lpc_character_renderer.svelte`, `lpc_animation_debug_controller.ts`,
  `asset_store.test.ts`). All must be updated to import from `@aikami/lpc`.

- **Four LPC implementations exist, and they have drifted:**
  1. `apps/frontend/client/src/lib/data/lpc_models.ts` — hand-copied mirrors of
     `LpcAnimationState`, `LpcDirection`, `getLpcStateRow`. Its own docblock
     states the reason: *"We define them locally to avoid statically importing
     the full engine bundle (which triggers INEFFECTIVE_DYNAMIC_IMPORT warnings)."*
  2. `apps/frontend/client/src/lib/data/lpc_renderer.ts` (432 lines) — a second
     texture-load / frame-extract / sprite-build pipeline alongside the engine's
     `rendering/sprite_composer.ts` + `rendering/texture_manager.ts`.
  3. `packages/frontend/engine/src/rendering/lpc_appearance_resolver.ts` —
     C-400's unified resolver.
  4. `apps/frontend/client/src/lib/views/dev/sandbox/shared/lpc_sandbox_resolver.ts:44`
     — a **fourth** resolver that still contains the hard-coded head override
     `effectiveIdx = 94` that C-400's docblock explicitly says was removed
     (*"No head override. The old `effectiveIdx = 94` correction is removed."*).

- **Existing implementation to reuse — the real source of truth already exists.**
  The published index at `index/v1/catalog.json` + its `lpc__*` shards carries
  every LPC tag with `tag`, `hash`, `sizeBytes`, `category`, `subcategory`,
  `ext`, `licenses`, `authors`, `sourceUrls`
  (`packages/shared/schemas/src/lib/catalog/catalog_index.ts:97`). Tag ↔ path
  conversion already exists in `packages/shared/constants/src/lib/game_assets.ts`
  (`tagToAssetPath`, `splitStateSegments`, `r2AssetUrl`). Nothing new needs
  to be scanned or hashed.

- **Known gaps**: no function converts catalog index entries into
  `LpcSlotDefinition[]`; no package exists that hub, client, worker, and node
  scripts can all import without pulling PixiJS.

- **Baseline tests**: `bun test packages/shared/schemas/src/lib/catalog/`,
  `bun test packages/frontend/engine/src/__tests__/`, and
  `bun test apps/frontend/client/src/lib/data/`. Run them before starting.

## User Outcome

After this contract, a **developer** changes LPC slot logic in exactly one
place and the hub, the client dev routes, the game, the simulation worker, and
the node validation scripts all observe the change — and a **player** sees a
populated character creator again, because the slot catalog is derived from the
same published bytes the game loads instead of from a committed snapshot of a
directory that no longer ships.

## Success Measures

- **Time/latency target**: `buildLpcCatalog` over the full LPC entry set
  (~12,700 entries) completes in under 150 ms on a cold call, and is memoised
  per entry-set identity thereafter.
- **Offline/degraded behavior**: with no catalog available, `buildLpcCatalog`
  returns an empty catalog and every consumer renders its existing empty state.
  It never throws. (Cold-offline boot is out of scope — see C-448.)
- **Production journey enabled**: character creation and onboarding list real
  LPC variants again.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Animation state / direction enums | `packages/frontend/engine/src/rendering/animation_controller.ts` | **modify** — move enums + pure helpers to `@aikami/lpc`, re-export from engine |
| Sheet geometry resolution | `packages/frontend/engine/src/rendering/lpc_sheet_geometry.ts` | **modify** — move verbatim (already dependency-free) |
| Layer z-order table | `packages/frontend/engine/src/rendering/lpc_layer_order.ts` | **modify** — move verbatim (only imports `$logger`) |
| Appearance resolution | `packages/frontend/engine/src/rendering/lpc_appearance_resolver.ts` | **modify** — move; keep `createLpcPipeline` behind in engine if it touches Pixi |
| Tag mapping | `apps/frontend/client/src/lib/data/lpc_tags.ts` | **modify** — move to `@aikami/lpc` |
| Enum mirrors | `apps/frontend/client/src/lib/data/lpc_models.ts` | **replace** — delete, import from `@aikami/lpc` |
| Generated slot catalog | `apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts` | **replace** — delete, derive at runtime |
| Client catalog facade | `apps/frontend/client/src/lib/data/lpc_asset_catalog.ts` | **modify** — update imports from `lpc_models`/`lpc_tags` to `@aikami/lpc`; keep client-specific wiring (`getLpcAssetPath`, `wireLpcUrlResolver`) |
| URL config | `apps/frontend/client/src/lib/data/lpc_url_config.ts` | **modify** — update `LpcAnimationState`/`LpcDirection` import from `lpc_models` to `@aikami/lpc` |
| Renderer imports | `apps/frontend/client/src/lib/data/lpc_renderer.ts` | **modify** — update `LpcAnimationState`/`LpcDirection`/`lpcStateSuffix` imports from `lpc_models`/`lpc_tags` to `@aikami/lpc` |
| Sandbox resolver | `views/dev/sandbox/shared/lpc_sandbox_resolver.ts` | **replace** — delete, call `resolveLpcAppearance` |
| Catalog index entries | `packages/shared/schemas/src/lib/catalog/catalog_index.ts` | **reuse** unchanged |
| Tag ↔ path helpers | `packages/shared/constants/src/lib/game_assets.ts` | **reuse** unchanged |

## Overview

Create `packages/shared/lpc` (`@aikami/lpc`) — a dependency-free package that
owns the LPC domain model: slot definitions, animation state and direction,
tag mapping, spritesheet geometry, layer z-order, and appearance resolution.
Add `buildLpcCatalog`, which folds `CatalogAssetEntry[]` into
`LpcSlotDefinition[]` at runtime, replacing the committed generated snapshot.
Delete the three duplicate implementations and repoint all nine consumers.
The upstream collector keeps producing assets and credits; it stops producing
TypeScript.

## Design Reference

- Package scaffolding: copy the shape of `packages/shared/parser/`
  (`package.json`, `tsconfig.json`, `moon.yml`). Note its `$logger` path
  mapping — `@aikami/lpc` needs the same one. Tests go in `tests/` at root
  (matching the parser pattern), not in `src/lib/__tests__/`.
- Purity discipline: `packages/frontend/engine/src/assets/asset_manifest.ts`
  documents the "node-only code is NOT re-exported from the barrel" pattern.
  `@aikami/lpc` takes the stronger position: **no** impure code may enter it.
- Resolver semantics: preserve every load-bearing convention documented in the
  `lpc_appearance_resolver.ts` header — 1-indexed layer values, index `0` means
  intentionally empty, every slot has a declared fallback, no head override.
  Move that docblock with the code.
- Type consolidation: `LpcLayerRole` is currently defined in three places
  (`lpc_layer_order.ts`, `components/appearance.ts`, and the new `slot_model.ts`).
  Define it once in `slot_model.ts`; `lpc_layer_order.ts` imports it from there.
  The engine barrel re-exports from `@aikami/lpc`.
- Enum vs const object: `LpcAnimationState` is a TypeScript `enum` in
  `animation_controller.ts`. Since `@aikami/lpc` is a pure package, convert
  it to a `const` object (matching the pattern already used in
  `lpc_models.ts`). TypeScript `enum`s are not forbidden but a `const` object
  avoids the dual nature (value+type) and is more portable.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- `@aikami/lpc` MUST NOT depend on `pixi.js`, `bitecs`, `svelte`, `node:fs`,
  `node:path`, or any `apps/**` module. Permitted dependencies:
  `@aikami/constants`, `@aikami/schemas`, `@aikami/types`, `$logger`.
- The engine re-exports the moved symbols from its existing barrel so no
  engine-internal call site changes in this contract. C-443 narrows that.
- `LpcLayerRecipe` moves to `@aikami/lpc`;
  `packages/frontend/engine/src/components/appearance.ts` imports and re-exports
  it, so the ECS component keeps its current public shape.
- `buildLpcCatalog` is a **pure function of its input entries** — it performs
  no fetch, reads no global, and touches no store. Callers supply entries.
- Slot derivation is driven by the tag structure, not by a hard-coded list:
  an entry with tag `lpc:<slot>:<...path>:<state>` contributes `<slot>` and the
  assetId `<slot>/<...path>`. Ordering within a slot is lexicographic by
  assetId so the derived index is stable across publishes.
- **Variant index stability is a save-compat invariant.** Saved appearances
  store 1-indexed variant numbers. Derived ordering MUST be deterministic and
  documented; a test asserts the same entry set always yields the same order.
- `collect_lpc_assets.ts` stops writing
  `apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts`. It keeps
  writing assets, `lpc_credits.json`, and `lpc_credits_supplement.json`.

## State & Data Models

```ts
// packages/shared/lpc/src/lib/slot_model.ts

/** Which side of the body a sheet draws on. */
export type LpcLayerRole = 'behind' | 'front';

/** One selectable variant within a slot. */
export type LpcSlotVariant = {
  /** Path-form id, e.g. "hair/bangslong2/bg_adult". */
  readonly assetId: string;
  /** Human label derived from the last path segment. */
  readonly label: string;
  readonly layerRole: LpcLayerRole;
  /** Complementary variant when this sheet is half of a bg/fg pair. */
  readonly pairedAssetId?: string;
  /** Animation states this variant actually has sheets for. */
  readonly states: readonly string[];
};

/** One slot and its ordered variants. Order is the save-compat contract. */
export type LpcSlotDefinition = {
  readonly slot: string;
  readonly label: string;
  readonly variants: readonly LpcSlotVariant[];
};

/** The whole derived catalog. */
export type LpcCatalog = {
  readonly slots: readonly LpcSlotDefinition[];
  readonly assetIdsBySlot: Readonly<Record<string, readonly string[]>>;
  /** Every assetId, flat — used by prompt building and validation. */
  readonly allAssetIds: readonly string[];
};
```

```ts
// packages/shared/lpc/src/lib/build_catalog.ts
import type { CatalogAssetEntry } from '@aikami/schemas';

/**
 * Folds published catalog entries into the LPC slot catalog.
 * Pure, deterministic, and safe to call with an empty array.
 */
export const buildLpcCatalog = (options: {
  entries: readonly CatalogAssetEntry[];
}) => LpcCatalog;
```

```ts
// packages/shared/lpc/src/index.ts — public surface
export { buildLpcCatalog } from './lib/build_catalog.ts';
export { LpcAnimationState, LpcDirection, getLpcStateRow, getLpcFrameIndex,
         velocityToDirection } from './lib/animation.ts';
export { lpcTag, lpcStateSuffix, type LpcTag } from './lib/tags.ts';
export { resolveLpcSheetGeometry, type LpcSheetGeometry,
         type LpcCellFamily } from './lib/sheet_geometry.ts';
export { LPC_LAYER_ORDER, resolveLayerDepth, resetUnknownSlotWarnings,
         sortLayersByDepth, getMaxKnownDepth, type LpcLayer,
         type LpcLayerOrderEntry, type LpcSlot } from './lib/layer_order.ts';
// LpcLayerRole is defined in slot_model.ts; layer_order.ts imports it from there.
export { resolveLpcAppearance, resetLpcFallbackWarnings, projectLpcCatalog,
         LPC_SLOT_ORDER, DEFAULT_LPC_SLOT_FALLBACKS,
         type LpcAppearanceResult, type LpcLayerRecipe, type LpcSlotName,
         type LpcSlotCatalog, type LpcSlotFallbacks, type LpcSlotResolution,
         type ResolveLpcAppearanceOptions } from './lib/appearance.ts';
export type { LpcCatalog, LpcSlotDefinition, LpcSlotVariant,
              LpcLayerRole } from './lib/slot_model.ts';
```

## Quality Requirements

- **Offline/degraded mode**: `buildLpcCatalog({ entries: [] })` returns an empty
  catalog without throwing; consumers render existing empty states. No consumer
  may crash on an empty catalog.
- **Accessibility/input**: N/A — no UI change.
- **Performance budget**: build over ~12,700 entries under 150 ms; memoised
  per entry-set so repeated calls are O(1).
- **Security/privacy**: N/A — public asset metadata only.
- **Persistence/migration**: **load-bearing.** Existing saves hold 1-indexed
  variant numbers against the old generated ordering. See Migration & Rollback.
- **Cancellation/retry/idempotency**: pure function, trivially idempotent.
- **Observability**: `buildLpcCatalog` logs once at `info` with slot count,
  variant count, and entry count. Unparseable tags log once at `debug` with the
  tag, and are skipped — never thrown.

## Migration & Rollback

- **Old data compatibility**: the previous generated ordering came from a
  directory walk of the upstream checkout. Derived ordering is lexicographic by
  assetId. These can differ, which would silently re-skin existing characters.
  **Required**: capture the last non-empty generated catalog from git history
  ```bash
  git log --oneline -- apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts
  git show <sha>:apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts
  ```
  and commit it as a **test fixture only** at
  `packages/shared/lpc/tests/__fixtures__/legacy_catalog_order.json`. A test
  asserts the derived order matches the legacy order for every slot. Where it
  cannot match, the contract adds an explicit remap table rather than accepting
  the drift.
- **Migration**: none at runtime if the order test passes. If a remap is needed,
  it applies at appearance-load time in `resolveLpcAppearance`, keyed by a
  `catalogOrderVersion` field on the save.
- **Rollback**: revert the PR. The generated file returns (empty) and behaviour
  returns to the current broken baseline — no worse.
- **Feature flag or kill switch**: none. A flag would mean keeping the dead
  generated file alive, which is the thing being removed.
- **Failure recovery**: `buildLpcCatalog` never partially succeeds — it either
  returns a complete catalog for the entries given or an empty one.

## Scope Boundaries

- **In Scope:**
  - New package `packages/shared/lpc` with `package.json`, `tsconfig.json`,
    `moon.yml`, `src/index.ts`, `src/lib/*`, and tests.
  - Register `lpc: "packages/shared/lpc"` in `.moon/workspace.yml`.
  - Move (not copy) the four pure engine modules listed in the Reuse Map.
  - New `buildLpcCatalog`.
  - Delete `lpc_models.ts`, `lpc_tags.ts`, `lpc_asset_catalog_generated.ts`,
    `lpc_sandbox_resolver.ts`.
  - Modify `lpc_asset_catalog.ts`, `lpc_url_config.ts`, `lpc_renderer.ts`,
  `lpc_character_renderer.svelte`, `lpc_animation_debug_controller.ts`,
  and all sandbox/character/vendor ViewModels to import from `@aikami/lpc`
  instead of deleted `lpc_models.ts`/`lpc_tags.ts`.
  - Repoint all consumers of the generated catalog and the deleted files.
  - Stop `collect_lpc_assets.ts` from emitting TypeScript.
  - Legacy-order fixture test.
- **Out of Scope:**
  - `lpc_renderer.ts` — the Pixi texture pipeline. It stays where it is and
    keeps working; C-445 folds it into the preview package.
    **However**, `lpc_renderer.ts` imports `LpcAnimationState`/`LpcDirection`
    from `lpc_models.ts` and `lpcStateSuffix` from `lpc_tags.ts` — both
    deleted by this contract. These imports must be updated to `@aikami/lpc`
    as part of Phase 2 (consumer repointing), even though the renderer
    itself is out of scope for the larger refactor.
  - Engine subpath exports — C-443.
  - Turning `setLpcUrlResolver` into a parameter — C-444.
  - Any hub route or component.
  - Any change to the publish pipeline or the R2 bucket layout.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — one LPC domain model, derived from the
published index. Splitting "create the package" from "delete the duplicates"
would leave two competing code paths live, which the split rule forbids. The
Pixi renderer is deliberately excluded because it *is* independently mergeable.

## Acceptance Criteria

### AC-1: The package is pure
**Given** the new `@aikami/lpc` package
**When** its dependency graph is walked transitively from `src/index.ts`
**Then** no module resolves to `pixi.js`, `bitecs`, `svelte`, `node:fs`, or
`node:path`, and `packages/shared/lpc/package.json` declares none of them.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/lpc/tests/purity.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run lpc:test`
- Integration: `bun run --bun -e "import('@aikami/lpc')"` in a bare Node context
  resolves without a DOM or a bundler.

**Watch Points**:
- `$logger` maps to `logger_browser.ts` in the engine tsconfig but to
  `logger/src/index.ts` in shared packages. Use the shared-package mapping so
  the package stays runnable under Node.

---

### AC-2: The catalog derives from published entries
**Given** a fixture array of `CatalogAssetEntry` values covering
`lpc:body:*`, `lpc:hair:*`, `lpc:torso:*`, `lpc:legs:*`, `lpc:feet:*`, `lpc:head:*`
across several animation states
**When** `buildLpcCatalog({ entries })` is called
**Then** it returns one `LpcSlotDefinition` per distinct slot, each variant
appears exactly once regardless of how many state sheets it has, `states` lists
every state seen for that variant, and `allAssetIds` contains every assetId
exactly once.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/shared/lpc/tests/build_catalog.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run lpc:test`

**Watch Points**:
- `lpc:body:bodies_male:walk` and `lpc:body:bodies_male:slash` are the **same
  variant**, two states. Collapsing on the state segment is the whole job.
- Tags whose shape does not match `lpc:<slot>:<...>:<state>` are skipped with a
  `debug` log, never thrown.

---

### AC-3: Derived ordering matches the legacy generated ordering
**Given** the legacy catalog fixture recovered from git history
**When** `buildLpcCatalog` runs over the catalog entries for the same asset set
**Then** for every slot present in both, the ordered `assetId` sequence is
identical, so a saved 1-indexed variant number resolves to the same asset.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `packages/shared/lpc/tests/legacy_order.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run lpc:test`

**Watch Points**:
- If the orders genuinely cannot be reconciled, **do not** relax this test.
  Add an explicit remap table and a test that proves the remap restores
  equivalence. Silently accepting a different order re-skins every existing
  character.

---

### AC-4: The empty catalog never crashes a consumer
**Given** `buildLpcCatalog({ entries: [] })`
**When** each of the nine consumers is exercised with the resulting catalog
**Then** each renders its empty/placeholder state and no unhandled error is
thrown or logged at `error`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `packages/shared/lpc/tests/empty_catalog.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run lpc:test`, `moon run client:test`

**Watch Points**:
- This is today's production state. The test locks in that it degrades
  gracefully rather than regressing to a crash.

---

### AC-5: The duplicates are gone
**Given** the merged branch
**When** the repo is searched
**Then** these files do not exist:
`apps/frontend/client/src/lib/data/lpc_models.ts`,
`apps/frontend/client/src/lib/data/lpc_tags.ts`,
`apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts`,
`apps/frontend/client/src/lib/views/dev/sandbox/shared/lpc_sandbox_resolver.ts`
— and `rg "effectiveIdx = 94"` returns zero hits.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `packages/shared/lpc/tests/no_duplicates.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon check`
- Integration: `rg -n "lpc_models|lpc_asset_catalog_generated|lpc_sandbox_resolver|effectiveIdx = 94" apps packages scripts`
  returns nothing.

**Watch Points**:
- The sandbox resolver's callers expect a `(layerIds: readonly number[]) => LpcLayerRecipe[]`
  signature. `resolveLpcAppearance` has a different shape — write the adapter
  at the call site, do not resurrect the file.

---

### AC-6: The collector stops emitting TypeScript
**Given** `scripts/src/lib/ops/collect_lpc_assets.ts`
**When** it runs against a valid upstream checkout
**Then** it writes assets, `lpc_credits.json`, and `lpc_credits_supplement.json`,
and does **not** write any file under `apps/frontend/client/src/`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | `scripts/src/lib/ops/__tests__/collect_lpc_assets_outputs.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run scripts:test`

**Watch Points**:
- `scripts/src/lib/ops/validate_content_appearance.ts` references the
  generated file path in a comment (line 9) and in the `GENERATED_CATALOG`
  constant (line 34). Update both to describe `buildLpcCatalog` and remove
  the hard-coded path.

---

### AC-7: Character creation lists real variants again
**Given** a client build with a reachable catalog origin
**When** the player opens the persona creation screen
**Then** each LPC slot lists a non-empty variant set, and the rendered preview
shows a composed character rather than a blank canvas.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | E2E | `apps/e2e/tests/client/persona_create.spec.ts` | `/character/persona/create` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:build`
- E2E / Visual:
  - **Functional**: `apps/e2e/tests/client/persona_create.spec.ts` — assert at
    least one slot selector has >1 option and that changing a slot changes the
    preview canvas hash.
  - **Visual**: N/A — C-445 owns the preview visual suite.

**Watch Points**:
- This AC needs a reachable `PUBLIC_ASSETS_BASE_URL`. In CI, serve the fixture
  index from a local static server rather than hitting production R2.

## Implementation Sequence

1. **Phase 1 (Package)** — scaffold `packages/shared/lpc` from
   `packages/shared/parser`. Move the four pure engine modules in. Add
   `slot_model.ts`, `build_catalog.ts`, `tags.ts`, `animation.ts`. Write AC-1,
   AC-2, AC-3, AC-4 tests. The engine re-exports everything it moved, so the
   engine still typechecks unchanged.
2. **Phase 2 (Consumers)** — repoint all consumers. Client call sites now
   build the catalog from `assetStore` entries once and pass it down. Update
   every file that imports from `lpc_models.ts` or `lpc_tags.ts` (~16 files)
   to import from `@aikami/lpc` instead. Delete the four duplicate files.
   Write the AC-5 test.
3. **Phase 3 (Collector)** — strip TypeScript emission from
   `collect_lpc_assets.ts`. Write the AC-6 test. Update the stale comment in
   `validate_content_appearance.ts`.
4. **Phase 4 (Validation)** — `bun run fix && bun moon run :validate && bun run test`,
   then the AC-7 E2E.

## Edge Cases & Gotchas

- **Where do client call sites get entries from?** `assetStore` exposes the boot
  seed, which carries `tag`/`ext`/`category` but not `licenses`/`authors`.
  `buildLpcCatalog` only needs `tag`, `category`, and `ext` — type its parameter
  as a structural subset (`Pick<CatalogAssetEntry, 'tag' | 'category' | 'ext'>`)
  so both the seed rows and full index entries satisfy it. Do not force callers
  to fetch full shards just to build slot lists.
- **Paired bg/fg sheets.** The legacy catalog carried `layerRole` and
  `pairedAssetId`, derived by the collector from filename prefixes (`bg_`/`fg_`).
  The published tags preserve those prefixes, so derive the same way. C-431
  (`collect-lpc-behind-pass`) is the reference for the naming rule.
- **`getLpcCatalogPrompt()`** is consumed by
  `data/ai_prompts/character_extraction_schema.ts:93` at **module scope** today.
  It must become a function of the catalog, called after the catalog is built —
  otherwise the prompt is captured before any entries exist and the bug survives
  the refactor in a new shape.
- **Memoisation identity.** Memoise on the entries array reference, not a deep
  hash. A deep hash over 12,700 entries defeats the point.
- **Do not move `createLpcPipeline`.** It lives in
  `lpc_appearance_resolver.ts` and builds a client-side pipeline. If it touches
  Pixi or a store, leave it in the engine and move only the pure resolver
  alongside it.
- **`resetLpcFallbackWarnings` moves with the resolver.** The module-level
  `_loggedFallbackKeys` Set and its reset function are part of the pure
  resolver — they move to `@aikami/lpc` alongside `resolveLpcAppearance`.
  The engine barrel re-exports it.

## Open Questions

Must be resolved before status becomes `approved`:

- None. Catalog derivation strategy decided 2026-08-26: derive at runtime from
  the published catalog index; no committed snapshot.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
