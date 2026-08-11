---
id: C-379
title: "Collision & Movement Unification — Terrain Cost Grid, A* Locomotion, Dead-Path Removal"
source: "external architecture review (claude CLI) — docs/research/game_engine_architecture_review.md §3 B1-B8, §4 Q2-Q4, §6"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-11"
---

# Contract C-379: Collision & Movement Unification — Terrain Cost Grid, A* Locomotion, Dead-Path Removal

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/research/game_engine_architecture_review.md` §3 (B1–B8), §4 (Q2, Q3, Q4), §6 delete list |
| **Target** | `packages/frontend/engine/src/systems/` — collision, movement, new path-follow; `math/` — A* replacing JPS; `components/` — GridPosition sync, PathFollow; `assets/map_loader.ts` — flip flags, GID convention; `game_world.ts` — keybinding wiring; `apps/frontend/client/src/lib/services/game/party_follow_service.svelte.ts` — folded into ECS |
| **Priority** | P0 — `GridPosition` is written once at spawn and never updated, so the player has **no grid position at all** and the entire vision system can never see them; the movement system applies the **player's** collision mask to every entity; and ~1,400 lines of pathfinder have zero callers while NPCs cannot walk. |
| **Dependencies** | **C-378** (hard — `terrainCost` derives from the terrain channel). C-377 (transitively). C-376 (merged — this contract removes the wall entities it introduced). |
| **Status** | draft |
| **Promotion** | `integrated` — `/game` route, `collision_e2e.spec.ts`, `emergent_world.visual.ts` |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

Verified against HEAD (`4ea2ccf5`).

### 🔴 A. `GridPosition` is never updated after spawn

The only writes are `systems/entity_spawner.ts:139-143` (`_addSpatialCollision`)
and `systems/collision_system.ts:478` (wall population). **No system syncs
`GridPosition` from `Position`.** Consequences, each independently broken:

**A1. The player has no `GridPosition` at all.** `entities/create_player.ts:48-95`
adds `Position`, `Velocity`, `Visual`, `CameraFocus`, `Appearance`, `Inventory`,
`CombatStats`, `TurnOrder` — no `GridPosition`, no `CollisionData`, no
`SpatialLink`. `systems/spatial_vision_system.ts:113` queries
`[VisionObserver, GridPosition]` for observers and `:212` requires
`GridPosition` on targets. **The entire FOV system — DDA cones,
shadowcasting, `VisionVisible` bitmasks — can never see the player.** It is
decorative.

**A2. Anything that moves leaves a phantom collision cell.** Companions receive
velocity (see B below) and their `Position` changes, but their `GridPosition`
and spatial-grid cell stay at spawn forever: they block a tile they left and
block nothing where they are.

**A3. GOAP crime-witness proximity reads stale coordinates.**
`systems/goap_scheduler_system.ts:437-438` reads `GridPosition.x/y` for witness
checks.

### 🔴 B. Movement applies the player's collision mask to every entity

`systems/movement_system.ts:213` and `:255` both hardcode:

```ts
if (isCellBlocked(tx, ty, PLAYER_COLLISION_MASK) || !isWalkable(px, py)) {
```

inside the shared `query(world, [Position, Velocity])` loop.
`COMBATANT_COLLISION_MASK` is exported 150 lines above (`:55-56`) and is used by
`turn_manager_system` and `goap_combat_tactics_system` for *tactical queries*,
never for movement. So a moving NPC is not blocked by the player, and enemies
are not blocked by each other.

This is currently masked by the fact that only the player and party followers
move — and followers move badly. `services/game/party_follow_service.svelte.ts`
posts `SET_ENTITY_VELOCITY` bridge commands on a **150ms** interval
(`FOLLOW_TICK_MS`) at `FOLLOW_SPEED = 80` px/s from the **main thread**, with
pure formation-offset steering and no pathfinding. Combined with A2, a follower
pins on the first wall corner and leaves a phantom blocker behind.

### 🔴 C. `movement_system` hardcodes a 32px tile

```ts
// movement_system.ts:173
const tileSize = 32; // Default tile size (matches CELL_PIXEL_SIZE in render_system)
```

The pack manifest advertises `tileSize` as configurable (`ContentPackManifestSchema`)
and every map carries `tilewidth`/`tileheight`. Neither reaches the movement
system. Any pack that is not 32px gets silently wrong collision.

### 🔴 D. Wall-as-entity is pure redundancy

`systems/collision_system.ts:446-486` (`_populateWallsFromCollisionGrid`) creates
one bitECS entity per solid tile — **182 on the village map alone**. Every caller
uses the composite:

```ts
isCellBlocked(tx, ty, MASK) || !isWalkable(px, py)
```

For terrain both halves return the same answer, because the wall entities were
generated *from* the same boolean grid that `isWalkable` reads. They add zero
information and cost: entity IDs, memory, iteration in every `query()`, and a
self-cleaning removal pass per map load.

Worse, they consume the render buffer's ID space. `worker/ecs_worker.ts:1300-1320`
(`serializeEntityStates`) indexes by `eid * COMPONENT_STRIDE` and caps at
`MAX_ENTITIES = 10000` (`config/memory_config.ts`). The budget guard at
`collision_system.ts:462` only checks `solidCount > MAX_ENTITIES` — it does not
account for walls **plus** NPCs, props, items and interactables sharing the same
ID space. A 200×200 map at 40% solid is 16,000 wall entities; at lower densities
real entities silently land past index 10000 and vanish from the render buffer.

The stated justification in the doc comment — "enables doors/bridges/destructibles
as runtime layer toggles" — is better served by writing to a cost grid. Doors are
already separate entities (`entity_spawner._spawnInteractable`).

### 🔴 E. ~1,400 lines of pathfinder with zero callers

`systems/jps_pathfinder_system.ts:78` exports `requestPath`. Grep across
`packages` and `apps`: **the only occurrences are the definition, the barrel
re-export (`index.ts:439`), and its own test.** `initJpsPathfinder` is called on
LOAD_MAP (`ecs_worker.ts:690`, `:1973`) and `tickJpsPathfinder()` runs every
frame (`:1005`) over an always-empty queue.

`apps/e2e/tests/game/jps_navigation.spec.ts` claims to be the E2E for C-192 but
only navigates to `/dev/sandbox/map` and asserts `page.title()` is defined — it
tests nothing about pathfinding.

JPS is also the wrong algorithm here: it is a jump-point optimisation for
uniform-cost, obstacle-sparse grids over long distances. The maps are 20×20 to
16×12 — 400 cells, where naive A* completes in tens of microseconds. And JPS is
**not correct with weighted movement costs**, which C-378 introduces.

### 🔴 F. `input_system.ts` is dead, so keybinding rebinds do nothing

`systems/input_system.ts:45` (`setupInput`) has **no callers**. The live handler
is `GameWorld._setupKeyboardInput` (`game_world.ts:1570-1708`), which hardcodes
`w/a/s/d/arrow*` at `:1587-1598`. `systems/keybinding_config.ts` (`keyToDirection`)
is imported **only** by the dead `input_system.ts`. The Settings → Controls UI
(`views/settings/controls/settings_controls_view_model.svelte.ts:125`) writes
rebinds to localStorage that nothing reads.

The dead implementation is also the worse one: its 4-way LUT
(`input_system.ts:25-30`) overwrites the whole velocity per keydown, so diagonals
do not exist and releasing one of two held keys stops the player dead. The live
handler normalises diagonals correctly (`game_world.ts:1600-1609`).

### 🔴 G. Tiled flip flags are unmasked

Zero occurrences of `0x80000000`, `0x40000000`, `0x20000000` or `0x1FFFFFFF`
anywhere in the tree. Flipping or rotating a tile in Tiled — the normal way to
build corners and variation — sets the high bits, producing a GID that is
unmatched by `_resolveGid` (tile silently disappears) **and** unknown to
`buildCollisionGrid`, which fails closed and marks the cell solid. An invisible
wall, from a routine editor action.

### 🟡 H. Three GID conventions; one tileset per layer

| Consumer | Convention | Site |
|---|---|---|
| `buildCollisionGrid` | raw GID | `map_loader.ts:772` |
| `ManifestAtlasResolver` | `rawGid - firstGid + 1` | `manifest_atlas_resolver.ts:289` |
| `_resolveGid` | `rawGid - firstgid` | `tilemap_chunk_renderer.ts:459` |

They agree only because `firstgid === 1` everywhere today.
`_findPrimaryTilesetForLayer` (`tilemap_render_system.ts:198`) binds one texture
per layer while `_resolveGid` may compute UVs from a different tileset's
dimensions — multi-tileset layers render garbage.

### 🟡 I. `isWall` is declared and never consumed for terrain

`ContentPackTileSchema` declares `isWall`. The vision raycasters
(`math/vision/dda_raycaster.ts:52`, `math/vision/shadowcasting.ts:106`) take an
`isWall(gx, gy)` callback, and `spatial_vision_system.ts:151,164` supplies one —
but it is wired to the spatial grid, not to manifest sight-blocking. A fence
blocks movement but not sight; a window blocks movement but not sight. The
distinction has a declared field and no implementation.

### Baseline tests

- `moon run engine:test` — 910 pass / 0 fail
- `apps/e2e/tests/game/collision_e2e.spec.ts`, `vision_perception.spec.ts`, `goap_cognition.spec.ts`, `emergent_world_integration.spec.ts`
- `packages/frontend/engine/src/systems/movement_system.test.ts` (437 lines), `__tests__/spatial_grid.test.ts` (506), `__tests__/spatial_vision.test.ts` (831), `__tests__/jps_pathfinder.test.ts` (423 — deleted by this contract)

## User Outcome

After this contract, a **player** sees NPCs and companions walk around the
village on sensible routes instead of standing still or pinning on walls, and
guards actually notice them.

After this contract, a **developer** has one spatial source of truth — a terrain
cost grid plus a dynamic-occupancy grid — that pathfinding, collision and
(later) click-picking all read, and ~1,700 fewer lines of engine code.

## Success Measures

- **Time/latency target**: a full-map A* path on a 200×200 grid resolves in under 2ms synchronously (no time-slicing needed at this scale). Movement tick cost must not regress on the village map.
- **Offline/degraded behavior**: unchanged — no network path touched.
- **Production journey enabled**: NPCs and party companions navigate around obstacles; the vision system can see the player, making stealth/guard behaviour and the emergent-world systems real rather than decorative.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Boolean collision grid | `systems/collision_system.ts:32-226` | replace — `Uint8Array` terrain cost |
| Dense spatial grid + `SpatialLink` | `systems/collision_system.ts:242-413` | reuse — but dynamic occupants only |
| Wall entities | `systems/collision_system.ts:446-486` | delete |
| `SpatialHashGrid` | `math/spatial_hash_grid.ts` (used by `context_system`) | reuse unchanged — different access pattern (radius queries) |
| Movement | `systems/movement_system.ts` | modify — per-entity mask, pack tile size |
| JPS | `math/jps/*`, `systems/jps_pathfinder_system.ts` | replace with weighted A* |
| GOAP action selection | `systems/goap_scheduler_system.ts` | reuse — add a movement executor downstream |
| Party follow | `services/game/party_follow_service.svelte.ts` | replace — fold into an ECS system |
| Keyboard input | `game_world.ts:1570-1708` | modify — read `keyToDirection` |
| Keybinding config | `systems/keybinding_config.ts` | reuse — finally wire it |
| Dead input system | `systems/input_system.ts` | delete |
| Vision raycasters | `math/vision/*` | reuse — feed a real `blocksSight` grid |

## Overview

Collapse the three overlapping spatial structures into one authoritative pair,
make everything that moves actually move correctly, and delete the dead
navigation and input paths. Terrain becomes a `Uint8Array` cost grid derived from
C-378's terrain channel; dynamic entities keep the existing intrusive-linked-list
occupancy grid; wall entities disappear. `GridPosition` is synced from `Position`
every tick so vision and GOAP see reality. JPS is replaced by a small weighted A*
driving a `PathFollow` component, which becomes the single locomotion executor
for GOAP agents and party followers alike.

## Design Reference

- C-173 introduced the dense spatial grid + `SpatialLink`; C-376 completed it with wall entities. This contract keeps the former and removes the latter — read both contracts before touching `collision_system.ts`.
- C-378 owns the terrain channel; `terrainCost` is derived from it, not re-parsed.
- `systems/goap_scheduler_system.ts` already selects actions; the missing piece is an executor. Follow the existing worker tick ordering (`ecs_worker.ts:911-1090`): Perception → Cognition → **Navigation** → Resolution. Path-follow belongs in Navigation, writing `Velocity` that Resolution consumes.
- `math/vision/dda_raycaster.ts` and `shadowcasting.ts` already take an `isWall` callback — supply a real `blocksSight` grid rather than changing their signatures.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Two grids, one owner.** `terrainCost: Uint8Array` (0 = impassable, else cost ×16) and `occupancy: Uint32Array` (head EID of the dynamic-entity list) live in the worker, are built once per `LOAD_MAP`, and are the only spatial truth. `SpatialHashGrid` stays for `context_system`'s radius queries — a genuinely different access pattern.
- **Terrain never becomes an entity.** Doors, bridges and destructibles mutate `terrainCost` at runtime. That is the runtime-toggle capability the wall entities were reaching for, without the ID cost.
- **`GridPosition` is derived state, synced by exactly one system.** One place computes it from `Position`, updates the occupancy list on cell change, and nothing else writes it. Two writers here is how the current bug class comes back.
- **Locomotion has exactly one executor.** GOAP picks a goal cell; A* produces waypoints; `PathFollow` writes `Velocity`; `updateMovement` resolves. Party follow is a goal provider, not a second movement path. No client service may post per-entity velocities.
- **Every mover carries its own mask.** Read `CollisionData.mask[eid]` in the movement loop. The constant `PLAYER_COLLISION_MASK` stays as the player's *value*, not as the loop's *behaviour*.
- **Mask flip flags at parse time, once.** Strip the three high bits in `map_loader` before any consumer sees a GID, and carry the flip state separately for the renderer to apply later. Every downstream GID consumer then sees a clean ID.
- **One GID convention.** Pick `localId = rawGid - firstgid` and convert at the single parse boundary. Downstream code should never see `firstgid` again.

## State & Data Models

```ts
/** Authoritative terrain grid — built once per LOAD_MAP from C-378's terrain channel. */
type TerrainGrid = {
  width: number;
  height: number;
  /** Tile size in world pixels, from the map/pack — never assumed to be 32. */
  tileSize: number;
  /** 0 = impassable. Otherwise movement cost × 16 (so 1.0 → 16, 0.8 → 13). */
  cost: Uint8Array;
  /** 1 = blocks line of sight. Fed to the DDA/shadowcasting raycasters. */
  blocksSight: Uint8Array;
};

/** Waypoint buffer for an agent following a path. */
const PathFollow = {
  /** Flat [x0,y0,x1,y1,...] world-pixel waypoints. */
  waypoints: [] as Float32Array[],
  /** Index of the waypoint currently being approached. */
  index: [] as number[],
  /** Number of valid waypoints. */
  length: [] as number[],
  /** Movement speed in px/s for this agent. */
  speed: [] as number[],
  /** Repath when the goal cell changes or this deadline passes (ms). */
  repathAtMs: [] as number[],
};

/** Goal a locomotion consumer requests. Written by GOAP or party follow. */
type MoveGoal = {
  eid: number;
  goalCellX: number;
  goalCellY: number;
  /** Stop this many pixels short — formation slots and interaction ranges. */
  arriveRadius: number;
};
```

`GridPosition` keeps its existing shape; only its update discipline changes.

## Quality Requirements

- **Offline/degraded mode**: N/A — no network path.
- **Accessibility/input**: keybinding rebinds from Settings → Controls must take effect on the next keydown without reload. This is the first time that UI does anything.
- **Performance budget**: A* under 2ms for a 200×200 grid; `GridPosition` sync is O(moving entities), not O(all entities); removing 182 wall entities per village load should reduce every `query()` in the tick.
- **Security/privacy**: N/A.
- **Persistence/migration**: wall entities are runtime-only and never serialized (`serialization/ecs_serializer.ts` persists player-scoped components only), so removing them does not affect saves. `PathFollow` is runtime-only and must be excluded from serialization. See Migration & Rollback.
- **Cancellation/retry/idempotency**: `LOAD_MAP` rebuilds both grids from scratch; repeated loads must not leak occupancy entries. A path request superseded by a new goal must abandon cleanly.
- **Observability**: log path length, node count and elapsed time per A* call under render-debug; log occupancy-grid size and terrain histogram once per map load.

## Migration & Rollback

- **Old data compatibility**: saves are unaffected — wall entities and `PathFollow` are runtime-only, and no serialized component changes shape. Existing saves must load and restore identically; that is AC-9.
- **Migration**: none for persisted data. The `party_follow_service` public interface is consumed by `game_composition_root.svelte.ts` — its `configure`/`start`/`stop`/`setFormation` surface is preserved while the implementation moves behind the bridge.
- **Rollback**: `git revert`. No data written by this contract outlives the process.
- **Feature flag or kill switch**: NPC locomotion is gated on a `PathFollow` component being attached. If GOAP's movement executor is disabled, agents simply stand still — the pre-contract behaviour — with no other system affected.
- **Failure recovery**: an unreachable goal returns no path and the agent holds position with a logged warning; it must never spin re-requesting every tick (enforce `repathAtMs`).

## Scope Boundaries

- **In Scope:**
  - `terrainCost` + `blocksSight` grids derived from C-378 terrain; runtime cost mutation API for doors/bridges
  - Deletion of `_populateWallsFromCollisionGrid`, `_wallEids`, the `MAX_ENTITIES` wall guard, and the boolean `CollisionGrid`
  - `GridPosition` sync system + occupancy-list maintenance on cell change; `GridPosition`/`CollisionData`/`SpatialLink` on the player
  - Per-entity collision masks in `updateMovement`; pack/map-driven tile size
  - Deletion of `math/jps/*`, `systems/jps_pathfinder_system.ts`, its test, and `apps/e2e/tests/game/jps_navigation.spec.ts`
  - Weighted A* + `PathFollow` component + path-follow system in the Navigation slot
  - GOAP movement executor (goal cell → path request)
  - Party follow folded into the ECS as a goal provider; client service becomes a thin facade
  - Deletion of `systems/input_system.ts`; `keyToDirection` wired into `GameWorld._setupKeyboardInput`
  - Tiled flip-flag masking at parse; single GID convention; multi-tileset-per-layer support
  - `blocksSight` fed to the vision raycasters
- **Out of Scope:**
  - **Click-to-move, screen→world unprojection, `MOVE_TO_CELL`** — C-380 (it consumes this contract's A* and `PathFollow`)
  - **Frame interpolation and the worker tick clock** — C-380
  - **Elevation, cliffs, ramps** — the channel stays reserved
  - **Flow fields / hierarchical pathfinding** — not needed at this scale
  - **Combat tactical movement rework** — `goap_combat_tactics_system` keeps its current behaviour beyond the mask fix
  - **`MAX_ENTITIES` / render-buffer indexing rework** — removing walls relieves the pressure; the dense-index redesign is deferred
  - Any rendering, schema or content-pack change (C-377 / C-378 own those)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. Every AC shares the one invariant that the
grids are the only spatial truth. Splitting "delete wall entities" from "sync
GridPosition" would leave two competing occupancy models live simultaneously —
the exact worse-than-before state the split rule guards against. Splitting A*
from `PathFollow` would ship a pathfinder with no consumer, which is the defect
this contract exists to remove.

## Acceptance Criteria

### AC-1: `GridPosition` tracks `Position` for every entity that has one
**Given** any entity with `Position` and `GridPosition` moving across a tile boundary
**When** the tick completes
**Then** its `GridPosition` matches `floor(Position / tileSize)` and its occupancy-grid cell has been updated — removed from the old cell's list and inserted into the new one

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/frontend/engine/src/__tests__/spatial_grid.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: move an entity across several cells; assert `GridPosition`, assert the old cell's list no longer contains it, assert no duplicate insertion when it moves within one cell
- E2E / Visual: N/A

**Watch Points**:
- Sync must be O(moving entities). A naive `query(world, [Position, GridPosition])` full scan every tick reintroduces the cost the wall removal just saved — gate on an actual cell change.
- Re-insertion on the *same* cell must be a no-op, or the intrusive list corrupts (an entity appearing twice in one list makes `removeFromSpatialGrid` unlink the wrong node).

### AC-2: The vision system can see the player
**Given** an NPC with `VisionObserver` and the player standing in its cone with clear line of sight
**When** the perception step runs
**Then** the player's `VisionVisible` bitmask includes that observer, and the player carries `GridPosition`, `CollisionData` and `SpatialLink`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + E2E | `packages/frontend/engine/src/__tests__/spatial_vision.test.ts`, `apps/e2e/tests/game/vision_perception.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: place an observer and the player, assert visibility; move the player behind a `blocksSight` tile, assert loss of visibility
- E2E / Visual: extend `vision_perception.spec.ts` to assert the player becomes visible to a guard

**Watch Points**:
- `spatial_vision.test.ts` is 831 lines of tests that all pass today **while the player is invisible** — they use synthetic observers and targets. Add a test that uses the real player entity, or this AC can pass without fixing anything.
- Giving the player `CollisionData` changes collision: the player now occupies a cell that NPC masks intersect. Verify NPCs are blocked by the player and that the player is not blocked by themselves (`PLAYER_COLLISION_MASK` excludes `player`).

### AC-3: Each moving entity is blocked according to its own mask
**Given** an NPC and the player adjacent to each other, and two enemies adjacent to each other
**When** either tries to move into the other's cell
**Then** the move is blocked according to the mover's `CollisionData.mask`, not the player's

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `packages/frontend/engine/src/systems/movement_system.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: table-driven over (mover layer × occupant layer) asserting blocked/passable per mask
- E2E / Visual: `apps/e2e/tests/game/collision_e2e.spec.ts` must still pass unchanged

**Watch Points**:
- An entity with `Velocity` but no `CollisionData` (if any remain) needs a defined default — pick "collides with walls only" and test it, rather than falling back to the player mask.

### AC-4: Terrain solidity comes from a cost grid, and no wall entities exist
**Given** any map load
**When** the collision structures are built
**Then** `terrainCost` and `blocksSight` are populated from the terrain channel, zero entities are created for solid tiles, and the entity count after loading `village.json` is the pre-contract count minus 182

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + E2E | `packages/frontend/engine/src/__tests__/spatial_grid.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: load `village.json`, assert entity count, assert every solid cell blocks movement via `terrainCost === 0`
- E2E / Visual: `collision_e2e.spec.ts` — the player must still be stopped by the same walls as before

**Watch Points**:
- `math/bresenham.ts` is wired to the spatial grid via `setBresenhamGrid` (`collision_system.ts:248`) and its callers assume terrain shows up there. Re-point it at `terrainCost` or it silently sees an empty world.
- The composite `isCellBlocked(...) || !isWalkable(...)` appears at several call sites (`ecs_worker.ts:1950,1968`, `turn_manager_system.ts:1948`, `goap_combat_tactics_system.ts:129,272`). Every one must move to the new API in the same change — a half-migrated composite is worse than either version.

### AC-5: Movement uses the map's tile size
**Given** a content pack declaring a tile size other than 32
**When** an entity moves
**Then** collision sampling uses the map's tile size throughout, with no hardcoded 32

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `packages/frontend/engine/src/systems/movement_system.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: run the movement suite against a 16px and a 48px grid; assert wall stops land on the correct boundaries
- E2E / Visual: N/A

**Watch Points**:
- `ENTITY_HALF_WIDTH = 16` and `ENTITY_HEIGHT_ABOVE = 32` (`movement_system.ts:69,77`) are the *entity* box, not the tile — do not scale them with tile size. They are a separate concern; leave them and note it.
- `CELL_PIXEL_SIZE = 32` in `render_system.ts:32` is in the mostly-dead module; do not chase it here.

### AC-6: Weighted A* replaces JPS and honours movement cost
**Given** a grid with a low-cost road and high-cost rough terrain between two points
**When** a path is requested
**Then** A* returns a route preferring the road, resolves in under 2ms on a 200×200 grid, and no JPS module remains in the tree

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | `packages/frontend/engine/src/math/astar.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test && moon run engine:typecheck`
- Integration: cost-preference case; unreachable-goal case returning no path; timing assertion on a 200×200 worst case; assert `math/jps` and `jps_pathfinder_system.ts` no longer exist and the barrel exports nothing from them
- E2E / Visual: N/A

**Watch Points**:
- Delete `apps/e2e/tests/game/jps_navigation.spec.ts` with the module — it asserts only `page.title()` and would keep passing over deleted code.
- `goap_combat_tactics_system.ts` documents "JPS distance weighting" in its C-197 comments; check whether it calls anything from the JPS module or merely references it in prose.
- Diagonal movement must not cut corners through two diagonally-adjacent blocked cells.

### AC-7: NPCs and companions walk paths
**Given** a GOAP agent selecting an action with a destination, and a party companion following the player around a wall
**When** the tick runs
**Then** both receive a path, `PathFollow` writes their `Velocity`, they route around obstacles, and no client service posts per-entity velocities

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit + Visual | `packages/frontend/engine/src/systems/path_follow_system.test.ts`, `apps/e2e/src/visual/suites/emergent_world.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: place a companion behind a wall from the player, step the sim, assert it reaches the formation slot without passing through the wall; assert `SET_ENTITY_VELOCITY` has no remaining producer in `apps/frontend/client/src`
- E2E / Visual:
  - **Functional**: extend `apps/e2e/tests/game/emergent_world_integration.spec.ts` with an NPC-moved-over-time assertion
  - **Visual**: `emergent_world.visual.ts` — add `npcsOccupyVariedPositions: Type.Boolean({ description: 'Whether NPCs are distributed rather than frozen at spawn points' })`

**Watch Points**:
- Path-follow must run in the Navigation slot (`ecs_worker.ts` step 5), before `updateMovement` in Resolution — writing `Velocity` after movement resolves loses a frame and desynchronises facing.
- `party_follow_service` keeps its public interface for `game_composition_root.svelte.ts:448`; only the implementation moves. Verify the composition root still wires cleanly.
- Guard against repath storms: an agent whose goal is unreachable must back off via `repathAtMs`, not retry every tick.

### AC-8: Keybinding rebinds take effect
**Given** a player who rebinds "move up" in Settings → Controls
**When** they return to the game and press the new key
**Then** the player moves up, the old key does nothing, diagonal movement stays normalised, and `systems/input_system.ts` no longer exists

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Unit + E2E | `packages/frontend/engine/src/__tests__/game_world.test.ts` | `/game`, `/settings` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test && moon run client:test`
- Integration: write a custom binding to the localStorage key the settings VM uses, construct the keyboard handler, dispatch the rebound key, assert the posted velocity; assert holding two direction keys yields a normalised diagonal and releasing one leaves the other active
- E2E / Visual: Playwright — rebind via the settings UI, return to `/game`, assert `__AIKAMI_DEBUG__.playerX/Y` changes on the new key

**Watch Points**:
- The two-keys-held case is the behaviour the dead module got wrong; assert it explicitly so a future "consolidation" cannot reintroduce the LUT.
- `keyToDirection` reads localStorage; the handler must re-read on rebind (or subscribe) rather than caching at setup, or changes need a reload.

### AC-9: Flip flags, GID convention and multi-tileset layers are correct
**Given** a map with horizontally-flipped tiles, a tileset whose `firstgid` is not 1, and a layer referencing two tilesets
**When** the map loads
**Then** flipped tiles render flipped rather than vanishing, no flipped cell becomes spuriously solid, GIDs resolve identically across collision and rendering, and each tile samples its own tileset's texture

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-9 | Unit | `packages/frontend/engine/src/assets/map_loader.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: fixture with all three flip bits set; fixture with `firstgid: 17`; fixture with two tilesets in one layer. Assert resolved local IDs, collision parity, and per-tile texture selection
- E2E / Visual: N/A

**Watch Points**:
- Flip state must survive to the renderer (UV swap or vertex order), not merely be stripped. Stripping alone fixes collision and silently renders the wrong orientation.
- `map_loader.test.ts:178` already has a `firstgid: 17` fixture — extend it to assert the resolved ID rather than only that parsing succeeds.

### AC-10: Existing saves load unchanged
**Given** a save created before this contract
**When** it is loaded
**Then** the player restores to the same map, position and state, and no wall entity or `PathFollow` data is expected in the snapshot

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-10 | Unit | `apps/frontend/client/src/lib/services/game/game_save_service.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test && moon run engine:test`
- Integration: load a committed pre-contract v3 save fixture; assert restored position and that `serializeEntityStates` output contains no `PathFollow`
- E2E / Visual: N/A

**Watch Points**:
- The LOAD_MAP spawn clamp (`ecs_worker.ts:1950,1968`) currently calls bare `isWalkable`; when it moves to `terrainCost` the clamp behaviour must not shift, or restored saves land on different tiles than they were saved on.

## Implementation Sequence

1. **Phase 1 (Grids)**: Build `terrainCost` + `blocksSight` from C-378's terrain channel. Migrate every `isCellBlocked || !isWalkable` composite call site in one change. Re-point `setBresenhamGrid`. Delete `_populateWallsFromCollisionGrid`, `_wallEids`, the budget guard and the boolean grid.
2. **Phase 2 (GridPosition)**: Add the sync system with change-gated occupancy updates. Give the player `GridPosition` + `CollisionData` + `SpatialLink`. Feed `blocksSight` to the vision raycasters.
3. **Phase 3 (Movement)**: Per-entity masks; map-driven tile size.
4. **Phase 4 (Navigation)**: Write weighted A* with tests. Add `PathFollow` + the path-follow system in the Navigation slot. Delete `math/jps/*`, `jps_pathfinder_system.ts`, its test, and the E2E spec.
5. **Phase 5 (Consumers)**: GOAP movement executor. Fold party follow into an ECS goal provider behind the existing service facade.
6. **Phase 6 (Input)**: Wire `keyToDirection` into `GameWorld._setupKeyboardInput`; delete `input_system.ts`; prune the barrel.
7. **Phase 7 (Parsing)**: Flip-flag masking, single GID convention, multi-tileset layer support.
8. **Phase 8 (Validation)**: `moon run :typecheck && :test && :lint`; `collision_e2e.spec.ts`, `vision_perception.spec.ts`, `emergent_world_integration.spec.ts`; `emergent_world.visual.ts`.

## Edge Cases & Gotchas

- **Giving the player `CollisionData` is a behaviour change, not a bookkeeping one.** NPCs will start being blocked by the player. Verify no NPC can be permanently trapped between the player and a wall, and that dialogue proximity still triggers.
- **The intrusive linked list is unforgiving.** A double insert or a missed remove silently corrupts a cell's list and produces phantom blockers that survive until map reload. Assert list integrity (walk every cell, count nodes, compare to expected occupancy) in a test helper.
- **`serializeEntityStates` still indexes by raw `eid`.** Removing 182 wall entities relieves the pressure but does not fix the coupling; if entity counts grow later, entities past index 10000 vanish. Note it; do not fix it here.
- **`resetMovementTracking` is a documented no-op** (`movement_system.ts:293`). Delete it while in this file.
- **The GOAP action registry has no notion of "where".** Adding a goal cell to actions is a genuine design step, not a wiring step — keep it minimal (a handful of actions gain a destination; the rest stay in place) rather than modelling a full navigation graph.
- **Do not "improve" `goap_combat_tactics_system` while passing through.** It has 529 lines of tests pinning current behaviour; the mask fix is the only intended change.

## Open Questions

Must be resolved before status becomes `approved`:

- Cost encoding: `Uint8Array` with cost ×16 caps at 15.9. Is that range sufficient, or should it be `Uint16Array`? Recommendation: `Uint8Array` — a cost above ~4 is indistinguishable from impassable in practice.
- Should `PathFollow` support path smoothing (string-pulling) in this contract, or is waypoint-to-waypoint movement acceptable? Recommendation: defer smoothing — grid-aligned movement reads as deliberate in a JRPG, and smoothing interacts with the collision box in ways worth testing separately.
- Does the party-follow formation goal become a GOAP action, or a separate lightweight goal provider? Recommendation: separate provider — companions should follow while GOAP is idle, without competing for the action slot.

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
