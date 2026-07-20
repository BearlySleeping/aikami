// packages/shared/schemas/src/lib/game/faction_standing.ts
//
// Faction standing schema — tracks player standing with game factions.
// Faction definitions are authored in content packs (content_pack.ts).
//
// Contract: C-341 Add Relationships, Factions, Reputation, and Persistent Consequences

import Type, { type Static } from 'typebox';

// ---------------------------------------------------------------------------
// FactionStanding — a single faction's standing with the player
// ---------------------------------------------------------------------------

export const FactionStandingTierSchema = Type.Union([
  Type.Literal('hostile'),
  Type.Literal('unfriendly'),
  Type.Literal('neutral'),
  Type.Literal('friendly'),
  Type.Literal('honored'),
]);

export type FactionStandingTier = Static<typeof FactionStandingTierSchema>;

export const FactionStandingSchema = Type.Object({
  /** Content-pack faction ID (e.g. 'town_guard'). */
  factionId: Type.String({ minLength: 1, description: 'Content-pack faction ID' }),
  /** Standing score from -100 (hated) to 100 (revered). */
  standing: Type.Integer({ minimum: -100, maximum: 100, description: 'Standing score' }),
  /** Derived tier from threshold comparison. */
  tier: FactionStandingTierSchema,
  /** ISO timestamp of last standing change. */
  lastChangedAt: Type.String({ description: 'ISO 8601 timestamp of last change' }),
});

export type FactionStanding = Static<typeof FactionStandingSchema>;

// ---------------------------------------------------------------------------
// FactionStandingTierDefinition — thresholds for tier assignment
// ---------------------------------------------------------------------------

export const FactionStandingTierDefinitionSchema = Type.Object({
  /** Minimum standing for this tier (lower bounds, ≥). */
  threshold: Type.Integer({
    minimum: -100,
    maximum: 100,
    description: 'Minimum standing for this tier',
  }),
  /** Tier identifier. */
  tier: FactionStandingTierSchema,
  /** Display label in reputation UI. */
  label: Type.String({ minLength: 1, description: 'Display label for this tier' }),
});

export type FactionStandingTierDefinition = Static<typeof FactionStandingTierDefinitionSchema>;

// ---------------------------------------------------------------------------
// FactionDefinition — content-pack faction definition
// ---------------------------------------------------------------------------

export const FactionDefinitionSchema = Type.Object({
  /** Unique faction identifier (e.g. 'town_guard'). */
  id: Type.String({ minLength: 1, description: 'Unique faction identifier' }),
  /** Display name. */
  name: Type.String({ description: 'Display name' }),
  /** Flavor description. */
  description: Type.String({ description: 'Faction description' }),
  /** Default starting standing (0 = neutral). */
  defaultStanding: Type.Integer({
    minimum: -100,
    maximum: 100,
    default: 0,
    description: 'Default starting standing',
  }),
  /** Thresholds for tier assignment. Must have exactly 5 entries. */
  standingTiers: Type.Array(FactionStandingTierDefinitionSchema, {
    minItems: 5,
    maxItems: 5,
    description: 'Standing tier thresholds (hostile, unfriendly, neutral, friendly, honored)',
  }),
});

export type FactionDefinition = Static<typeof FactionDefinitionSchema>;
