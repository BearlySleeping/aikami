# Contract C-341: Add Relationships, Factions, Reputation, and Persistent Consequences

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/TODO.md` § C-341 — Phase 2 — Core RPG Depth and Replayability |
| **Target** | `packages/shared/schemas/src/lib/game/faction_standing.ts` (new), `packages/shared/schemas/src/lib/game/relationship_state.ts` (new — extends existing `relationship.ts`), `packages/shared/types/src/lib/game/` (new derived types), `apps/frontend/client/src/lib/services/game/relationship_service.svelte.ts` (new), `apps/frontend/client/src/lib/services/game/game_state_facts.ts` (modify — inject relationship/faction facts), `apps/frontend/client/src/lib/views/game/ui/overlays/reputation/` (new UI), content pack faction definitions (extend `content_pack.ts`) |
| **Priority** | P1 — AI NPCs feel alive when choices alter future behavior. Phase 2 — Core RPG Depth and Replayability |
| **Dependencies** | C-154 (AI Vendors & Economy — `completed`), C-328 (Bounded AI NPC Dialogue — `implemented`, provides `DialogueContextProjection` extension point), C-339 (Quest Graph & Journal — `implemented`, provides quest outcome event hooks), C-340 (Party & Companion Gameplay — `approved`, provides companion approval tracking foundation) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | None — internal systems. Player-facing reputation UI is discoverable in-game. |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**:
  - `CharacterRelationshipSchema` (`packages/shared/schemas/src/lib/database/relationship.ts`) defines trust/affinity/history for pairwise character relationships, but it is **not wired into the game loop** — no service reads or writes these records during gameplay, no NPC dialogue uses them, and no quest outcomes produce them.
  - `ApplyRelationshipDeltaCommandSchema` + `resolveRelationshipDelta()` in `rules_kernel.ts` (C-336) apply trust/affinity deltas clamped to [-100, 100], but these commands are **never dispatched** from dialogue, quest completion, or combat outcomes — the rules kernel supports them but nothing calls them.
  - `NpcSheetSchema.faction` (`packages/shared/schemas/src/lib/database/npc.ts`) is an optional free-text string — there is no faction registry, no per-faction standing scores, and no content-pack faction definitions. Factions exist only as bitECS engine primitives (`Faction.Guard/Civilian/Criminal/Merchant` in `faction_relations.ts`, C-191) with no authoring surface.
  - `NpcMetaEntry.relationshipValue` in `game_world.ts` is a single flat number initialized from spawn data and never updated after creation — it does not capture trust vs affinity, has no history, and does not survive reload.
  - `DialogueContextProjection.gameStateFacts` (C-328) carries gold/inventory/equipment facts only — the `[GAME STATE]` section injected into NPC dialogue prompts contains zero relationship, faction, or reputation information. A player who betrayed the town guard last session gets the same dialogue tone from guards as a hero who saved them.
  - There is no "remembered promises" system — no way to track that the player told NPC A they would retrieve item X, or swore an oath to faction Y.
  - There is no reputation UI — the player has no way to see their standing with factions or NPCs.

- **Reproduction**:
  1. Start a campaign, interact with an NPC via dialogue, trigger a quest completion, or engage in combat.
  2. Observe: no relationship delta commands are dispatched; `gameStateFacts` contains only economy data; NPC dialogue tone is identical regardless of player history.
  3. Search for `applyRelationshipDelta` usage outside tests: `grep -r "applyRelationshipDelta\|RelationshipUpdated" apps/ packages/ --include='*.ts' | grep -v test | grep -v '.test.'` — zero non-test call sites.
  4. Check content pack schema: `grep -r "faction\|standing\|reputation" packages/shared/schemas/src/lib/game/content_pack.ts` — zero hits. Factions cannot be authored in content packs.

- **Existing implementation to reuse**:

  | Capability | Existing source | Reuse / modify / replace |
  |---|---|---|
  | Pairwise relationship schema (trust, affinity, history) | `packages/shared/schemas/src/lib/database/relationship.ts` | **Modify** — add per-entity relationship state envelope; keep existing shape for pairwise records |
  | Relationship delta command + kernel resolution | `packages/shared/schemas/src/lib/game/rules_command.ts` + `packages/shared/utils/src/lib/rules/rules_kernel.ts` | **Reuse** — dispatch from game events; kernel already clamps to [-100, 100] |
  | Faction bitECS components (engine-level) | `packages/frontend/engine/src/components/faction_member.ts` + `math/goap/faction_relations.ts` (C-191) | **Reuse** — engine factions remain; add content-pack authoring surface and standing tracking |
  | Dialogue context projection | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` (C-328) | **Modify** — extend `gameStateFacts` with relationship/faction facts; add `DialogueContextProjection.relationshipFacts` field |
  | Game state facts builder | `apps/frontend/client/src/lib/services/game/game_state_facts.ts` (C-331) | **Modify** — inject faction standing and NPC relationship summaries |
  | Quest state service (outcome hooks) | `apps/frontend/client/src/lib/services/game/quest_state_service.svelte.ts` (C-339) | **Modify** — emit relationship delta commands on quest completion |
  | NPC dialogue orchestrator | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` (C-328) | **Modify** — dispatch relationship deltas from dialogue choices; consume relationship facts for context |
  | Content pack NPC entries | `packages/shared/schemas/src/lib/game/content_pack.ts` (C-315) | **Modify** — add `factions{}` registry and `factionId` on NPC entries |
  | Campaign save envelope | `packages/shared/schemas/src/lib/game/campaign.ts` (C-313) | **Modify** — add `relationshipState` to the save payload |
  | Game composition root | `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` (C-314) | **Modify** — inject `relationshipService` |

- **Known gaps**:
  1. No service owns relationship state — the schema exists but nothing reads/writes it during gameplay.
  2. No faction standing data model — factions are engine-only with no authored definition or scored standing.
  3. No relationship facts in dialogue context — `gameStateFacts` is economy-only.
  4. No event-to-delta bridge — quest completion, dialogue choices, and combat outcomes do not produce relationship commands.
  5. No reputation UI — standing is invisible to the player.
  6. No remembered-promises tracking — player commitments are not recorded.

- **Baseline tests** (run before starting):
  - `packages/shared/schemas/src/lib/game/rules_command.test.ts` — relationship delta schema validation
  - `packages/shared/utils/src/lib/rules/__tests__/rules_kernel.test.ts` — relationship delta clamping
  - `apps/frontend/client/src/lib/services/game/npc_dialogue_service.test.ts` — context projection
  - `packages/frontend/engine/src/__tests__/goap_scheduler.test.ts` — faction relations
  - `apps/frontend/client/src/lib/services/game/game_state_facts.ts` — current facts output
  - Commands: `moon run schemas:test`, `moon run utils:test`, `moon run client:test`, `moon run engine:test`

## User Outcome

After this contract, a **player** can build trust or enmity with NPCs and factions through their choices, and those choices persist across sessions. When the player talks to an NPC, the AI dialogue reflects their relationship history — a guard who witnessed the player saving a civilian speaks differently than one who saw them commit a crime. Faction standing tiers (hostile → neutral → friendly → honored) provide visible but non-gameable feedback. Quests, dialogue choices, and combat outcomes all feed the same relationship state, so authored mechanics and AI tone use the same persisted facts.

## Success Measures

- **Time/latency target**: relationship delta application < 1 ms (pure arithmetic in rules_kernel); relationship facts injection into dialogue context < 5 ms (in-memory lookup); reputation UI render < 16 ms.
- **Offline/degraded behavior**: relationship state is fully local and deterministic — no network or AI required. The rules kernel (C-336) already handles delta clamping without AI. Dialogue context projection adds relationship facts before prompt assembly; if text AI is unavailable, authored dialogue branches still reference relationship thresholds via content-pack conditionals (a content-authoring hook, not runtime AI).
- **Production journey enabled**: `/game` → complete quest → faction standing changes → talk to affected NPC → dialogue tone reflects standing → reputation UI shows updated standing → save/load preserves state.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Pairwise relationship schema | `packages/shared/schemas/src/lib/database/relationship.ts` | **Modify** — extend with relationship state envelope |
| Relationship delta command + kernel | `packages/shared/schemas/src/lib/game/rules_command.ts` + `rules_kernel.ts` | **Reuse** — dispatch from game events |
| Engine faction system | `packages/frontend/engine/src/components/faction_member.ts` + `math/goap/faction_relations.ts` | **Reuse** — engine factions unchanged; add content authoring + standing tracking |
| Dialogue context projection | `npc_dialogue_service.svelte.ts` — `_buildContextProjection()`, `DialogueContextProjection` | **Modify** — add `relationshipFacts` field; extend `_buildSystemPrompt()` |
| Game state facts builder | `apps/frontend/client/src/lib/services/game/game_state_facts.ts` | **Modify** — add faction standing + NPC relationship facts |
| Quest state service | `quest_state_service.svelte.ts` (C-339) | **Modify** — emit relationship deltas on quest objective completion |
| NPC dialogue orchestrator | `npc_dialogue_service.svelte.ts` (C-328) | **Modify** — consume relationshipService for context; dispatch deltas from choices |
| Content pack schema | `packages/shared/schemas/src/lib/game/content_pack.ts` | **Modify** — add `FactionDefinitionSchema` + `factions{}` map |
| Campaign save envelope | `packages/shared/schemas/src/lib/game/campaign.ts` | **Modify** — add `relationshipState` field |
| Game composition root | `game_composition_root.svelte.ts` (C-314) | **Modify** — inject relationshipService |
| ECS snapshot pipeline | `packages/shared/types/src/lib/game/ecs_snapshot.ts` | **Reuse** — relationship state persists alongside ECS snapshot in save blob |

## Overview

This contract adds the **relationship state layer** — the missing bridge between player actions and NPC/faction attitudes. It defines faction standings and character relationships as a persistent, queryable state owned by a new `relationshipService`, feeds that state into dialogue context projection so AI NPCs react to it, and provides a minimal reputation UI. The same `applyRelationshipDelta` command path (already in the rules kernel) is dispatched from quest outcomes, dialogue choices, and combat resolutions — so authored mechanics and AI tone use one source of truth.

## Design Reference

- **Dialogue context extension pattern**: `DialogueContextProjection` (C-328) already carries `gameStateFacts: string[]` — add `relationshipFacts: string[]` following the same shape. The `_buildSystemPrompt()` method concatenates facts under `[GAME STATE]` — relationship facts join that section.
- **Rules kernel dispatch pattern**: C-336's `resolveSkillCheck` → `SkillCheckResolvedEvent` pattern — quest/dialogue/combat services call `rulesKernel.resolve(command, snapshot)` and emit the resulting events. Relationship deltas follow the same flow.
- **Service singleton pattern**: All client services use `BaseFrontendClass` + `create()` factory + `$state` singletons (svelte-conventions). `relationshipService` follows this exact pattern.
- **Content pack schema extension**: C-315/C-316 established `ContentPackManifestSchema` with `npcs{}`, `dialogues{}`, `quests{}` — add `factions{}` as a peer top-level field.
- **Quest outcome hooks**: C-339's `quest_state_service.svelte.ts` emits events on objective completion — relationship deltas hook into that existing event stream without modifying the quest graph engine.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

1. **Faction standing schema → `packages/shared/schemas/src/lib/game/faction_standing.ts` (new)**
   - `FactionStandingSchema`: `{ factionId: string; standing: integer [-100, 100]; tier: 'hostile' | 'unfriendly' | 'neutral' | 'friendly' | 'honored'; lastChangedAt: string }`.
   - `FactionDefinitionSchema` (in content_pack.ts): `{ id: string; name: string; description: string; defaultStanding: integer; standingTiers: { threshold: integer; tier: string; label: string }[] }`.
   - Exported from `packages/shared/schemas/src/index.ts`.

2. **Relationship state envelope → `packages/shared/schemas/src/lib/game/relationship_state.ts` (new)**
   - `RelationshipStateSchema`: top-level save envelope — `{ characterRelationships: Record<string, CharacterRelationship>; factionStandings: Record<string, FactionStanding>; rememberedPromises: Promise[] }`.
   - Extends existing `CharacterRelationshipSchema` (reuse, don't replace).
   - Derived types in `packages/shared/types/src/lib/game/`.

3. **Relationship service → `apps/frontend/client/src/lib/services/game/relationship_service.svelte.ts` (new)**
   - Owns: faction standings map, character relationships map, remembered promises list.
   - Public API: `getStanding(factionId)`, `getRelationship(npcId)`, `applyDelta(command)`, `getFacts()` → string[], `recordPromise(promise)`, `getPromises(npcId)`, `serialize()`/`deserialize()`.
   - Dispatches through `rulesKernel.resolveRelationshipDelta()` for clamping.
   - Injected by `game_composition_root.svelte.ts`.

4. **Dialogue context extension → modify `npc_dialogue_service.svelte.ts` + `game_state_facts.ts`**
   - Add `relationshipFacts: string[]` to `DialogueContextProjection`.
   - `buildGameStateFacts()` gains a second section: faction standing + relationship to current NPC.
   - `_buildSystemPrompt()` appends relationship facts under `[GAME STATE]`.

5. **Event-to-delta bridges → modify quest/dialogue/combat services**
   - Quest completion → `quest_state_service` calls `relationshipService.applyDelta()` with authored deltas from the content pack quest definition.
   - Dialogue choices → `npc_dialogue_service` calls `relationshipService.applyDelta()` when a choice carries a relationship delta.
   - Combat resolution → `combat_service` calls `relationshipService.applyDelta()` for faction hostility shifts (e.g., attacking a guard).
   - Each bridge passes through the rules kernel for deterministic clamping.

6. **Reputation UI → `apps/frontend/client/src/lib/views/game/ui/overlays/reputation/` (new)**
   - View + ViewModel: `reputation_view.svelte` + `reputation_view_model.svelte.ts`.
   - Displays faction standing tiers with labels; NPC relationships with trust/affinity bars.
   - Read-only display — non-gameable (no sliders, no direct manipulation).
   - Accessible from game HUD overlay navigation (C-332).

7. **Content pack faction definitions → modify `content_pack.ts`**
   - Add `factions{}` map to `ContentPackManifestSchema`.
   - `ContentPackLoaderInterface` gains `getFaction(factionId)` + `getAllFactions()`.
   - Emberwatch demo pack (C-316) gets a minimal faction set: `town_guard`, `emberwatch_citizens`, `crimson_covenant`.

8. **Persistence → modify campaign save envelope**
   - `CampaignSchema` gains optional `relationshipState: RelationshipStateSchema`.
   - The relationship service calls `registerSerializable('relationship', relationshipService as unknown as SerializableService<unknown>)` for save/load persistence, following the same pattern as `quest_state_service`, `equipment_service`, etc. (`serializable_service.ts`).
   - Save/load preserves faction standings, character relationships, and remembered promises.

## State & Data Models

```typescript
// packages/shared/types/src/lib/game/faction_standing.ts (derived from @aikami/schemas via Static<>)

/** A single faction's standing with the player. */
export type FactionStanding = {
  factionId: string;
  /** -100 (hated) to 100 (revered). */
  standing: number;
  /** Derived tier from threshold comparison. */
  tier: 'hostile' | 'unfriendly' | 'neutral' | 'friendly' | 'honored';
  /** ISO timestamp of last standing change. */
  lastChangedAt: string;
};

/** Content-pack faction definition. */
export type FactionDefinition = {
  id: string;
  name: string;
  description: string;
  /** Default starting standing (0 = neutral). */
  defaultStanding: number;
  /** Thresholds for tier assignment. */
  standingTiers: Array<{
    threshold: number; // minimum standing for this tier
    tier: FactionStanding['tier'];
    label: string; // display label in reputation UI
  }>;
};
```

```typescript
// packages/shared/types/src/lib/game/relationship_state.ts (derived from @aikami/schemas via Static<>)

/** A remembered promise or commitment made by the player. */
export type RememberedPromise = {
  id: string;
  /** NPC or faction the promise was made to. */
  targetId: string;
  /** Human-readable summary of the promise. */
  description: string;
  /** ISO timestamp when the promise was made. */
  madeAt: string;
  /** ISO timestamp when fulfilled, or undefined if still pending. */
  fulfilledAt?: string;
  /** Whether the promise was broken (failed to fulfill). */
  broken: boolean;
};

/** Top-level relationship state persisted in the campaign save. */
export type RelationshipState = {
  /** NPC character relationships keyed by npcId/characterId. */
  characterRelationships: Record<string, CharacterRelationship>;
  /** Faction standings keyed by factionId. */
  factionStandings: Record<string, FactionStanding>;
  /** Active and resolved promises. */
  rememberedPromises: RememberedPromise[];
};
```

```typescript
// Existing type reused from @aikami/types (packages/shared/types/src/lib/database/relationship.ts)
// CharacterRelationship already has: id, uid, characterId, relationshipType, trust, affinity, history[], notes, updatedAt
```

```typescript
// apps/frontend/client/src/lib/services/game/relationship_service.svelte.ts (sketch)

export type RelationshipServiceInterface = BaseFrontendClassInterface & {
  /** Get current faction standing, initializing from content pack default if unseen. */
  getStanding(factionId: string): FactionStanding | undefined;
  /** Get current character relationship, initializing neutral if unseen. */
  getRelationship(characterId: string): CharacterRelationship | undefined;
  /** Apply a relationship delta command through the rules kernel. Returns the after-state. */
  applyDelta(options: {
    characterId: string;
    trustDelta: number;
    affinityDelta: number;
    eventDescription: string;
  }): { trustAfter: number; affinityAfter: number };
  /** Adjust faction standing directly (no kernel needed — simple arithmetic). */
  adjustFactionStanding(options: {
    factionId: string;
    delta: number;
    reason: string;
  }): FactionStanding;
  /** Record a promise made to an NPC or faction. */
  recordPromise(options: {
    targetId: string;
    description: string;
  }): RememberedPromise;
  /** Get all promises for a target. */
  getPromises(targetId: string): RememberedPromise[];
  /** Fulfill or break a promise. */
  resolvePromise(options: {
    promiseId: string;
    fulfilled: boolean;
  }): void;
  /** Get compact fact strings for dialogue context injection. */
  getFacts(options: { npcId: string; npcFactionId?: string }): string[];
  /** Serialize full state for save. */
  serialize(): RelationshipState;
  /** Deserialize full state on load. */
  deserialize(state: RelationshipState): void;
};
```

TypeBox schemas: `FactionStandingSchema`, `FactionDefinitionSchema` in `packages/shared/schemas/src/lib/game/faction_standing.ts`; `RelationshipStateSchema`, `RememberedPromiseSchema` in `packages/shared/schemas/src/lib/game/relationship_state.ts`. All derived types via `Static<>` in `packages/shared/types/`.

## Quality Requirements

Check each that applies. Use "N/A — reason" when genuinely irrelevant.

- **Offline/degraded mode**: ✅ Relationship state is fully local and deterministic. No AI or network required for delta application, standing queries, or promise tracking. Authored dialogue branches can reference standing thresholds via content-pack conditionals without AI.
- **Accessibility/input**: ✅ Reputation UI is a read-only display — no complex input interactions. Standing tier labels are plain text suitable for screen readers. Color is not the sole differentiator (tier labels accompany any color coding).
- **Performance budget**: ✅ Delta application < 1 ms (clamp + arithmetic in rules_kernel). Fact injection < 5 ms (in-memory map lookups). Reputation UI render < 16 ms (static display, no animation). Relationship state serialized/deserialized as part of save blob — no separate I/O.
- **Security/privacy**: ✅ Relationship state is local campaign data — no PII, no network transmission. Model output never directly mutates relationship state (only validated `ApplyRelationshipDeltaCommand` through the rules kernel).
- **Persistence/migration**: ✅ Relationship state is a new optional field in the campaign save envelope. Old saves without `relationshipState` initialize with empty state and default faction standings from the content pack. See Migration & Rollback.
- **Cancellation/retry/idempotency**: ✅ Relationship deltas are applied through the rules kernel which is a pure function — retrying with the same command + snapshot produces the same result. Promise recording uses generated UUIDs — duplicate recording is harmless (idempotent by ID).
- **Observability**: ✅ `relationshipService` extends `BaseFrontendClass` — all public methods auto-logged via `create()`. State transitions (tier changes, promise fulfillment) emit `this.debug()` calls. Faction standing adjustments log the reason string.

## Migration & Rollback

- **Old data compatibility**: Saves created before C-341 lack `relationshipState`. On load, `relationshipService.deserialize()` receives `undefined` → initializes empty `characterRelationships` and `factionStandings`, then seeds faction standings from content pack defaults. No data loss — player starts with neutral standing everywhere.
- **Migration**: No explicit migration script. The deserialization path handles missing data gracefully. First save after C-341 writes the new field.
- **Rollback**: Remove the `relationshipState` field from the save schema + `relationshipService` injection from composition root. Old saves without the field load normally (the deserialization path already handles missing data). New saves with the field would ignore it on rollback — standing resets to neutral, which is acceptable for a rollback window.
- **Feature flag or kill switch**: Not required — relationship state is additive. If `relationshipService` is not injected, dialogue context simply omits relationship facts (current behavior). No existing code path breaks.
- **Failure recovery**: If `relationshipState` deserialization fails (corrupted data), fall back to empty initialization with a `this.warn()` log. The campaign continues with neutral standings — no player data is irrecoverably lost.

## Scope Boundaries

- **In Scope:**
  - Faction standing data model, content pack definitions, and persistence
  - Character relationship state service (wiring existing schema into the game loop)
  - Relationship delta dispatch from quest outcomes, dialogue choices, and combat
  - Dialogue context extension (relationship facts in NPC prompts)
  - Remembered promises tracking (record, query, fulfill, break)
  - Minimal reputation UI (read-only faction standings + NPC relationships)
  - Content pack faction definitions for the Emberwatch demo
  - Unit tests for relationship service, facts builder, and delta dispatch

- **Out of Scope:**
  - AI-driven relationship assessment — the AI never directly mutates state; only validated commands through the rules kernel
  - Authored consequence triggers in content packs (defining "if standing < X then dialogue branch Y") — this is content-authoring tooling deferred to C-358 (Content Authoring Studio); the data model supports it, but the trigger evaluation engine is out of scope
  - NPC-to-NPC relationships (C-352 schedules/autonomy)
  - Full relationship graph visualization or detailed history browser — the reputation UI is a minimal status display
  - Cross-faction reputation propagation (e.g., "helping the guard also slightly boosts merchant standing") — this is content-authoring logic, not infrastructure
  - Companion approval system (C-340 owns companion-specific relationship mechanics; C-341 provides the data model C-340 consumes)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs (at the limit, not over). Projects touched: `schemas` + `types` (shared data model), `client` (service + UI + dialogue extension), `engine` (content pack loader). Three projects but one releasable system — the relationship state layer. Authored consequence triggers and relationship graph visualization are explicitly deferred to C-358. **No split.**

## Acceptance Criteria

### AC-1: Content Pack Faction Definitions Load into Relationship Service
**Given** a content pack with a `factions{}` map containing at least `town_guard`, `emberwatch_citizens`, and `crimson_covenant` faction definitions with `defaultStanding` and `standingTiers`
**When** the campaign boots and the relationship service initializes
**Then** `relationshipService.getStanding('town_guard')` returns a `FactionStanding` with `standing` equal to the faction's `defaultStanding` and `tier` derived from the threshold configuration.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `apps/frontend/client/src/lib/services/game/relationship_service.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: Manual check — boot Emberwatch campaign, inspect `relationshipService._factionStandings` in browser console.
- E2E / Visual:
    - **Functional**: N/A — unit-tested service initialization.
    - **Visual**: N/A — no UI surface.

**Watch Points**:
- Faction definitions missing from content pack → service initializes with empty standings (no crash).
- Duplicate faction IDs in content pack → last definition wins (deterministic).

### AC-2: Quest Outcomes and Dialogue Choices Dispatch Relationship Deltas
**Given** an active campaign with known faction standings and an NPC relationship
**When** a quest objective completes with an authored `relationshipDelta` (trust +5, affinity +3, reason "helped the guard") OR a dialogue choice is selected that carries a `relationshipDelta`
**Then** `relationshipService.applyDelta()` is called, the rules kernel clamps the result to [-100, 100], the `CharacterRelationship` record is updated with the new scores and a history event, and the delta is idempotent on retry.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `apps/frontend/client/src/lib/services/game/relationship_service.test.ts` + quest state service integration test | `/game` — complete Emberwatch quest: The Fading Ward | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: Complete "The Fading Ward" quest → verify `relationshipService.getRelationship('guard_captain').trust` increased.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/relationship_deltas.spec.ts` — Playwright test: complete quest, verify faction standing persisted across save/load.
    - **Visual**: N/A — state changes are invisible without UI.

**Watch Points**:
- Delta at boundary (trust 95 + 10 = capped at 100, not 105).
- Delta from multiple sources in same tick (quest completion + dialogue choice) → both applied sequentially, order is deterministic.
- NPC with no prior relationship → initializes neutral (trust=0, affinity=0) before applying delta.

### AC-3: Relationship and Faction Facts Injected into NPC Dialogue Context
**Given** the player has `friendly` standing with the town guard (+60) and `hostile` standing with the crimson covenant (-70), and a relationship with an NPC (trust=40, affinity=25)
**When** the player opens dialogue with that NPC
**Then** `DialogueContextProjection.relationshipFacts` contains compact, human-readable facts like `"Town Guard standing: Friendly (+60)"` and `"Your relationship with Captain Aldric: Trusting, Friendly"`, and these facts appear under `[GAME STATE]` in the assembled system prompt.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Integration | `npc_dialogue_service.test.ts` (extend existing) + `game_state_facts.test.ts` (new) | `/game` — talk to NPC after building standing | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: Set faction standing via `relationshipService.adjustFactionStanding()`, open dialogue → verify `gameStateFacts` includes standing facts.
- E2E / Visual:
    - **Functional**: N/A — unit-tested context projection.
    - **Visual**: N/A — prompt content is not a visual artifact.

**Watch Points**:
- Facts output bounded to ≤ 5 lines total (combined economy + relationship) to avoid prompt bloat.
- NPC with no faction → only character relationship fact shown, no faction standing clutter.
- Standing at neutral (0) → fact still shown as "Neutral (0)" for transparency.

### AC-4: Reputation UI Displays Standing and Relationships (Read-Only)
**Given** the player has faction standings and NPC relationships in the relationship service
**When** the player opens the reputation overlay from the game HUD
**Then** each faction's name, standing score, tier label, and tier-appropriate visual indicator (text label, not just color) are displayed; each known NPC relationship shows the character name, trust score, affinity score, and relationship type label. No interactive controls exist — the display is read-only.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Visual | `apps/e2e/src/visual/suites/reputation.visual.ts` | `/game` → open reputation overlay | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test` (ViewModel unit tests)
- Integration: Open reputation overlay from game HUD → verify faction tiers and NPC relationships render.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/reputation_ui.spec.ts` — Playwright test: open overlay, verify factions listed, verify no editable controls.
    - **Visual**: `apps/e2e/src/visual/suites/reputation.visual.ts` — `defineConfig` + `export default`; cases: `{ name: 'reputation-default', route: '/dev/sandbox/reputation' }` and `{ name: 'reputation-hostile', route: '/dev/sandbox/reputation', searchParams: { scenario: 'hostile' } }`. TypeBox schema: `{ score: number; factionsVisible: boolean; tierLabelsPresent: boolean; noEditableControls: boolean; npcRelationshipsVisible: boolean; issues: string[] }`. AI prompt criteria: "Score 90+: Reputation overlay shows faction list with tier labels (not color-only), NPC relationships with trust/affinity scores, and no editable controls (sliders, inputs, buttons to change standing)."

**Watch Points**:
- Empty state: no factions or relationships → overlay shows "No relationships recorded yet" (not a blank panel).
- Long faction/NPC names → truncated with ellipsis, not layout-breaking overflow.
- Tier label "Unfriendly" is distinct from "Hostile" — two visually distinguishable states for negative standing.

### AC-5: Relationship State Survives Save/Load Round-Trip
**Given** an active campaign with faction standings, character relationships, and remembered promises in the relationship service
**When** the player saves the game, exits, and reloads the campaign
**Then** all faction standings, character relationships (trust, affinity, history, type, notes), and remembered promises are restored to their pre-save values exactly.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `relationship_service.test.ts` + save/load integration test | `/game` → save → reload → verify | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: Set standings and relationships, save game, reload → verify all values match.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/relationship_persistence.spec.ts` — Playwright test: build relationship state, save, reload, verify reputation UI shows same values.
    - **Visual**: N/A — persistence is a functional concern.

**Watch Points**:
- Save created before C-341 (no `relationshipState` field) → loads with neutral default standings, no crash.
- Corrupted `relationshipState` in save → falls back to empty initialization with warning log, campaign proceeds.
- Fractional standing scores → rejected by TypeBox `Integer` validation on deserialization.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**:
   - Add `FactionDefinitionSchema` to `content_pack.ts` + `factions{}` field in manifest schema.
   - Add `FactionStandingSchema`, `RelationshipStateSchema`, `RememberedPromiseSchema` to new shared schema files.
   - Derive types in `packages/shared/types/`.
   - Extend `ContentPackLoaderInterface` with `getFaction()`/`getAllFactions()`.
   - Build `relationshipService` in `apps/frontend/client/src/lib/services/game/relationship_service.svelte.ts`.
   - Wire `relationshipService` through `game_composition_root.svelte.ts`.
   - Unit-test all new schemas and the relationship service.

2. **Phase 2 (Integration)**:
   - Extend `DialogueContextProjection` with `relationshipFacts`; modify `_buildContextProjection()` and `_buildSystemPrompt()`.
   - Modify `buildGameStateFacts()` to include relationship/faction facts.
   - Add relationship delta dispatch to quest completion (quest_state_service), dialogue choices (npc_dialogue_service), and combat outcomes (combat_service).
   - Add `relationshipState` to campaign save envelope; register via `registerSerializable()` for save/load persistence.
   - Add Emberwatch demo faction definitions (`town_guard`, `emberwatch_citizens`, `crimson_covenant`).

3. **Phase 3 (UI + Validation)**:
   - Build reputation overlay View + ViewModel.
   - Add reputation overlay to HUD navigation (C-332).
   - Run `validate()` → fix+typecheck+build+test.
   - Run E2E and visual tests.

## Edge Cases & Gotchas

- **NPC with no faction**: `npcSheet.faction` is optional — many NPCs won't have a faction. Relationship facts fall back to character-level trust/affinity only. No error.
- **Faction definition missing from content pack**: If code references a `factionId` not in the content pack, `getStanding()` returns `undefined`. Treat as neutral in facts output. Warn via `this.warn()`.
- **Standing tier boundaries**: Tier assignment uses `>= threshold` comparison — a faction with `hostile: [-100, -60)`, `unfriendly: [-60, -20)`, `neutral: [-20, 20]`, `friendly: (20, 60]`, `honored: (60, 100]`. At exactly -60, the tier is `unfriendly` (the first tier whose threshold is ≤ current standing).
- **Relationship delta during combat**: Combat may produce multiple relationship deltas in rapid succession (e.g., attacking multiple guards). The rules kernel is a pure function — no race conditions, each delta applies sequentially.
- **Promise fulfillment across sessions**: A promise recorded in session 1, fulfilled in session 3. `fulfilledAt` is the ISO timestamp of fulfillment. Broken promises (`broken: true, fulfilledAt: undefined`) are semantically distinct from pending promises.
- **Faction standing from multiple NPCs**: If the player helps Guard A and later attacks Guard B, both should affect `town_guard` standing. The `adjustFactionStanding` path handles this — both events adjust the same `factionStandings['town_guard'].standing`.
- **Relationship facts in authored dialogue**: When AI is unavailable and authored branches are served (C-328 fallback), the content pack dialogue key can reference relationship thresholds via a future content-authoring feature — out of scope here, but the data model must support it (standing score is queryable).

## Open Questions

Must be resolved before status becomes `approved`:

- **C-340 dependency risk**: C-340 (Party & Companion Gameplay) is `approved`, not `implemented`. C-341's companion-relationship data model is consumed by C-340's approval system. If C-340 changes significantly during implementation, C-341's `CharacterRelationship` shape may need adjustment. Mitigation: C-340 explicitly references the existing `CharacterRelationshipSchema` as preparation — the schema is the stable contract between the two.
- **Faction definition authoring scope**: Should faction definitions include icon references, map-color hints, or other visual metadata? Defer to C-358 (Content Authoring Studio). For now, factions carry only `id`, `name`, `description`, `defaultStanding`, and `standingTiers`.
- **Standing tier label localization**: Tier labels ("hostile", "friendly", etc.) are currently hardcoded English strings. If localization is needed, these move to `packages/shared/constants/`. Defer until localization infrastructure exists.

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
