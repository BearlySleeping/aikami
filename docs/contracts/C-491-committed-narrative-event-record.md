---
id: C-491
title: "Committed narrative event record"
source: direct
contract_type: full
status: draft
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-08T00:00:00Z"
---

# Contract C-491: Committed narrative event record

## Metadata

| Field | Value |
|---|---|
| **Source** | [`BACKLOG_C485_PLUS.md`](BACKLOG_C485_PLUS.md) § C-491, seeded from the 2026-09-06 external review; Phase 2 backbone for memory, companions and consequence |
| **Target** | new `packages/shared/schemas/src/lib/game/narrative_event.ts` + `packages/shared/types/src/lib/game/narrative_event.ts`, new `apps/frontend/client/src/lib/services/game/narrative_event_service.svelte.ts` (registered with `serializable_service.ts`), `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` (hook at `_applyConsequences` / `_resolveRoll`), `apps/frontend/client/src/lib/services/game/quest_state_service.svelte.ts` (`_completeQuest` journal derivation), `apps/frontend/client/src/lib/services/game/relationship_service.svelte.ts` (`recordPromise`) |
| **Type** | full |
| **Priority** | P0 — the backbone for memory, companions and consequence; nothing in Phase 2 works without it |
| **Dependencies** | [C-489](C-489-one-authority-path-for-consequences.md) — C-489 decides and applies; C-491 writes down what happened and who saw it. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` — the production dialogue/quest consequence commit paths (`npc_dialogue_service.svelte.ts#_resolveRoll`, `quest_state_service.svelte.ts#_completeQuest`) |

## Problem & Baseline Evidence

- **Consequences are applied but never recorded.** `_applyConsequences` (`npc_dialogue_service.svelte.ts:2110`) — the single C-489 consequence authority — applies `flag_set`/`flag_clear`/`inventory_grant`/`inventory_remove`/`trust_change`/`relationship_update` to the real stores, but the only record it keeps is the in-memory `_idempotencyLedger`, which is **cleared** on operation completion (`:2175-2182`). Nothing persists *what happened, when, and who saw it*.
- **The journal is written separately from the consequence.** `_completeQuest` (`quest_state_service.svelte.ts:915`) authors a `QuestJournalEntry` independently via `_createJournalEntry` (`:1354`), straight from `QuestProgress` + the quest definition. There is no shared record the journal projects from.
- **Promises have a store but no recorder.** `relationshipService.recordPromise` (`relationship_service.svelte.ts:222`) has **no production callers** (same orphan pattern as C-456, V-6). `PromiseMade` therefore has no event-recording path.
- **There is no witnesses model.** `npcAwarenessService.nearbyNpcIds` (`npc_awareness_service.svelte.ts:63`) already knows which NPCs are present in the current scene, but nothing captures *which NPCs perceived a consequence* at commit time. An NPC's knowledge is currently assumed to equal "it's in the log", which C-492 and C-494 need to break.
- **Facts, beliefs, and claims are indistinguishable.** There is no data model that separates "Rollo possesses the wand" (world fact) from "Thalia believes Rollo intends to sell it" (character belief) from "Rollo says he never touched it" (dialogue claim). The single undifferentiated stores (flags, inventory, relationships) force every downstream feature to guess.
- **Reproduction**: read `_applyConsequences` and `_completeQuest`; `grep -rn "recordPromise"` outside `relationship_service.svelte.ts` and its tests → no production callers; `grep -rn "narrative_event\|CommittedNarrativeEvent\|witnesses"` → no such model exists.
- **Existing implementation to reuse**: `NpcStateDeltaSchema` (`packages/shared/schemas/src/lib/game/npc_dialogue_command.ts:213`) for the applied-delta audit trail; the `serializable_service.ts` registry (`registerSerializable` `:37`, `serializeAllServices` `:45`, `hydrateAllServices` `:58`) and its `reset()` fallback for older saves (`:63`); `game_save_service.svelte.ts` (`serializeAllServices()` at `:232`, `hydrateAllServices` at `:338`); `quest_state_service` journal entries; `relationship_service` `RememberedPromise`; `npc_awareness_service` for witness discovery.
- **Known gaps**: no append-only event record; no closed event-kind set; no witnesses; no fact/belief/claim distinction; journal authored independently; promise recording unwired.
- **Baseline tests**: `npc_dialogue_service.test.ts`, `quest_state_service.test.ts`, `relationship_service.test.ts`, `game_save_service.test.ts`, `player_journal_service.test.ts`. Record their state before starting.

## User Outcome

After this contract, every consequential resolution the game applies is also *committed* to a durable, queryable record of what happened, when it happened, which NPCs witnessed it, and whether the stored information is a world fact, a character's belief, or a dialogue claim. The journal projects from that record instead of authoring a parallel copy, and the record survives save/reload so memory (C-492) and companions (C-494) have a real backbone to react against.

## Success Measures

- **Time/latency target**: event recording is a local, synchronous append at consequence-commit time; no new network round-trip and no async dependency in the commit path.
- **Offline/degraded behavior**: events record and persist identically offline — they are local state mutations appended to the serializable service registry.
- **Production journey enabled**: `/game` → resolve a consequential dialogue turn or complete a quest → exactly one committed event is appended with witnesses → save → reload → the event (and the journal entry derived from it) survives intact.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Applied delta schema | `NpcStateDeltaSchema` (`npc_dialogue_command.ts:213`) | reuse — store the applied batch in the event for audit |
| Save/load participation | `serializable_service.ts` registry | reuse — register the event service; `reset()` gives old saves a default empty record |
| Quest journal entry | `quest_state_service._createJournalEntry` (`:1354`) | modify — derive from the committed `QuestResolved` event |
| Witness discovery | `npc_awareness_service.nearbyNpcIds` | reuse — populate `witnesses` at commit time |
| Promise store | `relationship_service.recordPromise` (`:222`) | modify — record a `PromiseMade` event when a promise is recorded |
| Consequence commit seam | `_applyConsequences` / `_resolveRoll` (`npc_dialogue_service.svelte.ts`) | modify — append exactly one event after the batch applies |

## Overview

Introduce a narrowly scoped, append-only **committed narrative event record**: a TypeBox schema (`packages/shared/schemas/`), derived types (`packages/shared/types/`), and a `narrative_event_service` that owns an ordered event list and participates in save/load through the existing serializable-service registry. The C-489 consequence authority and the quest-completion path each append exactly one event drawn from a closed kind set, tagged with witnesses and with an information category (world fact / character belief / dialogue claim). The quest journal projects from the committed event instead of writing a parallel copy. This is **not** a general event-sourcing migration — it extends the existing local save/state architecture with one record.

## Design Reference

- `serializable_service.ts` — the persistence boundary pattern to follow: `registerSerializable('narrativeEvents', …)` in the service constructor, `serialize()`/`hydrate()`/`reset()` on the service, no reach into private internals from `game_save_service`.
- `quest_state_service.svelte.ts` — the existing `journalEntries` list and `_createJournalEntry` show the current independent-authoring seam to convert into a projection of the event record.
- `relationship_service.svelte.ts` `RememberedPromise` — the existing promise persistence; `recordPromise` is the `PromiseMade` recording point.
- `npc_awareness_service.svelte.ts` `nearbyNpcIds` — the existing scene-cast source for witnesses.
- `npc_dialogue_service.svelte.ts` `_resolveRoll` (`:1894`) → `_applyConsequences` (`:2110`) — the production consequence commit seam where the dialogue-sourced events append.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

This is a **narrowly scoped append-only record**, not event sourcing. Do not introduce a replay/rebuild mechanism, a general event store, or a projection engine. The record lives in the existing local save/state architecture as one serializable service; the save envelope does not gain a new top-level format — the `narrativeEvents` snapshot rides inside `serviceSnapshots` like every other service.

There is exactly **one append API**: `narrativeEventService.record(...)`. Every recording caller goes through it. `record()` appends exactly one event, assigns the next monotonic `sequence`, and never mutates or rewrites prior events. The event kind must come from the closed set — no free-form `kind` strings.

The consequence commit points are:
- **Dialogue path** — `_resolveRoll` records exactly one event after `_applyConsequences` returns, using the priority rule in State & Data Models, passing `actorId: npcId` and `witnesses: npcAwarenessService.nearbyNpcIds` (the service dedupes into the final non-empty witness set).
- **Quest path** — `_completeQuest` records one `QuestResolved` event before the journal entry is projected.
- **Promise path** — `relationshipService.recordPromise` records one `PromiseMade` event (the promise actor is always a witness).

`campaignId` is required on every event. Recording callers must supply the active campaign ID at commit time (sourced from the session/campaign context); an event with an empty `campaignId` is a bug and `record()` must throw. `witnesses` must not be empty — the acting NPC is always included; absence of scene data degrades to `[actingNpcId]`, never to `[]`.

## State & Data Models

TypeBox schema in `packages/shared/schemas/src/lib/game/narrative_event.ts`, derived types re-exported from `packages/shared/types/src/lib/game/narrative_event.ts` and from the schemas/types barrels.

```ts
// packages/shared/schemas/src/lib/game/narrative_event.ts

import Type, { type Static } from 'typebox';
import { NpcStateDeltaSchema } from './npc_dialogue_command.ts';

/** The closed set of committed event kinds. */
export const NarrativeEventKindSchema = Type.Union([
  Type.Literal('PromiseMade'),
  Type.Literal('EvidencePresented'),
  Type.Literal('ItemTransferred'),
  Type.Literal('ThreatWitnessed'),
  Type.Literal('QuestResolved'),
  Type.Literal('RelationshipChanged'),
  // flag_set / flag_clear commit through the same C-489 authority as the
  // other five kinds; the backlog's "at minimum" wording permits this
  // seventh kind so a flag-only consequence still has a committed event.
  Type.Literal('WorldFlagChanged'),
]);

/** What kind of information the event records. */
export const NarrativeInformationKindSchema = Type.Union([
  Type.Literal('world_fact'),       // true of the world, no attribution needed
  Type.Literal('character_belief'), // a character holds this belief (requires claimantId)
  Type.Literal('dialogue_claim'),   // a character asserted this in dialogue (requires claimantId)
]);

export const CommittedNarrativeEventSchema = Type.Object(
  {
    /** Unique event identifier (UUID v4). */
    id: Type.String({ minLength: 1 }),
    /** Campaign this event belongs to. */
    campaignId: Type.String({ minLength: 1 }),
    /** Monotonic per-campaign sequence number — stable ordering for journal + retrieval. */
    sequence: Type.Integer({ minimum: 1 }),
    /** One of the closed event-kind set. */
    kind: NarrativeEventKindSchema,
    /** world_fact | character_belief | dialogue_claim. */
    informationKind: NarrativeInformationKindSchema,
    /** Human-readable summary of what happened. */
    summary: Type.String({ minLength: 1 }),
    /** Entity the event is about (NPC id, faction id, item id, quest id). Optional for claims with no subject. */
    subjectId: Type.Optional(Type.String({ minLength: 1 })),
    /** For character_belief / dialogue_claim: who holds or asserts the information. */
    claimantId: Type.Optional(Type.String({ minLength: 1 })),
    /** NPC ids that perceived the event at commit time. The acting NPC is always present. */
    witnesses: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    /** Link to the C-489 operation/source-event identity when sourced from dialogue. */
    sourceEventId: Type.Optional(Type.String()),
    /** The applied deltas that this event summarises (audit trail; may be empty for quest/promise events). */
    deltasApplied: Type.Optional(Type.Array(NpcStateDeltaSchema)),
    /** ISO-8601 timestamp of the commit. */
    recordedAt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const NarrativeEventRecordSchema = Type.Object({
  schemaVersion: Type.Integer({ minimum: 1 }),
  events: Type.Array(CommittedNarrativeEventSchema, { default: [] }),
  nextSequence: Type.Integer({ minimum: 1, default: 1 }),
});
```

The service interface:

```ts
type RecordEventOptions = {
  campaignId: string;
  kind: NarrativeEventKind;
  informationKind: NarrativeInformationKind;
  summary: string;
  subjectId?: string;
  claimantId?: string;
  actorId?: string;               // the acting NPC — always added to witnesses
  witnesses?: readonly string[];  // additional nearby NPC ids from the scene cast
  sourceEventId?: string;
  deltasApplied?: readonly NpcStateDelta[];
};

type NarrativeEventServiceInterface = {
  readonly events: readonly CommittedNarrativeEvent[];
  record(options: RecordEventOptions): CommittedNarrativeEvent;
  /** Events the given NPC witnessed, oldest first (retrieval ranking stays in C-492). */
  witnessedBy(npcId: string): readonly CommittedNarrativeEvent[];
  serialize(): NarrativeEventRecord;
  hydrate(data: NarrativeEventRecord): void;
  reset(): void;
};
```

`record()` derives the next `sequence` from an internal `nextSequence` counter, computes the final witness set as `unique([actorId, ...witnesses].filter(Boolean))`, and throws when it is empty. It also validates that `claimantId` is present for `character_belief` / `dialogue_claim`. The dialogue path passes `actorId: npcId` and `witnesses: npcAwarenessService.nearbyNpcIds`; `record()` performs the dedupe, so the acting NPC is always present even when the scene cast is empty.

**Dialogue event-kind priority** (deterministic; applied after `_applyConsequences` returns a non-empty `applied` list): `ItemTransferred` (any `inventory_grant`/`inventory_remove`) → else `RelationshipChanged` (any `trust_change`/`relationship_update`) → else `WorldFlagChanged` (any `flag_set`/`flag_clear`). If the roll was an Intimidation success and no applied delta matched, record `ThreatWitnessed`. Exactly one event per resolution, never one per delta — the full applied batch goes in `deltasApplied`.

## Quality Requirements

- **Offline/degraded mode**: recording is a synchronous local append; no network/AI dependency.
- **Accessibility/input**: N/A — no new UI in this contract.
- **Performance budget**: `record()` is O(1) amortized (array append) plus witness de-duplication over a small scene cast.
- **Security/privacy**: the event record never accepts a free-form `kind` or an empty `witnesses` array; information is local to the campaign and rides the existing save envelope.
- **Persistence/migration**: events round-trip through `serialize()`/`hydrate()`; an older save with no `narrativeEvents` snapshot hydrates to an empty record via `reset()`.
- **Cancellation/retry/idempotency**: `record()` is called only after the consequence authority reports the batch applied; it is not invoked for rejected-only resolutions. Because the C-489 ledger is cleared on completion, the same `sourceEventId` must not produce a second event on retry — the record happens once, at the same commit point as the applied deltas.
- **Observability**: `record()` logs `kind`, `informationKind`, `campaignId`, and witness count; a recording failure (e.g. missing campaignId) is a thrown error, not a silent skip.

## Migration & Rollback

- **Old data compatibility**: a save written before this contract has no `narrativeEvents` snapshot; `hydrateAllServices` calls `reset()` on the newly registered service, so it loads with an empty record. No save-format version bump is required for the existing envelope.
- **Migration**: none — no data is back-filled from existing flags/inventory/relationships; the record starts empty for pre-existing campaigns and fills as new consequences commit.
- **Rollback**: remove the `narrative_event_service` registration and the two recording calls (`_resolveRoll`, `_completeQuest`) plus the `recordPromise` call; existing saves remain valid because the snapshot is optional.
- **Feature flag or kill switch**: N/A.
- **Failure recovery**: if `record()` throws after deltas applied, the consequence is already committed but the event is missing. Order the append immediately after the authority returns and before narration is returned; a thrown recording error must fail the turn rather than silently dropping the event (the C-489 authority already committed the deltas, so surfacing the recording failure is the only safe option).

## Scope Boundaries

- **In Scope:** a new TypeBox event-record schema + derived types; a `narrative_event_service` singleton registered with the serializable-service registry; exactly one committed event per consequential resolution (dialogue path via `_resolveRoll`/`_applyConsequences`, quest path via `_completeQuest`, promise path via `recordPromise`); the closed event-kind set (minimum six plus `WorldFlagChanged` for flag deltas); the `witnesses` field populated from the acting NPC + nearby scene cast; the `informationKind` field distinguishing world fact / character belief / dialogue claim; save/reload round-trip including old-save compatibility; journal-entry derivation from `QuestResolved` events.
- **Out of Scope:** a general event-sourcing migration (replay, rebuild, general event store, projection engine — extend the existing local save/state architecture with a narrowly scoped record and make that a Watch Point); retrieval and ranking (C-492); companion reactions (C-494); the "be told / infer" knowledge-propagation mechanism (witnesses are captured at commit time; how an NPC *uses* its witnessed set is C-492/C-494); authoring the actual evidence/threat content (C-495 owns the story; `EvidencePresented` and `ThreatWitnessed` only need to be recordable here); writing the final prose.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** the schema, the record service, and the three recording seams (dialogue, quest, promise) share one data model and one invariant — "a consequential resolution commits exactly one witnessed, categorized event." Splitting them would leave the record half-wired and the journal in two authorities at once. Retrieval (C-492) and companion reactions (C-494) are already split out by the backlog.

## Acceptance Criteria

### AC-1: Exactly one committed event per consequential resolution
**Given** a consequential resolution that commits through C-489's single authority
**When** `_resolveRoll` applies one or more deltas via `_applyConsequences`
**Then** exactly one committed event is appended to the event record, drawn from the closed set (`PromiseMade` | `EvidencePresented` | `ItemTransferred` | `ThreatWitnessed` | `QuestResolved` | `RelationshipChanged` | `WorldFlagChanged`), using the deterministic kind-priority rule, with the applied batch stored in `deltasApplied`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `narrative_event_service.test.ts` + `npc_dialogue_service.test.ts` | `npc_dialogue_service.svelte.ts#npcDialogueService` — the production `/game` dialogue service (consequence commit seam `_resolveRoll`) | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: drive `_resolveRoll` (or its consequence seam) with a batch of `inventory_grant` + `trust_change` and assert exactly one `ItemTransferred` event exists with `deltasApplied` containing both applied deltas; assert a rejected-only resolution records nothing; assert a flag-only batch records `WorldFlagChanged`.
- E2E / Visual:
    - **Functional**: N/A — the `/game` dialogue path is LLM-driven; the production seam is covered by unit test at `_resolveRoll`.
    - **Visual**: N/A.

**Watch Points**:
- Do **not** record one event per delta — "exactly one" is literal. The full batch rides `deltasApplied`.
- The event append must happen at the same commit point as the applied deltas (after `_applyConsequences` returns, before `_resolveRoll` returns the narration) so a retry cannot double-record.

### AC-2: Events carry witnesses
**Given** an event that is about to be committed
**When** `record()` is called
**Then** the event carries a non-empty `witnesses` list of NPC ids that perceived it, populated from the acting NPC plus `npcAwarenessService.nearbyNpcIds`; the acting NPC is always present, and an NPC is never a witness merely because the event exists in the campaign log.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `narrative_event_service.test.ts` | `npc_awareness_service.svelte.ts#npcAwarenessService` — the scene cast feeding `narrativeEventService.record` witnesses | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: record an event with `actorId: 'npcB'` and `witnesses: ['npcA', 'npcB']`; assert `witnesses` equals the deduped `['npcB', 'npcA']`, and that `npcB` (actor) is present even when `witnesses` is empty; assert `record()` rejects when neither `actorId` nor `witnesses` is provided.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- Witness capture is a commit-time snapshot — do not recompute witnesses later. "Be told / infer" propagation is out of scope (C-492/C-494); this contract only guarantees the field is real and non-empty.

### AC-3: Facts, beliefs and claims are distinguishable
**Given** three categories of information — a world fact ("Rollo possesses the wand"), a character belief ("Thalia believes Rollo intends to sell it"), and a dialogue claim ("Rollo says he never touched it")
**When** each is stored as a committed event
**Then** they are distinguishable by `informationKind` (`world_fact` | `character_belief` | `dialogue_claim`), and `character_belief` / `dialogue_claim` events require a `claimantId` (rejected when missing).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `narrative_event.test.ts` (schema) + `narrative_event_service.test.ts` | `/game` — the consequence commit path that stores all three information kinds via `narrativeEventService.record` | Filled during verification |

**Test Hooks**:
- Moon Task: the schemas and client unit-test tasks
- Integration: store one event of each `informationKind`; assert they round-trip with distinct kinds, that a belief/claim without `claimantId` is rejected, and that a `world_fact` with a `claimantId` is accepted but the claimant is optional.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- Do not collapse this into "store the events" — the `informationKind` + `claimantId` pair is what makes deception, investigation and secrets possible later (C-492/C-494). It is cheap now and expensive to retrofit.

### AC-4: The event record round-trips and old saves still load
**Given** a campaign with committed events
**When** the campaign is saved and reloaded
**Then** the event record round-trips intact (`events` order, `sequence`, witnesses, and `nextSequence` all preserved), and a save written before this contract (no `narrativeEvents` snapshot) still loads with an empty record.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `narrative_event_service.test.ts` + `game_save_service.test.ts` | `game_save_service.svelte.ts#gameSaveService` — the production save/load path (`serializeAllServices`/`hydrateAllServices`) | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: serialize → hydrate a service with several events and assert deep equality and ordering; feed `hydrateAllServices` a snapshot set lacking `narrativeEvents` and assert the service is reset, not crashed.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- The `reset()` fallback in `hydrateAllServices` (`serializable_service.ts:63`) is what makes old saves load — the service must implement `reset()`, not only `hydrate()`.

### AC-5: The journal derives from the committed event
**Given** a quest that completes
**When** `_completeQuest` commits a `QuestResolved` event
**Then** the corresponding `QuestJournalEntry` derives from that event (`questId`, `title`, `status`, `timestamp`, `endingId`, `endingTitle`, and `narration` come from the event), rather than being authored as a parallel copy.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `quest_state_service.test.ts` | `quest_state_service.svelte.ts#questStateService` — the production quest-resolution seam (`_completeQuest`) | Filled during verification |

**Test Hooks**:
- Moon Task: the client unit-test task
- Integration: complete a quest and assert exactly one `QuestResolved` event exists and the resulting `questStateService.journalEntries` entry's identity fields equal the event's (`questId`, `title`, `status`, `timestamp`, `endingId`, `narration`); assert that removing the event also removes/derives the journal entry consistently.
- E2E / Visual:
    - **Functional**: N/A.
    - **Visual**: N/A.

**Watch Points**:
- `objectiveResults` and `rewards` continue to come from the quest definition/progress — they describe the quest's authored structure, not "what happened". Do not stuff objectives into the event; the event owns the narrative identity, the definition owns the authored detail.

## Implementation Sequence

1. **Phase 1 (Schema + service)**: add `narrative_event.ts` to schemas and types, export from both barrels; add `narrative_event_service.svelte.ts` with `record()`, `witnessedBy()`, `serialize()`/`hydrate()`/`reset()` and register it (`registerSerializable('narrativeEvents', …)`) (AC-2, AC-3, AC-4).
2. **Phase 2 (Dialogue recording)**: hook `_resolveRoll` so one event appends after `_applyConsequences` returns a non-empty `applied` list, using the kind-priority rule and witnesses from the acting NPC + nearby cast (AC-1).
3. **Phase 3 (Quest + promise recording)**: record `QuestResolved` in `_completeQuest` and derive the journal entry from it (AC-5); record `PromiseMade` in `recordPromise`.
4. **Phase 4 (Validation)**: run `validate()` and the client + schemas unit-test tasks.

## Edge Cases & Gotchas

- **Flag-only consequence batch**: has no event kind in the original six; the `WorldFlagChanged` kind covers it so "exactly one event" holds without inventing free-form kinds.
- **Rejected-only resolution**: records nothing — there is no committed consequence to record.
- **Recording failure after applied deltas**: must fail the turn (throw), not silently skip, because the deltas are already committed and a missing event would make the journal/companion lie by omission.
- **Witness de-duplication**: the acting NPC may already be in the scene cast; de-duplicate by NPC id preserving first occurrence.
- **Retry**: `sourceEventId` is stable across retries (C-489); the event append happens once at the same commit point as the applied deltas, so a retried operation cannot double-record.
- **Old saves**: no `narrativeEvents` snapshot → `reset()` empty record; never back-fill a synthetic event log from flags/inventory.

## Open Questions

- Resolved during drafting: the closed set gains a seventh kind `WorldFlagChanged` because `flag_set`/`flag_clear` commit through the same C-489 authority and would otherwise violate AC-1's "exactly one event per resolution". This is within the backlog's "at minimum six kinds" wording.
- Resolved during drafting: dialogue event-kind priority is `ItemTransferred` → `RelationshipChanged` → `WorldFlagChanged`, with `ThreatWitnessed` for a successful Intimidation roll with no applied delta. One event per resolution; the full applied batch rides `deltasApplied`.

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
