// apps/frontend/client/src/lib/services/game/relationship_utils.ts

import type {
  CharacterRelationship,
  FactionStanding,
  FactionStandingTier,
  FactionStandingTierDefinition,
} from '@aikami/types';

const MAX_FACTS = 5;

/** Resolves the highest faction tier threshold reached by a standing score. */
export const computeTier = (options: {
  standing: number;
  tiers: FactionStandingTierDefinition[];
}): FactionStandingTier => {
  let best: FactionStandingTier = 'neutral';
  for (const tier of options.tiers) {
    if (options.standing >= tier.threshold) {
      best = tier.tier;
    } else {
      break;
    }
  }
  return best;
};

/** Builds bounded relationship facts for NPC dialogue context. */
export const buildFacts = (options: {
  standings: ReadonlyMap<string, FactionStanding>;
  relationships: ReadonlyMap<string, CharacterRelationship>;
  npcId: string;
  npcFactionId?: string;
}): string[] => {
  const facts: string[] = [];
  const relationship = options.relationships.get(options.npcId);
  if (relationship) {
    facts.push(
      `Your relationship with ${options.npcId}: Trust ${relationship.trust}, Affinity ${relationship.affinity} (${relationship.relationshipType})`,
    );
  }

  for (const [factionId, standing] of options.standings) {
    if (factionId === options.npcFactionId || standing.standing !== 0) {
      if (facts.length >= MAX_FACTS) {
        break;
      }
      facts.push(`${factionId} standing: ${standing.tier} (${standing.standing})`);
    }
  }

  return facts.slice(0, MAX_FACTS);
};
