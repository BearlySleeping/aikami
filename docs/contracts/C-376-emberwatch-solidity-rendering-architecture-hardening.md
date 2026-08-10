---
id: C-376
title: "Emberwatch Solidity & Rendering Architecture Hardening"
source: "prompt (direct draft) + external architecture review (claude CLI, pre-implementation)"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-10"
---

# Contract C-376: Emberwatch Solidity & Rendering Architecture Hardening

## Metadata

| Field | Value |
|---|---|
| **Source** | Direct draft from pipeline run `run-msncxxwc-C-376` + external architecture review by claude CLI (verdict incorporated below) |
| **Target** | `packages/frontend/engine/src/` — collision grid derivation, worker LOAD_MAP plumbing, depth ordering, dead-code removal; `packages/shared/schemas/` + `packages/shared/types/` — `PackConfigSchema`/`PackConfig`; `apps/frontend/client/src/lib/services/game/` — packConfig plumbing; `scripts/src/lib/ops/` — generator table derivation |
| **Priority** | P1 — an armed correctness landmine (default `waterGids = Set([2])` blocks walkable grass), a mask-blind `isWalkable` bug, three sources of truth for solidity, and an O(n²) render path on the shipped C-375 core |
| **Dependencies** | C-375 (merged via PR #122 — substrate, same files; contract file frontmatter still says `draft` but the metadata table says `approved` and the code is in HEAD); C-372 (implemented — mirror for packConfig posting); C-315, C-316, C-173, C-370, C-331 (completed/verified/approved — unchanged) |
| **Status** | approved |
| **Promotion** | `integrated` — no dev sandbox required; the production `/game` route + E2E + visual suite are the evidence (C-375 gate re-run) |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

All findings verified against the current tree (C-375 merged via PR #122, squash commit `cc506d15`; the PR-branch commit `f87cdabf` is not in HEAD's ancestry — line references below are against the merged tree).

### 🔴 A. Correctness landmines

**A1. `waterGids` default is stale tileset knowledge — armed in production code.** `map_loader.ts:675` defaults `waterGids` to `new Set([2])`; `game_world.ts:2038-2039` exposes the option; the real-game wrapper `game_engine_service.svelte.ts:339-373` never exposes or overrides it, so **every production map load runs the `Set([2])` merge**. In the C-375 atlas, GID 2 = `grass_variant.png`, declared `isWalkable: true` in `manifest.json` (`tiles["2"]`). The 3 committed maps contain **zero** GID 2 tiles today (verified: village/inn/merchant_shop all 0), so the bug is *armed but not detonated* — the moment the generator emits GID 2 (`generate_emberwatch_maps.ts:25` lists `GRASS_VARIANT: 2`), every grass-variant tile becomes an invisible wall. The audit test cannot catch it (it compares manifest ↔ collision layer, never the runtime water merge). Existing coverage that *bakes in the wrong default*: `map_loader.test.ts:954` ("merges water tiles (GID 2) ... keeping grass (GID 1) walkable" — a C-178 debug-tileset test).

**A2. `isWalkable()` short-circuits past the boolean grid.** `collision_system.ts:189-204`: when a cell's spatial-grid linked list is non-empty and **no occupant carries `CollisionLayer.wall`**, it returns `true` without consulting the boolean grid. NPCs spawn with `CollisionLayer.npc` (`entity_spawner.ts:387`), so an NPC standing on a solid tile reports that tile walkable. The player is shielded (movement ORs `isCellBlocked(...) || !isWalkable(...)`, `movement_system.ts:193,235`), but:
- `ecs_worker.ts:1950,1968` (LOAD_MAP spawn clamp) uses bare `isWalkable` — a save/transition can clamp the player into a wall hosting an NPC;
- `turn_manager_system.ts:1948` (`_checkWalkable`) and `goap_combat_tactics_system.ts:129,272` also call bare `isWalkable` — they see NPC-occupied solid tiles as walkable, and (worse, after this contract's semantic change) solid-prop-occupied tiles must be re-audited (see AC-3).

### 🟠 B. Architectural debt — three sources of truth for solidity

1. `CollisionGrid.grid` boolean[] ← map `collision` layer + `waterGids` merge (`map_loader.ts:665-717`)
2. `_spatialGrid` Uint32Array + `CollisionData.layer` ← entities (`collision_system.ts:69`)
3. `manifest.tiles[].isWalkable` / `props[].isWalkable` ← hand-authored manifest (`content_pack.ts:707-733`)

Nothing in runtime code reconciles 1↔3 — only the audit test does. A **fourth consumer** exists and is unnamed in the draft: the JPS pathfinder and vision/FOV closures in `ecs_worker.ts:1918-1943` read `collisionGrid.grid[...]` directly (they stay on the boolean grid by design — see Follow-ups).

**B2. The manifest can't reach the worker.** `propWalkability` is hand-smuggled: `game_engine_service.svelte.ts:456-464` (`_buildPropWalkability`) → `game_world.ts:2100-2111` (enrichment onto spawn-point `properties`) → read back in `entity_spawner.ts:627`. Every future manifest-driven property (collision rects, movement cost, interaction radius) needs its own bespoke side channel. The manifest's `props[].collision` discriminated union already exists in the schema (`content_pack.ts:648-658`) but is unreachable at runtime.

### 🟠 C. Performance

**C1. Depth sort reparenting + full display-list churn.** `game_world.ts:2500-2533` re-appends entity containers whenever the y-order changes (guarded by `_entityRenderOrder` cache added in C-375, but with >1 moving entity at different speeds the order changes most frames). Each `removeChild` is O(n) in Pixi v8 (`indexOf`+`splice`) → O(n²) total, plus `childAdded/Removed` events and display-list invalidation. Pixi's `zIndex` + `sortableChildren = true` sorts in place with a stable sort — no `sortableChildren` is used anywhere today (`weather_overlay.ts:399` sets `zIndex` on an unrelated mesh). C-375's contract explicitly chose the explicit-list approach ("prefer the explicit list to keep camera/tilemap layering at index 0 intact") — this contract deliberately revises that decision.

**C2. O(w×h) dead loop on every map load.** `_populateWallsFromCollisionGrid` (`collision_system.ts:459-481`) iterates every solid cell and writes `_spatialGrid[flatIndex] = 0` — zero over zero. Its own doc comment (`:475-476`) states walls were always intended to be **real entities** ("scaffolded for future wall entity creation") — C-173's plan, never finished. Note: `setCollisionGrid` is called without `world` at both production sites (`ecs_worker.ts:636, 1894`).

### 🟡 D. Dead/duplicate code & DX

- **D1. `render_system` prop branch is a dead twin** — `_loadVisualTextureAsync` (`render_system.ts:209-272`) takes `propFrameResolver` that nothing in production passes; if ever wired it hits the `no propFrameResolver wired` error branch (`:235`). It still does `void import('pixi.js')` per prop (`:259`). (The `:287` dynamic import is the separate LPC-appearance path — out of scope.)
- **D2. `resolveMoveIntents` is an empty TODO** (`collision_system.ts:379-387`), called every tick (`ecs_worker.ts:1000`) with a fictional doc comment (`:991-999`). The whole `MoveIntent` pipeline is vestigial: `components/move_intent.ts` + `registerMoveIntentObservers` (`ecs_worker.ts:41,690`) — nothing in the codebase ever writes `MoveIntent.dx/dy` (grep-verified; only the component's own observer touches it).
- **D3. `moveInSpatialGrid` has zero production callers** (`collision_system.ts:352`) — only tests + the barrel export (`index.ts:381`).
- **D4. Audit test is O(maps) hand-maintenance** — `emberwatch_content_audit.test.ts` hardcodes the emberwatch pack dir, atlas path, and per-map expectations.
- **D5. Generator GID table triplicated** — `G` (`generate_emberwatch_maps.ts:23-66`), `FRAMES` (`generate_emberwatch_atlas.ts`), and `manifest.tiles` are three hand-synced copies of the GID↔frame mapping (GID 37–41 went missing in C-375).
- **D6. Map JSON is pretty-printed** — `village.json` 303 lines / 8.8 KB for 400 tiles; `inn.json` 230 / 6 KB, `merchant_shop.json` 240 / 6.4 KB (draft's "~830 lines" estimate was high — actual 303). Tiled natively supports `encoding: "base64", compression: "zlib"` (~90% smaller). User decision: **keep as an optional final phase**, parser must stay compatible.

### External Architecture Review (pre-implementation, per §10 process requirement)

An external reviewer (claude CLI) audited the code before this contract was written and returned a structured verdict. Incorporated decisions:

| # | Draft said | Review verdict | Decision locked in |
|---|---|---|---|
| 1 | Patch `isWalkable` fall-through | **Delete the entity branch entirely** — `isWalkable` becomes pure terrain lookup; fix bare call sites to the `isCellBlocked(...) \|\| !isWalkable(...)` composite | Adopted (AC-3) |
| 2 | Delete `_populateWallsFromCollisionGrid` as dead code | **Activate it** — create real wall entities (layer: wall) in the spatial grid; C-173's intended end-state; enables doors/bridges/destructibles as runtime layer toggles | Adopted (AC-3, user confirmed "Adopt claude fully") |
| 3 | A1 as phase 1 of C-376 | Split as urgent hot-fix | Phase 1 inside C-376 (user confirmed; armed-not-detonated) |
| 4 | Delete `resolveMoveIntents` only | Delete the **whole vestigial pipeline** (MoveIntent component + observer + call site) | Adopted (AC-5, user confirmed) |
| 5 | base64+zlib optional phase | Descope entirely | Kept as optional final phase (user overrode reviewer) |
| 6 | `Math.round(y)` zIndex key | Raw float `y` — stable sort + never-reparented containers give the tie-break free | Adopted (AC-4) |
| 7 | "Layering bands declarative" | Explicit negative zIndex constants for tilemap/debug/overlays (siblings on `_worldContainer` get sorted too) | Adopted (AC-4) |
| 8 | — | JPS/vision, render-sync, pooling: name as follow-ups; do NOT move asset loading into the worker (rendering must stay main-thread) | Adopted (Follow-ups) |

Review also confirmed: the `propWalkability` try/catch graceful degradation (`game_engine_service.svelte.ts:358-369`) must survive the packConfig migration (AC-2).

## User Outcome

A developer adding a new pack or touching a tile GID cannot accidentally create invisible walls or drift map-vs-manifest walkability — **the manifest is the single source of truth for terrain solidity, enforced at load time, not by a test**. Walls, NPCs, and props live in one spatial grid with one bitmask language, so doors/bridges/destructibles are future runtime layer toggles instead of new plumbing. The village renders and plays identically to C-375's verified state (same atlas, same maps, same collision behavior), but the engine's solidity pipeline is: (1) correct under adversarial tile usage, (2) ~linear instead of O(n²) for depth ordering, (3) free of dead loops, dead twins, and vestigial pipelines, (4) extensible to new manifest-driven properties (collision rects, movement cost, interaction radius) with zero new worker/main-thread plumbing.

## Success Measures

- **Zero behavior change**: existing emberwatch maps/atlas produce byte-identical collision grids (parity test: `buildCollisionGrid` === old `extractCollisionGrid` output on the 3 committed maps); map footprints and spawn coordinates unchanged (C-375 AC-5 save compatibility preserved).
- **Landmine removal**: a test that scatters GID 2 (grass_variant) into a map proves it stays walkable; no hardcoded GID sets remain in engine code (grep gate).
- **Perf**: depth ordering at 300 entities stays under ~1 ms/frame; zero `removeChild`/`addChild` churn on static order; no O(w×h) dead loop; no per-prop dynamic `import('pixi.js')`.
- **DX**: adding a new manifest tile/prop property requires zero worker/main-thread plumbing (packConfig already crosses once); audit becomes per-pack generic.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Tilemap parse + collision extraction | `packages/frontend/engine/src/assets/map_loader.ts` (`extractCollisionGrid` :665) | modify — add `buildCollisionGrid(tilemap, packConfig)`; delete `waterGids` param + default |
| Boolean grid → spatial grid wiring | `packages/frontend/engine/src/systems/collision_system.ts` (`setCollisionGrid` :90) | modify — pass `world`; activate wall-entity creation |
| Spatial-grid entity collision | `_addSpatialCollision` (`entity_spawner.ts:123`) | reuse — wall entities reuse the same pattern (layer/mask/GridPosition/SpatialLink + `insertIntoSpatialGrid`) |
| Depth-sort key computation | `packages/frontend/engine/src/rendering/depth_sort.ts` (`computeDepthOrder`) | reuse — kept as pure key + parity test target |
| Entity render entries + container management | `packages/frontend/engine/src/game_world.ts` (`_renderEntries`, `_updateRenderFromBuffer`) | modify — zIndex + sortableChildren; remove reparenting block + `_entityRenderOrder` cache |
| Prop frame resolution | `game_world._loadPropFrameTexture` (:1194), `render_system._loadVisualTextureAsync` (:209) | modify — extract shared `applyPropFrame(container, resolution)`; wire or delete the render_system twin |
| Manifest schema (tiles/props) | `packages/shared/schemas/src/lib/game/content_pack.ts` (`ContentPackManifestSchema` :660, tile/prop sub-schemas :707-733, `PropCollisionSchema` :648) | reuse — derive `PackConfigSchema` from the existing tile/prop schemas |
| Pack loader | `packages/frontend/engine/src/assets/content_pack_loader.ts` (`loadContentPack` :277) | reuse — main thread resolves pack once per map load |
| Worker LOAD_MAP | `ecs_worker.ts:1776` handler; `game_world.ts:2295-2301` message | modify — add `packConfig` field; spawner reads it |
| Content audit | `packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts` | modify — generalize to per-pack validator; emberwatch expectations become fixtures |
| Generator GID table | `scripts/src/lib/ops/generate_emberwatch_maps.ts` (`G` :23-66) | modify — derive from `manifest.tiles` |
| JPS/vision solidity closures | `ecs_worker.ts:1918-1943` | reuse (unchanged) — stay on boolean grid; migration = follow-up |

## Overview

This contract closes the design debt C-375 layered onto. It makes the content-pack manifest the single source of truth for terrain solidity: a new `buildCollisionGrid` derives the boolean grid from `manifest.tiles[gid].isWalkable` at load (collision layer becomes an optional additive override), the resolved pack config crosses the worker boundary once per map load (killing the `propWalkability` side channel), `isWalkable` becomes a pure terrain oracle with entity blocking handled by the bitmask spatial grid — now including **real wall entities** — and the per-frame depth-sort reparenting is replaced by Pixi's in-place `zIndex` sort. Dead and vestigial code (MoveIntent pipeline, `moveInSpatialGrid`, the render_system prop twin, per-prop dynamic imports) is removed, the audit test is generalized per-pack, and the generator's GID table is derived from the manifest. No gameplay or asset changes.

## Design Reference

- **C-375** (`docs/contracts/C-375-emberwatch-rendering-and-assets-overhaul.md`) — substrate: prop frame resolution, y-depth sort, spatial-grid NPC/prop collision, atlas/maps. This contract revises C-375's explicit-list depth-sort directive deliberately.
- **C-173** (`docs/contracts/C-173-ecs-spatial-hash-grid.md`) — the bitmask spatial grid; its unfinished wall-entity plan is completed here (doc comment `collision_system.ts:475-476`).
- **C-372** (`docs/contracts/C-372-fix-p0-lpc-asset-resolution-and-unify-resolver.md`) — resolver-injection pattern; mirror for packConfig posting.
- **C-315** (`docs/contracts/C-315-define-a-versioned-campaign-content-pack-and-atomic-loader.md`) — manifest schema; packConfig is a validated projection of it.
- **Movement composite check** — `movement_system.ts:193,235` `isCellBlocked(tx, ty, PLAYER_COLLISION_MASK) || !isWalkable(px, py)` is the canonical walkability expression; this contract extends it to the spawn clamp and re-audited callers.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Engine — collision grid derivation** (`packages/frontend/engine/src/assets/map_loader.ts`): add `buildCollisionGrid(tilemap, packConfig)` — walk ground-layer GIDs, look up `packConfig.tiles[String(gid)]`, solid = `!isWalkable` (GID 0 = empty = walkable; **unknown GID → `warn` + solid (fail-closed)**; the AC-6 validator makes unknown GIDs an authoring error so the runtime safety net is rarely hit). Apply the map `collision` layer **additively** (marks extra solid cells; never re-opens manifest-solid cells). Delete the `waterGids` parameter, its `Set([2])` default, and the option from `GameWorld.loadMap` (`game_world.ts:2038-2039`) and any caller/type surface. No hardcoded GID sets remain in engine code.
- **Engine — packConfig to worker**: add `PackConfigSchema` (TypeBox) to `packages/shared/schemas/src/lib/game/content_pack.ts` derived from the existing tile/prop sub-schemas (`ContentPackManifestSchema` :660); derive `PackConfig` type in `packages/shared/types/` via `Static<>`. `game_engine_service.svelte.ts` resolves the pack once per map load and passes `packConfig` (not `propWalkability`) through `GameWorld.loadMap` → `_postLoadMap` (`game_world.ts:2295-2301`) → worker LOAD_MAP. Worker validates once, stores it, and `_spawnProp`/`_spawnNpc` (`entity_spawner.ts:613,363`) read walkability/collision from `packConfig.props[propId]`. Delete the enrichment block (`game_world.ts:2100-2111`), `_buildPropWalkability` (`game_engine_service.svelte.ts:456-464`), and the `propWalkability` option everywhere (game_world, game_engine_service, game_boot_service, game_overlay_service, canvas ViewModel). **Preserve the graceful-degradation try/catch**: manifest resolution failure → `packConfig: undefined` + `warn`, map load continues with all props solid (current behavior).
- **Engine — unified walkability oracle** (`packages/frontend/engine/src/systems/collision_system.ts`): delete the entity branch from `isWalkable` (pure terrain: `!grid.grid[index]`). Change the spawn clamp (`ecs_worker.ts:1950,1968`) to the composite `isCellBlocked(tx, ty, PLAYER_COLLISION_MASK) || !isWalkable(px, py)`. **Audit every remaining `isWalkable` caller**: `turn_manager_system.ts:1948` and `goap_combat_tactics_system.ts:129,272` must be migrated to the composite (with the mask matching the mover) where entity awareness was intended, or documented as terrain-only. Activate wall entities: pass `world` at both `setCollisionGrid` call sites (`ecs_worker.ts:636, 1894`); `_populateWallsFromCollisionGrid(world, grid)` creates one entity per solid cell (`CollisionData { layer: wall, mask: 0 }`, `GridPosition`, `SpatialLink`, Position at tile center) then `insertIntoSpatialGrid`. All standard masks include `CollisionLayer.wall` (PLAYER `movement_system.ts:36`, NPC/PROP `entity_spawner.ts:104,111`) so wall entities block player, NPC, prop, enemy. Keep `setCollisionGrid(grid)` without `world` working for tests (skip entity creation when `world` is absent).
- **Engine — zIndex depth sort** (`packages/frontend/engine/src/game_world.ts` + new `packages/frontend/engine/src/rendering/layer_bands.ts`): `_worldContainer.sortableChildren = true`; per-entity `entry.displayObject.zIndex = entry.displayObject.y` (**raw float — do not round**; stable sort + containers never reparented ⇒ insertion order == spawn order gives the tie-break free). Declarative bands below entities — `WORLD_Z_BANDS = { tilemap: -1000, debugGrid: -2000, zoneOverlays: -500 }` — because tilemap (`addChildAt 0` :2130), debug grid (:2356), and zone overlays are siblings on `_worldContainer` and get sorted too. Remove the reparenting block + `_entityRenderOrder` cache (:2500-2533). Keep `depth_sort.ts` as the pure key computation, unit-tested, with a parity test against the zIndex ordering.
- **Engine — dead code removal**: delete `resolveMoveIntents` + tick call (`ecs_worker.ts:1000`) + fictional doc comment (`:991-999`); delete `components/move_intent.ts` + `registerMoveIntentObservers` (`ecs_worker.ts:41,690`) + barrel exports (`index.ts:130-131`); delete `moveInSpatialGrid` after confirming zero non-test callers (tests referencing it are removed/updated). render_system prop twin: **first confirm zero production paths reach `_loadVisualTextureAsync` with `frame` set**; then either (a) extract `applyPropFrame(container, resolution)` shared helper used by both `game_world._loadPropFrameTexture` and `render_system`, or (b) delete the frame branch. Either way remove the per-prop `void import('pixi.js')` (:259). Do NOT touch the LPC dynamic import (:287).
- **Tooling** (`packages/frontend/engine/src/__tests__/` + `scripts/src/lib/ops/`): generalize `emberwatch_content_audit.test.ts` into a per-pack validator (walk `apps/frontend/client/static/content-packs/*`, validate manifest↔atlas↔maps consistency; emberwatch ID/footprint lists become fixtures). Derive the generators' `G`/`FRAMES` tables from `manifest.tiles` instead of re-declaring.
- **Optional (Phase 6)**: map emission as `encoding: "base64", compression: "zlib"` in `generate_emberwatch_maps.ts`; `map_loader.ts` `_parseLayer` (currently expects plain `number[]`, ~:396-417) must accept both plain and base64+zlib layers so old and new files both load.

## State & Data Models

```ts
// packages/shared/schemas/src/lib/game/content_pack.ts (extend)
// Derived from the existing tile/prop object schemas inside ContentPackManifestSchema.
// NOTE: the tile (`:704-718`) and prop (`:723-737`) object schemas are currently INLINE
// inside ContentPackManifestSchema — extract them into named constants first
// (ContentPackTileSchema / ContentPackPropSchema), then reference them here.
// Do NOT redeclare their shape.
export const PackConfigSchema = Type.Object({
  tiles: Type.Record(Type.String(), ContentPackTileSchema), // extracted named constant
  props: Type.Record(Type.String(), ContentPackPropSchema), // extracted named constant
});
export type PackConfig = Static<typeof PackConfigSchema>; // re-exported via packages/shared/types
```

```ts
// packages/frontend/engine/src/worker/ecs_worker.ts — LOAD_MAP message (extend)
type LoadMapMessage = {
  type: 'LOAD_MAP';
  spawnPoints: SpawnPoint[];
  transitionZones: TransitionZone[];
  collisionGrid: { width: number; height: number; tileSize: number; grid: boolean[] };
  packConfig?: PackConfig; // NEW — resolved manifest tiles+props, posted once per map load
  mapPixelWidth: number;
  mapPixelHeight: number;
  // …existing fields unchanged
};
```

```ts
// packages/frontend/engine/src/rendering/layer_bands.ts (new)
// Sibling layers on _worldContainer are sorted by sortableChildren — give them
// explicit bands below the entity y-range instead of relying on "y ≥ 0".
export const WORLD_Z_BANDS = {
  tilemap: -1000,
  debugGrid: -2000,
  zoneOverlays: -500,
} as const;
```

```ts
// Wall entity created per solid cell by _populateWallsFromCollisionGrid (activation)
// Blocking semantics: isCellBlocked checks `(moverMask & CollisionData.layer[eid])` — a wall
// blocks every mover whose mask includes CollisionLayer.wall (player/NPC/prop/enemy all do).
type WallEntitySpec = {
  gridX: number;
  gridY: number;
  pixelX: number; // tile center — Position
  pixelY: number;
  layer: 1; // CollisionLayer.wall — this is what movers' masks intersect
  mask: 0; // the wall's own mask is unused (walls never move/check); do NOT "fix" it to wall
};
```

## Quality Requirements

- **Offline/degraded mode**: content packs are local static files — no network change. Manifest-resolution failure degrades to `packConfig: undefined` + `warn` with all props solid (behavior preserved from C-375). Unknown tile GID at load → fail-closed solid + `warn`; authoring error caught earlier by the AC-6 validator.
- **Accessibility/input**: N/A — no input, focus, or screen-reader surface changes.
- **Performance budget**: depth ordering becomes in-place `sortChildren` (n log n ≈ 2,500 comparisons @ 300 entities, sub-ms); zero per-frame reparenting; zero O(w×h) dead loop; wall entities add ≤ 182 entities (village) at load, trivially within bitECS budget; no per-prop dynamic import.
- **Security/privacy**: N/A — no auth, no data exposure. `packConfig` crosses a same-bundle worker boundary and is TypeBox-validated once on LOAD_MAP.
- **Persistence/migration**: no save-format change. Map footprints and spawn coordinates unchanged → C-375 AC-5 save compatibility holds. Wall entities are runtime-only, never serialized. Optional zlib phase rewrites map files with identical tile data; parser accepts both encodings so no migration needed.
- **Cancellation/retry/idempotency**: LOAD_MAP already has a 15s timeout + worker-crash reject (`game_world.ts:2235-2257`). packConfig posting is idempotent — worker stores per LOAD_MAP; repeated loads replace. N/A beyond existing.
- **Observability**: `warn` on unknown GID + on manifest-resolution failure; existing LOAD_MAP debug logging preserved; no new metrics required at this stage.

## Migration & Rollback

No persistent state changes (no schema of persisted records, no save format, no routing, no providers). The optional zlib phase (Phase 6) rewrites the 3 map files with identical tile data — rollback is `git revert`; because `_parseLayer` accepts both encodings, old plain-JSON files and new zlib files coexist. **N/A — no persistent state changes** (with the Phase 6 file-rewrite caveat above).

## Scope Boundaries

- **In Scope:** `buildCollisionGrid` + `waterGids` removal (A1); `packConfig` LOAD_MAP plumbing + `propWalkability` deletion (B2); unified walkability oracle + wall entities (A2, C2-activation); zIndex depth sort + layer bands (C1); dead-code removal — MoveIntent pipeline, `moveInSpatialGrid`, render_system prop twin + per-prop dynamic import (D1-D3); audit generalization + G/FRAMES derivation (D4-D5); optional zlib emission + parser compat (D6); corresponding unit tests + parity tests.
- **Out of Scope:** migrating JPS pathfinder and vision/FOV off the boolean grid (named follow-up); render-sync rewrite (per-frame render-buffer polling → event-driven, named follow-up); container pooling; moving asset loading into the worker (rejected — rendering must stay main-thread); any map content change (footprints, spawns, tilesets unchanged); the LPC-appearance dynamic import (`render_system.ts:287`); combat/dialogue/economy/quest systems; `weather_overlay` zIndex (unrelated mesh).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

6 ACs across 4 affected projects (`packages/frontend/engine`, `packages/shared/schemas` + `packages/shared/types`, `apps/frontend/client`, `scripts`). The phases are strictly ordered so the runtime core (Phases 1-5) is independently shippable and verifiable; the tooling AC (AC-6) is the natural split candidate — if the implementer or critique stage wants a smaller diff, split AC-6 (audit generalization + G/FRAMES derivation + optional zlib) into follow-up contract **C-377**, per the draft's own split option. Phases 1-5 form one releaseable system (engine hardening) and stay together here per user decision.

## Acceptance Criteria

### AC-1: Manifest-driven collision grid
**Given** a content pack with `manifest.tiles[gid].isWalkable` and a map with a `ground` layer plus an optional `collision` layer
**When** the map loads through `buildCollisionGrid(tilemap, packConfig)`
**Then** the boolean grid is derived from manifest walkability (solid = `!tiles[gid].isWalkable`, GID 0 = walkable, unknown GID = warn + solid), the `collision` layer applies additively, the `waterGids` parameter and its `Set([2])` default are removed from the entire call surface, and no hardcoded GID sets remain in engine code; a map scattering GID 2 (grass_variant, `isWalkable: true`) stays fully walkable.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `map_loader.test.ts` — GID-2-walkable test, waterGids tests removed/replaced, unknown-GID fail-closed test | `/game` map load | Filled during verification |
| AC-1 | Unit (parity) | `emberwatch_content_audit.test.ts` or new parity spec — `buildCollisionGrid` output === legacy `extractCollisionGrid` output on village/inn/merchant_shop | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `frontend-engine:test`
- Integration: grep gate — `rg "waterGids|new Set\(\[2\]\)" packages/frontend/engine apps/frontend/client` returns nothing
- E2E / Visual:
    - **Functional**: N/A — covered by AC-6 E2E gate (regression-free gameplay)
    - **Visual**: N/A — no visual change (byte-identical grids)

**Watch Points**:
- GID 0 (empty) must stay walkable — don't treat "not in manifest" the same as GID 0.
- The legacy `map_loader.test.ts:954` waterGids test asserts the C-178 tileset semantics — it must be rewritten, not deleted silently (it guards spawn-in-water).
- Parity holds on current maps only because they contain no GID 2 — the parity test must compare against the OLD default merge (`Set([2])`) output to be a true zero-behavior gate.
- Dev-route caller: `map_sandbox_view_model.svelte.ts:319,354` passes `waterGids: new Set()` — it is covered by the AC-1 grep gate, but update both calls when the parameter is deleted (the "no water merge" intent becomes the default).

### AC-2: packConfig reaches the worker
**Given** the manifest schema and the LOAD_MAP message path
**When** `game_engine_service` resolves the pack and posts `packConfig: { tiles, props }` once per map load through `GameWorld.loadMap` → worker
**Then** the worker validates and stores the config; `_spawnProp`/`_spawnNpc` read walkability/collision from `packConfig.props[propId]`; the `propWalkability` side channel (`_buildPropWalkability`, spawn-point enrichment, `properties.isWalkable` read) is deleted; a manifest-resolution failure degrades to `packConfig: undefined` with all props solid and the map still loads.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `entity_spawner.test.ts` — prop walkability from packConfig; `ecs_worker` LOAD_MAP packConfig storage test | `/game` map load | Filled during verification |
| AC-2 | Unit | `schemas:test` — `PackConfigSchema` validates tiles+props, rejects unknown shapes | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `frontend-engine:test`, `schemas:test`
- Integration: boot `/game`, open the village gate — `village_gate` (manifest `isWalkable: true`) remains passable; a solid prop (well) still blocks
- E2E / Visual:
    - **Functional**: N/A — covered by AC-6 E2E gate
    - **Visual**: N/A

**Watch Points**:
- Preserve graceful degradation — do not turn a manifest fetch hiccup into a LOAD_MAP failure (reviewer-explicit).
- Worker must validate `packConfig` once on LOAD_MAP (TypeBox) before storing; malformed config → `warn` + treat as undefined (props solid), never crash the worker.
- Message size: 48 tiles + 9 props ≈ a few KB — negligible; do not split further.

### AC-3: Unified walkability oracle (isWalkable pure + wall entities)
**Given** the boolean grid, the spatial grid, and the mask semantics
**When** `isWalkable` is called, and separately when `setCollisionGrid(grid, world)` runs
**Then** (a) `isWalkable` is a pure terrain lookup (entity branch removed); (b) the spawn clamp (`ecs_worker.ts:1950,1968`) and every re-audited caller (`turn_manager_system.ts:1948`, `goap_combat_tactics_system.ts:129,272`) use the composite `isCellBlocked(tx, ty, <mover mask>) || !isWalkable(px, py)`; (c) solid cells become wall entities (`layer: wall`, `mask: 0`, GridPosition/SpatialLink, inserted into the spatial grid) so `isCellBlocked` blocks terrain for player, NPC, prop, and enemy masks; (d) an NPC standing on a solid tile does NOT make it walkable.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `spatial_grid.test.ts` — updated: NPC-on-solid-tile blocked; wall entity in cell → `isCellBlocked` true; `isWalkable` terrain-only | `/game` map load | Filled during verification |
| AC-3 | Unit | `movement_system` tests stay green (composite unchanged) | `/game` movement | Filled during verification |

**Test Hooks**:
- Moon Task: `frontend-engine:test`
- Integration: live walk — player cannot enter an NPC-occupied wall tile; spawn clamp `?position_x/y` on a wall + NPC tile clamps to a walkable tile
- E2E / Visual:
    - **Functional**: N/A — covered by AC-6 E2E gate
    - **Visual**: N/A

**Watch Points**:
- This is the one AC with real runtime-behavior change: walls now block via `isCellBlocked` as well as `isWalkable`. The player-visible outcome is identical (composite), but entity counts rise (≤182 village) and the spatial grid now carries walls — verify no system double-counts walls.
- `turn_manager`/GOAP previously saw solid-prop-occupied cells as blocked via the old entity branch (wall-layer props). After the change, migrate them to the composite or their tactical scoring silently changes. Do not leave them on bare `isWalkable`.
- `setCollisionGrid(grid)` without `world` (tests) must keep working — skip wall entities when `world` is absent.
- Existing `spatial_grid.test.ts:214-217` asserts "wall-layer prop in cell ⇒ `isWalkable` false" — that assertion changes under the new semantic; update it to assert composite behavior.
- Wall entities are re-created per LOAD_MAP (worker clears non-player entities) — no cross-transition leak; verify wall EIDs are not persisted by any snapshot path.

### AC-4: zIndex depth sort with declarative bands
**Given** `_worldContainer` with tilemap/debug/zone-overlay siblings and entity containers
**When** the engine boots and `_updateRenderFromBuffer` updates positions
**Then** `_worldContainer.sortableChildren = true`; entity containers get `zIndex = displayObject.y` (raw float); tilemap/debug/overlays use `WORLD_Z_BANDS` constants below the entity range; the reparenting block + `_entityRenderOrder` cache are removed; and `computeDepthOrder` output equals the zIndex-based ordering for the same entities (parity test).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `game_world.test.ts` / `rendering.test.ts` — zIndex ordering parity with `computeDepthOrder`; bands below entities | `/game` | Filled during verification |
| AC-4 | Performance | manual/bench — 300 entities, ordering < 1 ms/frame, no reparenting churn on static order | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `frontend-engine:test`
- Integration: boot `/game`, verify Elder Thalia still renders above the player when below on screen and below when above (y-order preserved); transition to inn/shop and back — overlays/tilemap stay under entities
- E2E / Visual:
    - **Functional**: N/A — covered by AC-6 E2E gate
    - **Visual**: `suites/emberwatch.visual.ts` (existing suite, C-375) — depth ordering scenarios must still score ≥ 90/100

**Watch Points**:
- Do NOT `Math.round(y)` — raw float; quantization creates ties the stable sort then resolves by insertion order, which is the spawn order (containers are added once and never reparented).
- `sortableChildren` sorts ALL children of `_worldContainer`, including tilemap chunks — the bands are mandatory, not cosmetic. Confirm the tilemap chunk container (`addChildAt(result.container, 0)`) gets its band applied at creation.
- Weather overlay (`zIndex = 9999` on its mesh, `weather_overlay.ts:399`) lives outside `_worldContainer` — verify it is not a child being sorted; if it is, give it a top band.
- C-375's E2E AC-2 (y-depth NPC occlusion) must stay green — this AC is its mechanism change.

### AC-5: Dead code & vestigial pipeline removal
**Given** the current codebase
**When** the removal pass lands
**Then** `resolveMoveIntents` (function + tick call + fictional doc comment), `components/move_intent.ts` + `registerMoveIntentObservers` + barrel exports, and `moveInSpatialGrid` (after confirming zero non-test callers) are deleted; the render_system prop twin is either wired through a shared `applyPropFrame(container, resolution)` helper (used by both `game_world._loadPropFrameTexture` and `render_system`) or deleted after confirming zero production call sites pass `frame`; the per-prop `void import('pixi.js')` is removed; the LPC dynamic import (`:287`) is untouched.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `frontend-engine:test` stays green (movement tests prove behavior-neutral removal) | `/game` | Filled during verification |
| AC-5 | Static | grep gates — `resolveMoveIntents|MoveIntent|moveInSpatialGrid` return zero engine hits; `import('pixi.js')` returns zero hits **in the `_loadVisualTextureAsync` frame branch only** — the LPC appearance path at `render_system.ts:287` is intentionally untouched, so scope the import gate to the prop branch, not the whole file | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `frontend-engine:test`
- Integration: boot `/game`, walk gate→plaza — no `prop-frame-texture-missing` errors in console, movement identical
- E2E / Visual:
    - **Functional**: N/A — covered by AC-6 E2E gate
    - **Visual**: N/A

**Watch Points**:
- `resolveMoveIntents` removal is behavior-neutral because its body is empty and `MoveIntent` is never written — verify with movement tests staying green, not new tests.
- `moveInSpatialGrid` is exercised by `spatial_grid.test.ts` OOB tests — remove/update those tests with the function.
- render_system twin: make "confirm zero callers with `frame` set" an explicit checklist item before deleting (reviewer-explicit); if any path reaches it, choose the shared-helper unification instead.

### AC-6: Tooling generalization + optional zlib
**Given** the audit test, the generators, and the map emitter
**When** the tooling pass lands
**Then** the content audit becomes a per-pack validator (walks `static/content-packs/*`, validates manifest↔atlas↔maps consistency; emberwatch-specific ID/footprint lists become fixtures) and the generators' `G`/`FRAMES` tables derive from `manifest.tiles` (single GID↔frame source); optionally, map emission switches to `encoding: "base64", compression: "zlib"` with `map_loader._parseLayer` accepting both plain and base64+zlib layers.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | generalized per-pack audit spec; generator table-derivation tests | N/A | Filled during verification |
| AC-6 (optional) | Unit | `map_loader.test.ts` — plain + zlib layer parse; regenerated maps byte-identical in tile data | `/game` map load | Filled during verification (only if Phase 6 implemented) |

**Test Hooks**:
- Moon Task: `frontend-engine:test`, `schemas:test`, `scripts:test` (generator table-derivation tests live in `scripts/`, which has a `bun test` task)
- Integration: run `bun scripts/src/lib/ops/generate_emberwatch_maps.ts` — regenerated maps load and play identically; audit validator passes for emberwatch
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A (regenerated maps are pixel-identical)

**Watch Points**:
- zlib is **optional**: if the implementer defers it, record in Amendments and verification does not require it. If implemented, keep the parser backward-compatible — old plain-JSON maps in the wild must still load.
- The existing audit test already validates no-gaps between manifest and atlas (`emberwatch_content_audit.test.ts:96-106`) — that's the safety net for deriving `G`/`FRAMES` from the manifest; keep it in the generalized validator.

## Verification Gate (regression-free gameplay)

Not an AC — the C-375 baseline re-run that all ACs must preserve:
- `frontend-engine:test` green (C-375 baseline 878/0 — confirm before starting, report deltas)
- `schemas:test` green (295/0)
- `client:test` failure set identical to C-375 baseline (1528 pass / 128 known-fail — same list, no new failures)
- E2E `quest_flow` + `economy_loop` 10/10 (Playwright, emulator mode)
- `game_page` C-375 specs AC-1/AC-2/AC-3 green
- Emberwatch visual suite ≥ 90/100
- Live: boot `/game`, walk gate→plaza, confirm Elder Thalia blocks at the row-7 boundary (y ∈ [224,232]) exactly as C-375 verified

## Implementation Sequence

1. **Phase 1 — Correctness (A1, A2)**: remove the `waterGids` default hazard (delete the param from map_loader/game_world/type surface; update `map_loader.test.ts:954`); GID-2-walkable test; `isWalkable` entity branch deleted + spawn clamp composite + turn_manager/GOAP re-audit. Full `buildCollisionGrid` lands in Phase 2, but the default-hazard removal is shippable alone.
2. **Phase 2 — Manifest-driven grid + packConfig (B1, B2)**: `buildCollisionGrid` + parity test; `PackConfigSchema` + `PackConfig` type; LOAD_MAP `packConfig` field; `game_engine_service` resolves + posts once; worker stores + spawners read; delete `propWalkability` plumbing; keep degradation try/catch.
3. **Phase 3 — Wall entities (C2-activation, part of AC-3)**: pass `world` at both `setCollisionGrid` sites; activate `_populateWallsFromCollisionGrid` with real entity creation; spatial-grid tests. **Reviewable as its own diff** within the contract (the only AC with runtime-behavior change).
4. **Phase 4 — zIndex depth sort (C1)**: `layer_bands.ts` constants; `sortableChildren` + raw-float zIndex; remove reparenting + cache; parity test vs `computeDepthOrder`; run the emberwatch visual suite + game_page specs.
5. **Phase 5 — Dead code (C2, D1-D3)**: delete MoveIntent pipeline, `moveInSpatialGrid`, render_system prop twin (or unify via `applyPropFrame`), per-prop dynamic import. Grep gates.
6. **Phase 6 — Tooling (D4-D6, optional zlib)**: per-pack validator; `G`/`FRAMES` from manifest; optional zlib emission + parser compat.
7. **Validation**: `moon_detect_affected` → `validate(test=true)`; E2E `quest_flow` + `economy_loop`; game_page + visual suite; live walk gate→plaza.

## Edge Cases & Gotchas

- **GID 0 (empty) vs unknown GID**: empty = walkable; unknown = warn + fail-closed solid. The validator makes unknown GIDs an authoring error so the runtime fallback is a safety net, not a feature.
- **Collision layer can only add solidity** — it cannot re-open a manifest-solid tile. If a future map needs that, it's a manifest change (`isWalkable: true`), not a map-layer trick.
- **Wall entities vs snapshot**: verify the ECS serializer never includes wall entities in LOAD_GAME payloads (they're derived per-map, not authored).
- **Spawn clamp on NPC-occupied walkable tile**: with the composite, the clamp skips cells whose spatial grid has NPCs/props/enemies — a save that legitimately restores next to an NPC still resolves to the nearest free walkable tile (C-375 clamp loop already scans outward).
- **zlib decode**: Tiled's zlib layer data is raw base64 of zlib-compressed bytes (with zlib header). If the optional phase is implemented, decode via `DecompressionStream('deflate')` — test against Tiled's own output, not hand-rolled bytes.
- **sortableChildren and interaction**: if any entity container needs `eventMode = 'static'` later, verify sort order doesn't break hit-testing (Pixi hit-test is display-list order; zIndex sort preserves it consistently).
- **Parity test brittleness**: the parity gate must compare `buildCollisionGrid` to the OLD `extractCollisionGrid` behavior (including the `Set([2])` merge) so it's a genuine zero-behavior check, not a tautology.

## Open Questions

Must be resolved before status becomes `approved`:

1. **render_system prop twin — unify or delete?** Checklist first (zero production callers pass `frame`), then either shared `applyPropFrame` helper or deletion. Recommendation: shared helper — keeps one visual-resolution implementation and kills the double-swap race risk (draft D1).
2. **Phase 6 (zlib) in or out at implementation time?** User opted to keep it as an optional final phase; the implementer may defer it via Amendments if the parser-surface risk outweighs the size win (reviewer recommended descoping entirely). Needs explicit approval either way since it rewrites committed map files.
3. **turn_manager/GOAP composite masks** — exact mover mask per call site (`PLAYER_COLLISION_MASK` for combat-player positioning vs NPC/enemy masks for GOAP scoring) to be confirmed against the combat system's intent during Phase 1. Recommendation: mirror each system's existing movement mask.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Follow-ups (deliberately deferred, named so they are not forgotten)

- **JPS/vision migration to the spatial grid** — replace the direct `cg.grid` closures (`ecs_worker.ts:1918-1943`) with the wall-entity-aware oracle once wall entities land; perf-sensitive pathfinding correctness deserves its own review cycle.
- **Render-sync rewrite** — replace per-frame Float32Array render-buffer polling with event/change-driven sync; the biggest actual perf lever, its own contract.
- **Container pooling** — revisit only if combat scenes show high-frequency spawn/despawn GC pressure (map transitions are already pause/fade-covered).
