// packages/shared/schemas/src/lib/game/relationship_state.ts
//
// Relationship state schema — top-level envelope for faction standings,
// character relationships, and remembered promises. Persisted in the
// campaign save blob alongside ECS snapshot data.
//
// Contract: C-341 Add Relationships, Factions, Reputation, and Persistent Consequences

import Type, { type Static } from 'typebox';
import { CharacterRelationshipSchema } from '../database/relationship.ts';
import { FactionStandingSchema } from './faction_standing.ts';

// ---------------------------------------------------------------------------
// RememberedPromise — a player commitment tracked across sessions
// ---------------------------------------------------------------------------

export const RememberedPromiseSchema = Type.Object({
  /** Unique promise identifier (UUID v4). */
  id: Type.String({ minLength: 1, description: 'Unique promise identifier' }),
  /** NPC or faction the promise was made to. */
  targetId: Type.String({ minLength: 1, description: 'Target NPC or faction ID' }),
  /** Human-readable summary of the promise. */
  description: Type.String({ minLength: 1, description: 'Promise description' }),
  /** ISO timestamp when the promise was made. */
  madeAt: Type.String({ description: 'ISO 8601 timestamp of promise creation' }),
  /** ISO timestamp when fulfilled, or undefined if still pending. */
  fulfilledAt: Type.Optional(Type.String({ description: 'ISO 8601 timestamp of fulfillment' })),
  /** Whether the promise was broken (failed to fulfill). */
  broken: Type.Boolean({ default: false, description: 'Whether the promise was broken' }),
});

export type RememberedPromise = Static<typeof RememberedPromiseSchema>;

// ---------------------------------------------------------------------------
// RelationshipState — top-level save envelope
// ---------------------------------------------------------------------------

export const RelationshipStateSchema = Type.Object({
  /** NPC character relationships keyed by character ID. */
  characterRelationships: Type.Record(Type.String(), CharacterRelationshipSchema, {
    description: 'Character relationships keyed by character ID',
    default: {},
  }),
  /** Faction standings keyed by faction ID. */
  factionStandings: Type.Record(Type.String(), FactionStandingSchema, {
    description: 'Faction standings keyed by faction ID',
    default: {},
  }),
  /** Active and resolved promises. */
  rememberedPromises: Type.Array(RememberedPromiseSchema, {
    description: 'Active and resolved promises',
    default: [],
  }),
});

export type RelationshipState = Static<typeof RelationshipStateSchema>;
