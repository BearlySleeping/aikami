# Contract C-342: Add World Interactables, Dungeons, Puzzles, and Loot Tables

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — Phase 2 — Core RPG Depth and Replayability |
| **Target** | `packages/frontend/engine/` ECS components & systems, `packages/shared/schemas/` interactable/puzzle TypeBox schemas, `packages/shared/types/` derived types, `apps/frontend/client/src/lib/services/game/` world state service, `apps/frontend/client/src/lib/views/game/` HUD overlays |
| **Priority** | P1 — spatial play needs more verbs than move and talk |
| **Dependencies** | C-173 (ECS Spatial Hash Grid — completed), C-175 (LLM JTON Map Pipeline — completed), C-315 (Content Pack Manifest — completed), C-331 (Inventory/Equipment/Loot — approved, code exists in codebase), C-336 (Rules Kernel — approved, code exists in codebase) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | none (internal systems) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The only interactable types in the engine are `npc` (triggers dialogue) and `item` (pickup → inventory). There are no doors to open, chests to loot, levers to pull, traps to disarm, pressure plates to step on, readable signposts to inspect, or containers to search. "Props" spawn as purely decorative entities with no interaction hook. When the player revisits a map, items respawn unless their `spawnId` is in `collectedPickups` — but there is no equivalent state tracking for "door opened," "chest looted," "lever toggled."
- **Reproduction**: Load the Emberwatch demo map (`village_square`). Walk to any prop (chest graphic). Press Interact (E/Enter). Nothing happens — the prop has no Interactable component. Complete a dungeon map, leave, return. All chests are closed again, all items respawn (unless collected), doors that were opened are closed. There is no concept of "dungeon state."
- **Existing implementation to reuse**:
  - `packages/frontend/engine/src/components/interactable.ts` — existing Interactable SoA component with `type: 'npc' | 'item'`, `itemId`, `quantity`, `spawnId` fields
  - `packages/frontend/engine/src/systems/interaction_system.ts` — `handleInteract()` dispatcher with item pickup + NPC dialogue branches
  - `packages/frontend/engine/src/systems/interaction_proximity_system.ts` — per-tick nearest-interactable evaluation with dirty-checked `INTERACTION_TARGET_CHANGED` emission
  - `packages/frontend/engine/src/systems/interaction_target_selector.ts` — `selectInteractionTarget()` shared helper
  - `packages/frontend/engine/src/systems/entity_spawner.ts` — `spawnEntities()` with type dispatch (`npc`, `prop`, `item`, `enemy`)
  - `packages/shared/schemas/src/lib/database/item.ts` — `WorldPickupStateSchema` with `collectedPickups` + `lootGrantedEncounters`
  - `packages/shared/schemas/src/lib/game/rules_command.ts` — `RollLootCommandSchema` + `RulesCommandSchema` discriminated union
  - `packages/shared/utils/src/lib/rules/rules_kernel.ts` — `resolveRollLoot()` deterministic loot resolution
  - `packages/shared/schemas/src/lib/game/content_pack.ts` — `ContentPackManifestSchema`, `ContentPackLootEntrySchema`, `ContentPackEncounterEntrySchema`
  - `apps/frontend/client/src/lib/services/game/world_state_service.svelte.ts` — `WorldStateService` with `defeatedEnemies` + `collectedPickups` tracking
  - `packages/frontend/engine/src/game_world.ts` — `loadMap()` passes `collectedPickups` + `defeatedEnemies` to worker via `_postLoadMap`
- **Known gaps**:
  - `InteractableType` is only `'npc' | 'item'` — no door, chest, lever, pressure_plate, container, readable, trap
  - No ECS component for interactable runtime state (is the door open? is the chest looted? is the lever toggled?)
  - No content pack schema for defining interactables beyond items/NPCs in manifests
  - No per-map "dungeon state" persistence layer — `WorldPickupState` only tracks picked-up items and defeated enemies
  - Props are decorative-only — no interaction system integration
  - No puzzle dependency system — levers cannot open doors, pressure plates cannot trigger traps
  - JTON spawn parser only supports `npc`, `item`, `enemy` spawn types — not the new interactable types
  - Collision grid is static — opened doors and lowered bridges don't update walkability
  - AssetAlias only has `PROP_CHEST: 3` — doors, levers, traps, containers, readables need unique visual aliases
- **Baseline tests**:
  - `packages/frontend/engine/src/systems/interaction_system.test.ts` — 2 test suites covering item pickup and NPC interaction
  - `packages/frontend/engine/src/systems/entity_spawner.test.ts` — spawn type dispatch tests
  - `packages/frontend/engine/src/__tests__/interaction_proximity_system.test.ts` — proximity + target switching
  - `packages/frontend/engine/src/__tests__/interaction_target_selector.test.ts` — target selection priority
  - `packages/frontend/engine/src/systems/interaction_system.test.ts` — "does nothing when no interactable entities exist"

## User Outcome

After this contract, a player can walk up to a door, unlock it with a key, and watch it open; pull a lever to extend a bridge; loot a chest and see it stay open on revisit; step on a pressure plate to trigger a trap; read a signpost for lore; and solve a multi-step puzzle where pulling lever A opens door B. All interactable states persist across map transitions and game reloads. A content author can define these interactables and their puzzle dependencies in the content pack manifest.

## Success Measures

- **Time/latency target**: Interactable state changes (open/close/toggle) resolve within 1 tick (<16ms). Loot roll uses existing deterministic `resolveRollLoot` path (<1ms).
- **Offline/degraded behavior**: All interactable logic is purely local — no AI/network dependency. Puzzle resolution, loot rolls, and state changes run entirely in the deterministic engine.
- **Production journey enabled**: Player can explore dungeons with meaningful spatial verbs — unlock passages, solve environmental puzzles, loot treasure — making the game world feel reactive rather than static.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Interactable component (SoA) | `packages/frontend/engine/src/components/interactable.ts` | **Modify** — extend `InteractableType` union, add state fields (`isOpen`, `isLocked`, `isLooted`, `isToggled`, `requiredItemId`) |
| Interaction dispatch | `packages/frontend/engine/src/systems/interaction_system.ts` | **Modify** — add branches for door, chest, lever, container, readable, trap in `handleInteract()` |
| Target selection | `packages/frontend/engine/src/systems/interaction_target_selector.ts` | **Reuse** — no changes needed; selector is type-agnostic |
| Proximity system | `packages/frontend/engine/src/systems/interaction_proximity_system.ts` | **Reuse** — no changes; dirty-check + emission works on any Interactable type |
| Entity spawner | `packages/frontend/engine/src/systems/entity_spawner.ts` | **Modify** — add spawn branches for each new interactable type, wire InteractableState component |
| JTON parser | `packages/frontend/engine/src/assets/jton_parser.ts` | **Modify** — extend spawn type hash dispatch for new types |
| Loot resolution | `packages/shared/utils/src/lib/rules/rules_kernel.ts` | **Reuse** — `resolveRollLoot()` handles chest/container loot identically |
| Loot schema | `packages/shared/schemas/src/lib/game/rules_command.ts` | **Reuse** — `RollLootCommandSchema` unchanged |
| World state persistence | `apps/frontend/client/src/lib/services/game/world_state_service.svelte.ts` | **Modify** — add `interactableStates: Record<string, InteractableStateEntry>` map |
| World pickup schema | `packages/shared/schemas/src/lib/database/item.ts` | **Modify** — extend `WorldPickupStateSchema` with `interactableStates` field |
| Content pack schema | `packages/shared/schemas/src/lib/game/content_pack.ts` | **Modify** — add `ContentPackInteractableEntrySchema`, `ContentPackPuzzleSchema`, optional `interactables` + `puzzles` maps on manifest |
| Map loading pipeline | `packages/frontend/engine/src/game_world.ts` | **Modify** — pass `interactableStates` alongside `collectedPickups` in `_postLoadMap` |
| AssetAlias | `packages/frontend/engine/src/components/visual.ts` | **Modify** — add aliases for door, lever, pressure_plate, container, readable, trap sprites |
| Collision grid | `packages/frontend/engine/src/assets/map_loader.ts` + engine worker | **Modify** — support runtime collision updates when doors open / bridges extend |

## Overview

This contract transforms the world from a static diorama into a reactive environment. It expands the interaction system from 2 types (npc, item) to 6+ (door, chest, lever, pressure_plate, container, readable, trap), adds runtime state tracking per interactable (open/closed, locked/unlocked, looted/unlooted, toggled), persists that state across map revisits, integrates authored loot tables for containers/chests via the existing deterministic rules kernel, and wires a puzzle dependency engine where interactables can be chained (e.g., lever A toggles door B). A dungeon is identified as a tagged map type with state persistence gated on the `dungeon` flag. All changes are additive — existing NPC/item interaction paths are unmodified.

## Design Reference

- **ECS component pattern**: Follow `packages/frontend/engine/src/components/interactable.ts` — SoA arrays, `observe(onSet/onGet)`, `registerXObservers(world)` factory. The new `InteractableState` component mirrors this pattern exactly.
- **Interaction dispatch**: Follow `packages/frontend/engine/src/systems/interaction_system.ts` — `handleInteract()` dispatches on `interactable.type`. Add `case 'door'`, `case 'chest'`, `case 'lever'`, `case 'container'`, `case 'readable'`, `case 'trap'`.
- **Entity spawner dispatch**: Follow the existing `spawnEntities()` switch on `spawnPoint.type`. Add branches for each new interactable spawn type.
- **World state service**: Follow `world_state_service.svelte.ts` — `$state` array for `collectedPickups`, mirror as `$state` map for `interactableStates`.
- **Schema pattern**: Follow `packages/shared/schemas/src/lib/game/content_pack.ts` — discriminated object unions with `kind` discriminators, `additionalProperties: false`.
- **Map load pipeline**: Follow `game_world.ts` → `_postLoadMap` → worker `LOAD_MAP` handler → `spawnEntities`. Pass `interactableStates` alongside existing `collectedPickups` / `defeatedEnemies`.
- **Puzzle dependency**: Model as a directed acyclic graph (DAG) — each interactable can declare `activatesOn` (list of spawn IDs that must be in a target state). The engine evaluates the DAG on any state change.
- **Existing contract patterns**: C-331 for additive inventory/pickup integration into the existing interaction pipeline. C-336 for the rules command pattern. C-327 for interaction UX wiring.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

### New ECS Components (`packages/frontend/engine/src/components/`)

- **`Interactable`** (modify existing): Extend `InteractableType` to `'npc' | 'item' | 'door' | 'chest' | 'lever' | 'pressure_plate' | 'container' | 'readable' | 'trap'`. Add SoA fields: `requiredItemId`, `requiredState` (for locked doors), `puzzleGroupId`, `activatesOnSpawnIds` (comma-separated string of spawn IDs that toggle/activate this interactable).
- **`InteractableState`** (new): SoA component — `isOpen`, `isLocked`, `isLooted`, `isToggled`, `isTriggered`, `lootTableKey` (string registry index). Registered per-world via `registerInteractableStateObservers(world)`.

### Modified ECS Systems (`packages/frontend/engine/src/systems/`)

- **`interaction_system.ts`** (modify): Add dispatch branches for each new interactable type. Door: check `requiredItemId` (key) → toggle open, update collision. Chest: roll loot → mark looted → emit `LOOT_GENERATED`. Lever: toggle → evaluate puzzle DAG. Container: open → roll loot → mark looted. Readable: emit `READABLE_INTERACTED` with text. Trap: resolve via skill check → emit `TRAP_TRIGGERED`.
- **`entity_spawner.ts`** (modify): Add `_spawnDoor`, `_spawnChest`, `_spawnLever`, etc. Wire `InteractableState` component. Respect `interactableStates` map to suppress already-looted chests, set initial open/closed/toggled state.
- **`puzzle_resolver.ts`** (new): Stateless pure function `evaluatePuzzleDag(options: { world, changedSpawnId, interactableStates })` → walks the DAG, returns list of interactables whose activation conditions are met.
- **`collision_updater.ts`** (new): Updates the spatial hash when doors open/close or bridges extend/retract. Called reactively from interaction system.

### Modified Schemas (`packages/shared/schemas/src/lib/game/`)

- **`content_pack.ts`** (modify): Add `ContentPackInteractableEntrySchema` (discriminated on `kind: 'door' | 'chest' | 'lever' | 'pressure_plate' | 'container' | 'readable' | 'trap'`), `ContentPackPuzzleSchema` (DAG edges between spawn IDs), optional `interactables` + `puzzles` on manifest.
- **`interactable_state.ts`** (new): `InteractableStateEntrySchema` — maps spawnId → `{ isOpen?, isLocked?, isLooted?, isToggled?, isTriggered? }`.
- **`database/item.ts`** (modify): Extend `WorldPickupStateSchema` with `interactableStates: Record<string, InteractableStateEntrySchema>`.

### Modified Types (`packages/shared/types/src/lib/`)

- **`game/interactable.ts`** (new): Derived types from schemas — `InteractableStateEntry`, `InteractableKind`, `ContentPackInteractableEntry`, `ContentPackPuzzle`.
- **`database/item.ts`** (modify): Extend `WorldPickupState` type.

### Modified Frontend Services (`apps/frontend/client/src/lib/services/game/`)

- **`world_state_service.svelte.ts`** (modify): Add `interactableStates: Record<string, InteractableStateEntry>` with `markInteractableState(spawnId, changes)` and `isLooted(spawnId)` methods. Serialize/hydrate alongside existing arrays.
- **`game_overlay_service.svelte.ts`** (modify): Add `getInteractableStates()` passthrough for map boot data.
- **`bridge_listeners.ts`** (modify): Listen for `DOOR_OPENED`, `LEVER_TOGGLED`, `LOOT_GENERATED`, `TRAP_TRIGGERED` events → update world state.

### Modified Engine Bridge Types (`packages/frontend/engine/src/types.ts`)

- Add event types: `DOOR_OPENED`, `DOOR_CLOSED`, `LEVER_TOGGLED`, `LOOT_GENERATED` (from chest/container), `TRAP_TRIGGERED`, `READABLE_INTERACTED`, `PUZZLE_SOLVED`.

### Modified Visual Assets (`packages/frontend/engine/src/components/visual.ts`)

- Add `AssetAlias` entries: `PROP_DOOR_CLOSED: 5` (uses gap between `ENEMY:4` and `ITEM:6`), `PROP_DOOR_OPEN: 8`, `PROP_LEVER_OFF: 9`, `PROP_LEVER_ON: 10`, `PROP_PRESSURE_PLATE: 11`, `PROP_CONTAINER: 12`, `PROP_READABLE: 13`, `PROP_TRAP: 14`.

## State & Data Models

```typescript
// ── Interactable kind discriminator ──

type InteractableKind =
  | 'npc'
  | 'item'
  | 'door'
  | 'chest'
  | 'lever'
  | 'pressure_plate'
  | 'container'
  | 'readable'
  | 'trap';

// ── InteractableState ECS component (SoA, bitECS) ──

type InteractableStateData = {
  /** 0 = closed, 1 = open (doors, chests, containers). */
  isOpen: number;
  /** 0 = unlocked, 1 = locked (doors, chests). */
  isLocked: number;
  /** 0 = not looted, 1 = already looted (chests, containers). */
  isLooted: number;
  /** 0 = off, 1 = on (levers, pressure plates). */
  isToggled: number;
  /** 0 = not triggered, 1 = already triggered (traps, one-shot triggers). */
  isTriggered: number;
  /** String registry index for authored loot table key (chests, containers).
   *  The content pack loader resolves `lootTableKey` (string in content pack entry)
   *  → integer at load time via a `Map<string, number>` lookup table stored on the
   *  InteractableState observer factory. See AC-4 Watch Points. */
  lootTableKey: number;
};

// ── Persisted interactable state (in WorldPickupState) ──

type InteractableStateEntry = {
  isOpen?: boolean;
  isLocked?: boolean;
  isLooted?: boolean;
  isToggled?: boolean;
  isTriggered?: boolean;
};

// ── Content pack interactable definition (discriminated on kind) ──

type ContentPackInteractableDoor = {
  kind: 'door';
  spawnId: string;
  mapId: string;
  lockedByDefault: boolean;
  /** Item ID required to unlock (e.g., 'rustyKey'). */
  requiredItemId?: string;
  /** Whether the door starts open. */
  startsOpen: boolean;
  /** Spawn IDs of interactables that activate (open) this door when toggled. */
  activatedBySpawnIds: string[];
};

type ContentPackInteractableChest = {
  kind: 'chest';
  spawnId: string;
  mapId: string;
  lockedByDefault: boolean;
  requiredItemId?: string;
  /** Key into the manifest's lootTables record. */
  lootTableKey: string;
  /** Whether the chest appears as looted (open) after looting or respawns. */
  respawns: boolean;
};

type ContentPackInteractableLever = {
  kind: 'lever';
  spawnId: string;
  mapId: string;
  startsToggled: boolean;
  /** Spawn IDs of interactables that activate when this lever is toggled. */
  activatesSpawnIds: string[];
  /** If true, the lever stays toggled after use. If false, it springs back. */
  staysToggled: boolean;
};

type ContentPackInteractablePressurePlate = {
  kind: 'pressure_plate';
  spawnId: string;
  mapId: string;
  /** Spawn IDs activated while the plate is pressed (player on it). */
  activatesSpawnIds: string[];
  /** Spawn IDs deactivated when the plate is released. */
  deactivatesOnReleaseSpawnIds: string[];
};

type ContentPackInteractableContainer = {
  kind: 'container';
  spawnId: string;
  mapId: string;
  lootTableKey: string;
  respawns: boolean;
};

type ContentPackInteractableReadable = {
  kind: 'readable';
  spawnId: string;
  mapId: string;
  /** Dialogue key for the text displayed on inspect. */
  textDialogueKey: string;
};

type ContentPackInteractableTrap = {
  kind: 'trap';
  spawnId: string;
  mapId: string;
  /** Damage dice (e.g., '2d6') dealt when triggered. */
  damageDice: string;
  /** DC for disarm skill check. 0 = no disarm possible. */
  disarmDc: number;
  /** Whether the trap is visible before triggering. */
  visible: boolean;
  /** Whether the trap re-arms after triggering (e.g., a flame jet). */
  reArms: boolean;
};

type ContentPackInteractableEntry =
  | ContentPackInteractableDoor
  | ContentPackInteractableChest
  | ContentPackInteractableLever
  | ContentPackInteractablePressurePlate
  | ContentPackInteractableContainer
  | ContentPackInteractableReadable
  | ContentPackInteractableTrap;

// ── Puzzle definition (DAG edges) ──

type ContentPackPuzzle = {
  /** Unique puzzle ID for journal/quest tracking. */
  puzzleId: string;
  /** Human-readable name. */
  name: string;
  /** Map ID where this puzzle lives. */
  mapId: string;
  /** Spawn IDs that participate in this puzzle. */
  interactableSpawnIds: string[];
  /** Dialogue key shown when the puzzle is solved. */
  solvedDialogueKey: string;
};

// ── Loot table key reference (reuses existing ContentPackLootEntrySchema) ──
// ContentPackManifest gains optional lootTables: Record<string, ContentPackLootEntry[]>
```

## Quality Requirements

- **Offline/degraded mode**: N/A — all interactable logic is fully deterministic and local. No AI or network dependency.
- **Accessibility/input**: Interactable target names (e.g., "Rusty Door", "Oak Chest", "Stone Lever") are surfaced via the existing `INTERACTION_TARGET_CHANGED` event for screen-reader DOM UI (C-346). Interaction verb changes based on state ("Open" vs "Close," "Pull Lever" vs "Lever (already pulled)").
- **Performance budget**: Interactable state evaluation within 1 tick (<16ms). Puzzle DAG walk is O(V+E) with V = interactables on the current map (typically <50). No per-frame work beyond the existing proximity evaluation.
- **Security/privacy**: N/A — all interactable state is local. No sensitive data.
- **Persistence/migration**: Interactable states are persisted in `WorldPickupStateSchema.interactableStates`. Saves without this field default to all interactables in their authored initial state (backward-compatible — zero data loss). Campaigs pre-C-342 that lack the field will see all doors closed, all chests un-looted, all levers in default position.
- **Cancellation/retry/idempotency**: Loot generation is deterministic (seeded RNG) — same spawnId + same seed produces identical loot. Door toggle is idempotent (open → open is a no-op). Trap trigger is one-shot by default (`isTriggered` prevents re-fire).
- **Observability**: `this.debug()` on all interaction system branches with `{ spawnId, kind, action }`. Emit typed events (`DOOR_OPENED`, `LEVER_TOGGLED`, etc.) that can be traced in the bridge log.

## Migration & Rollback

- **Old data compatibility**: Saves without `interactableStates` default to authored initial state for all interactables. No data is lost — the new field is optional in the schema. Players on old saves will see all doors closed, all chests un-looted.
- **Migration**: No explicit migration step required. On first map load post-upgrade, each interactable reads its authored default state (e.g., `startsOpen: false`). As the player interacts, state entries are created. On save, the full `interactableStates` map is serialized.
- **Rollback**: Reverting to pre-C-342 code ignores the `interactableStates` field in saves (it's an unknown JSON key, harmless). Newly interacted objects revert to authored defaults on next map load — functional but not data-corrupting.
- **Feature flag or kill switch**: No dynamic flag needed. The system is purely additive — if no interactables are authored in a content pack, zero code paths are activated. The spawn dispatch is gated on `spawnPoint.type` matching known types.
- **Failure recovery**: If the puzzle DAG evaluation throws (e.g., circular reference), the error is caught, logged via `this.error()`, and the specific interactable reverts to its authored default. No state is mutated on error.

## Scope Boundaries

- **In Scope:**
  - 6 new interactable types: door, chest, lever, pressure_plate, container, readable, trap
  - ECS `InteractableState` SoA component with observer registration
  - Content pack schema for defining interactables + puzzles in manifests
  - JTON spawn type extension for the new types
  - Entity spawner branches for each new interactable type
  - Interaction system dispatch branches for each new type
  - Chest/container loot resolution via existing `resolveRollLoot` (C-336)
  - Per-map interactable state persistence via `WorldPickupStateSchema.interactableStates`
  - Puzzle dependency DAG: authored `activatedBySpawnIds` / `activatesSpawnIds` chains
  - Collision grid updates when doors open/close
  - Visual state changes (swap sprite on open/close/toggle)
  - `AssetAlias` entries for new prop types
  - EngineBridge event types for all new interactions
  - World state service `interactableStates` CRUD + serialize/hydrate

- **Out of Scope:**
  - Procedurally generated dungeons (C-368)
  - AI-driven puzzle generation (C-353)
  - Grid-based cover/positioning/flanking in combat (that's C-338/combat; door cover is C-338's scope)
  - Map-pin rendering for interactables (that's quest journal UI, deferred from C-339 to this contract but C-339 already scoped it out — no map pin work here either)
  - HUD waypoint arrows pointing to interactables (C-339's deferred scope)
  - Dungeon minimap (separate UI concern)
  - Content authoring studio for interactable definitions (C-358)
  - Door/chest destruction (bash open) mechanics (deferred — only key-based unlocking in scope)
  - Multi-player puzzle synchronization (C-366)
  - Trap disarm mini-game (only skill-check-based disarm via C-336 rules kernel)
  - Generic world-object interactions beyond the 7 defined types (e.g., "push boulder," "cut rope")
  - Class-specific equipment restrictions for chest loot (C-337)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs, 4 affected packages + 1 app. The engine, schemas, types, and client service edits are all enablers of a single releasable capability ("player can interact with world objects beyond NPCs and pickups"). Splitting by layer would create contracts that cannot pass their own acceptance gates independently (e.g., an engine-only contract has no schema to validate against; a schema-only contract has nothing to test against). The interactable types, state persistence, loot tables, puzzle DAG, and dungeon identity are all tightly coupled — a chest without its loot table is just a decorative door. This stays as one contract.

## Acceptance Criteria

### AC-1: World Interactable Type Extension — Spawn, Render, and Target

**Given** the game world is loaded with a map containing spawn points of types `door`, `chest`, `lever`, `pressure_plate`, `container`, `readable`, and `trap`
**When** the entity spawner processes these spawn points
**Then** each spawn type creates an ECS entity with the correct `Interactable` component (`type` field matches spawn type), `InteractableState` component (initialized to authored defaults), `Position`, and `Visual` (using the correct `AssetAlias` for the type). The interaction proximity system identifies these entities as valid targets and emits `INTERACTION_TARGET_CHANGED` with the correct `targetType`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Integration | `packages/frontend/engine/src/systems/entity_spawner.test.ts`, `packages/frontend/engine/src/__tests__/interaction_proximity_system.test.ts` | N/A (engine tests) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: Spawn each interactable type via `spawnEntities()`, verify Interactable + InteractableState components, verify `INTERACTION_TARGET_CHANGED` emission for each type
- E2E / Visual:
    - **Functional**: N/A (covered by engine unit tests)
    - **Visual**: `suites/interactables.visual.ts` — declarative test case for each interactable type rendered on a dev sandbox map. Score 90+: each entity renders with correct sprite (door looks like a door, chest looks like a chest), interaction prompt displays correct name.

**Watch Points**:
- JTON spawn format must be extended cleanly — the current `type`-based dispatch in `jton_parser.ts` and `entity_spawner.ts` uses a switch. New types must not break existing `npc`/`item`/`enemy` parsing.
- `InteractableState` must be registered via observer BEFORE any entities are created (same pattern as `registerInteractableObservers`).

### AC-2: Interactable State Persistence Across Map Revisits

**Given** a dungeon map containing a chest (spawnId `dungeon_chest_1`), a locked door (spawnId `cell_door`), and a lever (spawnId `gate_lever`)
**When** the player loots the chest, unlocks the door with a key, pulls the lever, leaves the map, and returns
**Then** the chest remains looted (open sprite, cannot be looted again), the door remains unlocked and open, and the lever remains toggled. The `WorldPickupState.interactableStates` entries for all three spawn IDs reflect the changed state. On save/load cycle, the state is preserved.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration + E2E | `packages/frontend/engine/src/__tests__/map_transition_state.test.ts` (new), `tests/client/interactable_persistence.spec.ts` | `/game` — load dungeon, interact, leave, return | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`, `bun moon run e2e:test`
- Integration: Engine-level test: create world, spawn chest/door/lever, simulate interaction, serialize `interactableStates`, create fresh world with same spawn points + serialized state, verify entities spawn in correct state
- E2E / Visual:
    - **Functional**: `tests/client/interactable_persistence.spec.ts` — test "loot chest → leave map → return map → chest is open and cannot be looted again"
    - **Visual**: N/A (functional E2E covers this)

**Watch Points**:
- State is keyed by `spawnId` which must be unique across ALL maps in a campaign. If two maps have a chest with the same `spawnId`, they share state — this is by design for multi-map puzzles but must be documented.
- The `interactableStates` map grows unboundedly — for campaigns with hundreds of interactables this is fine (<1KB of JSON). No TTL/eviction needed at this scale.

### AC-3: Interactive State Changes — Doors, Levers, Pressure Plates, Readables, and Traps

**Given** a map with authored interactables of each new type
**When** the player presses Interact near each
**Then**:
- **Door**: If locked and player has `requiredItemId`, door unlocks. If unlocked, door toggles open/closed. Open doors update the collision grid (become walkable). Emits `DOOR_OPENED` or `DOOR_CLOSED`.
- **Lever**: Toggles on/off. If `staysToggled`, remains in new state. Emits `LEVER_TOGGLED`. Triggers puzzle DAG evaluation for `activatesSpawnIds`.
- **Pressure Plate**: When player steps on it (proximity-based, not interact key), plate toggles on. When player steps off, plate toggles off (unless `staysToggled`). Triggers `activatesSpawnIds` on press, `deactivatesOnReleaseSpawnIds` on release.

  **Pressure plate detection requires a dedicated per-frame position check** — the existing `INTERACTION_TARGET_CHANGED` proximity system only fires when the nearest interactable target changes, not every frame that the player occupies a tile. A new `pressure_plate_system.ts` should perform a per-tick check of the player's tile against all pressure plate spawn positions and emit activation/deactivation. See Watch Points below.
- **Readable**: Emits `READABLE_INTERACTED` with `textDialogueKey` for the dialogue overlay to display — no state change.
- **Trap**: If `visible` and not yet triggered, triggers immediately (emit `TRAP_TRIGGERED`, apply damage via rules kernel). If `disarmDc > 0`, player can attempt disarm (skill check via C-336). If `reArms`, `isTriggered` resets after a cooldown.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Integration + Visual | `packages/frontend/engine/src/systems/interaction_system.test.ts` (extend), `packages/frontend/engine/src/systems/puzzle_resolver.test.ts` (new) | N/A (engine tests) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: Unit test each interaction branch — door locked/unlocked/open/close, lever on/off, pressure plate on-enter/on-exit, readable emit, trap trigger + disarm. Verify collision grid updates on door open.
- E2E / Visual:
    - **Functional**: N/A (covered by engine unit + integration tests)
    - **Visual**: `suites/interactables.visual.ts` — door closed → door open sprite swap, lever off → lever on sprite swap, chest closed → chest open after looting. Score 90+: correct sprite rendered for each state, no visual regression on existing NPC/item sprites.

**Watch Points**:
- Door collision update must call into the spatial hash grid (C-173) — verify the tile becomes walkable after door opens. This is the first runtime collision mutation; all previous collision was static on map load. The AC-3 evidence matrix needs a collision-integration test artifact.
- **Pressure plate detection cannot reuse `INTERACTION_TARGET_CHANGED` alone** — the proximity system only fires when the nearest interactable target switches; it does not fire every tick the player occupies a tile. Implement a dedicated per-tick pressure plate system (`pressure_plate_system.ts`) that checks the player's tile position against all pressure plate spawn positions. The `INTERACTION_TARGET_CHANGED` event's `targetType` can indicate a plate is the nearest interactable, but the actual press/release trigger must use a separate tile-overlap check.
- Trap `reArms` cooldown must use wall-clock time (not tick count) to survive frame rate variations.

### AC-4: Chest & Container Loot Tables via Deterministic Rules Kernel

**Given** a content pack manifest defining a chest with `lootTableKey: 'dungeon_tier_1'` and a corresponding `lootTables.dungeon_tier_1` array of `ContentPackLootEntry` items
**When** the player interacts with the chest (and it is not already looted)
**Then** the engine calls `resolveRollLoot` from the rules kernel with the loot table, generates items deterministically (same seed = same loot), emits `LOOT_GENERATED` with the item list, marks the chest as looted (`isLooted: 1`), and the client inventory service processes the items identically to encounter loot drops. Duplicate-loot guard: if the chest's `lootTableKey` + `spawnId` appears in `lootGrantedEncounters`, the chest spawns already-looted.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `packages/frontend/engine/src/systems/interaction_system.test.ts` (extend), `packages/shared/utils/src/lib/rules/__tests__/rules_kernel.test.ts` (extend with chest-loot scenario) | N/A (engine + rules tests) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`, `bun moon run utils:test`
- Integration: Unit test: spawn chest, call `handleInteract`, verify `resolveRollLoot` is called with correct table, verify `LOOT_GENERATED` event has correct items, verify chest entity is marked `isLooted: 1`. Test that re-interacting with a looted chest is a no-op.
- E2E / Visual:
    - **Functional**: N/A (covered by integration tests)
    - **Visual**: N/A

**Watch Points**:
- `lootTableKey` is stored in the `InteractableState.lootTableKey` field (number registry index, not raw string) for memory efficiency. The content pack loader resolves the string key → integer at load time via a `Map<string, number>` lookup table. Because no AC explicitly tests this resolution step, the implementer must add a unit test verifying that `lootTableKey` 'dungeon_tier_1' resolves to the correct integer and that the loader throws/asserts on unknown keys.
- Determinism: same loot table + same campaign seed always produces identical loot. This is tested by the existing `rules_kernel.test.ts` "each loot entry rolls independently" test.

### AC-5: Puzzle Dependency Chains — Multi-Step Interlinked Interactables

**Given** a puzzle definition where lever A (`activatesSpawnIds: ['door_b']`) and pressure plate B (`activatesSpawnIds: ['door_c']`) control doors B and C respectively
**When** the player toggles lever A (door B opens), then steps on pressure plate B (door C opens), then steps off pressure plate B (door C closes)
**Then** door B opens when lever A is toggled on, door C opens when pressure plate B is pressed, door C closes when pressure plate B is released. The puzzle DAG evaluator correctly propagates state without cycles or missed activations. On map revisit, the puzzle state restores: if lever A was left on, door B spawns open.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + Integration | `packages/frontend/engine/src/systems/puzzle_resolver.test.ts` (new), `packages/frontend/engine/src/__tests__/puzzle_integration.test.ts` (new) | N/A (engine tests) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test`
- Integration: Unit test `evaluatePuzzleDag`: create 3-interactable chain (lever → door, pressure_plate → door), verify correct propagation. Test cycle detection: lever A activates door B, door B opens lever A — DAG evaluator must detect cycle and log error without infinite loop. Test map revisit: serialize puzzle state, reload, verify doors spawn in correct open/closed state.
- E2E / Visual:
    - **Functional**: N/A (covered by engine integration tests)
    - **Visual**: N/A

**Watch Points**:
- The DAG is evaluated eagerly on every state change (not lazily on interaction). This means toggling lever A immediately evaluates all downstream interactables. This guarantees the player sees the door open on the same tick as the lever pull.
- Cycle detection: the DAG walk uses a `visited` set per evaluation. If a cycle is detected (an interactable's activation would re-enter the current evaluation path), the walk halts and the cycle is logged. Authored cycles are a content error — the engine does not resolve them.
- Pressure plate release (`deactivatesOnReleaseSpawnIds`) is the only "reverse" activation. A lever that `staysToggled: false` simply toggles back to off, triggering the same `activatesSpawnIds` evaluation (which sets the target to the lever's new state).

## Implementation Sequence

1. **Phase 1 (Data Layer)**: Define `InteractableState` ECS component + observers. Extend `InteractableType` union. Add `AssetAlias` entries. Create `interactable_state.ts` schema + `interactable.ts` types. Extend `WorldPickupStateSchema` with `interactableStates`. Add `ContentPackInteractableEntrySchema` + `ContentPackPuzzleSchema` + `lootTables` to manifest schema.
2. **Phase 2 (Engine Logic)**: Extend `entity_spawner.ts` with new spawn branches. Modify `interaction_system.ts` dispatch. Implement `puzzle_resolver.ts` (DAG evaluator). Implement `collision_updater.ts` for door/bridge walkability. Extend JTON parser for new spawn types. Wire `interactableStates` through `game_world.ts` → `_postLoadMap` → worker `LOAD_MAP` handler.
3. **Phase 3 (Client Integration)**: Add `interactableStates` to `world_state_service.svelte.ts`. Wire bridge listeners for new events. Extend `game_overlay_service.svelte.ts` to pass interactable state on boot.
4. **Phase 4 (Validation)**: Run `bun moon run :validate`. Extend existing engine test suites for each AC. Create `puzzle_resolver.test.ts`. Run E2E + visual tests.

## Edge Cases & Gotchas

- **Duplicate spawnId across maps**: If two maps define a chest with the same `spawnId`, they share state. This is intentional for multi-map puzzles but could surprise content authors. Document in schema descriptions.
- **Door opening into occupied tile**: When a door opens, if the door's tile is occupied by an NPC/enemy, the door still opens but the NPC remains "inside" the door visually. Acceptable v1 behavior — fix deferred.
- **Pressure plate with no player position**: If the player entity is removed mid-tick (e.g., death), the pressure plate release logic must not throw. Guard with early return.
- **Loot table string registry exhaustion**: The `lootTableKey` field is a `number` (string registry index). If the same content pack defines >65K loot tables, registry overflow. Not a realistic concern — guard with assertion.
- **Puzzle DAG with 0 interactables**: `evaluatePuzzleDag` on an empty graph returns empty array. The puzzle definition validator in the manifest should require at least 2 interactables.
- **Interactable state during map transition**: `isSimulationActive()` returns false during transitions. Interactable state changes queued during transitions (impossible — input is locked) are a no-op.

## Open Questions

None — all design decisions are resolved in this contract. The scope boundaries explicitly defer procedural generation (C-368), AI puzzle generation (C-353), and content authoring (C-358). The puzzle DAG model follows the existing ECS pattern. Loot resolution reuses the deterministic C-336 rules kernel without modification.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
