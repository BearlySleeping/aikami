---
id: C-515
title: "Contract C-515: Combat-03 — World-Space Tactical Queries and Previews"
source: "docs/architecture/combat_2.md §10, §8.5, §15, §16, §22 — Combat-03 slice"
contract_type: full
status: draft
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
| **Target** | `packages/shared/utils/src/lib/rules/combat_tactical.ts` (new pure query module), shared schema/type extensions, `packages/frontend/engine/src/combat/combat_battlefield.ts` (ECS projection) + `COMBAT_PREVIEW_REQUESTED`/`COMBAT_PREVIEW_READY` bridge |
| **Type** | full |
| **Priority** | P1 — Combat-04 direct control cannot ship without legal endpoints, range, LoS, and a preview API |
| **Dependencies** | C-509 (Combat-01 schemas + kernel — `verified`), C-514 (Combat-02 turn coordinator + driver — `verified`); reuses C-173 (spatial grid), C-379 (`collision_system`/`TerrainGrid`), C-190/C-174 (vision/Bresenham), C-192/C-380 (A*/path following) |
| **Status** | draft |
| **Promotion** | `—` |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |
| **Production Surface** | `packages/shared/utils/src/lib/rules/combat_tactical.ts#getLegalActions`, `packages/frontend/engine/src/combat/combat_battlefield.ts#snapshotBattlefield`, and the `COMBAT_PREVIEW_REQUESTED` → `COMBAT_PREVIEW_READY` bridge pair (engine API only; no player-facing UI until Combat-04) |

## Problem & Baseline Evidence

- **Current behavior**: Combat-01/02 built a deterministic kernel, state, and turn loop, but the mechanical layer has **no spatial awareness**:
  1. There is **no production `BattlefieldState` builder**. `snapshotCombatState` takes `BattlefieldState` (`combat_state_adapter.ts:245,293,336`) but the only provider is a test fixture (`combat_state_adapter.test.ts:54`); `snapshotCombatState` has no production caller. The C-514 driver (`startCombatTurns`, `turn_manager_system.ts:116`) never builds one.
  2. There is **no reachable-area computation**. A* is single-goal only (`math/astar.ts:180` `findPath`); no flood-fill/budget search exists.
  3. There is **no LoS in the rules layer**. `requiresLineOfSight` is declared on abilities (`combat_state.ts:147–149`, "enforced from Combat-03") and **ignored**; `validateUseAbility` (`combat_kernel.ts:329–371`) checks only `manhattan(...) > ability.rangeCells`. The only LoS primitive is engine-side, impure, and module-singleton-backed (`math/bresenham.ts:157` `checkLineOfSight` over `setBresenhamTerrain`).
  4. There is **no preview/forecast API**. Architecture §16's `COMBAT_PREVIEW_REQUESTED`/`COMBAT_PREVIEW_READY` do not exist; the kernel exposes no `getLegalActions`/`forecast`.
  5. Movement allowance is global: `DEFAULT_MOVEMENT_PER_TURN = 6` (`combat_turn_coordinator.ts:41`), whose own comment says "Per-combatant speed arrives with the tactical preview slice (Combat-03)."
  6. World-pixel → cell conversion is duplicated with no canonical helper (`turn_manager_system.ts:1774,1798`; `goap_combat_tactics_system.ts:38,112–115`; `ecs_worker.ts:546–547`), despite `grid_position_sync_system.ts:69–70` being the de-facto ECS derivation.

- **Reproduction**:
  1. `rg "BattlefieldState" packages/frontend/engine/src --glob '!*.test.ts'` → no builder.
  2. `rg "reachable|getLegalActions|hasLineOfSight|forecast" packages/shared packages/frontend/engine --glob '!*.test.ts'` → zero combat hits.
  3. Call `validateCombatCommand` on a ranged `useAbility` across a wall: it succeeds because LoS is never checked.

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

- **Known gaps**: battlefield projection; reachable endpoints; LoS oracle + enforcement; range/LoS-aware legal targets; forecast/preview bridge; per-combatant movement allowance; a single quantization helper.

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
| C-509 schemas/state/kernel | `packages/shared/.../combat/` | modify — extend `BattlefieldState` + `CombatInvalidReason` + kernel queries |
| C-514 coordinator budget | `combat_turn_coordinator.ts` | modify — per-combatant movement allowance |
| Worker request/response | `worker_protocol.ts`, `worker_session.ts` | reuse pattern for the preview round trip |
| Bridge command/event | `combat_bridge_commands.ts` etc. | modify — add preview pair |

## Overview

Combat-03 gives the rules layer eyes. It adds a pure tactical-query module that, over a `BattlefieldState` projected from the live ECS world, computes reachable movement endpoints within the active combatant's budget, legal ability targets by range and line of sight, and a deterministic `ActionForecast` for a proposed command. It extends the C-509 schemas with optional flat battlefield cost/sight arrays and a LoS invalid reason, enforces `requiresLineOfSight` in the kernel, adds a canonical quantization helper, and exposes a correlated `COMBAT_PREVIEW_REQUESTED` → `COMBAT_PREVIEW_READY`/`COMBAT_PLAN_REJECTED` bridge pair. No UI is added; the Combat-04 direct-control slice consumes this API. Cover, threat zones, reactions, and surfaces/hazards remain out of scope.

## Design Reference

- **Governing architecture**: `docs/architecture/combat_2.md` §8.5 (`ActionForecast`), §10 (tactical projection + quantization), §15 (kernel API — `getLegalActions`/`forecast`), §16 (preview messages), §22/§22.2.
- **Pure-core pattern**: `combat_kernel.ts`/`combat_turn_coordinator.ts` — pure, no engine/client/ECS/network imports; input never mutated.
- **Projection pattern**: `combat_state_adapter.ts` — the adapter reads ECS raw arrays and returns serializable data.
- **LoS algorithm**: reuse `math/bresenham.ts`'s integer Bresenham; parameterize by a pure cell-array so it can live in the rules layer without ECS singletons.
- **Bridge pattern**: mirror `COMBAT_ACTION`/`COMBAT_END_TURN` for the command, and `TURN_CHANGED` for the correlated result event.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Pure tactical module**: `packages/shared/utils/src/lib/rules/combat_tactical.ts` — `worldPixelToCell`/`cellToWorldPixel`, `hasLineOfSight`, `computeReachableEndpoints`, `getLegalActions`, `forecastCombatAction`. No I/O, no ECS, no engine/client/AI imports.
- **Schema extensions** (shared, additive/optional to keep C-509 green): `BattlefieldState.movementCost?: number[]` and `BattlefieldState.blocksSight?: boolean[]` (flat `y*width+x`; `0` cost = impassable); add `targetNotVisible` to `CombatInvalidReasonSchema`; add `ActionForecastSchema`, `CombatPreviewRequestSchema`, `CombatPreviewResultSchema`.
- **Kernel**: add `getLegalActions({ state; combatantId })` and `forecastCombatAction({ state; command })`; enforce `requiresLineOfSight` in `validateUseAbility` for ranged attacks; keep `validateMove`/replay behavior intact when `movementCost`/`blocksSight` are absent.
- **ECS projection**: `packages/frontend/engine/src/combat/combat_battlefield.ts` — `snapshotBattlefield(world, options): BattlefieldState` reading `getPathfindingGrid`/`getTerrainGrid`/`isBlocksSight` + occupancy; pure read, deterministic; uses the canonical quantization helper.
- **Movement allowance**: per-combatant movement source (a small `CombatMovement` component or content-pack stat) read by the C-514 driver; default `DEFAULT_MOVEMENT_PER_TURN`. The coordinator's `defaultTurnBudget(movementPerTurn)` is already parameterized.
- **Bridge**: `COMBAT_PREVIEW_REQUESTED` (`GameCommand`, carries `requestId` + query + `basedOnRevision`) → `COMBAT_PREVIEW_READY` (`GameEvent`, carries `requestId` + forecast/legal sets) or `COMBAT_PLAN_REJECTED` (`GameEvent`, carries `requestId` + `reasonCode`). Worker-side handling in `combat/`; registration in `game_world`.
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

```ts
// ── Tactical query + preview ──

type LegalMoveQuery = { kind: 'legal_moves'; combatantId: string };
type LegalTargetQuery = { kind: 'legal_targets'; combatantId: string; abilityId: string };
type ActionQuery = { kind: 'action'; combatantId: string; command: CombatCommand };

type CombatPreviewRequest = {
  requestId: string;             // client-minted correlation id
  encounterId: string;
  basedOnRevision: number;       // C-509 stateRevision the query is bound to
  query: LegalMoveQuery | LegalTargetQuery | ActionQuery;
};

type CombatPreviewWarning =
  | 'triggers_reaction'          // reserved — Combat-08
  | 'affects_ally'
  | 'consumes_resource'
  | 'ends_turn';

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
// ── Pure tactical API (shared) ──

// worldPixelToCell(px, py, tileSize): GridPoint
// cellToWorldPixel(cell, tileSize): { x: number; y: number }   // tile centre
// hasLineOfSight(battlefield, from, to): boolean
// computeReachableEndpoints(battlefield, origin, movementBudget, occupied?): { endpoints: GridPoint[]; costTo: Record<string, number> }
// getLegalActions({ state, combatantId }): { endpoints: GridPoint[]; targetsByAbility: Record<string, string[]>; budget: TurnBudget }
// forecastCombatAction({ state, command }): { valid: true; forecast: ActionForecast } | { valid: false; reasonCode; messageKey }
```

Mechanical conventions (must be explicit and stable, per §10):
- **Cells**: integer `GridPoint`; flat index `y * width + x`; tile centre `cell * tileSize + tileSize/2`.
- **Adjacency**: **4-directional** mechanical movement (matches `validateMove`'s `manhattan(prev, next) === 1` contiguity). Presentation may interpolate smoothly.
- **Reachability**: Dijkstra over `movementCost` (or uniform cost when absent, using `blockedCells`); `0`/absent-cost cells and occupied cells are not traversable or reachable.
- **Tie-breaking**: endpoint and target lists are sorted deterministically (`y`, then `x`; targets by `combatantId`).
- **LoS**: integer Bresenham over `blocksSight`; origin and target cells are skipped; absent `blocksSight` ⇒ unobstructed.

## Quality Requirements

- **Offline/degraded mode**: 100% local pure computation; no AI/network; no provider dependency.
- **Accessibility/input**: N/A — no UI in this contract (Combat-04 consumes the API).
- **Performance budget**: endpoint + forecast query < 8 ms for an ordinary action at typical tactical-map sizes; queries allocate only their result; no query inside a per-frame loop beyond a single call.
- **Security/privacy**: `COMBAT_PREVIEW_REQUESTED` carries no free text; the engine validates `requestId`, active combatant, and `basedOnRevision`; a stale or non-active preview is rejected with a typed reason and never mutates state.
- **Persistence/migration**: N/A — no persisted state. `BattlefieldState` additions are optional and backward compatible.
- **Cancellation/retry/idempotency**: previews are pure and idempotent for the same state revision; a late/duplicate `requestId` result is ignored by the consumer; preview never commits.
- **Observability**: structural extension only; no new logging required. Rejections return a stable `reasonCode`/`messageKey`.

## Migration & Rollback

- **Old data compatibility**: N/A — no persisted combat state exists yet; new `BattlefieldState` fields are optional.
- **Migration**: N/A.
- **Rollback**: remove the new tactical module, schema fields, and preview bridge pair; C-509/514 behavior is unchanged (kernels treat absent fields as before).
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

**For this contract:** one outcome — the rules/engine layer can answer spatial legality and forecasts. The projection, query module, schema extensions, and bridge pair are inseparable for that outcome. 7 ACs, 4 projects (`schemas`, `types`, `utils`, `frontend-engine`), no UI. **Size: ok — proceed as one contract.**

## Acceptance Criteria

### AC-1: Battlefield projects from the live ECS world
**Given** a loaded map with a `TerrainGrid`, occupancy, and combat participants
**When** `snapshotBattlefield(world, options)` runs
**Then** it returns a schema-valid `BattlefieldState` with `width`/`height`, a flat `movementCost` (0 for solid/impassable), and a flat `blocksSight` grid consistent with `isBlocksSight`; out-of-bounds cells are impassable; the projection reads ECS without mutating it; and two calls on the same state produce identical output.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `packages/frontend/engine/src/__tests__/combat_battlefield.test.ts` | `packages/frontend/engine/src/combat/combat_battlefield.ts#snapshotBattlefield` + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: install a terrain grid, project, assert cost/sight against `isWalkable`/`isBlocksSight`; occupancy cells blocked.
- E2E / Visual: N/A.

**Watch Points**:
- Use `getTerrainTileSize()` — never hardcode 32.
- Flat arrays are `y*width+x`; assert a non-square map to catch transposition.

### AC-2: Reachable endpoints respect the movement budget and terrain cost
**Given** a projected battlefield, an origin, and a movement budget
**When** `computeReachableEndpoints` (and `getLegalActions` `legal_moves`) runs
**Then** the returned endpoints are exactly the 4-connected cells reachable at cost ≤ budget over the cost grid (impassable/occupied excluded); `costTo` matches the shortest-path cost; blocked cells and out-of-budget cells are absent; the result is deterministically ordered; and the input state is not mutated.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/shared/utils/src/lib/rules/__tests__/combat_tactical.test.ts` | `packages/shared/utils/src/lib/rules/combat_tactical.ts#computeReachableEndpoints` + tooling: `bun moon run utils:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`
- Integration: open room, wall, weighted/mud cell, and zero-budget cases; compare against a hand-computed set.
- E2E / Visual: N/A.

**Watch Points**:
- 4-directional only — matches `validateMove`; do not silently switch to diagonals.
- A wall that fully encloses the origin yields only cells on the origin side.

### AC-3: Legal targets use range and line of sight
**Given** the active combatant and an ability with `rangeCells`/`requiresLineOfSight`
**When** `getLegalActions` computes `legal_targets` and the kernel validates the `useAbility` command
**Then** targets beyond `rangeCells`, defeated targets, the actor itself, and (when `requiresLineOfSight`) targets with no LoS are excluded/rejected with `targetInvalid`, `targetDefeated`, or `targetNotVisible`; the legal set matches what `validateUseAbility` accepts.

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
**Given** the engine's combat preview entry point and a player-initiated `COMBAT_PREVIEW_REQUESTED`
**When** the worker handles it
**Then** it emits exactly one `COMBAT_PREVIEW_READY` (or `COMBAT_PLAN_REJECTED`) carrying the matching `requestId`; a request whose `basedOnRevision` is stale or whose combatant is not active is rejected with a typed reason and mutates nothing; and duplicate/late results are ignorable by `requestId`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `packages/frontend/engine/src/__tests__/combat_preview_bridge.test.ts` | `COMBAT_PREVIEW_REQUESTED` → `COMBAT_PREVIEW_READY` bridge + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: send a request; assert one correlated reply; send a stale-revision request; assert rejection; assert no `TURN_CHANGED`/state mutation.
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
- Missing source ⇒ default 6; C-514 tests must stay green.

### AC-7: Production engine path answers previews on the active turn
**Given** the production `/game` combat engine with an active player turn
**When** the engine receives a legal-moves, legal-targets, or action preview request for the active combatant
**Then** it builds the live battlefield from the ECS world, answers via the pure tactical module, returns a schema-valid result, and leaves the encounter state revision and turn unchanged; the same entry point rejects a request for a non-active or unknown combatant.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Integration | `packages/frontend/engine/src/__tests__/combat_preview_bridge.test.ts` | `packages/frontend/engine/src/combat/combat_battlefield.ts#snapshotBattlefield` + `combat_preview` handler + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: pure-kernel assertions over a state from `createCombatState`/`snapshotCombatState` for each query kind; invalid-combatant rejection.
- E2E / Visual: N/A — no player-facing surface; Combat-04 owns the browser journey.

**Watch Points**:
- The preview path must not import or execute the legacy resolver or emit `COMBAT_LOG`.
- Keep `snapshotCombatState`/`snapshotBattlefield` read-only; no ECS writes during preview.

## Implementation Sequence

1. **Phase 1 (Schemas + types)**: extend `BattlefieldState`, add `targetNotVisible`, `ActionForecastSchema`, `CombatPreviewRequestSchema`, `CombatPreviewResultSchema`; barrel-export; ensure C-509 schema tests stay green.
2. **Phase 2 (Pure tactical module)**: `combat_tactical.ts` — quantization, LoS, reachability, `getLegalActions`, `forecastCombatAction`; extend the kernel to enforce LoS and expose the queries; add `combat_tactical.test.ts`.
3. **Phase 3 (Engine projection + bridge)**: `combat_battlefield.ts` `snapshotBattlefield`; per-combatant movement source; worker preview handler; `COMBAT_PREVIEW_REQUESTED`/`COMBAT_PREVIEW_READY`/`COMBAT_PLAN_REJECTED` through `GameCommand`/`GameEvent` and `game_world`; add engine tests.
4. **Phase 4 (Validation)**: `bun run fix`, `utils:test`, `schemas:test`, `frontend-engine:test`, `client:test`, and `bun moon run :validate`; update the Execution Report.

## Edge Cases & Gotchas

- **Quantization**: `Math.floor(px / tileSize)` with `tileSize` from `getTerrainTileSize()`; tile centres at `cell*tileSize + tileSize/2`. A canonical helper avoids the existing duplicated literals.
- **Non-square maps / transposition**: flat arrays are `y*width+x`; a square-only test hides row/column bugs.
- **Occupancy during preview**: the projected battlefield should mark occupied cells (including the actor) as blocked for endpoint purposes, while LoS uses sight only.
- **Origin cell edges**: `hasLineOfSight` skips origin and target cells, matching `bresenham.ts`; otherwise a unit standing in a doorway can never see out.
- **No occlusion data**: absent `blocksSight` means "unobstructed" so C-509 fixtures stay valid.
- **Cost units**: `movementCost` is in cells (1 per step for flat ground); do not mix pixel distance with grid cost.
- **Preview staleness**: a result whose `basedOnRevision` no longer equals the live revision is discarded by the consumer, not applied.
- **Determinism**: sort endpoint/target outputs; never iterate a `Set`/`Map` whose insertion order depends on runtime.

## Open Questions

Must be resolved before status becomes `approved`:

- **Q1 — Movement adjacency.** Recommendation: 4-directional to match `validateMove`'s contiguity; the presentation interpolates 8-directional. Confirm, or amend C-509's contiguity rule to allow diagonals as part of this contract.
- **Q2 — Per-combatant movement source.** Recommendation: a small `CombatMovement` SoA component (default 6) written at spawn from content-pack data, read by the driver. Confirm vs. extending `CombatStats` or the content-pack encounter schema.
- **Q3 — Preview transport.** Recommendation: correlated `GameCommand`/`GameEvent` with a client-minted `requestId`, mirroring `COMBAT_ACTION`, rather than the worker-session `request()` promise used by `REQUEST_SNAPSHOT`. Confirm the UI (Combat-04) can consume the event form.

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

_To be completed by the implementer. Leave pending until implementation begins._

### Summary

Pending.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ⬜ | Pending |
| AC-2 | ⬜ | Pending |
| AC-3 | ⬜ | Pending |
| AC-4 | ⬜ | Pending |
| AC-5 | ⬜ | Pending |
| AC-6 | ⬜ | Pending |
| AC-7 | ⬜ | Pending |

### Files Created

| File | Purpose |
|---|---|
| — | — |

### Files Modified

| File | Change |
|---|---|
| — | — |

### Deviations from Spec

Pending.

### Test Results

Pending.
