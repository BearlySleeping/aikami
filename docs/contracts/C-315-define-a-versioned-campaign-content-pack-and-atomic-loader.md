# Contract C-315: Define a Versioned Campaign Content Pack and Atomic Loader

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | `packages/shared/schemas/src/lib/content_pack.ts`, `packages/shared/types/src/lib/content_pack.ts`, `packages/frontend/engine/src/assets/content_pack_loader.ts`, `apps/frontend/client/static/content-packs/emberwatch/` |
| **Priority** | P0 — production currently hardcodes a sandbox map while content pack identity (`contentPackId`) is an orphaned string with no resolver or manifest |
| **Dependencies** | C-135 ✅, C-136 ✅, C-138 ✅, C-175 ✅, C-210 ✅, C-243 ✅, C-313 🟡 implemented, C-314 🟡 implemented |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | None — internal infrastructure |
| **Contract version** | 2.0.0 |

## Prior-stage Feedback

This contract was revised by Contract Writer v2 to address critique from the prior pipeline stage. Changes are recorded in the current Amendments table.

## Problem & Baseline Evidence

- **Current behavior**: The game engine boots by hardcoding `DefaultStartingMap = '/assets/maps/sandbox_zone_a.json'` at `game_engine_service.svelte.ts:426`. Every map URL, NPC definition, and dialogue line is either baked into static `.json`/`.jton` files or hardcoded in engine code. The `contentPackId: 'emberwatch'` field on `Campaign` (C-313) is a dead string — nothing reads it or resolves it to actual world data. There is no versioning, no atomic pack loading, and no mechanism to swap content packs.

- **Reproduction**:
  1. Open `game_engine_service.svelte.ts:426` — `DefaultStartingMap` is a hardcoded literal.
  2. Open `campaign_service.svelte.ts:126` — `contentPackId: 'emberwatch'` is set on every new campaign but never consumed by the engine.
  3. Navigate `/game` — the engine always loads `sandbox_zone_a.json` regardless of campaign or content pack selection.
  4. There is no `static/content-packs/` directory. Maps live at `apps/frontend/client/static/assets/maps/` as standalone files.
  5. NPC dialogue, quest hooks, and item definitions are scattered across Tiled object layers and engine systems — nothing ties them to a single versioned pack.

- **Existing implementation to reuse**:
  - Campaign schema C-313: `contentPackId` field already exists on `Campaign` (`packages/shared/schemas/src/lib/campaign.ts:41`)
  - Map loading pipeline: `map_loader.ts` supports Tiled JSON + JTON with in-memory caching and a `clearMapCache()` module-level reset
  - Asset manifest system C-243: `asset_manifest.ts` scans directories, builds tag→path indexes, validates via TypeBox schemas — same pattern applies to content packs
  - JTON parser C-175: `jton_parser.ts` fast block-based parser with spawn/transition extraction
  - Entity spawner C-136: `entity_spawner.ts` creates NPCs, enemies, props, items from `SpawnPoint[]`
  - Composition root C-314: `GameCompositionRoot` wires campaign → engine boot in `game_composition_root.svelte.ts`
  - SvelteKit `static/` directory convention: files under `static/` are served at `/` in dev, bundled verbatim in production, and available under `asset:` protocol in Tauri. Existing maps at `static/assets/maps/`, assets at `static/game-assets/`. Content packs follow this same convention: `static/content-packs/<id>/`.

- **Known gaps**:
  - No content pack manifest format. Maps, dialogues, NPCs are file-level artifacts with no aggregating container.
  - No versioning. Content packs cannot evolve safely because save files reference maps by hardcoded URL.
  - No atomic loader. The game engine calls `loadMap(url)` directly; loading a content pack requires sequencing multiple independent loads.
  - `contentPackId` on `Campaign` is never resolved — it is just a string.
  - `DefaultStartingMap` is hardcoded — the engine has no idea what "emberwatch" means.
  - No offline content-pack validation — invalid or missing maps fail at runtime with opaque errors.
  - **C-314 gap**: `GameCompositionRoot.initialize()` does NOT currently pass `contentPackId` to `GameEngineService`. C-315 must add this threading — it is NOT something C-314 already provides. The composition root currently owns `campaignService` as a lazy reference; `bootWithCanvas()` receives no campaign data.

- **Baseline tests**:
  - `packages/frontend/engine/src/assets/map_loader.test.ts` — existing map loader tests
  - `packages/frontend/engine/src/__tests__/jton_parser.test.ts` — existing JTON parser tests
  - `packages/shared/schemas/src/lib/campaign.test.ts` — existing campaign schema tests (verifies `contentPackId` field)
  - `apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts` — existing campaign service tests
  - `apps/frontend/client/src/lib/services/game/game_engine_service.test.ts` — existing engine service tests

## User Outcome

After this contract, a content pack is a single versioned directory with a manifest that declares maps, NPCs, dialogues, items, and entry-point metadata. The game engine boots by loading a content pack atomically — it resolves `contentPackId` from the campaign, finds the starting map, and validates all referenced files before the player enters the world. Developers can create and version content packs without touching engine code. Content packs live under `static/content-packs/` (SvelteKit static dir), are served at `/content-packs/` in dev, and bundled verbatim in Tauri production builds.

## Success Measures

- **Time/latency target**: Content pack validation + manifest load under 200ms (single file read + schema check). Map parse and spawn time is deferred to the existing C-135 + C-136 pipeline (already measured).
- **Offline/degraded behavior**: Content packs are 100% local. All files are under `static/content-packs/<id>/` (SvelteKit static directory — served at `/content-packs/` in dev, bundled verbatim in Tauri production). No network calls.
- **Production journey enabled**: A campaign with `contentPackId: 'emberwatch'` boots the Emberwatch starting map, NPCs, and dialogues — not a generic sandbox. This completes the chain: Start Menu → Campaign → Content Pack → Engine Boot → Playable World.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Campaign schema + `contentPackId` | `packages/shared/schemas/src/lib/campaign.ts:41` | Reuse — unchanged; contract adds the resolver |
| Map loading (Tiled JSON + JTON) | `packages/frontend/engine/src/assets/map_loader.ts` | Reuse — content pack loader resolves URLs; existing `loadTilemap`/`loadJtonMap` called as-is |
| Entity spawning (NPCs, enemies, props, items) | `packages/frontend/engine/src/systems/entity_spawner.ts` | Reuse — loaded via existing `extractSpawnPoints` |
| Asset manifest scanner/validator pattern | `packages/frontend/engine/src/assets/asset_manifest.ts` | Reuse — same TypeBox-validate-then-index pattern; content packs use `static/` directory convention instead of `data/` convention |
| Game composition root | `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` | **Modify** — add `contentPackId` threading from `CampaignService` into `GameEngineService.bootWithCanvas()` **(this is new work C-314 does NOT currently provide)** |
| Engine service `bootWithCanvas()` | `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts` | **Modify** — replace hardcoded `DefaultStartingMap` with content pack resolution; accept `contentPackId` parameter |

## Overview

Define a versioned content pack as a directory under `static/content-packs/<id>/` containing a `manifest.json` that declares: pack identity (name, version), maps (relative paths + entry flags), NPC definitions (ID → name, appearance, default dialogue), item definitions, dialog key → fallback strings, and the designated starting map. Create a TypeBox schema for the manifest (cross-boundary validation) with derived types. Build a module-level `loadContentPack()` factory function in the engine package that: (1) locates and validates the manifest, (2) resolves map URLs relative to the pack root, (3) provides dialogue/text fallbacks via key lookup, (4) integrates with the existing map loading pipeline. Provide `clearContentPackCache()` for lifecycle management. Wire the `contentPackId` from `CampaignService` (C-313) through the composition root (C-314) into the engine boot — replacing the hardcoded `DefaultStartingMap`.

## Design Reference

- **Schema-first pattern**: `packages/shared/schemas/src/lib/game_assets.ts` — TypeBox → `Static<>` types. Content pack manifest follows the same pattern.
- **Manifest directory structure**: `static/content-packs/<id>/manifest.json` with referenced files in subdirectories. This follows the existing SvelteKit `static/` convention — everything in `static/` is served at `/` in dev and bundled verbatim in production. Existing maps live at `static/assets/maps/`; the `emberwatch` pack references those same map files (maps are NOT duplicated).
- **Module-level function pattern**: Follow the existing `loadTilemap`/`loadJtonMap`/`clearMapCache` pattern in `map_loader.ts` — `loadContentPack()` is a module-level async factory function, not a class extending `BaseEngineClass`. Caching is module-level with a `clearContentPackCache()` reset. The returned object implements `ContentPackLoaderInterface`.
- **Asset manifest builder**: `asset_manifest.ts:buildManifest()` — reads directory, builds index, validates schema, writes manifest. Content pack loader follows a simplified version (reads existing manifest, validates, indexes).
- **Map loader API**: `loadTilemap({ url })` / `loadJtonMap({ url })` — content pack loader resolves manifest → pack-relative URLs → absolute fetch URLs.
- **campaign.ts:41**: `contentPackId: Type.String()` — the contract must resolve this field, not change it.
- **game_engine_service.svelte.ts:426**: `DefaultStartingMap` literal — the contract must replace this with pack-driven resolution.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

| What | Where | Purpose |
|---|---|---|
| `ContentPackManifestSchema` + sub-schemas | `packages/shared/schemas/src/lib/content_pack.ts` | TypeBox schema for manifest validation |
| `ContentPackManifest`, `ContentPackMapEntry`, etc. | `packages/shared/types/src/lib/content_pack.ts` | Types derived from schema via `Static<>` |
| `loadContentPack()` factory + `ContentPackLoaderInterface` + `clearContentPackCache()` | `packages/frontend/engine/src/assets/content_pack_loader.ts` | Module-level async factory (NOT a class — follows `loadTilemap`/`loadJtonMap` pattern). Returns `ContentPackLoaderInterface`. Module-level cache with `clearContentPackCache()` reset. |
| `static/content-packs/emberwatch/` | `apps/frontend/client/static/content-packs/emberwatch/` | Emberwatch stub manifest + references to existing sandbox maps. Served at `/content-packs/emberwatch/` by SvelteKit static directory. |
| Content pack loader tests | `packages/frontend/engine/src/assets/content_pack_loader.test.ts` | Schema validation, URL resolution, dialogue lookup, cache lifecycle |
| Content pack integration test (AC-4) | `packages/frontend/engine/src/assets/content_pack_loader.integration.test.ts` | CI-verifiable test: create stub emberwatch pack, load it, verify starting map resolution — proves the campaign→pack→map chain |
| `game_engine_service.svelte.ts` | `apps/frontend/client/src/lib/services/game/` | Modify — replace hardcoded `DefaultStartingMap` with content pack resolution; `bootWithCanvas()` accepts `contentPackId` |
| `game_composition_root.svelte.ts` | `apps/frontend/client/src/lib/services/game/` | Modify — thread `contentPackId` from `CampaignService.activeCampaign` into `GameEngineService.bootWithCanvas()` **(gap: C-314 does NOT currently do this)** |

**Package boundaries**: New schema + types in shared packages. New loader in engine package. Existing engine service and composition root modified. No new packages.

**🔴 No Firebase / Cloud Functions**: The content pack loader operates on local files (`static/content-packs/` directory served by SvelteKit static server), loaded via `fetch()` in browser. No backend endpoints needed.

## State & Data Models

```typescript
// ── Content Pack Manifest (top-level) ──

type ContentPackManifest = {
  /** Pack identifier — matches Campaign.contentPackId */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic version string (e.g. "1.0.0") */
  version: string;
  /** ISO 8601 timestamp of last modification */
  updatedAt: string;
  /** Map ID of the entry point — first map loaded on campaign start */
  startingMapId: string;
  /** All maps in this pack, keyed by map ID */
  maps: Record<string, ContentPackMapEntry>;
  /** NPC definitions, keyed by NPC ID */
  npcs: Record<string, ContentPackNpcEntry>;
  /** Item definitions, keyed by item ID */
  items: Record<string, ContentPackItemEntry>;
  /** Dialogue fallback strings, keyed by dialogue key */
  dialogues: Record<string, string>;
};

// ── Map Entry ──

type ContentPackMapEntry = {
  /** File path relative to the pack root (e.g. "maps/starting_village.jton") */
  file: string;
  /** Human-readable map name */
  name: string;
  /** Spawn point ID for the default entry location */
  defaultSpawnId?: string;
  /** Pixel X fallback if no spawn entity matches */
  defaultX?: number;
  /** Pixel Y fallback if no spawn entity matches */
  defaultY?: number;
};

// ── NPC Entry ──

type ContentPackNpcEntry = {
  /** Display name shown in dialog and hover */
  name: string;
  /** Default dialogue key (references dialogues{} in the manifest) */
  defaultDialogueKey?: string;
  /** Optional: appearance layer IDs for LPC sprite composition */
  appearanceLayers?: number[];
  /** Whether this NPC is a vendor */
  isVendor?: boolean;
  /** Vendor inventory reference */
  vendorInventory?: string;
};

// ── Item Entry ──

type ContentPackItemEntry = {
  /** Display name */
  name: string;
  /** Item type: 'weapon' | 'armor' | 'consumable' | 'key' | 'misc' */
  type: string;
  /** Optional numeric properties */
  attackBonus?: number;
  defenseBonus?: number;
  /** Optional reference to an equipment slot */
  equipmentSlot?: string;
};
```

TypeBox schemas for all types above go in `packages/shared/schemas/src/lib/content_pack.ts`. Derived types in `packages/shared/types/src/lib/content_pack.ts` via `Static<typeof Schema>`. Types are the **single source of truth** in `@aikami/types`; the engine may re-export them from its barrel for consumer convenience but the canonical home is `packages/shared/types/`.

```typescript
// ── Content Pack Loader Interface ──

type ContentPackLoaderInterface = {
  /** The loaded and validated manifest */
  readonly manifest: ContentPackManifest;

  /** The pack ID this loader was created for */
  readonly packId: string;

  /** Resolves the absolute URL for a map file within this pack */
  resolveMapUrl(mapId: string): string;

  /** Looks up a dialogue fallback string by key */
  getDialogue(dialogueKey: string): string | undefined;

  /** Returns the starting map entry */
  getStartingMap(): ContentPackMapEntry;

  /** Disposes per-instance resources (no-op if already disposed) */
  dispose(): void;
};

// ── Module-level API ──

/** Loads and validates a content pack manifest. Cached per packId. */
const loadContentPack = async (options: {
  packId: string;
  /** Base path to content-pack root (default: '/content-packs' for browser) */
  basePath?: string;
  /** Optional fetch override for testing */
  fetch?: typeof fetch;
}): Promise<ContentPackLoaderInterface>;

/** Clears the module-level content pack cache. Call on campaign change or engine dispose. */
const clearContentPackCache = (): void;
```

## Quality Requirements

- **Offline/degraded mode**: All content pack data is local. No network dependency. Pack loading fails fast with a clear error if the manifest is missing or invalid.
- **Accessibility/input**: N/A — this contract is data/logic only. No UI.
- **Performance budget**: Manifest load + validation under 200ms (single JSON read + TypeBox check). Resolving map URLs is O(1) hashmap lookup. No additional performance budget beyond manifest parsing — map parse and spawn time is deferred to existing C-135/C-136 pipeline.
- **Security/privacy**: Content packs live in `static/content-packs/` (SvelteKit static dir, served at `/content-packs/`). The loader validates all map URLs against the manifest registry — never resolves arbitrary paths. Path traversal is blocked: all resolved URLs must start with the pack base path. No user data in pack files.
- **Persistence/migration**: Content pack version is in the manifest. Campaigns record `contentPackId` only — not pack version. Migration of saved worlds across pack versions is C-329.
- **Cancellation/retry/idempotency**: `loadContentPack()` caches the loaded manifest per pack ID (module-level Map). Calling it twice with the same `packId` returns the cached result. `clearContentPackCache()` resets all cached manifests — call on campaign change or engine dispose. No retry needed — local file reads fail fast.
- **Observability**: Loader logs via `logger.debug('loadContentPack', { packId, version })`. Schema validation errors include the failing path via `Value.Errors()`. Cache operations logged at debug level.

## Migration & Rollback

N/A — no persistent state changes. This contract adds a new data format and loader. Existing maps at `apps/frontend/client/static/assets/maps/` are not touched. The hardcoded `DefaultStartingMap` is replaced with pack resolution. The emberwatch stub manifest references the existing sandbox map files — no map files are moved or duplicated.

## Scope Boundaries

- **In Scope:**
  - TypeBox schema for `ContentPackManifest` and all sub-types
  - Derived types in `packages/shared/types/`
  - `loadContentPack()` factory function in the engine package (module-level, NOT a class)
  - `ContentPackLoaderInterface` returned by the factory
  - `clearContentPackCache()` module-level cache reset
  - Pack directory convention: `static/content-packs/<id>/manifest.json` + `maps/`, etc.
  - Manifest validation on load (throws on invalid schema, missing `startingMapId`)
  - URL resolution (`resolveMapUrl(mapId)`) → absolute URL for `loadTilemap`/`loadJtonMap`
  - Dialogue fallback lookup (`getDialogue(key)`)
  - Starting map resolution (`getStartingMap()`)
  - Path traversal prevention: all resolved URLs must be within the pack base path
  - Wire `contentPackId` from Campaign → Composition Root → Engine init
  - Replace hardcoded `DefaultStartingMap` in `game_engine_service.svelte.ts`
  - Unit tests for schema validation, loader resolution, dialogue lookup, and cache lifecycle
  - Integration test verifying emberwatch stub → starting map resolution (CI-verifiable)
  - A minimal `emberwatch` stub manifest referencing existing sandbox maps at `static/assets/maps/`

- **Out of Scope:**
  - Authoring the full Emberwatch adventure content — C-316
  - Content pack browser/selector UI — C-317
  - Quest graph and objective data in the pack — C-324
  - Save format migration for pack version changes — C-329
  - Content pack download or cloud sync — C-340, C-352
  - Content authoring studio — C-353
  - Import/export of packs — C-354
  - Runtime hot-reloading of packs — dev-only, not required for Phase 1
  - Pack validation CLI tool — errors caught at load time
  - Bundling packs into Tauri resources beyond standard `static/` copy — C-356
  - NPC schedule/GOAP data in the pack — C-347

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract**: 5 ACs (AC-2/AC-3 merged), 2 affected projects (`packages/frontend/engine/` + `apps/frontend/client/`), one coherent system (manifest + loader + wiring). No split needed.

## Acceptance Criteria

### AC-1: Content Pack Manifest Schema Validates and Rejects Correctly
**Given** a content pack manifest JSON object
**When** it is validated against `ContentPackManifestSchema`
**Then** valid manifests pass (all required fields, valid maps/npcs/items/dialogues shapes) and invalid manifests reject with descriptive errors (missing `startingMapId`, map entries with no `file`, version not matching semver pattern, invalid map ID references).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/schemas/src/lib/content_pack.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run schemas:test`
- Integration: N/A
- E2E / Visual:
    - **Functional**: N/A — schema-only AC
    - **Visual**: N/A

**Watch Points**:
- Test a valid minimal manifest (1 map, 0 npcs, 0 items, 0 dialogues)
- Test rejection: missing `id`, missing `version`, `startingMapId` references a non-existent map key
- Test rejection: map entry `file` is empty string
- Test rejection: `version` is not a valid semver string

### AC-2: Content Pack Loader Locates, Validates, Resolves Pack Data, and Manages Cache Lifecycle
**Given** a content pack directory (via in-memory fetch mock) at `<basePath>/test-pack/` with a valid `manifest.json` and map files
**When** `loadContentPack({ packId: 'test-pack' })` is called
**Then**:
- The manifest is loaded and validated
- `resolveMapUrl('village')` returns the absolute URL constructed from the base path: `<basePath>/test-pack/maps/village.json` (browser) or filesystem path (Node.js)
- `getDialogue('greeting')` returns the fallback string
- `getDialogue('unknown')` returns `undefined` (not throw)
- `getStartingMap()` returns the correct map entry with file path and default spawn
- Calling `loadContentPack` twice with the same `packId` returns the cached instance (not re-fetching)
- `clearContentPackCache()` clears the cache; subsequent `loadContentPack` re-fetches

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/frontend/engine/src/assets/content_pack_loader.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: N/A — unit tests with in-memory fetch fixtures
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A

**Watch Points**:
- `loadContentPack` must throw if the manifest file is not found (HTTP 404)
- `loadContentPack` must throw if the manifest fails schema validation (include `packId` in error message)
- `resolveMapUrl` must throw if the map ID is not in the manifest (include mapId in error)
- The loader must NOT allow path traversal — `resolveMapUrl` must validate the resolved path starts with `basePath + packId`
- The base path can be overridden via `basePath` option (needed for Tauri resource paths, testing)
- `clearContentPackCache()` is idempotent — safe to call on empty cache
- `dispose()` on the returned loader marks it as disposed; subsequent calls throw `AppError('disposed')`

### AC-3: Content Pack Manifest Must Be in `static/` and Served by Vite/SvelteKit Static Server
**Given** the `emberwatch` stub manifest at `apps/frontend/client/static/content-packs/emberwatch/manifest.json`
**When** the client dev server runs (`bun moon run client:dev`) and a browser `fetch('/content-packs/emberwatch/manifest.json')` is issued
**Then** the file is served with HTTP 200 by SvelteKit's static file server (NOT 404).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `packages/frontend/engine/src/assets/content_pack_loader.integration.test.ts` | `/content-packs/emberwatch/manifest.json` served by SvelteKit static | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test -- --grep "integration"` (or dedicated `engine:integration:test`)
- Integration: Start dev server, `curl http://localhost:5274/content-packs/emberwatch/manifest.json` → HTTP 200 with valid JSON
- E2E / Visual:
    - **Functional**: N/A — file-serving is a dev infrastructure concern
    - **Visual**: N/A

**Watch Points**:
- The `static/` directory is the ONLY mechanism for serving content packs in dev. Vite does NOT serve files from the repo root.
- In Tauri production builds, the `static/` directory is bundled verbatim into the app — content packs are available under `asset:` protocol. The `basePath` option on `loadContentPack` abstracts this difference.
- The stub manifest must reference existing map files at `static/assets/maps/` — NOT duplicate them.

### AC-4: Engine Boot Replaces Hardcoded Map with Content Pack Resolution (CI-Verifiable)
**Given** a campaign with `contentPackId: 'emberwatch'` is active
**When** the game engine initializes via `GameEngineService.bootWithCanvas()`
**Then** the engine loads the content pack manifest for `emberwatch`, resolves the starting map from `manifest.startingMapId`, and calls `loadMap()` with that resolved URL — not the hardcoded `sandbox_zone_a.json`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Integration | `apps/frontend/client/src/lib/services/game/game_engine_service.test.ts` (updated) + `packages/frontend/engine/src/assets/content_pack_loader.integration.test.ts` | `/game` boot path | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test` — integration test loads stub emberwatch pack and verifies starting map URL
- Integration: Manual — start app in emulator mode, create a campaign, navigate to `/game`, open console — confirm `loadContentPack` log appears with `packId: 'emberwatch'` and the map URL is pack-resolved
- E2E / Visual:
    - **Functional**: N/A — full E2E boot is C-321
    - **Visual**: N/A

**Watch Points**:
- The hardcoded `DefaultStartingMap` literal at `game_engine_service.svelte.ts:426` must be removed
- **🔴 C-314 gap**: `GameCompositionRoot.initialize()` does NOT currently pass `contentPackId` to `GameEngineService`. C-315 must add this threading — it is new work this contract provides, NOT something C-314 already handles.
- Fallback: if no campaign is active (direct `/game` navigation), the engine must fall back to `contentPackId: 'emberwatch'` as the default — not crash
- If the content pack manifest cannot be loaded, the engine must emit `GAME_ERROR` with a descriptive message including the `packId`
- The integration test must be CI-verifiable: it creates a stub emberwatch manifest in a temp directory or uses in-memory fetch mocking to simulate the exact path `/content-packs/emberwatch/manifest.json` → loads it → verifies `getStartingMap().file` is a real map path

### AC-5: Content Pack Types Are Available Through Shared Package (with Engine Re-export Convenience)
**Given** the `ContentPackManifest` type is defined in `packages/shared/types/src/lib/content_pack.ts` (derived from TypeBox schema in `packages/shared/schemas/`)
**When** a consumer imports `ContentPackManifest`
**Then** the type is available from `@aikami/types` (canonical source). The engine package may re-export it from `@aikami/frontend/engine` for loader consumer convenience — but the single source of truth is `@aikami/types`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `packages/frontend/engine/src/__tests__/content_pack_loader.test.ts` (or inline) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:typecheck` — verifies public API surface
- Integration: Import `ContentPackManifest` from `@aikami/types` in test — confirms canonical source
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A

**Watch Points**:
- Types must be exported as `type` exports (not value) to avoid runtime import issues
- The canonical source is `@aikami/types` (Pillar 2 — single source of truth). Engine re-exports are convenience only.
- `packages/shared/schemas/src/index.ts` and `packages/shared/types/src/index.ts` barrel exports must include the new content_pack modules

## Implementation Sequence

1. **Phase 1 (Data/Logic)**:
   - TypeBox schema in `packages/shared/schemas/src/lib/content_pack.ts`
   - Derived types in `packages/shared/types/src/lib/content_pack.ts`
   - Barrel exports in both shared packages
   - Schema unit tests
   - `loadContentPack()` factory + `clearContentPackCache()` in engine package
   - `ContentPackLoaderInterface` type
   - Loader unit tests (covers AC-1, AC-2)
   - Integration test: stub emberwatch pack → load → verify starting map URL (covers AC-3, AC-4 engine side)

2. **Phase 2 (Integration)**:
   - Create stub `emberwatch` manifest at `static/content-packs/emberwatch/manifest.json` referencing existing sandbox maps at `static/assets/maps/`
   - Modify `game_engine_service.svelte.ts` to accept `contentPackId` in `bootWithCanvas()` and call `loadContentPack`
   - **🔴 C-314 gap**: Modify `GameCompositionRoot.initialize()` to pass `contentPackId` from `campaignService.activeCampaign` to `GameEngineService.bootWithCanvas()`
   - Remove hardcoded `DefaultStartingMap`
   - Update engine service unit tests
   - Verify `curl http://localhost:5274/content-packs/emberwatch/manifest.json` → HTTP 200

3. **Phase 3 (Validation)**: `bun moon run :validate` including schemas:test, engine:test, client:test. Manual boot verification: emulator mode → New Game → /game → console confirms pack-driven map load.

## Edge Cases & Gotchas

- **Static directory serving**: Content packs MUST be inside `static/` — the ONLY directory SvelteKit serves verbatim. Files at repo root (`data/`, `content-packs/`) will 404 in the browser. Tests using `node:fs` (Bun) will pass but the browser production path will fail. All tests must use `fetch()` with correct URL paths or in-memory fetch mocking with path validation.
- **Tauri production bundles**: In Tauri, `static/` content is bundled into the app binary. Content packs are accessible via relative URLs from the SPA (no `asset:` protocol needed for fetch — SvelteKit's adapter-static copies everything). The `basePath` option on `loadContentPack` defaults to `/content-packs` for both dev and production.
- **Pack directory shipped with the app**: Content packs under `static/` are bundled automatically by SvelteKit's `adapter-static`. No additional Tauri resource configuration needed.
- **Missing pack ID fallback**: If `Campaign.contentPackId` references a pack that doesn't exist on disk, the loader must throw. The engine catches this and emits `GAME_ERROR`. The UI layer (C-317) handles surfacing the error.
- **Map file cannot be fetched**: If a map file referenced in the manifest returns 404, the existing `loadMap()` in `GameWorld` throws. This is unchanged behavior — the content pack loader just resolves the URL; the map loader handles fetch errors.
- **Content pack versioning vs save data**: The manifest has a `version` field, but campaigns only record `contentPackId`, not the version. If a content pack is updated and a save references old world data, the game may load the world from save (C-329) — pack version migration is out of scope.
- **Circle dependency**: `GameCompositionRoot` owns `GameEngineService` and passes `contentPackId`. No circular dependency — composition root is the single owner.
- **C-313 sandbox promotion**: `CampaignService` is promotion `sandbox` — tested only in dev routes. AC-4 implicitly verifies C-313 works in the production path by threading `contentPackId` through `/game` boot.
- **JTON vs Tiled JSON**: The content pack manifest is format-agnostic — `ContentPackMapEntry.file` can be `.json` (Tiled) or `.jton`. The existing map loader dispatches based on extension.
- **Stale cache on campaign change**: When the player switches campaigns, `clearContentPackCache()` must be called to prevent the old pack's manifest from being returned. The composition root's `dispose()` should call this.
- **`data/` directory does not exist at repo root**: C-243's `ensureAssetDirs()` creates `data/game-assets/` at runtime (relative to `process.cwd()`). Content packs do NOT use this convention — they are static files in the `static/` directory. Tests that create temporary pack directories must use `static/` paths or in-memory fetch mocking.

## Open Questions

None — all questions resolved:

- **Manifest file structure**: Single `manifest.json`. Splitting adds complexity with no Phase 1 benefit. Revisit if packs exceed ~500 NPCs/items.
- **Static serving path**: Content packs go in `static/content-packs/` (SvelteKit static directory). Served at `/content-packs/` in dev, bundled verbatim in Tauri production. The `basePath` parameter on `loadContentPack` defaults to `/content-packs`.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| v1.1 | 2026-07-13 | Revised per prior-stage critique: (1) static serving path resolved — packs in `static/` NOT `data/` at repo root; (2) added `clearContentPackCache()` and `dispose()` lifecycle; (3) added CI-verifiable integration test for AC-4; (4) renamed architecture directive to `loadContentPack()` factory (not class) following `loadTilemap` pattern; (5) removed unvalidated 1s performance claim from Success Measures; (6) merged AC-2/AC-3 into single loader AC with sub-watch-points; (7) clarified C-314 gap — threading `contentPackId` is new work C-315 provides; (8) AC-5 types: canonical source is `@aikami/types` with engine re-export as convenience | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
