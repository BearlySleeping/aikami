# Contract C-338: Deepen Turn-Based Combat with Action Economy, Statuses, and Tactical AI

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md § C-338 — Phase 2 — Core RPG Depth and Replayability |
| **Target** | `packages/frontend/engine/src/systems/turn_manager_system.ts` (modify — action-economy resolver, multi-target, status tick, downed state), `packages/frontend/engine/src/components/status_effects.ts` (new), `packages/frontend/engine/src/components/resistances.ts` (new), `packages/shared/schemas/src/lib/game/status_effect.ts` (new), `packages/shared/schemas/src/lib/game/damage_type.ts` (new), `packages/shared/types/src/lib/game/status_effect.ts` (new), `packages/shared/constants/src/lib/game/status_effects.ts` (new), `packages/shared/constants/src/lib/game/damage_types.ts` (new), `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` (modify), `apps/frontend/client/src/lib/views/combat/types/combat_enhancements.ts` (modify) |
| **Priority** | P1 — combat must support multiple meaningful encounters with varied tactics beyond "attack every turn." |
| **Dependencies** | C-197 (GOAP Combat Tactics — `completed`), C-330 (Deterministic Demo Combat — `approved`), C-336 (Deterministic Rules Kernel — `approved`), C-337 (Character Progression & Classes — `approved`) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | None — internal mechanical systems. Player-facing combat UX is covered by C-330 and existing combat overlay |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Turn-based combat in `turn_manager_system.ts` supports exactly three player actions (ATTACK, FLEE, DEFEND) with no action economy differentiation — every turn is one click, one outcome. Enemy AI (C-197 GOAP) evaluates tactical targets and repositioning, but all enemies use the same d20/d6 attack formula. There is no status effect system (poison, stun, bless), no damage-type resistance logic, no multi-target actions, no support actions (heal/buff allies), and no downed/revive policy — an entity at 0 HP is simply removed or triggers COMBAT_ENDED. The `ActionEconomy` type exists as a stub in `combat_enhancements.ts` but is never wired to the engine. The `TurnState` concept similarly exists in the ViewModel but the engine treats every turn as an unstructured "go ahead" signal.

- **Reproduction**:
  1. Enter combat via `/dev/sandbox/combat` or production encounter trigger (C-330) — the player has exactly three buttons: Attack, Defend, Flee.
  2. Click Attack every turn — no limit on actions per turn, no bonus action slot, no reaction trigger.
  3. Search for status effect code: `grep -r "StatusEffect\|status_effect\|Condition" packages/frontend/engine/src/` — zero results in components or systems. The `CombatStats` SoA has no status-related arrays.
  4. Search for resistance/vulnerability code: `grep -r "resistance\|vulnerability\|immunity\|damageType" packages/frontend/engine/src/components/` — zero results. The `DAMAGE_TYPE_COLORS` constant exists in the ViewModel layer but has no mechanical effect.
  5. Search for downed/revive mechanics: `grep -r "downed\|unconscious\|deathSave\|revive" packages/frontend/engine/src/systems/turn_manager_system.ts` — zero results. Entities at 0 HP either end combat or are silently removed.
  6. Search for multi-target actions: `grep -r "areaOfEffect\|aoe\|targetAll\|multiTarget" packages/frontend/engine/src/systems/turn_manager_system.ts` — zero results. All actions are single-target.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | Turn-based combat loop (initiative sort, turn advance, action dispatch) | `packages/frontend/engine/src/systems/turn_manager_system.ts` |
  | Combat action handler (ATTACK/FLEE/DEFEND dispatch, player attack, enemy turn) | `turn_manager_system.ts` (`handleCombatAction`, `_processPlayerAttack`, `_processEnemyTurn`) |
  | GOAP tactical AI (target scoring, range check, repositioning, retreat) | `packages/frontend/engine/src/systems/goap_combat_tactics_system.ts` |
  | CombatTactics SoA component (threatTargetEid, tacticalActionMask, preferredRange) | `packages/frontend/engine/src/components/combat_tactics.ts` |
  | CombatStats SoA component (health, maxHealth, attack, defense, accuracy, evasion, level, xp) | `packages/frontend/engine/src/components/combat_stats.ts` |
  | TurnOrder SoA component (currentTurn, initiativeValue, isActive) | `packages/frontend/engine/src/components/turn_order.ts` |
  | Enemy tag component (isActive, spawnId, encounterId, allowNonCombatResolution) | `packages/frontend/engine/src/components/enemy.ts` |
  | Seedable RNG (mulberry32 via `@aikami/utils`) | `packages/shared/utils/src/lib/rng/seedable_rng.ts` |
  | Progression system (XP grant + level-up) | `packages/frontend/engine/src/systems/progression_system.ts` |
  | Content pack encounter schema (enemyNpcIds, loot, nonCombatSkillCheck) | `packages/shared/schemas/src/lib/game/content_pack.ts` |
  | Combat ViewModel (bridge listener, action buttons, battle log) | `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` |
  | ActionEconomy + TurnState stub types | `apps/frontend/client/src/lib/views/combat/types/combat_enhancements.ts` |
  | DAMAGE_TYPE_COLORS + DamageTypeKey constants | `combat_enhancements.ts` |
  | Combat sandbox route + ViewModel | `apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/combat/` |
  | Engine bridge event stream (COMBAT_LOG, COMBAT_STATE_UPDATE, COMBAT_ENDED, TURN_CHANGED) | `packages/frontend/engine/src/types.ts` |
  | Combat action command (COMBAT_ACTION with action/targetId/advantage/bonusDamage) | `packages/frontend/engine/src/types.ts` |
  | Engine bridge `sendCommand` / `onEvent` pattern | `packages/frontend/engine/src/engine_bridge.ts` |
  | Dice service (frontend, `rollDice`, `rollD20`, `rollCheck`) | `apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts` |
  | Class definitions + progression (C-337) | `packages/shared/constants/src/lib/game/classes.ts`, `packages/frontend/engine/src/systems/progression_system.ts` |

- **Known gaps**:
  1. **No action economy enforcement**: The engine lets the player take unlimited actions per turn. There's no standard/bonus/reaction split, no movement phase, and no consumed-action tracking.
  2. **No status effect system**: No data model, no registry, no per-tick processing, no visual indicators. Conditions like "poisoned," "stunned," "blessed" don't exist.
  3. **No resistance/vulnerability/immunity**: All damage is raw — fire damage vs. a fire elemental does full damage. No per-damage-type modifier.
  4. **No support or multi-target actions**: All combat actions are single-target hostile. No heal-ally, no buff-party, no area-of-effect.
  5. **No downed state**: 0 HP = defeat or combat-end. No death saves, no ally revive, no "bleeding out" tension.
  6. **Single enemy per encounter**: The `_findFirstEnemyParticipant()` pattern assumes one enemy. The `enemyNpcIds` array in encounter schema supports multiple, but the engine doesn't.
  7. **Monolithic action handler**: `handleCombatAction` has a flat switch — no composite action resolution, no action-cost checking, no interrupt/reaction window.

- **Baseline tests**:
  - `packages/frontend/engine/src/__tests__/turn_manager.test.ts` — covers initCombat, handleCombatAction (ATTACK/FLEE/DEFEND), endCombat, defeat, XP grant, level-up. **All pass.**
  - `packages/frontend/engine/src/__tests__/goap_combat_tactics.test.ts` — covers tactical AI target scoring, range check, retreat. **All pass.**
  - `apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts` — covers ViewModel bridge event handling. **All pass.**
  - `apps/frontend/client/src/lib/services/dice/dice_service.test.ts` — covers dice rolling. **All pass.**
  - Run `bun moon run :test` before starting.

## User Outcome

After this contract, a player can: take a standard action **and** a bonus action **and** move on their turn; apply status effects (poison, stun, bless) that persist across turns; deal different damage types (fire, cold, slashing) that interact with target resistances; target multiple enemies with area attacks or heal/buff allies with support actions; and enter a downed state at 0 HP, making death saves while allies attempt a revive. The enemy AI selects from varied tactical behaviors based on its combat role (rusher, sniper, support, boss) instead of always using the same d20/d6 attack.

## Success Measures

- **Time/latency target**: Action economy validation under 0.1ms (pure bitmap check). Status effect tick processing under 0.5ms for 10 active effects. Damage resistance lookup under 0.05ms. Multi-target action resolution under 2ms for 5 targets.
- **Offline/degraded behavior**: All mechanics are 100% local — zero network/AI dependency. Status effects, damage types, and action economy are pure ECS computations. Only AI narration degrades per existing C-330 degradation paths.
- **Production journey enabled**: A player fighting multiple goblins in Emberwatch (C-316) can use a class ability (C-337 — "Sweeping Strike") to hit 3 enemies, get poisoned by a goblin shaman's blowdart, make a death save at 0 HP, and have a companion (C-340 future) use a revive action — all while the enemy shaman stays at range (ranged AI role) and the goblin brute rushes in (rusher AI role).

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Turn-based combat loop | `turn_manager_system.ts` | **Modify** — add action economy tracking, multi-target dispatch, status tick |
| Combat action dispatch (ATTACK/FLEE/DEFEND) | `turn_manager_system.ts` `handleCombatAction` | **Modify** — expand to arbitrary action kinds with cost check |
| Player attack processor | `turn_manager_system.ts` `_processPlayerAttack` | **Modify** — add damage-type parameter, resistance modifier, multi-target loop |
| Enemy turn processor | `turn_manager_system.ts` `_processEnemyTurn` | **Modify** — delegate to role-based AI, support multi-enemy encounters |
| GOAP tactical AI (target scoring, repositioning) | `goap_combat_tactics_system.ts` | **Reuse** — extend with role strategy selection |
| CombatTactics SoA | `combat_tactics.ts` | **Modify** — add `combatRole` field |
| CombatStats SoA | `combat_stats.ts` | **Modify** — add status-related arrays, damage-type tracking |
| TurnOrder SoA | `turn_order.ts` | **Reuse** — no changes needed |
| Enemy component | `enemy.ts` | **Reuse** — no changes needed (encounterId already present) |
| Seedable RNG | `@aikami/utils` | **Reuse** — already deterministic |
| Content pack encounter schema | `content_pack.ts` | **Reuse** — enemyNpcIds already supports multiple enemies |
| Combat ViewModel | `combat_view_model.svelte.ts` | **Modify** — add action economy UI, status effect display, multi-target selection |
| ActionEconomy stub types | `combat_enhancements.ts` | **Replace** — promote from UI-only stub to engine-enforced system |
| DAMAGE_TYPE_COLORS | `combat_enhancements.ts` | **Reuse** — already defines damage type taxonomy |
| Engine bridge events | `types.ts` | **Modify** — add STATUS_APPLIED, STATUS_EXPIRED, ACTION_ECONOMY_CHANGED, ENTITY_DOWNED, DEATH_SAVE_ROLLED events |
| Engine bridge commands | `types.ts` | **Modify** — expand COMBAT_ACTION to carry actionKind, targetIds[], damageType |
| Damage dealt event | `types.ts` `DAMAGE_DEALT` | **Modify** — add `damageType` field |
| COMBAT_LOG event | `types.ts` | **Modify** — add `statusEffectId`, `damageType`, `isMultiTarget` fields |
| Dice service | `dice_service.svelte.ts` | **Reuse** — d20 + d6 already sufficient |
| Class definitions (C-337) | `classes.ts`, `progression_system.ts` | **Reuse** — class features reference ability activations (action/bonus_action/reaction) |
| Combat sandbox | `routes/(dev)/sandbox/combat/` | **Modify** — extend for multi-enemy, status effect, and action economy testing |

## Overview

Deepen the existing turn-based combat engine from a simple "click Attack → d20/d6 → enemy counterattacks" loop into a tactically rich system with: (1) **action economy** enforcing standard/bonus/reaction limits per turn, (2) a **status effect registry** with per-turn tick processing (poison damage, stun skip, bless bonus), (3) **damage-type resistance/vulnerability/immunity** integrated into damage calculation, (4) **multi-target and support action** support (area attacks, ally heals, buffs), and (5) a **downed state** with death saves and ally revive. Enemy AI is extended with combat roles (rusher, sniper, support, boss) so not every enemy uses the same d20/d6 pattern. These mechanics compose with C-337 class abilities (action cost on abilities, status-inflicting features) and C-336 deterministic rules (status ticks are seedable, damage resistance math is pure).

## Design Reference

- **bitECS SoA pattern**: Follow `CombatStats` / `CombatTactics` component pattern — `Float64Array` / `Int32Array` per field, observer registration, derived `Data` type.
- **Engine bridge event pattern**: Follow `COMBAT_STATE_UPDATE` emission pattern — emit after every state-mutating action, carry entity→value maps.
- **Action dispatch pattern**: Follow existing `handleCombatAction` switch, but replace hardcoded three-action switch with action-kind router that checks action economy before executing.
- **Status tick pattern**: Follow `_processEnemyTurn` — called at appropriate point in turn lifecycle (start-of-turn, end-of-turn), iterates all entities with active status effects.
- **Deterministic resolution**: All status tick RNG, damage-type modifier math, and death saves go through the same `SeedableRng` from `@aikami/utils` used by C-330/C-336.
- **Class ability composition**: C-337 abilities carry `activation` fields (`cost: 'action' | 'bonus_action' | 'reaction'`, `target: 'single_enemy' | 'all_enemies' | 'single_ally' | 'area'`). C-338 implements the engine that enforces these — abilities define what they cost and target; C-338 enforces the cost and resolves the targeting.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Engine — status effects component** (`packages/frontend/engine/src/components/status_effects.ts`): New SoA component per entity. Arrays for active effect IDs (packed bitmask or sparse arrays), remaining duration, source entity.
- **Engine — resistances component** (`packages/frontend/engine/src/components/resistances.ts`): New SoA component per entity. Arrays for per-damage-type resistance factor (0.0 = immune, 0.5 = resistant, 1.0 = normal, 2.0 = vulnerable).
- **Engine — turn manager** (`packages/frontend/engine/src/systems/turn_manager_system.ts`): Refactor `handleCombatAction` to accept an `actionKind` discriminator. Add action economy state tracking per entity per turn. Add status tick processing at start-of-turn and end-of-turn hooks. Add multi-target action resolution. Add downed-state handling in `_processEnemyTurn` and `_processPlayerAttack`.
- **Engine — tactical AI** (`packages/frontend/engine/src/systems/goap_combat_tactics_system.ts`): Add `CombatRole` enum (rusher, sniper, support, boss). Extend `resolveTacticalAction` to select role-appropriate behavior: rushers close distance and attack, snipers stay at range, supports heal/buff allies, bosses use varied patterns.
- **Shared schemas** (`packages/shared/schemas/src/lib/game/status_effect.ts`): TypeBox schemas for `StatusEffectDefinition`, `ActiveStatusEffect`. Follow `content_pack.ts` registry pattern.
- **Shared schemas** (`packages/shared/schemas/src/lib/game/damage_type.ts`): TypeBox schemas for `DamageType`, `DamageResistanceProfile`. Derived from existing `DamageTypeKey` taxonomy in `combat_enhancements.ts`.
- **Shared types** (`packages/shared/types/src/lib/game/status_effect.ts`, `damage_type.ts`): `Static<>` types derived from schemas.
- **Shared constants** (`packages/shared/constants/src/lib/game/status_effects.ts`, `damage_types.ts`): Curated default status effect definitions (5–7 basic conditions), damage type taxonomy (12 types). Re-exported from `@aikami/constants`.
- **Client ViewModel** (`apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts`): Add action economy display (green/red dots for available/consumed actions). Add status effect icons on combatant portraits. Add multi-target selection UI (click to select targets before confirming action). Add downed-state visual (skull icon, death save counter).
- **Client types** (`apps/frontend/client/src/lib/views/combat/types/combat_enhancements.ts`): Replace stub `ActionEconomy` with engine-sourced version. Add `StatusEffectDisplay` type, `CombatRole` enum mirror for UI.
- **Dev sandbox** (`apps/frontend/client/src/routes/(dev)/sandbox/combat/`): Extend for multi-enemy encounters, status effect injection, action economy toggling, and damage-type testing. Keep existing single-enemy flow working.

## State & Data Models

### Action Economy (engine-internal, per-entity per-turn)

```typescript
// Engine-internal SoA tracking (private to turn_manager_system.ts)
// Reset each time advanceTurn() sets a new active entity.

type ActionEconomyState = {
  /** Entity ID this state belongs to. */
  entityId: number;
  /** Whether the standard action has been consumed this turn. */
  actionConsumed: boolean;
  /** Whether the bonus action has been consumed this turn. */
  bonusActionConsumed: boolean;
  /** Whether the reaction has been consumed this round. */
  reactionConsumed: boolean;
  /** Whether movement has been used (future — always false for now). */
  movementConsumed: boolean;
};
```

### Combat Action Kind (extends existing COMBAT_ACTION command)

```typescript
// Added as a discriminated field on the COMBAT_ACTION GameCommand

type CombatActionKind =
  | { kind: 'ATTACK'; targetId: number; damageType?: DamageTypeKey }
  | { kind: 'ABILITY'; abilityId: string; targetIds: number[]; damageType?: DamageTypeKey }
  | { kind: 'DEFEND'; }  // existing, no change
  | { kind: 'FLEE'; }    // existing, no change
  | { kind: 'SUPPORT'; supportKind: 'heal' | 'buff'; targetId: number; amount?: number; buffEffectId?: string }
  | { kind: 'REVIVE'; targetId: number };
```

### Status Effect Definition (shared schema)

```typescript
// packages/shared/schemas/src/lib/game/status_effect.ts

// How a status effect modifies combat stats or behavior
type StatusEffectModifier = {
  /** Flat bonus/penalty to attack rolls. */
  attackModifier?: number;
  /** Flat bonus/penalty to defense. */
  defenseModifier?: number;
  /** Flat bonus/penalty to accuracy (hit chance). */
  accuracyModifier?: number;
  /** Flat bonus/penalty to evasion. */
  evasionModifier?: number;
  /** Damage per tick (e.g., poison deals 2 damage per turn). */
  damagePerTick?: number;
  /** Damage type of per-tick damage. */
  tickDamageType?: DamageTypeKey;
  /** Healing per tick (e.g., regeneration). */
  healPerTick?: number;
  /** Multiplier on damage dealt (e.g., 0.5 = half damage while weakened). */
  damageDealtMultiplier?: number;
  /** Whether the entity skips its turn entirely (stun/paralysis). */
  skipTurn?: boolean;
  /** Whether the entity cannot take reactions. */
  blocksReactions?: boolean;
};

// A status effect definition (registry entry)
type StatusEffectDefinition = {
  /** Unique effect ID — "poisoned", "stunned", "blessed", "burning" */
  id: string;
  /** Display name. */
  name: string;
  /** Player-facing description. */
  description: string;
  /** How long this effect lasts (in turns). 0 = permanent until removed. */
  defaultDuration: number;
  /** What the effect does mechanically. */
  modifier: StatusEffectModifier;
  /** Visual indicator color/tag for UI. */
  tag: 'harmful' | 'beneficial' | 'neutral';
};

// An active instance of a status effect on an entity
type ActiveStatusEffect = {
  /** The effect definition ID. */
  effectId: string;
  /** Entity that applied this effect (0 = environmental/unknown). */
  sourceEntityId: number;
  /** Turns remaining (decremented each start-of-turn tick). */
  remainingDuration: number;
  /** The turn number when this was applied. */
  appliedOnTurn: number;
};
```

### Resistance Profile (per entity)

```typescript
// packages/shared/schemas/src/lib/game/damage_type.ts

type DamageTypeKey =
  | 'slashing' | 'piercing' | 'bludgeoning'
  | 'fire' | 'cold' | 'lightning' | 'acid' | 'poison'
  | 'necrotic' | 'radiant' | 'psychic' | 'force' | 'thunder';

// Resistance factor per damage type:
//   0.0 = immune (no damage)
//   0.5 = resistant (half damage)
//   1.0 = normal (full damage)
//   2.0 = vulnerable (double damage)
type DamageResistanceProfile = Record<DamageTypeKey, number>;
```

### Combat Role (enemy AI)

```typescript
// packages/frontend/engine/src/components/combat_tactics.ts (extend)

type CombatRole = 'rusher' | 'sniper' | 'support' | 'boss' | 'generic';

// Added to CombatTactics SoA:
//   combatRole: [] as CombatRole[]
//   preferredRange: rusher=1, sniper=5, support=3, boss=varies
```

## Quality Requirements

- **Offline/degraded mode**: All combat mechanics are 100% local ECS computations. Status tick processing, damage-type resistance math, action economy enforcement, and death saves require zero network. Only AI narration degrades (per existing C-330 paths).
- **Accessibility/input**: Multi-target selection UI must support keyboard navigation (Tab between targets, Space to toggle, Enter to confirm). Status effect icons must have `aria-label` attributes. Death save roll must be announced via screen reader.
- **Performance budget**: Status tick processing for 10 entities × 3 effects each under 0.5ms per tick. Damage resistance lookup O(1) via precomputed factor array. Multi-target action resolution under 2ms for 5 targets (linear loop, no allocations beyond result array).
- **Security/privacy**: N/A — all combat state is local ECS memory, no user data exposure.
- **Persistence/migration**: Status effects and resistances are ephemeral combat state — not persisted across save/load. They are re-created from encounter definitions on combat init. Action economy resets each turn — no migration needed.
- **Cancellation/retry/idempotency**: Combat actions are idempotent via deterministic RNG (same seed + action sequence = same outcome). Action economy state is reset on turn advance — no stale-state bugs.
- **Observability**: Emit bridge events for: `STATUS_APPLIED` (effectId, targetId, sourceId, duration), `STATUS_EXPIRED` (effectId, targetId), `STATUS_TICK` (effectId, targetId, damage/heal amount), `ACTION_ECONOMY_CHANGED` (entityId, available actions), `ENTITY_DOWNED` (entityId), `DEATH_SAVE_ROLLED` (entityId, roll, cumulativeSuccesses, cumulativeFailures), `ENTITY_REVIVED` (entityId, revivedByEntityId). All actions emit updated `COMBAT_STATE_UPDATE` with HP + status maps.

## Migration & Rollback

N/A — no persistent state changes. Status effects and resistance profiles are ephemeral combat-only state computed from encounter definitions and entity configuration. They do not survive save/load and require no migration.

## Scope Boundaries

- **In Scope:**
  - Action economy: standard action, bonus action, reaction per turn per combatant. Reset on turn advance.
  - Status effect registry (5–7 basic effects: poisoned, stunned, blessed, burning, weakened, shielded, regenerating). Per-turn tick processing (damage/heal + duration decrement). Stat modifier application during hit/damage calculations.
  - Damage type taxonomy (12 types matching existing `DAMAGE_TYPE_COLORS`). Per-entity resistance/vulnerability/immunity profile. Integrated into `_processPlayerAttack` and `_processEnemyTurn` damage calculation.
  - Multi-target action resolution: ability-defined target selection (single, all enemies, area, single ally). Support actions: heal ally, buff ally (apply beneficial status effect).
  - Downed state: 0 HP → downed (not dead). Three death saves (d20, DC 10, 3 successes = stable, 3 failures = dead). Ally revive action (DC 12 medicine check or automatic via class ability).
  - Enemy AI role system: rusher (close range, aggressive), sniper (maintain distance, ranged attacks), support (buff/heal allies, debuff player), boss (varied pattern, higher stats, multi-phase). Configured via encounter definition.
  - Multi-enemy encounters: handle `enemyNpcIds.length > 1` in combat init. Multiple enemy entities participate in turn order. Victory when all enemies are dead/downed; defeat when all party members are downed.

- **Out of Scope:**
  - Spell slot management (C-337 defers full Vancian casting — abilities with per-rest usage are handled by C-337's `usageLimit` on abilities, C-338 just enforces the action cost).
  - Cover and positioning rules (grid-based cover bonuses, flanking advantage) — deferred to C-342 (World Interactables, Dungeons, Puzzles).
  - Encounter difficulty scaling / CR calculation — deferred to C-345 (Campaign/Content-Pack Browser, second adventure) or content-authoring tooling.
  - Party/companion combat controls (C-340) — C-338 adds the engine support for multi-actor combat, but companion AI and player control of companions is C-340's scope.
  - Visual effects for statuses (green tint for poison, sparkles for bless) — covered by C-163 (Visceral Feedback) / C-355 (Media Director).
  - AI narration of status effects — already handled by existing CombatViewModel AI pipeline (sends combat state to text generation service).
  - Changing the combat overlay layout — covered by C-332 (HUD & Overlay Navigation).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs touching 2 projects (engine + client). Systems are tightly interwoven — action economy governs what statuses can be applied, status ticks feed damage-type resistance math, multi-target actions are the primary vector for status application, and downed state is the terminal condition that gives all of the above stakes. Splitting would produce contracts that can't be independently verified (e.g., "add action economy" can't be tested without multi-target actions or status effects to spend the bonus action on). **Single contract, 5 ACs.**

## Acceptance Criteria

### AC-1: Action Economy Enforces Standard/Bonus/Reaction Per Turn
**Given** combat is initialized with the player as the active turn holder
**When** the player takes a standard action (ATTACK or class ability costing `action`), then attempts to take a second standard action
**Then** the engine rejects the second action, emits `COMBAT_LOG` with "No standard action remaining," and the player can still take a bonus action and reaction. After `advanceTurn()` is called (player ends turn or enemy turn processes), the next entity gets a fresh action economy. Actions that cost `bonus_action` consume the bonus action slot. Actions that cost `reaction` consume the reaction slot (reset at the start of the entity's next turn, per D&D convention).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Integration | `packages/frontend/engine/src/__tests__/turn_manager.test.ts` (extend), `apps/e2e/tests/game/combat_action_economy.spec.ts` | `/game` (via encounter trigger C-330) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test` for unit tests; `bun moon run e2e:test` for integration
- Integration: Manual check in `/dev/sandbox/combat` — verify action buttons grey out after use, bonus action slot becomes unavailable, reaction triggers on enemy turn
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/game/combat_action_economy.spec.ts` — test that taking ATTACK consumes standard action, taking a bonus-action ability consumes bonus action, reaction triggers on enemy attack, rejecting duplicate action types
    - **Visual**: N/A (functional behavior, no visual-only assertion)

**Watch Points**:
- Reaction reset: reaction should reset at the start of the entity's next turn, not at round boundaries.
- Multi-turn: ensure action economy resets correctly after multiple full rounds.
- Edge case: what if the only available action is FLEE? FLEE should be a standard action — if the standard action is consumed, FLEE is not available.

### AC-2: Status Effects Apply, Tick, and Expire During Combat
**Given** an entity is affected by the "poisoned" status effect (duration: 3 turns, damagePerTick: 2)
**When** the entity's turn starts (start-of-turn tick processing)
**Then** the entity takes 2 poison damage (resisted by poison resistance if present), `STATUS_TICK` event is emitted with damage amount, remaining duration decrements to 2, and after 3 turns the effect expires with a `STATUS_EXPIRED` event. While poisoned, the entity's attack modifier (−2 from the effect's `modifier`) is applied to all attack rolls.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + E2E | `packages/frontend/engine/src/__tests__/status_effects.test.ts` (new), `apps/e2e/tests/game/combat_status_effects.spec.ts` | `/game` (encounter with status-inflicting enemy) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test` for unit tests; `bun moon run e2e:test` for E2E
- Integration: Sandbox toggle to apply "poisoned", "stunned", "blessed" to entities — verify tick damage, skip-turn behavior, stat modifiers
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/game/combat_status_effects.spec.ts` — test poison damage tick, stun skips turn, bless adds accuracy, effect expires after duration, multiple simultaneous effects
    - **Visual**: `apps/e2e/src/visual/suites/combat_status_effects.visual.ts` — verify status effect icons appear on combatant portraits, dim/glow based on type (harmful red, beneficial blue), fade animation on expire

**Watch Points**:
- Stacking: same effect from different sources — does "poisoned" from two sources stack? Decision: No stacking of same effect ID. The longer duration takes precedence.
- Expired-during-tick: if tick damage kills an entity, death processing happens after tick completes (downed state from AC-5).
- Stun + reaction: if an entity is stunned, it cannot take reactions either.

### AC-3: Damage-Type Resistance/Vulnerability/Immunity Modifies Damage
**Given** an enemy with `resistanceProfile: { fire: 0.0, cold: 2.0, slashing: 0.5, ...default 1.0 }` (immune to fire, vulnerable to cold, resistant to slashing)
**When** the player attacks with a fire-typed weapon (damageType: 'fire') dealing 6 raw damage
**Then** the enemy takes 0 damage (immune), the COMBAT_LOG shows "Immune to fire!", and the DAMAGE_DEALT event carries `damageType: 'fire'` and `actualDamage: 0`. When attacked with cold, 6 raw → 12 actual (vulnerable, "Vulnerable to cold!" log). When attacked with slashing, 6 raw → 3 actual (resistant, "Resists slashing!"). Damage cannot be reduced below 1 unless immune. The default resistance factor for unlisted types is 1.0 (normal).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `packages/frontend/engine/src/__tests__/damage_resistance.test.ts` (new) | N/A (engine-level) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test` for unit tests
- Integration: Sandbox toggle to set enemy resistance profile — verify fireball (fire) vs. fire elemental (immune), ice spell (cold) vs. fire elemental (vulnerable)
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/game/combat_damage_types.spec.ts` — test that combat log shows "Immune", "Resistant", "Vulnerable" messages correctly
    - **Visual**: N/A (functional behavior)

**Watch Points**:
- Multi-type damage: if an ability deals "slashing + fire" damage, resistance is checked per-type and summed. Each type independently has a minimum of 1 unless immune.
- Healing interaction: healing is never resisted — resistance only applies to damage.
- Per-tick status damage: status tick damage (AC-2) also goes through resistance checks (poison tick vs. poison resistance).

### AC-4: Multi-Target and Support Actions Resolve Correctly
**Given** combat with 3 enemy entities and 1 ally entity, and the player uses a "Sweeping Strike" ability (kind: 'ABILITY', targetIds: [enemy1, enemy2], damageType: 'slashing')
**When** the engine resolves the multi-target action
**Then** both enemy1 and enemy2 receive independent hit checks (d20 + accuracy vs. each evasion), independent damage rolls (d6 + attack vs. each defense), and independent COMBAT_LOG entries. The action consumes the standard action slot. If the player uses "Healing Word" (kind: 'SUPPORT', supportKind: 'heal', targetId: ally1, amount: 8), the ally entity gains 8 HP (capped at maxHealth), a COMBAT_LOG entry shows "Ally healed for 8 HP," and no hit check is performed for heals.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Integration | `packages/frontend/engine/src/__tests__/turn_manager.test.ts` (extend), `apps/e2e/tests/game/combat_multi_target.spec.ts` | `/game` (encounter with multiple enemies, ally NPC) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test` for unit tests; `bun moon run e2e:test` for integration
- Integration: Sandbox with 3 enemies — test area attack hits all, single-target heal works, buff applies status effect to ally
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/game/combat_multi_target.spec.ts` — test multi-target selection UI (click targets, confirm), verify damage applied to all, verify heal amount
    - **Visual**: `apps/e2e/src/visual/suites/combat_multi_target.visual.ts` — verify multi-target highlight rings during selection, damage numbers appear on all hit targets, heal visual on ally

**Watch Points**:
- Single-target replay: if a multi-target ability is used with only 1 valid target, it should still work (just resolve against that 1 target).
- Dead targets excluded: dead/downed entities are not valid targets.
- Self-target: support actions should allow self-targeting (cast heal on self).
- Action cost: SUPPORT actions cost the action slot unless specified as bonus_action via ability definition.

### AC-5: Downed State, Death Saves, and Ally Revive
**Given** a combatant at 5 HP that takes 8 damage (drops to 0 HP)
**When** damage reduces HP to exactly 0 or below
**Then** the entity enters the "downed" state instead of dying. HP is set to 0. The entity cannot take actions but remains in the turn order. `ENTITY_DOWNED` event is emitted. On each of the entity's subsequent turns, a death save is automatically rolled (d20, DC 10): 10+ = success, 1–9 = failure, natural 1 = two failures, natural 20 = revive at 1 HP. `DEATH_SAVE_ROLLED` event is emitted each time. Three cumulative successes → stable (HP stays at 0 but no more death saves, no auto-death). Three cumulative failures → dead (entity removed from combat, COMBAT_LOG "has died!"). While downed, an ally can use a REVIVE action (kind: 'REVIVE', targetId: downedEntityId) — standard action, DC 12 medicine check (d20 + no modifier for now). Success → revived at 1 HP, `ENTITY_REVIVED` event. Failure → no effect, action consumed.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + E2E | `packages/frontend/engine/src/__tests__/downed_state.test.ts` (new), `apps/e2e/tests/game/combat_downed.spec.ts` | `/game` (encounter where player can be downed) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test` for unit tests; `bun moon run e2e:test` for E2E
- Integration: Sandbox toggle to set player HP to 1, enemy attack deals >1 damage — verify downed state, death saves auto-roll, ally revive works
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/game/combat_downed.spec.ts` — test that 0 HP triggers downed, death saves roll automatically, 3 failures = dead, 3 successes = stable, ally revive succeeds and fails
    - **Visual**: `apps/e2e/src/visual/suites/combat_downed.visual.ts` — verify downed visual (skull icon or greyed-out portrait), death save counter (success/failure pips), revive animation

**Watch Points**:
- Multi-damage: if a single hit deals damage > max HP (e.g., 50 damage to 10 HP entity), it's still just downed, not instant death.
- Healing while downed: healing from any source (ally heal, regeneration tick, potion) automatically revives at the healed amount (no death save needed).
- Enemy death saves: enemies do NOT get death saves — they die at 0 HP. Only player characters and named NPC allies use the downed system. This is a deliberate D&D-adjacent design choice to keep combat fast.
- Encounter defeat: if all player-controlled entities are downed or dead, COMBAT_ENDED with victory = false.
- Stable state: a stable entity (3 death save successes) stays at 0 HP indefinitely. It doesn't auto-die but can still be targeted and killed by enemy attacks (any damage to a stable entity = dead).

## Implementation Sequence

1. **Phase 1 (Engine Data + Schemas)**:
   - Add `packages/shared/schemas/src/lib/game/status_effect.ts` — `StatusEffectDefinitionSchema`, `ActiveStatusEffectSchema`.
   - Add `packages/shared/schemas/src/lib/game/damage_type.ts` — `DamageTypeKeySchema`, `DamageResistanceProfileSchema`.
   - Add `packages/shared/constants/src/lib/game/status_effects.ts` — 7 default status effect definitions.
   - Add `packages/shared/constants/src/lib/game/damage_types.ts` — 12 damage type keys, default resistance profile.
   - Add `packages/shared/types/src/lib/game/status_effect.ts`, `damage_type.ts` — `Static<>` derived types.
   - Add `packages/frontend/engine/src/components/status_effects.ts` — SoA component with per-entity active effects.
   - Add `packages/frontend/engine/src/components/resistances.ts` — SoA component with per-entity resistance profile.
   - Extend `CombatTactics` SoA with `combatRole: [] as CombatRole[]` field.
   - Register all new observers in engine boot.

2. **Phase 2 (Engine Logic)**:
   - Refactor `handleCombatAction` in `turn_manager_system.ts`:
     - Replace flat switch with action-kind router.
     - Add action economy state tracking (reset on turn advance).
     - Add action-cost validation before execution.
   - Add status tick processing: `_processStatusTicks(world, eid)` called at `advanceTurn` start-of-turn hook.
   - Add damage-type resistance modifier in `_processPlayerAttack` and `_processEnemyTurn`: lookup resistance factor, apply multiplier, emit log.
   - Add multi-target resolution loop: `_resolveMultiTargetAction` dispatches hit check + damage per target.
   - Add support action resolution: heal (add HP, clamped), buff (apply status effect to ally).
   - Add downed-state handling:
     - In damage application: if HP would drop to ≤ 0, set to 0, mark downed.
     - In turn advance: if downed and not stable, auto-roll death save.
     - Add revive action handler.
   - Extend enemy AI: `goap_combat_tactics_system.ts` reads `combatRole`, selects role-appropriate behavior.
   - Support multi-enemy encounters: `initCombat` iterates all enemy entities, adds to turn order.

3. **Phase 3 (Client + Integration)**:
   - Extend `combat_view_model.svelte.ts`:
     - Wire action economy state to button enable/disable.
     - Add status effect display (icons on portraits).
     - Add multi-target selection mode (click to toggle targets, confirm button).
     - Add downed state visual (portrait dim, death save pip counter).
   - Update `combat_enhancements.ts` types to mirror engine-side data.
   - Extend `types.ts` bridge events: STATUS_APPLIED, STATUS_EXPIRED, STATUS_TICK, ACTION_ECONOMY_CHANGED, ENTITY_DOWNED, DEATH_SAVE_ROLLED, ENTITY_REVIVED.
   - Extend `types.ts` COMBAT_ACTION command: add actionKind discriminator, targetIds array, damageType.
   - Extend combat sandbox for multi-enemy, status injection, action economy toggling.

4. **Phase 4 (Validation)**:
   - Run `bun moon run frontend-engine:test` — verify all new unit tests pass.
   - Run `bun moon run :test` — verify no regressions across all projects.
   - Run `bun moon run :validate` — full CI validation.

## Edge Cases & Gotchas

- **Action economy — zero valid actions**: If an entity is stunned (skipTurn=true) and has no reaction available, `advanceTurn` should auto-skip to the next entity rather than leaving the UI in a dead state. Emit COMBAT_LOG: "Entity is stunned and cannot act!"
- **Status effect — expired during tick damage**: If a status tick kills an entity, process the downed state immediately after the tick, before any other tick effects on that entity. Remaining ticks for the entity are skipped.
- **Damage resistance — integer rounding**: All resistance math uses `Math.max(1, Math.floor(raw * factor))` for non-immune, 0 for immune. This keeps HP as integers and ensures minimum 1 damage (per D&D conventions: "always at least 1 damage unless immune").
- **Multi-target — targeting dead/downed entities**: Filter targetIds against alive + active entities before resolving. If no valid targets remain, emit COMBAT_LOG: "No valid targets in range!" and do not consume the action.
- **Downed — natural 20 revive**: A natural 20 on a death save revives at 1 HP immediately. The entity can act on its next turn (action economy already consumed for this turn since death save is automatic — wait for next turn).
- **Downed — healing overflow**: If an ally heals a downed entity for 15 HP and the entity's max HP is 30, the entity revives at 15 HP. The heal is not wasted on "overhealing past 0."
- **Reaction — trigger window**: Reactions trigger on specific enemy actions (e.g., "when attacked"). The current system does not have a reaction-declaration UI — reactions are auto-triggered if a valid trigger occurs and the reaction slot is available. Class abilities that grant reactions (C-337) will specify trigger conditions.
- **Enemy AI — support role targeting**: Support enemies should heal the most-damaged ally (lowest HP ratio). If all allies are at full HP, they default to attacking the player.
- **Multi-enemy encounters — initiative**: Each enemy rolls its own initiative from its CombatStats. Multiple enemies of the same type may share an initiative group for faster turn resolution.

## Open Questions

- **Q1**: Should enemies use the downed/death-save system, or die immediately at 0 HP as proposed? **Proposal**: Enemies die immediately. Player characters and named NPC allies (future C-340 companions) use death saves. This keeps combat fast and avoids the "whack-a-mole" problem where enemies keep getting revived. Confirm with game design.
- **Q2**: Should the reaction system have a manual trigger UI (e.g., "Enemy is attacking — use your reaction to cast Shield?") or be fully automatic? **Proposal**: Automatic for now — abilities with `cost: 'reaction'` and a trigger condition auto-fire when the trigger occurs and the reaction slot is available. A manual prompt would require pausing combat, which adds latency. Can revisit in C-340 (Party Combat).
- **Q3**: Should status effects persist across encounters, or clear on COMBAT_ENDED? **Proposal**: Clear on COMBAT_ENDED. Status effects are encounter-scoped. If a poison persists in the narrative, the next encounter's definition will re-apply it. This avoids save/load complexity.

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
