# Contract C-336: Extract a Deterministic Rules Kernel and Typed Game Command Protocol

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/TODO.md` § C-336 — Phase 2 — Core RPG Depth and Replayability |
| **Target** | `packages/shared/utils/src/lib/rng/`, `packages/shared/schemas/src/lib/game/rules_command.ts`, `packages/shared/types/src/lib/game/rules_command.ts`, `packages/frontend/engine/src/systems/turn_manager_system.ts` (refactor), `apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts` (refactor) |
| **Priority** | P1 — shared mechanics need one authoritative, replayable owner |
| **Dependencies** | C-313 (Campaign Aggregate — `implemented`, provides `seed: number`), C-330 (Deterministic Demo Combat — `approved`, adds seed-injection plumbing), C-335 (Playable Demo Release Gate — `approved`, references deterministic replay AC) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | None — internal infrastructure extraction |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The only deterministic PRNG (`mulberry32` `SeedableRng`) lives inside `packages/frontend/engine/src/systems/turn_manager_system.ts` — an engine-internal system with no shared package export. The client-side `DiceService` uses `Math.random()` for all rolls and has no seedable overload. The `NpcDialogueCommand` protocol (C-328) validates dialogue-level state mutations (trade, offerQuest, skillCheck, giveItem, startCombat) but there is no equivalent typed protocol for mechanical rules resolution — skill checks, attack rolls, damage application, XP grants, quest reward delivery, or relationship mutations. Each system rolls dice independently with different RNG sources, making deterministic replay impossible. The engine-level `GameCommand`/`GameEvent` types cover ECS concerns (movement, interactions, combat actions) but not the pure mechanical rules layer.

- **Reproduction**:
  1. Start combat in `/dev/sandbox/combat` — note the d20 outcomes.
  2. Reload the page and replay the same combat actions — different outcomes every time.
  3. Try to programmatically replay a skill check: there is no shared function or type to call; each system invents its own dice math inline.
  4. Search for a unified rules command type: `grep -r "RulesCommand" packages/shared/` — no results. The concept does not exist.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | `SeedableRng` type + `createSeedableRng()` factory + `setCombatSeed()` / `getCombatSeed()` / `rollDice()` helpers | `packages/frontend/engine/src/systems/turn_manager_system.ts` (lines 264–360) |
  | mulberry32 algorithm implementation (well-distributed, tested) | `turn_manager_system.ts` |
  | Seed injection point on `initCombat()` | `turn_manager_system.ts` (`seed` parameter) |
  | `diceRoller` injection on `handleCombatAction()` | `turn_manager_system.ts` |
  | NPC dialogue command protocol (TypeBox schema + Static type) | `packages/shared/schemas/src/lib/game/npc_dialogue_command.ts` |
  | Campaign aggregate `seed: number` field | `packages/shared/schemas/src/lib/game/campaign.ts` (C-313) |
  | Character sheet schemas (ability scores, skills, HP, proficiency) | `packages/shared/schemas/src/lib/database/character.ts`, `skills.ts` |
  | Content pack schemas (encounters, skill checks, quest rewards, loot, combat stats) | `packages/shared/schemas/src/lib/game/content_pack.ts` |
  | Dice service (frontend, `Math.random()`-based) | `apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts` |
  | Turn manager tests with seed validation | `packages/frontend/engine/src/__tests__/turn_manager.test.ts` (line 1259+) |
  | RELATIONSHIP_CHANGED engine event | `packages/frontend/engine/src/types.ts` (if present) |
  | Quest state schemas | `packages/shared/schemas/src/lib/game/quest_state.ts` |

- **Known gaps**:
  1. **No shared RNG package**: `SeedableRng` is trapped in an engine system — neither the dice service nor any future rules code can import it without dragging in the entire engine.
  2. **No typed rules command protocol**: Mechanical resolution (skill check math, attack rolls, damage application, XP grants, reward delivery, relationship delta computation) has no shared TypeBox schema or discriminanted union. Each system does this ad-hoc.
  3. **No replay artifact**: No `{ snapshot, seed, commandLog }` serialization format exists. Replay is impossible because the commands that produced a mechanical outcome are not recorded.
  4. **Dice service is non-deterministic**: Uses `Math.random()` with no seedable overload — inconsistent with the engine's existing `SeedableRng` migration (C-330).
  5. **No rules kernel**: There is no pure-function `resolveCommand(snapshot, command, rng)` that returns `{ newSnapshot, events }`. Engine systems mix rules math with ECS mutation and bridge emission.
  6. **Relationship mutations are undocumented**: The `CharacterRelationshipSchema` exists but there is no typed command/event envelope for trust/affinity deltas coming from quest outcomes or dialogue choices.

- **Baseline tests**:
  - `packages/frontend/engine/src/__tests__/turn_manager.test.ts` — covers `initCombat` with seed, `handleCombatAction`, deterministic dice sequences. **All pass.**
  - `apps/frontend/client/src/lib/services/dice/dice_service.test.ts` — covers roll/history/bounds. Uses `Math.random()` — no seed tests exist. **All pass.**
  - `packages/shared/schemas/src/lib/game/campaign.test.ts` — validates Campaign schema including `seed`. **All pass.**
  - `packages/shared/schemas/src/lib/game/npc_dialogue_command.test.ts` — validates command schema enforcement. **All pass.**
  - Run `bun moon run :test` before starting.

## User Outcome

After this contract, a developer can: capture an ECS snapshot + campaign seed + a log of rules commands; replay that log through the deterministic rules kernel on any runtime (browser, test, CI); and get the identical mechanical snapshot. Every system that performs rules math (combat, skill checks, XP, loot, relationship deltas) goes through the same validated command protocol — no ad-hoc `Math.random()` calls in game logic.

## Success Measures

- **Time/latency target**: Rules command resolution under 1ms per command (pure functions, no I/O). Full command-log replay of a 50-command sequence under 50ms.
- **Offline/degraded behavior**: Rules kernel is 100% local — zero network dependency. Works identically in browser, test, and CI.
- **Production journey enabled**: Deterministic replay CI gate (C-335 AC) can assert that a recorded combat/skill-check sequence produces the same outcome every run — no flaky dice in CI.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| mulberry32 PRNG algorithm | `turn_manager_system.ts` (lines 292–314) | **Extract** — move to `packages/shared/utils/src/lib/rng/` |
| `SeedableRng` type + `createSeedableRng()` | `turn_manager_system.ts` (lines 268–291) | **Extract** — move to `packages/shared/utils/src/lib/rng/` |
| `setCombatSeed` / `getCombatSeed` module state | `turn_manager_system.ts` (lines 316–344) | **Modify** — re-import from shared, keep module-level state in engine |
| `rollDice()` with seedable fallback | `turn_manager_system.ts` (lines 345–360) | **Modify** — delegate to shared `SeedableRng` |
| NPC dialogue command protocol (discriminated union pattern) | `npc_dialogue_command.ts` | **Reuse pattern** — same TypeBox discriminated union approach for rules commands |
| Campaign `seed` field | `campaign.ts` (C-313) | **Reuse** — seed source of truth for all rules RNG |
| Character sheet schemas (skills, ability scores, proficiency) | `database/character.ts`, `skills.ts` | **Reuse** — rules kernel reads these for modifier computation |
| Content pack encounter/skill-check schemas | `content_pack.ts` | **Reuse** — encounter DCs and skill check definitions are input to rules commands |
| Dice service (frontend) | `dice_service.svelte.ts` | **Modify** — add seedable overload, delegate to shared `SeedableRng` |
| Engine bridge `sendCommand` / `onEvent` pattern | `engine_bridge.ts` | **Reuse** — rules commands flow through existing bridge |
| Turn manager tests | `turn_manager.test.ts` | **Modify** — import RNG from shared, add replay tests |

## Overview

Extract the mulberry32 `SeedableRng` into a shared `packages/shared/utils` module. Define a typed `RulesCommand` / `RulesEvent` discriminated union as TypeBox schemas covering all mechanical resolution domains: skill checks, attack rolls, damage application, healing, XP grants, loot generation, quest reward delivery, and relationship mutations. Build a pure `resolveCommand()` kernel that takes `(snapshot, command, rng)` and returns `{ newSnapshot, events }` — no side effects, no I/O, fully deterministic given the same seed and command sequence. Refactor the engine's `turn_manager_system.ts` and the client's `dice_service.svelte.ts` to consume the shared RNG and command protocol. Add a replay fixture test that proves: same snapshot + seed + command log → same mechanical outcome.

## Design Reference

- **RNG extraction pattern**: The `SeedableRng` interface and `createSeedableRng()` factory already follow the pure-function pattern (no side effects, no I/O). Extract them exactly as-is into `packages/shared/utils/src/lib/rng/seedable_rng.ts`.
- **Command protocol pattern**: Follow `npc_dialogue_command.ts` — TypeBox schemas with `kind` discriminant, `additionalProperties: false`, derived `Static<>` types in `@aikami/types`. Commands and events use the same envelope pattern.
- **Rules kernel pattern**: Pure function `resolveCommand()` — stateless, no imports from engine or client. Takes snapshot + command + RNG handle, returns new snapshot + events. Follows the functional-core/imperative-shell pattern.
- **Testing**: `packages/frontend/engine/src/__tests__/turn_manager.test.ts` already tests seed determinism — extract the seed assertions into a shared test utility. Add a new `rules_command.test.ts` for the kernel itself.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Seedable RNG**: `packages/shared/utils/src/lib/rng/seedable_rng.ts` — `SeedableRng` type, `createSeedableRng(seed)` factory, re-exported from `@aikami/utils`.
- **Rules command schemas**: `packages/shared/schemas/src/lib/game/rules_command.ts` — TypeBox `RulesCommandSchema` (discriminated union on `kind`), `RulesEventSchema`, `MechanicalSnapshotSchema` (the replay artifact).
- **Rules command types**: `packages/shared/types/src/lib/game/rules_command.ts` — `Static<>` derived types, re-exported from `@aikami/types`.
- **Rules kernel**: `packages/shared/utils/src/lib/rules/rules_kernel.ts` — pure `resolveCommand()`, `replayCommandLog()`, `createMechanicalSnapshot()`. No engine/client imports.
- **Engine refactor**: `packages/frontend/engine/src/systems/turn_manager_system.ts` — remove inline mulberry32, import from `@aikami/utils`. Keep `_activeRng` module state in engine.
- **Dice service refactor**: `apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts` — add `setSeed()` method, delegate `roll()` to shared `SeedableRng`.
- **No Firebase dependency**: Rules kernel is pure TypeScript with no I/O.

## State & Data Models

```typescript
// ── Seedable RNG (extracted to shared) ──

type SeedableRng = {
  next(): number;
  dice(sides: number): number;
  readonly seed: number;
};

// Serialization helpers for mid-sequence save/resume
// serializeRng captures the mulberry32 internal state (not just the seed)
// deserializeRng restores state to resume the same sequence
type SerializedRng = {
  seed: number;
  state: number;
};

const serializeRng = (rng: SeedableRng): SerializedRng => {
  // Captures both initial seed and current internal state
};

const deserializeRng = (data: SerializedRng): SeedableRng => {
  // Restores a SeedableRng to the exact mid-sequence position
};

// ── Rules Command Protocol (discriminated on `kind`) ──

type RulesCommand =
  | {
      kind: 'rollSkillCheck';
      skill: string;
      abilityModifier: number;
      proficiencyBonus: number;
      difficultyClass: number;
      advantage: boolean;
    }
  | {
      kind: 'rollAttack';
      attackBonus: number;
      targetArmorClass: number;
      advantage: boolean;
      disadvantage: boolean;
    }
  | {
      kind: 'rollDamage';
      damageDice: string; // e.g. "1d6+2"
      isCritical: boolean;
    }
  | {
      kind: 'applyDamage';
      targetCurrentHp: number;
      amount: number;
      targetMaxHp: number;
    }
  | {
      kind: 'applyHealing';
      targetCurrentHp: number;
      amount: number;
      targetMaxHp: number;
    }
  | {
      kind: 'grantXp';
      currentXp: number;
      amount: number;
      xpToNextLevel: number;
      currentLevel: number;
    }
  | {
      kind: 'rollLoot';
      lootTable: Array<{ itemId: string; dropChance: number; quantity: number }>;
    }
  | {
      kind: 'applyRelationshipDelta';
      currentTrust: number;
      currentAffinity: number;
      trustDelta: number;
      affinityDelta: number;
      eventDescription: string;
    };

// ── Rules Events (mechanical outcomes) ──

type RulesEvent =
  | {
      kind: 'skillCheckResolved';
      naturalRoll: number;
      totalRoll: number;
      success: boolean;
      isCriticalSuccess: boolean;
      isCriticalFailure: boolean;
    }
  | {
      kind: 'attackResolved';
      naturalRoll: number;
      totalRoll: number;
      hit: boolean;
      isCriticalHit: boolean;
    }
  | {
      kind: 'damageResolved';
      naturalDamage: number;
      totalDamage: number;
      targetHpAfter: number;
      isDefeated: boolean;
    }
  | {
      kind: 'healingResolved';
      amountHealed: number;
      targetHpAfter: number;
    }
  | {
      kind: 'xpGranted';
      xpAfter: number;
      leveledUp: boolean;
      newLevel: number | null;
    }
  | {
      kind: 'lootGenerated';
      items: Array<{ itemId: string; quantity: number }>;
    }
  | {
      kind: 'relationshipUpdated';
      trustAfter: number;
      affinityAfter: number;
    };

// ── Mechanical Snapshot (replay artifact) ──

type MechanicalSnapshot = {
  seed: number;
  commandLog: Array<{ index: number; command: RulesCommand; events: RulesEvent[] }>;
  finalState: Record<string, unknown>;
};
```

TypeBox schemas in `packages/shared/schemas/src/lib/game/rules_command.ts`; derived types in `packages/shared/types/src/lib/game/rules_command.ts`.

## Quality Requirements

- **Offline/degraded mode**: N/A — rules kernel is pure TypeScript, fully offline by design.
- **Accessibility/input**: N/A — this contract is data/logic only. UI is downstream contracts.
- **Performance budget**: Single `resolveCommand()` call under 1ms. Replay of 50 commands under 50ms. RNG `next()` under 1µs.
- **Security/privacy**: TypeBox schemas enforce `additionalProperties: false` — unknown command fields rejected at validation boundary. No external data leaves the kernel.
- **Persistence/migration**: Mechanical snapshots are serializable for save files (C-334). Old saves without command logs are compatible — replay is additive, not required for loading.
- **Cancellation/retry/idempotency**: `resolveCommand()` is a pure function — idempotent by construction (same inputs → same outputs). Command log replay is deterministic, not idempotency-dependent.
- **Observability**: Every `resolveCommand()` call preserves the command `kind` and RNG state in the returned `{ events }` array. The caller (engine system) logs via `$logger`; the kernel itself remains pure with no I/O side effects. Command log index is preserved for debugging.

## Migration & Rollback

- **Old data compatibility**: Existing saves without `commandLog` in the save envelope load normally — the command log field is optional. Replay is not required for campaign continuity.
- **Migration**: Add `commandLog?: Array<{ index: number; commandKind: string }>` to the save envelope schema. No existing data mutation needed.
- **Rollback**: Remove `commandLog` field from save envelope — ignored if absent. Revert engine `import` of shared RNG back to inline mulberry32.
- **Feature flag or kill switch**: `ENABLE_RULES_COMMAND_LOG` constant in `packages/shared/constants/src/lib/feature_flags.ts` — when `false`, rules commands are executed but not recorded. Default `true` for deterministic replay.
- **Failure recovery**: If `resolveCommand()` throws (invalid command shape), the engine catches and logs the error, falls back to non-deterministic `crypto.getRandomValues()` for that single command, and continues. The command log records the failure marker. Engine never crashes on rules kernel failure.

## Scope Boundaries

- **In Scope:**
  - Extract `SeedableRng` type + `createSeedableRng()` factory to `packages/shared/utils/src/lib/rng/`
  - Define `RulesCommand` / `RulesEvent` / `MechanicalSnapshot` TypeBox schemas in `packages/shared/schemas/src/lib/game/rules_command.ts`
  - Build pure `resolveCommand()` kernel in `packages/shared/utils/src/lib/rules/rules_kernel.ts`
  - Add `replayCommandLog()` for batch deterministic replay
  - Refactor engine `turn_manager_system.ts` to import shared RNG
  - Add seedable overload to client `DiceService`
  - Add `commandLog` field to save envelope schema
  - Tests: shared RNG tests, kernel unit tests, replay fixture test, engine integration test

- **Out of Scope:**
  - Wiring rules commands into dialogue skill checks or quest reward delivery — those are downstream contracts (C-329, C-337, C-338, C-339, C-341)
  - Creating the AI turn orchestrator (C-348) — that will consume the rules kernel
  - Relationship system full implementation (C-341) — only the command/event types are defined here
  - Character progression rules (C-337) — only the XP granting command is defined; class/level rules are out of scope
  - Visual replay UI — no UI changes in this contract
  - Removing existing `Math.random()` from non-rules code (e.g., particle effects, ambient animations) — those are NOT mechanical and must stay non-deterministic

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs, 5 affected projects (`shared/utils`, `shared/schemas`, `shared/types`, `frontend/engine`, `frontend/client`). The RNG extraction and command protocol definition are tightly coupled — splitting them would create a dependency dance. The scope is a single extraction + protocol definition, not multiple independently releasable systems. **Size: ok — proceed as one contract.**

## Acceptance Criteria

### AC-1: SeedableRNG Is Extracted to a Shared Package with Identical Behavior
**Given** the existing `SeedableRng` type, `createSeedableRng()` factory, and mulberry32 algorithm in `packages/frontend/engine/src/systems/turn_manager_system.ts`
**When** the RNG code is moved to `packages/shared/utils/src/lib/rng/seedable_rng.ts` and the engine re-imports it
**Then** all existing turn manager tests pass unchanged, `createSeedableRng(42).dice(20)` returns the same sequence as before, and the shared module exports: `SeedableRng` type, `createSeedableRng()`, `serializeRng()`, and `deserializeRng()`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/utils/src/lib/rng/__tests__/seedable_rng.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run shared-utils:test`
- Integration: Run `bun moon run :test` — all 4 turn manager tests pass without modification
- E2E / Visual:
    - **Functional**: N/A — pure unit test, no browser dependency
    - **Visual**: N/A

**Watch Points**:
- The RNG must produce identical sequences to the current engine implementation — any algorithm drift breaks replay compatibility
- `serializeRng()` must capture enough state to resume RNG mid-sequence (for save/restore across sessions)

### AC-2: Rules Command Protocol Is Defined as TypeBox Schemas
**Given** no existing mechanical rules command protocol exists in shared packages
**When** `RulesCommandSchema` (discriminated union on `kind`) and `RulesEventSchema` are defined in `packages/shared/schemas/src/lib/game/rules_command.ts` with derived `Static<>` types in `packages/shared/types/src/lib/game/rules_command.ts`
**Then** `Value.Check(RulesCommandSchema, validCommand)` passes for all command variants, unknown `kind` values are rejected, `additionalProperties` on extra fields is rejected, and all variants (skillCheck, attack, damage, healing, xp, loot, relationship) are covered with validated numeric ranges

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/shared/schemas/src/lib/game/rules_command.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run shared-schemas:test`
- Integration: Import `RulesCommand` from `@aikami/types` in any package — type-check passes
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A

**Watch Points**:
- Follow the `npc_dialogue_command.ts` pattern exactly: `additionalProperties: false`, `kind` discriminant, `Type.Union` of `Type.Object` variants
- `damageDice` string must match the pattern `^\d+d\d+(\+\d+)?$` (same as `content_pack.ts`)
- All numeric fields use `Type.Integer` with appropriate `minimum`/`maximum` bounds

### AC-3: Deterministic Rules Kernel Produces Identical Results for Same Inputs
**Given** a `resolveCommand(snapshot, command, rng)` pure function in `packages/shared/utils/src/lib/rules/rules_kernel.ts` with zero dependencies on engine or client
**When** the same `(snapshot, command, seed)` inputs are provided 100 times
**Then** the output `{ newSnapshot, events }` is byte-identical every time, the RNG advances by exactly the number of dice rolls the command requires, and `replayCommandLog(snapshot, commandLog, seed)` produces the same final snapshot regardless of runtime (browser, Node, Bun)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `packages/shared/utils/src/lib/rules/__tests__/rules_kernel.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run shared-utils:test`
- Integration: Run the replay test 100 times in CI — assert snapshot hash is identical every time
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A

**Watch Points**:
- `resolveCommand()` must NOT mutate the input `snapshot` — return a new object
- The kernel must NOT import from `@aikami/frontend/engine` or any client package
- RNG state must be advanced by external caller (the kernel receives rng, calls `rng.dice()`, returns the still-advanced rng handle — not a copy)

### AC-4: Engine and Dice Service Consume Shared RNG
**Given** the shared `SeedableRng` is available from `@aikami/utils`
**When** `turn_manager_system.ts` removes inline mulberry32 and imports `createSeedableRng` from `@aikami/utils`, and `DiceService` gains a `setSeed(seed: number)` method that delegates `roll()` to a shared `SeedableRng`
**Then** all existing engine tests pass, `DiceService` produces identical roll sequences when seeded with the same value, and the `dice_service.test.ts` gains a new test: "given the same seed, rollD20 returns the same natural/total"

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Integration | `packages/frontend/engine/src/__tests__/turn_manager.test.ts` (modified), `apps/frontend/client/src/lib/services/dice/dice_service.test.ts` (modified) | `/game` combat, `/dev/sandbox/combat` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`, `bun moon run client:test`
- Integration: Open `/dev/sandbox/combat`, attack 3 times, reload, attack 3 times with same seed — same combat log messages
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/combat_sandbox.spec.ts` — existing tests pass
    - **Visual**: N/A

**Watch Points**:
- Engine `_activeRng` module-level state stays in `turn_manager_system.ts` — only the factory/type moves to shared
- `DiceService.setSeed(null)` must revert to non-deterministic `crypto.getRandomValues()` for non-mechanical rolls
- Do NOT remove `crypto.getRandomValues()` fallback from engine — it's the default when no seed is set (random encounters)

### AC-5: Replay Fixture Proves Deterministic Round-Trip
**Given** an ECS snapshot captured during a combat encounter with a known seed and a command log of player/enemy actions
**When** the snapshot is deserialized, the command log is replayed through `replayCommandLog()`, and a new snapshot is captured at the same turn boundary
**Then** the final snapshot's mechanical state (HP values, status effects, XP, completed quests) is identical to the original session, and a CI test asserts this with a snapshot hash comparison

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `packages/frontend/engine/src/__tests__/replay_fixture.test.ts` | N/A (CI-only gate) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run :test` — replay fixture test included in CI suite
- Integration: Record a combat sequence → save snapshot + seed + command log → replay in a fresh test run → hash comparison passes
- E2E / Visual:
    - **Functional**: N/A — integration test, no browser needed
    - **Visual**: N/A

**Watch Points**:
- Snapshot must NOT include non-mechanical state (PixiJS transforms, animation frames, particle positions) — only ECS components that affect mechanical outcomes
- Replay fixture must use the same `ContentPackManifest` data as the original encounter for NPC stat resolution
- The test must fail if any mechanical field diverges (HP, status, inventory counts, quest progress, XP)

## Implementation Sequence

1. **Phase 1 (RNG Extraction)**: Move `SeedableRng` type + `createSeedableRng()` + tests to `packages/shared/utils/src/lib/rng/`. Add `serializeRng()` / `deserializeRng()`. Refactor engine and dice service to import shared RNG. Verify all existing tests pass.

2. **Phase 2 (Command Protocol)**: Define `RulesCommandSchema` / `RulesEventSchema` / `MechanicalSnapshotSchema` in `packages/shared/schemas/src/lib/game/rules_command.ts`. Derive types in `@aikami/types`. Add validation tests. Add `commandLog` field to save envelope schema.

3. **Phase 3 (Rules Kernel)**: Build pure `resolveCommand()` + `replayCommandLog()` in `packages/shared/utils/src/lib/rules/rules_kernel.ts`. Add kernel unit tests covering all command variants. Add replay fixture test proving determinism.

4. **Phase 4 (Validation)**: Run `bun moon run :validate`. Run `bun moon run :test` 10 times — zero flakes on replay tests.

## Edge Cases & Gotchas

- **RNG state serialization**: `serializeRng()` must capture `state` (the mulberry32 internal value). Do NOT just capture `seed` — mid-sequence, the state has advanced beyond the initial seed. Use `seed` for fresh RNG creation, `serializeState()` for mid-sequence save/resume.
- **Command log ordering**: Commands must be timestamped with a logical `index` (not wall-clock time) to guarantee deterministic replay across machines with different clock speeds.
- **Damage dice parsing**: Strings like `"1d6+2"` must be parsed by the kernel — the kernel must NOT import from content pack schemas. The parser lives in shared utils alongside the kernel.
- **Advantage/disadvantage mutual exclusion**: The `rollAttack` command must reject both `advantage: true` and `disadvantage: true` — they cancel to a normal roll per D&D 5e rules.
- **HP clamping**: `applyDamage` must clamp at 0 (never negative HP). `applyHealing` must clamp at `targetMaxHp`. The kernel must enforce these bounds.
- **Loot roll independence**: Each loot entry rolls independently — the RNG advances once per entry, not once per table. This guarantees partial loot is deterministic (unlucky roll on item 2 doesn't affect item 3).
- **Relationship clamping**: Trust and affinity must clamp to `[-100, 100]` bounds per the existing `CharacterRelationshipSchema`.

## Open Questions

Must be resolved before status becomes `approved`:

- **Q1**: Should `RulesCommand` include inventory mutations (addItem, removeItem, equipItem) or are those handled by the existing `NpcDialogueCommand` protocol? **Proposal**: Inventory mutations stay in `NpcDialogueCommand` for now; `RulesCommand` handles only pure mechanical resolution. Inventory commands can be added to `RulesCommand` in a follow-up if replay needs them.
- **Q2**: Should the `MechanicalSnapshot` include full ECS component data or only mechanical-relevant fields? **Proposal**: Mechanical-only fields (HP, status effects, XP, inventory counts, quest progress). Full ECS snapshots already exist for save/load — the replay artifact is a subset for CI gating.
- **Q3**: What happens when a `RulesCommand` variant is deprecated — how does the schema handle old command logs? **Proposal**: Add a `version` field to `MechanicalSnapshot` — the kernel checks the version before replay and rejects unknown versions. Deprecated commands remain in the schema union with a `@deprecated` JSDoc tag.

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
