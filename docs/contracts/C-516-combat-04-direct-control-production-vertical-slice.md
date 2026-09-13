---
id: C-516
title: "Contract C-516: Combat-04 — Direct-Control Production Vertical Slice"
source: "docs/architecture/combat_2.md §7.1, §10, §16, §21.4, §22 (Combat-04)"
contract_type: full
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-13T00:00:00Z"
---

# Contract C-516: Combat-04 — Direct-Control Production Vertical Slice

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/architecture/combat_2.md` §7.1 (direct player action), §10 (spatial battlefield), §16 (bridge/UI), §21.4 (proof encounter), §22.2 (feature-flag migration) — Combat-04 |
| **Target** | `combatEngine` flag, encounter-start adapter + content roster, production ability catalog, v2 resolver + event mapping, direct-control tactical UI (move/ability/target/preview), proof encounter content, `/game` E2E |
| **Type** | full |
| **Priority** | P1 — this is the first playable Combat 2.0 slice; it turns the verified engine, turn coordinator, and tactical API into a production direct-control encounter |
| **Dependencies** | C-509 (`implemented` — kernel/`combat_kernel.ts` + `combat_state_adapter.ts#applyCombatResult` + their tests are on disk; PROGRESS.md shows `✅ verified`), C-514 (`verified`), C-515 (`verified`), C-330 (`implemented`), C-337/C-338 (`implemented`), C-500 (`implemented`, overlay/mount) |
| **Status** | approved |
| **Promotion** | `—` |
| **Docs Impact** | user-facing → `apps/frontend/docs/src/content/docs/` combat control/engine note (only if the flag is documented; otherwise internal → none) |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — encounter → `COMBAT` overlay → direct controls (move / ability / target / preview / defend / flee / end turn) resolving through `packages/frontend/engine/src/combat/combat_v2_resolver.ts#resolveV2CombatCommand`, with `combatEngine: 'legacy' \| 'v2'` selecting the engine at encounter start |

## Problem & Baseline Evidence

- **Current behavior**: The deterministic v2 engine exists but production combat is a stub-overlay over a legacy resolver, and the player cannot move or choose abilities.
  1. **No production v2 start.** `initCombat`/`startCombatTurns` are reachable only from `RETRY_ENCOUNTER` (`packages/frontend/engine/src/worker/ecs_worker.ts:628–637`). `packages/frontend/engine/src/systems/encounter_system.ts` emits `COMBAT_STARTED` (`L205–216`) but never starts turns, so engine actions drop.
  2. **Two disconnected entry funnels.** The dialogue combat chip (`dialogue_overlay_view_model.svelte.ts#_handleDirectCombat` L2876–2895 → `game_overlay_service.startCombat` L1272–1289) hardcodes `enemyHp: 60`/`participantIds: [1, 2]` and bypasses the engine; the collision path (`encounter_system.ts#_triggerEncounter` L181, L205–216) has real entities but starts no turns.
  3. **`spawnEncounterEnemy` is dead code.** `packages/frontend/engine/src/systems/encounter_system.ts:270–337` has zero production callers; content-pack `combatStats` (`packages/shared/schemas/src/lib/game/content_pack.ts:175`, Emberwatch `rollo_grasper` L988–995) never reach ECS `CombatStats`.
  4. **No production ability catalog.** `StartCombatTurnsOptions.abilityCatalog` defaults to `{}` (`packages/frontend/engine/src/combat/combat_turn_driver.ts:99,508`); only test fixtures exist. `CLASS_REGISTRY` (`packages/shared/constants/src/lib/game/classes.ts:512`) uses a different schema (`ClassFeature`/`AbilityActivation`) than `CombatAbilityDefinition` — schema at `packages/shared/schemas/src/lib/game/combat/combat_state.ts:134–154`, type re-exported from `packages/shared/types/src/lib/game/combat/combat_state.ts:39`.
  5. **`COMBAT_ACTION` always routes to the legacy resolver** (`combat_command_dispatch.ts`, `case 'COMBAT_ACTION'`); no engine choice and no `combatEngine` flag.
  6. **The UI has no direct tactical controls.** `apps/frontend/client/src/lib/views/combat/combat_sidebar.svelte` has only Attack (L259), Defend (L268), Flee (L277), a freeform text form (L282–315), and End Turn (`apps/frontend/client/src/lib/views/combat/components/turn_tracker_header.svelte` L78–87). There is **no ability button, target picker, move/click-to-move control, or preview overlay**; the ViewModel listens to no `COMBAT_PREVIEW_*` events and sends no preview requests.
  7. **Click-to-move is explore-only.** `PointerController._handlePointerDown` (`packages/frontend/engine/src/game_world/pointer_controller.ts:175–186`) posts `MOVE_TO_CELL` only when not locked; `SET_GAME_MODE=COMBAT` locks movement, and `MOVE_TO_CELL` is exploration locomotion, not a budgeted tactical move.
  8. **No proof encounter content.** No multi-enemy encounter or companion-vs-three roster exists; the only Emberwatch encounter is single-enemy (`inn_wand_encounter`, manifest L1848–1879). There are no map enemy spawn points and no environmental props (those are Combat-07/08).
  9. **Turn/state truth is split.** Legacy mutates `CombatStats` and emits `COMBAT_LOG`; the v2 driver emits `TURN_CHANGED`/`ACTION_ECONOMY_CHANGED`, but `applyCombatResult` is never routed to a production commit.

- **Reproduction**:
  1. Start combat from dialogue in `/game` → overlay opens with a fake 60-HP enemy and no engine turn state; click Attack → nothing mechanical resolves.
  2. Walk into an enemy → `COMBAT_STARTED` fires but `initCombat` is never called.
  3. `rg "COMBAT_PREVIEW_REQUESTED|combatEngine" apps packages` → no client sender, no flag.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | v2 kernel/adapter/driver/preview | `packages/frontend/engine/src/combat/` (`combat_turn_driver.ts`, `combat_state_adapter.ts`, `combat_preview_handler.ts`, `combat_command_dispatch.ts`) |
  | Pure tactical queries (endpoints/range/LoS/forecast) | `packages/shared/utils/src/lib/rules/combat_tactical.ts`, `combat_spatial.ts` |
  | Kernel commit | `combat_kernel.ts#resolveCombatCommand` (L516) |
  | Encounter → ECS spawn | `packages/frontend/engine/src/systems/encounter_system.ts#spawnEncounterEnemy` (L270–337) |
  | Combat components to register | `packages/frontend/engine/src/components/combat_identity.ts`, `combat_movement.ts` (both `export const` SoA components) |
  | Content-pack encounters/stats | `packages/shared/schemas/src/lib/game/content_pack.ts`, Emberwatch `manifest.json` |
  | Class abilities | `packages/shared/constants/src/lib/game/classes.ts` (`CLASS_REGISTRY` L512) |
  | Flag/env pattern | `packages/frontend/configs/src/lib/feature_flags.ts`, `environment.ts`, client `env.ts` |
  | Existing controls + ViewModel | `apps/frontend/client/src/lib/views/combat/combat_sidebar.svelte`, `combat_view_model.svelte.ts`, `components/turn_tracker_header.svelte` |
  | Pointer click→cell | `packages/frontend/engine/src/game_world/pointer_controller.ts` (L175–186) |
  | E2E seam + suites | `game_composition_root.svelte.ts` (L549–643), `apps/e2e/tests/client/combat.spec.ts`, `combat.visual.ts` |

- **Known gaps**: no flag; no v2 encounter start; no ability catalog; no v2 `COMBAT_ACTION` resolver; no `CombatEvent`→bridge mapping; no tactical controls/preview loop; no click-to-move in combat; no proof encounter content.

- **Baseline tests** (capture green before starting):
  - `packages/frontend/engine/src/__tests__/{turn_manager,combat_turn_flow,combat_preview_bridge,combat_state_adapter,combat_battlefield}.test.ts`.
  - `packages/shared/utils/src/lib/rules/__tests__/{combat_kernel,combat_tactical,combat_turn_coordinator}.test.ts`.
  - `apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts`, `tests/turn_tracker.test.ts`.
  - `apps/e2e/tests/client/combat.spec.ts`, `apps/e2e/tests/game/click_to_move.spec.ts`.
  - Moon: `frontend-engine:test`, `utils:test`, `client:test`, `schemas:test`.

## User Outcome

After this contract, a player entering combat in production `/game` can play the encounter entirely with direct controls: click a highlighted cell to move within their movement budget, pick an ability from their hotbar, pick a legal target (with a preview showing path, cost and hit/damage forecast), attack, defend, flee, and end their turn. Enemies and companions take their own turns under the deterministic engine. The `combatEngine` flag keeps the legacy resolver available, and the proof encounter (player + one companion versus three enemies) can be completed to victory or defeat.

## Success Measures

- **Time/latency target**: preview response within one rendered frame for ordinary actions (target from C-515's budget); v2 commit (snapshot → kernel → apply) under 16 ms; encounter start within one frame of the overlay.
- **Offline/degraded behavior**: v2 combat is fully deterministic/local; no AI or network on the direct-control path. The engine choice is fixed at encounter start, so a provider outage cannot affect resolution.
- **Production journey enabled**: `/game` encounter → COMBAT → direct-control play (move/ability/target/preview/attack/defend/flee/end turn) → victory or defeat → back to EXPLORE on the v2 engine.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| v2 kernel/driver/adapter/preview | `packages/frontend/engine/src/combat/` | reuse — add v2 resolver + event/UI mapping |
| Tactical queries | `combat_tactical.ts`, `combat_spatial.ts` | reuse |
| Content-pack encounter spawn | `packages/frontend/engine/src/systems/encounter_system.ts#spawnEncounterEnemy` | modify — wire into production start |
| Class abilities | `constants/.../classes.ts` | modify — map to `CombatAbilityDefinition` |
| Flag/env | `configs/.../feature_flags.ts`, `environment.ts`, client `env.ts` | modify — add `combatEngine` |
| Existing controls/ViewModel | `combat_sidebar.svelte`, `combat_view_model.svelte.ts` | modify — add move/ability/target/preview state |
| Pointer click→cell | `pointer_controller.ts` | modify — combat-aware direct control |
| Legacy resolver | `turn_manager_system.ts#handleCombatAction` | keep — selected when flag is `legacy` |
| E2E seam/suites | `game_composition_root.svelte.ts`, `combat.spec.ts` | modify — real encounter + tactical controls |

## Overview

Combat-04 is the first playable Combat 2.0 slice. It introduces the `combatEngine: 'legacy' | 'v2'` choice at encounter start; a start-encounter path that spawns the content-pack roster (player, one companion, three enemies) into ECS components and starts the v2 driver exactly once; a production `CombatAbilityDefinition` catalog derived from existing class abilities plus a basic attack; a v2 resolver that turns the existing `COMBAT_ACTION`/`COMBAT_END_TURN` commands into kernel commands, commits the returned state through the ECS adapter, and maps C-509 `CombatEvent`s onto the bridge events the sidebar already consumes; a direct-control tactical UI that requests previews, highlights reachable endpoints, lets the player pick an ability and a legal target, and commits a budgeted move; and a proof encounter authored in the content pack. Legacy is preserved and remains the fallback. Environmental props, objectives, morale, reactions, and natural-language input are explicitly later slices.

## Design Reference

- **Governing architecture**: `combat_2.md` §5.1 (controllers vs rules), §7.1 (direct action flow), §10 (quantization + tactical projection), §16 (bridge/UI), §21.4 (proof encounter), §22.2 (choose composition once).
- **Pure-core/projection split**: resolve in the pure kernel; apply via `applyCombatResult`; never recompute mechanics in the engine or UI.
- **Flag pattern**: `FEATURE_FLAG_KEYS` for the engine key; choose once at encounter start, route through an adapter (no per-action branching). `getPublicMode()` is unrelated — it gates the E2E/`__AIKAMI_TEST__` seam, **not** the engine choice, so never derive the engine from it.
- **UI pattern**: `combat_sidebar.svelte` + `combat_view_model.svelte.ts` MVVM; the ViewModel stores selection/preview projections only — never HP/turn truth.
- **Pointer pattern**: `pointer_controller.ts` click→cell; make it combat-aware rather than adding a second listener.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Flag**: add `combatEngine: 'legacy' | 'v2'` via `PUBLIC_COMBAT_ENGINE` in the config env schema/validator and the config `featureFlags`; add the key to `FEATURE_FLAG_KEYS` (`packages/shared/constants/src/lib/feature_flags.ts`). Default `legacy`; any invalid/unset value also resolves to `legacy`. Read once at encounter start and stored on the encounter/driver.
- **Encounter start**: add `COMBAT_START_ENCOUNTER { encounterId; seed; engine? }` handled in the worker, and add the command to the `CombatBridgeCommand` union in `packages/frontend/engine/src/combat/combat_bridge_types.ts` (today it is only `CombatEndTurnCommand | CombatPreviewRequestedCommand`). It spawns/resolves the content-pack roster (reuse `spawnEncounterEnemy` + NPC combat stats), registers `CombatIdentity`/`CombatMovement`/`TurnOrder`, then calls `startCombatTurns` (v2) or `initCombat` (legacy) exactly once. Both entry funnels converge here; no hardcoded `[1,2]`/60-HP roster.
- **Ability catalog**: a production module exporting `CombatAbilityDefinition[]` (`basic_melee` + mappable `CLASS_REGISTRY` abilities), injected into `startCombatTurns`/v2 snapshots and exposed to the UI for the ability picker.
- **v2 resolver**: `packages/frontend/engine/src/combat/combat_v2_resolver.ts` (new file) — `resolveV2CombatCommand(world, bridge, command)`. Maps `COMBAT_ACTION(ATTACK|ABILITY|DEFEND)`/`COMBAT_END_TURN` to kernel commands, snapshots state + battlefield, calls `resolveCombatCommand`, applies via `applyCombatResult`, and maps events. `combat_command_dispatch.ts` chooses legacy vs v2 from the encounter engine. `FLEE` is **not** a kernel command — dispatch handles it as the existing party-retreat exit before the engine branch (see Edge Cases).
- **Event mapping**: map C-509 `CombatEvent`s to `COMBAT_LOG`/`COMBAT_STATE_UPDATE`/`DAMAGE_DEALT`/`TURN_CHANGED`/`ACTION_ECONOMY_CHANGED`/`COMBAT_ENDED` so the existing sidebar renders v2 unchanged.
- **UI direct control**: extend `CombatViewModel` with selection/preview state and a preview request/handle loop over `COMBAT_PREVIEW_REQUESTED`/`COMBAT_PREVIEW_READY`/`COMBAT_PLAN_REJECTED`; add move, ability, and target controls to `combat_sidebar.svelte` and `components/turn_tracker_header.svelte`; make `PointerController` (`packages/frontend/engine/src/game_world/pointer_controller.ts`) issue a budgeted v2 combat move (not `MOVE_TO_CELL`) while a combat move selection is active.
- **Proof encounter**: author a content-pack encounter (player + 1 companion vs 3 enemies) plus the spawn wiring; the Combat-04 proof is combat only — environmental props and non-kill objectives are Combat-07/08.
- No LLM/NL, reactions, cover, threat zones, surfaces, objectives, morale, or save/reload parity.

## State & Data Models

```ts
// ── Feature flag ──

type CombatEngineKind = 'legacy' | 'v2'; // PUBLIC_COMBAT_ENGINE, default 'legacy'
```

```ts
// ── Start encounter (new GameCommand) ──

type CombatStartEncounterCommand = {
  type: 'COMBAT_START_ENCOUNTER';
  encounterId: string;
  seed: number;
  engine?: CombatEngineKind;   // defaults to the resolved flag
};

// COMBAT_STARTED gains an ADDITIVE `engine` field. Every existing field emitted by
// `encounter_system.ts` (`participantIds`, `firstTurnEntityId`, `enemyId`, `enemyHp`,
// `enemyMaxHp`, `combatSeed`, `encounterId`, `allowNonCombatResolution`,
// `nonCombatSkillCheck`) is unchanged — `engine` is the only addition, so legacy
// consumers keep working.
type CombatStartedWithEngine = {
  type: 'COMBAT_STARTED';
  participantIds: number[];
  firstTurnEntityId: number;
  engine: CombatEngineKind;
};
```

```ts
// ── Production ability catalog ──
// 🔴 REUSE — do not redeclare this type. `CombatAbilityDefinition` already exists
// as `CombatAbilityDefinitionSchema` (`packages/shared/schemas/src/lib/game/combat/combat_state.ts:134–154`)
// and is re-exported as a type from `packages/shared/types/src/lib/game/combat/combat_state.ts:39`
// (import path `@aikami/types`). Shape reproduced below for reference only:

type CombatAbilityDefinition = {
  abilityId: string;
  name: string;
  kind: CombatAbilityKind;         // 'melee_attack' | 'ranged_attack' | 'defend' | 'utility'
  actionCost: CombatActionCost;    // 'action' | 'quick' | 'reaction' | 'free'
  attackBonus: number;
  damageDice: string | null;
  damageType: DamageTypeKey | null;
  rangeCells: number;
  requiresLineOfSight: boolean;
};

// BASIC_COMBAT_ABILITIES: Record<string, CombatAbilityDefinition>, exported from
// `packages/shared/constants/src/lib/game/combat_abilities.ts` (recommended location —
// which is why AC-3's evidence runs `constants:test`). Contains basic_melee
// (action, melee_attack, 1d6, slashing, range 1, no LoS requirement) plus
// class-ability mappings derived from `CLASS_REGISTRY`.
// Every entry must pass `Value.Check(CombatAbilityDefinitionSchema, entry)` (AC-3).
```

```ts
// ── Direct-control UI state (ViewModel projection only) ──

type CombatSelectionMode = 'idle' | 'move' | 'ability' | 'target';

type CombatSelectionState = {
  mode: CombatSelectionMode;
  requestId: string | null;
  selectedAbilityId: string | null;
  legalEndpoints: GridPoint[];
  legalTargetIds: string[];
  forecast: ActionForecast | null;
  pendingCommand: CombatCommand | null;
  status: 'idle' | 'loading' | 'ready' | 'rejected';
  rejection?: { reasonCode: string; messageKey: string };
};
```

```ts
// ── Proof encounter content (additive to the content pack) ──

// A new encounter (e.g. `emberwatch/proof_encounter`) with:
//   enemyNpcIds: [three distinct enemy NPCs with combatStats],
//   companion: the existing companion path,
//   spawn positions on a battle map/room,
//   seedable encounter start.
```

## Quality Requirements

- **Offline/degraded mode**: v2 resolution and previews are pure/local; no AI or network on the direct-control path. Legacy is the default fallback.
- **Accessibility/input**: move/ability/target are reachable by keyboard and pointer; controls have accessible labels and clear disabled states while a preview loads; the existing Escape/exit affordance still works.
- **Performance budget**: preview < one frame; commit < 16 ms; no snapshot in the render loop beyond an explicit request; cache the battlefield projection keyed by a terrain/occupancy revision if needed.
- **Security/privacy**: start/preview/command payloads carry only authored ids, seeds, and cell/target selections — never free text or model output; the engine validates actor/turn ownership and revision.
- **Persistence/migration**: no persisted schema change. `CombatIdentity`/`CombatMovement` stay non-persistent (documented); save/reload combat parity is a later slice.
- **Cancellation/retry/idempotency**: start is idempotent per active encounter; previews are idempotent per revision and carry a `requestId`; commits use the revision guard; RETRY reinitializes with the preserved seed.
- **Observability**: log the chosen engine, start, and typed rejections via `$logger`; no per-frame logging.

## Migration & Rollback

- **Old data compatibility**: N/A — no persisted state changes; old saves load normally.
- **Migration**: none.
- **Rollback**: set `PUBLIC_COMBAT_ENGINE=legacy` (default) or remove the flag; legacy behaviour is fully preserved.
- **Feature flag or kill switch**: `combatEngine` is the kill switch, chosen at encounter start; an encounter never changes engine mid-fight (§19/§22.2).
- **Failure recovery**: a missing catalog/roster/capability falls back to the legacy engine for that encounter and logs, rather than starting a broken v2 fight.

## Scope Boundaries

- **In Scope:**
  - `combatEngine` flag; start-encounter `GameCommand`; converging both entry funnels; content-roster spawn.
  - Production `CombatAbilityDefinition` catalog with `basic_melee` + mappable class abilities.
  - v2 resolver for `ATTACK`/`ABILITY`/`DEFEND` + `END_TURN` (with `FLEE` kept as the existing party-retreat exit, outside the kernel) and C-509→bridge event mapping.
  - Direct-control UI: preview request/handle loop, reachable-endpoint highlighting, click-to-move, ability picker, target picker, forecast panel.
  - Proof encounter content (player + 1 companion vs 3 enemies) and production `/game` E2E.
  - Legacy preserved behind the flag.

- **Out of Scope:**
  - Environmental props / object affordances / improvised actions (Combat-07).
  - Objectives, morale, reactions, cover, threat zones, opportunity attacks (Combat-08).
  - Natural-language intent, LLM enemies/companions, narration (Combat-05/06).
  - SUPPORT/REVIVE parity in v2, items/objects, non-kill encounter resolution in v2.
  - Persisting `CombatIdentity`/`CombatMovement`; save/reload combat parity.
  - Removing legacy combat code.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** This was originally drafted as Combat-04a (engine/content) + Combat-04b (tactical UI/proof) per §23.6. The maintainer elected a **single Combat-04** to keep the vertical slice whole, so the contract is deliberately one cohesive outcome: *a production encounter can be played with direct tactical controls on the deterministic engine*. All ACs share the encounter/ability/command model and the same `/game` journey; they are independently verifiable but not independently mergeable. ~10 ACs, 5 projects (`constants`/`configs`, `schemas`, `utils`, `frontend-engine`, `client`) plus `e2e`. **Size: large but one concern — proceed as one contract; if the diff must be staged, implement in the listed phases without declaring partial completion.**

## Acceptance Criteria

### AC-1: `combatEngine` chooses the engine once at encounter start
**Given** `PUBLIC_COMBAT_ENGINE` unset or invalid
**When** the config env is validated
**Then** `combatEngine` resolves to `legacy`; a valid `v2` selects v2; the choice is read once at encounter start and stored on the encounter/driver; no per-action runtime branch on the flag exists.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/constants/src/lib/feature_flags.test.ts` + a client/config env test | `packages/frontend/configs/src/lib/feature_flags.ts`, `environment.ts` + tooling: `bun moon run constants:test`, `bun moon run client:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run constants:test`, `bun moon run client:test`
- Integration: invalid → `legacy`; explicit `v2` → v2.
- E2E / Visual: N/A.

**Watch Points**: keep the default `legacy`; choose once, not per command.

### AC-2: A production encounter starts real ECS combat with the content roster
**Given** a content-pack encounter with `enemyNpcIds` and `combatStats`
**When** the encounter starts from either production funnel
**Then** the player, companion, and enemies are present as ECS combatants with `CombatStats`/`CombatMovement`/`TurnOrder`/`CombatIdentity` from authored data, `startCombatTurns` (v2) or `initCombat` (legacy) runs exactly once, `COMBAT_STARTED` carries the real participants and `engine`, and no hardcoded `[1, 2]`/60-HP roster remains.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `packages/frontend/engine/src/__tests__/combat_v2_start.test.ts` (new) | `packages/frontend/engine/src/systems/encounter_system.ts#spawnEncounterEnemy` + `COMBAT_START_ENCOUNTER` handler in `worker/ecs_worker.ts` + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: spawn a proof fixture; assert stats, initiative, single start; dialogue and collision funnels converge.
- E2E / Visual: existing `combat.spec.ts` passes.

**Watch Points**: idempotent start; both funnels; content stats map per `COMBAT_STATS_FIELD_MAP` (`defense` unmapped).

### AC-3: A production ability catalog is injected into v2
**Given** the v2 engine starts
**When** the catalog is built
**Then** it contains `basic_melee` and every class ability that maps faithfully to `CombatAbilityDefinition`; entries are schema-valid; the catalog is injected into `startCombatTurns`/v2 snapshots and exposed to the UI; an unknown ability is rejected with `abilityUnknown` (never a throw).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Integration | `packages/shared/constants/src/lib/game/combat_abilities.test.ts` (new) + `combat_v2_start.test.ts` | `packages/shared/constants/src/lib/game/combat_abilities.ts` (new, recommended location) + tooling: `bun moon run constants:test`, `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run constants:test`, `bun moon run frontend-engine:test`
- Integration: `Value.Check` every entry; unknown ability rejected.
- E2E / Visual: N/A.

**Watch Points**: map only faithful abilities; no invented mechanics; catalog and `CLASS_REGISTRY` must not silently diverge.

### AC-4: Direct commands resolve through the v2 kernel when selected
**Given** a v2 encounter with the active combatant
**When** `COMBAT_ACTION(ATTACK|ABILITY|DEFEND)` or `COMBAT_END_TURN` is received
**Then** the resolver snapshots state + battlefield, calls `resolveCombatCommand`, applies via `applyCombatResult`, advances `stateRevision` by exactly one per success, spends the correct budget, and never mutates the input `CombatState`; a rejected command returns a typed reason and changes nothing. `FLEE` is outside the kernel path: it stays the existing party-level retreat exit, handled by dispatch **before** the engine branch, and never enters the kernel command set.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `packages/frontend/engine/src/__tests__/combat_v2_resolver.test.ts` | `combat/combat_v2_resolver.ts#resolveV2CombatCommand` + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: attack hit/miss/downed; defend; end turn; wrong-actor/wrong-turn rejection; immutability.
- Also assert the FLEE path does **not** reach the kernel (dispatch short-circuits it).
- E2E / Visual: N/A.

**Watch Points**: ATTACK maps to `basic_melee` with a resolved target, never client-supplied damage; FLEE is a party retreat exit that bypasses the kernel (see Edge Cases); no model input.

### AC-5: v2 events drive the existing combat UI unchanged
**Given** a v2 encounter
**When** a command resolves
**Then** C-509 `CombatEvent`s map to `COMBAT_LOG`/`COMBAT_STATE_UPDATE`/`DAMAGE_DEALT`/`TURN_CHANGED`/`ACTION_ECONOMY_CHANGED`/`COMBAT_ENDED` with HP/positions matching the applied state, and the sidebar renders damage, HP, turn highlight, and budgets with no legacy/v2 double-emit.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `combat_v2_resolver.test.ts` + `combat_turn_flow.test.ts` | event mapping in `combat_v2_resolver.ts` + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: one bridge event per kernel event; consistent HP in `COMBAT_STATE_UPDATE`/`COMBAT_LOG`.
- E2E / Visual: existing `combat.visual.ts` ≥ threshold.

**Watch Points**: log text derives from resolved events, not from the command.

### AC-6: Legacy is preserved and selectable
**Given** `combatEngine = legacy` (or absent)
**When** an encounter runs
**Then** the legacy `turn_manager` path resolves exactly as before, all legacy tests pass unchanged, and switching to `v2` for the next encounter requires no code change.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Integration | `turn_manager.test.ts` (unchanged) + `packages/frontend/engine/src/__tests__/combat_engine_routing.test.ts` (new) | `combat/combat_command_dispatch.ts` engine branch + tooling: `bun moon run frontend-engine:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: legacy flag → `handleCombatAction`; v2 flag → resolver.
- E2E / Visual: N/A.

**Watch Points**: no legacy deletion; the flag is consulted once per encounter.

### AC-7: The preview loop is live and stale-safe
**Given** the active combatant in v2
**When** the UI enters move/ability/target selection
**Then** the ViewModel sends `COMBAT_PREVIEW_REQUESTED` (the existing `CombatPreviewRequestedCommand` requires `requestId` + `encounterId` + `basedOnRevision` + `query`), handles `COMBAT_PREVIEW_READY` to populate legal endpoints/targets/forecast (`forecast` is always present; `legalEndpoints`/`legalTargetIds`/`movementCostTo` are per query kind), and handles `COMBAT_PLAN_REJECTED` as a typed error (`reasonCode` + `messageKey`); a stale/duplicate result is discarded; selecting a new mode cancels the prior request; previews never mutate state.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit + E2E | `combat_view_model.test.ts` + `apps/e2e/tests/client/combat_v2.spec.ts` | `combat_view_model.svelte.ts` preview loop + `combat_preview_handler.ts` + tooling: `bun moon run client:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`, `bun moon run frontend-engine:test`
- Integration: request → ready populates state; stale result ignored; rejection surfaces.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/combat_v2.spec.ts` — enter move/ability selection, assert highlight/target state.
    - **Visual**: existing `combat.visual.ts` ≥ threshold.

**Watch Points**: `requestId` correlation; discard by revision; cancel on mode change.

### AC-8: Click-to-move commits a budgeted v2 move
**Given** the active combatant in move mode with reachable endpoints
**When** the player clicks a highlighted endpoint
**Then** a v2 `move` command with the resolved path is committed through the kernel, the ECS position is updated via `applyCombatResult`, movement budget decreases by the path cost, the endpoint highlight clears, and an out-of-range/blocked endpoint is rejected with a typed reason; clicking outside the reachable set does nothing.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Integration + E2E | `combat_v2_resolver.test.ts` + `combat_v2.spec.ts` | `combat_v2_resolver.ts` move path + `pointer_controller.ts` combat-aware handling + tooling: `bun moon run frontend-engine:test`, `bun moon run client:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`, `bun moon run client:test`
- Integration: click endpoint → position + budget change; blocked/too-far rejected.
- E2E / Visual: `combat_v2.spec.ts` move step.

**Watch Points**: do not use `MOVE_TO_CELL` (explore locomotion); commit through the v2 kernel; path must match the preview.

### AC-9: Ability and target selection commit through v2
**Given** the active combatant with the ability catalog
**When** the player picks an ability and a legal target (or Defend/Wait)
**Then** the UI shows the catalog-derived legal targets and forecast; committing sends the matching `COMBAT_ACTION`/v2 command; illegal targets are rejected with a typed reason; the action spends the correct budget and emits the mapped events; Defend is available even with no target.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-9 | Unit + E2E | `combat_view_model.test.ts` + `combat_v2.spec.ts` | `combat_sidebar.svelte` ability/target controls + `combat_v2_resolver.ts` + tooling: `bun moon run client:test` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`, `bun moon run frontend-engine:test`
- Integration: ability pick → target list; commit → kernel event; illegal target rejected.
- E2E / Visual: `combat_v2.spec.ts` ability/target step.

**Watch Points**: attack rolls/damage come only from the kernel; the UI never sends mechanical numbers.

### AC-10: The proof encounter completes on v2 through direct controls in production
**Given** `combatEngine = v2` and the authored proof encounter (player + 1 companion vs 3 enemies)
**When** the player plays from `/game` using move, ability/target, defend, flee, and end turn to victory or defeat
**Then** the loop completes through real initiative order, HP/events render in the sidebar, the result screen shows, and the player exits to EXPLORE with input restored; a deterministic retry with the same seed reproduces the same outcome; existing combat E2E and the C-500/C-514 specs pass.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-10 | E2E + Visual | `apps/e2e/tests/client/combat_v2.spec.ts` + `apps/e2e/src/visual/suites/combat.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`, `bun moon run client:test`
- Integration: manual `/game` smoke — encounter → move → ability → end turn → victory/defeat → exit; retry same seed.
- E2E / Visual:
    - **Functional**: `combat_v2.spec.ts` drives a real encounter start through production paths (extend the `__AIKAMI_TEST__` seam to launch the real encounter, not a stubbed roster) with move/ability/target/end-turn.
    - **Visual**: `combat.visual.ts` production case with a v2 tactical overlay; OpenRouter criteria: "Score 90+: combat overlay renders reachable-cell/target highlights and a forecast panel; not a frozen/empty world".

**Watch Points**: E2E must start **real** ECS combat; determinism from the encounter seed; keep the C-500 clean-exit/tick-health guarantees.

## Implementation Sequence

1. **Phase 1 (Flag + config)**: add `combatEngine` to shared keys, config env schema/validator, and config flags; default `legacy`; tests.
2. **Phase 2 (Encounter start + catalog + proof content)**: add `COMBAT_START_ENCOUNTER`; wire `spawnEncounterEnemy` + stats + `CombatMovement`/`CombatIdentity`/`TurnOrder`; build/inject the production catalog; author the proof encounter; converge both funnels; tests.
3. **Phase 3 (v2 resolver + events + engine tests)**: add `combat_v2_resolver.ts`; branch dispatch on the encounter engine; map events; resolver tests.
4. **Phase 4 (Tactical UI)**: preview request/handle loop + selection state in the ViewModel; move/ability/target controls; combat-aware pointer move; client tests.
5. **Phase 5 (Validation)**: `bun run fix`; `constants:test`, `utils:test`, `schemas:test`, `frontend-engine:test`, `client:test`; `/game` v2 E2E + visual; `bun moon run :validate`; Execution Report.

## Edge Cases & Gotchas

- **Two entry funnels**: dialogue chip and collision must both reach one start; a start while active is ignored; the dialogue chip must stop using the hardcoded 60-HP roster.
- **Unknown/incomplete encounter**: an `encounterId` absent from the pack, an NPC without `combatStats`, or a missing spawn map must fail **before** any entity is spawned — typed rejection + log, no partial roster; per Migration the encounter then runs on `legacy`.
- **Content stat mapping**: `defense` is deliberately unmapped (`COMBAT_STATS_FIELD_MAP`); do not fold it into armor class.
- **Catalog coverage**: a selectable-but-unmapped ability yields `abilityUnknown`; map it or hide/disable it, never fabricate mechanics.
- **Preview/commit consistency**: the committed path must equal the previewed path for the same revision; a changed revision invalidates the preview.
- **Move vs `MOVE_TO_CELL`**: suppress explore locomotion during combat; commit combat moves through the kernel.
- **FLEE semantics**: keep the existing party-retreat exit; do not route through the kernel.
- **Double-emit**: legacy and v2 paths are mutually exclusive per encounter.
- **Seed/retry**: RETRY reinitializes the v2 driver with the preserved seed and a fresh `CombatState`.
- **Projection cost**: `snapshotCombatState`/`snapshotBattlefield` clone; cache keyed by terrain/occupancy revision if a commit exceeds the frame budget.
- **Non-persistent components**: re-derive `CombatIdentity`/`CombatMovement` at encounter start after load.
- **FLEE is not a kernel command**: it is the party-retreat exit; dispatch must handle it before the engine branch in both directions (legacy and v2) so a v2 encounter still lets the party flee.
- **Keyboard/pointer parity**: every selection action must be reachable by keyboard, not only clicking the canvas.

## Open Questions

Each question below carries a recommendation that the Architecture Directives,
State & Data Models and Acceptance Criteria already encode, so this contract is
implementable as written. The critic stage **adopts all four recommendations**;
the architect may still override any of them, but an override changes scope and
requires a version bump + approval per the Amendments rule.

- **Q1 — Start-encounter transport.** Recommendation: a `COMBAT_START_ENCOUNTER` `GameCommand` handled in the worker, sent by both funnels. Confirm vs. starting turns directly in `packages/frontend/engine/src/systems/encounter_system.ts`.
- **Q2 — SUPPORT/REVIVE in v2.** Recommendation: 04 supports `ATTACK`/`ABILITY`/`DEFEND`/`END_TURN` through the kernel, with `FLEE` kept as the existing party-retreat exit (not a kernel command); `SUPPORT`/`REVIVE` return a typed "not supported in v2" rejection (legacy remains selectable). Confirm, or include minimal heal/revive commands.
- **Q3 — Ability mapping source.** Recommendation: derive `CombatAbilityDefinition` from `CLASS_REGISTRY` where faithful + `basic_melee`; omit unmappable features. Confirm, or authorize a new combat-ability content table.
- **Q4 — Proof encounter scope.** Recommendation: the Combat-04 proof is combat-only (player + 1 companion vs 3 enemies); environmental props and the non-kill objective from §21.4 arrive in Combat-07/08. Confirm.

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
| AC-8 | ⬜ | Pending |
| AC-9 | ⬜ | Pending |
| AC-10 | ⬜ | Pending |

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
