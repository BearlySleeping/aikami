---
id: C-509
title: "Contract C-509: Combat-01 — Versioned Combat Schemas and Pure Kernel Authority"
source: "docs/architecture/combat_2.md §22.1 — First contract recommendation"
contract_type: full
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-12T00:00:00Z"
---

# Contract C-509: Combat-01 — Versioned Combat Schemas and Pure Kernel Authority

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/architecture/combat_2.md` §22.1 — "Combat-01: Versioned combat schemas and pure kernel authority" |
| **Target** | `packages/shared/schemas/src/lib/game/combat/`, `packages/shared/types/src/lib/game/combat/`, `packages/shared/utils/src/lib/rules/`, `packages/frontend/engine/src/combat/` — versioned combat schemas + pure kernel facade + ECS projection adapter |
| **Type** | full |
| **Priority** | P1 — establishes the single mechanical authority every later Combat 2.0 slice depends on |
| **Dependencies** | C-500 (combat overlay + engine stall — prerequisite, `implemented`), C-336 (deterministic rules kernel + typed commands — `implemented`) |
| **Status** | approved |
| **Promotion** | `—` |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |
| **Production Surface** | `packages/frontend/engine/src/combat/combat_state_adapter.ts#snapshotCombatState` + `packages/shared/utils/src/lib/rules/combat_kernel.ts#resolveCombatCommand` (production engine/shared exports; not routed to a player-facing UI until Combat-04) |

## Problem & Baseline Evidence

- **Current behavior**: Aikami has **two parallel combat authorities** and no versioned combat contract.
  1. The pure kernel at `packages/shared/utils/src/lib/rules/rules_kernel.ts` resolves abstract dice/HP commands that carry **no entity identity, turn, initiative, action economy, or status data** (`resolveCommand`, `packages/shared/schemas/src/lib/game/rules_command.ts`).
  2. The engine re-implements hit/damage/resistance/status math independently inside `packages/frontend/engine/src/systems/turn_manager_system.ts` (2083 lines, e.g. damage math at lines 656–696 and 1749–1847). It never calls `resolveCommand`. Player commands chain synchronously into enemy processing (miss → `_processEnemyTurn` L679, hit → L736, defend → L569, multi-target → L867), and turn state/action economy live in module-level maps (`turnOrderList` L46, `currentTurnIndex` L47, `_actionEconomy` L64).
  3. There is **no combat state/command/event schema** (`packages/shared/schemas/src/lib/game/combat/` does not exist; the only version field is `MechanicalSnapshot.version` at `rules_command.ts:318`). Combat persistence and replay have no stable wire contract.
  4. Persistent IDs are raw bitECS entity IDs. The turn manager hardcodes the player as `eid === 1` (`turn_manager_system.ts:127, 160, 1966–1971`), so replay/save/entity-generation reuse cannot be made safe.

- **Reproduction**:
  1. `ls packages/shared/schemas/src/lib/game/combat/` → not found; no combat schemas exist.
  2. `rg "resolveCommand" packages/frontend/engine/src/systems/turn_manager_system.ts` → no results; the engine does not use the kernel.
  3. Start any encounter: `packages/frontend/engine/src/systems/encounter_system.ts:204–216` only emits `COMBAT_STARTED`; `initCombat` has no production caller except `RETRY_ENCOUNTER` (`packages/frontend/engine/src/worker/ecs_worker.ts:648–655`), and `handleCombatAction` no-ops when turn order is empty (`packages/frontend/engine/src/systems/turn_manager_system.ts:389–391`).
  4. `rg "combatantId|CombatState" packages/shared/` → no results; no stable combat identity exists.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | mulberry32 `SeedableRng` + `serializeRng`/`deserializeRng` | `packages/shared/utils/src/lib/rng/seedable_rng.ts` (API L17–96) |
  | Generic pure kernel + replay log pattern | `packages/shared/utils/src/lib/rules/rules_kernel.ts` (`resolveCommand` L293, `replayCommandLog` L315) |
  | Discriminated-union TypeBox pattern | `packages/shared/schemas/src/lib/game/rules_command.ts` (`RulesCommandSchema` L169) and `npc_dialogue_command.ts` |
  | Damage type + resistance schemas | `packages/shared/schemas/src/lib/game/damage_type.ts` (`DamageTypeKeySchema` L13, `DamageResistanceProfileSchema` L45) |
  | Status effect schemas | `packages/shared/schemas/src/lib/game/status_effect.ts` (`ActiveStatusEffectSchema` L88) |
  | ECS combat components | `packages/frontend/engine/src/components/combat_stats.ts` (`CombatStats` L10), `turn_order.ts` (`TurnOrder` L10), `status_effects.ts`, `resistances.ts` |
  | ECS snapshot serializer | `packages/shared/schemas/src/lib/game/ecs_snapshot.ts`, C-117 |
  | GOAP combat tactics (fallback authority later) | `packages/frontend/engine/src/systems/goap_combat_tactics_system.ts` (C-197) |
  | Engine bridge pattern | `packages/frontend/engine/src/engine_bridge.ts` |

- **Known gaps**:
  1. No versioned `CombatState` with `schemaVersion`/`rulesVersion`/`stateRevision`.
  2. No typed `CombatCommand`/`CombatEvent`/validation schema for mechanical combat.
  3. No combat-aware pure kernel (`getLegalActions`/`validate`/`resolve`/`replay`) — the current kernel cannot resolve a move, attack, defend, wait, or end-turn.
  4. RNG is a single opaque engine stream (`_activeRng` L315), not named serializable substreams; adding an unrelated roll perturbs every later roll.
  5. Stable combatant IDs distinct from bitECS entity IDs do not exist.
  6. No ECS read/apply projection, so kernel results cannot be applied to the live world without a second authority.

- **Baseline tests** (run before starting):
  - `packages/shared/utils/src/lib/rules/__tests__/rules_kernel.test.ts` — kernel determinism/replay.
  - `packages/shared/utils/src/lib/rng/__tests__/seedable_rng.test.ts` — RNG sequence + serialization.
  - `packages/shared/schemas/src/lib/game/rules_command.test.ts` — command schema validation.
  - `packages/frontend/engine/src/__tests__/turn_manager.test.ts` (L83+, L451+, L1340+) and `replay_fixture.test.ts` (L14–235).
  - `bun moon run utils:test`, `bun moon run schemas:test`, `bun moon run frontend-engine:test`.

## User Outcome

After this contract, a developer can create a versioned combat snapshot, resolve move / basic-attack / defend / wait / end-turn commands through one pure deterministic kernel (with explicit RNG substreams), apply the kernel's result to the live ECS world through a projection adapter, and replay the same initial snapshot + rules version + seed + command log to byte-equivalent events and final state — all without any player-facing UI change and without touching legacy combat.

## Success Measures

- **Time/latency target**: `resolveCombatCommand` under 8 ms for an ordinary action; replay of a 50-command log under 50 ms (architecture §18).
- **Offline/degraded behavior**: The kernel is 100% local and pure — zero network, AI, ECS, database, or `Math.random()` dependency. AI/network absence cannot change mechanical output.
- **Production journey enabled**: None yet — this contract builds the seam. Production combat remains on the legacy path until Combat-04; the adapter is production engine code but is not wired to a route or UI in this contract.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Seedable RNG + serialization | `packages/shared/utils/src/lib/rng/seedable_rng.ts` | reuse |
| Generic pure kernel + replay | `packages/shared/utils/src/lib/rules/rules_kernel.ts` | modify — add a combat facade beside it; do not change generic command behavior |
| Command/event TypeBox pattern | `packages/shared/schemas/src/lib/game/rules_command.ts` | reuse pattern |
| Damage type + resistance schemas | `packages/shared/schemas/src/lib/game/damage_type.ts` | reuse |
| Status effect schemas | `packages/shared/schemas/src/lib/game/status_effect.ts` | reuse (definitions only; application deferred) |
| ECS combat components | `packages/frontend/engine/src/components/{combat_stats,turn_order,status_effects,resistances}.ts` | modify — add read/apply adapter + a stable `CombatIdentity` component |
| ECS snapshot serializer | `packages/shared/schemas/src/lib/game/ecs_snapshot.ts` (C-117) | reuse conventions |
| Legacy turn manager | `packages/frontend/engine/src/systems/turn_manager_system.ts` | do not modify — legacy path stays live and untouched |
| GOAP combat tactics | `packages/frontend/engine/src/systems/goap_combat_tactics_system.ts` | out of scope (consumed by Combat-06) |
| Feature flags | `packages/shared/constants/src/lib/feature_flags.ts` | out of scope — `combatEngine` flag is introduced in Combat-04 |
| Authored encounter IDs (`spawnId`, `encounterId`) | `packages/frontend/engine/src/components/enemy.ts` (`spawnId` L22, `encounterId` L27) | reuse — preferred source for an encounter-spawned `combatantId` (resolves Open Question Q1) |
| Companion authored ID (`npcId`) | `packages/frontend/engine/src/components/companion.ts` (`npcId` L17) | reuse — preferred source for a companion `combatantId` |
| String registry + text handles | `packages/frontend/engine/src/services/string_registry_service.ts`, `packages/frontend/engine/src/components/text_identity.ts` (C-195) | reuse — display-name resolution only; `combatantId` follows the authored-ID pattern (`spawnId`/`npcId`), not a registry handle |
| Persistent-component allowlist | `packages/frontend/engine/src/serialization/ecs_serializer.ts` (`PERSISTENT_COMPONENTS` L32) | do not modify — `CombatIdentity` is not persisted in Combat-01 |

## Overview

Combat-01 creates the versioned, deterministic mechanical core that every later Combat 2.0 slice depends on. It adds TypeBox schemas for `CombatState`, `CombatCommand`, `CombatEvent`, and validation results under the shared packages, then expands the pure rules area with a combat kernel facade that validates and resolves a deliberately bounded command set (move, basic attack via `useAbility`, defend, wait, end-turn). It introduces stable combatant IDs distinct from bitECS entity IDs, makes RNG state explicit and serializable as named substreams, and adds an engine-side read/apply adapter that projects the ECS world into a `CombatState` and applies kernel results back exactly once. Natural language, LLM decisions, reactions, cover, and improvised actions are explicitly excluded.

## Design Reference

- **Governing architecture**: `docs/architecture/combat_2.md` — §6.2 (repository placement), §8 (domain model), §9 (turn model seed), §15 (kernel API), §17 (determinism/replay/observability), §18 (budgets), §22.1 (this contract's scope), §25 (decisions required before approval).
- **Schema pattern**: mirror `packages/shared/schemas/src/lib/game/rules_command.ts` — discriminated `Type.Union` on `kind`, `additionalProperties: false` on every object, `Static<>` types in `@aikami/types`.
- **Kernel pattern**: mirror `packages/shared/utils/src/lib/rules/rules_kernel.ts` — pure functions, snapshot-in / `{ newState, events }`-out, no engine/client imports; RNG advanced by the caller.
- **ECS conventions**: follow the packed SoA component + observers pattern in `packages/frontend/engine/src/components/combat_stats.ts`. Stable authored IDs already exist on `Enemy` (`spawnId`, `encounterId`) and `Companion` (`npcId`); `combatantId` derives from those. The C-195 string registry (`services/string_registry_service.ts`, `components/text_identity.ts`) is reused for name resolution only — it is a text-handle store, not an identity source.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Shared TypeBox schemas**: `packages/shared/schemas/src/lib/game/combat/` — `CombatStateSchema`, `CombatCommandSchema`, `CombatEventSchema`, `CombatValidationResultSchema`, `CombatReplaySchema`, plus their sub-schemas.
- **Derived domain types**: `packages/shared/types/src/lib/game/combat/` — `Static<>` aliases re-exported from `@aikami/types`.
- **Pure rules implementation**: `packages/shared/utils/src/lib/rules/combat_kernel.ts` — stable combat-kernel facade (`createCombatState`, `validateCombatCommand`, `resolveCombatCommand`, `replayCombat`, `findFirstCombatDivergence`) built on the existing RNG and kernel utilities. It must import **only** shared packages; never `@aikami/engine`, client code, ECS, network, or AI. If it imports `typebox` directly or adds a runtime `@aikami/schemas` import, declare that dependency in `packages/shared/utils/package.json`.
- **ECS snapshot/apply adapter**: `packages/frontend/engine/src/combat/combat_state_adapter.ts` — `snapshotCombatState(world, options)` and `applyCombatResult(world, previousState, result)`. `options` must carry the inputs `CombatState` needs but the ECS does not hold: `encounterId`, `rulesVersion`, `abilityCatalog`, and the caller-supplied player `combatantId` (exact shape finalized by the implementer). The adapter projects and applies; it must not recalculate rules, hit chance, or legality, and it no-ops when `result.valid === false`.
- **Stable identity**: add `packages/frontend/engine/src/components/combat_identity.ts` — a `CombatIdentity` SoA component with a `combatantId: string[]` field plus `registerCombatIdentityObservers`, following `components/enemy.ts` (`spawnId`/`encounterId`) and `components/combat_stats.ts` (`classId`). Export it from `src/sim.ts` with the other components. The adapter owns a `combatantId ↔ runtime eid` map; raw eids never appear in a `CombatState` or a replay artifact.
- **No persistence change**: do not add `CombatIdentity` to `PERSISTENT_COMPONENTS` in `packages/frontend/engine/src/serialization/ecs_serializer.ts` (L32) and do not bump `CURRENT_SNAPSHOT_VERSION`.
- **New files get a barrel export** in `packages/shared/schemas/src/index.ts`, `packages/shared/types/src/index.ts`, and (if exported) `packages/shared/utils/src/index.ts` / `packages/frontend/engine/src/sim.ts`, following the existing alphabetical `export *` blocks.
- No new package is created; no production route, overlay, ViewModel, or `GameCommand`/`GameEvent` variant is changed in this contract.

## State & Data Models

Conceptual shapes; final TypeBox schemas live in the shared packages per the directives above. Use `type` aliases only.

```ts
// ── Shared primitives ──

type GridPoint = { x: number; y: number }; // integers; quantized tactical cells (architecture §25.1)
type RangeBand = 'melee' | 'reach' | 'ranged';
type CombatPhase = 'starting' | 'active' | 'ended';

type TurnBudget = {
  movementRemaining: number;
  actionAvailable: boolean;
  quickActionAvailable: boolean;
  reactionAvailable: boolean; // present, unused in Combat-01
};

type SerializedRng = { seed: number; state: number };

type CombatRngState = {
  seed: number;
  streams: {
    initiative: SerializedRng;
    actions: SerializedRng;
    loot: SerializedRng; // named substreams (architecture §25.3)
  };
};

// ── Combatant / ability ──

type CombatAbilityDefinition = {
  abilityId: string;
  name: string;
  kind: 'melee_attack' | 'ranged_attack' | 'defend' | 'utility';
  actionCost: 'action' | 'quick' | 'reaction' | 'free';
  attackBonus: number;
  damageDice: string | null; // "1d8"; null for non-damage abilities
  damageType: DamageTypeKey | null;
  rangeCells: number;
  requiresLineOfSight: boolean;
};

type CombatantState = {
  combatantId: string; // stable, non-ECS
  name: string;
  team: 'player' | 'ally' | 'enemy' | 'neutral';
  position: GridPoint;
  hp: number;
  maxHp: number;
  armorClass: number;
  attackBonus: number;
  initiative: number;
  abilityIds: string[];
  budget: TurnBudget;
  downed: boolean;
  defeated: boolean;
};

type InitiativeState = {
  order: string[]; // combatantIds, sorted at createCombatState
  activeIndex: number;
};

type BattlefieldState = {
  width: number;
  height: number;
  blockedCells: GridPoint[]; // cell-level blocked/walkable projection
};

type CombatObjectiveState = {
  objectiveId: string;
  kind: string;
  status: 'pending' | 'complete' | 'failed';
};

type CombatOutcome = { victory: boolean; reason: string };

// ── Versioned combat state ──

type CombatState = {
  schemaVersion: number; // 1
  rulesVersion: string; // e.g. "combat-2.0.0"
  encounterId: string;
  stateRevision: number; // monotonic; +1 per successful resolve
  round: number;
  phase: CombatPhase;
  turnId: string | null; // deterministic, non-random (e.g. `r{round}:{combatantId}`)
  rng: CombatRngState;
  initiative: InitiativeState;
  combatants: Record<string, CombatantState>;
  abilityCatalog: Record<string, CombatAbilityDefinition>; // self-contained rules input
  battlefield: BattlefieldState;
  objectives: CombatObjectiveState[];
  outcome: CombatOutcome | null;
};

// Deliberate narrowing of architecture §8.1, recorded so implementers do not
// "restore" it: `phase` omits `'reaction'` (reactions are Combat-08) and the flat
// `seed`/`rngState` pair is replaced by the named-substream `rng` object (§25.3).
// Every other §8.1 field is present.
```

```ts
// ── Commands (Combat-01 bounded vocabulary; explicit variants, never a patch object) ──

type CombatCommand =
  | { kind: 'move'; combatantId: string; path: GridPoint[] }
  | { kind: 'useAbility'; combatantId: string; abilityId: string; targetIds: string[] }
  | { kind: 'defend'; combatantId: string }
  | { kind: 'wait'; combatantId: string }
  | { kind: 'endTurn'; combatantId: string };
```

`interact`, `disengage`, and `respondToReaction` from architecture §8.4 are explicitly deferred (interactions/improvised actions → Combat-07; reactions → Combat-08). The `useAbility` variant plus a `basic_melee` catalog entry is the "basic attack".

```ts
// ── Events (facts; the ECS/UI/narration integration surface) ──

type CombatEventEnvelope = {
  encounterId: string;
  turnId: string;
  stateRevision: number; // revision of the state this event produced
  round: number;
};

type CombatEvent =
  | (CombatEventEnvelope & { kind: 'turnStarted'; combatantId: string })
  | (CombatEventEnvelope & {
      kind: 'movementCommitted';
      combatantId: string;
      path: GridPoint[];
      movementCost: number;
      movementRemaining: number;
    })
  | (CombatEventEnvelope & {
      kind: 'attackRolled';
      attackerId: string;
      targetId: string;
      abilityId: string;
      naturalRoll: number;
      totalRoll: number;
      hit: boolean;
      isCriticalHit: boolean;
    })
  | (CombatEventEnvelope & {
      kind: 'damageApplied';
      attackerId: string;
      targetId: string;
      amount: number;
      damageType: DamageTypeKey;
      hpAfter: number;
      downed: boolean;
    })
  | (CombatEventEnvelope & { kind: 'combatantDowned'; combatantId: string })
  | (CombatEventEnvelope & { kind: 'combatantDefeated'; combatantId: string })
  | (CombatEventEnvelope & { kind: 'turnEnded'; combatantId: string })
  | (CombatEventEnvelope & { kind: 'combatEnded'; victory: boolean; reason: string });
```

```ts
// ── Validation ──

type CombatInvalidReason =
  | 'invalidCommandShape'
  | 'encounterEnded'
  | 'staleRevision'
  | 'notActiveCombatant'
  | 'actorUnknown'
  | 'abilityUnknown'
  | 'abilityNotAvailable'
  | 'noActionAvailable'
  | 'targetInvalid'
  | 'targetDefeated'
  | 'targetOutOfRange'
  | 'movementBudgetExceeded'
  | 'pathBlocked'
  | 'pathInvalid';

type CombatValidationResult =
  | { valid: true; normalizedCommand: CombatCommand }
  | { valid: false; reasonCode: CombatInvalidReason; messageKey: string };
```

```ts
// ── Kernel facade (pure; inputs are never mutated) ──

type ResolveCombatResult =
  | { valid: true; state: CombatState; events: CombatEvent[] }
  | { valid: false; reasonCode: CombatInvalidReason; messageKey: string };

type CombatReplay = {
  replayVersion: number;
  rulesVersion: string;
  initialState: CombatState;
  commands: CombatCommand[];
  events: CombatEvent[];
  finalState: CombatState | null; // null when the log aborted on an invalid command
};

type ReplayCombatResult = { replay: CombatReplay; finalState: CombatState | null };

// Exported functions:
//   createCombatState(input): CombatState
//   validateCombatCommand(input: { state; command; basedOnRevision?: number }): CombatValidationResult
//   resolveCombatCommand(input: { state; command; basedOnRevision?: number }): ResolveCombatResult
//   replayCombat(input: { initialState; rulesVersion; commands }): ReplayCombatResult
//   findFirstCombatDivergence(a: CombatReplay, b: CombatReplay): { stateRevision: number; eventIndex: number } | null  // dev/test helper
```

`resolveCombatCommand` validates first and returns the same discriminated shape as `CombatValidationResult`; on `valid: false` it returns the reason and leaves the caller's state untouched — no partially-updated state is ever returned, and validation never throws. On success it mutates nothing, increments `stateRevision` by exactly 1, advances only the relevant RNG substream, and returns new events. `basedOnRevision` is optional and is the **only** input that can produce `staleRevision`: omitted means "validate against the current revision" (never `staleRevision`); supplied and mismatched means reject with the state unchanged. `replayCombat` reconstructs events and final state from `initialState` + `rulesVersion` + `commands` alone; it aborts at the first invalid command and returns `finalState: null` with the events produced up to that point.

```ts
// ── ECS adapter (engine-side projection, not an authority) ──

type CombatantIdMap = {
  toEntityId(combatantId: string): number | null;
  toCombatantId(entityId: number): string | null;
};

// snapshotCombatState(world, options): CombatState
// applyCombatResult(world, previousState: CombatState, result: ResolveCombatResult): void
```

## Quality Requirements

- **Offline/degraded mode**: The kernel and schemas are pure local TypeScript — zero network/AI/ECS/Database dependencies. Combat-01 has no AI code path at all; the absence of a provider cannot affect mechanical output.
- **Accessibility/input**: N/A — no UI or input surface is touched.
- **Performance budget**: `resolveCombatCommand` < 8 ms per ordinary action; 50-command replay < 50 ms; no work inside any render/frame loop.
- **Security/privacy**: Every schema uses `additionalProperties: false` and bounded integers; `stateRevision`/`rulesVersion` reject stale or mismatched input; combatant IDs are stable authored/encounter IDs, never untrusted text or raw eids; no model output is accepted in this contract.
- **Persistence/migration**: N/A — no persistent state is written or read, and `CombatIdentity` is deliberately not added to `PERSISTENT_COMPONENTS` (`packages/frontend/engine/src/serialization/ecs_serializer.ts` L32), so the ECS snapshot wire format and `CURRENT_SNAPSHOT_VERSION` are unchanged and legacy saves stay readable. Schemas are versioned (`schemaVersion`, `rulesVersion`, `replayVersion`) so a future save/replay slice can migrate.
- **Cancellation/retry/idempotency**: `resolveCombatCommand` is a pure function (same inputs → same output). A committed plan is applied at most once: `applyCombatResult` is guarded by `previousState.stateRevision` and rejects re-application.
- **Observability**: The kernel returns structured `reasonCode`/`messageKey` validation results and event envelopes carrying `stateRevision`/`turnId`/`encounterId`; the kernel never logs or performs I/O. Callers log via `$logger`.

## Migration & Rollback

- **Old data compatibility**: N/A — no existing save, route, or persisted structure is modified. Legacy combat continues to run through `turn_manager_system.ts` untouched.
- **Migration**: none required.
- **Rollback**: delete the new shared combat modules and the engine adapter; no production caller depends on them in this contract.
- **Feature flag or kill switch**: none in this contract. The `combatEngine: 'legacy' | 'v2'` encounter-start flag is introduced in Combat-04 (§22.2).
- **Failure recovery**: N/A — additive pure code with no migration step; a validation failure returns a typed result rather than throwing.

## Scope Boundaries

- **In Scope:**
  - Versioned TypeBox schemas for `CombatState`, `CombatCommand`, `CombatEvent`, validation results, and replay artifacts under `packages/shared/schemas/src/lib/game/combat/` + derived types in `packages/shared/types/src/lib/game/combat/`.
  - Pure combat kernel facade (create/validate/resolve/replay/divergence) in `packages/shared/utils/src/lib/rules/`, resolving move, `useAbility` basic attack, defend, wait, and end-turn.
  - Explicit serializable RNG with named `initiative`/`actions`/`loot` substreams.
  - Stable `combatantId` values distinct from bitECS entity IDs, with a `CombatIdentity` ECS component and `combatantId ↔ eid` map.
  - ECS read (`snapshotCombatState`) and apply (`applyCombatResult`) adapter in `packages/frontend/engine/src/combat/`, without replacing production combat.
  - Unit/integration tests proving schema validation, kernel legality, budget conservation, immutability, RNG-substream isolation, replay equivalence, and adapter projection.

- **Out of Scope:**
  - Natural-language intent, LLM/companion/enemy decisions, narration (Combat-05/06).
  - Reactions, cover, line-of-sight/forecast previews, movement budget UI (Combat-03/08).
  - Object affordances, improvised actions, surfaces, status application (Combat-07).
  - Objectives/morale mechanics beyond the presence of an (empty-allowed) `objectives` array.
  - Any production route, overlay, ViewModel, `GameCommand`/`GameEvent` variant, or `combatEngine` feature-flag wiring (Combat-04).
  - Modifying `turn_manager_system.ts`, `goap_combat_tactics_system.ts`, or the existing generic `resolveCommand` behavior.
  - Bundling `CombatAction`/`ATTACK|DEFEND|FLEE` freeform classification into the kernel.
  - Kernel `getLegalActions` / `compile` / `forecast` (architecture §15) — the legal-endpoint and preview surface is Combat-03; Combat-01 exposes create/validate/resolve/replay only.
  - A budget/action-spent `CombatEvent` for `defend`/`wait` — deferred until a UI consumes it (Combat-03).
  - Persisting `CombatIdentity`: `PERSISTENT_COMPONENTS` in `packages/frontend/engine/src/serialization/ecs_serializer.ts` and `CURRENT_SNAPSHOT_VERSION` stay untouched, so the ECS snapshot wire format is unchanged.
  - Status-effect *application* (schema reuse only), damage reduction from `CombatStats.defense`, and any `loot` substream consumption beyond its existence in `rng`.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** One outcome — one deterministic authority owns combat mechanics. Schemas, kernel, identity, RNG, and the ECS projection are inseparable parts of that single seam; splitting them would leave the repo mid-extraction with two competing authority paths. 7 ACs, 4 affected projects (moon projects `schemas`, `types`, `utils`, `frontend-engine`), no UI. **Size: ok — proceed as one contract.**

## Acceptance Criteria

### AC-1: Versioned combat schemas are defined and validated
**Given** no combat state/command/event schemas exist in the shared packages
**When** `CombatStateSchema`, `CombatCommandSchema`, `CombatEventSchema`, and `CombatValidationResultSchema` are defined under `packages/shared/schemas/src/lib/game/combat/` with derived types under `packages/shared/types/src/lib/game/combat/`
**Then** `Value.Check` accepts valid conforming data; rejects unknown `kind` values, unknown extra properties, out-of-range integers, and missing `schemaVersion`/`rulesVersion`; and no schema exposes a raw ECS entity-id field.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/schemas/src/lib/game/combat/combat_state.test.ts` | `packages/shared/schemas/src/lib/game/combat/` + tooling: `bun moon run schemas:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run schemas:test`
- Integration: import `CombatState`/`CombatCommand` from `@aikami/types` — type-check passes.
- E2E / Visual: N/A — schemas only.

**Watch Points**:
- Follow `rules_command.ts` exactly: `Type.Union` of `Type.Object` variants, `kind` literal on each, `additionalProperties: false`.
- `damageDice` uses the existing `^\d+d\d+(\+\d+)?$` pattern; `damageType` reuses `DamageTypeKeySchema`.
- Version fields are required integers/strings, not optional.

### AC-2: Pure kernel resolves the bounded command set deterministically
**Given** a valid `CombatState` with an active combatant and a `basic_melee` ability in `abilityCatalog`
**When** `move`, `useAbility`, `defend`, `wait`, and `endTurn` commands are resolved
**Then** movement decrements `movementRemaining` by path length and emits `movementCommitted`; `useAbility` rolls attack on the `actions` substream, clamps damage at 0 HP, and emits `attackRolled` (with `hit: false` on a miss) followed by `damageApplied`/`combatantDowned`/`combatantDefeated` as applicable; `defend` and `wait` consume the action and emit **no** event (their only observable effect is the resulting `budget` — a budget/action event is deferred to Combat-03); `endTurn` advances the active index (skipping defeated combatants, incrementing `round` on wrap) and emits `turnEnded`/`turnStarted`; `stateRevision` increases by exactly 1 per success; and invalid commands return `{ valid: false, reasonCode, messageKey }` with the caller's state unchanged.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/shared/utils/src/lib/rules/__tests__/combat_kernel.test.ts` | `packages/shared/utils/src/lib/rules/combat_kernel.ts#resolveCombatCommand` + tooling: `bun moon run utils:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`
- Integration: table-driven cases for each command × each invalid reason.
- E2E / Visual: N/A.

**Watch Points**:
- Input state must never be mutated — assert deep equality before/after (frozen object recommended).
- Budget conservation: a command requiring an unavailable action returns `noActionAvailable`; movement beyond budget returns `movementBudgetExceeded`.
- `endTurn` must not run every enemy turn implicitly (that implicit coupling is removed in Combat-02).
- Performance budget: assert `resolveCombatCommand` and a 50-command `replayCombat` stay inside the §18 budgets (8 ms / 50 ms) using `performance.now()` with a generous CI tolerance (e.g. 5×) — a hard wall-clock assert is flaky, so record the measured values in the Execution Report.
- Invalid-command path: `resolveCombatCommand` returns `{ valid: false, … }`, never a partially-updated state and never a thrown error.

### AC-3: Stable combatant IDs are distinct from bitECS entity IDs
**Given** the ECS adapter maps `combatantId ↔ runtime eid` via a stable `CombatIdentity` component
**When** an entity is despawned and its eid is recycled to a different combatant, and when a `CombatState` is serialized and deserialized
**Then** lookups resolve to the correct combatant, a recycled eid never maps to a stale combatant ID, no `CombatState`/replay field contains a raw eid, and `combatantId` values derive from authored IDs already on the entity (`Enemy.spawnId`/`Enemy.encounterId` for encounter spawns, `Companion.npcId` for companions) or from the caller-supplied campaign character ID for the player, rather than from a freshly invented scheme where an authored ID exists.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `packages/frontend/engine/src/__tests__/combat_state_adapter.test.ts` | `packages/frontend/engine/src/combat/combat_state_adapter.ts#snapshotCombatState` + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test` — `packages/frontend/engine/moon.yml` sets `options.runInCI: false` for this task, so this artifact must be exercised by the contract's own Phase 4 run, not only by CI.
- Integration: spawn → snapshot → despawn/recycle → re-snapshot; assert identity integrity.
- E2E / Visual: N/A — no player-facing surface.

**Watch Points**:
- Remove map entries on despawn; never reuse a retired `combatantId`.
- bitECS `eid` generation/reuse is the concrete failure mode (architecture §8.1).

### AC-4: RNG state is explicit, serializable, and substream-isolated
**Given** named `initiative`, `actions`, and `loot` substreams in `CombatState.rng`
**When** an action consumes randomness on the `actions` substream, then an unrelated change causes an `initiative` roll, on the same seed
**Then** the `actions` substream sequence is byte-identical in both runs; `serializeRng`/`deserializeRng` round-trips each substream and resumes at the exact position; and `CombatState` JSON captures seed + all substream states.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `packages/shared/utils/src/lib/rules/__tests__/combat_kernel.test.ts` | `packages/shared/utils/src/lib/rules/combat_kernel.ts#resolveCombatCommand` + tooling: `bun moon run utils:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`
- Integration: assert substream isolation across mutated sibling streams; resume from serialized state.
- E2E / Visual: N/A.

**Watch Points**:
- Do not replace the existing generic `SeedableRng`; derive substreams from the encounter seed deterministically.
- Serialization must capture internal state (not just seed) — reuse `serializeRng`/`deserializeRng`.

### AC-5: Replay equivalence and immutability are proven
**Given** an initial `CombatState`, a `rulesVersion`, a seed, and an ordered `CombatCommand[]` log
**When** `replayCombat` runs twice and `findFirstCombatDivergence` compares the two replays
**Then** events and final state are byte-equivalent (canonical stable JSON), the first replay's result can be mutated without affecting the second, and a deliberately divergent (e.g. appended/omitted) command log reports the first divergent `{ stateRevision, eventIndex }`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `packages/shared/utils/src/lib/rules/__tests__/combat_replay.test.ts` | `packages/shared/utils/src/lib/rules/combat_kernel.ts#replayCombat` + tooling: `bun moon run utils:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`
- Integration: run replay twice, diff canonical JSON; corrupt a copy and assert divergence reporting.
- E2E / Visual: N/A.

**Watch Points**:
- Compare with a canonical stringify (sorted keys); never rely on `JSON.stringify` key order.
- Narration (absent here) must never enter the replay artifact.

### AC-6: The ECS adapter is a projection, not a second authority
**Given** a live ECS combat world built from existing `CombatStats`/`TurnOrder`/position components
**When** the adapter snapshots state, invokes the kernel, and applies the result
**Then** `CombatStats` HP and positions are updated solely from the kernel output, the adapter performs no independent hit/damage/legality calculation, `applyCombatResult` no-ops when `result.valid === false`, applying the same result twice does not double-apply (revision guard), the snapshot field mapping is explicit and documented (`health`→`hp`, `maxHealth`→`maxHp`, `evasion`→`armorClass`, `accuracy`→`attackBonus`, `initiative`→`initiative`; `CombatStats.defense` has no Combat-01 kernel counterpart and must be recorded as unmapped rather than silently invented), and legacy production combat behavior is unchanged.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Integration | `packages/frontend/engine/src/__tests__/combat_state_adapter.test.ts` | `packages/frontend/engine/src/combat/combat_state_adapter.ts#applyCombatResult` + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test` — `options.runInCI: false` in `packages/frontend/engine/moon.yml`; run it in Phase 4.
- Integration: snapshot → resolve attack → apply → assert HP equals kernel `hpAfter`; re-apply rejected; a `valid: false` result leaves the world untouched.
- E2E / Visual: N/A — no routed surface; run the existing `turn_manager.test.ts` to prove legacy is untouched.

**Watch Points**:
- Do not import kernel functions from inside `turn_manager_system.ts`; the adapter is a separate seam.
- Apply a state diff derived from the kernel result, never a re-derived diff.

### AC-7: Kernel purity boundary holds
**Given** the combat kernel module
**When** a dependency-boundary test inspects its imports and the test suite runs with no AI/network available
**Then** the kernel imports only shared packages (`typebox`, `@aikami/schemas`, `@aikami/types`, shared RNG/utils) and contains no references to `@aikami/engine`, client packages, `fetch`, ECS, or `Math.random`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit | `packages/shared/utils/src/lib/rules/__tests__/combat_kernel_purity.test.ts` | `packages/shared/utils/src/lib/rules/combat_kernel.ts` + tooling: `bun moon run utils:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run utils:test`
- Integration: static import scan of the kernel source plus a run with the network/AI layer absent.
- Dependency hygiene: if the kernel imports `typebox` directly or adds a runtime `@aikami/schemas` import, declare it in `packages/shared/utils/package.json` — neither is declared today, although `src/lib/rules/character_sheet.ts` already imports `@aikami/schemas`.
- E2E / Visual: N/A.

**Watch Points**:
- `packages/frontend/engine` must never be imported from shared utils (would drag the engine into every consumer).
- Assert absence of `Math.random` and `crypto.getRandomValues` in the kernel path.

## Implementation Sequence

1. **Phase 1 (Schemas & types)**: Add `packages/shared/schemas/src/lib/game/combat/` (`combat_state.ts`, `combat_command.ts`, `combat_event.ts`, `combat_validation.ts`, `combat_replay.ts`) and `packages/shared/types/src/lib/game/combat/`; barrel-export both. Add schema validation tests (AC-1).
2. **Phase 2 (Kernel)**: Add `packages/shared/utils/src/lib/rules/combat_kernel.ts` with `createCombatState`, `validateCombatCommand`, `resolveCombatCommand`, `replayCombat`, `findFirstCombatDivergence`. Add kernel/legal/reason tables, RNG-substream, replay, and purity tests (AC-2, AC-4, AC-5, AC-7).
3. **Phase 3 (ECS adapter)**: Add `packages/frontend/engine/src/components/combat_identity.ts` (component + observers, exported from `sim.ts`) and `packages/frontend/engine/src/combat/combat_state_adapter.ts` (`snapshotCombatState`, `applyCombatResult`, `combatantId ↔ eid` map). Add adapter tests and run the existing legacy turn-manager suite unchanged (AC-3, AC-6).
4. **Phase 4 (Validation)**: Run `bun run lint`/`bun run fix`, then `bun moon run schemas:test`, `bun moon run utils:test`, `bun moon run frontend-engine:test`, and `bun moon run :validate`. Update the Execution Report with exact results.

## Edge Cases & Gotchas

- **Entity-generation reuse**: bitECS can recycle eids; never derive a `combatantId` from an eid or persist one. Always go through `CombatIdentity`.
- **Revision monotonicity**: increment `stateRevision` exactly once per successful resolve; validation failures must leave it unchanged. Stale `basedOnRevision` inputs are rejected (`staleRevision`).
- **RNG stream mixing**: an action must advance only the `actions` substream; adding an `initiative` roll must not perturb later action rolls (this is why design decision §25.3 chose named substreams).
- **Canonical comparison**: byte-equivalence requires sorted-key stringify; object insertion order is not stable across runs.
- **No hidden side effects**: the kernel must not mutate `abilityCatalog`, the combatants map, or the path array it receives.
- **Movement path**: path cells must be contiguous, in-bounds, and unblocked; a `teleport`-style jump is `pathInvalid`. Path length is budget-checked before any state change.
- **Downed vs defeated**: define explicitly (Combat-01: `defeated` is terminal removal from the initiative order; `downed` may still be revived in a later slice) and test the boundary.
- **Outcome**: `combatEnded` emits when all opposing teams are defeated; set `phase: 'ended'` and `outcome`; further commands return `encounterEnded`.
- **`basedOnRevision`**: the only input that can produce `staleRevision`. Omitted → validate against the current `stateRevision` and never emit `staleRevision`; supplied and mismatched → reject with state unchanged.
- **Replay abort**: `replayCombat` stops at the first invalid command, returns `finalState: null` plus the events produced so far, and never throws. `findFirstCombatDivergence` reports `{ stateRevision, eventIndex }` for the first differing event (or the end of the shorter log) and `null` for identical replays.
- **Combat end ordering**: once `combatEnded` fires, no further `turnStarted` is emitted and `phase` stays `'ended'`.
- **Authored ID source**: `combatantId` comes from the entity's authored ID (`Enemy.spawnId`/`Enemy.encounterId`, `Companion.npcId`) or, for the player, from the caller-supplied campaign character ID passed to `snapshotCombatState`; mint a deterministic `<encounterId>:<spawnIndex>` only when no authored ID exists.

## Open Questions

Resolved during drafting; recorded here so the implementer inherits the decision (residual confirmations are noted inline):

- **Q1 — Stable combatant ID source of truth.** **Resolved:** use the authored ID already on the entity — `Enemy.spawnId`/`Enemy.encounterId` (`components/enemy.ts` L22/L27) for encounter spawns, `Companion.npcId` (`components/companion.ts` L17) for companions, and the caller-supplied campaign character ID for the player (the ECS only knows the player as `eid === 1` / `GameWorld._playerEntityId`). Mint a deterministic `<encounterId>:<spawnIndex>` only for entities with no authored ID. The adapter owns the `combatantId ↔ eid` map; the C-195 string registry is used for display names, not identity. Confirm against `content_pack.ts` before coding.
- **Q2 — Ability catalog ownership.** Recommendation: embed `abilityCatalog` in `CombatState` so the kernel is self-contained and replayable without an external rules lookup (finalized by this contract, per §8's "implementation contracts must finalize schemas"). Alternative: pass a separate ruleset. **Resolved: catalog lives in `CombatState`.**
- **Q3 — Downed/defeat semantics.** Recommendation: Combat-01 treats HP ≤ 0 as `downed` and immediately `defeated` (terminal) since death saves/revive are later slices; Combat-02+ may separate them. **Resolved: equated in Combat-01.**

Decisions from architecture §25 adopted here: quantized tactical cells over the continuous world (§25.1) and named deterministic RNG substreams (§25.3). Legacy in-combat save behavior (§25.2), rules-version retention mechanics (§25.4), natural-language confirmation default (§25.5), and companion default (§25.6) are deferred to Combat-04/05/06/08.

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
