# Contract C-340: Build Party and Companion Gameplay

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/TODO.md` § C-340 — Phase 2 — Core RPG Depth and Replayability |
| **Target** | Party roster service, companion ECS components, follow/formation engine, party UI overlays, companion combat integration, content pack companion fields, save/load persistence |
| **Priority** | P1 — party interaction is central to D&D and differentiates the game from a solo chatbot RPG; without companions the combat/quest/progression systems (C-337–C-339) lack their primary multiplayer dimension. |
| **Dependencies** | C-212 (Party Follow System — `completed`), C-241 (Chat Modes & Address System — `completed`), C-328 (AI NPC Dialogue — `completed`), C-337 (Character Progression & Classes — `approved`), C-338 (Turn-Based Combat — `approved`), C-339 (Quest Graph & Journal — `implemented`) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | User-facing — party UI and companion mechanics need documentation in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Aikami is a single-character game. The player explores, talks, and fights alone. C-212 delivered the low-level `SET_ENTITY_VELOCITY` bridge plumbing and a sandbox at `/dev/sandbox/party-follow` where three hardcoded LPC NPCs can follow the player with collision-aware movement, but there is no production party system — no roster persistence, no recruit/dismiss from dialogue, no companion combat turns, no party UI overlay, no companion approval tracking, and no content pack integration for companion NPCs. The sandbox is a dev tool only.

- **Reproduction**:
  1. Start the production game (`/game`) — the player is always alone. No party members exist.
  2. Talk to an NPC (`/game` → approach NPC → press E) — the dialogue overlay opens with no "recruit" option. No NPC can join the party.
  3. Enter combat (`/game` → approach enemy) — only the player has a turn. No allies participate.
  4. Open the game UI (`/game` → overlays) — there is no party roster panel, no "Talk to Party" button, no companion management UI.
  5. Search for party-related code: `grep -r "PartyRoster\|partyRoster\|companion\|PartyMember" packages/ apps/` — the only result is the C-212 sandbox ViewModel's `PartyMember` type, which is sandbox-local, not a shared type.
  6. Check content pack schema: `ContentPackNpcEntrySchema` in `packages/shared/schemas/src/lib/game/content_pack.ts` has no `isCompanion`, `recruitDialogueKey`, or `companionClass` fields — NPCs are either neutral (dialogue-only) or enemies (combat). The concept of a recruitable companion NPC does not exist in the data model.

- **Existing implementation to reuse**:

  | What | Where |
  |---|---|
  | `SET_ENTITY_VELOCITY` bridge command + worker handler | `packages/frontend/engine/src/types.ts`, `ecs_worker.ts`, `game_world.ts` (C-212) |
  | Party follow sandbox (recruit/leave toggle, follow tick, LPC recipes) | `apps/frontend/client/src/lib/views/dev/sandbox/party_follow/` (C-212) |
  | NPC dialogue orchestrator with AI streaming + authored fallback | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` (C-328) |
  | Dialogue overlay ViewModel + View | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/` (C-328) |
  | Content pack NPC entries with combat stats, appearances, vendor config | `packages/shared/schemas/src/lib/game/content_pack.ts` (C-315/C-316) |
  | Class definitions + ability registry | `packages/shared/constants/src/lib/game/classes.ts` (C-337) |
  | Multi-actor combat with turn order, action economy, ally targeting | `packages/frontend/engine/src/systems/turn_manager_system.ts`, `combat_stage_system.ts` (C-338) |
  | Quest graph engine with objective tracking | `apps/frontend/client/src/lib/services/game/quest_state_service.svelte.ts` (C-339) |
  | Character relationship schema (trust, affinity, history) | `packages/shared/schemas/src/lib/database/relationship.ts` (C-341 preparation) |
  | Game UI overlay router (HUD + overlay management) | `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` (C-332) |
  | Player state service (persistence pattern) | `apps/frontend/client/src/lib/services/game/player_state_service.svelte.ts` |
  | Game state service (save/load, variable store) | `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts` |
  | Interaction system (E key → closest NPC) | `packages/frontend/engine/src/systems/interaction_system.ts` |
  | CombatStats SoA (health, xp, level, classId) — already used by enemies | `packages/frontend/engine/src/components/combat_stats.ts` |
  | TurnOrder SoA (currentTurn, initiativeValue, isActive) | `packages/frontend/engine/src/components/turn_order.ts` |

- **Known gaps**:

  1. **No companion NPC distinction**: The engine has `Enemy` tag and civilian NPCs (via `NPCDialog` + no `Enemy` tag). There is no `Companion` tag or `PartyMember` ECS component to distinguish party members from other entity types. Companions need to be friendly to the player, hostile to enemies, and participant in turn-based combat.

  2. **No party roster data model**: No shared type, schema, or service tracks which NPCs are in the player's party across sessions. The C-212 sandbox uses local `PartyMember[]` state that evaporates on page navigation.

  3. **No recruit/dismiss flow**: The interaction system emits `NPC_INTERACTED` which opens the dialogue overlay, but the dialogue system has no "recruit companion" action or response type. The player can talk to NPCs but cannot ask them to join.

  4. **Combat excludes allies**: C-338's turn manager iterates `TurnOrder.isActive` entities — currently only the player and enemies. Companions need to be added to the turn order, have their own action economy, and be targetable by enemy tactics.

  5. **No "Talk to Party" UI**: The dialogue overlay only opens when interacting with a world NPC. There is no UI to initiate conversation with a party member who is already recruited.

  6. **No formation system**: C-212 followers converge on the player's position with hardcoded offsets. There is no formation management (line, column, spread), no leader-switching, and no formation-aware pathfinding.

  7. **No companion equipment/view**: Companions don't have an equipment screen or character sheet accessible from the party UI.

  8. **Content pack has no companion fields**: `ContentPackNpcEntrySchema` lacks `isCompanion`, `recruitDialogueKey`, `dismissDialogueKey`, `companionClassId`, `personalQuestId`, `initialApproval`, and `banterPool` fields.

- **Baseline tests**:
  - `apps/e2e/tests/client/chat_modes.spec.ts` — covers chat mode toggle and party mode button (C-241). Run before starting: `bun moon run e2e:test -- --grep "chat modes"`.
  - `packages/frontend/engine/src/__tests__/goap_combat_tactics.test.ts` — references "weak companion" as valid target in enemy targeting tests. Run before starting: `bun moon run engine:test`.
  - `packages/frontend/engine/src/__tests__/combat_sync.test.ts` — combat ViewModel interface tests.
  - `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts` — dialogue overlay unit tests (C-328).

## User Outcome

After this contract, a player can recruit companions through dialogue, manage a party roster, see companions follow them in formation through the game world, talk to party members at any time, hear party banter during exploration, and have companions fight alongside them in combat — all with save/load persistence so companions survive across sessions.

## Success Measures

- **Time/latency target**: Companion follow velocity updates at 100–150ms tick intervals (C-212 baseline). Recruit/dismiss dialogue actions complete within the normal dialogue response window (< 3s with AI, instant with authored fallback).
- **Offline/degraded behavior**: When AI is unavailable, companion dialogue degrades to authored fallback lines (C-328 pattern). Follow/formation is purely engine-side — no network dependency. Combat turns use deterministic rules kernel (C-336/C-338).
- **Production journey enabled**: A player creates a Fighter (C-319), meets Lydia the Cleric in Emberwatch (C-316), recruits her through dialogue, sees her follow in formation, talks to her via the party panel, fights goblins together with Lydia healing, gains approval from shared quest completion, and loads the save with Lydia still in the party.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Entity velocity bridge (SET_ENTITY_VELOCITY) | `packages/frontend/engine/src/types.ts`, `ecs_worker.ts`, `game_world.ts` (C-212) | **Reuse** — already generic, works for any entity |
| Follow tick loop + LPC spawning | `apps/frontend/client/src/lib/views/dev/sandbox/party_follow/` (C-212) | **Modify** — extract follow logic into a production service, remove sandbox hardcoding |
| NPC dialogue orchestrator | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` (C-328) | **Modify** — add companion-aware dialogue routing and recruit/dismiss response types |
| Dialogue overlay ViewModel | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/` (C-328) | **Modify** — add recruit button rendered from dialogue response metadata |
| Content pack NPC entries | `packages/shared/schemas/src/lib/game/content_pack.ts` (C-315/C-316) | **Modify** — add companion-specific optional fields |
| Combat turn manager | `packages/frontend/engine/src/systems/turn_manager_system.ts` (C-338) | **Modify** — include companions in turn order, reserve companion control policy slot |
| Combat stage system | `packages/frontend/engine/src/systems/combat_stage_system.ts` (C-338) | **Modify** — stage companion sprites alongside player (left stage, multi-row) |
| Enemy GOAP tactics | `packages/frontend/engine/src/systems/goap_combat_tactics_system.ts` (C-338) | **Reuse** — already scans for non-player CombatStats entities as valid targets |
| Game UI overlay router | `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` (C-332) | **Modify** — add PARTY_ROSTER and TALK_TO_PARTY overlay types |
| Interaction system | `packages/frontend/engine/src/systems/interaction_system.ts` | **Reuse** — NPC interaction flow unchanged; recruit is a dialogue-layer concern |
| CombatStats ECS component | `packages/frontend/engine/src/components/combat_stats.ts` | **Reuse** — companions use same SoA as player/enemies |
| TurnOrder ECS component | `packages/frontend/engine/src/components/turn_order.ts` | **Reuse** — companions get TurnOrder on combat start |
| CharacterRelationship schema | `packages/shared/schemas/src/lib/database/relationship.ts` | **Reuse** — companion approval stored as CharacterRelationship with relationshipType `'ally'` |
| Quest state service | `apps/frontend/client/src/lib/services/game/quest_state_service.svelte.ts` (C-339) | **Reuse** — companion personal objectives use existing quest graph |
| Player state service (persistence) | `apps/frontend/client/src/lib/services/game/player_state_service.svelte.ts` | **Modify** — add party roster to save/load envelope |
| Entity spawner | `packages/frontend/engine/src/systems/entity_spawner.ts` | **Modify** — add Companion component attachment for companion NPC spawns |
| Class definition constants | `packages/shared/constants/src/lib/game/classes.ts` (C-337) | **Reuse** — companions reference classId from same registry |

## Overview

C-340 transforms Aikami from a solo-adventurer game into a party-based RPG. It builds on C-212's existing `SET_ENTITY_VELOCITY` bridge plumbing and party-follow sandbox to deliver a production party system: companions are recruitable NPCs with their own class, combat stats, approval tracking, personal objectives, and persistence. The work spans five tightly integrated subsystems: (1) the data model and ECS components that distinguish companions from regular NPCs, (2) the recruit/dismiss flow wired into the existing AI dialogue overlay, (3) the formation follow system extracted from the C-212 sandbox into a production service, (4) the "Talk to Party" overlay and party panel UI, and (5) companion participation in C-338's multi-actor combat. Each subsystem depends on its predecessor — splitting would produce contracts that cannot be independently verified.

## Design Reference

- **C-212 Party Follow Sandbox**: `apps/frontend/client/src/lib/views/dev/sandbox/party_follow/` — the follow tick, `SET_ENTITY_VELOCITY` usage, NPC spawn tracking, and recruit/leave toggle. Extract into production services.
- **C-328 Dialogue Orchestrator**: `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` — the `sendMessage()`, `generateTurn()`, and authored fallback pattern. Companion dialogue routes through the same orchestrator with a different system prompt.
- **C-338 Combat Turn Manager**: `packages/frontend/engine/src/systems/turn_manager_system.ts` — the action economy, `advanceTurn()`, and multi-target resolution. Companions extend the existing multi-actor model.
- **C-339 Quest Graph**: `apps/frontend/client/src/lib/services/game/quest_state_service.svelte.ts` — quest activation, objective tracking, completion. Companion personal objectives are standard quest entries with `personalQuestOfNpcId`.
- **C-332 Game UI Overlay Router**: `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` — the `activeOverlay` discriminated union and sub-ViewModel factory pattern. New PARTY_ROSTER and TALK_TO_PARTY overlays follow the same pattern as INVENTORY, QUEST_LOG, etc.
- **Service pattern**: `apps/frontend/client/src/lib/services/game/` — singleton services with `$state`, `BaseClass` inheritance, `ClassName.create()` factory. New `partyRosterService` follows `playerStateService` pattern.
- **ECS component pattern**: `packages/frontend/engine/src/components/` — SoA arrays, `register*Observers(world)`, observer payload types. New `Companion` tag component follows `Enemy` pattern.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

### Shared Data Layer (`packages/shared/`)

- Add companion-specific optional fields to `ContentPackNpcEntrySchema` in `packages/shared/schemas/src/lib/game/content_pack.ts`: `isCompanion`, `recruitDialogueKey`, `dismissDialogueKey`, `companionClassId`, `personalQuestId`, `initialApproval`, `banterPool`.
- Add `PartyRosterEntrySchema` (TypeBox) to `packages/shared/schemas/src/lib/game/party.ts` (new file). Fields: `npcId`, `name`, `classId`, `level`, `approval`, `recruitedAt`, `personalQuestActive`, `equipmentSlotIds`.
- Add `PartyStateSchema` (TypeBox) to same file: wrapper with `members: PartyRosterEntry[]`, `maxSize`, `formation`.
- Derive types in `packages/shared/types/src/lib/game/party.ts` (new file): `PartyRosterEntry`, `PartyState`, `FormationType` via `Static<typeof Schema>`.
- Export from `packages/shared/schemas/src/index.ts` and `packages/shared/types/src/index.ts`.

### Engine (`packages/frontend/engine/`)

- Add `Companion` tag component in `packages/frontend/engine/src/components/companion.ts` (new file). SoA fields: `companionId` (string handle via StringRegistry), `approval` (int -100 to 100), `recruited` (bool). Follows `Enemy` component pattern.
- Register `Companion` observers in the component index.
- Modify `entity_spawner.ts`: when spawning an NPC whose `ContentPackNpcEntry.isCompanion` is true, attach the `Companion` component.
- Modify `encounter_system.ts`: companions with `Companion` + `CombatStats` are exempt from triggering encounters (they're allies, not enemies). The encounter check currently detects spatial overlap of Enemy tag with player — companions should not trigger or be targeted by this check.
- Modify `combat_stage_system.ts`: stage companions on the left side alongside the player, in a vertical stack offset. The existing single-player left-stage layout (20% screen width) becomes a multi-row layout: player front-center, companions stacked behind/above.
- Modify `turn_manager_system.ts`: at combat start, add `TurnOrder` to all entities with `Companion` + `CombatStats` + `Position`. Companions use AI auto-control (C-338's existing GOAP or a simpler "default attack nearest enemy" policy). The player does not manually control companion turns in this contract — companion combat control policy (manual vs AI toggle) is addressed by the companion-specific AI action selector.
- Modify `goap_combat_tactics_system.ts`: the existing code at line 302 already scans for non-player `CombatStats` entities as valid targets — companions will naturally be targeted by enemies without code changes. Verify no false-positive targeting of unrecruited NPC companions.

### Client Services (`apps/frontend/client/src/lib/services/game/`)

- Add `party_roster_service.svelte.ts` (new file): singleton service managing party state. Stores `PartyState` in `$state`. Methods: `recruit(npcId)`, `dismiss(npcId)`, `getActiveMembers()`, `getApproval(npcId)`, `adjustApproval(npcId, delta)`, `hasMember(npcId)`. Exposes a reactive `activeCount` getter and `members` array.
- Add `party_follow_service.svelte.ts` (new file): singleton service extracted from C-212 sandbox. Takes `GameWorld` reference on init. Runs follow tick at 150ms intervals. Reads party roster to determine active followers. Computes formation positions based on player position + formation config. Applies `SET_ENTITY_VELOCITY` via engine bridge. Handles arrival radius, leader position tracking, and map-transition cleanup.
- Add `party_dialogue_service.svelte.ts` (new file): companion-specific dialogue routing. When the player selects "Talk to Party" → companion, this service calls `npcDialogueService.generateTurn()` with a companion-specific system prompt (includes approval level, personal quest context, shared history). Handles banter triggers (periodic inter-companion dialogue).
- Modify `npc_dialogue_service.svelte.ts` (C-328): add a `recruitResponse` action type to the dialogue response model. When the NPC's dialogue tree reaches a `recruitDialogueKey`, the response includes `actionType: 'recruit'` which the dialogue overlay renders as a "Recruit" button.
- Modify `player_state_service.svelte.ts`: add `partyState` to the save/load envelope. Serialize `PartyState` alongside existing player data. Hydrate party roster on load.
- Modify `game_state_service.svelte.ts`: add `getActiveCompanions()` and `getCompanionContextForAI()` methods so the AI GM prompt includes party composition.

### Client Views (`apps/frontend/client/src/lib/views/`)

- Add `game/ui/overlays/party_roster/` (new directory): party roster overlay with member list, approval bars, class icons, Talk/Equipment/Dismiss buttons per member. Follows the existing overlay pattern (ViewModel + View + `*_view_model.svelte.ts` + `*_view.svelte`).
- Add `game/ui/overlays/talk_to_party/` (new directory): companion dialogue overlay. Reuses the dialogue chat UI pattern from `dialogue_overlay.svelte` but opens on a companion instead of a world NPC. The companion portrait/name replaces the NPC header.
- Add party panel HUD component: small persistent widget in the game HUD showing companion count + quick access button to open the party roster. Positioned near the HP bar (top-left HUD area per C-332).
- Modify `game_ui_view_model.svelte.ts`: add `PARTY_ROSTER` and `TALK_TO_PARTY` to the `activeOverlay` discriminated union. Create and manage sub-ViewModels for party overlays.
- Modify `game_ui_view.svelte`: add party-related overlay rendering in the overlay router `{#if}` chain.
- Modify `dialogue_overlay_view_model.svelte.ts` / `dialogue_overlay.svelte`: detect `actionType: 'recruit'` in dialogue responses and render a "Recruit" button that calls `partyRosterService.recruit(npcId)`.

## State & Data Models

### Content Pack Companion Extension (TypeBox — `packages/shared/schemas/src/lib/game/content_pack.ts`)

```typescript
// Extend ContentPackNpcEntrySchema with optional companion fields:

const CompanionFieldsSchema = Type.Object({
  /** Whether this NPC can be recruited as a companion. */
  isCompanion: Type.Optional(Type.Boolean({ default: false })),
  /** Dialogue key that triggers the recruit offer. */
  recruitDialogueKey: Type.Optional(Type.String()),
  /** Dialogue key for dismiss conversation. */
  dismissDialogueKey: Type.Optional(Type.String()),
  /** Class ID from the class registry (C-337). e.g. 'cleric', 'fighter'. */
  companionClassId: Type.Optional(Type.String()),
  /** Optional personal quest ID (references a quest in the manifest). */
  personalQuestId: Type.Optional(Type.String()),
  /** Initial approval score (-100 to 100). */
  initialApproval: Type.Optional(Type.Integer({ minimum: -100, maximum: 100, default: 0 })),
  /** Pool of banter dialogue keys for inter-party chatter. */
  banterPool: Type.Optional(Type.Array(Type.String(), { default: [] })),
});
```

### Party Roster Schema (TypeBox — `packages/shared/schemas/src/lib/game/party.ts`)

```typescript
import { Type, type Static } from '@sinclair/typebox';

export const PartyRosterEntrySchema = Type.Object({
  /** Content pack NPC ID. */
  npcId: Type.String(),
  /** Display name (denormalized for quick access). */
  name: Type.String(),
  /** Class ID from C-337 class registry. */
  classId: Type.String(),
  /** Current level (tracks with player progression or independent). */
  level: Type.Integer({ minimum: 1 }),
  /** Approval score (-100 to 100). */
  approval: Type.Integer({ minimum: -100, maximum: 100 }),
  /** ISO 8601 timestamp of recruitment. */
  recruitedAt: Type.String({ format: 'date-time' }),
  /** Whether the companion's personal quest is active. */
  personalQuestActive: Type.Boolean({ default: false }),
  /** Equipped item IDs (references C-331 item registry). */
  equipmentSlotIds: Type.Array(Type.String(), { default: [] }),
});

export const PartyStateSchema = Type.Object({
  /** Current party members. */
  members: Type.Array(PartyRosterEntrySchema, { default: [] }),
  /** Maximum party size (content-defined, default 4). */
  maxSize: Type.Integer({ minimum: 1, maximum: 6, default: 4 }),
  /** Current formation type. */
  formation: Type.Union([
    Type.Literal('line'),
    Type.Literal('column'),
    Type.Literal('spread'),
  ], { default: 'line' }),
});

export type PartyRosterEntry = Static<typeof PartyRosterEntrySchema>;
export type PartyState = Static<typeof PartyStateSchema>;
export type FormationType = Static<typeof PartyStateSchema>['formation'];
```

### ECS Companion Component (`packages/frontend/engine/src/components/companion.ts`)

```typescript
// SoA component for companion entities.
export const Companion = {
  /** Handle into StringRegistryService for the companion's npcId. */
  companionIdHandle: [] as number[],
  /** Approval score at entity level (mirrors roster data). */
  approval: [] as number[],
  /** Whether this companion has been recruited (vs spawned but not yet recruited). */
  recruited: [] as boolean[],
};

export type CompanionData = {
  companionIdHandle: number;
  approval: number;
  recruited: boolean;
};

export const registerCompanionObservers = (world: World): void => {
  observe(world, onSet(Companion), (eid: number, params: CompanionData) => {
    Companion.companionIdHandle[eid] = params.companionIdHandle;
    Companion.approval[eid] = params.approval;
    Companion.recruited[eid] = params.recruited;
  });
  observe(world, onGet(Companion),
    (eid: number): CompanionData => ({
      companionIdHandle: Companion.companionIdHandle[eid],
      approval: Companion.approval[eid],
      recruited: Companion.recruited[eid],
    }),
  );
};
```

### Service State Shape (client-side)

```typescript
// PartyRosterService internal $state shape
type PartyRosterServiceState = PartyState & {
  /** Map of npcId → entity ID for active companion ECS entities. */
  entityMap: Map<string, number>;
};
```

## Quality Requirements

- **Offline/degraded mode**: Follow/formation is purely engine-side (no network). Companion combat turns use deterministic AI (no AI call per turn). Companion dialogue degrades to authored fallback lines when AI is unavailable (C-328 pattern). Recruit/dismiss is gated by authored dialogue keys — no AI required for the recruit action itself.
- **Accessibility/input**: Party roster overlay must be keyboard-navigable (Tab between members, Enter to talk/equip/dismiss, Escape to close). The Talk to Party overlay reuses the dialogue overlay's existing keyboard patterns. The party HUD button must have a keyboard shortcut (default: `P` for party panel).
- **Performance budget**: Follow tick at 100–150ms intervals (6–10 updates/sec). Position calculations use squared-distance math (no `Math.sqrt`). Formation offsets computed once per tick per active companion (O(n) where n ≤ 4). Combat stage layout computed once on combat start. No per-frame allocation in the follow hot path — reuse velocity payload objects.
- **Security/privacy**: Companion approval and personal quest data stored in local Turso database (C-321). No companion data exposed to cloud AI unless explicitly included in the dialogue context. Companion dialogue AI calls use the same provider gateway as NPC dialogue (C-320/C-322) — no separate API key or permission needed.
- **Persistence/migration**: `PartyState` is saved alongside player state in Turso (C-321). On load, the party roster is hydrated and companions are re-spawned in the game world at the player's current map/location. Save format is versioned — a `schemaVersion` field on the save envelope allows migration from solo-player saves (v0, no `partyState`) to v1 saves (with `partyState`). V0 saves load with empty party roster.
- **Cancellation/retry/idempotency**: Recruit/dismiss operations are idempotent — recruiting an already-recruited companion is a no-op (returns existing roster entry). Dismissing an already-dismissed companion is a no-op. Follow velocity commands are inherently idempotent (overwrite previous velocity). Combat turn actions are already idempotent via C-336's rules kernel pattern.
- **Observability**: Use `this.debug()` (service subclasses) for `recruit`, `dismiss`, `follow:tick`, `partyDialogue:send`, `companionCombat:turn` events. Engine-side: log companion spawn/despawn via existing worker logging pattern. No new metrics infrastructure needed.

## Migration & Rollback

- **Old data compatibility**: Saves created before C-340 (v0) have no `partyState` field. The save loader detects missing `partyState` and defaults to `{ members: [], maxSize: 4, formation: 'line' }`. This is a read-side migration — the v0 save is not mutated on disk until the next save operation.
- **Migration**: On first save after C-340, `partyState` is written alongside existing player state. No explicit migration script needed — the save format is additive.
- **Rollback**: Rolling back to a pre-C-340 build will ignore the `partyState` field (unknown JSON key in the save envelope). The player will be solo again but no data is lost. On re-upgrading, the `partyState` will be read again.
- **Feature flag or kill switch**: A `PARTY_SYSTEM_ENABLED` feature flag in the app config (or content pack manifest) disables party functionality. When disabled, the party HUD widget is hidden, recruit options are stripped from dialogue, and companions are not spawned. This allows the Emberwatch demo (C-316) to ship without party mechanics if needed.
- **Failure recovery**: If party roster hydration fails (corrupted save, schema mismatch), the system falls back to an empty roster and logs a warning via `this.warn()`. The player is not blocked from entering the game.

## Scope Boundaries

- **In Scope:**
  - Party roster data model (TypeBox schema + derived types + service)
  - Companion ECS tag component and observer registration
  - Content pack schema extension for companion NPC fields
  - Recruit/dismiss flow through the existing NPC dialogue overlay
  - Formation follow system extracted from C-212 sandbox into production service
  - Party panel HUD widget and party roster overlay UI
  - Talk to Party overlay (companion dialogue via existing orchestrator)
  - Companion approval tracking (static score, adjusted by dialogue choices and quest outcomes)
  - Companion participation in turn-based combat (AI-controlled turns)
  - Companion combat staging alongside player
  - Party state persistence (save/load in Turso via existing player state envelope)
  - Companion personal quest activation through C-339 quest graph
  - Keyboard shortcut for party panel (`P` key)

- **Out of Scope:**
  - Full relationship/faction system with history events (C-341)
  - Companion autonomous schedules and offscreen simulation (C-352)
  - AI Game Master narrative direction for companions (C-351)
  - Generated companion arcs (C-354)
  - Companion voice acting, expressions, or portraits (C-355)
  - Manual companion control in combat (companions are AI-controlled; manual override is deferred to a future contract)
  - Companion permadeath (companions go to downed state like the player, per C-338; no permanent removal on death)
  - Companion romance arcs, jealousy, or inter-companion conflict (C-341)
  - Companion trading/inventory exchange UI (companions use their own equipment slots defined in the content pack)
  - Multiplayer co-op (C-366)
  - Leader switching (player is always the formation leader)
  - Companion-specific skill checks (companions use player's skill check system)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs touching 3 project layers (shared schemas/types, engine, client). The subsystems are tightly interwoven — the companion ECS component is meaningless without the recruit flow, which is meaningless without the party roster, which is meaningless without the follow system. Splitting by layer would produce placeholder contracts (e.g., "add Companion component" with no consumer to verify against). The engine changes are small enablers (~3 new/modified components, 2 modified systems) that enable the client-side work but cannot be independently verified. **Single contract, 5 ACs.**

## Acceptance Criteria

### AC-1: Recruit and Dismiss Companions Through NPC Dialogue
**Given** the player is exploring the Emberwatch map and approaches an NPC marked as `isCompanion: true` in the content pack (e.g., Lydia the Cleric at `recruitDialogueKey: 'lydia_meet'`)
**When** the player interacts with the NPC (presses E), the dialogue overlay opens, conversation proceeds through the authored dialogue tree, reaches the `recruitDialogueKey`, and the player clicks the "Recruit" button in the dialogue response
**Then** the companion is added to the party roster, the NPC entity gets the `Companion` ECS component with `recruited: true`, the party HUD widget updates to show active companion count incrementing, and the companion begins following the player. Dismissing from the party roster overlay removes the companion from the roster, strips the `Companion.recruited` flag (entity may remain as a world NPC or despawn based on content pack config), and the party HUD updates.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Integration + E2E | `packages/shared/schemas/src/lib/game/party.test.ts` (new), `apps/frontend/client/src/lib/services/game/party_roster_service.test.ts` (new), `apps/e2e/tests/game/party_recruit_dismiss.spec.ts` (new) | `/game` → approach companion NPC → E → dialogue → Recruit button | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run :typecheck`, `bun moon run client:test -- --grep "party_roster"`
- Integration: Manual check at `/game` with Emberwatch content pack — approach Lydia, verify dialogue tree reaches recruit prompt, click Recruit, verify party HUD shows "1", open party roster, verify Lydia listed, click Dismiss, verify roster empty.
- E2E / Visual:
    - **Functional**: `tests/game/party_recruit_dismiss.spec.ts` — test: recruit NPC via dialogue, verify party HUD count, open party panel, dismiss companion, verify empty roster.
    - **Visual**: N/A — recruit/dismiss is a functional flow, not visual. The party roster overlay visual appearance is covered by AC-3.

**Watch Points**:
- Dialogue overlay's `endChat()` must not clear the recruited state — the recruit action is committed before the overlay closes.
- Recruiting an already-recruited companion must be idempotent (no-op, log a debug message).
- Dismissing a companion during combat must be prevented (or deferred to combat end).
- NPC entities with `isCompanion: true` but not yet recruited must not participate in combat or follow.

### AC-2: Companions Follow in Formation During Exploration
**Given** the player has one or more active companions in the party roster and is in EXPLORE mode on a map
**When** the player moves through the game world
**Then** each active companion follows the player using `SET_ENTITY_VELOCITY` bridge commands (C-212), with position offsets determined by the current formation (`line`: behind the player in a staggered column, `column`: tight single file, `spread`: fan behind the player). Companions use the existing collision-aware movement system (C-212) — they navigate around walls and obstacles. When the player stops, companions converge to their formation positions and stop. When a map transition is triggered (C-138), all companions are moved to the new map alongside the player. The camera (C-137) continues to follow the player — companions may be partially out of frame if formation offsets place them behind the viewport.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Visual | `packages/frontend/engine/src/__tests__/companion_follow.test.ts` (new), `apps/frontend/client/src/lib/services/game/party_follow_service.test.ts` (new), `src/visual/suites/party_follow.visual.ts` (new) | `/game` → explore with companions → observe formation | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test -- --grep "companion_follow"`, `bun moon run client:test -- --grep "party_follow"`
- Integration: Manual check at `/game` — recruit 2+ companions, move player in different directions, verify companions follow with collision avoidance, verify formation offsets (line formation: companions staggered behind player).
- E2E / Visual:
    - **Functional**: N/A — follow behavior requires real-time visual observation, not suitable for Playwright assertions.
    - **Visual**: `suites/party_follow.visual.ts` — test cases: (1) "Single companion follows in line formation" at `/game` with 1 recruited companion, player moves south on map, verify companion sprite trails behind player at ~40px offset; (2) "Two companions in line formation" — verify both sprites visible, staggered offsets; (3) "Companion stops when player stops" — verify companion sprite stationary. Criteria: "Score 90+: companion sprites visible, correctly positioned behind player, no overlapping sprites, movement appears smooth."

**Watch Points**:
- Formation offsets must be configurable per content pack (default: `FOLLOW_OFFSETS` from C-212 sandbox).
- If a companion's formation position is blocked by collision geometry, the companion falls back to the nearest walkable tile.
- Map transitions must despawn companion entities on the old map and respawn on the new map at the player's entry point + formation offsets.
- Follow tick must be paused during combat (combat stage handles companion positions) and during dialogue overlays.

### AC-3: Party Roster Overlay and Party Panel HUD
**Given** the player is in the game with at least one companion in the party roster
**When** the player presses the `P` key (or clicks the party HUD widget)
**Then** the party roster overlay opens (following the existing overlay pattern: modal with backdrop, Escape to close, Tab navigation between members). The overlay displays each party member with their name, class icon, level, HP bar, approval bar (-100 to 100, color-coded: green > 0, red < 0, grey = 0), and action buttons: "Talk" (opens Talk to Party overlay for that companion), "Equipment" (opens character dashboard for that companion, reusing C-337's character sheet ViewModel filtered to the companion's class), "Dismiss" (removes companion from party with confirmation dialog). The party HUD widget in the top-left game UI area shows the companion count (e.g., "🧑‍🤝‍🧑 2/4") and is clickable to open the roster. The widget is hidden when the roster is empty.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + E2E + Visual | `apps/frontend/client/src/lib/views/game/ui/overlays/party_roster/party_roster_view_model.test.ts` (new), `apps/e2e/tests/game/party_roster_ui.spec.ts` (new), `src/visual/suites/party_roster.visual.ts` (new) | `/game` → P key → party roster overlay | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- --grep "party_roster"`
- Integration: Manual check — recruit 2 companions, press P, verify overlay shows both with correct name/class/approval, click Talk on companion 1, verify Talk to Party overlay opens, close it, click Equipment, verify character dashboard opens with companion's class, close, click Dismiss, confirm, verify companion removed.
- E2E / Visual:
    - **Functional**: `tests/game/party_roster_ui.spec.ts` — test: open party roster with keyboard shortcut, verify member list rendered, verify Escape closes overlay, verify Tab cycles through member action buttons, verify Dismiss with confirmation flow.
    - **Visual**: `suites/party_roster.visual.ts` — test cases: (1) "Party roster with 2 members" at `/game` with 2 companions recruited, open party overlay, verify member cards with class icons, approval bars, and action buttons; (2) "Empty party roster" — verify overlay shows "No companions" empty state; (3) "Party HUD widget" — verify top-left HUD shows companion count badge. Criteria: "Score 90+: overlay renders correctly with member cards, approval bars are color-coded, HUD widget visible in correct position."

**Watch Points**:
- The party roster overlay must coexist with the existing overlay router — opening the party roster while another overlay is active should either stack (push current overlay) or replace, per C-332's overlay policy.
- Companion character dashboard must be read-only for equipment slots the companion class can't use (e.g., a Cleric companion can't equip plate armor). This is enforced by C-337's class equipment restrictions.
- The "Dismiss" action must show a confirmation dialog ("Dismiss Lydia? They will return to their original location.") to prevent accidental removal.

### AC-4: Companions Participate in Turn-Based Combat
**Given** the player has one or more active companions and triggers combat by approaching an enemy (C-330 encounter system)
**When** combat initializes
**Then** all active companions are added to the combat turn order alongside the player and enemies. Companions receive `TurnOrder` components, are staged on the left side of the combat stage (stacked vertically behind the player), and receive a fresh action economy each turn (standard action + bonus action + reaction, per C-338). During a companion's turn, the companion AI selects a combat action based on their class role: melee classes (Fighter, Barbarian) attack the nearest enemy, ranged classes (Ranger) attack from a distance, support classes (Cleric, Wizard) heal damaged allies or buff. Enemy GOAP tactics (C-338) can target companions as valid threats. Companions use their `CombatStats` (health, attack, defense, accuracy) and `classId` from the content pack. When a companion reaches 0 HP, they enter the downed state (C-338 death save system). On combat end (victory or retreat), companions return to formation follow mode, surviving companions retain their post-combat HP, and downed companions are revived at 1 HP.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Integration + E2E | `packages/frontend/engine/src/__tests__/companion_combat.test.ts` (new), `apps/e2e/tests/game/combat_companion.spec.ts` (new) | `/game` → trigger combat with companions → companion turns execute | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test -- --grep "companion_combat"`, `bun moon run e2e:test -- --grep "combat companion"`
- Integration: Manual check — recruit 2 companions (Fighter + Cleric), trigger combat with goblins, observe companion sprites on the combat stage (left side), observe companion turns executing in the turn order display, verify Cleric companion heals when ally HP is low, verify Fighter attacks nearest enemy, verify enemy attacks can target companions, verify downed companion stops acting.
- E2E / Visual:
    - **Functional**: `tests/game/combat_companion.spec.ts` — test: recruit companion, trigger combat (via `SPAWN_NPC` with enemy combat stats, or via the encounter system by approaching an enemy), verify companion entity receives TurnOrder, advance through turns, verify companion AI action is logged, kill enemy, verify combat ends with companion returning to follow mode.
    - **Visual**: N/A — combat turn behavior is functional, not visual. The combat stage layout is visual but already covered by C-338's visual tests. Companion sprites on the combat stage extend the existing layout.

**Watch Points**:
- Companion combat AI must be synchronous (no async AI calls during combat) — use deterministic targeting rules based on class role and tactical state. This keeps combat turn latency at the C-338 baseline.
- If all companions are downed and the player is alive, combat continues with only the player's turns. If the player is downed and companions are alive, companions continue fighting (companion AI does not surrender).
- Companion XP gain mirrors the player's — all combat XP is shared equally among active party members (player + companions). The `grantXp` rules command (C-336/C-337) is called once per entity with the total XP divided.
- Companions must not use consumable items from the player's inventory — they have their own equipment and ability set. This is enforced by the companion AI action selector only offering abilities from the companion's class ability registry.
- Combat stage layout for > 3 companions: switch from vertical stack to 2-column grid (2×2 for 4 companions) to avoid sprites being pushed off-screen.

### AC-5: Party State Persists Across Save/Load
**Given** the player has recruited companions, gained approval, and advanced personal quests
**When** the player triggers a save (manual save, autosave per C-334, or checkpoint per C-344) and later loads that save
**Then** the party roster is fully restored: all companions are present with their correct `npcId`, `classId`, `level`, `approval` score, `personalQuestActive` flag, and `equipmentSlotIds`. Companions are re-spawned in the game world at the player's current map and location (formation offsets applied). Companion approval scores match their pre-save values. Personal quests that were active remain active in the quest journal. A save created before C-340 (v0, no `partyState`) loads with an empty party roster without error.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + E2E | `apps/frontend/client/src/lib/services/game/party_roster_service.test.ts` (extend AC-1), `apps/e2e/tests/game/party_persistence.spec.ts` (new) | `/game` → recruit companions → save → reload → verify companions restored | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- --grep "party_roster.*persist"`, `bun moon run e2e:test -- --grep "party persistence"`
- Integration: Manual check — recruit 2 companions, note their approval scores, save game, reload page, load save, verify party roster populated with same companions and same approval scores, verify companions are in formation behind player on the current map.
- E2E / Visual:
    - **Functional**: `tests/game/party_persistence.spec.ts` — test: recruit companion, trigger save (via autosave service or manual save button), reload page, load save, assert companion in roster with matching approval/class/level.
    - **Visual**: N/A — persistence is a data correctness concern, not visual.

**Watch Points**:
- Save format is additive: `partyState` is a top-level key in the save envelope alongside existing `playerState`, `questState`, `inventoryState`, etc. The save envelope version field must be bumped to distinguish pre-C-340 saves.
- Companion ECS entities do not persist — only the roster data persists. On load, companions are re-spawned via `SPAWN_NPC` bridge commands from the content pack data referenced by `npcId`.
- If a companion's `npcId` references a content pack NPC that no longer exists (content pack version mismatch), the companion is skipped with a warning log. The rest of the party loads normally.
- Autosave must include party state (C-334). The autosave trigger conditions (time-based, combat-end, location-change) are unchanged — the party state is just another key in the save payload.

## Implementation Sequence

1. **Phase 1 (Data & Engine)**: Define `PartyRosterEntrySchema` / `PartyStateSchema` in shared schemas. Add companion fields to `ContentPackNpcEntrySchema`. Derive types. Add `Companion` ECS component + observers. Register in entity spawner for companion NPCs. Modify encounter system to exclude companions. Wire party state into save/load envelope.

2. **Phase 2 (Services)**: Create `party_roster_service.svelte.ts`. Create `party_follow_service.svelte.ts` (extract from C-212 sandbox). Create `party_dialogue_service.svelte.ts`. Modify `npc_dialogue_service` to support recruit response type. Wire services into `$services` barrel.

3. **Phase 3 (Views & UI)**: Build party roster overlay (ViewModel + View). Build Talk to Party overlay. Add party HUD widget. Modify game UI overlay router. Add recruit button to dialogue overlay.

4. **Phase 4 (Combat Integration)**: Modify `turn_manager_system.ts` to include companions in turn order. Add companion AI action selector (deterministic, class-role-based). Modify `combat_stage_system.ts` for companion staging layout. Verify enemy GOAP tactics target companions.

5. **Phase 5 (Validation)**: Run `validate()`. Run all baseline tests. Run new party-specific tests. Manual integration checks at `/game`. Visual suite for formation follow and party roster overlay.

## Edge Cases & Gotchas

- **Companion count > formation slots**: If the party roster has more members than formation offsets (default: 3 offset slots), additional companions form a second row behind the first row. The follow tick scales formation math accordingly.
- **Companion NPC dies before recruitment**: If a companion NPC entity is killed (e.g., by a wandering enemy) before the player recruits them, the recruit dialogue option must be hidden or replaced with a "they're dead" response. Content pack authors control this via dialogue branching.
- **Companion stuck in collision geometry**: C-212 follow already handles collision — if a formation position is blocked, the companion falls back to the nearest walkable tile. If the player teleports (map transition, cutscene), companions teleport to formation positions (no follow path).
- **Combat start while companion is far away**: If a companion is stuck or far from the player when combat triggers, the companion is teleported to the combat stage alongside the player. The pre-combat world position is saved and restored on combat end (C-338 pattern).
- **Talk to Party during combat**: The Talk to Party overlay is disabled during combat (the `TALK_TO_PARTY` overlay type is not in the combat-legal overlay set). Companions are busy fighting.
- **Approval saturation**: Approval is clamped to [-100, 100]. Events that would push it beyond this range are capped and logged at debug level.
- **Personal quest already completed**: If a companion's personal quest was completed before the companion is dismissed and re-recruited, `personalQuestActive` must be reset to false and the quest must not re-activate on re-recruitment.

## Open Questions

Must be resolved before status becomes `approved`:

- **Q1**: Should companion level scale with the player's level (auto-catch-up) or track independently? **Proposal**: Track independently (each companion has their own XP). This creates meaningful choices — the player invests in companions they use. If a companion falls behind, the player can grind with them. Confirm with game design.
- **Q2**: Should the player be able to control companion turns manually in combat, or is AI-only sufficient for the Phase 2 demo? **Proposal**: AI-only for this contract. Manual companion control adds a full combat-command UI for each companion and doubles the turn-time budget. Defer to a future contract (e.g., C-346 Gamepad/Touch support could include a companion-command radial menu).
- **Q3**: Should companions have perma-death, or always be revivable? **Proposal**: Always revivable in this contract. Companions enter downed state at 0 HP (C-338 death saves). If they fail all death saves, they are "unconscious" until combat ends, then revive at 1 HP. No permanent companion death. This avoids griefing from AI-controlled companion deaths and is consistent with most modern CRPGs. Confirm with game design.

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
