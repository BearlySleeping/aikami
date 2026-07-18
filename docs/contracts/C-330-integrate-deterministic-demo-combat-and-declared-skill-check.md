# Contract C-330: Integrate Deterministic Demo Combat and Declared Skill Checks

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md C-330 — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | Production combat overlay wiring, seedable RNG in ECS combat engine, encounter trigger pipeline from content pack, declared-DC skill check enforcement, defeat/retry UX |
| **Priority** | P0 — D&D feel requires visible uncertainty and fair mechanical consequences, not AI-authored success |
| **Dependencies** | C-316 (content pack), C-326 (`/game` boot), C-328 (dialogue overlay); pre-existing engine subsystems (turn manager C-145, enemy AI C-197, dice service, combat UI) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | None (internal mechanical integration — docs updated only if combat UX deviates from existing patterns) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Combat exists as an isolated dev sandbox (`/dev/sandbox/combat`) and is triggered only ad-hoc from dialogue overlays. The engine's `turn_manager_system.ts` uses `crypto.getRandomValues()` for dice rolls — non-deterministic, non-seedable, impossible to replay. Content packs define encounters (`ContentPackEncounterEntrySchema`) and skill checks (`ContentPackSkillCheckSchema`) but these are never read by the production game boot sequence. Dialogue skill checks (`dialogue_overlay_view_model.svelte.ts` → `rollDice()`) roll the d20 without first committing the DC to the player visually — the DC is known internally but the player sees no "DC 15 — roll to succeed" declaration before rolling.

- **Reproduction**:
  1. Boot the production game via `/game` — no combat overlay is mounted, no encounter data is loaded from content packs.
  2. Navigate to `/dev/sandbox/combat` — combat works in isolation: player attacks, enemy AI responds, HP updates, victory/defeat resolves.
  3. Trigger a dialogue with an NPC that offers a skill check — the d20 rolls, but the DC is never shown before the roll.
  4. Reload / replay a combat sequence — dice outcomes differ every time; there is no way to deterministically replay a fight.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | Combat engine (initCombat, handleCombatAction, endCombat, initiative, d20/d6 math, enemy AI) | `packages/frontend/engine/src/systems/turn_manager_system.ts` |
  | ECS combat components (CombatStats, TurnOrder, CombatTactics, Enemy) | `packages/frontend/engine/src/components/` |
  | Turn manager tests | `packages/frontend/engine/src/__tests__/turn_manager.test.ts` |
  | Combat UI — CombatViewModel (bridge ↔ ECS, AI freeform, dice animation, images, damage flash) | `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` |
  | Combat DOM views (portraits, sidebar, dice UI, gallery) | `apps/frontend/client/src/lib/views/combat/` |
  | Combat sandbox ViewModel + route | `combat_sandbox_view_model.svelte.ts`, `routes/(dev)/dev/(sandbox)/sandbox/combat/` |
  | Combat service (state, serialization) | `apps/frontend/client/src/lib/services/game/combat_service.svelte.ts` |
  | Dice service (roll, rollD20, rollCheck, rollNotation) | `apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts` |
  | Game overlay service (startCombat, COMBAT overlay type) | `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` |
  | GameUIViewModel (combatViewModel slot) | `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` |
  | Content pack encounter + skill check schemas | `packages/shared/schemas/src/lib/game/content_pack.ts` |
  | Dialogue overlay skill check (rollDice method) | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` |
  | AI combat action schema (CombatActionSchema, gatekeeping) | `apps/frontend/client/src/lib/data/ai_prompts/combat_action_schema.ts` |
  | Degradation config (combatNarration fallback) | `packages/shared/constants/src/lib/degradation.ts` |
  | GameMode type (includes 'COMBAT') | `apps/frontend/client/src/lib/types/game.ts` |

- **Known gaps**:
  1. **No seedable RNG**: The engine uses `crypto.getRandomValues()` — non-deterministic. The acceptance gate requires replay with identical mechanical outcomes.
  2. **No production encounter trigger**: `ContentPackEncounterEntrySchema` defines encounters with `enemyNpcIds`, `startDialogueKey`, `nonCombatSkillCheck`, but nothing reads these during `/game` boot.
  3. **No declared-DC UX**: Dialogue `rollDice()` knows the DC internally but the player never sees "DC 15" before clicking roll. The TODO.md acceptance gate explicitly requires "DC and modifiers are committed before RNG."
  4. **Combat overlay only in sandbox**: The CombatViewModel is constructed ad-hoc in the sandbox; the production game at `/game` has a `combatViewModel` slot in `GameUIViewModel` but it is never populated from encounter data.
  5. **No non-combat encounter resolution**: Encounters with `allowNonCombatResolution` and `nonCombatSkillCheck` have no code path to resolve via dialogue without entering combat.
  6. **No start/end transitions**: No camera transition, screen fade, or encounter intro when combat starts/ends.
  7. **No seed-pinned combat replay**: No ability to record a seed + command sequence and replay for deterministic reproduction.

- **Baseline tests**:
  - `packages/frontend/engine/src/__tests__/turn_manager.test.ts` — covers initCombat, handleCombatAction (ATTACK/FLEE/DEFEND), endCombat, defeat, and edge cases.
  - `apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts` — covers CombatViewModel bridge event handling.
  - `apps/frontend/client/src/lib/services/dice/dice_service.test.ts` — covers dice rolling, history, bounds.
  - **Note**: All existing tests pass on `main`. Run `bun moon run :test` before starting.

## User Outcome

After this contract, a player can walk into a content-pack-defined encounter on the production `/game` map, see the DC before choosing to roll a skill check, enter turn-based combat with deterministic (seed-replayable) dice, attack/flee/defend, resolve the encounter via combat or dialogue skill check, and receive the outcome — all while AI narrates but cannot rewrite mechanical results.

## Success Measures

- **Time/latency target**: Combat overlay mounts from encounter trigger within 500ms; combat action resolution (AI interpretation) within 3s.
- **Offline/degraded behavior**: Combat mechanics (dice, damage, HP, initiative) run fully offline via the ECS worker. Only AI narration degrades — falling back to authored `degradation.combatNarration` strings. The combat system itself is 100% local.
- **Production journey enabled**: Player enters Emberwatch (C-316), walks into an authored encounter zone, resolves it via combat or skill check, and the outcome feeds into C-329 (quest objective completion).

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Combat engine (initiative sorting, turns, dice math) | `packages/frontend/engine/src/systems/turn_manager_system.ts` | **Modify** — add seedable RNG, inject `diceRoller` factory |
| Existing encounter spatial trigger | `packages/frontend/engine/src/systems/encounter_system.ts` | **Modify** — extend to read content pack encounter data and set `encounterId` on COMBAT_STARTED |
| Engine bridge event types (COMBAT_STARTED) | `packages/frontend/engine/src/types.ts` | **Modify** — add `encounterId`, `combatSeed`, `allowNonCombatResolution`, `nonCombatSkillCheck` fields |
| Content pack encounter loader | `packages/frontend/engine/src/assets/content_pack_loader.ts` (`getEncounter`, `getAllEncounters`) | **Reuse** — already exists with encounter query methods; wire into encounter trigger pipeline |
| ECS combat components | `packages/frontend/engine/src/components/combat_stats.ts`, `turn_order.ts`, `enemy.ts`, `combat_tactics.ts` | **Reuse** — no changes needed |
| Combat UI (CombatViewModel, combat_view.svelte) | `apps/frontend/client/src/lib/views/combat/` | **Reuse** — wire into production overlay, no ViewModel changes |
| Combat sandbox pattern | `apps/frontend/client/src/lib/views/dev/sandbox/combat/` | **Reuse** — adapt the sandbox's bridge-listener pattern for production |
| Dice service (frontend) | `apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts` | **Modify** — add seedable overload (currently uses `Math.random()`) |
| Content pack encounter schema | `packages/shared/schemas/src/lib/game/content_pack.ts` | **Reuse** — schema is correct; build the reader/resolver |
| Content pack skill check schema | `packages/shared/schemas/src/lib/game/content_pack.ts` (`ContentPackSkillCheckSchema`) | **Reuse** — schema is correct; add declared-DC UX |
| Game overlay service (COMBAT overlay) | `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` | **Modify** — accept encounter data instead of hardcoded defaults |
| GameUIViewModel (combatViewModel slot) | `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` | **Reuse** — slot already exists, needs population |
| AI combat action schema + gatekeeping | `apps/frontend/client/src/lib/data/ai_prompts/combat_action_schema.ts` | **Reuse** — no changes needed |
| Degradation fallbacks | `packages/shared/constants/src/lib/degradation.ts` | **Reuse** — combatNarration already defined |
| Dialogue overlay skill check | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` | **Modify** — add declared-DC step before roll |
| GameMode type | `apps/frontend/client/src/lib/types/game.ts` | **Reuse** — 'COMBAT' already in union |

## Overview

Wire the existing combat engine, combat UI, and content pack encounter definitions into the production game loop. Replace the engine's non-deterministic `crypto.getRandomValues()` with a seedable RNG so combat replays produce identical mechanical results. Enforce "DC committed before RNG" in both dialogue skill checks and combat hit checks — the player always sees the target number before rolling. Add encounter trigger integration so that walking into a content-pack-defined encounter zone on `/game` transitions to combat or dialogue skill check resolution. Polish start/end transitions and defeat/retry UX.

## Design Reference

- **Combat engine pattern**: `turn_manager_system.ts` already has the `diceRoller` override parameter on `handleCombatAction()` — use this injection point for the seedable RNG. The `MockEngineBridge` test pattern is the template for deterministic tests.
- **Sandbox → production promotion pattern**: C-328 (dialogue overlay) was promoted from sandbox to production via `game_ui_view_model.svelte.ts` — same pattern for combat: `combatViewModel` slot already exists, just wire it from encounter trigger events.
- **Content pack loading pattern**: C-316 defines manifest loading; C-326 defines `/game` boot. Encounter data should be loaded alongside maps/NPCs during campaign boot, then queried when the player enters an encounter trigger zone.
- **Declared-DC pattern**: The `ContentPackSkillCheckSchema` already has `dc` and `statModifier` fields. The dialogue overlay already has a `skillCheckState` with `difficultyClass`. Add a "declare DC" phase before `rollDice()` — show the DC, the stat modifier, and the target number, then let the player roll.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

| Concern | Canonical Location | Action |
|---|---|---|
| **Seedable RNG** | `packages/frontend/engine/src/systems/turn_manager_system.ts` | Replace `rollDice` with a seedable PRNG (e.g., mulberry32). Expose `setCombatSeed(seed: number)` and `seed` parameter on `initCombat`. |
| **Encounter trigger resolver** | Extend existing `packages/frontend/engine/src/systems/encounter_system.ts` | Read `ContentPackEncounterEntry` data (via existing `content_pack_loader.ts`), spawn enemy entities with CombatStats/TurnOrder from NPC definitions, call `initCombat`. The existing system already handles spatial detection and line-of-sight — add content-pack data resolution. |
| **Production combat wiring** | `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` | Populate `combatViewModel` when COMBAT overlay activates from encounter trigger. |
| **Encounter reader** | `apps/frontend/client/src/lib/services/game/` (new or extend `combat_service`) | Load encounters from content pack manifest, resolve NPC stats, expose encounter-by-map query. |
| **Declared-DC dialogue** | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` | Add `declareCheck` phase in `skillCheckState` that shows DC and modifier before `rollDice()`. |
| **Start/end transitions** | `apps/frontend/client/src/lib/views/combat/` | Screen fade or camera zoom on combat start; victory/defeat banner with transition on end. |
| **Defeat/retry UX** | `apps/frontend/client/src/lib/views/combat/` + `game_ui_view_model` | After defeat, show game-over overlay with "Retry Encounter" option that reloads with the same seed. |
| **Combat seed persistence** | Campaign save state (Turso) | Store the combat seed so replay/reload uses the same RNG sequence. |

## State & Data Models

### Seedable RNG (Engine)

```typescript
// packages/frontend/engine/src/systems/turn_manager_system.ts

/** A seedable 32-bit PRNG returning values in [0, 1). Uses mulberry32. */
type SeedableRng = {
  /** Advance the PRNG and return a float in [0, 1). */
  next(): number;
  /** Return an integer in [1, sides] inclusive. */
  dice(sides: number): number;
  /** The current seed value (for serialization). */
  readonly seed: number;
};

/** Create a seedable PRNG from a 32-bit integer seed. */
type CreateSeedableRng = (seed: number) => SeedableRng;
```

### Combat Encounter Context (Bridge Event Extension)

```typescript
// Extend COMBAT_STARTED bridge event (engine/types.ts)
// ⚠️ Existing fields (already in types.ts):
//   - participantIds, firstTurnEntityId, enemyId?, enemyName?, enemyHp?, enemyMaxHp?
// Add these NEW fields:
type CombatStartedEvent = {
  type: 'COMBAT_STARTED';
  participantIds: number[];
  firstTurnEntityId: number;
  /** Content pack encounter ID — null for ad-hoc combat. */
  encounterId: string | null;
  /** The seed used for this encounter's RNG. */
  combatSeed: number;
  /** Whether non-combat resolution is available. */
  allowNonCombatResolution: boolean;
  /** The skill check definition if non-combat is allowed. */
  nonCombatSkillCheck?: {
    skill: string;
    dc: number;
    statModifier: 'strength' | 'dexterity' | 'intelligence' | 'charisma' | 'wisdom';
    successDialogueKey: string;
    failureDialogueKey: string;
  };
  /** Enemy display name. */
  enemyName?: string;
  /** Enemy HP. */
  enemyHp?: number;
  /** Enemy max HP. */
  enemyMaxHp?: number;
  /** The enemy entity ID. */
  enemyId?: number;
};
```

### Declared Skill Check State (Dialogue)

```typescript
// Extend existing skillCheckState in dialogue_overlay_view_model.svelte.ts
// Existing phase values: 'awaiting_click' | 'rolling' | 'revealed'
// Add 'awaiting_declaration' and 'declared' before 'awaiting_click':
type SkillCheckPhase = 'awaiting_declaration' | 'declared' | 'awaiting_click' | 'rolling' | 'revealed';

type SkillCheckState = {
  checkType: string;
  difficultyClass: number;
  statModifier: string;
  statModifierValue: number;
  targetNumber: number; // DC + statModifierValue = target
  phase: SkillCheckPhase;
  rollValue: number | null;
  isSuccess: boolean | null;
};
```

## Quality Requirements

- **Offline/degraded mode**: Combat mechanics (RNG, HP math, initiative, turns) are entirely local ECS — zero network dependency. AI narration degrades via `degradation.combatNarration` (already defined in `packages/shared/constants/src/lib/degradation.ts`). Skill check resolution is local; narrative fallout may degrade to authored dialogue keys.
- **Accessibility/input**: Combat overlay must support keyboard navigation (Tab through action buttons, Enter to confirm, Escape to open pause/flee menu). Dice roll must be triggerable by keyboard. Dialogue skill check declaration must be readable by screen readers (ARIA live region for DC announcement).
- **Performance budget**: Combat transition (mount overlay + lock engine) ≤ 500ms. Dice roll animation ≤ 1.5s (existing timing). Enemy AI evaluation ≤ 16ms (single frame budget at 60fps). Seedable RNG overhead ≤ 0.1ms per call.
- **Security/privacy**: Combat seed is a non-sensitive integer — no PII or auth concerns. Combat actions are processed in the Web Worker (ECS worker) — no network round-trip for mechanics.
- **Persistence/migration**: Combat seed must be stored in campaign save state for replay. No schema migration needed — seed is a new optional field. Old saves without seeds will generate a random seed on first combat.
- **Cancellation/retry/idempotency**: `initCombat` is already idempotent (no-op if `turnOrderList` is non-empty). `handleCombatAction` is safe to call only when combat is initialized. Defeat → retry re-initializes combat with the same seed for deterministic replay.
- **Observability**: All combat actions emit structured `COMBAT_LOG` events (already implemented). Add seed value to log for debugging. Engine bridge events are traceable via `this.debug()` in CombatViewModel (already implemented).

## Migration & Rollback

- **Old data compatibility**: Combat seed is a new optional field in campaign state. Existing saves with no seed will auto-generate a random seed on first combat encounter. No data loss.
- **Migration**: No migration required — additive field.
- **Rollback**: Remove seed field from save state; engine's `rollDice` gracefully degrades to `crypto.getRandomValues()` when no seed is provided (the existing behavior is the fallback).
- **Feature flag or kill switch**: `ENABLE_DETERMINISTIC_COMBAT` flag — add to a new file `packages/shared/constants/src/lib/feature_flags.ts`. When `false`, engine uses `crypto.getRandomValues()` (current behavior). Default `true` for Phase 1.
- **Failure recovery**: If seedable RNG produces a degenerate seed (all zeros/ones), auto-re-seed with `Date.now()` and log a warning.

## Scope Boundaries

- **In Scope:**
  - Seedable PRNG in the ECS combat engine (mulberry32 or equivalent)
  - `setCombatSeed` / seed parameter on `initCombat`
  - Production encounter trigger: read `ContentPackEncounterEntry` from loaded manifest, spawn enemy ECS entities, call `initCombat`
  - Wire CombatViewModel into `GameUIViewModel.combatViewModel` on COMBAT_STARTED from production `/game`
  - Declared-DC UX in dialogue skill checks: show DC and modifier before player clicks roll
  - Non-combat encounter resolution via skill check (when `allowNonCombatResolution` is true)
  - Start/end transitions (screen fade overlay, victory/defeat banner timing)
  - Defeat → retry with same seed
  - Store combat seed in campaign save state
  - Deterministic replay test: given a seed and command sequence, replay produces identical HP/rewards/outcome

- **Out of Scope:**
  - New combat mechanics beyond what the engine already supports (no new action types, no new status effects — that's C-338)
  - Multi-enemy encounters with complex party management (one player + one enemy is sufficient for demo; multi-party is C-340)
  - Full tactical AI overhaul (existing C-197 implementation is sufficient)
  - Combat balance or stat tuning (that's content authoring, not integration)
  - Encounter zone spatial triggers on maps (assume encounter entry is triggered via existing interaction system; spatial detection is part of C-327/C-342)
  - Visual combat effects beyond damage flash and dice animation (already implemented)
  - Audio SFX beyond what's already implemented (hit sfx, BGM crossfade)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract**: 5 ACs, 2 projects affected (engine + client), single coherent integration. **Size: OK — does not require splitting.**

## Acceptance Criteria

### AC-1: Seedable RNG Produces Deterministic Combat Replay
**Given** a combat encounter initialized with a fixed seed (e.g., `42`) and a known sequence of COMBAT_ACTION commands
**When** the encounter is executed twice with the same seed and command sequence
**Then** all dice rolls, damage values, HP totals after each action, and the final outcome (victory/defeat) are identical between runs.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/frontend/engine/src/__tests__/turn_manager.test.ts` (new test case) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: N/A — pure engine unit test
- E2E / Visual:
    - **Functional**: N/A — unit-level determinism test
    - **Visual**: N/A

**Watch Points**:
- Must use a seedable PRNG, not `crypto.getRandomValues()`. The existing `diceRoller` override parameter on `handleCombatAction` is the injection point.
- ⚠️ `initCombat` does NOT roll initiative — initiative is pre-set in TurnOrder.initiativeValue. The seed affects combat action dice (hit checks, damage rolls, enemy AI dice) only. Initiative sorting is already deterministic given the same input values and a stable tiebreaker (entity ID).
- Ensure turn order (initiative sorting) is deterministic given the same participant stats — use entity ID as tiebreaker.

### AC-2: Encounter Triggers Combat from Content Pack Definition
**Given** a loaded content pack manifest containing an encounter entry with `enemyNpcIds`, `startDialogueKey`, combat stats, and an active player on the encounter's map
**When** the encounter is triggered (via interaction or spatial overlap)
**Then** the ECS world spawns enemy entities with CombatStats/TurnOrder from the NPC definitions, `initCombat` is called, COMBAT_STARTED fires with `encounterId` set, and the combat overlay mounts over the `/game` view.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | Test in `apps/frontend/client/src/lib/views/game/` (new test or extend existing) | `/game` → encounter trigger → COMBAT overlay | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Manually walk into encounter zone on production `/game` map, verify combat overlay mounts with correct enemy name/HP
- E2E / Visual:
    - **Functional**: `tests/client/combat-encounter.spec.ts` — Playwright spec: (1) start game on prod route, (2) trigger encounter, (3) assert combat overlay visible with enemy name, (4) complete combat, (5) assert overlay dismissed
    - **Visual**: N/A — functional E2E covers this

**Watch Points**:
- Enemy NPC stats must be resolved from the content pack NPC array (via `enemyNpcIds`). If an NPC lacks `combatStats`, use sensible defaults (50 HP, 5 attack, 12 defense, 4 accuracy, 12 evasion, 10 initiative).
- Encounter trigger should be idempotent — triggering the same encounter twice without defeating the enemy first should be a no-op (defeated enemies tracked via `Enemy.spawnId`).

### AC-3: Declared-DC Skill Check in Dialogue
**Given** a dialogue with an NPC that offers a skill check (from content pack `nonCombatSkillCheck` or AI-detected intent)
**When** the player selects the skill check action
**Then** the UI displays the DC, stat modifier, and target number (e.g., "DC 15 — Persuasion (+2 CHA) → need 13 or higher on d20") before the player clicks to roll, and the roll result (success/failure) is mechanically determined by `d20 + modifier >= DC` — not by AI narration.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts` | `/game` → dialogue → skill check | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Start dialogue with an NPC offering a skill check, observe DC declaration phase, click roll, verify outcome matches math
- E2E / Visual:
    - **Functional**: `tests/client/dialogue-skill-check.spec.ts` — assert DC label visible before roll, assert roll resolves mechanically
    - **Visual**: N/A — functional E2E covers this

**Watch Points**:
- The `skillCheckState` phase machine must include `'declared'` state between `'awaiting_click'` and `'rolling'` (or replace `'awaiting_click'` with `'declared'` semantics). The DC and modifier must be visible before the playable d20 animation begins.
- AI narration of the outcome comes AFTER the mechanical resolution, not before. The existing `_executeSkillCheckAction` with `isSuccess` already does this correctly.

### AC-4: Encounter Resolves via Non-Combat Skill Check
**Given** a content pack encounter where `allowNonCombatResolution` is `true` and `nonCombatSkillCheck` is defined
**When** the player chooses the non-combat resolution path (dialogue or skill check option)
**Then** the skill check is resolved mechanically (d20 + modifier vs DC), success triggers `successDialogueKey` and marks the encounter as resolved, failure triggers `failureDialogueKey` and initiates combat.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | New test in dialogue overlay or encounter resolver | `/game` → encounter → choose non-combat → success/failure | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Trigger an encounter with non-combat option, select it, verify DC declaration → roll → success dialogue OR failure → combat
- E2E / Visual:
    - **Functional**: Combined with AC-2 spec — add non-combat resolution path
    - **Visual**: N/A

**Watch Points**:
- Non-combat resolution success must mark the encounter as complete (same as combat victory — defeated enemy tracking via `Enemy.spawnId`). The player must not be able to re-trigger the fight after talking their way out.
- Failure on a non-combat check must still provide the failure dialogue before transitioning to combat — not skip straight to initiative.

### AC-5: Defeat Retry with Same Seed Preserves Determinism
**Given** a combat encounter initialized with seed S and a player defeated after N actions
**When** the player selects "Retry Encounter" from the game-over overlay
**Then** combat re-initializes with the same seed S, the same enemy entities, and the same initiative order — producing identical mechanics if the same action sequence is followed.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + Integration | Engine test + game overlay test | `/game` → combat → defeat → retry | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`, `bun moon run client:test`
- Integration: Enter combat, lose, click "Retry", verify same enemy stats and seed
- E2E / Visual:
    - **Functional**: Extend `tests/client/combat-encounter.spec.ts` — lose combat, click retry, verify overlay remounts
    - **Visual**: N/A

**Watch Points**:
- Retry must NOT reload the map — it should only re-initialize the combat encounter. This means the game world remains loaded; only the ECS combat state resets.
- The retry button must be clearly labeled and keyboard-accessible.

## Implementation Sequence

1. **Phase 1 (Engine — Seedable RNG + Encounter Spawning)**:
   - Implement `CreateSeedableRng` (mulberry32) in `turn_manager_system.ts`
   - Add `seed` parameter to `initCombat`. Store seed in module-level state.
   - Replace all `rollDice` / `roller()` calls with seedable RNG when a seed is provided.
   - Add encounter spawn system: read NPC stats from content pack, create ECS entities with CombatStats/TurnOrder/Enemy.
   - Write unit tests for deterministic replay (AC-1).

2. **Phase 2 (Client — Production Wiring + Transitions)**:
   - Build encounter resolver service that loads encounters from content pack manifest.
   - Wire `combatViewModel` population in `GameUIViewModel` from COMBAT overlay events.
   - Add start/end transitions (fade overlay component).
   - Add defeat → retry with same seed.
   - Add declared-DC phase to dialogue skill check state machine (AC-3).
   - Implement non-combat encounter resolution (AC-4).

3. **Phase 3 (Validation)**:
   - Run `bun moon run :validate` (typecheck + lint + test).
   - Run E2E tests for combat encounter and dialogue skill check.
   - Manual smoke test on production `/game` route with Emberwatch content pack.
   - Verify AC-1 determinism with seed replay test.

## Edge Cases & Gotchas

- **Seed collision**: Two encounters using the same seed is fine — the RNG sequence restarts from the seed each time `initCombat` is called. This is actually desirable for retry.
- **Initiative ties**: When two entities have the same `initiativeValue`, the sort order must be stable (use entity ID as tiebreaker) to ensure deterministic turn order.
- **Dead entities in turn order**: `advanceTurn` already skips dead entities. Ensure `turnOrderList` is cleaned of dead participants after each turn advance to prevent stale references.
- **Enemy NPC missing combat stats**: Fall back to defaults: 50 HP, 5 attack, 12 defense, 4 accuracy, 12 evasion, 10 initiative.
- **Encounter re-trigger after non-combat success**: Must mark encounter as resolved (track via `Enemy.spawnId` or encounter-level defeated set) so walking back into the zone doesn't restart it.
- **Dialogue skill check with no content pack definition**: When AI detects skill check intent but no authored `ContentPackSkillCheck` exists, use sensible defaults (DC 12, stat from context) and still show declaration before roll.
- **AI degradation during combat**: When the AI provider is unavailable, combat mechanics still work. AI narration degrades to `degradation.combatNarration` strings. Freeform custom actions degrade to basic ATTACK.

## Open Questions

Must be resolved before status becomes `approved`:

1. **Seed storage in campaign state**: Should the combat seed be per-encounter (one seed per encounter ID) or per-campaign (one seed for the entire campaign)? Per-encounter is preferred for replay granularity, but affects save schema. Resolve during implementation.
2. **Transition animation budget**: Screen fade vs. camera zoom vs. both? The existing sandbox has no transitions. Keep it simple — a 300ms screen fade overlay. Confirm with design review.
3. **Non-combat resolution UI**: Should non-combat resolution be a separate overlay (skill check only) or embedded in the dialogue overlay as an extended action? The dialogue overlay already has skill check infrastructure — prefer embedding there.
4. **Retry UX**: After defeat, should the game offer "Retry Encounter" (same seed), "Retry with New Seed" (re-roll initiative/seed), or "Return to Last Save"? For Phase 1 demo: "Retry" (same seed) + "Load Last Save" is sufficient.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
