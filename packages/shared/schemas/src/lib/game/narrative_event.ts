// packages/shared/schemas/src/lib/game/narrative_event.ts
//
// Committed narrative event record — the append-only, closed-kind record of
// what happened during consequential resolutions, when it happened, which NPCs
// witnessed it, and whether the stored information is a world fact, a
// character's belief, or a dialogue claim. Owned by `narrative_event_service`
// and persisted through the serializable-service registry.
//
// This is NOT a general event-sourcing store: there is no replay/rebuild, no
// projection engine, and no free-form `kind` strings. The event kind comes from
// a closed set so downstream consumers (memory C-492, companions C-494) can
// rely on a stable vocabulary.
//
// Contract: C-491 Committed narrative event record

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
  Type.Literal('WorldFlagChanged'),
]);

export type NarrativeEventKind = Static<typeof NarrativeEventKindSchema>;

/** What kind of information the event records. */
export const NarrativeInformationKindSchema = Type.Union([
  Type.Literal('world_fact'), // true of the world, no attribution needed
  Type.Literal('character_belief'), // a character holds this belief (requires claimantId)
  Type.Literal('dialogue_claim'), // a character asserted this in dialogue (requires claimantId)
]);

export type NarrativeInformationKind = Static<typeof NarrativeInformationKindSchema>;

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

export type CommittedNarrativeEvent = Static<typeof CommittedNarrativeEventSchema>;

export const NarrativeEventRecordSchema = Type.Object({
  schemaVersion: Type.Integer({ minimum: 1 }),
  events: Type.Array(CommittedNarrativeEventSchema, { default: [] }),
  nextSequence: Type.Integer({ minimum: 1, default: 1 }),
});

export type NarrativeEventRecord = Static<typeof NarrativeEventRecordSchema>;
