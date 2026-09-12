---
id: C-514
title: "Contract C-514: Combat-02 — Real Turn Coordinator and Action Budgets"
source: "docs/architecture/combat_2.md §9, §22 — Combat-02 slice"
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-12T00:00:00Z"
---

# Contract C-514: Combat-02 — Real Turn Coordinator and Action Budgets

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/architecture/combat_2.md` §9 (turn model) and §22 (rollout — "Real turn coordinator and action budgets") |
| **Target** | `packages/shared/utils/src/lib/rules/combat_turn_coordinator.ts` (new pure core), `packages/frontend/engine/src/systems/turn_manager_system.ts` (refactor), `packages/frontend/engine/src/combat/` (engine driver), engine bridge + combat ViewModel |
| **Type** | full |
| **Priority** | P1 — the existing turn loop runs every enemy turn as a side effect of the player's action; both `TURN_CHANGED` and the UI `endTurn()` are wrong |
| **Dependencies** | C-509 (Combat-01 versioned schemas + pure kernel — `verified`), C-197 (GOAP combat tactics — `completed`, deterministic fallback controller), C-338 (action economy + statuses — `implemented`) — all three are ready; no stubbing required |
| **Status** | implemented |
| **Promotion** | `—` |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` (combat overlay) + `packages/frontend/engine/src/systems/turn_manager_system.ts#handleCombatAction`, `packages/frontend/engine/src/combat/combat_turn_driver.ts#endActiveTurn`, `packages/shared/utils/src/lib/rules/combat_turn_coordinator.ts#endTurn` |

## Problem & Baseline Evidence

- **Current behavior**: Turn sequencing in production combat is implicit and module-global.
  1. `handleCombatAction` runs the whole enemy team **inside the player's action** rather than at the enemy's own turn: miss → `_processEnemyTurn` (`turn_manager_system.ts:679`), hit → L736, `DEFEND` → L569, multi-target ability → L867. The companion (L256–262), stunned (L232–243), and downed (L246–252) branches of `advanceTurn` `return` **without emitting `TURN_CHANGED`** — only the fall-through path emits it (L263–267).
  2. There is no explicit end-turn path. The combat ViewModel's `endTurn()` (`combat_view_model.svelte.ts:1482`) does **not** message the engine: it flips `currentTurnEntity` locally between `1` and the nearest enemy and advances `turnNumber` (L1492–1508, comment: "In full combat with many entities, the bridge would handle this").
  3. Turn order, index, action economy, and death saves live in **module-level singletons** — `turnOrderList` (L46), `currentTurnIndex` (L47), `_actionEconomy` (L64), `_deathSaveSuccesses`/`_deathSaveFailures` (L102–103). This is not world-scoped: simultaneous worlds/tests share state and `resetTurnTracking()` is mandatory between cases (`turn_manager.test.ts:90`).
  4. The budget is **action / bonus / reaction only** (`_getActionEconomy`, L66–85); there is no movement budget. `ACTION_ECONOMY_CHANGED` carries only `actionAvailable`/`bonusActionAvailable`/`reactionAvailable` (`types.ts:605–609`).
  5. Existing tests bake in the implicit chain — e.g. `turn_manager.test.ts:710` "DEFEND: emits log entry and allows enemy counter-attack".

- **Reproduction**:
  1. Trigger combat in `/game`; attack once. Enemy turns resolve before the player can act again (player action → `_processEnemyTurn`).
  2. Call `combatViewModel.endTurn()`. No `COMBAT_END_TURN` reaches the worker (no such `GameCommand`; `rg "COMBAT_END_TURN|END_TURN" packages/frontend/engine/src` → only the ViewModel-local method); only local UI state changes.
  3. `rg "_processEnemyTurn" packages/frontend/engine/src/systems/turn_manager_system.ts` → call sites at L569, L679, L736, L867 inside player action resolution.
  4. Instantiate two ECS worlds in one process and run `initCombat` on both — the second is a no-op or corrupts the first because `turnOrderList` is a module singleton.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | C-509 turn state + budgets + turn events | `packages/shared/utils/src/lib/rules/combat_kernel.ts` (`advanceTurn` L458, `TurnBudget`, `turnStarted`/`turnEnded`/`combatEnded`), schemas `packages/shared/schemas/src/lib/game/combat/` |
  | C-509 stable combatant IDs + ECS projection | `packages/frontend/engine/src/combat/combat_state_adapter.ts` (`CombatIdentity`, `combatantId ↔ eid` registry) |
  | Deterministic GOAP enemy/companion tactics | `packages/frontend/engine/src/systems/goap_combat_tactics_system.ts`, `resolveTacticalAction` |
  | Existing action-economy + emit helper | `turn_manager_system.ts` `_getActionEconomy`/`_emitActionEconomy` (L66–96) |
  | Bridge command/event pattern | `packages/frontend/engine/src/engine_bridge.ts`, `game_world.ts` `_registerBridgeCommand` (L1537), `worker/ecs_worker.ts` (L627) |
  | Combat ViewModel turn state | `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` (`TURN_CHANGED` L807, `endTurn` L1482) |

- **Known gaps**:
  1. No pure, deterministic owner of "whose turn + round + budgets"; sequencing is spread across `handleCombatAction`, `advanceTurn`, and the ViewModel.
  2. No explicit end-turn bridge command; the ViewModel fakes advancement.
  3. No movement budget; action economy is a module singleton, not world-scoped.
  4. AI turns are side effects of the player's action rather than acting on their own turn.
  5. `TURN_CHANGED` is omitted for AI/stunned/downed/companion transitions, so the UI desyncs.

- **Baseline tests** (capture green before starting):
  - `packages/frontend/engine/src/__tests__/turn_manager.test.ts` (44 tests; L710 asserts the implicit counter-attack).
  - `packages/frontend/engine/src/__tests__/combat_sync.test.ts`, `goap_combat_tactics.test.ts`, `replay_fixture.test.ts`.
  - `apps/e2e/tests/client/combat.spec.ts`, `apps/e2e/tests/game/goap_combat.spec.ts`.
  - `bun moon run frontend-engine:test`, `bun moon run client:test`.

## User Outcome

After this contract, a player in combat takes their move and action, sees their remaining movement/action/quick/reaction budgets, and **chooses when to end their turn**. Enemies and companions act on their own turns after the player ends, not as a hidden side effect. `TURN_CHANGED` and action-economy updates fire for every turn, and combat works correctly across more than one world in a single process.

## Success Measures

- **Time/latency target**: `endTurn`/`spendBudget` coordinator calls under 1 ms; no new work in the 60 fps engine loop; AI turn kick adds no blocking wait.
- **Offline/degraded behavior**: turn coordination and budgets are 100% local/deterministic (C-197 GOAP fallback), with zero AI/network dependency. An unresponsive provider cannot stall a turn.
- **Production journey enabled**: `/game` combat can be played to victory/defeat with explicit end turns and visible budgets.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Turn/budget authority | `packages/shared/utils/src/lib/rules/combat_kernel.ts` | modify — extract turn advance/budget into the coordinator and delegate |
| `CombatState`/`TurnBudget`/`CombatEvent` types | `packages/shared/schemas/src/lib/game/combat/`, `packages/shared/types/src/lib/game/combat/` | reuse — `TurnBudget` already carries `movementRemaining`/`actionAvailable`/`quickActionAvailable`/`reactionAvailable`; **do not** extend the shared `CombatEventSchema` union (C-509 deferred budget `CombatEvent`s to Combat-03) |
| Existing action-cost legality | `combat_kernel.ts` `checkActionCost` (L236–251) + `CombatActionCost` (`schemas/.../combat_state.ts:121`) | reuse — the coordinator delegates to it; the coordinator cost type is `CombatActionCost \| 'movement'`, never a second enum |
| ECS combat turn manager | `packages/frontend/engine/src/systems/turn_manager_system.ts` | modify — remove implicit chains + singletons; delegate to driver |
| Stable combatant identity | `packages/frontend/engine/src/combat/combat_state_adapter.ts` | reuse |
| Deterministic enemy/companion AI | `goap_combat_tactics_system.ts` | reuse — run at active turn |
| Bridge command registration | `game_world.ts` `_registerBridgeCommand` (L1538), `worker/ecs_worker.ts` (L627) | modify — add `COMBAT_END_TURN` |
| Combat ViewModel turn state | `combat_view_model.svelte.ts` (`endTurn` L1482) | modify — send end turn; react to `TURN_CHANGED`/budgets |
| Dev-sandbox combat ViewModel | `combat_view_model.dev.svelte.ts` (`endTurn` L530) | tolerate the widened `ActionEconomy`; the sandbox keeps simulating locally (out of scope, see AC-4) |
| C-509 kernel replay/immutability | `combat_kernel.ts` | reuse — C-509 tests must stay green |

## Overview

Combat-02 replaces implicit, singleton turn sequencing with a deterministic turn coordinator that owns turn order, round, the active turn, and the four-budget model (movement, action, quick, reaction). The coordinator is a pure shared module; an engine-side driver binds it to each ECS world and to the bridge. `handleCombatAction` stops triggering enemy turns and stops advancing the turn; advancement happens only on an explicit end turn, forced defeat/incapacitation, or an explicit auto-end policy. AI-controlled combatants (enemies, companion auto-turns) execute their deterministic fallback turn when their turn becomes active, not inside the player's action. The ViewModel's `endTurn()` sends a new `COMBAT_END_TURN` command and renders turn/budget state from bridge events. The `combatEngine: 'legacy' | 'v2'` flag and the v2 resolver switch remain out of scope (Combat-04).

## Design Reference

- **Governing architecture**: `docs/architecture/combat_2.md` §5.1 (controllers vs rules), §7.1 (direct player action), §9 (turn model + budgets + reactions deferral), §15 (kernel API), §22/§22.2 (rollout + flag deferral).
- **Pure-core pattern**: `packages/shared/utils/src/lib/rules/combat_kernel.ts` — pure functions, no engine/client/ECS/AI imports.
- **Identity pattern**: reuse the `combatantId ↔ eid` registry in `combat_state_adapter.ts`; never key turn state by raw eid beyond the driver boundary.
- **Bridge pattern**: register the new command in `game_world.ts` and dispatch it in `worker/ecs_worker.ts`, mirroring `COMBAT_ACTION`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Pure coordinator**: `packages/shared/utils/src/lib/rules/combat_turn_coordinator.ts` — turn order, round, active index, `turnId`, and `TurnBudget` map. No I/O, no ECS, no engine/client/AI imports.
- **Kernel delegation**: `combat_kernel.ts` must delegate its turn advance and budget legality to the coordinator so there is exactly one turn/budget authority; C-509 replay/determinism tests remain green.
- **Engine driver**: `packages/frontend/engine/src/combat/combat_turn_driver.ts` — per-world `WeakMap` coordinator state + `combatantId ↔ eid` mapping. Owns `beginTurn`/`endActiveTurn`/`spendActiveBudget`/`getActiveTurn`, and emits `TURN_CHANGED`/`ACTION_ECONOMY_CHANGED`/`COMBAT_STATE_UPDATE`.
- **Turn manager refactor**: remove `turnOrderList`, `currentTurnIndex`, `_actionEconomy`, `_deathSave*` module singletons; `_processEnemyTurn` must have no call site inside player action resolution. AI/companion turns run from the driver's active-turn kick.
- **Bridge**: add `COMBAT_END_TURN` to `GameCommand` in `packages/frontend/engine/src/types.ts`; extend the engine's `GameEvent` `ACTION_ECONOMY_CHANGED` (currently `types.ts:601–610`) with `movementRemaining` (and `quickActionAvailable`, keeping `bonusActionAvailable` as the wire alias for one release).
- 🔴 **Two different event unions — do not conflate them.** The budget-change event this contract adds is the **engine bridge** `GameEvent` `ACTION_ECONOMY_CHANGED` (already exists, C-338 AC-1). The **shared** `CombatEventSchema` union (`packages/shared/schemas/src/lib/game/combat/combat_event.ts`) is **not** extended: C-509 explicitly deferred a budget/action-spent `CombatEvent` to Combat-03 (C-509 Out of Scope: "A budget/action-spent `CombatEvent` for `defend`/`wait` — deferred until a UI consumes it (Combat-03)"; kernel comment at `combat_kernel.ts:439–441`). Adding a member there would change a versioned union and perturb the C-509 replay fixtures this contract must keep green.
- **No schema/rules-version change** to C-509 state. The coordinator reuses `TurnBudget`, `CombatOutcome`, `CombatActionCost`, and `CombatInvalidReason` as-is; `CombatEventSchema`, `COMBAT_SCHEMA_VERSION`, `COMBAT_RULES_VERSION`, and `COMBAT_REPLAY_VERSION` are untouched.
- **Type placement (monorepo boundaries)**: the coordinator's public types live in `packages/shared/types/src/lib/game/combat/combat_turn.ts` (+ barrel export) — **not** declared inside the `utils` file. No TypeBox schema is required because none of them cross the bridge or persist; if one later does, it belongs in `packages/shared/schemas/`.
- **Barrel export**: add `export * from './lib/rules/combat_turn_coordinator.ts';` to `packages/shared/utils/src/index.ts` (consumers import from `@aikami/utils`, never `lib/`).
- The `combatEngine` flag, v2 resolver wiring, tactical previews/LoS, reactions, and LLM controllers are **not** touched.

## State & Data Models

Conceptual. Types land in `packages/shared/types/src/lib/game/combat/combat_turn.ts` (exported through the `combat` barrel and `@aikami/types`); no TypeBox schema is required in this contract because none of these cross the bridge or persist. Any shape that does cross a boundary later follows C-509 conventions (`Type.Object` + `additionalProperties: false`, `Static<>`).

```ts
// ── Pure coordinator types (packages/shared/types) ──

type TurnTrigger =
  | 'encounter_start'
  | 'explicit_end_turn'
  | 'auto_exhausted'
  | 'forced_defeat'
  | 'forced_incapacitated';

/**
 * Coordinator's read-only view of a combatant. Must carry everything
 * `getForcedEndReason` needs to build a `CombatOutcome` — `team` (party =
 * player|ally vs enemy, mirroring the kernel's `evaluateOutcome`) plus the
 * HP/downed flags — and everything the skip rule needs (`stunned`, `downed`).
 * A `{ combatantId, initiative, defeated }` triple is NOT sufficient.
 */
type CombatantTurnStatus = {
  combatantId: string;
  initiative: number;
  team: CombatTeam;
  hp: number;
  downed: boolean;
  stunned: boolean;
  defeated: boolean;
};

type CombatTurnState = {
  order: string[]; // deterministic: initiative desc, combatantId asc
  activeIndex: number;
  round: number;
  turnId: string | null; // `r{round}:{combatantId}` (reuse C-509 turnIdFor)
  budgets: Record<string, TurnBudget>; // movement/action/quick/reaction
};

type AutoEndPolicy = 'manual' | 'auto_when_exhausted';

/**
 * Superset of C-509's `CombatActionCost` (`'action' | 'quick' | 'reaction' |
 * 'free'`, `schemas/.../combat_state.ts:121`) with `'movement'` added. Do NOT
 * re-declare the four C-509 members and do NOT add `'movement'` to
 * `CombatActionCostSchema` — that would be a versioned schema change.
 */
type CombatBudgetCost = CombatActionCost | 'movement';

type TurnTransition = {
  state: CombatTurnState;
  /** Coordinator-local budget-change descriptions — NOT the versioned CombatEvent union. */
  budgetChanges: Array<{ combatantId: string; budget: TurnBudget }>;
  outcome?: CombatOutcome;
};

// Exported functions:
//   createTurnState(entries, movementPerTurn = DEFAULT_MOVEMENT_PER_TURN): CombatTurnState
//   beginTurn({ state; status; trigger }): TurnTransition
//   endTurn({ state; status; trigger; policy }): TurnTransition
//   spendBudget(state, combatantId, cost, amount?): { ok: true; state } | { ok: false; reason: CombatInvalidReason }
//   getActiveTurn(state): { combatantId; turnId; round } | null
//   isExhausted(state, combatantId): boolean
//   getForcedEndReason(status): CombatOutcome | null
```

```ts
// ── Engine driver (frontend/engine) ──

type ControllerKind = 'player' | 'companion_ai' | 'enemy_ai';

// Exported functions:
//   startCombatTurns(world, bridge, options): void
//   endActiveTurn(world, bridge, trigger): void
//   spendActiveBudget(world, cost, amount?): SpendBudgetResult  // carries CombatInvalidReason on rejection (AC-3)
//   getActiveTurn(world): { entityId; combatantId; turnId; round } | null
//   getActiveBudget(world): TurnBudget | null
//   setAutoEndPolicy(world, policy): void
//   resetCombatTurns(world): void

type SpendBudgetResult =
  | { ok: true; budget: TurnBudget }
  | { ok: false; reason: CombatInvalidReason };
```

```ts
// ── Bridge additions (packages/frontend/engine/src/types.ts) ──

// GameCommand
| { type: 'COMBAT_END_TURN' }

// GameEvent (extend the existing engine event at types.ts:601–610)
| {
    type: 'ACTION_ECONOMY_CHANGED';
    entityId: number;
    movementRemaining: number;
    actionAvailable: boolean;
    quickActionAvailable: boolean;
    /** @deprecated alias of quickActionAvailable — removed after one release */
    bonusActionAvailable: boolean;
    reactionAvailable: boolean;
  }
```

> 🔴 The engine `GameEvent` `ACTION_ECONOMY_CHANGED` above is **not** the shared
> `CombatEventSchema` union. The shared union is left untouched (see
> Architecture Directives) — C-509 deferred budget `CombatEvent`s to Combat-03.

## Quality Requirements

- **Offline/degraded mode**: turn coordination uses the deterministic GOAP fallback only; no AI/network call can block or delay a turn.
- **Accessibility/input**: `COMBAT_END_TURN` reachable from the existing combat controls; the ViewModel keeps engine/turn state in one place.
- **Performance budget**: coordinator calls < 1 ms; no coordinator work in the render loop; no unbounded per-tick allocation.
- **Security/privacy**: `COMBAT_END_TURN` carries no free text; the engine validates actor/turn ownership before advancing (a client cannot end a turn that is not active).
- **Persistence/migration**: N/A — turn state is in-memory. Turn state must no longer be a module singleton, so multiple worlds/tests isolate correctly.
- **Cancellation/retry/idempotency**: ending an already-ended/not-active turn is a no-op or typed rejection; forced end is idempotent; `RETRY_ENCOUNTER` resets coordinator state exactly once.
- **Observability**: retain existing combat logs; emit exactly one `TURN_CHANGED` per active turn and one `ACTION_ECONOMY_CHANGED` per budget change.

## Migration & Rollback

- **Old data compatibility**: N/A — no persisted state.
- **Migration**: N/A — no data migration.
- **Rollback**: revert the turn manager to its prior sequencing; no schema or save impact.
- **Feature flag or kill switch**: none in this contract; the `combatEngine: 'legacy' | 'v2'` flag is introduced in Combat-04 (per C-509's stated boundary).
- **Failure recovery**: if coordinator state is missing/corrupt for a world, the driver logs via the module-level logger (`import { logger } from '$logger'` — the driver is a plain module, not a `BaseClass`, so `$logger` is correct; never `@aikami/logger`) and falls back to a fresh deterministic turn state from live ECS participants rather than throwing.

## Scope Boundaries

- **In Scope:**
  - Pure deterministic turn coordinator (`createTurnState`/`beginTurn`/`endTurn`/`spendBudget`/`getActiveTurn`/`isExhausted`/`getForcedEndReason`) with movement/action/quick/reaction budgets.
  - Explicit end turn: `COMBAT_END_TURN` command, `game_world` registration, worker dispatch, ViewModel send.
  - Removal of implicit player-action→enemy-chain calls and module-level turn singletons in `turn_manager_system.ts`.
  - AI/companion turns triggered by the active turn (deterministic GOAP), not by the player's action.
  - `TURN_CHANGED` + `ACTION_ECONOMY_CHANGED` emitted for every active turn, with movement budget added.
  - `combat_kernel.ts` delegation to the coordinator; C-509 tests remain green.
  - Updated engine tests + E2E coverage for explicit end turn.

- **Out of Scope:**
  - The v2 resolver switch, `combatEngine` feature flag, and direct-control production slice (Combat-04).
  - Tactical movement endpoints, reachable areas, range/LoS previews (Combat-03); Combat-02 only holds and spends the movement budget.
  - Reactions and reaction windows (Combat-08) — reactions remain disabled in Combat-02.
  - LLM enemy/companion agents, intent compilation, narration (Combat-05/06).
  - New statuses, abilities, objectives, morale, or improvised actions.
  - Changing damage/hit/status math (still the legacy `_processPlayerAttack`/`_processSingleEnemyTurn` path until Combat-04).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — turn advancement is explicit and budgets are real and per-world. The coordinator, engine driver, and ViewModel change are inseparable for that outcome; leaving any out would keep a competing authority live. 7 ACs, 4 projects (`types`, `utils`, `frontend-engine`, `client` — `types` only gains the coordinator's type declarations, which conventions require outside `apps/**`/`utils`), no schema-version change. **Size: ok — proceed as one contract.**

## Acceptance Criteria

### AC-1: Pure turn coordinator is deterministic and owns turn order, round, and budgets
**Given** a set of combatants with initiatives and a movement allowance
**When** `createTurnState` / `beginTurn` / `endTurn` run
**Then** order is initiative desc then `combatantId` asc; `beginTurn` resets the active combatant's `TurnBudget`; wrapping past the last eligible combatant increments `round`; `turnId` is `r{round}:{combatantId}`; the input state is never mutated; and the same inputs produce byte-identical transitions (canonical JSON).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/utils/src/lib/rules/__tests__/combat_turn_coordinator.test.ts` | `packages/shared/utils/src/lib/rules/combat_turn_coordinator.ts#createTurnState` + tooling: `bun moon run utils:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`
- Integration: table-driven advancement cases; immutable-input assertions.
- E2E / Visual: N/A.

**Watch Points**:
- Reuse C-509's initiative tiebreak and `turnId` construction — do not invent a second ordering.
- `CombatState`/`CombatEvent` shapes must stay schema-valid; the shared `CombatEventSchema` union must gain **no** member in this contract (C-509 deferred budget events to Combat-03).

### AC-2: Advancement only on explicit end turn, forced end, or auto-end policy
**Given** an active combatant mid-turn
**When** an action (attack/ability/defend/support/revive) resolves and the turn is not ended
**Then** no enemy/companion turn is processed and the active turn does not change; `endTurn` advances only when the trigger is `explicit_end_turn`, `forced_defeat`/`forced_incapacitated`, or `auto_exhausted` under an `auto_when_exhausted` policy; and `_processEnemyTurn` has no call site in player action resolution.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Integration | `packages/frontend/engine/src/__tests__/turn_manager.test.ts` (updated) | `turn_manager_system.ts#handleCombatAction` + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: attack/defend/ability no longer emit enemy `COMBAT_LOG` until end turn; forced defeat ends combat; exhaustion auto-ends only under the policy.
- E2E / Visual: N/A (covered by AC-7).

**Watch Points**:
- `turn_manager.test.ts:710` ("allows enemy counter-attack") encodes the old behavior and must be rewritten to the explicit model.
- Forced end must still fire the existing victory/defeat + loot/XP path exactly once.

### AC-3: Action budgets are real, spendable, and split-movement-aware
**Given** an active combatant with a full `TurnBudget`
**When** actions, quick actions, reactions, and movement are spent
**Then** `spendBudget` rejects a cost with the correct `CombatInvalidReason`: `movementBudgetExceeded` for over-spending movement, and `noActionAvailable` for an unavailable action, quick action, or reaction (C-509's `checkActionCost` at `combat_kernel.ts:236–251` already returns `noActionAvailable` for quick/reaction because no dedicated code exists in the versioned `CombatInvalidReasonSchema` — reuse it, do not add an enum member); spending movement may happen before and after the action in the same turn; and budget changes emit `ACTION_ECONOMY_CHANGED` with `movementRemaining`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Integration | coordinator test + `turn_manager.test.ts` (updated) | `combat_turn_driver.ts#spendActiveBudget` + tooling: `bun moon run utils:test`, `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`, `bun moon run frontend-engine:test`
- Integration: repeated action rejected; movement before + after action allowed; `ACTION_ECONOMY_CHANGED` carries `movementRemaining`.
- E2E / Visual: N/A.

**Watch Points**:
- Movement budget is state/accounting only here; world-space endpoint legality is Combat-03.
- Do not spend a budget for a rejected action.
- `spendActiveBudget` must surface the rejection reason (result union, not a bare `boolean`) so AC-3's reason codes are observable on the production path.
- Movement allowance comes from the exported `DEFAULT_MOVEMENT_PER_TURN = 6` (`combat_kernel.ts:59`) — ECS `CombatStats` has no speed/movement field, so do not invent one here.

### AC-4: Explicit end turn flows UI → bridge → engine
**Given** the player's turn is active in `/game` combat
**When** the player ends their turn via the combat control
**Then** the ViewModel sends `COMBAT_END_TURN`; `game_world` forwards it; the worker calls `endActiveTurn`; a new `TURN_CHANGED` follows; and the ViewModel updates only from bridge events (it no longer mutates `currentTurnEntity`/`turnNumber` locally).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration + E2E | `apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts` + `apps/e2e/tests/client/combat.spec.ts` | `/game` combat + `combat_turn_driver.ts#endActiveTurn` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`, `bun moon run frontend-engine:test`, `bun moon run e2e:test-client`
- Integration: `endTurn()` sends exactly one `COMBAT_END_TURN`; no local turn mutation; `TURN_CHANGED` updates the VM.
- E2E / Visual:
    - **Functional**: extend `apps/e2e/tests/client/combat.spec.ts` — enter combat, act, end turn, observe the active-turn marker move.
    - **Visual**: N/A (no new visual surface; existing combat visual suite must stay green).

**Watch Points**:
- A client must not be able to end a turn that is not the active player turn (validate in the driver/engine).
- `endTurn()` outside combat stays a no-op.
- The dev-sandbox override `combat_view_model.dev.svelte.ts#endTurn` (L530) keeps simulating locally — it is **out of scope** for the bridge wiring, but its `ActionEconomy` literals (L236, L544) must be widened to satisfy the extended type. Do not leave a type error in the sandbox.
- `apps/frontend/client/src/lib/views/combat/types/combat_enhancements.ts#ActionEconomy` (L78) gains `movementRemaining` + `quickActionAvailable`.

### AC-5: AI and companion turns run on their own active turn
**Given** the active combatant is an enemy or an auto-companion
**When** their turn becomes active
**Then** the deterministic controller (GOAP tactics for enemies, existing companion policy) executes their turn outside the player's action, emits exactly one `TURN_CHANGED` for them, and then ends their turn under the AI auto-end policy; a stunned or downed combatant is auto-skipped with a `TURN_CHANGED`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `packages/frontend/engine/src/__tests__/turn_manager.test.ts` + `goap_combat_tactics.test.ts` | `combat_turn_driver.ts` active-turn kick + tooling: `bun moon run frontend-engine:test`, `bun moon run e2e:test-game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: multi-enemy initiative order resolves each enemy exactly once per round; no duplicate turns; stunned/downed emit `TURN_CHANGED`.
- E2E / Visual: `apps/e2e/tests/game/goap_combat.spec.ts`.

**Watch Points**:
- The old `_processEnemyTurn` loop must not run twice (once implicitly, once on the active turn).
- Companion auto-turn must not recurse into another full turn chain.
- Auto-skip requires `CombatantTurnStatus` to carry `stunned`/`downed` (see State & Data Models) — a `defeated`-only status cannot satisfy this AC.

### AC-6: Turn state is world-scoped, not a module singleton
**Given** two ECS worlds in one process, each with combat participants
**When** both initialize and advance combat independently
**Then** each world has its own turn order, active index, round, budgets, and death-save state; operations on one world do not affect the other; and `resetCombatTurns(world)` clears only that world.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Integration | `packages/frontend/engine/src/__tests__/combat_sync.test.ts` (extended) | `combat_turn_driver.ts` per-world state + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: two-world isolation test; no cross-world bleed.
- E2E / Visual: N/A.

**Watch Points**:
- Remove every module-level turn/economy singleton, including `_deathSaveSuccesses`/`_deathSaveFailures`.
- `RETRY_ENCOUNTER` resets the correct world only.
- `resetTurnTracking()` (`turn_manager_system.ts:287`) is exported and called from `ecs_worker.ts:653` and from the existing tests (`turn_manager.test.ts:90`, `combat_sync.test.ts:212/220`) — its signature changes to take a world; update every call site, or keep a no-arg shim that delegates. Do not leave a dangling export.

### AC-7: Production combat journey uses explicit turns and budgets
**Given** the `/game` production route with a combat encounter
**When** the player attacks, ends their turn, observes enemy turns, and continues to victory or defeat
**Then** the full loop completes with the active-turn indicator moving through initiative order, budgets updating, no hidden enemy action during the player's turn, and input restored on exit; existing regression/e2e combat tests pass (updated where they encoded implicit chaining).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | E2E | `apps/e2e/tests/client/combat.spec.ts` (extended) | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`, `bun moon run client:test`, `bun moon run e2e:test-client`
- Integration: manual `/game` smoke — dialogue → combat → act → end turn → enemy turn → resolve → exit.
- E2E / Visual:
    - **Functional**: extend `apps/e2e/tests/client/combat.spec.ts` with the explicit end-turn journey (`bun moon run e2e:test-client`).
    - **Visual**: existing `apps/e2e/src/visual/suites/combat.visual.ts` must remain ≥ threshold (`bun moon run e2e:run-visual-tests`).

**Watch Points**:
- Keep the C-500 clean-exit behavior (`closeCombat` → EXPLORE, input restored exactly once).
- Do not regress the C-500 tick-health assertions while refactoring.

## Implementation Sequence

1. **Phase 1 (Pure core)**: Add the coordinator types to `packages/shared/types/src/lib/game/combat/combat_turn.ts` (+ barrel) and `combat_turn_coordinator.ts` to `packages/shared/utils/src/lib/rules/` (+ `src/index.ts` export); refactor `combat_kernel.ts` `advanceTurn`/`checkActionCost` to delegate; add the coordinator unit tests and keep all C-509 tests green.
2. **Phase 2 (Engine driver + refactor)**: Add the per-world driver; remove module singletons and the implicit `_processEnemyTurn` call sites; wire AI/companion active-turn kicks; add `COMBAT_END_TURN` through `GameCommand` → `game_world` → `ecs_worker`; widen `ACTION_ECONOMY_CHANGED` in `types.ts`; update `turn_manager.test.ts` and `combat_sync.test.ts`.
3. **Phase 3 (UI)**: Widen the client `ActionEconomy` type; make the ViewModel `endTurn()` send the command; consume `TURN_CHANGED`/`ACTION_ECONOMY_CHANGED` (with `movementRemaining`) as the only turn-state source; fix the dev-sandbox `ActionEconomy` literals.
4. **Phase 4 (Validation)**: `bun run fix`, `bun moon run types:typecheck`, `bun moon run utils:test`, `bun moon run frontend-engine:test`, `bun moon run client:test`, `bun moon run e2e:test-client`, the `/game` E2E combat journey, and `bun moon run :validate`. Update the Execution Report.

## Edge Cases & Gotchas

- **Turn boundary off-by-one**: wrapping increments `round` only after the last eligible combatant; skipping defeated combatants must not double-count rounds.
- **Double-processing AI**: the previous implicit chain plus the new active-turn kick would make enemies act twice. Delete the implicit calls in the same change.
- **Defeat during a turn**: forced end must emit `combatEnded`/`COMBAT_ENDED` and stop the loop exactly once; victory rewards/XP unaffected.
- **Reactions disabled**: `spendBudget('reaction')` returns `noActionAvailable` until Combat-08; do not silently allow it. There is no `reactionUnavailable` code in the versioned `CombatInvalidReasonSchema` and this contract adds none — reuse `noActionAvailable`, matching the kernel's existing `checkActionCost`.
- **`ACTION_ECONOMY_CHANGED` compatibility**: the ViewModel and any sandbox listener must tolerate the added fields; keep `bonusActionAvailable` as an alias for one release. The dev sandbox (`combat_view_model.dev.svelte.ts`) and the client `ActionEconomy` type must be widened in the same change or `client:typecheck` fails.
- **Kernel budget-event deferral**: do **not** add a budget `CombatEvent` to `CombatEventSchema`. C-509 deferred it to Combat-03; adding it here changes a versioned union and can perturb the C-509 replay fixtures (`utils:test`, `frontend-engine:test`).
- **Retry**: `RETRY_ENCOUNTER` must reset only its world's coordinator state and seed; death-save state must not leak between attempts.
- **Auto-end policy**: default `manual` for the player and `auto_when_exhausted` for AI; an exhausted player turn is never force-advanced unless the policy says so.

## Open Questions

_Resolved at critique (2026-09-12) from codebase + architecture evidence; all three adopt the recommended option, and AC-2/AC-3 already encode them. No open blocker remains for `approved`._

- **Q1 — Should `endTurn` also auto-end the player's turn when all budgets are exhausted?** **Resolved: no — default `manual` for player-controlled combatants.** Architecture §9 permits advancement only on `endTurn`, exhaustion "under an explicit auto-end policy", defeat/incapacitation, or a rule-defined forced end. AC-2 already states this, and the `AutoEndPolicy` parameter keeps the option available for a later preference without changing ACs. Player combatants default to `manual`; AI combatants default to `auto_when_exhausted` (Edge Cases).
- **Q2 — Movement budget enforcement point.** **Resolved: Combat-02 owns the movement budget state and the spend API only; Combat-03 owns world-space endpoints, reachable areas, range/LoS previews, and per-combatant speed.** Justification: the C-509 schema already carries `TurnBudget.movementRemaining` and `advanceTurn` already resets it via `DEFAULT_MOVEMENT_PER_TURN`, so the field cannot be left unowned. ⚠️ Note the overlap with architecture §22, whose Combat-03 row also lists "movement budget" — the boundary above is the resolution: Combat-02 spends/accounts, Combat-03 makes it spatial and visible.
- **Q3 — `ACTION_ECONOMY_CHANGED` field migration.** **Resolved: add `movementRemaining` + `quickActionAvailable` to the engine `GameEvent` and keep `bonusActionAvailable` as a deprecated alias for one release.** Verified against the codebase: the only shape today is `packages/frontend/engine/src/types.ts:601–610`, the ViewModel's local `ActionEconomy` (`combat_enhancements.ts:78`) is app-local and trivially widened, and no consumer outside `client`/`frontend-engine` reads the event — no hard rename required.

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

Combat-02 is implemented: a pure, deterministic turn coordinator
(`packages/shared/utils/src/lib/rules/combat_turn_coordinator.ts`) now owns turn
order, round, the active turn, `turnId`, and the four-budget economy
(movement / action / quick / reaction), with its public types in
`packages/shared/types/src/lib/game/combat/combat_turn.ts`. `combat_kernel.ts`
delegates its turn advance and budget legality to the coordinator, so there is
exactly one turn/budget authority and all C-509 tests stay green.

A per-world engine driver (`packages/frontend/engine/src/combat/combat_turn_driver.ts`)
binds the coordinator to each ECS world (no module singletons), emits
`TURN_CHANGED` / `ACTION_ECONOMY_CHANGED` / `COMBAT_STATE_UPDATE`, runs AI and
companion turns from the active-turn kick, auto-skips stunned/defeated
combatants, and owns per-world death-save state. `turn_manager_system.ts` lost
every module-level turn/economy/death-save singleton and every implicit
`_processEnemyTurn` call inside player action resolution (the function itself is
deleted). `COMBAT_END_TURN` flows ViewModel → `game_world` → worker →
`endActiveTurn`, and `ACTION_ECONOMY_CHANGED` carries `movementRemaining` +
`quickActionAvailable` (with `bonusActionAvailable` retained as the deprecated
alias). The combat ViewModel no longer mutates turn state locally.

The one disclosed, scope-bounded gap is browser-level: the pre-existing C-500
E2E test seam mounts the combat overlay without starting ECS combat, so the E2E
cannot walk a full encounter to victory/defeat through real initiative order.
The E2E instead drives the production `TURN_CHANGED` / `ACTION_ECONOMY_CHANGED`
events over the shared engine bridge and asserts the four-budget readout, the
reachable End Turn control, the active-turn indicator moving Your Turn → Enemy
Turn → Your Turn purely from `TURN_CHANGED`, and the clean EXPLORE exit. The
engine-side loop is covered by integration tests on the production entry points.
Closing the browser loop needs a start-encounter capability that this contract
places in Combat-04.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `combat_turn_coordinator.test.ts` — 35 cases: order/tiebreak, `turnId`, round wrap, defeated skip, immutability, canonical-JSON determinism, custom movement allowance. |
| AC-2 | ✅ | Coordinator tests + `turn_manager.test.ts` C-514 block: attack/defend no longer move the turn or emit enemy logs; advancement only on explicit end / forced end / policy; `_processEnemyTurn` deleted from player action resolution. |
| AC-3 | ✅ | `spendBudget` reason codes (`movementBudgetExceeded`, `noActionAvailable`, `actorUnknown`), movement before and after the action, `ACTION_ECONOMY_CHANGED.movementRemaining` asserted on the engine path, and `spendActiveBudget` surfaces the typed reason. |
| AC-4 | ✅ | VM `endTurn()` sends exactly one `COMBAT_END_TURN` and mutates nothing locally; `game_world` + `ecs_worker` forward/dispatch it; the VM renders budgets from `ACTION_ECONOMY_CHANGED`; E2E asserts the End Turn control is reachable and the overlay survives the click. |
| AC-5 | ✅ | Engine test: two enemies resolve exactly once each, in initiative order, before the turn returns to the player; a stunned combatant is auto-skipped with exactly one `TURN_CHANGED` and takes no action. Companion turns run through the same driver kick. |
| AC-6 | ✅ | `combat_sync.test.ts` C-514 block: two worlds in one process keep independent turn streams/rounds; `resetCombatTurns(world)` clears only its world; death-save state is per world. |
| AC-7 | ✅ | Production `/game` combat mounts, renders the four-budget readout, keeps End Turn reachable and enabled, follows `ACTION_ECONOMY_CHANGED`, moves the active-turn indicator on `TURN_CHANGED`, and exits to EXPLORE with input restored and zero page errors (existing C-500 specs + the new C-514 spec, 4/4 E2E passed). Disclosed, scope-bounded limitation: the "full browser loop to victory/defeat through real initiative order" clause is not drivable through the C-500 test seam (it mounts the overlay without starting ECS combat; `initCombat` is reachable only from `RETRY_ENCOUNTER` and no start-encounter `GameCommand` exists). The loop itself is covered by engine integration tests on the production entry points; a browser start-encounter capability belongs to Combat-04. See Deviations. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/types/src/lib/game/combat/combat_turn.ts` | Coordinator public types (`TurnTrigger`, `CombatantTurnStatus`, `CombatTurnState`, `AutoEndPolicy`, `CombatBudgetCost`, `TurnTransition`, `ActiveTurnRef`, `SpendBudgetTransition`). |
| `packages/shared/utils/src/lib/rules/combat_turn_coordinator.ts` | Pure coordinator: `createTurnState` / `beginTurn` / `endTurn` / `spendBudget` / `getActiveTurn` / `isExhausted` / `getForcedEndReason` / `checkBudgetCost` / `defaultTurnBudget` / `turnIdFor` / `DEFAULT_MOVEMENT_PER_TURN`. |
| `packages/shared/utils/src/lib/rules/__tests__/combat_turn_coordinator.test.ts` | AC-1 + AC-3 unit coverage (35 cases). |
| `packages/frontend/engine/src/combat/combat_turn_driver.ts` | Per-world engine driver: `startCombatTurns` / `endActiveTurn` / `spendActiveBudget` / `getActiveTurn` / `getActiveBudget` / `setAutoEndPolicy` / `resetCombatTurns` / `hasCombatTurns` + per-world death-save API. |
| `packages/frontend/engine/src/__tests__/combat_turn_flow.test.ts` | The C-514 AC-2/AC-3/AC-5 engine cases plus the rewritten DEFEND / HP-floor tests, split out of `turn_manager.test.ts` for the size guard (see Post-verification remediation). |
| `packages/frontend/engine/src/combat/combat_bridge_types.ts` | The `COMBAT_END_TURN` command and widened `ACTION_ECONOMY_CHANGED` event payloads, composed into the `types.ts` unions by reference. |
| `packages/frontend/engine/src/combat/combat_command_dispatch.ts` | Worker-side combat `GameCommand` dispatch (`COMBAT_ACTION` / `COMBAT_ACTION_ANIMATE` / `COMBAT_END_TURN`). |
| `packages/frontend/engine/src/combat/combat_bridge_commands.ts` | `GameWorld` combat bridge-command registration (`COMBAT_ACTION`, `COMBAT_END_TURN`). |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/types/src/lib/game/combat/index.ts` | Re-export `./combat_turn`. |
| `packages/shared/utils/src/index.ts` | Re-export `./lib/rules/combat_turn_coordinator.ts`. |
| `packages/shared/utils/src/lib/rules/combat_kernel.ts` | Delegates `advanceTurn` + `checkActionCost` to the coordinator; `DEFAULT_MOVEMENT_PER_TURN` and `turnIdFor` now come from the coordinator. |
| `packages/shared/utils/src/lib/rules/__tests__/combat_kernel.test.ts` | Imports `DEFAULT_MOVEMENT_PER_TURN` from the coordinator (assertions unchanged). |
| `packages/frontend/engine/src/types.ts` | Adds the `COMBAT_END_TURN` `GameCommand`; widens the engine `ACTION_ECONOMY_CHANGED` `GameEvent` with `movementRemaining` + `quickActionAvailable` (keeps the deprecated `bonusActionAvailable` alias). |
| `packages/frontend/engine/src/game_world.ts` | Registers the `COMBAT_END_TURN` bridge command. |
| `packages/frontend/engine/src/worker/ecs_worker.ts` | Dispatches `COMBAT_END_TURN` to `advanceTurn`; passes the world to `resetTurnTracking`. |
| `packages/frontend/engine/src/systems/turn_manager_system.ts` | Removes the module singletons and implicit enemy chains; delegates to the driver; per-world death saves; `endCombat`/`resetTurnTracking` take a world; `_processEnemyTurn` deleted. |
| `packages/frontend/engine/src/__tests__/turn_manager.test.ts` | Rewrites the tests that encoded implicit chaining; adds C-514 AC-2/AC-3/AC-5 blocks. |
| `packages/frontend/engine/src/__tests__/combat_sync.test.ts` | Adds the C-514 AC-6 two-world isolation block. |
| `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` | `endTurn()` sends `COMBAT_END_TURN`; consumes the widened `ACTION_ECONOMY_CHANGED`. |
| `apps/frontend/client/src/lib/views/combat/types/combat_enhancements.ts` | `ActionEconomy` gains `movementRemaining` + `quickActionAvailable`. |
| `apps/frontend/client/src/lib/views/combat/combat_view_model.dev.svelte.ts` | Sandbox `ActionEconomy` literals widened. |
| `apps/frontend/client/src/lib/views/combat/components/turn_tracker_header.svelte` | Four-budget readout (Move N / Action / Quick / Reaction) + test ids. |
| `apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts` | Adds the C-514 AC-4 ViewModel block. |
| `apps/frontend/client/src/lib/views/combat/tests/turn_tracker.test.ts` | Fixtures widened. |
| `apps/frontend/client/src/routes/(dev)/dev/combat-enhancements/+page.svelte` | Sandbox fixtures widened; Quick toggle. |
| `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` | Test seam gains `emitCombatTurn` (production `TURN_CHANGED` + `ACTION_ECONOMY_CHANGED` shapes). |
| `apps/e2e/tests/client/combat.spec.ts` | Adds the C-514 AC-4/AC-7 production-overlay spec. |
| `scripts/src/lib/ops/guard_source_file_size_baseline.json` | 7 baselines lowered to the post-remediation sizes (no entry grew, none added). |

### Deviations from Spec

1. **`DEFAULT_MOVEMENT_PER_TURN` moved to the coordinator.** The kernel now
   delegates the turn reset, so the constant cannot live in the kernel without a
   circular import; re-exporting it from both modules would make
   `export * from './combat_kernel.ts'` and `export * from
   './combat_turn_coordinator.ts'` ambiguous in `@aikami/utils`. The single test
   that imported it from the kernel was re-pointed at the coordinator; the value
   and its assertions are unchanged.
2. **`endCombat(bridge, victory, world?)` and `resetTurnTracking(world?)`.** The
   C-338 signatures had no world, but turn state is per-world, so both gained an
   optional world. All production call sites pass it; a no-arg
   `resetTurnTracking()` is now a documented no-op (there is nothing global left
   to clear). This is the "keep a no-arg shim that delegates" option from AC-6,
   taken as far as the per-world model allows.
3. **`advanceTurn(world, bridge)` semantics widened.** It now means "end the
   current turn and resolve AI turns until a player turn is active or combat
   ends", because AI turns auto-end under `auto_when_exhausted`. The three
   existing `advanceTurn` tests that asserted a single `TURN_CHANGED` were
   rewritten to the explicit model.
4. **`isExhausted` ignores the reaction budget.** Reactions are disabled until
   Combat-08, so `reactionAvailable` is always `true`; counting it would make
   exhaustion unreachable and break the AI auto-end policy. Documented in the
   coordinator.
5. **`getForcedEndReason` accepts one status or the roster.** The declared
   signature takes a single `status`, but a `CombatOutcome` needs both teams, so
   it normalizes `CombatantTurnStatus | CombatantTurnStatus[]`.
6. **E2E observability additions.** The End Turn button and the budget-dot
   container gained `data-testid`s, and the composition-root test seam gained
   `emitCombatTurn`. AC-7's browser journey could not be closed without them
   because the C-500 seam (`__AIKAMI_TEST__.startCombat`) only pushes the
   overlay — it never starts ECS combat, so no real `COMBAT_STARTED` /
   `TURN_CHANGED` ever reaches the ViewModel. The E2E spec therefore drives the
   production event shapes over the shared engine bridge and asserts the
   readout, the control, and the clean exit. A full browser-driven
   victory/defeat loop needs a seam that starts real ECS combat; that is
   proposed as a follow-up rather than silently claimed.
7. **`runDownedTurn` hook.** The driver cannot import the turn manager, so the
   C-338 death-save turn is injected as an optional hook rather than moved.
   Behaviour is unchanged (the downed player keeps the turn after the save).

### Test Results

- Unit (utils): 265/265 PASS (baseline 230/230 → +35 new coordinator cases)
- Unit (frontend-engine): 1307/1310 PASS — 3 failures, all pre-existing
  (`Per-pack content audit (C-376 AC-6)`: missing emberwatch prop atlas files),
  0 new failures. Baseline was 1296/1299.
- Unit (client): 2917/2917 PASS (7 skipped, 2 todo); baseline 2913/2913 → +4 new AC-4 cases
- E2E (`e2e:test-client`, `tests/client/combat.spec.ts`): 4/4 PASS
  (setup + 2 pre-existing C-500 specs + the new C-514 spec)
- Typecheck/build: `validate({ test: true })` → 4 projects passed
  (client, e2e, frontend-engine, types, utils)
- Baseline: 3 pre-existing failures, 0 new failures

#### Notes on the verification environment

- `herdr_session` is not exposed as a tool or shell command in this session.
  Services are managed through `bun run herdr:start|restart <service>`; the
  client was restarted from this worktree (contract port 6990) and the
  `/game` route was exercised there.
- Playwright's own `webServer` entries cannot be reused under the pipeline's
  `PUBLIC_EMULATOR_PORT_OFFSET=1716` because the pre-existing specs hardcode
  `http://localhost:5274/game`; the suite was therefore run with the offset set
  to 0 and dev servers on 5274/5276/5280. Both the pre-existing C-500 specs and
  the new C-514 spec pass under that configuration. (Fixing the hardcoded URL is
  outside this contract's scope.)
- `moon` skips `frontend-engine:test` and `e2e:test-*` under `CI=true` because
  those tasks set `runInCI: false` (pre-existing on `main`); the engine suite was
  therefore run directly with `bun test` in `packages/frontend/engine`.
- The AI visual suite (`apps/e2e/src/visual/suites/combat.visual.ts`) needs a VLM
  provider and was not run. The header change is additive (one dot + label), and
  the rendered header was confirmed live in the browser.

#### Independent verification round

C-514 was independently verified and passed. The verifier re-ran `utils:test`
(265/265), the engine suite (1307/1310, 3 pre-existing emberwatch-asset
failures, 0 new), `client:test` (2917/2917), the E2E combat spec (4/4) and
`validate({ test: true })` (4 projects), and confirmed the four-budget readout,
the reachable End Turn control, budget updates from `ACTION_ECONOMY_CHANGED`, the
active-turn indicator following `TURN_CHANGED`, and the clean EXPLORE exit on the
real `/game` route in a live browser.

One verifier fix was applied and committed (`99a46105b`): the C-514 E2E spec now
asserts the active-turn indicator flips Your Turn -> Enemy Turn -> Your Turn
purely from `TURN_CHANGED`, with no local mutation, strengthening AC-4's
"observe the active-turn marker move" and AC-7's active-turn-indicator clause.
`e2e:typecheck` passes and the spec re-ran 4/4 green.

All suites were re-run on the post-fix HEAD for this handoff: `utils:test`
265/265, engine 1307/1310 (3 pre-existing failures), `client:test` 2917/2917,
E2E combat spec 4/4, `validate({ test: true })` 4 projects passed.

#### Post-verification remediation: source-file-size guard

The pipeline's pre-push gate (`bun moon run :fix` + `bun moon run :validate`) was
RED on `scripts:guard-source-file-size`, which ratchets files that were already
over the hard limit at bootstrap: a baselined file may not grow past its
recorded size, and a reduction must be locked in with `--update-baseline`.

Five baselined files had grown and two had shrunk. Rather than grant new
headroom, the C-514 additions were moved out of the oversized files (the
guard's stated intent) and the freed headroom was locked in:

| File | Before | After | Fix |
|---|---|---|---|
| `packages/frontend/engine/src/__tests__/turn_manager.test.ts` | 2167 (limit 1794) | 1701 | C-514 engine cases + the rewritten DEFEND / HP-floor tests moved to the new `combat_turn_flow.test.ts` |
| `packages/frontend/engine/src/types.ts` | 954 (limit 934) | 931 | `COMBAT_END_TURN` / `ACTION_ECONOMY_CHANGED` payloads moved to `combat/combat_bridge_types.ts` and composed by reference |
| `packages/frontend/engine/src/worker/ecs_worker.ts` | 2390 (limit 2379) | 2362 | combat command dispatch moved to `combat/combat_command_dispatch.ts` |
| `packages/frontend/engine/src/game_world.ts` | 2279 (limit 2270) | 2265 | combat bridge-command registration moved to `combat/combat_bridge_commands.ts` |
| `apps/frontend/client/src/lib/views/combat/combat_view_model.dev.svelte.ts` | 1096 (limit 1087) | 1084 | budget literals replaced by the shared `fullActionEconomy()` factory |
| `packages/frontend/engine/src/systems/turn_manager_system.ts` | 1924 (limit 2083) | 1924 | reduction locked in (`--update-baseline`) |
| `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` | 1801 (limit 1811) | 1801 | reduction locked in (`--update-baseline`) |

All five extractions are behaviour-preserving; the C-514 suites were re-run
afterwards (utils 265/265, engine 1307/1310 with only the 3 pre-existing
emberwatch-asset failures, client 2917/2917, E2E combat spec 4/4) and the guard
now passes with 51 baselined files and no expansion.

#### Remaining gate failure: `local-stack:lint` (environmental, not C-514)

With the size guard fixed the workspace-wide `:validate` proceeds further and
now stops on `local-stack:lint`, which is **not** fixable from this worktree:

```
local-stack:lint | FAIL - unit tests — see /tmp/aikami-local-stack-unit.log
local-stack:lint | 7 tests failed
local-stack:lint | error: 6.1 GB download needs 2.4 GB free — short by 3.7 GB on this volume.
```

Root cause: `apps/backend/local-stack/scripts/check.sh --static` runs
`bun stack/init.ts --yes`, whose AC-6 disk check aborts with exit 2 because the
host volume is full (`/dev/nvme0n1p2`: 929 G total, 880 G used, **2.3 G free**,
100%). All 7 failing unit tests are `stack/init.test.ts` prompt/plan/JSON cases
that fail for the same reason — `init` exits at the disk check before any prompt
or write.

This is independent of C-514: `git diff 3a5680e10..HEAD -- apps/backend/local-stack`
is empty, the plan size comes from an untouched manifest, and the check reads
the host's free space — it fails identically on `main` on this machine. The
remediation is to free ≥ 6.1 GB on the host volume (or run the gate on a machine
that has it); lowering or bypassing the AC-6 disk check would weaken a real
safety assertion and is out of this contract's scope.
