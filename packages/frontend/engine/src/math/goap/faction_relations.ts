// packages/frontend/engine/src/math/goap/faction_relations.ts

// biome-ignore-all lint/style/useNamingConvention: PascalCase faction constants follow the established GOAP enum pattern used throughout the engine
// ---------------------------------------------------------------------------
// Faction Relations — directed graph via bitECS v0.4.0 relations
//
// Contract C-191 AC-2: Models faction alignments using bitECS createRelation().
// Three directed relation types:
//   IsMemberOf    — entity belongs to a faction
//   IsHostileTo   — entity is hostile toward a faction
//   IsProtectorOf — entity protects another faction
//
// Relations support query patterns like:
//   query(world, [IsMemberOf(FactionGuard)])  → all members of FactionGuard
//   query(world, [IsProtectorOf(Wildcard)])    → all protector relationships
// ---------------------------------------------------------------------------

import { createRelation, withAutoRemoveSubject } from 'bitecs';

// ---------------------------------------------------------------------------
// Faction tag constants
//
// Factions are represented as simple integer tags. Each faction is a distinct
// entity in the world that serves as the TARGET of relation components.
// ---------------------------------------------------------------------------

/** Predefined faction tags (numeric identifiers for faction entities). */
export const Faction = {
  /** Town guard faction. */
  Guard: 1,
  /** Civilian/non-combatant faction. */
  Civilian: 2,
  /** Criminal/outlaw faction. */
  Criminal: 3,
  /** Merchant/trader faction. */
  Merchant: 4,
} as const;

/** Type for faction identifiers. */
export type Faction = (typeof Faction)[keyof typeof Faction];

// ---------------------------------------------------------------------------
// bitECS relation definitions
// ---------------------------------------------------------------------------

/**
 * IsMemberOf relation: `IsMemberOf(factionEid)` on an agent entity means
 * the agent belongs to that faction.
 *
 * Uses `withAutoRemoveSubject` so the relation is auto-removed when the
 * subject (agent entity) is destroyed.
 */
export const IsMemberOf = createRelation<{ factionId: number }>(withAutoRemoveSubject);

/**
 * IsHostileTo relation: `IsHostileTo(factionEid)` on an agent entity means
 * the agent is hostile toward the target faction.
 *
 * Uses `withAutoRemoveSubject` for automatic cleanup on entity destruction.
 */
export const IsHostileTo = createRelation<{ factionId: number }>(withAutoRemoveSubject);

/**
 * IsProtectorOf relation: `IsProtectorOf(factionEid)` on an agent entity means
 * the agent protects/defends members of the target faction.
 *
 * Used for emergent consequence logic — when a protector witnesses a crime
 * against their protected faction, they become hostile to the perpetrator.
 */
export const IsProtectorOf = createRelation<{ factionId: number }>(withAutoRemoveSubject);
