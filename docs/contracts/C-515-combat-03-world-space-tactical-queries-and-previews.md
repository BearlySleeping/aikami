---
id: C-515
title: "Contract C-515: Combat-03 — World-Space Tactical Queries and Previews"
source: "docs/architecture/combat_2.md §10, §8.5, §15, §16, §22 — Combat-03 slice"
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-12T00:00:00Z"
---

# Contract C-515: Combat-03 — World-Space Tactical Queries and Previews

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/architecture/combat_2.md` §10 (spatial battlefield), §8.5 (validation/forecast), §15 (kernel API), §16 (bridge), §22 (rollout — "Movement budget, legal endpoints, range, LoS, forecast bridge API") |
| **Target** | `packages/shared/utils/src/lib/rules/combat_spatial.ts` (new pure leaf module) + `packages/shared/utils/src/lib/rules/combat_tactical.ts` (new pure query/forecast module), shared schema/type extensions, `packages/frontend/engine/src/combat/combat_battlefield.ts` (ECS projection) + `packages/frontend/engine/src/combat/combat_preview_handler.ts` + the `COMBAT_PREVIEW_REQUESTED`/`COMBAT_PREVIEW_READY` bridge |
| **Type** | full |
| **Priority** | P1 — Combat-04 direct control cannot ship without legal endpoints, range, LoS, and a preview API |
| **Dependencies** | C-509 (Combat-01 schemas + kernel — `verified`), C-514 (Combat-02 turn coordinator + driver — `verified`); reuses C-173 (spatial grid), C-379 (`collision_system`/`TerrainGrid`), C-190/C-174 (vision/Bresenham), C-192/C-380 (A*/path following) |
| **Status** | implemented |
| **Promotion** | `—` |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |
| **Production Surface** | `packages/shared/utils/src/lib/rules/combat_spatial.ts#computeReachableEndpoints`, `packages/shared/utils/src/lib/rules/combat_tactical.ts#getLegalActions`/`forecastCombatAction`, `packages/frontend/engine/src/combat/combat_battlefield.ts#snapshotBattlefield`, `packages/frontend/engine/src/combat/combat_preview_handler.ts#handleCombatPreviewRequest`, and the `COMBAT_PREVIEW_REQUESTED` → `COMBAT_PREVIEW_READY` bridge pair (engine API only; no player-facing UI until Combat-04) |

## Problem & Baseline Evidence

- **Current behavior**: Combat-01/02 built a deterministic kernel, state, and turn loop, but the mechanical layer has **no spatial awareness**:
  1. There is **no production `BattlefieldState` builder**. `snapshotCombatState` takes `BattlefieldState` (`combat_state_adapter.ts:245,293,336`) but the only provider is a test fixture (`combat_state_adapter.test.ts:54`); `snapshotCombatState` has no production caller. The C-514 driver (`startCombatTurns`, `turn_manager_system.ts:116`) never builds one.
  2. There is **no reachable-area computation**. A* is single-goal only (`math/astar.ts:180` `findPath`); no flood-fill/budget search exists.
  3. There is **no LoS in the rules layer**. `requiresLineOfSight` is declared on abilities (`combat_state.ts:147–149`, "enforced from Combat-03") and **ignored**; `validateUseAbility` (`combat_kernel.ts:329–371`) checks only `manhattan(...) > ability.rangeCells`. The only LoS primitive is engine-side, impure, and module-singleton-backed (`math/bresenham.ts:157` `checkLineOfSight` over `setBresenhamTerrain`).
  4. There is **no preview/forecast API**. Architecture §16's `COMBAT_PREVIEW_REQUESTED`/`COMBAT_PREVIEW_READY` do not exist; the kernel exposes no `getLegalActions`/`forecast`.
  5. Movement allowance is global: `DEFAULT_MOVEMENT_PER_TURN = 6` (`combat_turn_coordinator.ts:41`), whose own comment says "Per-combatant speed arrives with the tactical preview slice (Combat-03)."
  6. World-pixel → cell conversion is duplicated with no canonical helper (`turn_manager_system.ts:1774,1798`; `goap_combat_tactics_system.ts:38,112–115`; `ecs_worker.ts:546–547`), despite `grid_position_sync_system.ts:69–70` being the de-facto ECS derivation.
  7. There is **no production ability catalog**. `snapshotCombatState` requires `abilityCatalog` (`combat_state_adapter.ts:244`) and the only provider is a test fixture (`packages/shared/utils/src/lib/rules/__tests__/combat_fixtures.ts:27` `ABILITY_CATALOG`), so a production `CombatState` cannot currently be built with usable abilities.
  8. The bridge plumbing files are **at their file-size ratchet with zero headroom**: `packages/frontend/engine/src/types.ts` (931), `game_world.ts` (2265) and `worker/ecs_worker.ts` (2362) are recorded at exactly their current size in `scripts/src/lib/ops/guard_source_file_size_baseline.json`. C-514 only landed its `COMBAT_END_TURN` plumbing because it first *extracted* `CombatEndTurnCommand` into `combat_bridge_types.ts` and `dispatchCombatCommand` into `combat_command_dispatch.ts`, shrinking all three (commit `b4b76d927`).

- **Reproduction**:
  1. `rg "BattlefieldState" packages/frontend/engine/src --glob '!*.test.ts'` → no builder.
  2. `rg "reachable|getLegalActions|hasLineOfSight|forecast" packages/shared packages/frontend/engine --glob '!*.test.ts'` → zero combat hits.
  3. Call `validateCombatCommand` on a ranged `useAbility` across a wall: it succeeds because LoS is never checked.
  4. `rg "ABILITY_CATALOG" --glob '!*.test.ts' packages apps` → no production ability catalog; only the C-509 test fixture.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | Terrain cost + `blocksSight` grid, occupancy cell checks | `systems/collision_system.ts` (`getPathfindingGrid` L165, `getTerrainGrid` L154, `isWalkable` L300, `isCellBlocked` L521, `isBlocksSight` L213), `systems/terrain_grid.ts` |
  | A* pathfinding (weighted, 8-dir, no per-call alloc) | `math/astar.ts` (`findPath` L180, `AstarGrid` L32) |
  | Pure Bresenham LoS algorithm | `math/bresenham.ts` (`checkLineOfSight` L157) |
  | C-509 `CombatState`/`BattlefieldState`/`CombatCommand`/`CombatInvalidReason` | `packages/shared/schemas/src/lib/game/combat/` |
  | C-514 turn coordinator/budget + driver | `combat_turn_coordinator.ts`, `combat_turn_driver.ts` |
  | Canonical pixel→cell derivation | `systems/grid_position_sync_system.ts:69–70` |
  | Correlated request/response over the worker | `worker/worker_protocol.ts`, `game_world/worker_session.ts` (`request` L224), `game_world.ts` `snapshotWorld` L1787–1794 |
  | Bridge command/event + worker dispatch | `combat/combat_bridge_commands.ts`, `combat/combat_command_dispatch.ts`, `worker/ecs_worker.ts` |

- **Known gaps**: battlefield projection; reachable endpoints; LoS oracle + enforcement; range/LoS-aware legal targets; forecast/preview bridge; per-combatant movement allowance; a single quantization helper; an ability-catalog source for the production preview path; and bridge plumbing that fits inside the file-size ratchet.

- **Baseline tests** (capture green before starting):
  - `packages/frontend/engine/src/math/astar.test.ts`, `systems/actor_footprint.test.ts`, `__tests__/bresenham.test.ts`, `__tests__/spatial_vision.test.ts`, `__tests__/spatial_grid.test.ts`.
  - `packages/shared/utils/src/lib/rules/__tests__/combat_kernel.test.ts`, `combat_turn_coordinator.test.ts`.
  - `packages/frontend/engine/src/__tests__/combat_state_adapter.test.ts`, `combat_turn_flow.test.ts`.
  - Moon: `utils:test`, `frontend-engine:test`, `schemas:test`.

## User Outcome

After this contract, the engine can, for the active combatant, compute the legal movement endpoints within its movement budget, the legal targets for each ability (range + line of sight), and a non-mutating forecast of a proposed action. A UI (Combat-04) can request a preview for the current state revision and receive the path, cost, hit chance, damage range, and affected cells without committing to the action.

## Success Measures

- **Time/latency target**: legal-endpoint query and forecast for an ordinary action under 8 ms on supported hardware; suitable for a single rendered frame at typical tactical-map sizes.
- **Offline/degraded behavior**: all queries are pure/local over the projected battlefield; no AI/network call is involved. An absent provider cannot affect a preview.
- **Production journey enabled**: engine-side preview API is available to the Combat-04 direct-control UI; no player-facing UI is added here.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Terrain/occupancy/sight grid | `systems/collision_system.ts`, `systems/terrain_grid.ts` | reuse — read-only projection |
| A* pathfinding | `math/astar.ts` | reuse — path recomputation for a chosen endpoint |
| Bresenham LoS | `math/bresenham.ts` | reuse algorithm; add a pure battlefield-parameterized oracle |
| FOV cone engines | `math/vision/dda_raycaster.ts`, `math/vision/shadowcasting.ts` | not reused — these fill an NPC *vision cone* into a pre-allocated `Uint8Array` visibility map (C-190 perception); Combat-03 needs point-to-point cell LoS, which Bresenham already provides |
| C-509 schemas/state/kernel | `packages/shared/.../combat/` | modify — extend `BattlefieldState` + `CombatInvalidReason`; the kernel itself gains LoS enforcement only (the query API is new code in `combat_tactical.ts`) |
| C-514 coordinator budget | `combat_turn_coordinator.ts` | modify — per-combatant movement allowance |
| Worker request/response | `worker_protocol.ts`, `worker_session.ts` | not used for the preview — Q3 resolves to the correlated `GameCommand`/`GameEvent` form (the promise transport needs the same `ecs_worker.ts` lines plus per-request pending state) |
| Bridge command/event | `combat_bridge_commands.ts` etc. | modify — add preview pair |

## Overview

Combat-03 gives the rules layer eyes. It adds two pure shared modules — `combat_spatial.ts` (leaf primitives: quantization, LoS, reachability) and `combat_tactical.ts` (legal queries + forecast) — that, over a `BattlefieldState` projected from the live ECS world, compute reachable movement endpoints within the active combatant's budget, legal ability targets by range and line of sight, and a deterministic `ActionForecast` for a proposed command. It extends the C-509 schemas with optional flat battlefield cost/sight arrays and a LoS invalid reason, enforces `requiresLineOfSight` in the kernel, adds a canonical quantization helper, and exposes a correlated `COMBAT_PREVIEW_REQUESTED` → `COMBAT_PREVIEW_READY`/`COMBAT_PLAN_REJECTED` bridge pair. No UI is added; the Combat-04 direct-control slice consumes this API. Cover, threat zones, reactions, and surfaces/hazards remain out of scope.

## Design Reference

- **Governing architecture**: `docs/architecture/combat_2.md` §8.5 (`ActionForecast`), §10 (tactical projection + quantization), §15 (kernel API — `getLegalActions`/`forecast`), §16 (preview messages), §22/§22.2.
- **Pure-core pattern**: `combat_kernel.ts`/`combat_turn_coordinator.ts` — pure, no engine/client/ECS/network imports; input never mutated. The new module graph must stay acyclic: `combat_spatial.ts` is a leaf (no rules-layer imports), `combat_kernel.ts` imports the leaf, `combat_tactical.ts` imports both.
- **Projection pattern**: `combat_state_adapter.ts` — the adapter reads ECS raw arrays and returns serializable data.
- **LoS algorithm**: reuse `math/bresenham.ts`'s integer Bresenham; parameterize by a pure cell-array so it can live in the rules layer without ECS singletons.
- **Bridge pattern**: mirror `COMBAT_ACTION`/`COMBAT_END_TURN` for the command, and `TURN_CHANGED` for the correlated result event.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Pure spatial module (leaf)**: `packages/shared/utils/src/lib/rules/combat_spatial.ts` — `worldPixelToCell`, `cellToWorldPixel`, `hasLineOfSight`, `computeReachableEndpoints`. No rules-layer, I/O, ECS, engine/client or AI imports.
- **Pure tactical module**: `packages/shared/utils/src/lib/rules/combat_tactical.ts` — `getLegalActions`, `forecastCombatAction`. Imports `combat_spatial.ts` and `validateCombatCommand` from `combat_kernel.ts` (one-way). `combat_kernel.ts` must **not** import `combat_tactical.ts` — that would close an import cycle; the kernel's only new dependency is the leaf module.
- **Schema extensions** (shared, additive/optional to keep C-509 green): `BattlefieldState.movementCost?: number[]` and `BattlefieldState.blocksSight?: boolean[]` (flat `y*width+x`; `0` cost = impassable); add `targetNotVisible` to `CombatInvalidReasonSchema`; add `ActionForecastSchema`, `CombatPreviewRequestSchema`, `CombatPreviewResultSchema`.
- **Kernel** (`combat_kernel.ts`, 725 lines — no headroom below the 800-line hard limit): enforce `requiresLineOfSight` in `validateUseAbility` via `hasLineOfSight` from the leaf module; keep `validateMove`/replay behavior intact when `movementCost`/`blocksSight` are absent. The query API (`getLegalActions`/`forecastCombatAction`) stays in `combat_tactical.ts` — do **not** add it to the kernel, both to keep the module graph acyclic and to stay under the limit.
- **ECS projection**: `packages/frontend/engine/src/combat/combat_battlefield.ts` — `snapshotBattlefield(world, options): BattlefieldState` reading `getPathfindingGrid`/`getTerrainGrid`/`isBlocksSight` + occupancy; pure read, deterministic; uses the canonical quantization helper.
- **Movement allowance**: per-combatant movement source — a new `CombatMovement` SoA component (default 6), read by the C-514 driver; `DEFAULT_MOVEMENT_PER_TURN` remains the fallback. The coordinator's `defaultTurnBudget(movementPerTurn)` is already parameterized. The component is **not** added to `PERSISTENT_COMPONENTS` (see Q2).
- **Bridge**: `COMBAT_PREVIEW_REQUESTED` (`GameCommand`, carries `requestId` + query + `basedOnRevision`) → `COMBAT_PREVIEW_READY` (`GameEvent`, carries `requestId` + forecast/legal sets) or `COMBAT_PLAN_REJECTED` (`GameEvent`, carries `requestId` + `reasonCode`). Declare the payload types in `combat/combat_bridge_types.ts` (composed into the `GameCommand`/`GameEvent` unions by reference, exactly as `CombatEndTurnCommand` is), register in `combat/combat_bridge_commands.ts`, dispatch in `combat/combat_command_dispatch.ts`, and put the worker-side handler in `combat/combat_preview_handler.ts`.
- 🔴 **File-size ratchet — bridge plumbing must not grow.** `packages/frontend/engine/src/types.ts` (931), `game_world.ts` (2265) and `worker/ecs_worker.ts` (2362) sit **exactly** on their grandfathered `guard_source_file_size` baseline, so a single added line fails `bun moon run scripts:guard-source-file-size`. Follow the C-514 precedent: extract the lines you need out of those three files first (C-514 moved `CombatEndTurnCommand` into `combat_bridge_types.ts` and `dispatchCombatCommand` into `combat_command_dispatch.ts`, shrinking all three), keep the net delta ≤ 0, and lock any reduction in with `bun run scripts/src/lib/ops/guard_source_file_size.ts --update-baseline`. Never raise a baseline allowance.
- **Ability catalog for the preview path**: the worker holds no `CombatState` and no production ability catalog (the only one is the C-509 test fixture). Extend the encounter-start path the same way C-514 injects `CombatTurnHooks`: `StartCombatTurnsOptions.abilityCatalog?: Record<string, CombatAbilityDefinition>` (default `{}`), stored per world in `DriverState` and read by the preview handler. A missing catalog is a typed rejection (`abilityUnknown`) and an empty legal-target set — never a crash.
- **No UI, no LLM, no reactions, no cover.** Legacy combat resolution is untouched.

## State & Data Models

Conceptual; final TypeBox in `packages/shared/schemas/src/lib/game/combat/`, with `Static<>` types in `packages/shared/types/src/lib/game/combat/`. All additions are optional/additive so existing C-509 fixtures remain valid.

```ts
// ── BattlefieldState extension (flat arrays are row-major y*width+x) ──

type BattlefieldState = {
  width: number;
  height: number;
  blockedCells: GridPoint[];     // C-509 field; retained for compatibility
  /** Optional tactical cost grid. 0 = impassable, else traversal cost. */
  movementCost?: number[];
  /** Optional sight-blocking grid; absent means "no occlusion data". */
  blocksSight?: boolean[];
};
```

Impassability is the **union** of three rules, identical in the projection and in every query: `movementCost[y * width + x] === 0`; the cell appears in `blockedCells`; or the cell is out of bounds. When `movementCost` is absent, every in-bounds non-`blockedCells` cell costs 1. Occupancy blocks endpoints but never LoS (LoS reads `blocksSight` only).

```ts
// ── Tactical query + preview ──

type LegalMoveQuery = { kind: 'legalMoves'; combatantId: string };
type LegalTargetQuery = { kind: 'legalTargets'; combatantId: string; abilityId: string };
type ActionQuery = { kind: 'action'; combatantId: string; command: CombatCommand };

type CombatPreviewRequest = {
  requestId: string;             // client-minted correlation id
  encounterId: string;
  basedOnRevision: number;       // C-509 stateRevision the query is bound to
  query: LegalMoveQuery | LegalTargetQuery | ActionQuery;
};

type CombatPreviewWarning =
  | 'triggersReaction'           // reserved — Combat-08
  | 'affectsAlly'
  | 'consumesResource'
  | 'endsTurn';
// Discriminator and warning literals are camelCase to match the C-509 wire
// vocabulary (`useAbility`, `endTurn`, `targetNotVisible`).

type ActionForecast = {
  path?: GridPoint[];
  movementCost?: number;
  actionCost: 'movement' | 'action' | 'quick' | 'reaction' | 'free';
  hitChance?: number;            // 0..1, advisory
  damageRange?: { minimum: number; maximum: number };
  affectedCells?: GridPoint[];
  affectedEntityIds?: string[];
  reactionRisks: [];             // reserved — Combat-08
  objectiveEffects: [];          // reserved — Combat-08
  warnings: CombatPreviewWarning[];
};

// `reactionRisks`/`objectiveEffects` are `Type.Array(Type.Never())` (validates
// only `[]`, `Type.Never` exists in the pinned typebox 1.3.30) so Combat-08 can
// widen the element type without changing the object shape.

type CombatPreviewResult =
  | {
      requestId: string;
      valid: true;
      forecast: ActionForecast;
      legalEndpoints?: GridPoint[];
      legalTargetIds?: string[];
      movementCostTo?: Record<string, number>; // reserved for the UI grid
    }
  | {
      requestId: string;
      valid: false;
      reasonCode: CombatInvalidReason;
      messageKey: string;
    };
```

```ts
// ── Pure spatial API (shared) — combat_spatial.ts (leaf, no rules imports) ──

// worldPixelToCell({ px, py, tileSize }): GridPoint
// cellToWorldPixel({ cell, tileSize }): { x: number; y: number }   // tile centre
// hasLineOfSight({ battlefield, from, to }): boolean
// computeReachableEndpoints({ battlefield, origin, movementBudget, occupied }): { endpoints: GridPoint[]; costTo: Record<string, number> }

// ── Pure query API (shared) — combat_tactical.ts (imports the leaf + the kernel) ──

// getLegalActions({ state, combatantId }): { endpoints: GridPoint[]; targetsByAbility: Record<string, string[]>; budget: TurnBudget }
// forecastCombatAction({ state, command }): { valid: true; forecast: ActionForecast } | { valid: false; reasonCode; messageKey }
//
// Every function takes a single options object (aikami-conventions: two or more
// arguments become an options object — the existing positional `checkLineOfSight`
// in `math/bresenham.ts` is pre-existing debt, not a pattern to copy).
// `costTo` keys are `"x,y"` and are inserted in the same deterministic order as
// `endpoints`, so a serialized result is byte-identical across runs.
```

Mechanical conventions (must be explicit and stable, per §10):
- **Cells**: integer `GridPoint`; flat index `y * width + x`; tile centre `cell * tileSize + tileSize/2`.
- **Adjacency**: **4-directional** mechanical movement (matches `validateMove`'s `manhattan(prev, next) === 1` contiguity). Presentation may interpolate smoothly.
- **Reachability**: Dijkstra over `movementCost` (or uniform cost 1 per step when the array is absent, using `blockedCells`); impassable cells (see above) and occupied cells are not traversable or reachable — the origin cell itself is the one exception (a unit always stands somewhere), and the origin is never reported as an endpoint.
- **Tie-breaking**: endpoint and target lists are sorted deterministically (`y`, then `x`; targets by `combatantId`).
- **LoS**: integer Bresenham over `blocksSight`; origin and target cells are skipped; absent `blocksSight` ⇒ unobstructed.

## Quality Requirements

- **Offline/degraded mode**: 100% local pure computation; no AI/network; no provider dependency.
- **Accessibility/input**: N/A — no UI in this contract (Combat-04 consumes the API).
- **Performance budget**: endpoint + forecast query < 8 ms for an ordinary action at typical tactical-map sizes; queries allocate only their result; no query inside a per-frame loop beyond a single call. The budget covers the **pure query only**: the battlefield projection is outside it and is the expensive half (`snapshotCombatState` deep-clones `battlefield` through `cloneValue`/`structuredClone` on every call, `combat_kernel.ts:268`). If the measured projection + query path exceeds one frame, add a revision-keyed projection cache — do not quietly redefine the budget.
- **Security/privacy**: `COMBAT_PREVIEW_REQUESTED` carries no free text; the engine validates `requestId`, active combatant, and `basedOnRevision`; a stale or non-active preview is rejected with a typed reason and never mutates state.
- **Persistence/migration**: N/A — no persisted state. `BattlefieldState` additions are optional and backward compatible.
- **Cancellation/retry/idempotency**: previews are pure and idempotent for the same state revision; a late/duplicate `requestId` result is ignored by the consumer; preview never commits.
- **Observability**: structural extension only; no new logging required. Rejections return a stable `reasonCode`/`messageKey`.

## Migration & Rollback

- **Old data compatibility**: N/A — no persisted combat state exists yet; new `BattlefieldState` fields are optional. `COMBAT_SCHEMA_VERSION` stays `2`: the additions are optional, every pre-existing C-509 fixture still validates, and no persisted or cross-version `CombatState` reader exists (C-509 records `PERSISTENT_COMPONENTS` and `CURRENT_SNAPSHOT_VERSION` as unchanged). Bump it only when a *required* field is added.
- **Migration**: N/A.
- **Rollback**: remove the two new pure modules, the schema fields, and the preview bridge pair; C-509/514 behavior is unchanged (kernels treat absent fields as before).
- **Feature flag or kill switch**: none — the API is inert until a consumer (Combat-04) calls it.
- **Failure recovery**: a malformed/oversized battlefield projection is rejected at schema validation (`Value.Check`) rather than throwing; the engine returns a typed rejection.

## Scope Boundaries

- **In Scope:**
  - `BattlefieldState` projection from the live ECS `TerrainGrid`/pathfinding grid + occupancy (`snapshotBattlefield`).
  - Pure reachable-endpoint computation within the movement budget.
  - Pure LoS oracle + enforcement of `requiresLineOfSight` for abilities.
  - Legal-target computation by range + LoS.
  - `ActionForecast` + `COMBAT_PREVIEW_REQUESTED`/`COMBAT_PREVIEW_READY`/`COMBAT_PLAN_REJECTED` correlated bridge pair.
  - Per-combatant movement allowance source.
  - A single canonical pixel↔cell quantization helper used by the projection.
  - An injected ability-catalog source for the encounter-start/preview path (default `{}`).
  - Bridge plumbing that fits the file-size ratchet (payload types in `combat_bridge_types.ts`, registration in `combat_bridge_commands.ts`, dispatch in `combat_command_dispatch.ts`, handler in `combat_preview_handler.ts`; net ≤ 0 lines on `types.ts`/`game_world.ts`/`ecs_worker.ts`).
  - Unit + engine integration tests.

- **Out of Scope:**
  - Any UI, overlay, ViewModel, or click-to-move direct-control surface (Combat-04).
  - Cover, threat zones/opportunity attacks, surfaces/hazards, objectives, morale (Combat-08/07).
  - Reactions and reaction windows (Combat-08).
  - Natural-language intent compilation and LLM decisions (Combat-05/06).
  - Replacing the legacy combat resolver or wiring v2 into production; the `combatEngine` flag stays in Combat-04.
  - Changing C-509 replay/determinism semantics or removing the legacy distance estimate in `turn_manager_system.ts` (cleanup can follow once v2 is live).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — the rules/engine layer can answer spatial legality and forecasts. The projection, query module, schema extensions, and bridge pair are inseparable for that outcome. 8 ACs, 4 projects (`schemas`, `types`, `utils`, `frontend-engine`), no UI. **Size: ok — proceed as one contract.**

## Acceptance Criteria

### AC-1: Battlefield projects from the live ECS world
**Given** a loaded map with a `TerrainGrid`, occupancy, and combat participants
**When** `snapshotBattlefield(world, options)` runs
**Then** it returns a schema-valid `BattlefieldState` with `width`/`height`, a flat `movementCost` (0 for solid/impassable), and a flat `blocksSight` grid consistent with `isBlocksSight`; out-of-bounds cells are impassable; the projection reads ECS without mutating it; and two calls on the same state produce identical output. The projection uses `worldPixelToCell` from `combat_spatial.ts` — it introduces no tile-size literal of its own.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `packages/frontend/engine/src/__tests__/combat_battlefield.test.ts` | `packages/frontend/engine/src/combat/combat_battlefield.ts#snapshotBattlefield` + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- **Integration**: install a terrain grid, project, assert cost/sight against `isWalkable`/`isBlocksSight`; occupancy cells blocked; assert the projected `blocksSight` is **terrain-derived only** (occupants never make a cell opaque, per the LoS/occupancy split).
- E2E / Visual: N/A.

**Watch Points**:
- Use `getTerrainTileSize()` — never hardcode 32.
- Flat arrays are `y*width+x`; assert a non-square map to catch transposition.

### AC-2: Reachable endpoints respect the movement budget and terrain cost
**Given** a projected battlefield, an origin, and a movement budget
**When** `computeReachableEndpoints` (and `getLegalActions` `legalMoves`) runs
**Then** the returned endpoints are exactly the 4-connected cells reachable at cost ≤ budget over the cost grid (impassable/occupied excluded); `costTo` matches the shortest-path cost; blocked cells and out-of-budget cells are absent; the result is deterministically ordered; and the input state is not mutated.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/shared/utils/src/lib/rules/__tests__/combat_tactical.test.ts` | `packages/shared/utils/src/lib/rules/combat_spatial.ts#computeReachableEndpoints` + tooling: `bun moon run utils:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`
- Integration: open room, wall, weighted/mud cell, and zero-budget cases; compare against a hand-computed set.
- E2E / Visual: N/A.

**Watch Points**:
- 4-directional only — matches `validateMove`; do not silently switch to diagonals.
- A wall that fully encloses the origin yields only cells on the origin side.

### AC-3: Legal targets use range and line of sight
**Given** the active combatant and an ability with `rangeCells`/`requiresLineOfSight`
**When** `getLegalActions` computes `legalTargets` and the kernel validates the `useAbility` command
**Then** the legal set matches exactly what `validateUseAbility` accepts, with a one-to-one reason mapping: a target beyond `rangeCells` → `targetOutOfRange` (the existing C-509 code, already returned at `combat_kernel.ts:365`), a defeated target → `targetDefeated`, the actor itself or an unknown target → `targetInvalid`, and a target with no LoS when the ability sets `requiresLineOfSight` → the new `targetNotVisible`. LoS is enforced for **any** ability whose catalog entry sets `requiresLineOfSight: true` and that names at least one target — not only for `kind: 'ranged_attack'`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `combat_tactical.test.ts` + `combat_kernel.test.ts` (extended) | `combat_tactical.ts#getLegalActions`, `combat_kernel.ts#validateUseAbility` + tooling: `bun moon run utils:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`
- Integration: wall between two cells at range; assert occlusion; ranged vs melee.
- E2E / Visual: N/A.

**Watch Points**:
- Add `targetNotVisible` to `CombatInvalidReasonSchema`; do not overload `targetInvalid`.
- Absent `blocksSight` must preserve C-509 behavior (unoccluded).

### AC-4: Forecast is deterministic and non-mutating
**Given** a valid proposed command for the active combatant
**When** `forecastCombatAction` runs
**Then** it returns an `ActionForecast` (path + movement cost for a move; `hitChance`/`damageRange`/`affectedCells` for an attack) computed without advancing the RNG, emitting events, or changing any state field; the same input yields byte-identical output; an invalid command returns a typed rejection.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `combat_tactical.test.ts` | `packages/shared/utils/src/lib/rules/combat_tactical.ts#forecastCombatAction` + tooling: `bun moon run utils:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`
- Integration: deep-freeze the input state; assert unchanged after forecast.
- E2E / Visual: N/A.

**Watch Points**:
- `hitChance`/`damageRange` are advisory projections, not dice results; no RNG advance.
- `reactionRisks`/`objectiveEffects` stay empty arrays for shape stability.

### AC-5: Preview bridge round trip is correlated and stale-safe
**Given** the engine's combat preview entry point (`combat/combat_preview_handler.ts#handleCombatPreviewRequest`, reached from `dispatchCombatCommand`) and a player-initiated `COMBAT_PREVIEW_REQUESTED`
**When** the worker handles it
**Then** it emits exactly one `COMBAT_PREVIEW_READY` (or `COMBAT_PLAN_REJECTED`) carrying the matching `requestId`; a request whose `basedOnRevision` differs from the revision of the `CombatState` the handler just built, or whose combatant is not the active one, is rejected with a typed reason (`staleRevision` / `notActiveCombatant`) and mutates nothing; and duplicate/late results are ignorable by `requestId`. Until Combat-04 commits resolutions through `resolveCombatCommand`, a freshly built `CombatState` always carries `stateRevision: 0` (`combat_kernel.ts:260`), so the stale case is exercised by sending a **non-matching** `basedOnRevision` — not by waiting for a revision to advance.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `packages/frontend/engine/src/__tests__/combat_preview_bridge.test.ts` | `packages/frontend/engine/src/combat/combat_preview_handler.ts#handleCombatPreviewRequest` + `COMBAT_PREVIEW_REQUESTED` → `COMBAT_PREVIEW_READY` bridge + tooling: `bun moon run frontend-engine:test`, `bun moon run scripts:guard-source-file-size` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: drive the handler with a real bitECS world + `MockEngineBridge` (the `combat_turn_flow.test.ts` harness pattern) — never spin up a real Worker; send a request, assert one correlated reply; send a non-matching `basedOnRevision` and a non-active combatant, assert typed rejections; assert no `TURN_CHANGED`/state mutation.
- E2E / Visual: N/A (UI in Combat-04).

**Watch Points**:
- Mint `requestId` per request; never reuse across revisions.
- Do not emit a preview result into the combat log or turn stream.

### AC-6: Movement allowance is per-combatant with an explicit default
**Given** combatants with differing movement allowances (and some without)
**When** a turn begins
**Then** each combatant's `TurnBudget.movementRemaining` is its allowance, defaulting to `DEFAULT_MOVEMENT_PER_TURN = 6`; `computeReachableEndpoints` uses the remaining budget; `spendBudget('movement', n)` rejects `n` over the remainder with `movementBudgetExceeded`; no global constant overrides a per-combatant value.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit + Integration | `combat_turn_coordinator.test.ts` (extended) + `combat_turn_flow.test.ts` (extended) | `combat_turn_coordinator.ts#defaultTurnBudget`, `combat_turn_driver.ts#startCombatTurns` + tooling: `bun moon run utils:test`, `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`, `bun moon run frontend-engine:test`
- Integration: two combatants with different speeds; assert budgets and reachable sets differ.
- E2E / Visual: N/A.

**Watch Points**:
- The per-combatant source must be a stable, serializable value (not derived from animation/timing).
- If it is a new SoA component, do **not** add it to `PERSISTENT_COMPONENTS` in this contract (C-509 deliberately kept `CombatIdentity` out, leaving `CURRENT_SNAPSHOT_VERSION` and legacy saves untouched). Consequence, documented rather than hidden: after a save/load restore a combatant falls back to the default 6 until Combat-04 wires encounter-start data into the restore path.
- Missing source ⇒ default 6; C-514 tests must stay green.

### AC-7: Production engine path answers previews on the active turn
**Given** the production `/game` combat engine with an active player turn
**When** the engine receives a legal-moves, legal-targets, or action preview request for the active combatant
**Then** it builds the live battlefield with `snapshotBattlefield(world, …)` and the `CombatState` with `snapshotCombatState(world, { encounterId, rulesVersion: COMBAT_RULES_VERSION, seed: <encounter seed, default 0, never advanced>, abilityCatalog: <injected, default {}>, playerCombatantId, battlefield })`, answers via the pure tactical module, returns a schema-valid result, and leaves the encounter state revision and turn unchanged; the same entry point rejects a request for a non-active or unknown combatant, and an action preview for an ability absent from the catalog is rejected with `abilityUnknown` rather than throwing.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Integration | `packages/frontend/engine/src/__tests__/combat_preview_bridge.test.ts` | `packages/frontend/engine/src/combat/combat_battlefield.ts#snapshotBattlefield` + `packages/frontend/engine/src/combat/combat_preview_handler.ts#handleCombatPreviewRequest` + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: a real bitECS world + `MockEngineBridge` (the `combat_turn_flow.test.ts` harness) — `startCombatTurns` with an injected catalog, then request each query kind through the production handler and assert the emitted event; assert an invalid-combatant rejection and an empty-catalog `abilityUnknown` rejection.
- E2E / Visual: N/A — no player-facing surface; Combat-04 owns the browser journey.

**Watch Points**:
- The preview path must not import or execute the legacy resolver or emit `COMBAT_LOG`.
- Keep `snapshotCombatState`/`snapshotBattlefield` read-only; no ECS writes during preview.

### AC-8: Quantization is canonical and round-trips

**Given** a tile size from `getTerrainTileSize()` and world pixel positions
**When** `worldPixelToCell`/`cellToWorldPixel` run
**Then** a pixel maps to the cell that contains it by floor division, `cellToWorldPixel` returns the tile **centre** (`cell * tileSize + tileSize / 2`), `worldPixelToCell(cellToWorldPixel(cell))` round-trips for every in-bounds cell, negative pixels floor toward the correct cell (no truncation toward zero), and the projection plus every C-515 consumer uses this helper instead of a `32` literal.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Unit | `packages/shared/utils/src/lib/rules/__tests__/combat_tactical.test.ts` | `packages/shared/utils/src/lib/rules/combat_spatial.ts#worldPixelToCell`/`cellToWorldPixel` + tooling: `bun moon run utils:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`
- Integration: tile sizes 16/32/48; a non-square map; the boundary pixel of a cell; a negative pixel (`-1` → cell `-1`, never `0`); a source scan asserting the projection module contains no hardcoded tile-size literal.
- E2E / Visual: N/A.

**Watch Points**:
- `Math.floor`, never `Math.trunc` — the two differ for negative coordinates.
- Tile centres, not corners: the projection and any future click-to-move consumer must agree on the same convention.

## Implementation Sequence

1. **Phase 1 (Schemas + types)**: extend `BattlefieldState`, add `targetNotVisible`, `ActionForecastSchema`, `CombatPreviewRequestSchema`, `CombatPreviewResultSchema`; barrel-export; ensure C-509 schema tests stay green.
2. **Phase 2 (Pure modules)**: `combat_spatial.ts` — quantization, LoS, reachability; `combat_tactical.ts` — `getLegalActions`, `forecastCombatAction`; extend the kernel to enforce LoS via the leaf module (keep `combat_kernel.ts` under 800 lines); add `combat_tactical.test.ts`.
3. **Phase 3 (Engine projection + bridge)**: `combat_battlefield.ts` `snapshotBattlefield`; per-combatant movement source + injected ability catalog; `combat_preview_handler.ts`; `COMBAT_PREVIEW_REQUESTED`/`COMBAT_PREVIEW_READY`/`COMBAT_PLAN_REJECTED` declared in `combat_bridge_types.ts`, registered in `combat_bridge_commands.ts`, dispatched in `combat_command_dispatch.ts`; extract enough lines out of `types.ts`/`ecs_worker.ts` to keep the net delta ≤ 0; add engine tests.
4. **Phase 4 (Validation)**: `bun run fix`, `utils:test`, `schemas:test`, `frontend-engine:test`, `client:test`, `bun moon run scripts:guard-source-file-size`, and `bun moon run :validate`; update the Execution Report.

## Edge Cases & Gotchas

- **Quantization**: `Math.floor(px / tileSize)` with `tileSize` from `getTerrainTileSize()`; tile centres at `cell*tileSize + tileSize/2`. A canonical helper avoids the existing duplicated literals.
- **Non-square maps / transposition**: flat arrays are `y*width+x`; a square-only test hides row/column bugs.
- **Occupancy during preview**: the projected battlefield should mark occupied cells (including the actor) as blocked for endpoint purposes, while LoS uses sight only.
- **Origin cell edges**: `hasLineOfSight` skips origin and target cells, matching `bresenham.ts`; otherwise a unit standing in a doorway can never see out.
- **No occlusion data**: absent `blocksSight` means "unobstructed" so C-509 fixtures stay valid.
- **Cost units**: `movementCost` is in cells (1 per step for flat ground); do not mix pixel distance with grid cost.
- **Preview staleness**: a result whose `basedOnRevision` no longer equals the live revision is discarded by the consumer, not applied.
- **Determinism**: sort endpoint/target outputs; never iterate a `Set`/`Map` whose insertion order depends on runtime. `costTo`/`movementCostTo` keys are `"x,y"` and are inserted in the sorted endpoint order so the serialized result is byte-identical across runs.
- **Empty ability catalog**: `legalTargets` returns an empty list, and an action preview for an ability missing from the catalog is rejected with `abilityUnknown` — never a throw, never an untyped `undefined`.
- **Projection cost**: the 8 ms budget covers the pure query, not `snapshotBattlefield`/`snapshotCombatState` (which `structuredClone` the battlefield on every call). Measure the combined path and cache the projection keyed by a terrain/occupancy revision if it exceeds a frame.
- **Bridge plumbing budget**: `types.ts`, `game_world.ts` and `ecs_worker.ts` are on the file-size ratchet at exactly their baseline size; a C-515 bridge that adds lines to them without extracting at least as many fails `moon run scripts:guard-source-file-size`.

## Open Questions

Resolved during critique against codebase evidence — no blocking question remains:

- **Q1 — Movement adjacency → 4-directional.** `validateMove` already enforces `manhattan(prev, next) === 1` (`combat_kernel.ts:310,314`), so the 4-connected set is the only one that matches what the kernel will accept; presentation may still interpolate smoothly. No C-509 amendment is needed — its contiguity rule already *is* 4-directional.
- **Q2 — Per-combatant movement source → a new `CombatMovement` SoA component (default 6), read by the driver.** `CombatStats` has no movement field (`components/combat_stats.ts`) and is on the persisted ECS wire format (`PERSISTENT_COMPONENTS`, `serialization/ecs_serializer.ts:38`), so extending it would change the snapshot format C-509 deliberately left untouched. The new component is **not** added to `PERSISTENT_COMPONENTS` in this contract; per-combatant speed therefore falls back to the default after a save/load restore until Combat-04 wires encounter-start data into the restore path (documented, not hidden).
- **Q3 — Preview transport → correlated `GameCommand`/`GameEvent` with a client-minted `requestId`.** It mirrors `COMBAT_ACTION`/`TURN_CHANGED` and rides the `STATE_UPDATE.events` channel the combat ViewModel already consumes; unlike the `worker_session.request()` promise used by `REQUEST_SNAPSHOT` it needs no per-request pending-map state (and would need the same `ecs_worker.ts` lines). Combat-04 consumes the event form.

Remaining risk (not blocking): the injected ability catalog has no production content yet — the only catalog in the repo is the C-509 test fixture — so Combat-04 must author or derive it. This contract only provides the injection seam and the typed rejection when it is empty.

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

Combat-03 is implemented across `schemas`, `types`, `utils` and `frontend-engine`. Two new pure shared modules — `combat_spatial.ts` (quantization, Bresenham LoS, Dijkstra reachability) and `combat_tactical.ts` (`getLegalActions`, `forecastCombatAction`) — sit over an extended `BattlefieldState` (optional flat `movementCost`/`blocksSight`), the kernel now enforces `requiresLineOfSight` for any ability that declares it, and a correlated `COMBAT_PREVIEW_REQUESTED` → `COMBAT_PREVIEW_READY`/`COMBAT_PLAN_REJECTED` bridge pair answers previews on the live `/game` combat path. Per-combatant movement arrives as a new `CombatMovement` SoA component (default 6, deliberately not persisted). No UI is added; the Combat-04 direct-control slice consumes this API. Deferred as designed: cover, threat zones, reactions, objectives, morale, and the production ability catalog (the injection seam exists, its content is Combat-04's).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `snapshotBattlefield` projects `TerrainGrid` cost/sight + combatant occupancy; read-only, deterministic, non-square-map covered; uses `worldPixelToCell`/`getTerrainTileSize` (source scan asserts no `32` literal). |
| AC-2 | ✅ | `computeReachableEndpoints` — 4-connected Dijkstra over the cost grid, budget-bounded, occupied/impassable excluded, origin never an endpoint, `costTo` keys inserted in sorted endpoint order; `getLegalActions.endpoints` matches. |
| AC-3 | ✅ | `validateUseAbility` enforces LoS via `hasLineOfSight` for ANY ability with `requiresLineOfSight` and ≥1 target; reason mapping `targetOutOfRange` → `targetDefeated` → `targetInvalid` → new `targetNotVisible` verified; absent `blocksSight` keeps C-509 behaviour. |
| AC-4 | ✅ | `forecastCombatAction` is pure: deep-frozen input unchanged, RNG byte-identical, byte-identical repeat output, `reactionRisks`/`objectiveEffects` stay `[]`, typed rejection on invalid commands. |
| AC-5 | ✅ | Production handler + `MockEngineBridge` round trip: exactly one correlated reply, `staleRevision`/`notActiveCombatant`/`encounterEnded` rejections, idempotent duplicate `requestId`, no `TURN_CHANGED` or log noise; the main-thread forwarding registration is covered too. |
| AC-6 | ✅ | `CombatMovement` per-combatant allowance read by the driver (`hasComponent`-guarded), `DEFAULT_MOVEMENT_PER_TURN` fallback, `movementPerTurnFor` resolver on `createTurnState`/`beginTurn`/`endTurn`, over-spend rejected, reachable sets differ by speed. |
| AC-7 | ✅ | `handleCombatPreviewRequest` builds `snapshotBattlefield` + `snapshotCombatState(…, abilityCatalog, seed)` and answers all three query kinds schema-validly on the production entry point; non-active/unknown combatant rejected; empty catalog → `abilityUnknown`, never a throw; revision and turn unchanged. |
| AC-8 | ✅ | `worldPixelToCell` floors (negative → `-1`, never `0`), `cellToWorldPixel` returns tile centres, round-trips for tile sizes 16/32/48, projection reuses the helper. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/game/combat/combat_preview.ts` | `ActionForecast`, `LegalActions`, `CombatPreviewRequest`, `CombatPreviewResult` TypeBox schemas |
| `packages/shared/types/src/lib/game/combat/combat_preview.ts` | `Static<>`-derived preview/forecast types |
| `packages/shared/utils/src/lib/rules/combat_spatial.ts` | Pure leaf: quantization, `cellKey`, `hasLineOfSight`, `computeReachableEndpoints` |
| `packages/shared/utils/src/lib/rules/combat_tactical.ts` | Pure queries: `getLegalActions`, `forecastCombatAction`, `occupiedCellsFor` |
| `packages/shared/utils/src/lib/rules/__tests__/combat_tactical.test.ts` | AC-2/AC-3/AC-4/AC-8 unit coverage |
| `packages/frontend/engine/src/combat/combat_battlefield.ts` | `snapshotBattlefield` ECS → `BattlefieldState` projection |
| `packages/frontend/engine/src/combat/combat_preview_handler.ts` | `handleCombatPreviewRequest`, `emitCombatPreviewResult` |
| `packages/frontend/engine/src/components/combat_movement.ts` | `CombatMovement` per-combatant allowance SoA component (not persisted) |
| `packages/frontend/engine/src/__tests__/combat_battlefield.test.ts` | AC-1/AC-8 engine integration coverage |
| `packages/frontend/engine/src/__tests__/combat_preview_bridge.test.ts` | AC-5/AC-7 preview-bridge integration coverage |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/schemas/src/lib/game/combat/combat_state.ts` | Optional `movementCost`/`blocksSight` on `BattlefieldState` |
| `packages/shared/schemas/src/lib/game/combat/combat_validation.ts` | Added `targetNotVisible` reason code |
| `packages/shared/schemas/src/lib/game/combat/index.ts` | Barrel export |
| `packages/shared/types/src/lib/game/combat/index.ts` | Barrel export |
| `packages/shared/utils/src/index.ts` | Export the two new rules modules |
| `packages/shared/utils/src/lib/rules/combat_kernel.ts` | LoS enforcement in `validateUseAbility` + `targetNotVisible` message key |
| `packages/shared/utils/src/lib/rules/combat_turn_coordinator.ts` | `MovementAllowanceResolver` / `movementPerTurnFor` on `createTurnState`/`beginTurn`/`endTurn` |
| `packages/shared/utils/src/lib/rules/__tests__/combat_kernel.test.ts` | C-515 AC-3 kernel LoS coverage |
| `packages/shared/utils/src/lib/rules/__tests__/combat_turn_coordinator.test.ts` | C-515 AC-6 allowance coverage |
| `packages/frontend/engine/src/combat/combat_bridge_types.ts` | `CombatPreviewRequestedCommand`, `CombatPreviewReadyEvent`, `CombatPlanRejectedEvent`, `CombatBridgeCommand`, `CombatBridgeEvent` |
| `packages/frontend/engine/src/combat/combat_bridge_commands.ts` | Registers + forwards `COMBAT_PREVIEW_REQUESTED` (`toCombatPreviewEnvelope`) |
| `packages/frontend/engine/src/combat/combat_command_dispatch.ts` | `COMBAT_PREVIEW_REQUESTED` case, `tryDispatchCombatCommand`, nullable-world context |
| `packages/frontend/engine/src/combat/combat_turn_driver.ts` | `CombatMovement` allowance, `abilityCatalog`/`seed` options, `getCombatPreviewSnapshot` |
| `packages/frontend/engine/src/sim.ts` | Export battlefield projection, preview handler, `CombatMovement` |
| `packages/frontend/engine/src/types.ts` | Preview command/event composed into the unions by reference (net −3 lines) |
| `packages/frontend/engine/src/worker/ecs_worker.ts` | Combat commands dispatched via `tryDispatchCombatCommand` (net −3 lines) |
| `packages/frontend/engine/src/__tests__/combat_turn_flow.test.ts` | C-515 AC-6 engine coverage + `resetCollisionGrid()` isolation |
| `scripts/src/lib/ops/guard_source_file_size_baseline.json` | Locked the two reductions in (2362→2359, 931→928); no allowance raised |

### Deviations from Spec

1. **`movementCostTo` is populated**, not left empty. The contract labels it "reserved for the UI grid"; the engine fills it from `computeReachableEndpoints` (the field is optional). No AC depends on it being empty.
2. **`blockedCells` is the "cells a unit may not enter" list** — terrain-solid plus occupied cells — while `movementCost` carries the terrain cost. The contract says impassability is the union of cost-0, `blockedCells` and out-of-bounds, which this preserves, and it additionally keeps the kernel's `validateMove` (which reads only `blockedCells`) consistent with the projected grid.
3. **`movementPerTurnFor` resolver added to the C-514 coordinator** (`createTurnState` as an optional third parameter, plus `BeginTurnInput`/`EndTurnInput`). The contract's directive said "the coordinator's `defaultTurnBudget(movementPerTurn)` is already parameterized"; a per-combatant *resolver* was required because the advanced combatant is only known inside `endTurn`. Additive and backward compatible — every C-514 test is green.
4. **`tryDispatchCombatCommand` replaces the worker's inline combat case labels.** The file-size ratchet left `ecs_worker.ts` no headroom for a new `case`, so the worker now narrows once and delegates. Behaviour is identical (`world === null` is still a no-op). No AC change.
5. **Baseline reductions locked in** (`--update-baseline`): `ecs_worker.ts` 2362→2359, `types.ts` 931→928. No allowance was raised; `game_world.ts` (2265) is untouched.
6. **`snapshotBattlefield` marks occupancy from the combat identity registry** (`GridPosition`, falling back to `worldPixelToCell(Position)`), not from the spatial-grid linked list. Combatant occupancy is what endpoint legality needs; the fallback is why the projection imports the canonical quantizer (AC-8's "no tile-size literal" hook).
7. **Test isolation**: `collision_system`'s terrain/spatial grid is a module singleton. The three new/extended engine test files call `resetCollisionGrid()` in `afterEach` so a later file (`game_world.test.ts`) does not inherit the fixture map. Without it, 6 pre-existing movement tests failed — a test-harness leak, not a production defect.
8. **`CombatMovement` is read only when `hasComponent` is true.** The component SoA arrays are module-level, so an eid recycled from another world could otherwise contribute a stale allowance (observed as a real cross-world leak in tests).
9. **Preview seed defaults to 0** in production: `initCombat` does not pass `StartCombatTurnsOptions.seed`, and `turn_manager_system.ts` is at its own file-size baseline, so it was not modified. AC-7 explicitly allows "seed, default 0, never advanced".
10. **`snapshotBattlefield` falls back to a 1×1 battlefield when no terrain grid is installed.** There is no public "clear terrain" API, so the fallback is defensive rather than test-covered.
11. **No `CombatPreviewResult` on the wire.** `COMBAT_PREVIEW_READY` carries the flattened success payload and `COMBAT_PLAN_REJECTED` the typed failure, exactly as the contract describes; `CombatPreviewResult` is the handler's return type and is asserted `Value.Check`-valid in AC-7's test.

### Test Results

- Unit (`utils`): 299/299 pass, 0 fail — baseline 265, +34 new (25 tactical, 4 kernel LoS, 5 coordinator allowance)
- Unit (`schemas`): 644/644 pass, 0 fail — unchanged
- Integration (`frontend-engine`): 1338 tests, 1335 pass, **3 fail** — the 3 failures are the pre-existing C-376 per-pack content audit (`props.webp` / `props.json` / `atlas.json` missing), identical to baseline
- Unit (`client`): 2939 pass, 0 fail, 7 skip, 2 todo (`bun run test:unit`)
- Guards: `guard-source-file-size`, `guard-type-safety`, `guard-mvvm-conventions`, `guard-orphaned-capability` all pass
- `validate({ test: true })`: 4/4 projects pass (frontend-engine, schemas, scripts, types, utils)
- Visual / E2E: **N/A** — this contract adds no player-facing surface. Every AC's Test Hook records "E2E / Visual: N/A", `Docs Impact` is `internal → none`, and the browser journey belongs to Combat-04. No sandbox route or visual suite was created.
- Baseline regression: 3 pre-existing failures, **0 new failures**
