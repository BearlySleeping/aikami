# Contract C-329: Integrate the Demo Quest from Offer Through Reward

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | Quest state machine, engine ECS events, dialogue `offerQuest` executor wiring, quest HUD tracker, quest log overlay, content-pack objective data consumption, save/load projection |
| **Priority** | P0 — a complete quest loop turns engine features into a game. — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Dependencies** | C-143 (legacy, completed), C-157 (legacy, completed), C-316 (verified), C-328 (implemented) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | None — internal game system, no player-facing documentation |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The Emberwatch content pack (C-316, verified) contains authored quest data — 2 quests with objectives, endings, rewards, and world-state flags. The NPC dialogue orchestrator (C-328, implemented) supports an `offerQuest` command kind with full precondition validation (checks `questId` exists in content pack). The quest log UI (`quest_view.svelte` + `quest_view_model.svelte.ts`) renders `QuestData[]` with active/completed/failed sections and objective progress bars. The `worldStateService` has a `quests` reactive array synced from the ECS bridge (`QUESTS_UPDATED` event). **But these pieces are not wired together.** The `offerQuest` executor in the composition root is a stub (`return true` with a comment "C-329 will consume this envelope"). The ECS worker emits a hardcoded dummy quest — the "Slime Extermination" quest — not data from the content pack. No quest state machine exists to accept a quest, track objective progression from world events, deliver rewards, set world-state flags, or persist state through save/load.

- **Reproduction**:
  1. Boot the game in emulator mode. Create a campaign with `contentPackId: 'emberwatch'`.
  2. Enter `/game`. Walk to the quest giver NPC (Elder Thalia in Emberwatch Village). Interact.
  3. Dialogue opens. The AI or authored fallback may offer the "Fading Ward" quest via an `offerQuest` command choice.
  4. Accept it — the `offerQuest` executor in `game_composition_root.svelte.ts:281` does nothing (`return true`).
  5. The quest does NOT appear in the quest log. The ECS worker continues to emit the hardcoded "Slime Extermination" dummy quest.
  6. Walk to the Old Road map — nothing tracks objective progress.
  7. Reach the Ruined Shrine. Complete the encounter. No quest completion, no rewards, no world-state flag.
  8. Reload the campaign — there is no quest state to restore.

- **Existing implementation to reuse**:
  - **Content pack quest data**: `static/content-packs/emberwatch/manifest.json` — `quests.fading_ward` with 3 objectives, 3 endings, rewards (item+gold+XP); `quests.lost_pendant` (optional) with 2 objectives and 1 ending. Each objective has a completion condition (`completeOnMapEnter`, `completeOnNpcInteract`, `completeOnEncounterComplete`, `completeOnItemPickup`).
  - **Content pack encounter data**: `manifest.json` — `encounters.ruined_ward_encounter` with `mapId`, `enemyNpcIds`, `allowNonCombatResolution`, `nonCombatSkillCheck`, resolution dialogue keys, and loot table.
  - **Content pack loader accessors**: `packages/frontend/engine/src/assets/content_pack_loader.ts` — `getQuest()`, `getEncounter()`, `getAllQuests()`, `getAllEncounters()` already implemented.
  - **NPC dialogue orchestrator**: `npc_dialogue_service.svelte.ts` — `offerQuest` command kind, `_validateCommandPreconditions()` checks quest exists in content, `_deriveAuthoredChoices()` surfaces quest choices. The `NpcDialogueExecutors.offerQuest` interface is already typed.
  - **Quest log UI**: `views/quest/quest_view.svelte` + `quest_view_model.svelte.ts` — renders active/completed/failed quests with progress bars, wired to `questService.quests` (which proxies `worldStateService.quests`).
  - **Quest log overlay toggle**: `game_overlay_service.svelte.ts` — `openQuestLog()`/`closeQuestLog()`, keybinding `q` → `open_quest_log`.
  - **World state service**: `world_state_service.svelte.ts` — `quests = $state<QuestData[]>([])`, listens to `QUESTS_UPDATED` from ECS bridge (`startListening()` at line 420).
  - **ECS bridge event type**: `packages/frontend/engine/src/types.ts:386` — `QUESTS_UPDATED` event with `quests: QuestData[]`.
  - **Quest data types**: `QuestData`, `QuestObjectiveData`, `QuestStatus` in `packages/frontend/engine/src/types.ts:468-487`.
  - **Game composition root**: `game_composition_root.svelte.ts` — wires `offerQuest` executor (line 281), has access to `inventoryService`, `playerStateService`, `worldStateService`, `gameOverlayService`, `contentPackLoader`.
  - **Player state service**: `player_state_service.svelte.ts` — tracks `gold`, `xp`, `level`. Has `addGold()`, `addXp()`, `addItem()` methods (or equivalent via inventoryService).
  - **Inventory service**: `inventory_service.svelte.ts` — `ITEM_CATALOG`, `addItem()`, `removeItem()`.
  - **Save/load**: Turso persistence via `campaign_service.svelte.ts` (C-321) — campaign state serialization.
  - **Dev sandbox**: `views/quest/quest_view_model.dev.svelte.ts` — `QuestDevViewModel` injects mock data for sandbox testing.

- **Known gaps**:
  - No quest state machine: accepting a quest does not add it to `worldStateService.quests`.
  - No objective tracking: entering a map, interacting with an NPC, completing an encounter, or picking up an item does not check against active quest objectives.
  - `offerQuest` executor is a stub in `game_composition_root.svelte.ts:281`.
  - ECS worker emits hardcoded dummy quests, not content-pack-driven quest state.
  - No quest-specific world events from the ECS (`MAP_ENTERED`, `NPC_INTERACTED`, `ENCOUNTER_COMPLETED`, `ITEM_PICKED_UP` as quest-relevant triggers).
  - No reward delivery pipeline: quest completion does not grant items, gold, or XP.
  - No world-state flag system: `worldStateFlag` from ending data is not stored.
  - Quest state is not part of the save envelope — reloading loses all quest progress.
  - Quest HUD tracker (objective pins on screen) does not exist — only the quest log overlay exists.
  - Declining a quest is not handled (should be a real choice that persists).

- **Baseline tests**:
  - `packages/frontend/engine/src/assets/content_pack_loader.integration.test.ts` — 23 tests, verifies quest/encounter data loads from manifest.
  - `packages/frontend/engine/src/assets/content_pack_loader.test.ts` — 35 unit tests (loader accessors).
  - `apps/frontend/client/src/lib/services/game/game_composition_root.test.ts` — composition root wiring tests.
  - `apps/frontend/client/src/lib/services/game/npc_dialogue_service.test.ts` — dialogue orchestrator unit tests (if exists).
  - No quest state machine tests, no objective tracking tests, no reward delivery tests, no persistence tests for quest state.

## User Outcome

After this contract, a player can accept the "Fading Ward" quest from Elder Thalia in Emberwatch Village, see it appear in the quest log with objectives, travel to the Old Road (objective 1 completes), reach the Ruined Ward Shrine (objective 2 completes), resolve the shade encounter (objective 3 completes), choose an ending (Ward Renewed / Sacrificed / Shattered), receive rewards (ward amulet + gold + XP), see the world-state flag set, and reload the campaign with all quest state intact.

## Success Measures

- **Time/latency target**: Quest state transitions (accept, objective progress, complete) are synchronous or microtask — under 1ms. No network calls for quest logic. Reward delivery under 10ms (inventory sync + XP/gold update).
- **Offline/degraded behavior**: All quest logic is deterministic and content-driven — zero AI dependency. Quest objectives are authored in the content pack. Quest state operates fully offline. AI is used only for NPC dialogue narration; quest mechanics are purely local.
- **Production journey enabled**: Player receives a quest from an NPC, sees it in the quest log, progresses through authored objectives, receives rewards, and the world changes — all on the production `/game` route.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Quest data (content pack) | `static/content-packs/emberwatch/manifest.json` — `quests{}` | **Reuse** — read-only consumption |
| Content pack loader accessors | `content_pack_loader.ts:getQuest()`, `getAllQuests()` | **Reuse** |
| NPC dialogue `offerQuest` command | `npc_dialogue_service.svelte.ts` — `_validateCommandPreconditions()`, `_deriveAuthoredChoices()`, `NpcDialogueExecutors.offerQuest` | **Modify** — wire real executor |
| Quest log UI (overlay) | `views/quest/quest_view.svelte` + `quest_view_model.svelte.ts` | **Reuse** |
| Quest log overlay toggle | `game_overlay_service.svelte.ts:openQuestLog()` | **Reuse** |
| World state service quests array | `world_state_service.svelte.ts` — `quests = $state<QuestData[]>([])` + `QUESTS_UPDATED` listener | **Modify** — consume real quest data |
| Engine bridge `QUESTS_UPDATED` event | `packages/frontend/engine/src/types.ts:386` | **Modify** — emit real quest state |
| Quest data types | `packages/frontend/engine/src/types.ts:468-487` — `QuestData`, `QuestObjectiveData`, `QuestStatus` | **Modify** — extend for reward/world-flag data |
| Game composition root | `game_composition_root.svelte.ts` — `offerQuest` executor stub | **Modify** — implement quest lifecycle |
| Player state (gold, XP) | `player_state_service.svelte.ts` | **Reuse** — call `addGold()`, `addXp()` |
| Inventory service | `inventory_service.svelte.ts` — `addItem()` | **Reuse** — deliver reward items |
| ECS worker | `ecs_worker.ts` — hardcoded dummy quest at line 636 | **Modify** — emit real quest state from world |
| Save/load (Turso) | `campaign_service.svelte.ts` — C-321 | **Modify** — include quest state in save envelope |
| Quest dev sandbox | `views/quest/quest_view_model.dev.svelte.ts` | **Reuse** — test with injected quest state |

## Overview

Wire the complete quest loop: accept a quest through NPC dialogue, track objective progress from in-world events (map enter, NPC interact, encounter complete, item pickup), deliver rewards on completion, set world-state flags for ending choices, and persist quest state through save/load. A new frontend `QuestStateService` owns the quest lifecycle — it consumes content pack quest definitions, listens to engine bridge events, evaluates objective completion conditions, and emits updated `QuestData[]` to the UI. The quest state is serialized into the campaign save envelope. The ECS worker's hardcoded dummy quest is replaced with content-pack-driven quest state emitted through the bridge.

## Design Reference

- **Quest log ViewModel pattern**: `views/quest/quest_view_model.svelte.ts` — read-only derived state from `questService.quests` (which proxies `worldStateService.quests`). Follow this same MVVM pattern for the quest tracker HUD.
- **Service pattern**: `world_state_service.svelte.ts` — `BaseFrontendClass` with `$state` reactive fields, bridge listeners in `startListening()`, `reset()` for cleanup. New `QuestStateService` follows the same pattern.
- **Composition root wiring**: `game_composition_root.svelte.ts:280-300` — NPC dialogue executors are wired as arrow functions with closure over local services. The `offerQuest` executor follows the same pattern.
- **Engine bridge event pattern**: `types.ts:386` — `QUESTS_UPDATED` is a discriminated union member of `EngineBridgeEvent`. New quest-related events follow this pattern.
- **TypeBox schema-first**: Content pack quest schema already exists in `packages/shared/schemas/src/lib/game/content_pack.ts`. New runtime quest state types go in `packages/shared/types/` derived from TypeBox.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

| What | Where | Purpose |
|---|---|---|
| Quest state service (new) | `apps/frontend/client/src/lib/services/game/quest_state_service.svelte.ts` | Owns quest lifecycle: accept, progress, complete, fail, reward delivery |
| Quest state types (new/modify) | `packages/frontend/engine/src/types.ts` | Extend `QuestData` for reward info and world-state flags; add quest-trigger event types |
| Quest state schema (new) | `packages/shared/schemas/src/lib/game/quest_state.ts` | TypeBox schema for serializable quest state (for save envelope) |
| Quest state types (derived) | `packages/shared/types/src/lib/game/quest_state.ts` | `Static<>` derived types |
| Composition root — executor wiring | `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` | Wire real `offerQuest` executor → `questStateService.acceptQuest()` |
| Quest log overlay — wire real data | `apps/frontend/client/src/lib/views/quest/quest_view_model.svelte.ts` | Already reads from `questService.quests` → `worldStateService.quests` — ensure real data flows |
| Quest HUD tracker (new) | `apps/frontend/client/src/lib/views/game/ui/quest_tracker_view.svelte` + `_view_model.svelte.ts` | Compact always-visible objective display (1–2 lines) |
| ECS worker — remove dummy quest | `packages/frontend/engine/src/worker/ecs_worker.ts:636-660` | Remove hardcoded "Slime Extermination" emission |
| ECS worker — bridge quest triggers | `packages/frontend/engine/src/worker/ecs_worker.ts` | Emit `MAP_ENTERED`, `ENCOUNTER_COMPLETED`, `ITEM_PICKED_UP` via bridge (or handle in frontend) |
| Engine bridge — new event types | `packages/frontend/engine/src/types.ts` | Add `QUEST_ACCEPTED`, `QUEST_PROGRESSED`, `QUEST_COMPLETED`, `QUEST_REWARD_GRANTED`, and quest-trigger events (`MAP_ENTERED` if not existing) |
| Engine bridge — emit quest events | `packages/frontend/engine/src/worker/ecs_worker.ts` | Emit quest-trigger events when world state changes |
| Save envelope — quest state | `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts` | Include quest state in save payload |
| Content pack — quest schema extension | `packages/shared/schemas/src/lib/game/content_pack.ts` | Add `declineDialogueKey` to `ContentPackQuestEntrySchema` (optional) |
| Test — quest state service | `apps/frontend/client/src/lib/services/game/quest_state_service.test.ts` | Unit tests for accept/progress/complete/reward lifecycle |
| Test — quest E2E | `apps/e2e/tests/client/emberwatch-quest.spec.ts` | Playwright test: full quest from offer to reward |
| Test — quest persistence | `apps/e2e/tests/client/quest-persistence.spec.ts` | Reload after quest progress → state survives |

**Package boundaries**: Types + schemas in shared packages. Engine types in `packages/frontend/engine`. Service in client. E2E in `apps/e2e`. No backend changes.

**🔴 No Firebase / Cloud Functions**: Quest logic is fully local. No backend endpoints needed.

## State & Data Models

🔴 **Schema-first rule**: Runtime quest state types derive from TypeBox schemas in `packages/shared/schemas/`. Content pack quest data is already defined there.

### Runtime Quest State (new — `packages/shared/schemas/src/lib/game/quest_state.ts`)

```typescript
import { Type, type Static } from '@sinclair/typebox';

// ── Runtime quest state (serializable for save envelope) ──

export const QuestObjectiveStateSchema = Type.Object({
  label: Type.String({ description: 'Objective display text' }),
  current: Type.Number({ minimum: 0, description: 'Current progress count' }),
  max: Type.Number({ minimum: 1, description: 'Max progress count' }),
  completed: Type.Boolean({ description: 'Whether this objective is complete' }),
});

export const QuestProgressSchema = Type.Object({
  questId: Type.String({ description: 'Content pack quest ID' }),
  status: Type.Union([
    Type.Literal('active'),
    Type.Literal('completed'),
    Type.Literal('failed'),
  ], { description: 'Quest status' }),
  objectives: Type.Array(QuestObjectiveStateSchema, { description: 'Objective progress' }),
  startedAt: Type.Number({ description: 'Timestamp when quest was accepted (ms)' }),
  completedAt: Type.Optional(Type.Number({ description: 'Timestamp when quest completed' })),
  rewardsGranted: Type.Boolean({ description: 'Whether rewards have been delivered (idempotency guard)' }),
  chosenEndingId: Type.Optional(Type.String({ description: 'Ending ID chosen by player' })),
});

export const ActiveQuestStateSchema = Type.Object({
  activeQuests: Type.Array(QuestProgressSchema, { description: 'Currently tracked quests' }),
  completedQuestIds: Type.Array(Type.String(), { description: 'Quest IDs completed (for dedup)' }),
  failedQuestIds: Type.Array(Type.String(), { description: 'Quest IDs failed (for dedup)' }),
  declinedQuestIds: Type.Array(Type.String(), { description: 'Quest IDs declined by the player (dedup guard)' }),
  worldStateFlags: Type.Record(Type.String(), Type.Boolean(), {
    description: 'World-state flags set by quest endings and events',
  }),
});

export type QuestObjectiveState = Static<typeof QuestObjectiveStateSchema>;
export type QuestProgress = Static<typeof QuestProgressSchema>;
export type ActiveQuestState = Static<typeof ActiveQuestStateSchema>;
```

### Engine Bridge Event Types (extend `packages/frontend/engine/src/types.ts`)

```typescript
// ── Quest lifecycle events (add to EngineBridgeEvent union) ──

| {
    type: 'QUEST_ACCEPTED';
    questId: string;
    questName: string;
  }
| {
    type: 'QUEST_PROGRESSED';
    questId: string;
    objectiveIndex: number;
    current: number;
    max: number;
  }
| {
    type: 'QUEST_COMPLETED';
    questId: string;
    endingId?: string;
  }
| {
    type: 'QUEST_REWARD_GRANTED';
    questId: string;
    rewards: Array<{ type: 'item' | 'gold' | 'xp'; itemId?: string; amount?: number }>;
  }

// ── Quest trigger events (world events that can advance objectives) ──

| {
    type: 'MAP_ENTERED';
    mapId: string;
  }
| {
    type: 'ENCOUNTER_COMPLETED';
    encounterId: string;
    victory: boolean;
  }
| {
    type: 'ITEM_PICKED_UP';
    itemId: string;
  }

// QUESTS_UPDATED is modified: emitted by QuestStateService after any state change.
// The ECS worker no longer emits hardcoded quests.
```

### QuestData Extension (modify `packages/frontend/engine/src/types.ts`)

```typescript
/** Quest data emitted from frontend QuestStateService to UI via QUESTS_UPDATED. */
export type QuestData = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  status: QuestStatus;
  objectives: QuestObjectiveData[];
  /** Ending-specific narration (set when quest completes with an ending). */
  readonly endingNarration?: string;
  /** Rewards granted for this quest (for journal display). */
  readonly rewards?: Array<{ type: string; label: string }>;
};
```

### QuestStateService Interface

```typescript
export type QuestStateServiceInterface = BaseFrontendClassInterface & {
  readonly quests: readonly QuestData[];
  readonly worldStateFlags: Readonly<Record<string, boolean>>;

  /** Accepts a quest from a given NPC. The quest must exist in the content pack and not already be active/completed. */
  acceptQuest(options: { questId: string; npcId: string }): boolean;

  /** Declines a quest. Persists the decline so it is not re-offered. */
  declineQuest(options: { questId: string }): void;

  /** Checks if a quest can be accepted (not already active/completed/failed). */
  canAcceptQuest(questId: string): boolean;

  /**
   * Evaluates all active quest objectives against a world trigger event.
   * Called from bridge listeners for MAP_ENTERED, NPC_INTERACTED,
   * ENCOUNTER_COMPLETED, and ITEM_PICKED_UP.
   */
  evaluateTriggers(trigger: QuestTriggerEvent): void;

  /** Serializes quest state for save envelope. */
  serialize(): ActiveQuestState;

  /** Hydrates quest state from save envelope. */
  hydrate(state: ActiveQuestState): void;

  /** Starts bridge listeners for quest-trigger events. */
  startListening(): Promise<void>;

  /** Resets all quest state. */
  reset(): void;
};

export type QuestTriggerEvent =
  | { type: 'MAP_ENTERED'; mapId: string }
  | { type: 'NPC_INTERACTED'; npcId: string }
  | { type: 'ENCOUNTER_COMPLETED'; encounterId: string; victory: boolean }
  | { type: 'ITEM_PICKED_UP'; itemId: string };
```

## Quality Requirements

- **Offline/degraded mode**: Quest logic is 100% local and deterministic. No AI, network, or auth required. Authored content pack data drives all quest objectives and endings. Quest state operates the same with or without AI — AI only narrates the quest experience; mechanics are always local.
- **Accessibility/input**: Quest log opens via keyboard shortcut `q` (existing keybinding in `keybinding_config.ts:36`). Close via Escape/Back. Quest tracker HUD is visible without interaction. No new input requirements.
- **Performance budget**: Quest state transitions (accept, progress, complete) are synchronous — under 1ms each. `evaluateTriggers()` iterates over active quests (typically 1–3) and their objectives (2–3 each) — O(n) where n < 10 operations. No async work in quest mechanics.
- **Security/privacy**: No user data in quest state. No network calls for quest logic. Quest state is local-only (Turso is local DB). No PII in quest data.
- **Persistence/migration**: Quest state is serialized into the campaign save envelope alongside other game state. Old saves without quest state default to empty quest arrays (no migration needed — first load after contract initializes empty quest state). The `ActiveQuestStateSchema` is versioned within the save envelope; `worldStateFlags` map supports forward compatibility (unknown flags are ignored).
- **Cancellation/retry/idempotency**: Reward delivery is guarded by `rewardsGranted` flag — rewards are never duplicated even if the completion event fires multiple times. Quest acceptance is idempotent (calling `acceptQuest` on an already-active quest returns false). Objective progression is monotonic (current never decreases, only increases toward max).
- **Observability**: Quest state changes log via `this.debug()` in `QuestStateService`: `acceptQuest`, `progressObjective`, `completeQuest`, `deliverRewards`. Engine bridge events are already observable via the bridge listener pattern.

## Migration & Rollback

N/A — no persistent state changes to existing data. The `ActiveQuestState` schema is additive to the save envelope. Old saves without quest state load with empty quest arrays. No migration needed. If the quest service fails to load (schema mismatch), quest state defaults to empty and the game continues — no blocking.

If rollback is needed: the hardcoded dummy quest in the ECS worker can be temporarily re-enabled via a feature flag before removing entirely. After contract verification, the dummy quest is permanently removed.

## Scope Boundaries

- **In Scope:**
  - `QuestStateService` — owns quest lifecycle (accept, decline, progress, complete, reward)
  - Wiring `offerQuest` dialogue executor → `questStateService.acceptQuest()`
  - Event-driven objective evaluation for 4 trigger types: map enter, NPC interact, encounter complete, item pickup
  - Quest reward delivery (items via `inventoryService`, gold via `playerStateService`, XP via `playerStateService`)
  - World-state flags from quest endings (`emberwatch.ending.*`, etc.)
  - Quest log overlay consuming real quest data from `QuestStateService`
  - Compact quest tracker HUD component (1–2 lines showing current objective)
  - Quest state serialization into save envelope (Turso via `campaign_service`)
  - Engine bridge event types for quest triggers (`MAP_ENTERED`, `ENCOUNTER_COMPLETED`, `ITEM_PICKED_UP`, `NPC_INTERACTED`)
  - Removal of ECS worker's hardcoded dummy quest
  - Declining a quest (persisted decline for session, preferenced for save)
  - Idempotent reward delivery (`rewardsGranted` guard)
  - Unit tests for `QuestStateService` lifecycle
  - E2E test: full Emberwatch quest from offer to reward
  - Quest dev sandbox update to use `QuestStateService`
  - Declining a quest persists through dialogue (declined quests are not re-offered)

- **Out of Scope:**
  - Quest graph with prerequisites (e.g., "complete quest A before B is available") — C-339
  - Branching objectives (e.g., mutually exclusive objective paths) — C-339
  - Timed or repeatable quests — C-339
  - NPC reactivity based on world-state flags (flag consumption) — C-341 (relationships/factions)
  - HUD redesign or overlay navigation — C-332
  - Quest reward visual feedback (loot animation, level-up effect) — C-163 (visceral feedback)
  - AI context projection for quest state (GM prompt enrichment) — already handled by `gm_prompt_service.svelte.ts:341` reading `worldStateService.quests`
  - Quest journal entries with rich narration (the ending narration is in `QuestData`, but full journal rendering is C-344)
  - Encounter trigger system changes — encounters are triggered by existing proximity system; this contract consumes `ENCOUNTER_COMPLETED` events but does not modify how encounters start
  - Skill check dice flow — skill checks are already handled by C-157 with the dialogue ViewModel; this contract consumes the result

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract**: 5 ACs, 4 affected projects (shared types, shared schemas, frontend engine, client). The quest state machine, objective tracking, reward delivery, and persistence are tightly coupled — releasing any one without the others gives zero user value. The E2E test (AC-5) validates the entire loop. No split needed — this is one coherent feature (the quest loop).

## Acceptance Criteria

### AC-1: Accept and Decline Quest via NPC Dialogue
**Given** a campaign with `contentPackId: 'emberwatch'` is loaded and the player is in Emberwatch Village
**When** the player interacts with Elder Thalia (quest giver NPC), the NPC dialogue offers the "Fading Ward" quest, and the player selects the "Ask about 'The Fading Ward'" choice (which carries an `offerQuest` command)
**Then**:
- `questStateService.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' })` is called
- The quest appears in the quest log (`quest_view.svelte`) under "Active" with title "The Fading Ward", description text, and 3 objectives at 0/max progress
- `worldStateService.quests` (reactive) contains exactly one active quest
- The quest does NOT appear if already active or completed (re-accept returns false)
- Declining the quest (selecting "Leave" or explicitly refusing via dialogue) persists the decline — the quest offer choice is not shown again for Elder Thalia
- The `offerQuest` executor returns `true` on success, `false` on duplicate/decline

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Integration | `apps/frontend/client/src/lib/services/game/quest_state_service.test.ts`, `apps/frontend/client/src/lib/services/game/game_composition_root.test.ts` | `/game` — dialogue → quest log | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Create `quest_state_service.test.ts` — `acceptQuest` adds quest to state, returns false on duplicate; `declineQuest` marks quest as declined; `canAcceptQuest` returns false after decline; verify `worldStateService.quests` is updated.
- E2E / Visual:
    - **Functional**: `tests/client/emberwatch-quest.spec.ts` — Playwright: navigate `/game`, interact with Elder Thalia (NPC), verify dialogue overlay shows quest offer choice, select it, verify quest log opens (or badge appears), verify quest appears in active list
    - **Visual**: N/A

**Watch Points**:
- The `offerQuest` executor in `game_composition_root.svelte.ts` currently has `return true` as a stub. Replace with real call to `questStateService.acceptQuest()`.
- Quest acceptance must be synchronous — no async delay between choosing "Ask about..." and seeing quest in log.
- NPCs may have multiple quests — the dialogue choice derivation already iterates `getAllQuests()`. Ensure each quest is only offered once.
- The `_deriveAuthoredChoices()` in `npc_dialogue_service.svelte.ts` already builds a quest choice from the first available quest. The content pack may have 2 quests — ensure both are offerable under the right conditions.

### AC-2: Event-Driven Objective Progression
**Given** the "Fading Ward" quest is active with objectives: (1) Investigate the Old Road (`completeOnMapEnter: 'old_road'`), (2) Reach the Ruined Ward Shrine (`completeOnMapEnter: 'ruined_ward_shrine'`), (3) Decide the ward's fate (`completeOnEncounterComplete: 'ruined_ward_encounter'`)
**When** the player triggers world events in any order:
- Enters the `old_road` map → `QUEST_PROGRESSED` emitted, objective 1 marked complete
- Interacts with Elara Wayfinder on the Old Road → no objective match (her NPC ID doesn't match any `completeOnNpcInteract` on active objectives)
- Enters `ruined_ward_shrine` → objective 2 marked complete
- Completes the `ruined_ward_encounter` (victory or non-combat resolution) → objective 3 marked complete → `QUEST_COMPLETED` emitted
**Then**:
- Each objective fires exactly once (idempotent — re-entering a map does not double-count)
- After the encounter completes and all 3 objectives are done, quest status transitions to `completed`
- `worldStateService.quests` shows the quest with `status: 'completed'` and all objectives at `current === max`
- The optional "Lost Pendant" quest also progresses: picking up `wardPendant` item advances its first objective; returning it to Keth advances its second
- Quest completion triggers `AC-3` reward delivery

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Integration | `apps/frontend/client/src/lib/services/game/quest_state_service.test.ts` (extended) | `/game` — world events → quest log updates | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`, `bun moon run engine:test`
- Integration: `quest_state_service.test.ts` — `evaluateTriggers({ type: 'MAP_ENTERED', mapId: 'old_road' })` advances objective 0 of fading_ward; same trigger repeated does not double-advance; `evaluateTriggers({ type: 'ENCOUNTER_COMPLETED', encounterId: 'ruined_ward_encounter', victory: true })` advances objective 2 and completes quest; optional quest triggers work with `ITEM_PICKED_UP` and `NPC_INTERACTED`.
- E2E / Visual:
    - **Functional**: `tests/client/emberwatch-quest.spec.ts` — walk player to Old Road transition, verify quest log objective 1 shows `1/1`; walk to Shrine transition, verify objective 2 shows `1/1`; trigger encounter, verify objective 3 completes, quest moves to Completed section
    - **Visual**: N/A

**Watch Points**:
- The `evaluateTriggers()` method must load the content pack quest definition to read `completeOnMapEnter` / `completeOnNpcInteract` / `completeOnEncounterComplete` / `completeOnItemPickup` fields. The `QuestStateService` needs a reference to the content pack loader (injected via `configure()` or constructor).
- Map entry events may already be handled in the engine — check if `MAP_ENTERED` bridge event exists or needs to be added. The ECS worker already tracks `activeMapId` internally; emitting on transition is straightforward.
- `ENCOUNTER_COMPLETED` may be the existing `COMBAT_ENDED` event — check if `COMBAT_ENDED` carries `encounterId`. If not, a new `ENCOUNTER_COMPLETED` event is needed.
- `ITEM_PICKED_UP` may not have an existing bridge event — the inventory system may add items without emitting. A new event may be needed.
- Objective `max` values default to 1 for `completeOn*` triggers (binary objectives) but may be >1 for quantity-based objectives. Content pack objectives in `fading_ward` and `lost_pendant` are all binary (max=1).
- Non-combat encounter resolution (persuasion success) must also trigger objective completion — the trigger is `ENCOUNTER_COMPLETED` regardless of resolution path.

### AC-3: Idempotent Quest Reward Delivery
**Given** the "Fading Ward" quest has just been completed with rewards: `wardAmulet` item, 200 gold, 500 XP, and the player chose the "Ward Renewed" ending
**When** `questStateService` delivers rewards
**Then**:
- `inventoryService.addItem('wardAmulet')` is called — the item appears in player inventory
- `playerStateService.addGold(200)` is called — gold increases by 200
- `playerStateService.addXp(500)` is called — XP increases by 500
- `worldStateFlags['emberwatch.ending.renewed']` is set to `true`
- The `rewardsGranted` flag on the quest progress entry is set to `true`
- If the quest completion event fires again (duplicate `ENCOUNTER_COMPLETED`), rewards are NOT re-delivered (idempotency guard)
- The quest log shows the ending narration text ("You place your hands upon the fading crystal...") and reward summary
- The completed quest persists in `completedQuestIds`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `apps/frontend/client/src/lib/services/game/quest_state_service.test.ts` (extended) | `/game` — quest completion → inventory/gold/XP update | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: `quest_state_service.test.ts` — mock `inventoryService` and `playerStateService`; complete quest → verify `addItem` called with correct itemId, `addGold` called with correct amount, `addXp` called; complete again → verify no duplicate calls; verify `rewardsGranted` is true.
- E2E / Visual:
    - **Functional**: `tests/client/emberwatch-quest.spec.ts` — after quest completion, open inventory and verify `wardAmulet` is present; check gold and XP changed
    - **Visual**: N/A

**Watch Points**:
- Reward delivery uses the `ContentPackQuestRewardSchema` type from the content pack: `type: 'item' | 'gold' | 'xp'`, with optional `itemId` and `amount`.
- The `rewardsGranted` guard must be atomic — if reward delivery fails partway (e.g., inventory is full), the quest should still be marked `rewardsGranted: false` so the completion handler can retry. However, Phase 1 items have no capacity limits — this is a defensive guard for C-331.
- Gold and XP addition methods must exist on `playerStateService`. Verify `addGold()` and `addXp()` signatures before implementing.
- The `inventoryService.addItem()` must accept item IDs that match `ITEM_CATALOG` keys. The `wardAmulet` item exists in both `manifest.json` and `ITEM_CATALOG`.
- World-state flags use namespaced keys (`emberwatch.ending.renewed`) — the flag map is `Record<string, boolean>`. Flags are additive — setting a flag does not remove others.

### AC-4: Quest State Survives Campaign Save and Reload
**Given** a campaign with the "Fading Ward" quest accepted (2 objectives complete, 1 remaining), the "Lost Pendant" quest accepted (1 objective complete), and world-state flags `{ 'emberwatch.pendant.returned': true }`
**When** the campaign is saved (autosave or manual) and then reloaded via Continue
**Then**:
- `questStateService.serialize()` was called during save — returns `ActiveQuestState` with 2 active quests, correct objective progress per quest, 1 completed quest ID, and the world-state flags map
- On reload, `questStateService.hydrate(state)` restores all quest state
- `worldStateService.quests` contains exactly the same quests with same objective progress
- The quest log shows identical content before and after reload
- World-state flags are restored to the same values
- A clean save with no quest state (from before this contract) loads with empty quest arrays and empty flags map — no errors

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Integration | `apps/frontend/client/src/lib/services/game/quest_state_service.test.ts` (extended), `apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts` (extended) | `/game` → save → reload → quest log unchanged | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: `quest_state_service.test.ts` — serialize active quest with 2/3 objectives complete → hydrate in fresh service → verify identical state; serialize empty state → hydrate → verify empty; verify `worldStateFlags` round-trip.
- E2E / Visual:
    - **Functional**: `tests/client/quest-persistence.spec.ts` — Playwright: accept quest, progress 1 objective (enter Old Road), save campaign, reload, verify quest log still shows the quest with 1/3 objectives complete
    - **Visual**: N/A

**Watch Points**:
- The save envelope is managed by `campaign_service.svelte.ts` (C-321 Turso persistence). The `QuestStateService.serialize()` output must be included in the campaign save payload. `campaign_service` needs a hook to call `questStateService.serialize()` during save and `questStateService.hydrate()` during load.
- Schema versioning: the `ActiveQuestStateSchema` should be backward-compatible. If the schema changes, old saves load with defaults for new fields.
- Objective progress is stored as `{ label, current, max, completed }` — the `label` is denormalized for display resilience (if the content pack changes, the quest log still shows the old label from the saved state). Consider whether to store only `{ objectiveIndex, current }` and derive labels from the content pack on hydrate. **Recommendation**: Store minimal data (`questId`, `objectiveIndex`, `current`) and derive display fields from the content pack on hydrate. This avoids stale labels.
- The `declineQuest` set must also be serialized — declined quest IDs persist in the save so declined quests are not re-offered after reload.

### AC-5: End-to-End Emberwatch Quest — Production Path
**Given** a fresh campaign with `contentPackId: 'emberwatch'`, a generated persona, and local AI (emulator mode with `AIKAMI_MODE=emulator`)
**When** the player plays through the complete Fading Ward quest on the production `/game` route:
1. Walks to Elder Thalia in Emberwatch Village
2. Interacts → dialogue opens → selects "Ask about 'The Fading Ward'" → accepts quest
3. Opens quest log (key `q`) → quest visible as "Active" with 3 objectives at 0/1
4. Walks to Emberwatch Village east edge → transitions to Old Road
5. Old Road loads → quest log shows objective 1 (Investigate the Old Road) at 1/1
6. Walks to Old Road east edge → transitions to Ruined Ward Shrine
7. Shrine loads → quest log shows objective 2 (Reach the Ruined Ward Shrine) at 1/1
8. Triggers the shade encounter → resolves via combat or persuasion
9. After resolution → quest log shows objective 3 (Decide the ward's fate) at 1/1 → quest moves to "Completed" section
10. Inventory contains `wardAmulet`, gold increased by 200, XP increased by 500
11. Opens quest log → completed quest shows ending narration text
12. Quests survive page reload (state recovery)
**Then**:
- All 5 AC-2 triggers fire correctly in sequence
- Rewards are delivered exactly once (AC-3)
- State survives reload (AC-4)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | E2E | `apps/e2e/tests/client/emberwatch-quest.spec.ts` | `/game` — complete quest loop | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run e2e:test -- tests/client/emberwatch-quest.spec.ts`
- Integration: N/A — AC-5 is the E2E spec itself
- E2E / Visual:
    - **Functional**: `tests/client/emberwatch-quest.spec.ts` — Playwright spec with POM for: GameOverlay (quest log toggle, active/completed sections), GameCanvas (movement commands, NPC interaction), DialogueOverlay (choice selection). Test steps map 1-to-1 with the When clause above. Use `page.evaluate()` to fast-travel between maps if needed, or use pixel-based movement commands.
    - **Visual**: N/A — quest log is a text overlay; visual assessment is not meaningful for this feature

**Watch Points**:
- Map transitions may require walking to specific coordinates. Use `page.evaluate()` or engine commands to teleport if movement is too slow for E2E.
- Dialogue with AI may produce variant text. The Playwright spec should use loose text matching (`toContainText`) or structural assertions (quest log contains expected quest ID/name).
- Emulator mode means AI is available but fallback dialogue also works. The test should run with either.
- The E2E test should include a reload step (step 12) to verify state persistence.
- If the encounter trigger is proximity-based and the Playwright test can't walk the player precisely, use `page.evaluate()` to emit `ENCOUNTER_COMPLETED` directly via `questStateService.evaluateTriggers()`.

## Implementation Sequence

1. **Phase 1 (Types + Data)**:
   - Add `QuestProgressSchema` and `ActiveQuestStateSchema` to `packages/shared/schemas/src/lib/game/quest_state.ts`
   - Derive types in `packages/shared/types/src/lib/game/quest_state.ts` via `Static<>`
   - Extend engine bridge event types in `packages/frontend/engine/src/types.ts`: add `QUEST_ACCEPTED`, `QUEST_PROGRESSED`, `QUEST_COMPLETED`, `QUEST_REWARD_GRANTED`, `MAP_ENTERED`, `ENCOUNTER_COMPLETED`, `ITEM_PICKED_UP`
   - Extend `QuestData` type with optional `endingNarration` and `rewards` fields
   - Extend `ContentPackQuestEntrySchema` with optional `declineDialogueKey`

2. **Phase 2 (QuestStateService)**:
   - Create `apps/frontend/client/src/lib/services/game/quest_state_service.svelte.ts`:
     - `acceptQuest()` — adds quest to active list from content pack definition, initializes objectives from `ContentPackQuestEntry.objectives`
     - `declineQuest()` — adds quest ID to declined set
     - `canAcceptQuest()` — checks not active/completed/failed/declined
     - `evaluateTriggers()` — for each active quest, checks each incomplete objective against the trigger, marks objective complete when condition matches
     - `_completeQuest()` — when all objectives are done, transitions to `completed` status, delivers rewards, sets world-state flags
     - `_deliverRewards()` — calls `inventoryService.addItem()`, `playerStateService.addGold()`, `playerStateService.addXp()` with `rewardsGranted` guard
     - `serialize()` / `hydrate()` — round-trip through `ActiveQuestStateSchema`
     - `startListening()` — bridge listeners for quest-trigger events (`MAP_ENTERED`, `ENCOUNTER_COMPLETED`, `ITEM_PICKED_UP`, `NPC_INTERACTED`)
   - Write unit tests: accept, decline, progress, complete, reward, idempotency, serialize/hydrate

3. **Phase 3 (Integration)**:
   - Wire `offerQuest` executor in `game_composition_root.svelte.ts` → `questStateService.acceptQuest()`
   - Register `questStateService` in `GameCompositionRoot` (add to interface, initialize in `initialize()`, call `startListening()`, add `reset()` in `dispose()`)
   - Export `questStateService` from `$services` barrel
   - Wire `questStateService.serialize()` into campaign save flow and `hydrate()` into load flow
   - Remove hardcoded dummy quest from `ecs_worker.ts:636-660`
   - Ensure `worldStateService.quests` is updated from `questStateService` (or have quest log read directly from `questStateService`)
   - Emit `MAP_ENTERED`, `ENCOUNTER_COMPLETED`, `ITEM_PICKED_UP` from ECS worker via bridge
   - Quest tracker HUD view (compact, always visible, current objective text)

4. **Phase 4 (Validation)**:
   - `bun moon run client:test` — all QuestStateService unit tests pass
   - `bun moon run engine:test` — engine types compile, bridge event types valid
   - `bun moon run schemas:test` — schema tests pass
   - `bun moon run e2e:test -- tests/client/emberwatch-quest.spec.ts` — E2E quest loop passes
   - `bun moon run :validate` — full CI validation
   - Manual: create campaign → play through Fading Ward quest → verify quest log, rewards, and state persistence

## Edge Cases & Gotchas

- **Decline quest persistence**: Declined quests must be stored in the save envelope. If a player declines "Fading Ward", reloads, and talks to Elder Thalia again, the quest offer should not reappear. The `declineQuest()` adds the quest ID to a `Set` that is serialized.
- **Encounter non-combat resolution**: When the shade encounter is resolved via persuasion (non-combat), `ENCOUNTER_COMPLETED` must still fire with `victory: true` (or a separate `resolution: 'combat' | 'noncombat'` field). The objective trigger reads `completeOnEncounterComplete` — it does not care about resolution type, only that the encounter was completed.
- **Optional quest "Lost Pendant" independence**: The optional quest must progress independently of the main quest. Completing the pendant quest does not affect the Fading Ward quest. They are tracked in the same `activeQuests` array but evaluated separately in `evaluateTriggers()`.
- **Map enter event on game boot**: The initial map load (Emberwatch Village) fires `MAP_ENTERED` with `mapId: 'emberwatch_village'`. No active quest objectives match this — it's harmless. But ensure it doesn't crash or produce warnings.
- **Objective completion order**: The TODO.md acceptance gate says "when each authored trigger occurs in any supported order, then progress updates exactly once." The `completeOn*` fields define which triggers are valid for each objective. The system must not assume sequential processing — `evaluateTriggers()` checks all active quest objectives regardless of order.
- **Multiple quests from same NPC**: Elder Thalia may offer only the Fading Ward quest. Keth the Merchant offers the Lost Pendant quest. The dialogue system's `_deriveAuthoredChoices()` already iterates `getAllQuests()` and surfaces the first available. For multiple quests from one NPC, the choice derivation must surface all available quests, not just the first.
- **Reward delivery with missing item**: If a reward references an item ID not in `ITEM_CATALOG`, `inventoryService.addItem()` will throw or log a warning. The `_deliverRewards()` method must catch errors per-reward and continue (partial delivery with logging). The `rewardsGranted` flag should still be set to `true` if all rewards were attempted — partial failure is a bug in content, not a state corruption issue.
- **Bridge event for NPC interaction**: `NPC_INTERACTED` already exists as a bridge event (`types.ts`). `NPC_DIALOG_END` may also be relevant. `NPC_INTERACTED` fires when the player presses interact near an NPC — this is the correct trigger for `completeOnNpcInteract` objectives. But the objective should only advance if the NPC ID matches (not just any NPC interaction).
- **Item pickup event**: `ITEM_PICKED_UP` may not exist as a bridge event. The inventory system adds items via direct service calls without bridge events. A new event must be emitted when the player picks up an item from the world (not from vendor purchase or quest reward — those are different sources). Coordinate with the map item pickup system.
- **ECS worker quest emission architecture**: Two approaches exist: (A) ECS worker tracks quest components in bitECS and emits through the bridge, or (B) frontend `QuestStateService` is the sole owner and the ECS worker only emits world trigger events. **Recommendation**: Option B — quest logic stays in the frontend service. The ECS worker emits `MAP_ENTERED`, `NPC_INTERACTED`, `ENCOUNTER_COMPLETED`, and `ITEM_PICKED_UP` as world facts. `QuestStateService` evaluates these facts against quest objectives. This keeps quest logic out of the web worker and avoids serializing content pack data to the worker.
- **Quest log reactive updates**: `worldStateService.quests` is a `$state` array. The quest log `quest_view.svelte` reacts to changes automatically via Svelte 5 reactivity. No manual event emission is needed from `QuestStateService` if it updates `worldStateService.quests` directly. Alternatively, `QuestStateService` can own the quest array and the quest log reads from it directly (bypassing `worldStateService`). **Recommendation**: `QuestStateService` owns `quests` and the quest log reads from `questStateService.quests`. `worldStateService.quests` becomes a proxy or is deprecated in favor of `questStateService`.
- **Save envelope integration point**: `campaign_service.svelte.ts` manages Turso persistence. It currently serializes game state from multiple services. Adding quest state requires: (a) calling `questStateService.serialize()` during save, (b) storing the result in the campaign state record, (c) calling `questStateService.hydrate()` during load. The exact integration point depends on how C-321 (Turso migration) and C-334 (local save) structure the save envelope. For Phase 1, coordinate with the existing `campaign_service.saveState()` / `loadState()` methods.
- **Dialogue choice derivation for quests**: The `npc_dialogue_service.svelte.ts:_deriveAuthoredChoices()` currently picks the first quest from `getAllQuests()` without checking if it's already active/completed. Update the choice derivation to call `questStateService.canAcceptQuest()` to filter already-accepted/completed/declined quests.

## Open Questions

- **Quest state storage location in save envelope**: The `campaign_service.svelte.ts` save format is owned by C-321 (Turso). Where exactly should quest state be stored? **Recommendation**: Add a `questState` key at the top level of the campaign state record, next to player state, inventory, etc. Coordinate with the `campaign_service` implementation.
- **Quest tracker HUD scope**: Should the always-visible quest tracker HUD be part of this contract or C-332 (HUD redesign)? **Recommendation**: A minimal 1-2 line objective display is in scope for this contract (it's essential for quest UX). Full HUD redesign with overlay navigation is C-332.
- **Should objective labels be denormalized in save state?** Storing full labels in save state prevents stale labels if content pack changes, but bloats save size. **Recommendation**: Store only `{ objectiveIndex, current }` per quest and derive labels from content pack on hydrate. This is smaller and more resilient.
- **Should `QuestData` be emitted via `QUESTS_UPDATED` bridge event or through `$state` reactivity?** The existing pattern is bridge events from ECS worker → `worldStateService` listens → UI reacts. But `QuestStateService` runs in the main thread, not the worker. **Recommendation**: Skip the bridge for quest state — `QuestStateService` updates `quests = $state<QuestData[]>([])` directly, and Svelte 5 reactivity propagates to the UI. The bridge is used only for world trigger events from the ECS worker.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
